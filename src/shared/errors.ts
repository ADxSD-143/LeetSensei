/**
 * Central error taxonomy. Every user-facing failure path maps to one of these
 * codes so the UI can render an actionable message instead of a raw stack.
 */
export type ErrorCode =
  | 'not_accepted'
  | 'unsupported_language'
  | 'missing_metadata'
  | 'extraction_failed'
  | 'unsafe_path'
  | 'invalid_manifest'
  | 'invalid_revision_data'
  | 'invalid_settings'
  | 'auth_required'
  | 'auth_failed'
  | 'auth_denied'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'network_error'
  | 'conflict'
  | 'remote_changed'
  | 'validation_failed'
  | 'not_connected'
  | 'no_changes'
  | 'cancelled'
  | 'internal';

export interface LeetSenseiErrorOptions {
  retryable?: boolean;
  details?: Record<string, unknown>;
  cause?: unknown;
}

export class LeetSenseiError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly details: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, options: LeetSenseiErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'LeetSenseiError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.details = options.details ?? {};
  }

  toJSON(): {
    name: string;
    code: ErrorCode;
    message: string;
    retryable: boolean;
    details: Record<string, unknown>;
  } {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      details: this.details,
    };
  }
}

const RETRYABLE_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'network_error',
  'rate_limited',
  'remote_changed',
]);

/** Normalises anything thrown into a LeetSenseiError. */
export function toLeetSenseiError(
  error: unknown,
  fallbackCode: ErrorCode = 'internal',
): LeetSenseiError {
  if (error instanceof LeetSenseiError) return error;
  if (error instanceof Error) {
    return new LeetSenseiError(fallbackCode, error.message, { cause: error });
  }
  return new LeetSenseiError(fallbackCode, String(error));
}

export function isRetryable(error: unknown): boolean {
  if (error instanceof LeetSenseiError) {
    return error.retryable || RETRYABLE_CODES.has(error.code);
  }
  return false;
}

/** User-facing copy for every code. Kept free of jargon and never leaks secrets. */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  not_accepted: 'That submission was not Accepted, so nothing was synced.',
  unsupported_language: 'LeetSensei does not support this submission language yet.',
  missing_metadata: 'LeetCode did not return all the problem details LeetSensei needs.',
  extraction_failed: 'The submission could not be read from the LeetCode page.',
  unsafe_path: 'A generated repository path failed the safety check, so nothing was written.',
  invalid_manifest: 'The stored manifest is not valid and could not be read.',
  invalid_revision_data: 'The revision data is not valid and could not be read.',
  invalid_settings: 'Some settings are invalid.',
  auth_required: 'Connect a GitHub account to continue.',
  auth_failed: 'GitHub authorization failed.',
  auth_denied: 'GitHub authorization was denied.',
  forbidden: 'GitHub rejected the request. Check the account permissions for the repository.',
  not_found: 'The repository, branch, or file was not found.',
  rate_limited: 'GitHub rate limit reached. LeetSensei will retry later.',
  network_error: 'The network request failed. Check your connection and retry.',
  conflict: 'The destination file changed and needs your decision before syncing.',
  remote_changed: 'The branch changed while syncing. Retrying against the latest commit.',
  validation_failed: 'GitHub rejected the generated content.',
  not_connected: 'No GitHub repository is selected yet.',
  no_changes: 'Everything was already up to date; nothing needed to be written.',
  cancelled: 'Cancelled.',
  internal: 'Something went wrong inside LeetSensei.',
};

export function messageForError(error: unknown): string {
  const known = toLeetSenseiError(error);
  return known.message || ERROR_MESSAGES[known.code];
}
