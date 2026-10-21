import { LeetSenseiError } from '../shared/errors';
import type { Viewer } from './types';

/**
 * GitHub OAuth Device Flow.
 *
 * This is the flow a public extension can use safely: it needs only a public
 * `client_id` (which is not a secret) and never a client secret, so nothing
 * confidential ships in the extension bundle. The user approves the request in
 * their own browser session, and LeetSensei never sees a password.
 *
 * Docs: https://docs.github.com/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps
 */

export const DEVICE_CODE_URL = 'https://github.com/login/device/code';
export const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
export const API_BASE = 'https://api.github.com';
export const DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';

export type FetchLike = typeof fetch;

export interface DeviceFlowStart {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export interface DeviceFlowOptions {
  clientId: string;
  scope: string;
  fetchImpl?: FetchLike;
}

function fetchOf(options: { fetchImpl?: FetchLike }): FetchLike {
  const f = options.fetchImpl ?? fetch;
  return (input, init) => f.call(globalThis, input, init);
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    throw new Error('unexpected payload shape');
  } catch {
    throw new LeetSenseiError(
      'auth_failed',
      'GitHub returned an unreadable authorization response.',
    );
  }
}

function requireString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value === 'string' && value !== '') return value;
  throw new LeetSenseiError('auth_failed', `GitHub response was missing "${key}".`);
}

