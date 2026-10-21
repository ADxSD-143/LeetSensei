import { LeetSenseiError, toLeetSenseiError } from '../shared/errors';
import { toBase64 } from '../shared/hash';
import { createLogger } from '../shared/logger';
import { API_BASE, type FetchLike } from './auth';
import type {
  CommitResultSummary,
  GithubClient,
  RemoteFile,
  RemoteTree,
  RepoInfo,
  RepoListItem,
  RepoRef,
  TreeEntry,
  Viewer,
} from './types';

/**
 * GitHub REST client.
 *
 * Responsibilities kept here and nowhere else: authentication headers,
 * timeouts, bounded retry with backoff, rate-limit awareness, and mapping HTTP
 * failures onto the LeetSensei error taxonomy. Validation and authorization
 * errors are never retried.
 */

const logger = createLogger('github');

const BASE_BACKOFF_MS = 1500;
const MAX_BACKOFF_MS = 30_000;

export interface RestClientOptions {
  token: string;
  fetchImpl?: FetchLike;
  apiBase?: string;
  maxAttempts?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

interface RequestOptions {
  body?: unknown;
  allowNotFound?: boolean;
  attempts?: number;
  /** Preview/feature media type, e.g. for the recursive tree endpoint. */
  accept?: string;
}

export function encodeRepoPath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

export function decodeBase64Utf8(base64: string): string {
  const cleaned = base64.replace(/\s+/g, '');
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}

function retryAfterMs(response: Response): number | null {
  const header = response.headers.get('retry-after');
  if (header !== null) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_BACKOFF_MS);
  }
  const reset = response.headers.get('x-ratelimit-reset');
  if (reset !== null) {
    const epochSeconds = Number(reset);
    if (Number.isFinite(epochSeconds)) {
      const wait = epochSeconds * 1000 - Date.now();
      if (wait > 0) return Math.min(wait, MAX_BACKOFF_MS);
    }
  }
  return null;
}

function describeHttpError(status: number, body: string): string {
  const trimmed = body.trim();
  if (trimmed === '') return `GitHub responded with HTTP ${status}.`;
  try {
    const parsed = JSON.parse(trimmed) as { message?: unknown };
    if (typeof parsed.message === 'string' && parsed.message !== '') {
      return `GitHub responded with HTTP ${status}: ${parsed.message}`;
    }
  } catch {
    // fall through to the raw body
  }
  return `GitHub responded with HTTP ${status}.`;
}

export function mapHttpError(status: number, body: string, headers: Headers): LeetSenseiError {
  const message = describeHttpError(status, body);
  const remaining = headers.get('x-ratelimit-remaining');
  const details = { status, body: body.slice(0, 500) };

  if (status === 401) {
    return new LeetSenseiError(
      'auth_failed',
      'GitHub rejected the stored credentials. Reconnect the account.',
      { details },
    );
  }
  if (status === 403) {
    if (remaining === '0') {
      return new LeetSenseiError('rate_limited', 'GitHub API rate limit reached.', {
        retryable: true,
        details,
      });
    }
    if (/rate limit|abuse|secondary/i.test(body)) {
      return new LeetSenseiError('rate_limited', 'GitHub asked LeetSensei to slow down.', {
        retryable: true,
        details,
      });
    }
    return new LeetSenseiError('forbidden', message, { details });
  }
  if (status === 404) {
    return new LeetSenseiError(
      'not_found',
      'GitHub could not find the repository, branch or file.',
      { details },
    );
  }
  if (status === 409 || status === 422) {
    return new LeetSenseiError('remote_changed', message, { retryable: true, details });
  }
  if (status === 429) {
    return new LeetSenseiError('rate_limited', 'GitHub rate limit reached.', {
      retryable: true,
      details,
    });
  }
  if (status >= 500) {
    return new LeetSenseiError('network_error', message, { retryable: true, details });
  }
  return new LeetSenseiError('internal', message, { details });
}

