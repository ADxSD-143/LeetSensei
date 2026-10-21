import { describe, expect, it } from 'vitest';
import { SyncCoordinator } from '../../src/background/coordinator';
import { MemoryStorageArea } from '../../src/storage/area';
import { STORAGE_KEYS, StateRepository } from '../../src/storage/repository';
import { applySettingsPatch, defaultSettings } from '../../src/storage/settings';
import { gitBlobSha1 } from '../../src/shared/hash';
import { FakeGithubClient } from '../fake-github';
import { makeRaw } from '../helpers';

const NOW = '2024-03-05T06:07:08.000Z';
const PYTHON_CODE = makeRaw().code;

interface HarnessOptions {
  connected?: boolean;
  settings?: Record<string, unknown>;
  client?: FakeGithubClient;
}

async function makeHarness(options: HarnessOptions = {}) {
  const area = new MemoryStorageArea();
  const repository = new StateRepository(area);
  const client = options.client ?? new FakeGithubClient();
  const coordinator = new SyncCoordinator({
    repository,
    createClient: () => client,
    now: () => new Date(NOW),
  });

  await repository.saveSettings(
    applySettingsPatch(defaultSettings(), {
      repoOwner: 'student',
      repoName: 'solutions',
      branch: 'main',
      ...(options.settings ?? {}),
    }),
  );
  if (options.connected !== false) {
    await repository.saveAuth({
      token: 'gho_test_token',
      login: 'student',
      scopes: ['public_repo'],
      method: 'device',
      savedAt: NOW,
    });
  }
  return { area, repository, client, coordinator };
}

const ARRAY_DIR = 'Array/0217-contains-duplicate';
const HASH_DIR = 'Hash-Table/0217-contains-duplicate';
const MANIFEST_PATH = '.leetcode-tracker/manifest.json';
const REVISIONS_PATH = '.leetcode-tracker/revisions.json';

describe('coordinator: a first successful sync', () => {
  it('writes every applicable category with one commit', async () => {
    const { client, coordinator } = await makeHarness();
    const status = await coordinator.handleAccepted(makeRaw());

    expect(status.phase).toBe('done');
    expect(status.perCategory.map((entry) => entry.category)).toEqual(['Array', 'Hash-Table']);
    expect(status.perCategory.every((entry) => entry.ok)).toBe(true);

    expect(client.contentOf(`${ARRAY_DIR}/solution.py`)).toBe(PYTHON_CODE);
    expect(client.contentOf(`${HASH_DIR}/solution.py`)).toBe(PYTHON_CODE);
    expect(client.contentOf(`${ARRAY_DIR}/README.md`)).toContain('# 217. Contains Duplicate');
    expect(client.contentOf(`${HASH_DIR}/README.md`)).toContain('`solution.py`');

    // One submission -> one commit.
    expect(client.commitCount()).toBe(2); // seed + ours
  });

  it('backs up the manifest and the revision schedule', async () => {
    const { client, repository, coordinator } = await makeHarness();
    await coordinator.handleAccepted(makeRaw());

    const manifestBackup = client.contentOf(MANIFEST_PATH) ?? '';
    expect(manifestBackup).toContain('"0217-contains-duplicate"');
    expect(manifestBackup).not.toMatch(/gho_|access_token/i);

    const revisionsBackup = client.contentOf(REVISIONS_PATH) ?? '';
    expect(revisionsBackup).toContain('"nextReviewAt": "2024-03-06T06:07:08.000Z"');

    const { value: manifest } = await repository.loadManifest();
    expect(Object.keys(manifest.problems)).toEqual(['0217']);
    expect(manifest.problems['0217']?.files).toHaveLength(4);

    const { value: revisions } = await repository.loadRevisions();
    expect(revisions.problems['0217']?.currentIntervalDays).toBe(1);
  });

  it('records the tracker blob ids so the next sync does not see a conflict', async () => {
    const { repository, coordinator } = await makeHarness();
    await coordinator.handleAccepted(makeRaw());
    const syncState = await repository.loadSyncState();
    expect(syncState.trackerShas[MANIFEST_PATH]).toMatch(/^[0-9a-f]{40}$/);
    expect(syncState.trackerShas[REVISIONS_PATH]).toMatch(/^[0-9a-f]{40}$/);
    expect(syncState.lastSyncedAt).toBe(NOW);
  });
});

