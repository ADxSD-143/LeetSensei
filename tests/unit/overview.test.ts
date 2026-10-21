import { describe, expect, it } from 'vitest';
import {
  buildOverview,
  deriveSetupState,
  findOrphans,
  toProblemSummaries,
  toRevisionRows,
} from '../../src/background/overview';
import { createEmptyManifest } from '../../src/core/manifest';
import { createEmptyRevisionStore } from '../../src/core/revisions';
import { emptySyncState, emptyAuth } from '../../src/storage/repository';
import { defaultSettings } from '../../src/storage/settings';
import { NOW, makeManifest, makeProblem } from '../helpers';

const NOW_DATE = new Date(NOW);

function revisionStore(problemId: string, nextReviewAt: string, interval = 1) {
  const store = createEmptyRevisionStore(NOW);
  store.problems[problemId] = {
    problemId,
    slug: '0217-contains-duplicate',
    title: 'Contains Duplicate',
    lastReviewedAt: null,
    nextReviewAt,
    currentIntervalDays: interval,
    successfulReviews: 0,
    history: [],
  };
  return store;
}

describe('toProblemSummaries', () => {
  it('summarises each problem with its review state', () => {
    const manifest = makeManifest([makeProblem()]);
    const revisions = revisionStore('0217', '2024-03-06T06:07:08.000Z');
    const summaries = toProblemSummaries(manifest, revisions, NOW_DATE);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      problemId: '0217',
      title: 'Contains Duplicate',
      difficulty: 'Easy',
      languages: ['python3'],
      fileCount: 4,
      dueState: 'upcoming',
    });
  });

  it('reports a missing revision record as null instead of guessing', () => {
    const summaries = toProblemSummaries(
      makeManifest([makeProblem()]),
      createEmptyRevisionStore(NOW),
      NOW_DATE,
    );
    expect(summaries[0]?.nextReviewAt).toBeNull();
    expect(summaries[0]?.dueState).toBeNull();
  });

  it('sorts deterministically', () => {
    const manifest = makeManifest([
      makeProblem({ problemId: '0002', slug: '0002-add-two-numbers' }),
      makeProblem({ problemId: '0001', slug: '0001-two-sum' }),
    ]);
    const ids = toProblemSummaries(manifest, createEmptyRevisionStore(NOW), NOW_DATE).map(
      (summary) => summary.problemId,
    );
    expect(ids).toEqual(['0001', '0002']);
  });
});

describe('toRevisionRows', () => {
  it('orders by the next review date and includes history counts', () => {
    const store = createEmptyRevisionStore(NOW);
    store.problems['b'] = {
      problemId: 'b',
      slug: 'b',
      title: 'B',
      lastReviewedAt: NOW,
      nextReviewAt: '2024-04-01T00:00:00.000Z',
      currentIntervalDays: 7,
      successfulReviews: 2,
      history: [{ at: NOW, rating: 'hard', intervalBeforeDays: 3, intervalAfterDays: 7 }],
    };
    store.problems['a'] = {
      problemId: 'a',
      slug: 'a',
      title: 'A',
      lastReviewedAt: null,
      nextReviewAt: '2024-03-01T00:00:00.000Z',
      currentIntervalDays: 1,
      successfulReviews: 0,
      history: [],
    };
    const rows = toRevisionRows(makeManifest([]), store, NOW_DATE);
    expect(rows.map((row) => row.problemId)).toEqual(['a', 'b']);
    expect(rows[1]?.lastRating).toBe('hard');
    expect(rows[1]?.reviewCount).toBe(1);
    expect(rows[0]?.dueState).toBe('overdue');
  });

  it('still renders a record that has no manifest entry', () => {
    const rows = toRevisionRows(makeManifest([]), revisionStore('0217', NOW), NOW_DATE);
    expect(rows[0]).toMatchObject({ problemId: '0217', title: 'Contains Duplicate', fileCount: 0 });
  });
});

