/**
 * Pure page-shape helpers for the LeetCode adapter.
 *
 * LeetSensei deliberately does not rely on one fragile CSS class. Instead it
 * looks for any node that publishes a judging verdict, classifies its text, and
 * then uses LeetCode's own (stable) GraphQL API for everything else. The
 * selectors below are candidates, not the sole mechanism.
 */

export interface TextCarrier {
  textContent: string | null;
}

export type ResultVerdict = 'accepted' | 'rejected' | 'pending' | 'none';

/** Candidate containers that display a submission verdict. */
export const RESULT_NODE_SELECTORS: readonly string[] = [
  '[data-e2e-locator="submission-result"]',
  '[data-e2e-locator="console-result"]',
  '[data-e2e-locator^="submission"]',
  '[class*="result"]',
];

export const PENDING_RESULT_TOKENS: readonly string[] = [
  'pending',
  'started',
  'judging',
  'in queue',
];

export const REJECTED_RESULT_TOKENS: readonly string[] = [
  'wrong answer',
  'runtime error',
  'time limit exceeded',
  'compilation error',
  'compile error',
  'memory limit exceeded',
  'output limit exceeded',
  'internal error',
  'presentation error',
  'restricted function',
  'timeout',
];

const ACCEPTED_TOKEN = 'accepted';

function containsToken(haystack: string, token: string): boolean {
  if (token.includes(' ')) return haystack.includes(token);
  return new RegExp(`(^|[^a-z])${token}([^a-z]|$)`).test(haystack);
}

export function classifyResultText(text: string | null): ResultVerdict {
  if (text === null) return 'none';
  const haystack = text.toLowerCase().replace(/\s+/g, ' ').trim();
  if (haystack === '') return 'none';

  if (containsToken(haystack, ACCEPTED_TOKEN)) return 'accepted';
  for (const token of PENDING_RESULT_TOKENS) {
    if (containsToken(haystack, token)) return 'pending';
  }
  for (const token of REJECTED_RESULT_TOKENS) {
    if (containsToken(haystack, token)) return 'rejected';
  }
  return 'none';
}

export function evaluateResultNode(node: TextCarrier | null): ResultVerdict {
  return classifyResultText(node?.textContent ?? null);
}

/**
 * Picks the strongest verdict across candidate nodes. A rejected or accepted
 * verdict beats "pending", which beats "none", because a stale "Judging" node
 * may sit next to the real result.
 */
export function pickResultVerdict(nodes: Iterable<TextCarrier>): ResultVerdict {
  let best: ResultVerdict = 'none';
  const rank: Record<ResultVerdict, number> = { none: 0, pending: 1, rejected: 2, accepted: 3 };
  for (const node of nodes) {
    const verdict = evaluateResultNode(node);
    if (rank[verdict] > rank[best]) best = verdict;
  }
  return best;
}

/** `/problems/two-sum/description/` -> `two-sum` */
export function extractTitleSlug(pathname: string): string | null {
  const match = /\/problems\/([^/?#]+)/.exec(pathname);
  if (!match) return null;
  const raw = match[1];
  if (raw === undefined || raw === '') return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** Accepts `/submissions/1234/` or a bare `1234`. */
export function extractSubmissionId(value: string): string | null {
  const match = /\/submissions\/(\d+)/.exec(value);
  if (match) return match[1] ?? null;
  const bare = /^\s*(\d{3,})\s*$/.exec(value);
  return bare?.[1] ?? null;
}

export function isSubmitControl(text: string | null): boolean {
  if (text === null) return false;
  const haystack = text.toLowerCase().replace(/\s+/g, ' ').trim();
  return haystack === 'submit' || haystack === 'submit solution' || haystack === 'submit code';
}
