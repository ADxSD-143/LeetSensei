import type { RawSubmission } from '../../core/model';

/**
 * LeetCode payload parsing.
 *
 * All of this is pure: responses are treated as untrusted input, every field is
 * optional, and nothing is invented. Only `normalizeSubmission` may turn the
 * result into a canonical record.
 */

export interface LeetCodeQuestion {
  questionId: string | null;
  frontendId: string | null;
  title: string | null;
  titleSlug: string | null;
  difficulty: string | null;
  tags: string[];
}

export interface LeetCodeSubmissionDetail {
  submissionId: string | null;
  status: string | null;
  language: string | null;
  code: string | null;
  timestamp: string | null;
  /** Present on some responses, saving a second request. */
  question: LeetCodeQuestion | null;
}

export interface LeetCodeSubmissionListEntry {
  id: string;
  status: string;
  language: string;
  timestamp: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function asStringArray(value: unknown): string[] {
  return asArray(value).filter((entry): entry is string => typeof entry === 'string');
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Unwraps `{ data: { <key>: ... } }` and tolerates a missing envelope. */
function unwrap(payload: unknown, key: string): Record<string, unknown> | null {
  const root = asRecord(payload);
  if (!root) return null;
  const data = asRecord(root.data) ?? root;
  return asRecord(data[key]);
}

/**
 * LeetCode reports submission times as unix seconds (sometimes as a string, and
 * occasionally in milliseconds). Anything unusable becomes `null` rather than a
 * fabricated date.
 */
export function parseTimestamp(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const milliseconds = value > 1e11 ? value : value * 1000;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    if (/^\d+$/.test(trimmed)) return parseTimestamp(Number(trimmed));
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}

export function parseQuestionNode(node: unknown): LeetCodeQuestion | null {
  const record = asRecord(node);
  if (!record) return null;
  const tags = asArray(record.topicTags)
    .map((tag) => asString(asRecord(tag)?.name))
    .filter((name): name is string => name !== null && name.trim() !== '');

  const question: LeetCodeQuestion = {
    questionId: asString(record.questionId),
    frontendId: asString(record.questionFrontendId) ?? asString(record.questionId),
    title: asString(record.title),
    titleSlug: asString(record.titleSlug),
    difficulty: asString(record.difficulty),
    tags,
  };
  const hasAnything =
    question.titleSlug !== null ||
    question.title !== null ||
    question.frontendId !== null ||
    tags.length > 0;
  return hasAnything ? question : null;
}

export function parseQuestionResponse(payload: unknown): LeetCodeQuestion | null {
  return parseQuestionNode(unwrap(payload, 'question'));
}

export function parseSubmissionDetailsResponse(payload: unknown): LeetCodeSubmissionDetail | null {
  const node = unwrap(payload, 'submissionDetails');
  if (!node) return null;
  const languageNode = asRecord(node.lang);
  const detail: LeetCodeSubmissionDetail = {
    submissionId: asString(node.id),
    status: asString(node.statusDisplay) ?? asString(node.status),
    language: asString(languageNode?.name) ?? asString(node.lang),
    code: asString(node.code),
    timestamp: parseTimestamp(node.timestamp),
    question: parseQuestionNode(node.question),
  };
  return detail;
}

export function parseSubmissionListResponse(payload: unknown): LeetCodeSubmissionListEntry[] {
  const node = unwrap(payload, 'submissionList');
  if (!node) return [];
  const entries: LeetCodeSubmissionListEntry[] = [];
  for (const raw of asArray(node.submissions)) {
    const record = asRecord(raw);
    if (!record) continue;
    const id = asString(record.id);
    if (id === null) continue;
    const language = asRecord(record.lang);
    entries.push({
      id,
      status: asString(record.statusDisplay) ?? '',
      language: asString(language?.name) ?? asString(record.lang) ?? '',
      timestamp: parseTimestamp(record.timestamp),
    });
  }
  return entries;
}

/** Most recent entry that LeetSensei has not already handled. */
export function pickUnprocessedSubmission(
  entries: readonly LeetCodeSubmissionListEntry[],
  processed: ReadonlySet<string>,
): LeetCodeSubmissionListEntry | null {
  for (const entry of entries) {
    if (!processed.has(entry.id)) return entry;
  }
  return null;
}

export interface AssembleInput {
  submissionId: string;
  details: LeetCodeSubmissionDetail | null;
  question: LeetCodeQuestion | null;
  titleSlugFromUrl: string | null;
  url: string;
  origin?: string;
}

/**
 * Merges what each source could provide into the raw record the validator
 * expects. Precedence: explicit question query > submission details > page URL.
 */
export function assembleRawSubmission(input: AssembleInput): RawSubmission {
  const question = input.question ?? input.details?.question ?? null;
  const titleSlug = question?.titleSlug ?? input.titleSlugFromUrl ?? null;
  const origin = input.origin ?? 'https://leetcode.com';
  const url =
    input.url !== '' ? input.url : titleSlug === null ? origin : `${origin}/problems/${titleSlug}/`;

  return {
    submissionId: input.details?.submissionId ?? input.submissionId,
    status: input.details?.status ?? '',
    language: input.details?.language ?? '',
    code: input.details?.code ?? '',
    problemId: question?.frontendId ?? null,
    problemTitle: question?.title ?? null,
    titleSlug,
    difficulty: question?.difficulty ?? null,
    tags: question?.tags ?? [],
    submittedAt: input.details?.timestamp ?? null,
    url,
  };
}

/**
 * Validates a raw submission arriving over extension messaging. The content
 * script is trusted code, but the values inside it came from a web page, so the
 * shape is checked again at the boundary before anything acts on it.
 */
export function coerceRawSubmission(value: unknown): RawSubmission | null {
  const record = asRecord(value);
  if (!record) return null;
  const submissionId = asString(record.submissionId);
  const status = asString(record.status);
  if (submissionId === null || status === null) return null;
  return {
    submissionId,
    status,
    language: asString(record.language) ?? '',
    code: asString(record.code) ?? '',
    problemId: asString(record.problemId),
    problemTitle: asString(record.problemTitle),
    titleSlug: asString(record.titleSlug),
    difficulty: asString(record.difficulty),
    tags: asStringArray(record.tags),
    submittedAt: asString(record.submittedAt),
    url: asString(record.url),
  };
}
