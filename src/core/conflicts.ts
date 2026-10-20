import type { PlannedFile } from './model';

/**
 * Conflict classification.
 *
 * LeetSensei compares three hashes for every planned path:
 *
 * - `planned`  — what we are about to write
 * - `known`    — what our manifest says we last wrote
 * - `remote`   — what the repository currently holds
 *
 * Anything the user changed after our last sync, and anything we never wrote,
 * requires an explicit decision. Nothing is ever silently overwritten.
 */

export type FileState = 'new' | 'unchanged' | 'update' | 'remote-modified' | 'unmanaged-existing';

export interface FileComparison {
  path: string;
  kind: PlannedFile['kind'];
  state: FileState;
  /** True when the user must choose before this file can be written. */
  requiresDecision: boolean;
  plannedBlobSha: string;
  knownBlobSha: string | null;
  remoteBlobSha: string | null;
  /** True when a README merge provably preserved every user section. */
  losslessMerge: boolean;
  message: string;
}

export interface ClassifyInput {
  file: Pick<PlannedFile, 'path' | 'blobSha' | 'kind'>;
  remoteBlobSha: string | null;
  knownBlobSha: string | null;
  /** Set for README files once the merge has been verified as lossless. */
  losslessMerge?: boolean;
  /**
   * Marks a file LeetSensei itself owns (the `.leetcode-tracker` backups).
   * Those files are machine state, not user content, so a difference never
   * blocks the sync: the backup is simply refreshed.
   */
  owned?: boolean;
}

export function classifyFile(input: ClassifyInput): FileComparison {
  const { file, remoteBlobSha, knownBlobSha } = input;
  const losslessMerge = input.losslessMerge ?? false;
  const base = {
    path: file.path,
    kind: file.kind,
    plannedBlobSha: file.blobSha,
    knownBlobSha,
    remoteBlobSha,
    losslessMerge,
  };

  if (input.owned === true) {
    if (remoteBlobSha === null) {
      return { ...base, state: 'new', requiresDecision: false, message: 'New tracker backup.' };
    }
    if (remoteBlobSha === file.blobSha) {
      return {
        ...base,
        state: 'unchanged',
        requiresDecision: false,
        message: 'Tracker backup already current.',
      };
    }
    return {
      ...base,
      state: 'update',
      requiresDecision: false,
      message: 'LeetSensei-owned tracker backup will be refreshed.',
    };
  }

  if (knownBlobSha === null) {
    if (remoteBlobSha === null) {
      return { ...base, state: 'new', requiresDecision: false, message: 'New file.' };
    }
    if (remoteBlobSha === file.blobSha) {
      return {
        ...base,
        state: 'unchanged',
        requiresDecision: false,
        message: 'Identical content already exists in the repository.',
      };
    }
    return {
      ...base,
      state: 'unmanaged-existing',
      requiresDecision: true,
      message: 'A file LeetSensei did not create already exists at this path.',
    };
  }

  if (remoteBlobSha === null) {
    return {
      ...base,
      state: 'update',
      requiresDecision: false,
      message: 'The remote file was removed; it will be recreated from the manifest.',
    };
  }

  if (remoteBlobSha !== knownBlobSha) {
    if (losslessMerge) {
      return {
        ...base,
        state: 'update',
        requiresDecision: false,
        message: 'Remote edits were preserved by the README merge; only managed sections change.',
      };
    }
    return {
      ...base,
      state: 'remote-modified',
      requiresDecision: true,
      message: 'This file changed in the repository since the last sync.',
    };
  }

  if (remoteBlobSha === file.blobSha) {
    return {
      ...base,
      state: 'unchanged',
      requiresDecision: false,
      message: 'Already up to date.',
    };
  }

  return {
    ...base,
    state: 'update',
    requiresDecision: false,
    message: 'Managed file will be updated.',
  };
}

export interface ComparisonSummary {
  newFiles: number;
  updates: number;
  unchanged: number;
  conflicts: number;
  comparisons: FileComparison[];
  byPath: Map<string, FileComparison>;
}

export function summarizeComparisons(comparisons: readonly FileComparison[]): ComparisonSummary {
  const summary: ComparisonSummary = {
    newFiles: 0,
    updates: 0,
    unchanged: 0,
    conflicts: 0,
    comparisons: [...comparisons],
    byPath: new Map(comparisons.map((comparison) => [comparison.path, comparison])),
  };
  for (const comparison of comparisons) {
    if (comparison.requiresDecision) summary.conflicts += 1;
    else if (comparison.state === 'new') summary.newFiles += 1;
    else if (comparison.state === 'unchanged') summary.unchanged += 1;
    else summary.updates += 1;
  }
  return summary;
}

export type ConflictDecision = 'replace' | 'save-version' | 'cancel';

export function isConflictDecision(value: unknown): value is ConflictDecision {
  return value === 'replace' || value === 'save-version' || value === 'cancel';
}
