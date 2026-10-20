import { describe, expect, it } from 'vitest';
import {
  MAX_HISTORY_ENTRIES,
  applyReview,
  createEmptyRevisionStore,
  createRevisionRecord,
  listRevisions,
  migrateRevisionStore,
  setNextReview,
  upsertRevisionRecord,
  validateRevisionStore,
} from '../../src/core/revisions';
import { NOW } from '../helpers';

const LATER = '2024-04-04T06:07:08.000Z';

describe('createRevisionRecord', () => {
  it('schedules the first review one day out by default', () => {
    const record = createRevisionRecord({
      problemId: '0217',
      slug: '0217-contains-duplicate',
      title: 'Contains Duplicate',
      nowIso: NOW,
    });
    expect(record).toMatchObject({
      problemId: '0217',
      currentIntervalDays: 1,
      successfulReviews: 0,
      lastReviewedAt: null,
    });
    expect(record.nextReviewAt).toBe('2024-03-06T06:07:08.000Z');
    expect(record.history).toEqual([]);
  });

  it('honours a custom ladder', () => {
    const record = createRevisionRecord({
      problemId: '1',
      slug: '1',
      title: 'One',
      nowIso: NOW,
      intervals: [2, 4],
    });
    expect(record.currentIntervalDays).toBe(2);
  });
});

describe('validateRevisionStore', () => {
  it('accepts an empty store', () => {
    expect(validateRevisionStore(createEmptyRevisionStore(NOW)).ok).toBe(true);
  });

  it('accepts a store with history', () => {
    const store = applyReview({
      store: createEmptyRevisionStore(NOW),
      problemId: '0217',
      rating: 'easy',
      nowIso: NOW,
      fallback: { slug: 's', title: 't' },
    });
    expect(validateRevisionStore(store).ok).toBe(true);
  });

  it('rejects an unknown rating', () => {
    const store = {
      schemaVersion: 1,
      generatedAt: NOW,
      problems: {
        '0217': {
          ...createRevisionRecord({ problemId: '0217', slug: 's', title: 't', nowIso: NOW }),
          history: [{ at: NOW, rating: 'perfect', intervalBeforeDays: 1, intervalAfterDays: 3 }],
        },
      },
    };
    expect(validateRevisionStore(store).ok).toBe(false);
  });

  it('rejects a bad next review date and a mismatched key', () => {
    const base = createRevisionRecord({ problemId: '0217', slug: 's', title: 't', nowIso: NOW });
    expect(
      validateRevisionStore({
        schemaVersion: 1,
        generatedAt: NOW,
        problems: { '0217': { ...base, nextReviewAt: 'whenever' } },
      }).ok,
    ).toBe(false);
    expect(
      validateRevisionStore({
        schemaVersion: 1,
        generatedAt: NOW,
        problems: { '0218': base },
      }).ok,
    ).toBe(false);
  });

  it('rejects a newer schema and non objects', () => {
    expect(validateRevisionStore({ schemaVersion: 99, generatedAt: NOW, problems: {} }).ok).toBe(
      false,
    );
    expect(validateRevisionStore([]).ok).toBe(false);
  });
});

describe('migrateRevisionStore', () => {
  it('upgrades versionless data', () => {
    const outcome = migrateRevisionStore({ problems: {} }, NOW);
    expect(outcome.ok).toBe(true);
    expect(outcome.migratedFrom).toBe(0);
  });

  it('reports unrecognised data', () => {
    expect(migrateRevisionStore({ nope: 1 }, NOW).ok).toBe(false);
  });
});

