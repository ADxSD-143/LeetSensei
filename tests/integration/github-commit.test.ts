import { describe, expect, it } from 'vitest';
import { commitFiles } from '../../src/github/commit';
import { buildCommitMessage, loadRemoteTree, pushPlan } from '../../src/github/sync';
import { gitBlobSha1 } from '../../src/shared/hash';
import { NOW, makeSubmission } from '../helpers';
import { FakeGithubClient } from '../fake-github';

async function contentFile(path: string, content: string) {
  return { path, content, blobSha: await gitBlobSha1(content) };
}

describe('commitFiles', () => {
  it('creates one commit containing every changed file', async () => {
    const client = new FakeGithubClient();
    const files = [
      await contentFile('Arrays/0217-x/solution.py', 'a\n'),
      await contentFile('Arrays/0217-x/README.md', 'readme\n'),
      await contentFile('Hash-Table/0217-x/solution.py', 'a\n'),
    ];

    const outcome = await commitFiles({
      client,
      ref: client.ref,
      message: 'Add problem',
      files,
      remoteFiles: new Map(),
    });

    expect(outcome.committed).toBe(true);
    expect(outcome.verified).toBe(true);
    expect(outcome.writtenPaths).toHaveLength(3);
    expect(client.commitCount()).toBe(2); // seeded plus ours
    expect(client.contentOf('Hash-Table/0217-x/solution.py')).toBe('a\n');
  });

  it('uploads one blob per distinct content', async () => {
    const client = new FakeGithubClient();
    const files = [
      await contentFile('A/x/solution.py', 'same\n'),
      await contentFile('B/x/solution.py', 'same\n'),
      await contentFile('B/x/README.md', 'other\n'),
    ];
    await commitFiles({ client, ref: client.ref, message: 'm', files, remoteFiles: new Map() });
    expect(client.calls.filter((call) => call === 'createBlob')).toHaveLength(2);
  });

  it('does nothing when every file already matches', async () => {
    const client = new FakeGithubClient();
    const files = [await contentFile('A/x/solution.py', 'a\n')];
    await commitFiles({ client, ref: client.ref, message: 'm', files, remoteFiles: new Map() });

    const second = await commitFiles({
      client,
      ref: client.ref,
      message: 'm',
      files,
      remoteFiles: new Map(files.map((file) => [file.path, file.blobSha])),
    });
    expect(second.committed).toBe(false);
    expect(second.skippedPaths).toEqual(['A/x/solution.py']);
    expect(second.verified).toBe(true);
  });

  it('is idempotent: retrying the same files creates no new commit', async () => {
    const client = new FakeGithubClient();
    const files = [await contentFile('A/x/solution.py', 'a\n')];
    await commitFiles({ client, ref: client.ref, message: 'm', files, remoteFiles: new Map() });
    const commitsAfterFirst = client.commitCount();

    const second = await commitFiles({
      client,
      ref: client.ref,
      message: 'm',
      files,
      remoteFiles: client.files,
    });
    expect(second.committed).toBe(false);
    expect(client.commitCount()).toBe(commitsAfterFirst);
  });

  it('retries after the ref moves and then succeeds', async () => {
    const client = new FakeGithubClient();
    client.conflictOnUpdate = 1;
    const files = [await contentFile('A/x/solution.py', 'a\n')];
    const outcome = await commitFiles({
      client,
      ref: client.ref,
      message: 'm',
      files,
      remoteFiles: new Map(),
    });
    expect(outcome.attempts).toBe(2);
    expect(outcome.verified).toBe(true);
  });

  it('rebases onto a commit pushed by someone else', async () => {
    const client = new FakeGithubClient();
    await client.seedFile('Notes/readme.md', 'user notes\n');
    client.pushBeforeUpdate = () => {
      // Another actor pushes while we are building the commit.
      const treeSha = `tree-extra`;
      client.trees.set(treeSha, new Map(client.files));
      const sha = `commit-concurrent`;
      client.commits.set(sha, {
        sha,
        treeSha,
        parents: client.head === null ? [] : [client.head],
        message: 'Someone else',
      });
      client.head = sha;
    };

    const files = [await contentFile('A/x/solution.py', 'a\n')];
    const outcome = await commitFiles({
      client,
      ref: client.ref,
      message: 'm',
      files,
      remoteFiles: new Map(),
    });

    expect(outcome.verified).toBe(true);
    expect(outcome.attempts).toBeGreaterThanOrEqual(2);
    expect(client.contentOf('Notes/readme.md')).toBe('user notes\n');
    expect(client.contentOf('A/x/solution.py')).toBe('a\n');
  });

  it('reports an unverified write instead of claiming success', async () => {
    const client = new FakeGithubClient();
    client.hideCommitFromBranch = true;
    const files = [await contentFile('A/x/solution.py', 'a\n')];
    const outcome = await commitFiles({
      client,
      ref: client.ref,
      message: 'm',
      files,
      remoteFiles: new Map(),
      maxAttempts: 2,
    });
    expect(outcome.verified).toBe(false);
    expect(outcome.attempts).toBe(2);
  });

  it('fails clearly when the branch does not exist', async () => {
    const client = new FakeGithubClient();
    client.branches = [];
    await expect(
      commitFiles({
        client,
        ref: client.ref,
        message: 'm',
        files: [await contentFile('A/x/solution.py', 'a\n')],
        remoteFiles: new Map(),
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('retries a transient network failure', async () => {
    const client = new FakeGithubClient();
    client.networkFailures = 1;
    const outcome = await commitFiles({
      client,
      ref: client.ref,
      message: 'm',
      files: [await contentFile('A/x/solution.py', 'a\n')],
      remoteFiles: new Map(),
    });
    expect(outcome.committed).toBe(true);
  });

  it('never rewrites branch history', async () => {
    const client = new FakeGithubClient();
    const before = client.head;
    await commitFiles({
      client,
      ref: client.ref,
      message: 'm',
      files: [await contentFile('A/x/solution.py', 'a\n')],
      remoteFiles: new Map(),
    });
    const newest = client.head;
    expect(newest).not.toBe(before);
    expect(newest !== null && client.commits.get(newest)?.parents).toEqual([before]);
  });
});

describe('loadRemoteTree', () => {
  it('reads the branch tip and its blobs', async () => {
    const client = new FakeGithubClient();
    await client.seedFile('Arrays/0217-x/solution.py', 'code\n');
    const tree = await loadRemoteTree(client, client.ref);
    expect(tree.files.has('Arrays/0217-x/solution.py')).toBe(true);
    expect(tree.truncated).toBe(false);
  });

  it('fails clearly when the branch is missing', async () => {
    const client = new FakeGithubClient();
    client.branches = [];
    await expect(loadRemoteTree(client, client.ref)).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('pushPlan', () => {
  it('writes only the approved paths', async () => {
    const submission = await makeSubmission();
    const plan = {
      submissionId: submission.submissionId,
      problemId: submission.problemId,
      slug: submission.slug,
      title: submission.title,
      categories: submission.categories,
      newCategories: submission.categories,
      retainedCategories: [],
      metadataIncomplete: false,
      warnings: [],
      trackerFiles: [],
      files: [
        await contentFile('Array/0217-x/solution.py', 'a\n'),
        await contentFile('Hash-Table/0217-x/solution.py', 'a\n'),
      ].map((file) => ({
        ...file,
        category: file.path.split('/')[0] ?? null,
        kind: 'solution' as const,
        language: 'python3',
        contentHash: 'h',
        version: 1,
      })),
    };

    const client = new FakeGithubClient();
    const outcome = await pushPlan({
      client,
      ref: client.ref,
      plan,
      includePath: (path) => path.startsWith('Array/'),
      remoteFiles: new Map(),
    });

    expect(outcome.writtenPaths).toEqual(['Array/0217-x/solution.py']);
    expect(outcome.skippedByDecision).toEqual(['Hash-Table/0217-x/solution.py']);
    expect(client.contentOf('Hash-Table/0217-x/solution.py')).toBeNull();
  });

  it('returns an updated remote map for the caller', async () => {
    const client = new FakeGithubClient();
    const file = await contentFile('A/x/solution.py', 'a\n');
    const plan = {
      submissionId: '1',
      problemId: '0217',
      slug: '0217-x',
      title: 'X',
      categories: ['A'],
      newCategories: ['A'],
      retainedCategories: [],
      metadataIncomplete: false,
      warnings: [],
      trackerFiles: [],
      files: [
        {
          ...file,
          category: 'A',
          kind: 'solution' as const,
          language: 'python3',
          contentHash: 'h',
          version: 1,
        },
      ],
    };
    const outcome = await pushPlan({
      client,
      ref: client.ref,
      plan,
      includePath: () => true,
      remoteFiles: new Map(),
    });
    expect(outcome.remoteFiles.get('A/x/solution.py')).toBe(file.blobSha);
  });
});

describe('buildCommitMessage', () => {
  it('describes the submission without leaking anything', async () => {
    const submission = await makeSubmission();
    const message = buildCommitMessage({
      submissionId: submission.submissionId,
      problemId: submission.problemId,
      slug: submission.slug,
      title: submission.title,
      categories: submission.categories,
      newCategories: ['Hash-Table'],
      retainedCategories: [],
      metadataIncomplete: false,
      warnings: [],
      files: [],
      trackerFiles: [],
    });
    expect(message).toContain('Add 0217-contains-duplicate');
    expect(message).toContain('Accepted LeetCode submission');
    expect(message).toContain('New categories: Hash-Table');
    expect(message).not.toMatch(/token|gho_/i);
    void NOW;
  });
});
