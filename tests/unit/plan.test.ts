import { describe, expect, it } from 'vitest';
import { createEmptyManifest } from '../../src/core/manifest';
import { buildSyncPlan, dedupeLanguages, planContentFiles } from '../../src/core/plan';
import { MANIFEST_PATH, REVISIONS_PATH } from '../../src/core/paths';
import { createEmptyRevisionStore, validateRevisionStore } from '../../src/core/revisions';
import { validateManifest } from '../../src/core/manifest';
import { NOW, makeManifest, makeProblem, makeSubmission } from '../helpers';

const noRemote = new Map<string, string>();

describe('dedupeLanguages', () => {
  it('reduces a submission to one file per extension', async () => {
    const submission = await makeSubmission();
    expect(dedupeLanguages(submission)).toEqual([
      { id: 'python3', label: 'Python 3', extension: 'py' },
    ]);
  });
});

describe('planContentFiles', () => {
  it('creates a README and a solution in every applicable category', async () => {
    const submission = await makeSubmission();
    const { files, languages } = await planContentFiles({
      submission,
      existingContent: noRemote,
      nowIso: NOW,
    });

    expect(languages).toHaveLength(1);
    const paths = files.map((file) => file.path);
    expect(paths).toEqual([
      'Array/0217-contains-duplicate/README.md',
      'Array/0217-contains-duplicate/solution.py',
      'Hash-Table/0217-contains-duplicate/README.md',
      'Hash-Table/0217-contains-duplicate/solution.py',
    ]);
  });

  it('generates all category copies from one canonical record', async () => {
    const submission = await makeSubmission();
    const { files } = await planContentFiles({
      submission,
      existingContent: noRemote,
      nowIso: NOW,
    });
    const readmes = files.filter((file) => file.kind === 'readme');
    const solutions = files.filter((file) => file.kind === 'solution');
    expect(new Set(readmes.map((file) => file.contentHash)).size).toBe(1);
    expect(new Set(readmes.map((file) => file.blobSha)).size).toBe(1);
    expect(new Set(solutions.map((file) => file.blobSha)).size).toBe(1);
    expect(solutions[0]?.content).toBe(submission.code);
  });

  it('is deterministic across runs', async () => {
    const submission = await makeSubmission();
    const first = await planContentFiles({ submission, existingContent: noRemote, nowIso: NOW });
    const second = await planContentFiles({ submission, existingContent: noRemote, nowIso: NOW });
    expect(first.files).toEqual(second.files);
  });

  it('merges existing README content instead of overwriting it', async () => {
    const submission = await makeSubmission();
    const fresh = await planContentFiles({ submission, existingContent: noRemote, nowIso: NOW });
    const path = 'Array/0217-contains-duplicate/README.md';
    const original = fresh.files.find((file) => file.path === path)?.content ?? '';
    const edited = original.replace(
      '_Describe your approach here. LeetSensei keeps this section on every sync._',
      'Sliding window.',
    );

    const merged = await planContentFiles({
      submission,
      existingContent: new Map([[path, edited]]),
      nowIso: NOW,
    });
    expect(merged.files.find((file) => file.path === path)?.content).toContain('Sliding window.');
  });

  it('flags incomplete metadata through the generated README', async () => {
    const submission = await makeSubmission({ tags: [], difficulty: null, problemId: null });
    const { files } = await planContentFiles({
      submission,
      existingContent: noRemote,
      nowIso: NOW,
    });
    expect(files[0]?.path).toBe('Uncategorized/contains-duplicate/README.md');
    expect(files[0]?.content).toContain('Metadata warning');
  });
});

