import { LeetSenseiError } from '../src/shared/errors';
import { gitBlobSha1 } from '../src/shared/hash';
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
} from '../src/github/types';

interface CommitRecord {
  sha: string;
  treeSha: string;
  parents: string[];
  message: string;
}

/**
 * In-memory GitHub that behaves like the real thing where it matters:
 *
 * - blobs are content addressed (`gitBlobSha1`), so identical content always
 *   produces the same id, exactly as git does;
 * - a ref update is only accepted as a fast-forward, so a branch that moved
 *   under us is rejected with `remote_changed`;
 * - trees are immutable snapshots, so a commit's file list never changes.
 */
export class FakeGithubClient implements GithubClient {
  readonly ref: RepoRef = { owner: 'student', repo: 'solutions', branch: 'main' };
  readonly calls: string[] = [];

  blobs = new Map<string, string>();
  files = new Map<string, string>();
  commits = new Map<string, CommitRecord>();
  trees = new Map<string, Map<string, string>>();
  branches: string[] = ['main'];
  head: string | null = null;

  viewer: Viewer = { login: 'student', scopes: ['public_repo'] };
  repoPrivate = false;
  canPush = true;

  /** Fail this many upcoming ref updates with a `remote_changed` error. */
  conflictOnUpdate = 0;
  /** Runs just before a ref update, to simulate a concurrent push. */
  pushBeforeUpdate: (() => void) | null = null;
  /** Leaves the branch pointing elsewhere after an update, breaking verification. */
  hideCommitFromBranch = false;
  /** Fail this many upcoming calls of any kind with a network error. */
  networkFailures = 0;
  /** Makes the repository invisible, as it is to a public_repo token on a private repo. */
  repoNotFound = false;

  private treeCounter = 0;
  private commitCounter = 0;

  constructor(seed = true) {
    if (seed) this.seed();
  }

  /** Creates an initial empty commit so the branch exists. */
  seed(): void {
    const treeSha = `tree-${++this.treeCounter}`;
    this.trees.set(treeSha, new Map());
    const sha = `commit-${++this.commitCounter}`;
    this.commits.set(sha, { sha, treeSha, parents: [], message: 'Initial commit' });
    this.head = sha;
  }

  /** Seeds an existing file as if the user had created it by hand. */
  async seedFile(path: string, content: string): Promise<void> {
    const blobSha = await gitBlobSha1(content);
    this.blobs.set(blobSha, content);
    const next = new Map(this.files);
    next.set(path, blobSha);
    const treeSha = `tree-${++this.treeCounter}`;
    this.trees.set(treeSha, next);
    const sha = `commit-${++this.commitCounter}`;
    this.commits.set(sha, {
      sha,
      treeSha,
      parents: this.head === null ? [] : [this.head],
      message: `Add ${path}`,
    });
    this.head = sha;
    this.files = next;
  }

  /** Content of a path in the current head, or null. */
  contentOf(path: string): string | null {
    const blobSha = this.files.get(path);
    if (blobSha === undefined) return null;
    return this.blobs.get(blobSha) ?? null;
  }

  headFileCount(): number {
    return this.files.size;
  }

  commitCount(): number {
    return this.commits.size;
  }

  private guard(name: string): void {
    this.calls.push(name);
    if (this.networkFailures > 0) {
      this.networkFailures -= 1;
      throw new LeetSenseiError('network_error', 'simulated network failure', { retryable: true });
    }
  }

  private requireCommit(sha: string): CommitRecord {
    const commit = this.commits.get(sha);
    if (!commit) throw new LeetSenseiError('not_found', `Unknown commit ${sha}`);
    return commit;
  }

  async getViewer(): Promise<Viewer> {
    this.guard('getViewer');
    return this.viewer;
  }

  async getRepo(): Promise<RepoInfo> {
    this.guard('getRepo');
    if (this.repoNotFound) {
      throw new LeetSenseiError(
        'not_found',
        'GitHub could not find the repository, branch or file.',
      );
    }
    return {
      fullName: `${this.ref.owner}/${this.ref.repo}`,
      defaultBranch: 'main',
      isPrivate: this.repoPrivate,
      canPush: this.canPush,
    };
  }