describe('coordinator: accepted only', () => {
  it.each(['Wrong Answer', 'Runtime Error', 'Time Limit Exceeded', 'Pending'])(
    'refuses a "%s" submission and writes nothing',
    async (status) => {
      const { client, repository, coordinator } = await makeHarness();
      const result = await coordinator.handleAccepted(makeRaw({ status }));

      expect(result.phase).toBe('failed');
      expect(result.errorCode).toBe('not_accepted');
      expect(client.headFileCount()).toBe(0);
      expect(Object.keys((await repository.loadManifest()).value.problems)).toEqual([]);
    },
  );

  it('reports an unsupported language without touching the repository', async () => {
    const { client, coordinator } = await makeHarness();
    const result = await coordinator.handleAccepted(makeRaw({ language: 'brainfuck' }));
    expect(result.phase).toBe('failed');
    expect(result.errorCode).toBe('unsupported_language');
    expect(client.headFileCount()).toBe(0);
  });
});

describe('coordinator: idempotency', () => {
  it('does not create a second commit for the same submission', async () => {
    const { client, coordinator } = await makeHarness();
    await coordinator.handleAccepted(makeRaw());
    const commitsAfterFirst = client.commitCount();

    const second = await coordinator.handleAccepted(makeRaw());
    expect(second.phase).toBe('done');
    expect(second.message).toMatch(/already up to date/i);
    expect(client.commitCount()).toBe(commitsAfterFirst);
  });

  it('keeps both languages when the same problem is solved twice', async () => {
    const { client, repository, coordinator } = await makeHarness();
    await coordinator.handleAccepted(makeRaw());
    await coordinator.handleAccepted(
      makeRaw({
        submissionId: '987654321',
        language: 'cpp',
        code: 'class Solution {\npublic:\n  bool f() { return true; }\n};\n',
      }),
    );

    expect(client.contentOf(`${ARRAY_DIR}/solution.py`)).toBe(PYTHON_CODE);
    expect(client.contentOf(`${ARRAY_DIR}/solution.cpp`)).toContain('class Solution');
    const { value: manifest } = await repository.loadManifest();
    expect(manifest.problems['0217']?.languages.sort()).toEqual(['cpp', 'python3']);
  });

  it('never deletes an obsolete category copy', async () => {
    const { client, repository, coordinator } = await makeHarness();
    await coordinator.handleAccepted(makeRaw());
    const textBefore = client.contentOf(`${HASH_DIR}/solution.py`);
    expect(textBefore).not.toBeNull();

    await coordinator.handleAccepted(makeRaw({ submissionId: '555', tags: ['Array'] }));

    expect(client.contentOf(`${HASH_DIR}/solution.py`)).toBe(textBefore);
    const { value: manifest } = await repository.loadManifest();
    const paths = manifest.problems['0217']?.files.map((file) => file.path) ?? [];
    expect(paths).toContain(`${HASH_DIR}/solution.py`);
  });
});

describe('coordinator: not connected or held back', () => {
  it('queues instead of failing when no account is connected', async () => {
    const { client, repository, coordinator } = await makeHarness({ connected: false });
    const status = await coordinator.handleAccepted(makeRaw());

    expect(status.phase).toBe('detected');
    expect(status.message).toMatch(/Connect a GitHub account/);
    expect((await repository.loadSyncState()).queued).toHaveLength(1);
    expect(client.headFileCount()).toBe(0);
  });

  it('queues when automatic sync is off and flushes on demand', async () => {
    const { client, coordinator } = await makeHarness({ settings: { autoSync: false } });
    const held = await coordinator.handleAccepted(makeRaw());
    expect(held.phase).toBe('detected');
    expect(held.message).toMatch(/Held for manual sync/);
    expect(client.headFileCount()).toBe(0);

    const flushed = await coordinator.syncQueued();
    expect(flushed.phase).toBe('done');
    expect(client.contentOf(`${ARRAY_DIR}/solution.py`)).toBe(PYTHON_CODE);
  });

  it('does nothing when detection is switched off', async () => {
    const { client, coordinator } = await makeHarness({
      settings: { detectSubmissions: false },
    });
    const status = await coordinator.handleAccepted(makeRaw());
    expect(status.phase).toBe('idle');
    expect(status.message).toMatch(/turned off/);
    expect(client.headFileCount()).toBe(0);
  });
});

