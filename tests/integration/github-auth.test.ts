import { describe, expect, it } from 'vitest';
import {
  fetchViewer,
  parseScopes,
  pollDeviceOnce,
  pollForDeviceToken,
  requireClientId,
  startDeviceFlow,
} from '../../src/github/auth';

const CLIENT_ID = 'Iv1.testclientid';

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

describe('requireClientId', () => {
  it('explains what to do when no client id is configured', () => {
    expect(() => requireClientId('')).toThrowError(/docs\/SECURITY.md/);
    expect(requireClientId('  abc  ')).toBe('abc');
  });
});

describe('startDeviceFlow', () => {
  it('returns the user code and verification uri', async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({
        device_code: 'device-123',
        user_code: 'WDJB-MJHT',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 5,
      });
    const start = await startDeviceFlow({ clientId: CLIENT_ID, scope: 'public_repo', fetchImpl });
    expect(start).toEqual({
      deviceCode: 'device-123',
      userCode: 'WDJB-MJHT',
      verificationUri: 'https://github.com/login/device',
      expiresIn: 900,
      interval: 5,
    });
  });

  it('posts the client id and scope as a form body', async () => {
    let bodySent = '';
    const fetchImpl: typeof fetch = async (_input, init) => {
      bodySent = String(init?.body ?? '');
      return jsonResponse({
        device_code: 'd',
        user_code: 'u',
        verification_uri: 'v',
        expires_in: 1,
        interval: 1,
      });
    };
    await startDeviceFlow({ clientId: CLIENT_ID, scope: 'repo', fetchImpl });
    expect(bodySent).toContain(`client_id=${CLIENT_ID}`);
    expect(bodySent).toContain('scope=repo');
  });

  it('surfaces a GitHub error', async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({ error: 'unauthorized_client' }, { status: 200 });
    await expect(
      startDeviceFlow({ clientId: CLIENT_ID, scope: 'public_repo', fetchImpl }),
    ).rejects.toMatchObject({ code: 'auth_failed' });
  });

  it('reports a network failure clearly', async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new TypeError('offline');
    };
    await expect(
      startDeviceFlow({ clientId: CLIENT_ID, scope: 'public_repo', fetchImpl }),
    ).rejects.toMatchObject({ code: 'network_error', retryable: true });
  });

  it('rejects an unreadable response instead of crashing', async () => {
    const fetchImpl: typeof fetch = async () => new Response('not json', { status: 200 });
    await expect(
      startDeviceFlow({ clientId: CLIENT_ID, scope: 'public_repo', fetchImpl }),
    ).rejects.toMatchObject({ code: 'auth_failed' });
  });

  it('rejects a payload with missing fields', async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse({ device_code: 'd' });
    await expect(
      startDeviceFlow({ clientId: CLIENT_ID, scope: 'public_repo', fetchImpl }),
    ).rejects.toMatchObject({ code: 'auth_failed' });
  });
});

describe('pollDeviceOnce', () => {
  it('returns ok with the token and scopes', async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({
        access_token: 'gho_token',
        token_type: 'bearer',
        scope: 'public_repo, read:user',
      });
    const outcome = await pollDeviceOnce({
      clientId: CLIENT_ID,
      scope: 'public_repo',
      deviceCode: 'd',
      fetchImpl,
    });
    expect(outcome).toEqual({
      status: 'ok',
      token: 'gho_token',
      scopes: ['public_repo', 'read:user'],
    });
  });

  it('reports pending and slow_down as non terminal states', async () => {
    const pending: typeof fetch = async () => jsonResponse({ error: 'authorization_pending' });
    await expect(
      pollDeviceOnce({
        clientId: CLIENT_ID,
        scope: 'public_repo',
        deviceCode: 'd',
        fetchImpl: pending,
      }),
    ).resolves.toEqual({ status: 'pending' });

    const slow: typeof fetch = async () => jsonResponse({ error: 'slow_down' });
    await expect(
      pollDeviceOnce({
        clientId: CLIENT_ID,
        scope: 'public_repo',
        deviceCode: 'd',
        fetchImpl: slow,
      }),
    ).resolves.toEqual({ status: 'slow_down' });
  });

  it('maps a denied request to an actionable message', async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse({ error: 'access_denied' });
    const outcome = await pollDeviceOnce({
      clientId: CLIENT_ID,
      scope: 'public_repo',
      deviceCode: 'd',
      fetchImpl,
    });
    expect(outcome).toMatchObject({ status: 'error' });
    if (outcome.status === 'error') expect(outcome.message).toMatch(/denied/i);
  });

  it('maps an expired code', async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse({ error: 'expired_token' });
    const outcome = await pollDeviceOnce({
      clientId: CLIENT_ID,
      scope: 'public_repo',
      deviceCode: 'd',
      fetchImpl,
    });
    expect(outcome).toMatchObject({ status: 'error' });
    if (outcome.status === 'error') expect(outcome.message).toMatch(/expired/i);
  });

  it('handles an unknown error code', async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({ error: 'weird', error_description: 'nope' });
    const outcome = await pollDeviceOnce({
      clientId: CLIENT_ID,
      scope: 'public_repo',
      deviceCode: 'd',
      fetchImpl,
    });
    expect(outcome).toMatchObject({ status: 'error' });
  });
});

