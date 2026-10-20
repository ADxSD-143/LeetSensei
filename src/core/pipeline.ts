import { toLeetSenseiError, type LeetSenseiError } from '../shared/errors';
import { classifyFile, type FileComparison } from './conflicts';
import { findManagedFile, type Manifest } from './manifest';
import type { NormalizedSubmission, PlannedFile } from './model';
import { normalizeSubmission } from './normalize';
import { finalizePlan, planContentFiles, type PlanResult } from './plan';
import { readmeMergeIsLossless } from './readme';
import { readmePath } from './paths';
import type { RevisionStore } from './revisions';
import type { RawSubmission } from './model';

/**
 * The sync pipeline: validate -> normalise -> plan -> compare.
 *
 * `prepareSync` is read-only apart from fetching README content. The caller
 * resolves conflicts, then `completeSync` renders the manifest and revision
 * backups and produces the final plan.
 */

export interface PrepareInput {
  raw: RawSubmission;
  manifest: Manifest;
  revisions: RevisionStore;
  /** Remote path -> Git blob id, from one recursive tree read. */
  remoteFiles: ReadonlyMap<string, string>;
  /** Path -> Git blob id of the tracker files LeetSensei last wrote. */
  knownTrackerShas: ReadonlyMap<string, string>;
  /** Fetches current repository content for a path, or null when absent. */
  readRemoteContent: (path: string) => Promise<string | null>;
  nowIso: string;
  fallbackCategory?: string;
  revisionIntervals?: readonly number[];
}

export interface PreparedSync {
  submission: NormalizedSubmission;
  files: PlannedFile[];
  comparisons: FileComparison[];
  conflicts: FileComparison[];
}

export type PrepareOutcome =
  { ok: true; prepared: PreparedSync } | { ok: false; error: LeetSenseiError };

export interface ClassifyArgs {
  files: PlannedFile[];
  manifest: Manifest;
  remoteFiles: ReadonlyMap<string, string>;
  knownTrackerShas: ReadonlyMap<string, string>;
  /** Content of remote files that were fetched, used for README merge checks. */
  knownContent?: ReadonlyMap<string, string>;
}

function knownBlobShaFor(
  path: string,
  kind: PlannedFile['kind'],
  args: ClassifyArgs,
): string | null {
  if (kind === 'manifest' || kind === 'revisions') {
    return args.knownTrackerShas.get(path) ?? null;
  }
  return findManagedFile(args.manifest, path)?.file.blobSha ?? null;
}

export function classifyPlannedFiles(args: ClassifyArgs): FileComparison[] {
  return args.files.map((file) => {
    const owned = file.kind === 'manifest' || file.kind === 'revisions';
    const existing = args.knownContent?.get(file.path);
    const losslessMerge =
      !owned &&
      file.kind === 'readme' &&
      existing !== undefined &&
      readmeMergeIsLossless(existing, file.content);
    return classifyFile({
      file,
      remoteBlobSha: args.remoteFiles.get(file.path) ?? null,
      knownBlobSha: knownBlobShaFor(file.path, file.kind, args),
      losslessMerge,
      owned,
    });
  });
}

export async function prepareSync(input: PrepareInput): Promise<PrepareOutcome> {
  try {
    const submission = await normalizeSubmission(input.raw, {
      ...(input.fallbackCategory === undefined ? {} : { fallbackCategory: input.fallbackCategory }),
    });

    const existingContent = new Map<string, string>();
    for (const category of submission.categories) {
      const path = readmePath(category, submission.slug);
      const content = await input.readRemoteContent(path);
      if (content !== null) existingContent.set(path, content);
    }

    const content = await planContentFiles({
      submission,
      existingContent,
      nowIso: input.nowIso,
    });

    const comparisons = classifyPlannedFiles({
      files: content.files,
      manifest: input.manifest,
      remoteFiles: input.remoteFiles,
      knownTrackerShas: input.knownTrackerShas,
      knownContent: existingContent,
    });

    return {
      ok: true,
      prepared: {
        submission,
        files: content.files,
        comparisons,
        conflicts: comparisons.filter((comparison) => comparison.requiresDecision),
      },
    };
  } catch (error) {
    return { ok: false, error: toLeetSenseiError(error) };
  }
}

export interface CompleteInput {
  submission: NormalizedSubmission;
  manifest: Manifest;
  revisions: RevisionStore;
  files: PlannedFile[];
  remoteFiles: ReadonlyMap<string, string>;
  knownTrackerShas: ReadonlyMap<string, string>;
  nowIso: string;
  revisionIntervals?: readonly number[];
}

export interface CompletedSync extends PlanResult {
  trackerComparisons: FileComparison[];
  allComparisons: FileComparison[];
}

/** Renders the tracker backups and re-classifies every path in the final plan. */
export async function completeSync(input: CompleteInput): Promise<CompletedSync> {
  const result = await finalizePlan({
    submission: input.submission,
    manifest: input.manifest,
    revisions: input.revisions,
    files: input.files,
    nowIso: input.nowIso,
    ...(input.revisionIntervals ? { revisionIntervals: input.revisionIntervals } : {}),
  });

  const trackerComparisons = classifyPlannedFiles({
    files: result.plan.trackerFiles,
    manifest: input.manifest,
    remoteFiles: input.remoteFiles,
    knownTrackerShas: input.knownTrackerShas,
  });

  const allComparisons = [
    ...classifyPlannedFiles({
      files: result.plan.files,
      manifest: input.manifest,
      remoteFiles: input.remoteFiles,
      knownTrackerShas: input.knownTrackerShas,
    }),
    ...trackerComparisons,
  ];

  return { ...result, trackerComparisons, allComparisons };
}
