import type { PlannedFile, SyncPlan } from './model';
import { hashedFile, createContentHasher } from './plan';
import type { ConflictDecision } from './conflicts';
import { versionStamp, versionedPath } from './paths';

/**
 * Conflict resolution.
 *
 * - `replace`      overwrite the managed path with the new content (explicit
 *                  user confirmation required upstream).
 * - `save-version` keep the repository's current content and write it to a
 *                  deterministic versioned sibling name, then update the
 *                  canonical path.
 * - `cancel`       leave the repository file untouched and skip the path.
 *
 * A preserved version is always derived from the remote bytes, so nothing the
 * user edited can be lost.
 */

export interface ResolveInput {
  files: PlannedFile[];
  path: string;
  decision: ConflictDecision;
  /** Current repository content of the conflicting file, if it was fetched. */
  remoteContent: string | null;
  /** Paths already present locally or remotely; used to avoid name collisions. */
  taken: ReadonlySet<string>;
  /** Deterministic stamp source, normally the submission timestamp. */
  stampSourceIso: string | null;
  nowIso: string;
}

export interface ResolveOutcome {
  files: PlannedFile[];
  skipped: string[];
  preservedPath: string | null;
}

export async function applyConflictDecision(input: ResolveInput): Promise<ResolveOutcome> {
  const { files, path, decision, remoteContent, taken } = input;
  const index = files.findIndex((file) => file.path === path);
  if (index < 0) {
    return { files, skipped: [], preservedPath: null };
  }
  const file = files[index];
  if (file === undefined) {
    return { files, skipped: [], preservedPath: null };
  }

  if (decision === 'cancel') {
    return {
      files: files.filter((candidate) => candidate.path !== path),
      skipped: [path],
      preservedPath: null,
    };
  }

  if (decision === 'replace' || remoteContent === null) {
    return { files, skipped: [], preservedPath: null };
  }

  const stamp = versionStamp(input.stampSourceIso, input.nowIso);
  const preservationPaths = new Set(taken);
  for (const candidate of files) preservationPaths.add(candidate.path);
  const preservedPath = versionedPath(path, stamp, preservationPaths);

  const hasher = createContentHasher();
  const preserved = await hashedFile(
    {
      path: preservedPath,
      category: file.category,
      kind: file.kind,
      language: file.language,
      content: remoteContent,
      version: file.version + 1,
    },
    hasher,
  );

  const nextFiles = [...files, preserved].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  return { files: nextFiles, skipped: [], preservedPath };
}

/** Files that still require a decision after some paths have been resolved. */
export function unresolvedConflicts(
  plan: Pick<SyncPlan, 'files' | 'trackerFiles'>,
  pending: readonly string[],
): string[] {
  const planned = new Set([...plan.files, ...plan.trackerFiles].map((file) => file.path));
  return pending.filter((path) => planned.has(path));
}
