/** Text helpers shared by the planner, README renderer and adapters. */

/** Converts CRLF and lone CR line endings to LF. */
export function normalizeNewlines(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

/** Ensures the text ends with exactly one trailing newline. */
export function ensureTrailingNewline(value: string): string {
  return `${value.replace(/\n+$/, '')}\n`;
}

/** Canonical form stored in the repository and used for hashing. */
export function normalizeSourceCode(value: string): string {
  const withoutBom = value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
  return ensureTrailingNewline(normalizeNewlines(withoutBom));
}

/** Removes characters that are illegal in repository paths. */
export function stripControlCharacters(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, '');
}

export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return value.slice(0, maxLength);
}

/** Deterministic, dependency-free 32-bit FNV-1a hash rendered as 8 hex chars. */
export function fnv1aHex(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** Stable ordering that does not depend on the host locale. */
export function compareCodePoints(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function uniquePreservingOrder(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}
