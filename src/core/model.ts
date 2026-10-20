/** Canonical LeetSensei data model. */

export type ReviewRating = 'again' | 'hard' | 'easy';

export type Difficulty = 'Easy' | 'Medium' | 'Hard' | 'Unknown';

export interface LanguageInfo {
  /** LeetCode language id, e.g. `python3`. */
  id: string;
  /** Human label, e.g. `Python 3`. */
  label: string;
  /** File extension without the dot, e.g. `py`. */
  extension: string;
}

/**
 * Submission exactly as scraped from LeetCode. Every field is untrusted and may
 * be missing or malformed; `normalizeSubmission` is the only code allowed to
 * turn this into a `NormalizedSubmission`.
 */
export interface RawSubmission {
  submissionId: string;
  status: string;
  language: string;
  code: string;
  problemId: string | null;
  problemTitle: string | null;
  titleSlug: string | null;
  difficulty: string | null;
  tags: string[];
  submittedAt: string | null;
  url: string | null;
}

export interface NormalizedSubmission {
  submissionId: string;
  problemId: string;
  title: string;
  titleSlug: string;
  slug: string;
  difficulty: Difficulty;
  /** Official LeetCode topic tags, verbatim. */
  tags: string[];
  /** Deterministic folder names derived from the tags. */
  categories: string[];
  language: LanguageInfo;
  /** Normalised source text that will be written to the repository. */
  code: string;
  contentHash: string;
  blobSha: string;
  submittedAt: string | null;
  url: string;
  /** True when LeetCode did not supply all metadata (tags, id or difficulty). */
  metadataIncomplete: boolean;
  warnings: string[];
}

/** A single file LeetSensei intends to create or update. */
export interface PlannedFile {
  path: string;
  category: string | null;
  kind: 'solution' | 'readme' | 'manifest' | 'revisions';
  language: string | null;
  content: string;
  contentHash: string;
  blobSha: string;
  /** 1 for the canonical file name, >1 for a preserved versioned copy. */
  version: number;
}

export interface SyncPlan {
  submissionId: string;
  problemId: string;
  slug: string;
  title: string;
  categories: string[];
  /** Categories that were not present in the manifest before this plan. */
  newCategories: string[];
  /** Categories kept from the manifest even though the tags no longer list them. */
  retainedCategories: string[];
  files: PlannedFile[];
  trackerFiles: PlannedFile[];
  metadataIncomplete: boolean;
  warnings: string[];
}

export function describeFile(file: PlannedFile): string {
  const where = file.category ? `${file.category}/` : '';
  return `${where}${file.path}${file.version > 1 ? ` (version ${file.version})` : ''}`;
}