  async listRepos(): Promise<RepoListItem[]> {
    this.guard('listRepos');
    return [
      {
        owner: this.ref.owner,
        name: this.ref.repo,
        fullName: `${this.ref.owner}/${this.ref.repo}`,
        isPrivate: this.repoPrivate,
        defaultBranch: 'main',
      },
    ];
  }

  async listBranches(): Promise<string[]> {
    this.guard('listBranches');
    return [...this.branches].sort();
  }

  async getBranchSha(ref: RepoRef): Promise<string | null> {
    this.guard('getBranchSha');
    // Honour the requested branch so destination checks can be exercised.
    if (!this.branches.includes(ref.branch)) return null;
    return this.head;
  }

  async getCommitTreeSha(_ref: RepoRef, commitSha: string): Promise<string> {
    this.guard('getCommitTreeSha');
    return this.requireCommit(commitSha).treeSha;
  }

  async getRemoteTree(_ref: RepoRef, commitSha: string): Promise<RemoteTree> {
    this.guard('getRemoteTree');
    const commit = this.requireCommit(commitSha);
    return {
      headSha: commitSha,
      treeSha: commit.treeSha,
      files: new Map(this.trees.get(commit.treeSha) ?? new Map()),
      truncated: false,
    };
  }

  async getFileContent(_ref: RepoRef, path: string): Promise<RemoteFile | null> {
    this.guard('getFileContent');
    const blobSha = this.files.get(path);
    if (blobSha === undefined) return null;
    return { path, content: this.blobs.get(blobSha) ?? '', blobSha };
  }

  async createBlob(_ref: RepoRef, content: string): Promise<string> {
    this.guard('createBlob');
    const sha = await gitBlobSha1(content);
    this.blobs.set(sha, content);
    return sha;
  }

  async createTree(_ref: RepoRef, baseTreeSha: string, entries: TreeEntry[]): Promise<string> {
    this.guard('createTree');
    const next = new Map(this.trees.get(baseTreeSha) ?? new Map());
    for (const entry of entries) next.set(entry.path, entry.blobSha);
    const treeSha = `tree-${++this.treeCounter}`;
    this.trees.set(treeSha, next);
    return treeSha;
  }

  async createCommit(
    _ref: RepoRef,
    message: string,
    treeSha: string,
    parents: string[],
  ): Promise<CommitResultSummary> {
    this.guard('createCommit');
    const sha = `commit-${++this.commitCounter}`;
    this.commits.set(sha, { sha, treeSha, parents, message });
    return { commitSha: sha, treeSha };
  }

  async updateBranch(_ref: RepoRef, commitSha: string): Promise<void> {
    this.guard('updateBranch');
    if (this.conflictOnUpdate > 0) {
      this.conflictOnUpdate -= 1;
      throw new LeetSenseiError('remote_changed', 'simulated non-fast-forward', {
        retryable: true,
      });
    }
    const commit = this.requireCommit(commitSha);
    if (this.pushBeforeUpdate !== null) {
      const action = this.pushBeforeUpdate;
      this.pushBeforeUpdate = null;
      action();
    }
    if (this.head !== null && !commit.parents.includes(this.head)) {
      throw new LeetSenseiError('remote_changed', 'simulated non-fast-forward', {
        retryable: true,
      });
    }
    const previous = this.head;
    this.head = commitSha;
    this.files = new Map(this.trees.get(commit.treeSha) ?? new Map());
    if (this.hideCommitFromBranch) this.head = previous;
  }

  async isAncestor(_ref: RepoRef, commitSha: string): Promise<boolean> {
    this.guard('isAncestor');
    let cursor = this.head;
    const seen = new Set<string>();
    while (cursor !== null && !seen.has(cursor)) {
      if (cursor === commitSha) return true;
      seen.add(cursor);
      cursor = this.requireCommit(cursor).parents[0] ?? null;
    }
    return false;
  }
}
