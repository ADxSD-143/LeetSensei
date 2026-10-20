import { gitBlobSha1, sha256Hex } from '../shared/hash';
import { upsertProblem, type Manifest, type ManifestFile, type ManifestProblem } from './manifest';
import type { LanguageInfo, NormalizedSubmission, PlannedFile, SyncPlan } from './model';
import { MANIFEST_PATH, REVISIONS_PATH, readmePath, solutionPath } from './paths';
import { mergeReadme, renderReadme } from './readme';
import { createRevisionRecord, type RevisionStore } from './revisions';

/**
 * Deterministic sync planner.
 *
 * Category copies are generated from a single canonical submission record, so
 * every copy of a problem carries identical metadata and identical source. No
 * file is ever planned for deletion.
 *
 * Planning happens in two phases — `planContentFiles` then `finalizePlan` — so
 * the user can resolve conflicts before the manifest that describes the final
 * file set is rendered.
 */

export interface ContentPlanInput {
  submission: NormalizedSubmission;
  /** Remote README content keyed by path, used to preserve user edits. */
  existingContent: ReadonlyMap<string, string>;
  nowIso: string;
}

export interface ContentPlan {
  files: PlannedFile[];
  languages: LanguageInfo[];
}

export interface FinalizeInput {
  submission: NormalizedSubmission;
  manifest: Manifest;
  revisions: RevisionStore;
  files: PlannedFile[];
  nowIso: string;
  revisionIntervals?: readonly number[];
}

export interface PlanResult {
  plan: SyncPlan;
  nextManifest: Manifest;
  nextRevisions: RevisionStore;
  problem: ManifestProblem;
}

export interface PlanInput {
  submission: NormalizedSubmission;
  manifest: Manifest;
  revisions: RevisionStore;
  existingContent: ReadonlyMap<string, string>;
  nowIso: string;
  revisionIntervals?: readonly number[];
}

/**
 * Two accepted languages can share an extension (`python3` and `pandas` both
 * map to `.py`). One file per extension is guaranteed, chosen in a stable order
 * so repeated syncs pick the same winner.
 */
export function dedupeLanguages(submission: NormalizedSubmission): LanguageInfo[] {
  const byExtension = new Map<string, LanguageInfo>();
  byExtension.set(submission.language.extension, submission.language);
  return [...byExtension.values()].sort((left, right) =>
    left.extension < right.extension ? -1 : left.extension > right.extension ? 1 : 0,
  );
}

export function renderTrackerJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function createContentHasher() {
  const cache = new Map<string, { contentHash: string; blobSha: string }>();
  return async (content: string): Promise<{ contentHash: string; blobSha: string }> => {
    const cached = cache.get(content);
    if (cached) return cached;
    const [contentHash, blobSha] = await Promise.all([sha256Hex(content), gitBlobSha1(content)]);
    const computed = { contentHash, blobSha };
    cache.set(content, computed);
    return computed;
  };
}

export async function hashedFile(
  file: Omit<PlannedFile, 'contentHash' | 'blobSha'>,
  hasher: (content: string) => Promise<{ contentHash: string; blobSha: string }>,
): Promise<PlannedFile> {
  const hashes = await hasher(file.content);
  return { ...file, ...hashes };
}

/**
 * Builds the per-category README and solution files for one submission.
 * READMEs are generated once and then merged with whatever the repository
 * already holds, so the user's approach, complexity and notes survive.
 */
export async function planContentFiles(input: ContentPlanInput): Promise<ContentPlan> {
  const { submission, existingContent, nowIso } = input;
  const languages = dedupeLanguages(submission);
  const hash = createContentHasher();

  const canonicalReadme = renderReadme({
    problemId: submission.problemId,
    title: submission.title,
    url: submission.url,
    difficulty: submission.difficulty,
    tags: submission.tags,
    languages: languages.map((language) => ({
      label: language.label,
      fileName: `solution.${language.extension}`,
    })),
    categories: submission.categories,
    metadataIncomplete: submission.metadataIncomplete,
    syncedAt: nowIso,
    warnings: submission.warnings,
  });

  const files: PlannedFile[] = [];
  for (const category of submission.categories) {
    const path = readmePath(category, submission.slug);
    const existing = existingContent.get(path) ?? null;
    const content = existing === null ? canonicalReadme : mergeReadme(existing, canonicalReadme);
    files.push(
      await hashedFile(
        { path, category, kind: 'readme', language: null, content, version: 1 },
        hash,
      ),
    );

    for (const language of languages) {
      files.push(
        await hashedFile(
          {
            path: solutionPath(category, submission.slug, language.extension),
            category,
            kind: 'solution',
            language: language.id,
            content: submission.code,
            version: 1,
          },
          hash,
        ),
      );
    }
  }

  files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  return { files, languages };
}