describe('coordinator: conflicts', () => {
  it('stops and asks before overwriting a hand written file', async () => {
    const { client, repository, coordinator } = await makeHarness();
    await client.seedFile(`${ARRAY_DIR}/solution.py`, '# my own solution\n');

    const status = await coordinator.handleAccepted(makeRaw());
    expect(status.phase).toBe('awaiting-decision');
    expect(status.errorCode).toBe('conflict');
    expect(status.message).toMatch(/already exist with different content/);

    const pending = await coordinator.getPendingJob();
    expect(pending?.conflicts).toHaveLength(1);
    expect(pending?.conflicts[0]?.state).toBe('unmanaged-existing');

    // The other files were not written yet either.
    expect(client.contentOf(`${HASH_DIR}/solution.py`)).toBeNull();
    expect((await repository.loadManifest()).value.problems['0217']).toBeUndefined();
    void repository;
  });

  it('replaces only after an explicit decision', async () => {
    const { client, coordinator } = await makeHarness();
    await client.seedFile(`${ARRAY_DIR}/solution.py`, '# my own solution\n');
    await coordinator.handleAccepted(makeRaw());

    const resolved = await coordinator.resolveConflict(`${ARRAY_DIR}/solution.py`, 'replace');
    expect(resolved.phase).toBe('done');
    expect(client.contentOf(`${ARRAY_DIR}/solution.py`)).toBe(PYTHON_CODE);
    expect(await coordinator.getPendingJob()).toBeNull();
  });

  it('preserves the repository copy under a dated name for save-version', async () => {
    const { client, repository, coordinator } = await makeHarness();
    await client.seedFile(`${ARRAY_DIR}/solution.py`, '# my own solution\n');
    await coordinator.handleAccepted(makeRaw());

    const resolved = await coordinator.resolveConflict(`${ARRAY_DIR}/solution.py`, 'save-version');
    expect(resolved.phase).toBe('done');
    expect(resolved.message).toMatch(/Preserved 1 earlier version/);

    expect(client.contentOf(`${ARRAY_DIR}/solution.py`)).toBe(PYTHON_CODE);
    expect(client.contentOf(`${ARRAY_DIR}/solution.20240305-060708.py`)).toBe(
      '# my own solution\n',
    );

    const { value: manifest } = await repository.loadManifest();
    const paths = manifest.problems['0217']?.files.map((file) => file.path) ?? [];
    expect(paths).toContain(`${ARRAY_DIR}/solution.20240305-060708.py`);
  });

  it('leaves the file completely alone when the user cancels', async () => {
    const { client, coordinator } = await makeHarness();
    await client.seedFile(`${ARRAY_DIR}/solution.py`, '# my own solution\n');
    await coordinator.handleAccepted(makeRaw());

    const resolved = await coordinator.resolveConflict(`${ARRAY_DIR}/solution.py`, 'cancel');
    expect(resolved.phase).toBe('done');
    expect(client.contentOf(`${ARRAY_DIR}/solution.py`)).toBe('# my own solution\n');
    // Everything else still landed.
    expect(client.contentOf(`${HASH_DIR}/solution.py`)).toBe(PYTHON_CODE);
  });

  it('merges a README the user edited instead of raising a conflict', async () => {
    const { client, repository, coordinator } = await makeHarness();
    await coordinator.handleAccepted(makeRaw());

    const readmePath = `${ARRAY_DIR}/README.md`;
    const original = client.contentOf(readmePath) ?? '';
    const edited = original.replace(
      '_Describe your approach here. LeetSensei keeps this section on every sync._',
      'Sort and compare neighbours.',
    );
    await client.seedFile(readmePath, edited);

    const status = await coordinator.handleAccepted(makeRaw({ submissionId: '4242' }));
    expect(status.phase).toBe('done');
    expect(client.contentOf(readmePath)).toContain('Sort and compare neighbours.');
    void repository;
  });
});