function requireNumber(source: Record<string, unknown>, key: string): number {
  const value = source[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw new LeetSenseiError('auth_failed', `GitHub response was missing "${key}".`);
}

export function requireClientId(clientId: string): string {
  const trimmed = clientId.trim();
  if (trimmed === '') {
    throw new LeetSenseiError(
      'auth_failed',
      'No GitHub OAuth client id is configured for this build. See docs/SECURITY.md for how to register one, or paste a personal access token in the options page.',
    );
  }
  return trimmed;
}

export async function startDeviceFlow(options: DeviceFlowOptions): Promise<DeviceFlowStart> {
  const clientId = requireClientId(options.clientId);
  const body = new URLSearchParams({ client_id: clientId, scope: options.scope });

  let response: Response;
  try {
    response = await fetchOf(options)(DEVICE_CODE_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  } catch (cause) {
    throw new LeetSenseiError('network_error', 'Could not reach GitHub to start sign-in.', {
      retryable: true,
      cause,
    });
  }

  const payload = await readJson(response);
  if (!response.ok || typeof payload.error === 'string') {
    throw new LeetSenseiError('auth_failed', describeDeviceError(payload), {
      details: { status: response.status, error: payload.error },
    });
  }

  return {
    deviceCode: requireString(payload, 'device_code'),
    userCode: requireString(payload, 'user_code'),
    verificationUri: requireString(payload, 'verification_uri'),
    expiresIn: requireNumber(payload, 'expires_in'),
    interval: requireNumber(payload, 'interval'),
  };
}

export interface PollOptions extends DeviceFlowOptions {
  deviceCode: string;
  interval: number;
  expiresIn: number;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface AuthToken {
  token: string;
  scopes: string[];
}

export type DevicePollOutcome =
  | { status: 'ok'; token: string; scopes: string[] }
  | { status: 'pending' }
  | { status: 'slow_down' }
  | { status: 'error'; message: string };

/**
 * A single token request. The options page drives the loop itself so a service
 * worker restart cannot drop a long-lived message channel mid sign-in.
 */
export async function pollDeviceOnce(
  options: DeviceFlowOptions & { deviceCode: string },
): Promise<DevicePollOutcome> {
  const clientId = requireClientId(options.clientId);
  const body = new URLSearchParams({
    client_id: clientId,
    device_code: options.deviceCode,
    grant_type: DEVICE_GRANT_TYPE,
  });

  let response: Response;
  try {
    response = await fetchOf(options)(ACCESS_TOKEN_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  } catch (cause) {
    throw new LeetSenseiError('network_error', 'Lost contact with GitHub while signing in.', {
      retryable: true,
      cause,
    });
  }

  const payload = await readJson(response);
  const token = payload.access_token;
  if (typeof token === 'string' && token !== '') {
    return {
      status: 'ok',
      token,
      scopes:
        typeof payload.scope === 'string' ? payload.scope.split(/[,\s]+/).filter(Boolean) : [],
    };
  }

  const error = typeof payload.error === 'string' ? payload.error : '';
  if (error === 'authorization_pending') return { status: 'pending' };
  if (error === 'slow_down') return { status: 'slow_down' };
  if (error === '') {
    return { status: 'error', message: 'GitHub authorization failed without an error code.' };
  }
  const known = TERMINAL_DEVICE_ERRORS[error];
  return { status: 'error', message: known?.message ?? describeDeviceError(payload) };
}

/**
 * Polls until the user approves, the code expires, or the caller aborts.
 * `authorization_pending` keeps waiting; `slow_down` increases the interval,
 * exactly as the device flow specification requires.
 */
export async function pollForDeviceToken(options: PollOptions): Promise<AuthToken> {
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? (() => Date.now());

  let intervalMs = Math.max(1, options.interval) * 1000;
  const deadline = now() + Math.max(1, options.expiresIn) * 1000;

  for (;;) {
    if (options.signal?.aborted === true) {
      throw new LeetSenseiError('cancelled', 'GitHub sign-in was cancelled.');
    }
    if (now() >= deadline) {
      throw new LeetSenseiError(
        'auth_failed',
        'The sign-in code expired before it was approved. Start again to get a new code.',
      );
    }

    const outcome = await pollDeviceOnce({
      clientId: options.clientId,
      deviceCode: options.deviceCode,
      scope: options.scope,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });

    if (outcome.status === 'ok') return { token: outcome.token, scopes: outcome.scopes };
    if (outcome.status === 'slow_down') {
      intervalMs += 5000;
    } else if (outcome.status === 'error') {
      throw new LeetSenseiError('auth_failed', outcome.message);
    }

    if (now() + intervalMs > deadline) {
      throw new LeetSenseiError(
        'auth_failed',
        'The sign-in code expired before it was approved. Start again to get a new code.',
      );
    }
    await sleep(intervalMs);
  }
}

const TERMINAL_DEVICE_ERRORS: Record<
  string,
  { code: 'auth_denied' | 'auth_failed'; message: string }
> = {
  access_denied: {
    code: 'auth_denied',
    message: 'The GitHub authorization request was denied.',
  },
  expired_token: {
    code: 'auth_failed',
    message: 'The sign-in code expired before it was approved. Start again to get a new code.',
  },
  incorrect_client_credentials: {
    code: 'auth_failed',
    message: 'GitHub rejected the configured client id.',
  },
  unsupported_grant_type: {
    code: 'auth_failed',
    message: 'GitHub rejected the device authorization grant.',
  },
  incorrect_device_code: {
    code: 'auth_failed',
    message: 'GitHub rejected the device code. Start again to get a new code.',
  },
};

function describeDeviceError(payload: Record<string, unknown>): string {
  const error = typeof payload.error === 'string' ? payload.error : '';
  const description =
    typeof payload.error_description === 'string' ? payload.error_description : '';
  const known = TERMINAL_DEVICE_ERRORS[error];
  if (known) return known.message;
  if (description !== '') return `GitHub authorization failed: ${description}`;
  return 'GitHub authorization failed.';
}

export function parseScopes(headerValue: string | null): string[] {
  if (headerValue === null || headerValue.trim() === '') return [];
  return headerValue
    .split(',')
    .map((scope) => scope.trim())
    .filter((scope) => scope !== '');
}

/**
 * Confirms a token works and reports the scopes GitHub says it has. Used by the
 * options page ("Verify") and before the first sync.
 */
export async function fetchViewer(token: string, fetchImpl?: FetchLike): Promise<Viewer> {
  if (token.trim() === '') {
    throw new LeetSenseiError('auth_required', 'No GitHub token is stored.');
  }
  const doFetch = fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch.call(globalThis, `${API_BASE}/user`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
  } catch (cause) {
    throw new LeetSenseiError('network_error', 'Could not reach GitHub to verify the account.', {
      retryable: true,
      cause,
    });
  }

  if (response.status === 401) {
    throw new LeetSenseiError('auth_failed', 'The GitHub token is invalid or has expired.', {
      details: { status: 401 },
    });
  }
  if (!response.ok) {
    throw new LeetSenseiError(
      'forbidden',
      `GitHub rejected the account check (HTTP ${response.status}).`,
    );
  }

  const payload = (await response.json()) as { login?: unknown };
  if (typeof payload.login !== 'string' || payload.login === '') {
    throw new LeetSenseiError('auth_failed', 'GitHub did not return an account name.');
  }
  return { login: payload.login, scopes: parseScopes(response.headers.get('x-oauth-scopes')) };
}
