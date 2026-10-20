import { LeetSenseiError } from '../shared/errors';
import { isReservedSegmentName } from './tags';

/**
 * Repository path planning and safety.
 *
 * Every path that reaches the GitHub API goes through `assertSafeRepoPath`,
 * which blocks traversal, control characters, illegal filename characters,
 * Windows device names and over-long segments.
 */

export const TRACKER_DIR = '.leetcode-tracker';
export const MANIFEST_FILE = 'manifest.json';
export const REVISIONS_FILE = 'revisions.json';
export const MANIFEST_PATH = `${TRACKER_DIR}/${MANIFEST_FILE}`;
export const REVISIONS_PATH = `${TRACKER_DIR}/${REVISIONS_FILE}`;
export const README_FILE = 'README.md';

const MAX_SEGMENT_LENGTH = 100;
const MAX_PATH_LENGTH = 900;
const ILLEGAL_SEGMENT_CHARACTERS = /[<>:"|?*\\]/;

function checkSegment(segment: string, path: string): string | null {
  if (segment === '') return 'contains an empty path segment';
  if (segment === '.' || segment === '..') return 'contains a traversal segment';
  if (ILLEGAL_SEGMENT_CHARACTERS.test(segment)) return 'contains an illegal filename character';
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(segment)) return 'contains a control character';
  if (segment !== segment.trim()) return 'has leading or trailing whitespace';
  if (segment.endsWith('.')) return 'ends with a dot';
  if (isReservedSegmentName(segment)) return `uses the reserved name "${segment}"`;
  if (segment.length > MAX_SEGMENT_LENGTH) return 'exceeds the maximum segment length';
  void path;
  return null;
}

export function findPathProblem(path: string): string | null {
  if (typeof path !== 'string' || path === '') return 'is empty';
  if (path.startsWith('/') || path.startsWith('\\')) return 'is absolute';
  if (path.includes('\\')) return 'uses a backslash separator';
  if (path.endsWith('/')) return 'ends with a separator';
  if (path.length > MAX_PATH_LENGTH) return 'exceeds the maximum path length';
  if (/^[A-Za-z]:/.test(path)) return 'looks like a drive-qualified path';
  for (const segment of path.split('/')) {
    const problem = checkSegment(segment, path);
    if (problem) return problem;
  }
  return null;
}

export function isSafeRepoPath(path: string): boolean {
  return findPathProblem(path) === null;
}

export function assertSafeRepoPath(path: string): void {
  const problem = findPathProblem(path);
  if (problem) {
    throw new LeetSenseiError(
      'unsafe_path',
      `Refusing to use the path "${path}" because it ${problem}.`,
      {
        details: { path, problem },
      },
    );
  }
}

export function joinRepoPath(...segments: string[]): string {
  const path = segments.filter((segment) => segment !== '').join('/');
  assertSafeRepoPath(path);
  return path;
}

export function problemDirectory(category: string, slug: string): string {
  return joinRepoPath(category, slug);
}

export function readmePath(category: string, slug: string): string {
  return joinRepoPath(category, slug, README_FILE);
}

export function solutionPath(category: string, slug: string, extension: string): string {
  return joinRepoPath(category, slug, `solution.${extension}`);
}

const pad = (value: number, width = 2): string => String(value).padStart(width, '0');

/** UTC `YYYYMMDD-HHMMSS` stamp used for preserved versions. */
export function versionStamp(iso: string | null, fallbackIso: string): string {
  const parsed = new Date(iso ?? fallbackIso);
  const date = Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
  return [
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`,
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`,
  ].join('-');
}

export function versionedFileName(fileName: string, stamp: string, attempt = 1): string {
  const dot = fileName.lastIndexOf('.');
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  const extension = dot > 0 ? fileName.slice(dot) : '';
  const suffix = attempt > 1 ? `-${attempt}` : '';
  return `${base}.${stamp}${suffix}${extension}`;
}

/**
 * Chooses a versioned sibling path that is not already taken. The result is
 * deterministic for a given repository state: the same inputs and the same set
 * of existing paths always produce the same name.
 */
export function versionedPath(path: string, stamp: string, taken: ReadonlySet<string>): string {
  const slash = path.lastIndexOf('/');
  const directory = slash >= 0 ? path.slice(0, slash) : '';
  const fileName = slash >= 0 ? path.slice(slash + 1) : path;
  for (let attempt = 1; attempt <= 1000; attempt += 1) {
    const candidate = joinRepoPath(directory, versionedFileName(fileName, stamp, attempt));
    if (!taken.has(candidate)) return candidate;
  }
  throw new LeetSenseiError('unsafe_path', `Could not find a free versioned name for ${path}.`);
}
