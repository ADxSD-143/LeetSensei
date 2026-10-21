import { describe, expect, it } from 'vitest';
import {
  decodeBase64Utf8,
  encodeRepoPath,
  mapHttpError,
  RestGithubClient,
} from '../../src/github/client';
import { LeetSenseiError } from '../../src/shared/errors';
import { gitBlobSha1, toBase64 } from '../../src/shared/hash';
import type { RepoRef } from '../../src/github/types';

const REF: RepoRef = { owner: 'student', repo: 'solutions', branch: 'main' };

interface Recorded {
  method: string;
  url: string;
  body: unknown;
  headers: Record<string, string>;
}

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

function textResponse(
  body: string,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(body, { status, headers });
}

function makeFetch(responses: (request: Recorded) => Response | Promise<Response>) {
  const calls: Recorded[] = [];
  const impl: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    const recorded: Recorded = { method: init?.method ?? 'GET', url, body, headers };
    calls.push(recorded);
    return responses(recorded);
  };
  return { impl, calls };
}

function makeClient(
  responses: (request: Recorded) => Response | Promise<Response>,
  options: { maxAttempts?: number } = {},
) {
  const { impl, calls } = makeFetch(responses);
  const sleeps: number[] = [];
  const client = new RestGithubClient({
    token: 'gho_test_token_value',
    fetchImpl: impl,
    apiBase: 'https://api.example.test',
    maxAttempts: options.maxAttempts ?? 3,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  return { client, calls, sleeps };
}

/**
 * A fake `fetch` that enforces the same brand check the platform does.
 *
 * Native `fetch` is a WebIDL operation on the global scope: invoking it with a
 * `this` that is neither `undefined` nor the global object throws
 * "Failed to execute 'fetch' on 'WorkerGlobalScope': Illegal invocation".
 * A plain function fake accepts any receiver, which is exactly how that bug
 * reached a real browser, so this stub makes the platform rule testable in Node.
 */
function makeBrandCheckedFetch(respond: (request: Recorded) => Response | Promise<Response>) {
  const calls: Recorded[] = [];
  const impl = async function brandCheckedFetch(
    this: unknown,
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    if (this !== undefined && this !== globalThis) {
      throw new TypeError("Failed to execute 'fetch' on 'WorkerGlobalScope': Illegal invocation");
    }
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    const recorded: Recorded = { method: init?.method ?? 'GET', url, body, headers };
    calls.push(recorded);
    return respond(recorded);
  };
  return { impl: impl as unknown as typeof fetch, calls };
}

function makeStrictClient(responses: (request: Recorded) => Response | Promise<Response>): {
  client: RestGithubClient;
  calls: Recorded[];
} {
  const { impl, calls } = makeBrandCheckedFetch(responses);
  const client = new RestGithubClient({
    token: 'gho_test_token_value',
    fetchImpl: impl,
    apiBase: 'https://api.example.test',
    maxAttempts: 1,
    sleep: async () => undefined,
  });
  return { client, calls };
}

describe('encodeRepoPath', () => {
  it('escapes each segment but keeps the separators', () => {
    expect(encodeRepoPath('Hash-Table/0217-x/solution.py')).toBe('Hash-Table/0217-x/solution.py');
    expect(encodeRepoPath('a b/c#d/e.py')).toBe('a%20b/c%23d/e.py');
  });
});

describe('decodeBase64Utf8', () => {
  it('round-trips non ascii content', () => {
    expect(decodeBase64Utf8(toBase64('héllo → ✓'))).toBe('héllo → ✓');
  });

  it('tolerates the line breaks GitHub inserts', () => {
    expect(decodeBase64Utf8('aGVs\nbG8=')).toBe('hello');
  });
});

describe('mapHttpError', () => {
  it('maps statuses onto the taxonomy without retrying terminal errors', () => {
    const headers = new Headers();
    expect(mapHttpError(401, '', headers).code).toBe('auth_failed');
    expect(mapHttpError(401, '', headers).retryable).toBe(false);
    expect(mapHttpError(403, 'forbidden', headers).code).toBe('forbidden');
    expect(mapHttpError(404, '', headers).code).toBe('not_found');
    expect(mapHttpError(422, 'invalid', headers).code).toBe('remote_changed');
    expect(mapHttpError(429, '', headers).code).toBe('rate_limited');
    expect(mapHttpError(503, '', headers).code).toBe('network_error');
    expect(mapHttpError(503, '', headers).retryable).toBe(true);
  });

  it('detects a rate limit from the remaining header', () => {
    const headers = new Headers({ 'x-ratelimit-remaining': '0' });
    const error = mapHttpError(403, 'API rate limit exceeded', headers);
    expect(error.code).toBe('rate_limited');
    expect(error.retryable).toBe(true);
  });

  it('extracts the GitHub message', () => {
    const error = mapHttpError(422, JSON.stringify({ message: 'Invalid tree' }), new Headers());
    expect(error.message).toContain('Invalid tree');
  });
});

describe('RestGithubClient', () => {
  it('sends an authenticated request', async () => {
    const { client, calls } = makeClient(() => jsonResponse({ login: 'student' }));
    const viewer = await client.getViewer();
    expect(viewer.login).toBe('student');
    expect(calls[0]?.headers.Authorization).toBe('Bearer gho_test_token_value');
    expect(calls[0]?.url).toBe('https://api.example.test/user');
  });

  it('does not retry an authentication failure', async () => {
    const { client, calls } = makeClient(() => textResponse('bad credentials', 401));
    await expect(client.getViewer()).rejects.toMatchObject({ code: 'auth_failed' });
    expect(calls).toHaveLength(1);
  });

  it('does not retry a not-found failure', async () => {
    const { client, calls } = makeClient(() => textResponse('Not Found', 404));
    await expect(client.getRepo(REF)).rejects.toMatchObject({ code: 'not_found' });
    expect(calls).toHaveLength(1);
  });

  it('returns null for an allowed 404', async () => {
    const { client, calls } = makeClient(() => textResponse('Not Found', 404));
    await expect(client.getFileContent(REF, 'missing.py')).resolves.toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('retries a rate limited response and honours retry-after', async () => {
    let attempt = 0;
    const { client, sleeps } = makeClient(() => {
      attempt += 1;
      if (attempt === 1) {
        return textResponse('rate limited', 403, {
          'x-ratelimit-remaining': '0',
          'retry-after': '2',
        });
      }
      return jsonResponse({ login: 'student' });
    });
    await expect(client.getViewer()).resolves.toMatchObject({ login: 'student' });
    expect(attempt).toBe(2);
    expect(sleeps[0]).toBe(2000);
  });

  it('retries a server error and then succeeds', async () => {
    let attempt = 0;
    const { client } = makeClient(() => {
      attempt += 1;
      return attempt === 1 ? textResponse('boom', 500) : jsonResponse({ login: 'student' });
    });
    await expect(client.getViewer()).resolves.toMatchObject({ login: 'student' });
    expect(attempt).toBe(2);
  });

  it('retries a transport failure and then gives up', async () => {
    let attempt = 0;
    const impl: typeof fetch = async () => {
      attempt += 1;
      throw new TypeError('Failed to fetch');
    };
    const client = new RestGithubClient({
      token: 't',
      fetchImpl: impl,
      maxAttempts: 2,
      sleep: async () => undefined,
    });
    await expect(client.getViewer()).rejects.toMatchObject({
      code: 'network_error',
      retryable: true,
    });
    expect(attempt).toBe(2);
  });

  it('gives up after the configured number of attempts on a rate limit', async () => {
    let attempt = 0;
    const { client } = makeClient(
      () => {
        attempt += 1;
        return textResponse('rate limited', 429, { 'retry-after': '1' });
      },
      { maxAttempts: 3 },
    );
    await expect(client.getViewer()).rejects.toMatchObject({ code: 'rate_limited' });
    expect(attempt).toBe(3);
  });

  it('parses a recursive tree and skips non blobs', async () => {
    const { client } = makeClient((request) => {
      if (request.url.endsWith('/git/commits/abc')) {
        return jsonResponse({ tree: { sha: 'tree-1' } });
      }
      return jsonResponse({
        truncated: true,
        tree: [
          { path: 'Arrays', type: 'tree', sha: 'sub' },
          { path: 'Arrays/0217-x/solution.py', type: 'blob', sha: 'blob-1' },
          { path: 'Arrays/0217-x/README.md', type: 'blob', sha: 'blob-2' },
          { path: 'no-sha', type: 'blob' },
        ],
      });
    });

    const tree = await client.getRemoteTree(REF, 'abc');
    expect(tree).toMatchObject({ headSha: 'abc', treeSha: 'tree-1', truncated: true });
    expect([...tree.files.keys()]).toEqual([
      'Arrays/0217-x/solution.py',
      'Arrays/0217-x/README.md',
    ]);
  });

  it('base64-encodes blob content', async () => {
    const { client, calls } = makeClient(() => jsonResponse({ sha: 'blob-1' }));
    const sha = await client.createBlob(REF, 'print("héllo")');
    expect(sha).toBe('blob-1');
    expect(calls[0]?.body).toEqual({ content: toBase64('print("héllo")'), encoding: 'base64' });
  });

  it('never asks GitHub to force a ref update', async () => {
    const { client, calls } = makeClient(() => jsonResponse({}));
    await client.updateBranch(REF, 'commit-1');
    expect(calls[0]?.body).toEqual({ sha: 'commit-1', force: false });
  });

  it('builds a tree from a base tree', async () => {
    const { client, calls } = makeClient(() => jsonResponse({ sha: 'tree-2' }));
    await client.createTree(REF, 'tree-1', [{ path: 'a/b.py', blobSha: 'blob-1' }]);
    expect(calls[0]?.body).toEqual({
      base_tree: 'tree-1',
      tree: [{ path: 'a/b.py', mode: '100644', type: 'blob', sha: 'blob-1' }],
    });
  });

  it('treats a directory response as a missing file', async () => {
    const { client } = makeClient(() => jsonResponse([{ name: 'x' }]));
    await expect(client.getFileContent(REF, 'Arrays')).resolves.toBeNull();
  });

  it('decodes file content', async () => {
    const content = 'def solution():\n    pass\n';
    const blobSha = await gitBlobSha1(content);
    const { client } = makeClient(() =>
      jsonResponse({ content: toBase64(content), encoding: 'base64', sha: blobSha, type: 'file' }),
    );
    const file = await client.getFileContent(REF, 'Arrays/0217-x/solution.py');
    expect(file).toEqual({ path: 'Arrays/0217-x/solution.py', content, blobSha });
  });

  it('resolves ancestry from the compare endpoint', async () => {
    const { client } = makeClient((request) =>
      request.url.includes('/compare/')
        ? jsonResponse({ status: 'ahead' })
        : jsonResponse({ status: 'behind' }),
    );
    await expect(client.isAncestor(REF, 'commit-1')).resolves.toBe(true);
  });

  it('treats a missing comparison as not an ancestor', async () => {
    const { client } = makeClient(() => textResponse('Not Found', 404));
    await expect(client.isAncestor(REF, 'gone')).resolves.toBe(false);
  });

  it('refuses to build a bare LeetSensei error', () => {
    expect(new LeetSenseiError('internal', 'x').retryable).toBe(false);
  });

  it('filters repositories without push permission', async () => {
    const { client } = makeClient(() =>
      jsonResponse([
        {
          name: 'solutions',
          full_name: 'student/solutions',
          owner: { login: 'student' },
          permissions: { push: true },
        },
        {
          name: 'read-only',
          full_name: 'someone/read-only',
          owner: { login: 'someone' },
          permissions: { push: false },
        },
      ]),
    );
    const repos = await client.listRepos();
    expect(repos.map((repo) => repo.fullName)).toEqual(['student/solutions']);
  });

  it('returns an empty branch list for an unexpected payload', async () => {
    const { client } = makeClient(() => jsonResponse({ not: 'an array' }));
    await expect(client.listBranches(REF)).resolves.toEqual([]);
  });
});

/**
 * Regression tests for the "Illegal invocation" failure seen in Brave when the
 * options page loaded the repository list.
 *
 * The client used to invoke its stored fetch as a method (`this.fetchImpl(...)`),
 * which passes the client instance as `this`. The browser rejects that for a
 * WebIDL operation on the global scope, and the error surfaced as
 * "GitHub request failed: Failed to execute 'fetch' on 'WorkerGlobalScope':
 * Illegal invocation". Before the fix, both tests below rejected.
 */
describe('fetch invocation contract', () => {
  it('lists repositories without triggering the native fetch brand check', async () => {
    const { client, calls } = makeStrictClient(() =>
      jsonResponse([
        {
          name: 'solutions',
          full_name: 'student/solutions',
          owner: { login: 'student' },
          permissions: { push: true },
        },
      ]),
    );

    await expect(client.listRepos()).resolves.toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  it('loads branches without triggering the native fetch brand check', async () => {
    const { client, calls } = makeStrictClient(() =>
      jsonResponse([{ name: 'main' }, { name: 'solution-sync' }]),
    );

    await expect(client.listBranches(REF)).resolves.toEqual(['main', 'solution-sync']);
    expect(calls).toHaveLength(1);
  });

  it('does the same for every other request path', async () => {
    // The brand check must hold for reads, writes and the ancestry check alike.
    const { client } = makeStrictClient((request) => {
      if (request.url.endsWith('/user')) return jsonResponse({ login: 'student' });
      if (request.url.includes('/git/commits/')) return jsonResponse({ tree: { sha: 'tree-1' } });
      if (request.url.includes('/compare/')) return jsonResponse({ status: 'identical' });
      return jsonResponse({ sha: 'blob-1' });
    });

    await expect(client.getViewer()).resolves.toMatchObject({ login: 'student' });
    await expect(client.createBlob(REF, 'x')).resolves.toBe('blob-1');
    await expect(client.isAncestor(REF, 'commit-1')).resolves.toBe(true);
  });

  it('sends repository listing on the authenticated path', async () => {
    const { client, calls } = makeStrictClient(() => jsonResponse([]));
    await client.listRepos();

    expect(calls[0]).toEqual({
      method: 'GET',
      url: 'https://api.example.test/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator',
      body: undefined,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer gho_test_token_value',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
  });

  it('sends branch listing on the authenticated path', async () => {
    const { client, calls } = makeStrictClient(() => jsonResponse([]));
    await client.listBranches(REF);

    expect(calls[0]).toEqual({
      method: 'GET',
      url: 'https://api.example.test/repos/student/solutions/branches?per_page=100',
      body: undefined,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer gho_test_token_value',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
  });

  it('still authenticates and maps failures when the brand check is enforced', async () => {
    const { client } = makeStrictClient(() => textResponse('Bad credentials', 401));
    await expect(client.listRepos()).rejects.toMatchObject({ code: 'auth_failed' });
  });
});
