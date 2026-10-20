import { compareCodePoints, fnv1aHex } from '../shared/text';

/**
 * Deterministic tag -> folder-name mapping.
 *
 * `Hash Table` -> `Hash-Table`, `Two Pointers` -> `Two-Pointers`. The mapping
 * must be stable forever: the same tag always produces the same folder so a
 * re-sync never creates a duplicate directory.
 */

export const MAX_CATEGORY_LENGTH = 64;

/** Windows device names are invalid as path segments on any checkout. */
const RESERVED_SEGMENT_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
]);

/**
 * Windows treats `CON`, `CON.txt` and `con.tar.gz` as the same reserved device,
 * so the stem before the first dot is what matters.
 */
export function isReservedSegmentName(value: string): boolean {
  const stem = value.split('.')[0] ?? value;
  return RESERVED_SEGMENT_NAMES.has(stem.toUpperCase());
}

export function normalizeCategory(tag: string): string {
  const normalized = tag.normalize('NFC').trim();
  let segment = normalized.replace(/[^\p{L}\p{N}+]+/gu, '-');
  segment = segment
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+/, '')
    .replace(/[-.]+$/, '');

  if (segment === '') {
    segment = `Tag-${fnv1aHex(normalized)}`;
  }
  if (isReservedSegmentName(segment)) {
    segment = `${segment}-tag`;
  }
  if (segment.length > MAX_CATEGORY_LENGTH) {
    const suffix = fnv1aHex(segment);
    segment = `${segment.slice(0, MAX_CATEGORY_LENGTH - suffix.length - 1)}-${suffix}`;
  }
  return segment;
}

/**
 * Sorts tags for determinism, drops blanks, then maps and de-duplicates the
 * resulting folder names case-insensitively.
 */
export function normalizeCategories(tags: readonly string[]): string[] {
  const cleaned = tags
    .map((tag) => tag.normalize('NFC').trim())
    .filter((tag) => tag !== '')
    .sort(compareCodePoints);

  const seen = new Set<string>();
  const categories: string[] = [];
  for (const tag of cleaned) {
    const category = normalizeCategory(tag);
    const key = category.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    categories.push(category);
  }
  return categories;
}
