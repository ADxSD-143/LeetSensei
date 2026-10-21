import { describe, expect, it } from 'vitest';
import { MemoryStorageArea } from '../../src/storage/area';
import { STORAGE_KEYS, StateRepository, emptySyncState } from '../../src/storage/repository';
import { MANIFEST_PATH, REVISIONS_PATH } from '../../src/core/paths';
import { NOW, makeProblem } from '../helpers';

async function makeRepository() {
  const area = new MemoryStorageArea();
  return { area, repository: new StateRepository(area) };
}

describe('MemoryStorageArea', () => {
  it('stores and returns values', async () => {
    const area = new MemoryStorageArea();
    await area.set('a', { x: 1 });
    expect(await area.get('a')).toEqual({ x: 1 });
    expect(await area.get('missing')).toBeUndefined();
    expect(await area.keys()).toEqual(['a']);
  });

  it('removes and clears', async () => {
    const area = new MemoryStorageArea();
    await area.set('a', 1);
    await area.set('b', 2);
    await area.remove('a');
    expect(await area.keys()).toEqual(['b']);
    await area.clear();
    expect(await area.keys()).toEqual([]);
  });

  it('returns copies so callers cannot mutate stored state', async () => {
    const area = new MemoryStorageArea();
    const value = { nested: { count: 1 } };
    await area.set('a', value);
    value.nested.count = 99;
    expect(await area.get<typeof value>('a')).toEqual({ nested: { count: 1 } });
  });
});

describe('StateRepository: settings', () => {
  it('returns defaults before anything is saved', async () => {
    const { repository } = await makeRepository();
    expect((await repository.loadSettings()).branch).toBe('main');
  });

  it('round-trips settings', async () => {
    const { repository } = await makeRepository();
    await repository.saveSettings({ ...(await repository.loadSettings()), repoOwner: 'student' });
    expect((await repository.loadSettings()).repoOwner).toBe('student');
  });
});

describe('StateRepository: manifest', () => {
  it('starts empty', async () => {
    const { repository } = await makeRepository();
    const loaded = await repository.loadManifest();
    expect(loaded.value.problems).toEqual({});
    expect(loaded.warnings).toEqual([]);
  });

  it('round-trips a manifest', async () => {
    const { repository } = await makeRepository();
    await repository.saveManifest({
      schemaVersion: 1,
      generatedAt: NOW,
      problems: { '0217': makeProblem() },
    });
    const loaded = await repository.loadManifest();
    expect(Object.keys(loaded.value.problems)).toEqual(['0217']);
  });

  it('degrades safely when the stored manifest is corrupt', async () => {
    const { area, repository } = await makeRepository();
    await area.set(STORAGE_KEYS.manifest, { not: 'a manifest' });
    const loaded = await repository.loadManifest();
    expect(loaded.value.problems).toEqual({});
    expect(loaded.warnings[0]).toMatch(/could not be read/);
    expect(loaded.warnings[0]).toMatch(/never be overwritten silently/);
  });

  it('refuses a manifest from a newer version', async () => {
    const { area, repository } = await makeRepository();
    await area.set(STORAGE_KEYS.manifest, { schemaVersion: 99, generatedAt: NOW, problems: {} });
    const loaded = await repository.loadManifest();
    expect(loaded.warnings).toHaveLength(1);
  });

  it('migrates a versionless manifest and reports it', async () => {
    const { area, repository } = await makeRepository();
    await area.set(STORAGE_KEYS.manifest, {
      generatedAt: NOW,
      problems: { '0217': makeProblem() },
    });
    const loaded = await repository.loadManifest();
    expect(loaded.value.schemaVersion).toBe(1);
    expect(loaded.warnings.length).toBeGreaterThan(0);
  });
});

describe('StateRepository: revisions', () => {
  it('starts empty and round-trips', async () => {
    const { repository } = await makeRepository();
    expect((await repository.loadRevisions()).value.problems).toEqual({});
    await repository.saveRevisions({
      schemaVersion: 1,
      generatedAt: NOW,
      problems: {
        '0217': {
          problemId: '0217',
          slug: 's',
          title: 't',
          lastReviewedAt: null,
          nextReviewAt: NOW,
          currentIntervalDays: 1,
          successfulReviews: 0,
          history: [],
        },
      },
    });
    expect(Object.keys((await repository.loadRevisions()).value.problems)).toEqual(['0217']);
  });

  it('reports unreadable revision data and falls back to empty', async () => {
    const { area, repository } = await makeRepository();
    await area.set(STORAGE_KEYS.revisions, 'garbage');
    const loaded = await repository.loadRevisions();
    expect(loaded.value.problems).toEqual({});
    expect(loaded.warnings[0]).toMatch(/could not be read/);
  });
});