export class RestGithubClient implements GithubClient {
  private readonly token: string;
  private readonly fetchImpl: FetchLike;
  private readonly apiBase: string;
  private readonly maxAttempts: number;
  private readonly timeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: RestClientOptions) {
    this.token = options.token;
    // Stored unbound on purpose: native `fetch` is a WebIDL operation on the
    // global scope and must never be invoked as a method of this instance.
    // See `fetchWithTimeout`.
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.apiBase = options.apiBase ?? API_BASE;
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 4);
    this.timeoutMs = Math.max(1000, options.timeoutMs ?? 30_000);
    this.sleep =
      options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  }

  private headers(hasBody: boolean, accept: string): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: accept,
      Authorization: `Bearer ${this.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (hasBody) headers['Content-Type'] = 'application/json';
    return headers;
  }

  private async fetchWithTimeout(
    method: string,
    url: string,
    options: RequestOptions,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      // Call `fetch` with the global object as its receiver. Writing
      // `this.fetchImpl(...)` would pass this client as `this`, and the browser
      // rejects that with "Failed to execute 'fetch' on 'WorkerGlobalScope':
      // Illegal invocation" because `fetch` is a WebIDL operation defined on the
      // global scope.
      return await this.fetchImpl.call(globalThis, url, {
        method,
        headers: this.headers(
          options.body !== undefined,
          options.accept ?? 'application/vnd.github+json',
        ),
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async request<T>(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<T | null> {
    const attempts = Math.max(1, options.attempts ?? this.maxAttempts);
    let backoff = BASE_BACKOFF_MS;
    let lastError: LeetSenseiError = new LeetSenseiError(
      'internal',
      'GitHub request failed before it was sent.',
    );

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetchWithTimeout(method, `${this.apiBase}${path}`, options);
      } catch (cause) {
        const error = toLeetSenseiError(cause, 'network_error');
        lastError = new LeetSenseiError(
          'network_error',
          `GitHub request failed: ${error.message}`,
          {
            retryable: true,
            cause,
          },
        );
        if (attempt >= attempts) throw lastError;
        logger.warn(`retrying after network failure (attempt ${attempt}/${attempts})`);
        await this.sleep(backoff);
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
        continue;
      }

      if (response.ok) {
        if (response.status === 204) return null;
        const text = await response.text();
        if (text.trim() === '') return null;
        try {
          return JSON.parse(text) as T;
        } catch (cause) {
          throw new LeetSenseiError('internal', 'GitHub returned a malformed JSON response.', {
            cause,
          });
        }
      }

      if (response.status === 404 && options.allowNotFound === true) return null;

      const body = await response.text().catch(() => '');
      const error = mapHttpError(response.status, body, response.headers);
      lastError = error;
      if (!error.retryable || attempt >= attempts) throw error;

      const wait = retryAfterMs(response) ?? backoff;
      logger.warn(`retrying after HTTP ${response.status} (attempt ${attempt}/${attempts})`);
      await this.sleep(wait);
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    }

    throw lastError;
  }

  async getViewer(): Promise<Viewer> {
    const payload = await this.request<{ login?: string }>('GET', '/user');
    if (!payload || typeof payload.login !== 'string' || payload.login === '') {
      throw new LeetSenseiError('auth_failed', 'GitHub did not return an account name.');
    }
    return { login: payload.login, scopes: [] };
  }

  async getRepo(ref: RepoRef): Promise<RepoInfo> {
    const payload = await this.request<{
      full_name?: string;
      default_branch?: string;
      private?: boolean;
      permissions?: { push?: boolean };
    }>('GET', `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`);
    if (!payload) {
      throw new LeetSenseiError('not_found', `Repository ${ref.owner}/${ref.repo} was not found.`);
    }
    return {
      fullName: payload.full_name ?? `${ref.owner}/${ref.repo}`,
      defaultBranch: payload.default_branch ?? 'main',
      isPrivate: payload.private === true,
      canPush: payload.permissions?.push !== false,
    };
  }

  async listRepos(): Promise<RepoListItem[]> {
    const payload = await this.request<{
      name?: string;
      full_name?: string;
      private?: boolean;
      default_branch?: string;
      owner?: { login?: string };
      permissions?: { push?: boolean };
    }>('GET', '/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator');
    if (!Array.isArray(payload)) return [];
    const repos: RepoListItem[] = [];
    for (const entry of payload) {
      const owner = entry.owner?.login;
      const name = entry.name;
      if (typeof owner !== 'string' || typeof name !== 'string') continue;
      // Only surface repositories the user can actually write to.
      if (entry.permissions?.push === false) continue;
      repos.push({
        owner,
        name,
        fullName: entry.full_name ?? `${owner}/${name}`,
        isPrivate: entry.private === true,
        defaultBranch: entry.default_branch ?? 'main',
      });
    }
    return repos;
  }

  async listBranches(ref: RepoRef): Promise<string[]> {
    const payload = await this.request<{ name?: string }[]>(
      'GET',
      `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/branches?per_page=100`,
    );
    if (!Array.isArray(payload)) return [];
    return payload
      .map((branch) => branch.name)
      .filter((name): name is string => typeof name === 'string')
      .sort();
  }

  async getBranchSha(ref: RepoRef): Promise<string | null> {
    const payload = await this.request<{ object?: { sha?: string } }>(
      'GET',
      `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/git/ref/heads/${encodeRepoPath(ref.branch)}`,
      { allowNotFound: true },
    );
    const sha = payload?.object?.sha;
    return typeof sha === 'string' ? sha : null;
  }

  async getCommitTreeSha(ref: RepoRef, commitSha: string): Promise<string> {
    const payload = await this.request<{ tree?: { sha?: string } }>(
      'GET',
      `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/git/commits/${commitSha}`,
    );
    const sha = payload?.tree?.sha;
    if (typeof sha !== 'string') {
      throw new LeetSenseiError('internal', 'GitHub did not return the commit tree.');
    }
    return sha;
  }

  async getRemoteTree(ref: RepoRef, commitSha: string): Promise<RemoteTree> {
    const treeSha = await this.getCommitTreeSha(ref, commitSha);
    const payload = await this.request<{
      truncated?: boolean;
      tree?: { path?: string; type?: string; sha?: string }[];
    }>(
      'GET',
      `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/git/trees/${treeSha}?recursive=1`,
    );
    const files = new Map<string, string>();
    for (const entry of payload?.tree ?? []) {
      if (
        entry.type === 'blob' &&
        typeof entry.path === 'string' &&
        typeof entry.sha === 'string'
      ) {
        files.set(entry.path, entry.sha);
      }
    }
    return { headSha: commitSha, treeSha, files, truncated: payload?.truncated === true };
  }

  async getFileContent(ref: RepoRef, path: string): Promise<RemoteFile | null> {
    const payload = await this.request<{
      content?: string;
      encoding?: string;
      sha?: string;
      type?: string;
    }>(
      'GET',
      `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/contents/${encodeRepoPath(path)}?ref=${encodeRepoPath(ref.branch)}`,
      { allowNotFound: true },
    );
    if (!payload || payload.type === 'dir') return null;
    if (typeof payload.content !== 'string' || typeof payload.sha !== 'string') return null;
    if (payload.encoding !== 'base64') {
      throw new LeetSenseiError(
        'internal',
        `Unsupported content encoding from GitHub: ${String(payload.encoding)}`,
      );
    }
    return { path, content: decodeBase64Utf8(payload.content), blobSha: payload.sha };
  }

  async createBlob(ref: RepoRef, content: string): Promise<string> {
    const payload = await this.request<{ sha?: string }>(
      'POST',
      `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/git/blobs`,
      { body: { content: toBase64(content), encoding: 'base64' } },
    );
    if (!payload || typeof payload.sha !== 'string') {
      throw new LeetSenseiError('internal', 'GitHub did not return a blob id.');
    }
    return payload.sha;
  }

  async createTree(ref: RepoRef, baseTreeSha: string, entries: TreeEntry[]): Promise<string> {
    const payload = await this.request<{ sha?: string }>(
      'POST',
      `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/git/trees`,
      {
        body: {
          base_tree: baseTreeSha,
          tree: entries.map((entry) => ({
            path: entry.path,
            mode: '100644',
            type: 'blob',
            sha: entry.blobSha,
          })),
        },
      },
    );
    if (!payload || typeof payload.sha !== 'string') {
      throw new LeetSenseiError('internal', 'GitHub did not return a tree id.');
    }
    return payload.sha;
  }

  async createCommit(
    ref: RepoRef,
    message: string,
    treeSha: string,
    parents: string[],
  ): Promise<CommitResultSummary> {
    const payload = await this.request<{ sha?: string; tree?: { sha?: string } }>(
      'POST',
      `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/git/commits`,
      { body: { message, tree: treeSha, parents } },
    );
    if (!payload || typeof payload.sha !== 'string') {
      throw new LeetSenseiError('internal', 'GitHub did not return a commit id.');
    }
    return { commitSha: payload.sha, treeSha: payload.tree?.sha ?? treeSha };
  }

  async updateBranch(ref: RepoRef, commitSha: string): Promise<void> {
    await this.request(
      'PATCH',
      `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/git/refs/heads/${encodeRepoPath(ref.branch)}`,
      // force is never true: LeetSensei must not rewrite branch history.
      { body: { sha: commitSha, force: false } },
    );
  }

  async isAncestor(ref: RepoRef, commitSha: string): Promise<boolean> {
    const payload = await this.request<{ status?: string }>(
      'GET',
      `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/compare/${commitSha}...${encodeRepoPath(ref.branch)}`,
      { allowNotFound: true, attempts: 2 },
    );
    const status = payload?.status;
    return status === 'ahead' || status === 'identical';
  }
}