describe('buildSyncPlan', () => {
  it('produces content and tracker files', async () => {
    const submission = await makeSubmission();
    const result = await buildSyncPlan({
      submission,
      manifest: createEmptyManifest(NOW),
      revisions: createEmptyRevisionStore(NOW),
      existingContent: noRemote,
      nowIso: NOW,
    });

    expect(result.plan.files).toHaveLength(4);
    expect(result.plan.trackerFiles.map((file) => file.path)).toEqual([
      MANIFEST_PATH,
      REVISIONS_PATH,
    ]);
    expect(result.plan.newCategories).toEqual(['Array', 'Hash-Table']);
    expect(result.plan.retainedCategories).toEqual([]);
  });

  it('records the problem in the manifest backup', async () => {
    const submission = await makeSubmission();
    const result = await buildSyncPlan({
      submission,
      manifest: createEmptyManifest(NOW),
      revisions: createEmptyRevisionStore(NOW),
      existingContent: noRemote,
      nowIso: NOW,
    });

    const manifestBackup = result.plan.trackerFiles.find((file) => file.path === MANIFEST_PATH);
    const parsed = validateManifest(JSON.parse(manifestBackup?.content ?? 'null'));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const problem = parsed.value.problems['0217'];
      expect(problem?.files).toHaveLength(4);
      expect(problem?.categories).toEqual(['Array', 'Hash-Table']);
      expect(problem?.lastSyncedSubmissionId).toBe('123456789');
    }
    expect(result.nextManifest.problems['0217']).toBeDefined();
  });

  it('schedules a first revision', async () => {
    const submission = await makeSubmission();
    const result = await buildSyncPlan({
      submission,
      manifest: createEmptyManifest(NOW),
      revisions: createEmptyRevisionStore(NOW),
      existingContent: noRemote,
      nowIso: NOW,
    });
    const record = result.nextRevisions.problems['0217'];
    expect(record?.nextReviewAt).toBe('2024-03-06T06:07:08.000Z');
    expect(validateRevisionStore(result.nextRevisions).ok).toBe(true);
  });

  it('does not reset an existing revision schedule', async () => {
    const submission = await makeSubmission();
    const revisions = createEmptyRevisionStore(NOW);
    revisions.problems['0217'] = {
      problemId: '0217',
      slug: submission.slug,
      title: submission.title,
      lastReviewedAt: NOW,
      nextReviewAt: '2024-05-01T00:00:00.000Z',
      currentIntervalDays: 30,
      successfulReviews: 4,
      history: [],
    };
    const result = await buildSyncPlan({
      submission,
      manifest: createEmptyManifest(NOW),
      revisions,
      existingContent: noRemote,
      nowIso: NOW,
    });
    expect(result.nextRevisions.problems['0217']?.nextReviewAt).toBe('2024-05-01T00:00:00.000Z');
  });

  it('keeps obsolete category copies and reports them', async () => {
    const submission = await makeSubmission();
    const manifest = makeManifest([
      makeProblem({
        categories: ['Array', 'Hash-Table', 'Old-Tag'],
        files: [
          ...makeProblem().files,
          {
            path: 'Old-Tag/0217-contains-duplicate/solution.py',
            category: 'Old-Tag',
            kind: 'solution',
            language: 'python3',
            hash: 'h',
            blobSha: 'b',
            version: 1,
          },
        ],
      }),
    ]);

    const result = await buildSyncPlan({
      submission,
      manifest,
      revisions: createEmptyRevisionStore(NOW),
      existingContent: noRemote,
      nowIso: NOW,
    });

    expect(result.plan.newCategories).toEqual([]);
    expect(result.plan.retainedCategories).toEqual(['Old-Tag']);
    expect(result.plan.warnings.join(' ')).toMatch(/Kept earlier category copies/);
    const paths = result.nextManifest.problems['0217']?.files.map((file) => file.path) ?? [];
    expect(paths).toContain('Old-Tag/0217-contains-duplicate/solution.py');
  });

  it('accumulates a second language for the same problem', async () => {
    const python = await makeSubmission();
    const first = await buildSyncPlan({
      submission: python,
      manifest: createEmptyManifest(NOW),
      revisions: createEmptyRevisionStore(NOW),
      existingContent: noRemote,
      nowIso: NOW,
    });

    const cpp = await makeSubmission({
      submissionId: '987654321',
      language: 'cpp',
      code: 'class Solution {\npublic:\n  bool containsDuplicate(vector<int>& v) { return false; }\n};\n',
    });
    const second = await buildSyncPlan({
      submission: cpp,
      manifest: first.nextManifest,
      revisions: first.nextRevisions,
      existingContent: noRemote,
      nowIso: NOW,
    });

    const paths = second.nextManifest.problems['0217']?.files.map((file) => file.path) ?? [];
    expect(paths).toContain('Array/0217-contains-duplicate/solution.py');
    expect(paths).toContain('Array/0217-contains-duplicate/solution.cpp');
    expect(second.nextManifest.problems['0217']?.languages.sort()).toEqual(['cpp', 'python3']);
  });

  it('never plans a deletion', async () => {
    const submission = await makeSubmission();
    const result = await buildSyncPlan({
      submission,
      manifest: createEmptyManifest(NOW),
      revisions: createEmptyRevisionStore(NOW),
      existingContent: noRemote,
      nowIso: NOW,
    });
    expect(JSON.stringify(result.plan)).not.toMatch(/delet/i);
  });
});
