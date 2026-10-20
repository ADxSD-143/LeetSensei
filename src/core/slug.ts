import { fnv1aHex } from '../shared/text';

/** ASCII slug used for the problem folder name. */
export function slugify(value: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
  return slug;
}

const MAX_SLUG_LENGTH = 80;

export function normalizeTitleSlug(titleSlug: string): string {
  const cleaned = slugify(titleSlug);
  if (cleaned === '') return `problem-${fnv1aHex(titleSlug)}`;
  if (cleaned.length <= MAX_SLUG_LENGTH) return cleaned;
  return `${cleaned.slice(0, MAX_SLUG_LENGTH - 9)}-${fnv1aHex(cleaned)}`;
}

export function padProblemId(problemId: string): string {
  const digits = problemId.replace(/\D/g, '');
  if (digits === '' || digits.length >= 4) return digits === '' ? problemId : digits;
  return digits.padStart(4, '0');
}

/**
 * Stable problem folder name: `0217-contains-duplicate`.
 *
 * LeetCode normally supplies both the numeric id and the title slug. When the
 * id is unavailable the slug alone is used, and the record is flagged as
 * incomplete rather than inventing a number.
 */
export function buildProblemSlug(input: {
  problemId: string | null;
  titleSlug: string | null;
  title: string | null;
}): { slug: string; problemId: string; usedNumericId: boolean } {
  const titleSlug = normalizeTitleSlug(input.titleSlug ?? input.title ?? 'problem');
  const numericId = input.problemId ? padProblemId(input.problemId) : '';
  if (numericId !== '') {
    return { slug: `${numericId}-${titleSlug}`, problemId: numericId, usedNumericId: true };
  }
  return { slug: titleSlug, problemId: titleSlug, usedNumericId: false };
}
