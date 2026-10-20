import { describe, expect, it } from 'vitest';
import { buildSyncPlan } from '../../src/core/plan';
import { createEmptyManifest } from '../../src/core/manifest';
import { createEmptyRevisionStore, validateRevisionStore } from '../../src/core/revisions';
import { validateManifest } from '../../src/core/manifest';
import { MANIFEST_PATH, REVISIONS_PATH } from '../../src/core/paths';
import { completeSync, prepareSync } from '../../src/core/pipeline';
import { gitBlobSha1 } from '../../src/shared/hash';
import { NOW, makeManifest, makeProblem, makeRaw } from '../helpers';
import type { Manifest } from '../../src/core/manifest';

interface Remote {
  contents: Map<string, string>;
  shas: Map<string, string>;
  readRemoteContent: (path: string) => Promise<string | null>;
}

async function makeRemote(entries: Record<string, string>): Promise<Remote> {
  const contents = new Map(Object.entries(entries));
  const shas = new Map<string, string>();
  for (const [path, content] of contents) shas.set(path, await gitBlobSha1(content));
  return {
    contents,
    shas,
    readRemoteContent: async (path: string) => contents.get(path) ?? null,
  };
}

const emptyRemote = await makeRemote({});

function baseInput(manifest: Manifest, remote: Remote, raw = makeRaw()) {
  return {
    raw,
    manifest,
    revisions: createEmptyRevisionStore(NOW),
    remoteFiles: remote.shas,
    knownTrackerShas: new Map<string, string>(),
    readRemoteContent: remote.readRemoteContent,
    nowIso: NOW,
  };
}

/** Builds the local state that a completed first sync would leave behind. */
async function afterFirstSync(remote: Remote) {
  const plan = await buildSyncPlan({
    submission: await (await import('../../src/core/normalize')).normalizeSubmission(makeRaw()),
    manifest: createEmptyManifest(NOW),
    revisions: createEmptyRevisionStore(NOW),
    existingContent: new Map(),
    nowIso: NOW,
  });
  const knownTrackerShas = new Map<string, string>();
  for (const file of plan.plan.trackerFiles) knownTrackerShas.set(file.path, file.blobSha);
  for (const file of plan.plan.files) remote.contents.set(file.path, file.content);
  for (const file of plan.plan.trackerFiles) remote.contents.set(file.path, file.content);
  for (const [path, content] of remote.contents) {
    remote.shas.set(path, await gitBlobSha1(content));
  }
  return { manifest: plan.nextManifest, revisions: plan.nextRevisions, knownTrackerShas };
}

