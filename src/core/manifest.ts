import {
  invalid,
  isIsoTimestamp,
  isRecord,
  isSafeRelativePathShape,
  readBoolean,
  readNumber,
  readString,
  readStringArray,
  valid,
  type ValidationResult,
} from '../shared/validation';

/**
 * The manifest is the source of truth for files LeetSensei manages.
 *
 * It is stored locally as the primary copy and mirrored to
 * `.leetcode-tracker/manifest.json` in the connected repository so a fresh
 * install can reconcile against what was actually written.
 */

export const MANIFEST_SCHEMA_VERSION = 1;

export type ManifestFileKind = 'solution' | 'readme';

export interface ManifestFile {
  path: string;
  category: string | null;
  kind: ManifestFileKind;
  language: string | null;
  /** sha256 of the content LeetSensei last wrote. */
  hash: string;
  /** Git blob id of the content LeetSensei last wrote. */
  blobSha: string;
  version: number;
}

export interface ManifestProblem {
  problemId: string;
  slug: string;
  title: string;
  titleSlug: string;
  url: string;
  difficulty: string;
  officialTags: string[];
  categories: string[];
  metadataIncomplete: boolean;
  languages: string[];
  files: ManifestFile[];
  lastSyncedSubmissionId: string;
  updatedAt: string;
}

export interface Manifest {
  schemaVersion: number;
  generatedAt: string;
  problems: Record<string, ManifestProblem>;
}

export function createEmptyManifest(nowIso: string): Manifest {
  return { schemaVersion: MANIFEST_SCHEMA_VERSION, generatedAt: nowIso, problems: {} };
}

function validateFile(value: unknown, where: string): ValidationResult<ManifestFile> {
  if (!isRecord(value)) return invalid(`${where}: expected an object`);
  const path = readString(value, 'path');
  if (!isSafeRelativePathShape(path)) return invalid(`${where}.path: unsafe or missing path`);
  const category = value.category === null ? null : readString(value, 'category');
  if (category === undefined) return invalid(`${where}.category: expected a string or null`);
  const kind = readString(value, 'kind');
  if (kind !== 'solution' && kind !== 'readme')
    return invalid(`${where}.kind: expected solution or readme`);
  const language = value.language === null ? null : readString(value, 'language');
  if (language === undefined) return invalid(`${where}.language: expected a string or null`);
  const hash = readString(value, 'hash');
  if (!hash) return invalid(`${where}.hash: required`);
  const blobSha = readString(value, 'blobSha');
  if (!blobSha) return invalid(`${where}.blobSha: required`);
  const version = readNumber(value, 'version');
  if (version === undefined || version < 1)
    return invalid(`${where}.version: expected a positive number`);
  return valid({ path, category, kind, language, hash, blobSha, version });
}

function validateProblem(value: unknown, key: string): ValidationResult<ManifestProblem> {
  if (!isRecord(value)) return invalid(`problems.${key}: expected an object`);
  const problemId = readString(value, 'problemId');
  if (!problemId) return invalid(`problems.${key}.problemId: required`);
  if (problemId !== key)
    return invalid(`problems.${key}.problemId: does not match its key (${problemId})`);
  const slug = readString(value, 'slug');
  if (!slug) return invalid(`problems.${key}.slug: required`);
  const title = readString(value, 'title');
  if (title === undefined) return invalid(`problems.${key}.title: required`);
  const titleSlug = readString(value, 'titleSlug');
  if (!titleSlug) return invalid(`problems.${key}.titleSlug: required`);
  const url = readString(value, 'url') ?? '';
  const difficulty = readString(value, 'difficulty') ?? 'Unknown';
  const officialTags = readStringArray(value, 'officialTags');
  if (!officialTags) return invalid(`problems.${key}.officialTags: expected a string array`);
  const categories = readStringArray(value, 'categories');
  if (!categories) return invalid(`problems.${key}.categories: expected a string array`);
  const metadataIncomplete = readBoolean(value, 'metadataIncomplete') ?? false;
  const languages = readStringArray(value, 'languages') ?? [];
  const lastSyncedSubmissionId = readString(value, 'lastSyncedSubmissionId') ?? '';
  const updatedAt = readString(value, 'updatedAt');
  if (!isIsoTimestamp(updatedAt))
    return invalid(`problems.${key}.updatedAt: expected an ISO timestamp`);

  const rawFiles = value.files;
  if (!Array.isArray(rawFiles)) return invalid(`problems.${key}.files: expected an array`);
  const files: ManifestFile[] = [];
  for (const [index, rawFile] of rawFiles.entries()) {
    const result = validateFile(rawFile, `problems.${key}.files[${index}]`);
    if (!result.ok) return result;
    files.push(result.value);
  }

  return valid({
    problemId,
    slug,
    title,
    titleSlug,
    url,
    difficulty,
    officialTags,
    categories,
    metadataIncomplete,
    languages,
    files,
    lastSyncedSubmissionId,
    updatedAt,
  });
}