describe('applyReview', () => {
  const empty = createEmptyRevisionStore(NOW);

  it('creates a record when one does not exist yet', () => {
    const store = applyReview({
      store: empty,
      problemId: '0217',
      rating: 'easy',
      nowIso: NOW,
      fallback: { slug: 'slug', title: 'Title' },
    });
    const record = store.problems['0217'];
    expect(record?.slug).toBe('slug');
    expect(record?.currentIntervalDays).toBe(3);
    expect(record?.successfulReviews).toBe(1);
    expect(record?.history).toHaveLength(1);
  });

  it('moves Easy up, Hard flat and Again back to the shortest interval', () => {
    let store = createEmptyRevisionStore(NOW);
    store = applyReview({ store, problemId: '1', rating: 'easy', nowIso: NOW });
    expect(store.problems['1']?.currentIntervalDays).toBe(3);

    store = applyReview({ store, problemId: '1', rating: 'easy', nowIso: NOW });
    expect(store.problems['1']?.currentIntervalDays).toBe(7);

    store = applyReview({ store, problemId: '1', rating: 'hard', nowIso: NOW });
    expect(store.problems['1']?.currentIntervalDays).toBe(7);

    store = applyReview({ store, problemId: '1', rating: 'again', nowIso: NOW });
    expect(store.problems['1']?.currentIntervalDays).toBe(1);
    expect(store.problems['1']?.successfulReviews).toBe(0);
  });

  it('records a complete history entry', () => {
    const store = applyReview({
      store: createEmptyRevisionStore(NOW),
      problemId: '1',
      rating: 'easy',
      nowIso: NOW,
    });
    expect(store.problems['1']?.history[0]).toEqual({
      at: NOW,
      rating: 'easy',
      intervalBeforeDays: 1,
      intervalAfterDays: 3,
    });
    expect(store.problems['1']?.lastReviewedAt).toBe(NOW);
  });

  it('advances nextReviewAt from the review time', () => {
    const store = applyReview({
      store: createEmptyRevisionStore(NOW),
      problemId: '1',
      rating: 'easy',
      nowIso: NOW,
    });
    expect(store.problems['1']?.nextReviewAt).toBe('2024-03-08T06:07:08.000Z');
  });

  it('does not mutate the input store', () => {
    const original = createEmptyRevisionStore(NOW);
    applyReview({ store: original, problemId: '1', rating: 'easy', nowIso: NOW });
    expect(original.problems).toEqual({});
  });

  it('caps the history length', () => {
    let store = createEmptyRevisionStore(NOW);
    for (let index = 0; index < MAX_HISTORY_ENTRIES + 25; index += 1) {
      store = applyReview({ store, problemId: '1', rating: 'hard', nowIso: NOW });
    }
    expect(store.problems['1']?.history).toHaveLength(MAX_HISTORY_ENTRIES);
  });
});

describe('setNextReview', () => {
  it('overrides the next review date', () => {
    const store = applyReview({
      store: createEmptyRevisionStore(NOW),
      problemId: '1',
      rating: 'hard',
      nowIso: NOW,
    });
    const updated = setNextReview(store, '1', LATER);
    expect(updated.problems['1']?.nextReviewAt).toBe(LATER);
  });

  it('ignores unknown problems', () => {
    const store = createEmptyRevisionStore(NOW);
    expect(setNextReview(store, 'missing', LATER)).toBe(store);
  });
});

describe('upsertRevisionRecord', () => {
  it('keeps existing local scheduling', () => {
    const existing = applyReview({
      store: createEmptyRevisionStore(NOW),
      problemId: '1',
      rating: 'easy',
      nowIso: NOW,
    });
    const restored = createRevisionRecord({ problemId: '1', slug: 's', title: 't', nowIso: LATER });
    const merged = upsertRevisionRecord(existing, restored);
    expect(merged.problems['1']?.currentIntervalDays).toBe(3);
  });

  it('adds a record that is not present locally', () => {
    const merged = upsertRevisionRecord(
      createEmptyRevisionStore(NOW),
      createRevisionRecord({ problemId: '2', slug: 's', title: 't', nowIso: NOW }),
    );
    expect(merged.problems['2']).toBeDefined();
  });
});

describe('listRevisions', () => {
  it('orders by next review date', () => {
    let store = createEmptyRevisionStore(NOW);
    store = applyReview({ store, problemId: 'b', rating: 'easy', nowIso: NOW });
    store = applyReview({ store, problemId: 'a', rating: 'again', nowIso: NOW });
    expect(listRevisions(store).map((record) => record.problemId)).toEqual(['a', 'b']);
  });
});