describe('prepareSync', () => {
  it('plans a full sync for a new Accepted submission', async () => {
    const outcome = await prepareSync(baseInput(createEmptyManifest(NOW), emptyRemote));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.prepared.files).toHaveLength(4);
    expect(outcome.prepared.conflicts).toEqual([]);
    expect(outcome.prepared.comparisons.every((comparison) => comparison.state === 'new')).toBe(
      true,
    );
  });

  it('refuses a non Accepted submission before doing any work', async () => {
    const outcome = await prepareSync(
      baseInput(createEmptyManifest(NOW), emptyRemote, makeRaw({ status: 'Wrong Answer' })),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe('not_accepted');
  });

  it('refuses an unsupported language', async () => {
    const outcome = await prepareSync(
      baseInput(createEmptyManifest(NOW), emptyRemote, makeRaw({ language: 'brainfuck' })),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe('unsupported_language');
  });

  it('reports nothing to do when the repository already matches', async () => {
    const remote = await makeRemote({});
    const state = await afterFirstSync(remote);
    const outcome = await prepareSync({
      ...baseInput(state.manifest, remote),
      knownTrackerShas: state.knownTrackerShas,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.prepared.conflicts).toEqual([]);
    expect(
      outcome.prepared.comparisons.every((comparison) => comparison.state === 'unchanged'),
    ).toBe(true);
  });

  it('protects a file it never created', async () => {
    const remote = await makeRemote({
      'Array/0217-contains-duplicate/solution.py': 'someone else wrote this\n',
    });
    const outcome = await prepareSync(baseInput(createEmptyManifest(NOW), remote));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.prepared.conflicts).toHaveLength(1);
    expect(outcome.prepared.conflicts[0]?.state).toBe('unmanaged-existing');
  });

  it('flags a solution that was edited on GitHub', async () => {
    const remote = await makeRemote({});
    const state = await afterFirstSync(remote);
    remote.contents.set('Array/0217-contains-duplicate/solution.py', '# edited by hand\n');
    remote.shas.set(
      'Array/0217-contains-duplicate/solution.py',
      await gitBlobSha1('# edited by hand\n'),
    );

    const outcome = await prepareSync({
      ...baseInput(state.manifest, remote),
      knownTrackerShas: state.knownTrackerShas,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.prepared.conflicts).toHaveLength(1);
    expect(outcome.prepared.conflicts[0]?.path).toBe('Array/0217-contains-duplicate/solution.py');
    expect(outcome.prepared.conflicts[0]?.state).toBe('remote-modified');
  });

  it('does not flag a README whose user sections are preserved', async () => {
    const remote = await makeRemote({});
    const state = await afterFirstSync(remote);
    const readmePath = 'Array/0217-contains-duplicate/README.md';
    const existing = remote.contents.get(readmePath) ?? '';
    const edited = existing.replace(
      '_Describe your approach here. LeetSensei keeps this section on every sync._',
      'Use a hash set and compare lengths.',
    );
    remote.contents.set(readmePath, edited);
    remote.shas.set(readmePath, await gitBlobSha1(edited));

    const outcome = await prepareSync({
      ...baseInput(state.manifest, remote),
      knownTrackerShas: state.knownTrackerShas,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.prepared.conflicts).toEqual([]);
    const comparison = outcome.prepared.comparisons.find((entry) => entry.path === readmePath);
    expect(comparison?.state).toBe('update');
    expect(comparison?.losslessMerge).toBe(true);
    expect(outcome.prepared.files.find((file) => file.path === readmePath)?.content).toContain(
      'Use a hash set and compare lengths.',
    );
  });

  it('never blocks on its own tracker backups', async () => {
    const remote = await makeRemote({
      [MANIFEST_PATH]:
        '{ "schemaVersion": 1, "generatedAt": "2000-01-01T00:00:00.000Z", "problems": {} }\n',
      [REVISIONS_PATH]:
        '{ "schemaVersion": 1, "generatedAt": "2000-01-01T00:00:00.000Z", "problems": {} }\n',
    });
    const outcome = await prepareSync(baseInput(createEmptyManifest(NOW), remote));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.prepared.conflicts).toEqual([]);
  });

  it('files an untagged submission under the fallback category', async () => {
    const outcome = await prepareSync(
      baseInput(createEmptyManifest(NOW), emptyRemote, makeRaw({ tags: [] })),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.prepared.submission.categories).toEqual(['Uncategorized']);
    expect(outcome.prepared.files.map((file) => file.path)).toContain(
      'Uncategorized/0217-contains-duplicate/solution.py',
    );
  });

  it('is idempotent for the same submission', async () => {
    const first = await prepareSync(baseInput(createEmptyManifest(NOW), emptyRemote));
    const second = await prepareSync(baseInput(createEmptyManifest(NOW), emptyRemote));
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.prepared.files).toEqual(first.prepared.files);
  });
});

describe('completeSync', () => {
  it('renders valid tracker backups and classifies them', async () => {
    const outcome = await prepareSync(baseInput(createEmptyManifest(NOW), emptyRemote));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const completed = await completeSync({
      submission: outcome.prepared.submission,
      manifest: createEmptyManifest(NOW),
      revisions: createEmptyRevisionStore(NOW),
      files: outcome.prepared.files,
      remoteFiles: emptyRemote.shas,
      knownTrackerShas: new Map(),
      nowIso: NOW,
    });

    expect(completed.trackerComparisons.map((entry) => entry.path)).toEqual([
      MANIFEST_PATH,
      REVISIONS_PATH,
    ]);
    expect(completed.trackerComparisons.every((entry) => !entry.requiresDecision)).toBe(true);

    const manifestBackup = completed.plan.trackerFiles.find((file) => file.path === MANIFEST_PATH);
    expect(validateManifest(JSON.parse(manifestBackup?.content ?? 'null')).ok).toBe(true);
    const revisionsBackup = completed.plan.trackerFiles.find(
      (file) => file.path === REVISIONS_PATH,
    );
    expect(validateRevisionStore(JSON.parse(revisionsBackup?.content ?? 'null')).ok).toBe(true);
  });

  it('includes a preserved version in the manifest it writes', async () => {
    const outcome = await prepareSync(baseInput(createEmptyManifest(NOW), emptyRemote));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const preservedFiles = [
      ...outcome.prepared.files,
      {
        path: 'Array/0217-contains-duplicate/solution.20240305-060708.py',
        category: 'Array',
        kind: 'solution' as const,
        language: 'python3',
        content: '# preserved\n',
        contentHash: 'h',
        blobSha: 'b',
        version: 2,
      },
    ];

    const completed = await completeSync({
      submission: outcome.prepared.submission,
      manifest: createEmptyManifest(NOW),
      revisions: createEmptyRevisionStore(NOW),
      files: preservedFiles,
      remoteFiles: emptyRemote.shas,
      knownTrackerShas: new Map(),
      nowIso: NOW,
    });

    const paths = completed.nextManifest.problems['0217']?.files.map((file) => file.path) ?? [];
    expect(paths).toContain('Array/0217-contains-duplicate/solution.20240305-060708.py');
  });
});

describe('manifest round trip', () => {
  it('reloads a written manifest without loss', async () => {
    const outcome = await prepareSync(baseInput(createEmptyManifest(NOW), emptyRemote));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const completed = await completeSync({
      submission: outcome.prepared.submission,
      manifest: makeManifest([
        makeProblem({ problemId: '9999', slug: '9999-old', titleSlug: 'old' }),
      ]),
      revisions: createEmptyRevisionStore(NOW),
      files: outcome.prepared.files,
      remoteFiles: emptyRemote.shas,
      knownTrackerShas: new Map(),
      nowIso: NOW,
    });
    const backup = completed.plan.trackerFiles.find((file) => file.path === MANIFEST_PATH);
    const parsed = validateManifest(JSON.parse(backup?.content ?? 'null'));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(Object.keys(parsed.value.problems).sort()).toEqual(['0217', '9999']);
    }
  });
});
