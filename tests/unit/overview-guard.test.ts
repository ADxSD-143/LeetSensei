import { describe, expect, it } from 'vitest';
import { buildOverview } from '../../src/background/overview';
import { computeProgress } from '../../src/core/progress';
import { createEmptyRevisionStore } from '../../src/core/revisions';
import type { RevisionStore } from '../../src/core/revisions';
import { emptyAuth, emptySyncState } from '../../src/storage/repository';
import { defaultSettings } from '../../src/storage/settings';
import { IncompatibleOverviewError, readOverviewResponse } from '../../src/ui/overview-guard';
import { makeManifest, makeProblem } from '../helpers';

const NOW = new Date('2024-03-05T06:07:08.000Z');

/** A store with real review history, so derived progress is non-trivial. */
function storeWithHistory(): RevisionStore {
  const store = createEmptyRevisionStore(NOW.toISOString());
  const event = (daysAgo: number, rating: 'again' | 'hard' | 'easy') => ({
    at: new Date(Date.UTC(2024, 2, 5 - daysAgo, 9, 0, 0)).toISOString(),
    rating,
    intervalBeforeDays: 1,
    intervalAfterDays: 3,
  });
  store.problems['0217'] = {
    problemId: '0217',
    slug: '0217-contains-duplicate',
    title: 'Contains Duplicate',
    lastReviewedAt: event(0, 'easy').at,
    nextReviewAt: new Date(Date.UTC(2024, 2, 8, 9, 0, 0)).toISOString(),
    currentIntervalDays: 3,
    successfulReviews: 2,
    history: [event(2, 'again'), event(1, 'hard'), event(0, 'easy')],
  };
  return store;
}

/** The envelope the background returns, built by the real background code. */
function realResponse(store: RevisionStore = storeWithHistory()): {
  overview: Record<string, unknown>;
  pending: null;
  revisions: RevisionStore;
} {
  return {
    overview: buildOverview({
      settings: defaultSettings(),
      manifest: makeManifest([makeProblem()]),
      revisions: store,
      syncState: emptySyncState(),
      auth: emptyAuth(),
      pending: null,
      now: NOW,
      version: '1.0.0',
    }) as unknown as Record<string, unknown>,
    pending: null,
    revisions: store,
  };
}

describe('readOverviewResponse', () => {
  it('passes a response the current background produced through unchanged', () => {
    const response = realResponse();
    const guarded = readOverviewResponse(response, NOW);
    expect(guarded.recoveredProgress).toBe(false);
    expect(guarded.overview).toBe(response.overview);
    expect(guarded.pending).toBeNull();
    expect(guarded.revisions).toBe(response.revisions);
    expect(guarded.overview.progress.streakDays).toBe(3);
  });

  it('derives progress when an older background omits it, instead of crashing', () => {
    const response = realResponse();
    delete response.overview.progress;
    const guarded = readOverviewResponse(response, NOW);

    expect(guarded.recoveredProgress).toBe(true);
    expect(guarded.overview.progress).toEqual(computeProgress(response.revisions, NOW));
    // The numbers are real, not placeholders: Again 1 + Hard 3 + Easy 5, three days running.
    expect(guarded.overview.progress).toMatchObject({ xp: 9, reviews: 3, streakDays: 3 });
  });

  it('treats a partially built progress object as missing', () => {
    const response = realResponse();
    response.overview.progress = { reviews: 3, streakDays: 'lots' };
    const guarded = readOverviewResponse(response, NOW);
    expect(guarded.recoveredProgress).toBe(true);
    expect(guarded.overview.progress.streakDays).toBe(3);
    expect(guarded.overview.progress.rank).toBe('Ronin');
  });

  it('derives a zero state for a profile with no reviews yet', () => {
    const empty = createEmptyRevisionStore(NOW.toISOString());
    const response = realResponse(empty);
    delete response.overview.progress;
    const guarded = readOverviewResponse(response, NOW);
    expect(guarded.overview.progress).toMatchObject({ xp: 0, reviews: 0, streakDays: 0 });
  });

  it('does not mutate the response it was given', () => {
    const response = realResponse();
    delete response.overview.progress;
    const before = JSON.stringify(response);
    readOverviewResponse(response, NOW);
    expect(JSON.stringify(response)).toBe(before);
    expect('progress' in response.overview).toBe(false);
  });

  it('names every missing field when the overview is incomplete', () => {
    const response = realResponse();
    delete response.overview.schedule;
    delete response.overview.status;
    expect(() => readOverviewResponse(response, NOW)).toThrow(IncompatibleOverviewError);
    expect(() => readOverviewResponse(response, NOW)).toThrow(/"status"/);
    expect(() => readOverviewResponse(response, NOW)).toThrow(/"schedule"/);
    expect(() => readOverviewResponse(response, NOW)).toThrow(/Reload LeetSensei/);
  });

  it('reports a response with no overview at all', () => {
    expect(() => readOverviewResponse({ pending: null, revisions: {} }, NOW)).toThrow(
      /no "overview"/,
    );
  });

  it('reports a response that is not an object', () => {
    expect(() => readOverviewResponse(null, NOW)).toThrow(IncompatibleOverviewError);
    expect(() => readOverviewResponse('nope', NOW)).toThrow(/did not return an overview object/);
  });

  it('refuses to guess when the revision store cannot support the derivation', () => {
    const response = realResponse();
    delete response.overview.progress;
    response.revisions = {} as RevisionStore;
    expect(() => readOverviewResponse(response, NOW)).toThrow(/no usable revision store/);
  });

  it('refuses a store whose records are malformed, rather than throwing from inside the derivation', () => {
    const response = realResponse();
    delete response.overview.progress;
    response.revisions = {
      schemaVersion: 1,
      generatedAt: NOW.toISOString(),
      problems: { '0217': { problemId: '0217' } as never },
    };
    expect(() => readOverviewResponse(response, NOW)).toThrow(/no usable revision store/);
  });

  it('rejects a malformed pending job', () => {
    const response = realResponse();
    const broken = { ...response, pending: { conflicts: 'nope' } };
    expect(() => readOverviewResponse(broken, NOW)).toThrow(/malformed "pending" job/);
  });

  it('accepts a pending job with conflicts', () => {
    const response = realResponse();
    const withConflicts = {
      ...response,
      pending: {
        conflicts: [{ path: 'Array/x/solution.py', state: 'modified', message: 'changed' }],
      },
    };
    const guarded = readOverviewResponse(withConflicts, NOW);
    expect(guarded.pending?.conflicts).toHaveLength(1);
  });

  it('accepts rows-only revisions inside the overview', () => {
    const response = realResponse();
    expect(Array.isArray(response.overview.revisions)).toBe(true);
    expect(() => readOverviewResponse(response, NOW)).not.toThrow();
  });
});