describe('coordinator: failure handling', () => {
  it('retries a transient remote failure and then succeeds', async () => {
    const { client, coordinator } = await makeHarness();
    client.networkFailures = 1;
    const status = await coordinator.handleAccepted(makeRaw());
    expect(status.phase).toBe('done');
  });

  it('does not advance local state when the write cannot be verified', async () => {
    const { client, repository, coordinator } = await makeHarness();
    client.hideCommitFromBranch = true;
    const status = await coordinator.handleAccepted(makeRaw());

    expect(status.phase).toBe('failed');
    expect(status.errorCode).toBe('remote_changed');
    expect(Object.keys((await repository.loadManifest()).value.problems)).toEqual([]);
  });

  it('fails clearly when the configured branch does not exist', async () => {
    const { client, repository, coordinator } = await makeHarness();
    client.branches = [];
    const status = await coordinator.handleAccepted(makeRaw());
    expect(status.phase).toBe('failed');
    expect(status.errorCode).toBe('not_found');
    void repository;
  });
});

describe('coordinator: revisions', () => {
  it('schedules a review after a sync and updates it on rating', async () => {
    const { client, repository, coordinator } = await makeHarness();
    await coordinator.handleAccepted(makeRaw());

    const result = await coordinator.reviewProblem('0217', 'easy');
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/Next review/);

    const { value: revisions } = await repository.loadRevisions();
    expect(revisions.problems['0217']?.currentIntervalDays).toBe(3);
    expect(revisions.problems['0217']?.history).toHaveLength(1);

    const backup = client.contentOf(REVISIONS_PATH) ?? '';
    expect(backup).toContain('"currentIntervalDays": 3');
  });

  it('applies again / hard / easy transitions end to end', async () => {
    const { repository, coordinator } = await makeHarness();
    await coordinator.handleAccepted(makeRaw());

    await coordinator.reviewProblem('0217', 'easy');
    await coordinator.reviewProblem('0217', 'easy');
    await coordinator.reviewProblem('0217', 'hard');
    const hard = await repository.loadRevisions();
    expect(hard.value.problems['0217']?.currentIntervalDays).toBe(7);

    await coordinator.reviewProblem('0217', 'again');
    const again = await repository.loadRevisions();
    expect(again.value.problems['0217']?.currentIntervalDays).toBe(1);
    expect(again.value.problems['0217']?.successfulReviews).toBe(0);
  });

  it('allows a manual next review date', async () => {
    const { repository, coordinator } = await makeHarness();
    await coordinator.handleAccepted(makeRaw());
    const result = await coordinator.setNextReview('0217', '2024-09-01T09:00:00.000Z');
    expect(result.ok).toBe(true);
    const { value } = await repository.loadRevisions();
    expect(value.problems['0217']?.nextReviewAt).toBe('2024-09-01T09:00:00.000Z');
  });

  it('rejects a manual date for an unknown problem', async () => {
    const { coordinator } = await makeHarness();
    const result = await coordinator.setNextReview('9999', '2024-09-01T09:00:00.000Z');
    expect(result.ok).toBe(false);
  });

  it('counts due reviews for the badge', async () => {
    const { coordinator } = await makeHarness();
    await coordinator.handleAccepted(makeRaw());
    // A freshly synced problem is scheduled one day out, so nothing is due yet.
    expect(await coordinator.dueCount()).toBe(0);

    await coordinator.setNextReview('0217', '2024-03-01T09:00:00.000Z');
    expect(await coordinator.dueCount()).toBe(1);
  });
});

