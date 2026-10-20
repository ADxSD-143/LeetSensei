import { LeetSenseiError } from '../shared/errors';
import { gitBlobSha1, sha256Hex } from '../shared/hash';
import { normalizeSourceCode, uniquePreservingOrder } from '../shared/text';
import type { Difficulty, NormalizedSubmission, RawSubmission } from './model';
import { resolveLanguage } from './language';
import { buildProblemSlug } from './slug';
import { normalizeCategories } from './tags';

/**
 * Turns an untrusted scrape into a canonical record.
 *
 * This is the single gate that enforces "Accepted only" and it is the only
 * place that may construct a `NormalizedSubmission`.
 */

export const ACCEPTED_STATUS = 'Accepted';
export const FALLBACK_CATEGORY = 'Uncategorized';

/** Statuses LeetCode uses while a submission is still being judged. */
const PENDING_STATUSES = new Set(['', 'pending', 'started', 'judging', 'queued', 'in queue']);

export function isPendingStatus(status: string): boolean {
  return PENDING_STATUSES.has(status.trim().toLowerCase());
}

export function isFinalStatus(status: string): boolean {
  return status.trim() !== '' && !isPendingStatus(status);
}

export function isAcceptedStatus(status: string): boolean {
  return status.trim() === ACCEPTED_STATUS;
}

function normalizeDifficulty(value: string | null): Difficulty {
  const trimmed = (value ?? '').trim().toLowerCase();
  if (trimmed === 'easy') return 'Easy';
  if (trimmed === 'medium') return 'Medium';
  if (trimmed === 'hard') return 'Hard';
  return 'Unknown';
}

function normalizeTags(tags: readonly string[]): string[] {
  const cleaned: string[] = [];
  for (const tag of tags) {
    if (typeof tag !== 'string') continue;
    const trimmed = tag.normalize('NFC').trim();
    if (trimmed === '') continue;
    cleaned.push(trimmed);
  }
  return uniquePreservingOrder(cleaned);
}

export interface NormalizeOptions {
  /** Bucket used when LeetCode returns no topic tags. */
  fallbackCategory?: string;
}

export async function normalizeSubmission(
  raw: RawSubmission,
  options: NormalizeOptions = {},
): Promise<NormalizedSubmission> {
  const submissionId = (raw.submissionId ?? '').trim();
  if (submissionId === '') {
    throw new LeetSenseiError(
      'extraction_failed',
      'The submission had no id, so it cannot be tracked.',
      {
        details: { problemTitle: raw.problemTitle },
      },
    );
  }

  const status = (raw.status ?? '').trim();
  if (!isAcceptedStatus(status)) {
    throw new LeetSenseiError(
      'not_accepted',
      `Only Accepted submissions are synced (this one is "${status || 'unknown'}").`,
      { details: { submissionId, status } },
    );
  }

  if (typeof raw.code !== 'string' || raw.code.trim() === '') {
    throw new LeetSenseiError(
      'extraction_failed',
      'LeetCode did not return the submitted source code for this submission.',
      { details: { submissionId } },
    );
  }

  const language = resolveLanguage(raw.language ?? '');
  if (language === null) {
    throw new LeetSenseiError(
      'unsupported_language',
      `LeetSensei does not have a file mapping for the language "${raw.language}".`,
      { details: { submissionId, language: raw.language } },
    );
  }

  const warnings: string[] = [];
  let metadataIncomplete = false;

  const { slug, problemId, usedNumericId } = buildProblemSlug({
    problemId: raw.problemId,
    titleSlug: raw.titleSlug,
    title: raw.problemTitle,
  });
  if (!usedNumericId) {
    metadataIncomplete = true;
    warnings.push(
      'LeetCode did not report a numeric problem id, so the folder is named from the title slug only.',
    );
  }

  const tags = normalizeTags(raw.tags ?? []);
  let categories = normalizeCategories(tags);
  if (categories.length === 0) {
    metadataIncomplete = true;
    const fallback = options.fallbackCategory ?? FALLBACK_CATEGORY;
    categories = normalizeCategories([fallback]);
    warnings.push(
      `LeetCode returned no topic tags, so this solution was filed under "${fallback}". Add topics manually on GitHub if needed.`,
    );
  }

  const difficulty = normalizeDifficulty(raw.difficulty);
  if (difficulty === 'Unknown') {
    metadataIncomplete = true;
    warnings.push('LeetCode did not report a difficulty for this problem.');
  }

  const code = normalizeSourceCode(raw.code);
  const titleSlug = raw.titleSlug ?? slug;
  const url = raw.url ?? `https://leetcode.com/problems/${titleSlug}/`;
  const title = (raw.problemTitle ?? titleSlug).trim() || titleSlug;

  const [contentHash, blobSha] = await Promise.all([sha256Hex(code), gitBlobSha1(code)]);

  return {
    submissionId,
    problemId,
    title,
    titleSlug,
    slug,
    difficulty,
    tags,
    categories,
    language,
    code,
    contentHash,
    blobSha,
    submittedAt: raw.submittedAt,
    url,
    metadataIncomplete,
    warnings,
  };
}