describe('findOrphans', () => {
  it('reports problems missing from either side', () => {
    const manifest = makeManifest([makeProblem({ problemId: '0001', slug: '0001-two-sum' })]);
    const store = revisionStore('0002', NOW);
    expect(findOrphans(manifest, store)).toEqual(['0001', '0002']);
  });

  it('reports nothing when both sides agree', () => {
    expect(findOrphans(makeManifest([makeProblem()]), revisionStore('0217', NOW))).toEqual([]);
  });
});

describe('buildOverview', () => {
  it('reports a disconnected, empty state without inventing anything', () => {
    const overview = buildOverview({
      settings: defaultSettings(),
      manifest: createEmptyManifest(NOW),
      revisions: createEmptyRevisionStore(NOW),
      syncState: emptySyncState(),
      auth: emptyAuth(),
      pending: null,
      now: NOW_DATE,
      version: '0.1.0',
    });
    expect(overview.connected).toBe(false);
    expect(overview.repo).toBeNull();
    expect(overview.problems).toEqual([]);
    expect(overview.schedule).toEqual({ overdue: 0, dueToday: 0, upcoming: 0, total: 0 });
    expect(overview.pendingConflicts).toEqual([]);
    expect(overview.version).toBe('0.1.0');
  });

  it('summarises the queue and the connection', () => {
    const overview = buildOverview({
      settings: { ...defaultSettings(), repoOwner: 'student', repoName: 'solutions' },
      manifest: makeManifest([makeProblem()]),
      revisions: revisionStore('0217', '2024-03-01T00:00:00.000Z'),
      syncState: { ...emptySyncState(), queued: [{} as never], lastSyncedAt: NOW },
      auth: {
        token: 't',
        login: 'student',
        scopes: ['public_repo'],
        method: 'device',
        savedAt: NOW,
      },
      pending: null,
      now: NOW_DATE,
      version: '0.1.0',
    });
    expect(overview.connected).toBe(true);
    expect(overview.login).toBe('student');
    expect(overview.repo).toEqual({ owner: 'student', repo: 'solutions', branch: 'main' });
    expect(overview.schedule.overdue).toBe(1);
    expect(overview.queuedSubmissions).toBe(1);
    expect(overview.lastSyncedAt).toBe(NOW);
  });
});

describe('setup state', () => {
  const configured = { ...defaultSettings(), repoOwner: 'student', repoName: 'solutions' };
  const connectedAuth = {
    token: 't',
    login: 'student',
    scopes: ['public_repo'],
    method: 'device' as const,
    savedAt: NOW,
  };

  it('walks through the three first-run states', () => {
    expect(deriveSetupState(false, defaultSettings())).toBe('needs-github');
    expect(deriveSetupState(true, defaultSettings())).toBe('needs-repository');
    expect(deriveSetupState(true, configured)).toBe('ready');
  });

  it('treats a half-configured destination as not ready', () => {
    expect(deriveSetupState(true, { ...defaultSettings(), repoOwner: 'student' })).toBe(
      'needs-repository',
    );
    expect(deriveSetupState(true, { ...defaultSettings(), repoName: 'solutions' })).toBe(
      'needs-repository',
    );
  });

  it('keeps needing GitHub even when a repository is configured', () => {
    expect(deriveSetupState(false, configured)).toBe('needs-github');
  });

  it('is surfaced on the overview so the popup and options agree', () => {
    const build = (
      auth: typeof connectedAuth | ReturnType<typeof emptyAuth>,
      settings = configured,
    ) =>
      buildOverview({
        settings,
        manifest: createEmptyManifest(NOW),
        revisions: createEmptyRevisionStore(NOW),
        syncState: emptySyncState(),
        auth,
        pending: null,
        now: NOW_DATE,
        version: '1.0.0',
      });

    expect(build(emptyAuth()).setup).toBe('needs-github');
    expect(build(connectedAuth, defaultSettings()).setup).toBe('needs-repository');
    expect(build(connectedAuth).setup).toBe('ready');
  });
});