export function validateManifest(value: unknown): ValidationResult<Manifest> {
  if (!isRecord(value)) return invalid('manifest: expected an object');
  const schemaVersion = readNumber(value, 'schemaVersion');
  if (schemaVersion === undefined) return invalid('manifest.schemaVersion: required');
  if (schemaVersion > MANIFEST_SCHEMA_VERSION) {
    return invalid(
      `manifest.schemaVersion: ${schemaVersion} was written by a newer LeetSensei and cannot be read`,
    );
  }
  const problemsValue = value.problems;
  if (!isRecord(problemsValue)) return invalid('manifest.problems: expected an object');

  const problems: Record<string, ManifestProblem> = {};
  const errors: string[] = [];
  for (const [key, entry] of Object.entries(problemsValue)) {
    const result = validateProblem(entry, key);
    if (!result.ok) {
      errors.push(...result.errors);
      continue;
    }
    problems[key] = result.value;
  }
  if (errors.length > 0) return invalid(...errors);

  const generatedAt = readString(value, 'generatedAt');
  return valid({
    schemaVersion,
    generatedAt: isIsoTimestamp(generatedAt) ? generatedAt : new Date(0).toISOString(),
    problems,
  });
}

export interface MigrationOutcome {
  ok: boolean;
  manifest?: Manifest;
  migratedFrom: number | null;
  warnings: string[];
  errors: string[];
}

/**
 * Reads a manifest written by any known schema version. Unknown or newer
 * versions are rejected instead of being silently reinterpreted.
 */
export function migrateManifest(value: unknown, nowIso: string): MigrationOutcome {
  if (!isRecord(value)) {
    return {
      ok: false,
      migratedFrom: null,
      warnings: [],
      errors: ['manifest: expected an object'],
    };
  }
  const rawVersion = readNumber(value, 'schemaVersion');
  if (rawVersion === undefined) {
    if (!isRecord(value.problems)) {
      return {
        ok: false,
        migratedFrom: null,
        warnings: [],
        errors: ['manifest: unrecognised shape and no schemaVersion'],
      };
    }
    const upgraded = { ...value, schemaVersion: MANIFEST_SCHEMA_VERSION };
    const result = validateManifest(upgraded);
    if (!result.ok) return { ok: false, migratedFrom: 0, warnings: [], errors: result.errors };
    return {
      ok: true,
      manifest: { ...result.value, generatedAt: result.value.generatedAt || nowIso },
      migratedFrom: 0,
      warnings: ['Migrated a versionless manifest to schema 1.'],
      errors: [],
    };
  }
  const result = validateManifest(value);
  if (!result.ok)
    return { ok: false, migratedFrom: rawVersion, warnings: [], errors: result.errors };
  return {
    ok: true,
    manifest: result.value,
    migratedFrom: rawVersion === MANIFEST_SCHEMA_VERSION ? null : rawVersion,
    warnings: [],
    errors: [],
  };
}

function mergeFiles(existing: ManifestFile[], incoming: ManifestFile[]): ManifestFile[] {
  const byPath = new Map<string, ManifestFile>();
  for (const file of existing) byPath.set(file.path, file);
  for (const file of incoming) byPath.set(file.path, file);
  return [...byPath.values()].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
}

/**
 * Records a problem, keeping every file LeetSensei has written before.
 *
 * Category copies for tags that are no longer present are intentionally kept so
 * the user can review them; nothing is deleted automatically.
 */
export function upsertProblem(manifest: Manifest, problem: ManifestProblem): Manifest {
  const existing = manifest.problems[problem.problemId];
  const merged: ManifestProblem = existing
    ? { ...problem, files: mergeFiles(existing.files, problem.files) }
    : { ...problem, files: mergeFiles([], problem.files) };
  return {
    ...manifest,
    problems: { ...manifest.problems, [problem.problemId]: merged },
  };
}

export function getProblem(manifest: Manifest, problemId: string): ManifestProblem | undefined {
  return manifest.problems[problemId];
}

export function findManagedFile(
  manifest: Manifest,
  path: string,
): { problem: ManifestProblem; file: ManifestFile } | null {
  for (const problem of Object.values(manifest.problems)) {
    const file = problem.files.find((candidate) => candidate.path === path);
    if (file) return { problem, file };
  }
  return null;
}

export function allManagedPaths(manifest: Manifest): Set<string> {
  const paths = new Set<string>();
  for (const problem of Object.values(manifest.problems)) {
    for (const file of problem.files) paths.add(file.path);
  }
  return paths;
}

export function problemsNeedingReview(manifest: Manifest): ManifestProblem[] {
  return Object.values(manifest.problems).sort((left, right) =>
    left.problemId < right.problemId ? -1 : left.problemId > right.problemId ? 1 : 0,
  );
}

/** Every path LeetSensei is permitted to create or overwrite. */
export function managedCategoryPaths(problem: ManifestProblem): string[] {
  return problem.files.filter((file) => file.kind === 'solution').map((file) => file.path);
}
