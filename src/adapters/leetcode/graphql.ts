import { LeetSenseiError } from '../../shared/errors';
import type { FetchLike } from '../../github/auth';
import {
  parseQuestionResponse,
  parseSubmissionDetailsResponse,
  parseSubmissionListResponse,
  type LeetCodeQuestion,
  type LeetCodeSubmissionDetail,
  type LeetCodeSubmissionListEntry,
} from './parse';

/**
 * LeetCode GraphQL access.
 *
 * These are LeetCode's own public queries, issued from the content script so the
 * request is same-origin and uses the page's existing session. LeetSensei never
 * reads cookies: the CSRF token, when LeetCode requires one, is taken from the
 * page's own `<meta>` tag rather than from `document.cookie`.
 */

export const GRAPHQL_ENDPOINT = 'https://leetcode.com/graphql/';

export const QUESTION_QUERY = `query questionData($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    questionId
    questionFrontendId
    title
    titleSlug
    difficulty
    topicTags { name slug }
  }
}`;

export const SUBMISSION_DETAILS_QUERY = `query submissionDetails($submissionId: Int!) {
  submissionDetails(submissionId: $submissionId) {
    id
    statusDisplay
    lang { name verboseName }
    code
    timestamp
    question {
      questionId
      questionFrontendId
      title
      titleSlug
      difficulty
      topicTags { name slug }
    }
  }
}`;

export const SUBMISSION_LIST_QUERY = `query submissionList($offset: Int!, $limit: Int!, $questionSlug: String!) {
  submissionList(offset: $offset, limit: $limit, questionSlug: $questionSlug) {
    submissions { id statusDisplay lang timestamp }
  }
}`;

export interface LeetCodeRequestOptions {
  fetchImpl?: FetchLike;
  endpoint?: string;
  csrfToken?: string | null;
  timeoutMs?: number;
}

/**
 * Reads the CSRF token LeetCode publishes in a meta tag. Returns null when it is
 * absent; the request is then attempted without it.
 */
export function readCsrfToken(scope: ParentNode | null): string | null {
  if (scope === null) return null;
  const element = scope.querySelector('meta[name="csrf-token"]');
  const value = element?.getAttribute('content');
  return value !== null && value !== undefined && value !== '' ? value : null;
}

async function postGraphql(
  query: string,
  variables: Record<string, unknown>,
  options: LeetCodeRequestOptions,
): Promise<unknown> {
  const doFetch = options.fetchImpl ?? fetch;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.csrfToken !== null && options.csrfToken !== undefined && options.csrfToken !== '') {
    headers['x-csrftoken'] = options.csrfToken;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, options.timeoutMs ?? 15_000));
  let response: Response;
  try {
    response = await doFetch.call(globalThis, options.endpoint ?? GRAPHQL_ENDPOINT, {
      method: 'POST',
      credentials: 'same-origin',
      headers,
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
  } catch (cause) {
    throw new LeetSenseiError(
      'extraction_failed',
      'LeetSensei could not reach LeetCode to read the submission.',
      { retryable: true, cause },
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new LeetSenseiError(
      'extraction_failed',
      `LeetCode responded with HTTP ${response.status} while reading the submission.`,
      { retryable: response.status >= 500 },
    );
  }

  let payload: unknown;
  try {
    payload = (await response.json()) as unknown;
  } catch (cause) {
    throw new LeetSenseiError('extraction_failed', 'LeetCode returned an unreadable response.', {
      cause,
    });
  }

  const errors = (payload as { errors?: unknown }).errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const first = errors[0] as { message?: unknown };
    const message = typeof first?.message === 'string' ? first.message : 'unknown GraphQL error';
    throw new LeetSenseiError('extraction_failed', `LeetCode rejected the query: ${message}`, {
      details: { errors: errors.length },
    });
  }

  return payload;
}

export function isNumericId(value: string): boolean {
  return /^\d+$/.test(value);
}

export async function fetchQuestion(
  titleSlug: string,
  options: LeetCodeRequestOptions = {},
): Promise<LeetCodeQuestion> {
  const payload = await postGraphql(QUESTION_QUERY, { titleSlug }, options);
  const question = parseQuestionResponse(payload);
  if (question === null) {
    throw new LeetSenseiError(
      'missing_metadata',
      `LeetCode did not return details for the problem "${titleSlug}".`,
      { details: { titleSlug } },
    );
  }
  return question;
}

export async function fetchSubmissionDetails(
  submissionId: string,
  options: LeetCodeRequestOptions = {},
): Promise<LeetCodeSubmissionDetail> {
  if (!isNumericId(submissionId)) {
    throw new LeetSenseiError(
      'extraction_failed',
      `"${submissionId}" is not a valid submission id.`,
    );
  }
  const payload = await postGraphql(
    SUBMISSION_DETAILS_QUERY,
    { submissionId: Number(submissionId) },
    options,
  );
  const details = parseSubmissionDetailsResponse(payload);
  if (details === null) {
    throw new LeetSenseiError(
      'extraction_failed',
      `LeetCode did not return submission ${submissionId}.`,
      { details: { submissionId } },
    );
  }
  return details;
}

export async function fetchSubmissionList(
  titleSlug: string,
  limit: number,
  options: LeetCodeRequestOptions = {},
): Promise<LeetCodeSubmissionListEntry[]> {
  const payload = await postGraphql(
    SUBMISSION_LIST_QUERY,
    { offset: 0, limit: Math.max(1, Math.min(20, limit)), questionSlug: titleSlug },
    options,
  );
  return parseSubmissionListResponse(payload);
}