describe('StateRepository: auth', () => {
  it('starts empty', async () => {
    const { repository } = await makeRepository();
    expect(await repository.loadAuth()).toEqual({
      token: null,
      login: null,
      scopes: [],
      method: null,
      savedAt: null,
    });
  });

  it('round-trips and clears credentials', async () => {
    const { repository } = await makeRepository();
    await repository.saveAuth({
      token: 'gho_test',
      login: 'student',
      scopes: ['public_repo'],
      method: 'device',
      savedAt: NOW,
    });
    expect((await repository.loadAuth()).token).toBe('gho_test');
    await repository.clearCredentials();
    expect((await repository.loadAuth()).token).toBeNull();
  });

  it('ignores malformed stored auth', async () => {
    const { area, repository } = await makeRepository();
    await area.set(STORAGE_KEYS.auth, { token: 42, scopes: 'nope', method: 'telepathy' });
    const auth = await repository.loadAuth();
    expect(auth).toMatchObject({ token: null, scopes: [], method: null });
  });
});

describe('StateRepository: sync state', () => {
  it('defaults to an idle, empty state', async () => {
    const { repository } = await makeRepository();
    expect(await repository.loadSyncState()).toEqual(emptySyncState());
  });

  it('sanitises stored values', async () => {
    const { area, repository } = await makeRepository();
    await area.set(STORAGE_KEYS.sync, {
      trackerShas: { [MANIFEST_PATH]: 'sha', bad: 5 },
      lastSyncedAt: NOW,
      queued: [{ submissionId: '1' }],
      lastSubmission: { submissionId: '1' },
      remoteHeadSha: 5,
    });
    const state = await repository.loadSyncState();
    expect(state.trackerShas).toEqual({ [MANIFEST_PATH]: 'sha' });
    expect(state.remoteHeadSha).toBeNull();
    expect(state.queued).toHaveLength(1);
    expect(state.lastSubmission).toEqual({ submissionId: '1' });
  });

  it('caps the queued submissions', async () => {
    const { area, repository } = await makeRepository();
    await area.set(STORAGE_KEYS.sync, {
      queued: Array.from({ length: 500 }, (_, index) => ({ submissionId: String(index) })),
    });
    expect((await repository.loadSyncState()).queued).toHaveLength(20);
  });

  it('offers empty tracker shas that behave like "unknown"', async () => {
    const { repository } = await makeRepository();
    const shas = await repository.loadTrackerShas();
    expect(shas.get(MANIFEST_PATH)).toBe('');
    expect(shas.get(REVISIONS_PATH)).toBe('');
  });
});

describe('StateRepository: pending job', () => {
  it('round-trips and clears', async () => {
    const { repository } = await makeRepository();
    await repository.savePendingJob({
      submission: {
        submissionId: '1',
        problemId: '0217',
        title: 'T',
        titleSlug: 't',
        slug: '0217-t',
        difficulty: 'Easy',
        tags: [],
        categories: ['Array'],
        language: { id: 'python3', label: 'Python 3', extension: 'py' },
        code: 'x\n',
        contentHash: 'h',
        blobSha: 'b',
        submittedAt: null,
        url: 'u',
        metadataIncomplete: false,
        warnings: [],
      },
      files: [],
      conflicts: [{ path: 'a/b.py', state: 'remote-modified', message: 'changed' }],
      preserved: [],
      createdAt: NOW,
    });
    expect((await repository.loadPendingJob())?.conflicts).toHaveLength(1);
    await repository.savePendingJob(null);
    expect(await repository.loadPendingJob()).toBeNull();
  });

  it('ignores a malformed pending job', async () => {
    const { area, repository } = await makeRepository();
    await area.set(STORAGE_KEYS.pending, { files: 'nope' });
    expect(await repository.loadPendingJob()).toBeNull();
  });
});

describe('StateRepository: clearAll', () => {
  it('removes every key LeetSensei owns', async () => {
    const { area, repository } = await makeRepository();
    await repository.saveAuth({
      token: 't',
      login: 'l',
      scopes: [],
      method: 'pat',
      savedAt: NOW,
    });
    await repository.saveManifest({ schemaVersion: 1, generatedAt: NOW, problems: {} });
    await area.set('someone-elses-key', 'keep me');
    await repository.clearAll();
    expect(await area.keys()).toEqual(['someone-elses-key']);
  });
});