describe('coordinator: restore and data controls', () => {
  it('restores manifest and revisions into a fresh profile', async () => {
    const client = new FakeGithubClient();
    const first = await makeHarness({ client });
    await first.coordinator.handleAccepted(makeRaw());

    const second = await makeHarness({ client });
    const restored = await second.coordinator.restoreFromRemote();
    expect(restored.ok).toBe(true);
    expect(restored.problemsAdded).toBe(1);
    expect(restored.revisionsAdded).toBe(1);

    const { value: manifest } = await second.repository.loadManifest();
    expect(manifest.problems['0217']?.slug).toBe('0217-contains-duplicate');
    const syncState = await second.repository.loadSyncState();
    expect(syncState.trackerShas[MANIFEST_PATH]).toBe(
      await gitBlobSha1(client.contentOf(MANIFEST_PATH) ?? ''),
    );
  });

  it('reports a restore failure without breaking local data', async () => {
    const { coordinator } = await makeHarness({ connected: false });
    const restored = await coordinator.restoreFromRemote();
    expect(restored.ok).toBe(false);
    expect(restored.code).toBe('auth_required');
  });

  it('disconnects without deleting solutions or local state', async () => {
    const { repository, coordinator } = await makeHarness();
    await coordinator.handleAccepted(makeRaw());

    const result = await coordinator.disconnect();
    expect(result.ok).toBe(true);
    expect((await repository.loadAuth()).token).toBeNull();
    expect(Object.keys((await repository.loadManifest()).value.problems)).toEqual(['0217']);
  });

  it('clears all local data on request', async () => {
    const { area, coordinator } = await makeHarness();
    await coordinator.handleAccepted(makeRaw());
    await coordinator.clearLocalData();
    expect(await area.keys()).toEqual([]);
    const overview = await coordinator.getOverview();
    expect(overview.problems).toEqual([]);
  });

  it('exports local state without any credential', async () => {
    const { coordinator } = await makeHarness();
    await coordinator.handleAccepted(makeRaw());
    const exported = await coordinator.exportData();
    expect(exported.json).toContain('"0217-contains-duplicate"');
    expect(exported.json).not.toContain('gho_test_token');
    expect(exported.json).toMatch(/contains no credentials/);
  });

  it('lists repositories through the client', async () => {
    const { coordinator } = await makeHarness();
    const repos = await coordinator.listRepos();
    expect(repos.map((repo) => repo.fullName)).toEqual(['student/solutions']);
  });

  it('reports a clear overview for the dashboard', async () => {
    const { coordinator } = await makeHarness();
    await coordinator.handleAccepted(makeRaw());
    const overview = await coordinator.getOverview();
    expect(overview.connected).toBe(true);
    expect(overview.repo).toEqual({ owner: 'student', repo: 'solutions', branch: 'main' });
    expect(overview.problems).toHaveLength(1);
    expect(overview.revisions).toHaveLength(1);
    expect(overview.status.phase).toBe('done');
    expect(overview.orphans).toEqual([]);
    void STORAGE_KEYS;
  });
});

describe('coordinator: destination verification', () => {
  it('reports write access and an existing branch', async () => {
    const { coordinator } = await makeHarness();
    const check = await coordinator.checkAccess('student', 'solutions', 'main');

    expect(check).toEqual({
      owner: 'student',
      repo: 'solutions',
      branch: 'main',
      canPush: true,
      branchExists: true,
      defaultBranch: 'main',
      isPrivate: false,
    });
  });

  it('reports a repository the account cannot write to', async () => {
    const { client, coordinator } = await makeHarness();
    client.canPush = false;

    const check = await coordinator.checkAccess('student', 'solutions', 'main');
    expect(check.canPush).toBe(false);
    expect(check.branchExists).toBe(true);
  });

  it('reports a missing branch instead of pretending setup succeeded', async () => {
    const { coordinator } = await makeHarness();
    const check = await coordinator.checkAccess('student', 'solutions', 'does-not-exist');

    expect(check.branchExists).toBe(false);
    expect(check.canPush).toBe(true);
  });

  it('surfaces a private repository as not found for a public-only token', async () => {
    const { client, coordinator } = await makeHarness();
    client.repoNotFound = true;

    await expect(
      coordinator.checkAccess('student', 'private-solutions', 'main'),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('requires a connected account', async () => {
    const { coordinator } = await makeHarness({ connected: false });
    await expect(coordinator.checkAccess('student', 'solutions', 'main')).rejects.toMatchObject({
      code: 'auth_required',
    });
  });

  it('reports a private destination distinctly once access is granted', async () => {
    const { client, coordinator } = await makeHarness();
    client.repoPrivate = true;

    const check = await coordinator.checkAccess('student', 'solutions', 'main');
    expect(check.isPrivate).toBe(true);
  });
});