export function toManifestFile(file: PlannedFile): ManifestFile {
  return {
    path: file.path,
    category: file.category,
    kind: file.kind === 'readme' ? 'readme' : 'solution',
    language: file.language,
    hash: file.contentHash,
    blobSha: file.blobSha,
    version: file.version,
  };
}

function categoriesFromFiles(problem: ManifestProblem | undefined): Set<string> {
  const categories = new Set<string>();
  for (const file of problem?.files ?? []) {
    if (file.category) categories.add(file.category);
  }
  return categories;
}

/** Every language the problem has a solution file for, across all syncs. */
export function accumulatedLanguages(
  previous: ManifestProblem | undefined,
  incoming: readonly LanguageInfo[],
): string[] {
  const languages = new Set<string>();
  for (const file of previous?.files ?? []) {
    if (file.kind === 'solution' && file.language) languages.add(file.language);
  }
  for (const language of incoming) languages.add(language.id);
  return [...languages].sort();
}

/** Renders the manifest and revision backups and assembles the final plan. */
export async function finalizePlan(input: FinalizeInput): Promise<PlanResult> {
  const { submission, manifest, revisions, files, nowIso } = input;
  const previous = manifest.problems[submission.problemId];
  const hash = createContentHasher();

  const problem: ManifestProblem = {
    problemId: submission.problemId,
    slug: submission.slug,
    title: submission.title,
    titleSlug: submission.titleSlug,
    url: submission.url,
    difficulty: submission.difficulty,
    officialTags: submission.tags,
    categories: submission.categories,
    metadataIncomplete: submission.metadataIncomplete,
    languages: accumulatedLanguages(previous, dedupeLanguages(submission)),
    files: files.map(toManifestFile),
    lastSyncedSubmissionId: submission.submissionId,
    updatedAt: nowIso,
  };

  const nextManifest: Manifest = { ...upsertProblem(manifest, problem), generatedAt: nowIso };

  const nextRevisions: RevisionStore = revisions.problems[submission.problemId]
    ? { ...revisions, generatedAt: nowIso }
    : {
        ...revisions,
        generatedAt: nowIso,
        problems: {
          ...revisions.problems,
          [submission.problemId]: createRevisionRecord({
            problemId: submission.problemId,
            slug: submission.slug,
            title: submission.title,
            nowIso,
            ...(input.revisionIntervals ? { intervals: input.revisionIntervals } : {}),
          }),
        },
      };

  const previousCategories = categoriesFromFiles(previous);
  const newCategories = submission.categories.filter(
    (category) => !previousCategories.has(category),
  );
  const retainedCategories = [...previousCategories]
    .filter((category) => !submission.categories.includes(category))
    .sort();

  const trackerFiles: PlannedFile[] = [];
  for (const tracker of [
    { path: MANIFEST_PATH, kind: 'manifest' as const, content: renderTrackerJson(nextManifest) },
    { path: REVISIONS_PATH, kind: 'revisions' as const, content: renderTrackerJson(nextRevisions) },
  ]) {
    trackerFiles.push(
      await hashedFile(
        {
          path: tracker.path,
          category: null,
          kind: tracker.kind,
          language: null,
          content: tracker.content,
          version: 1,
        },
        hash,
      ),
    );
  }

  const warnings = [...submission.warnings];
  if (retainedCategories.length > 0) {
    warnings.push(
      `Kept earlier category copies that the current tags no longer list: ${retainedCategories.join(', ')}. Review them on GitHub; LeetSensei never deletes them for you.`,
    );
  }

  const plan: SyncPlan = {
    submissionId: submission.submissionId,
    problemId: submission.problemId,
    slug: submission.slug,
    title: submission.title,
    categories: submission.categories,
    newCategories,
    retainedCategories,
    files,
    trackerFiles,
    metadataIncomplete: submission.metadataIncomplete,
    warnings,
  };

  return { plan, nextManifest, nextRevisions, problem };
}

/** Convenience wrapper used by tests and the conflict-free path. */
export async function buildSyncPlan(input: PlanInput): Promise<PlanResult> {
  const content = await planContentFiles({
    submission: input.submission,
    existingContent: input.existingContent,
    nowIso: input.nowIso,
  });
  return finalizePlan({
    submission: input.submission,
    manifest: input.manifest,
    revisions: input.revisions,
    files: content.files,
    nowIso: input.nowIso,
    ...(input.revisionIntervals ? { revisionIntervals: input.revisionIntervals } : {}),
  });
}