describe('pollForDeviceToken', () => {
  it('keeps polling while the user has not approved yet', async () => {
    let attempt = 0;
    const fetchImpl: typeof fetch = async () => {
      attempt += 1;
      return attempt < 3
        ? jsonResponse({ error: 'authorization_pending' })
        : jsonResponse({ access_token: 'tok' });
    };
    const token = await pollForDeviceToken({
      clientId: CLIENT_ID,
      scope: 'public_repo',
      deviceCode: 'd',
      interval: 1,
      expiresIn: 600,
      fetchImpl,
      sleep: async () => undefined,
    });
    expect(token.token).toBe('tok');
    expect(attempt).toBe(3);
  });

  it('is bounded by the expiry window', async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return jsonResponse({ error: 'authorization_pending' });
    };
    await expect(
      pollForDeviceToken({
        clientId: CLIENT_ID,
        scope: 'public_repo',
        deviceCode: 'd',
        interval: 1,
        expiresIn: 2,
        fetchImpl,
        sleep: async () => undefined,
        now: (() => {
          let ticks = 0;
          return () => {
            ticks += 3000;
            return ticks;
          };
        })(),
      }),
    ).rejects.toMatchObject({ code: 'auth_failed' });
    expect(calls).toBeLessThanOrEqual(3);
  });

  it('stops when the caller aborts', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl: typeof fetch = async () => jsonResponse({ error: 'authorization_pending' });
    await expect(
      pollForDeviceToken({
        clientId: CLIENT_ID,
        scope: 'public_repo',
        deviceCode: 'd',
        interval: 1,
        expiresIn: 600,
        fetchImpl,
        signal: controller.signal,
        sleep: async () => undefined,
      }),
    ).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('propagates a terminal error immediately', async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return jsonResponse({ error: 'access_denied' });
    };
    await expect(
      pollForDeviceToken({
        clientId: CLIENT_ID,
        scope: 'public_repo',
        deviceCode: 'd',
        interval: 1,
        expiresIn: 600,
        fetchImpl,
        sleep: async () => undefined,
      }),
    ).rejects.toMatchObject({ code: 'auth_failed' });
    expect(calls).toBe(1);
  });
});

describe('fetchViewer', () => {
  it('returns the login and the reported scopes', async () => {
    const fetchImpl: typeof fetch = async (_input, init) => {
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
      return jsonResponse(
        { login: 'student' },
        { headers: { 'x-oauth-scopes': 'public_repo, gist' } },
      );
    };
    await expect(fetchViewer('tok', fetchImpl)).resolves.toEqual({
      login: 'student',
      scopes: ['public_repo', 'gist'],
    });
  });

  it('rejects an empty token without a request', async () => {
    let called = false;
    const fetchImpl: typeof fetch = async () => {
      called = true;
      return jsonResponse({});
    };
    await expect(fetchViewer('   ', fetchImpl)).rejects.toMatchObject({ code: 'auth_required' });
    expect(called).toBe(false);
  });

  it('reports an expired token', async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({ message: 'Bad credentials' }, { status: 401 });
    await expect(fetchViewer('tok', fetchImpl)).rejects.toMatchObject({ code: 'auth_failed' });
  });

  it('reports a missing login', async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse({});
    await expect(fetchViewer('tok', fetchImpl)).rejects.toMatchObject({ code: 'auth_failed' });
  });
});

describe('parseScopes', () => {
  it('parses a comma separated header', () => {
    expect(parseScopes('public_repo, repo')).toEqual(['public_repo', 'repo']);
    expect(parseScopes(null)).toEqual([]);
    expect(parseScopes('   ')).toEqual([]);
  });
});
