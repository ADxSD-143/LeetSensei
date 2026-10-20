import { LeetSenseiError, toLeetSenseiError } from '../shared/errors';
import { createLogger } from '../shared/logger';
import type { GithubClient, RepoRef } from './types';

/**
 * Groups one submission's file changes into a single commit.
 *
 * Git data API only:
 *   blob(s) -> tree (based on the branch's current tree) -> commit -> update ref
 *
 * Everything is content addressed, so re-running a partially applied sync is
 * harmless: identical content produces identical blob ids, identical paths
 * produce an identical tree, and an already up-to-date tree is skipped.
 * `force` is never set, so branch history is never rewritten.
 *
 * A retryable failure anywhere re-reads the branch tip and rebuilds the commit,
 * which is what makes a lost API response or a concurrent push safe to retry.
 * A write that cannot be confirmed is reported as `verified: false` - never as
 * a success.
 */

const logger = createLogger('github:commit');

export interface CommitFile {
  path: string;
  content: string;
  blobSha: string;
}

export interface CommitInput {
  client: GithubClient;
  ref: RepoRef;
  message: string;
  files: CommitFile[];
  /** Path -> blob id currently in the remote tree. */
  remoteFiles: ReadonlyMap<string, string>;
  maxAttempts?: number;
}

export interface CommitOutcome {
  committed: boolean;
  commitSha: string | null;
  treeSha: string;
  writtenPaths: string[];
  skippedPaths: string[];
  /** False when the write happened but the branch could not confirm it. */
  verified: boolean;
  attempts: number;
}

type AttemptResult =
  | { kind: 'done'; outcome: CommitOutcome }
  | {
      kind: 'unconfirmed';
      commitSha: string;
      treeSha: string;
      writtenPaths: string[];
      skippedPaths: string[];
    };

async function isCommitOnBranch(
  client: GithubClient,
  ref: RepoRef,
  commitSha: string,
): Promise<boolean> {
  const head = await client.getBranchSha(ref);
  if (head === null) return false;
  if (head === commitSha) return true;
  return client.isAncestor(ref, commitSha);
}

export async function commitFiles(input: CommitInput): Promise<CommitOutcome> {
  const maxAttempts = Math.max(1, input.maxAttempts ?? 3);
  let lastError: LeetSenseiError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await attemptCommit(input, attempt);
      if (result.kind === 'done') return result.outcome;

      if (attempt >= maxAttempts) {
        return {
          committed: true,
          commitSha: result.commitSha,
          treeSha: result.treeSha,
          writtenPaths: result.writtenPaths,
          skippedPaths: result.skippedPaths,
          verified: false,
          attempts: attempt,
        };
      }
      lastError = new LeetSenseiError(
        'remote_changed',
        'The branch moved before the commit could be confirmed; retrying against the latest commit.',
        { retryable: true },
      );
      logger.warn(
        `commit not confirmed on the branch; retrying (attempt ${attempt}/${maxAttempts})`,
      );
    } catch (error) {
      const known = toLeetSenseiError(error);
      if (!known.retryable || attempt >= maxAttempts) throw known;
      lastError = known;
      logger.warn(`retrying commit after ${known.code} (attempt ${attempt}/${maxAttempts})`);
    }
  }

  throw (
    lastError ??
    new LeetSenseiError('remote_changed', 'The branch kept changing while LeetSensei was writing.')
  );
}

async function attemptCommit(input: CommitInput, attempt: number): Promise<AttemptResult> {
  const headSha = await input.client.getBranchSha(input.ref);
  if (headSha === null) {
    throw new LeetSenseiError(
      'not_found',
      `The branch "${input.ref.branch}" does not exist in ${input.ref.owner}/${input.ref.repo}. Create it on GitHub or choose another branch.`,
    );
  }
  const baseTreeSha = await input.client.getCommitTreeSha(input.ref, headSha);

  const changed = input.files.filter((file) => input.remoteFiles.get(file.path) !== file.blobSha);
  const skippedPaths = input.files
    .filter((file) => input.remoteFiles.get(file.path) === file.blobSha)
    .map((file) => file.path);

  if (changed.length === 0) {
    return {
      kind: 'done',
      outcome: {
        committed: false,
        commitSha: null,
        treeSha: baseTreeSha,
        writtenPaths: [],
        skippedPaths,
        verified: true,
        attempts: attempt,
      },
    };
  }

  // Git blob ids are content addresses, so identical files across category
  // copies share one upload.
  const blobIds = new Map<string, string>();
  for (const file of changed) {
    if (blobIds.has(file.blobSha)) continue;
    blobIds.set(file.blobSha, await input.client.createBlob(input.ref, file.content));
  }

  const treeSha = await input.client.createTree(
    input.ref,
    baseTreeSha,
    changed.map((file) => ({
      path: file.path,
      blobSha: blobIds.get(file.blobSha) ?? file.blobSha,
    })),
  );
  const commit = await input.client.createCommit(input.ref, input.message, treeSha, [headSha]);
  await input.client.updateBranch(input.ref, commit.commitSha);

  const writtenPaths = changed.map((file) => file.path);
  const verified = await isCommitOnBranch(input.client, input.ref, commit.commitSha);
  if (!verified) {
    return {
      kind: 'unconfirmed',
      commitSha: commit.commitSha,
      treeSha,
      writtenPaths,
      skippedPaths,
    };
  }

  return {
    kind: 'done',
    outcome: {
      committed: true,
      commitSha: commit.commitSha,
      treeSha,
      writtenPaths,
      skippedPaths,
      verified: true,
      attempts: attempt,
    },
  };
}
