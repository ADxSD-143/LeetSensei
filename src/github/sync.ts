import { LeetSenseiError } from '../shared/errors';
import type { PlannedFile, SyncPlan } from '../core/model';
import { commitFiles, type CommitOutcome } from './commit';
import type { GithubClient, RemoteTree, RepoRef } from './types';

/** Reads the branch tip and its full blob map in two requests. */
export async function loadRemoteTree(client: GithubClient, ref: RepoRef): Promise<RemoteTree> {
  const headSha = await client.getBranchSha(ref);
  if (headSha === null) {
    throw new LeetSenseiError(
      'not_found',
      `The branch "${ref.branch}" does not exist in ${ref.owner}/${ref.repo}.`,
    );
  }
  return client.getRemoteTree(ref, headSha);
}

/** Git commit message for one Accepted submission. */
export function buildCommitMessage(plan: SyncPlan): string {
  const lines = [
    `Add ${plan.slug} (${plan.categories.join(', ') || 'uncategorized'})`,
    '',
    'Synced from an Accepted LeetCode submission.',
    `Problem: ${plan.title}`,
  ];
  if (plan.newCategories.length > 0) {
    lines.push(`New categories: ${plan.newCategories.join(', ')}`);
  }
  lines.push(`Submission: ${plan.submissionId}`);
  if (plan.metadataIncomplete) {
    lines.push('Note: LeetCode returned incomplete metadata for this problem.');
  }
  return lines.join('\n');
}

export interface PushPlanInput {
  client: GithubClient;
  ref: RepoRef;
  plan: SyncPlan;
  /** Paths the user did not cancel; others are left untouched. */
  includePath: (path: string) => boolean;
  remoteFiles: ReadonlyMap<string, string>;
  message?: string;
  maxAttempts?: number;
}

export interface PushPlanOutcome extends CommitOutcome {
  /** Remote blob map updated with everything that was just written. */
  remoteFiles: Map<string, string>;
  skippedByDecision: string[];
}

/**
 * Writes exactly the files the user approved, as one commit.
 *
 * The remote blob map is refreshed in place with the written blob ids so the
 * caller's next comparison is accurate without another tree read.
 */
export async function pushPlan(input: PushPlanInput): Promise<PushPlanOutcome> {
  const all: PlannedFile[] = [...input.plan.files, ...input.plan.trackerFiles];
  const included = all.filter((file) => input.includePath(file.path));
  const skippedByDecision = all
    .filter((file) => !input.includePath(file.path))
    .map((file) => file.path);

  const outcome = await commitFiles({
    client: input.client,
    ref: input.ref,
    message: input.message ?? buildCommitMessage(input.plan),
    files: included.map((file) => ({
      path: file.path,
      content: file.content,
      blobSha: file.blobSha,
    })),
    remoteFiles: input.remoteFiles,
    ...(input.maxAttempts === undefined ? {} : { maxAttempts: input.maxAttempts }),
  });

  const remoteFiles = new Map(input.remoteFiles);
  const written = new Set(outcome.writtenPaths);
  for (const file of included) {
    if (written.has(file.path)) remoteFiles.set(file.path, file.blobSha);
  }

  return { ...outcome, remoteFiles, skippedByDecision };
}
