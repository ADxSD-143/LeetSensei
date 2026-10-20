/** GitHub integration contracts, kept narrow so a fake can implement them. */

export interface RepoRef {
  owner: string;
  repo: string;
  branch: string;
}

export interface RepoInfo {
  fullName: string;
  defaultBranch: string;
  isPrivate: boolean;
  canPush: boolean;
}

export interface RemoteTree {
  /** Current commit the branch points at. */
  headSha: string;
  /** Tree of that commit. */
  treeSha: string;
  /** Every blob in the tree: path -> Git blob id. */
  files: Map<string, string>;
  /** True when GitHub truncated the recursive listing of a very large repo. */
  truncated: boolean;
}

export interface RemoteFile {
  path: string;
  content: string;
  blobSha: string;
}

export interface TreeEntry {
  path: string;
  blobSha: string;
}

export interface CommitResultSummary {
  commitSha: string;
  treeSha: string;
}

export interface Viewer {
  login: string;
  scopes: string[];
}

export interface RepoListItem {
  owner: string;
  name: string;
  fullName: string;
  isPrivate: boolean;
  defaultBranch: string;
}

export interface GithubClient {
  getViewer(): Promise<Viewer>;
  getRepo(ref: RepoRef): Promise<RepoInfo>;
  /** Repositories the authenticated user can push to, most recently updated first. */
  listRepos(): Promise<RepoListItem[]>;
  listBranches(ref: RepoRef): Promise<string[]>;
  getBranchSha(ref: RepoRef): Promise<string | null>;
  getCommitTreeSha(ref: RepoRef, commitSha: string): Promise<string>;
  getRemoteTree(ref: RepoRef, commitSha: string): Promise<RemoteTree>;
  getFileContent(ref: RepoRef, path: string): Promise<RemoteFile | null>;
  createBlob(ref: RepoRef, content: string): Promise<string>;
  createTree(ref: RepoRef, baseTreeSha: string, entries: TreeEntry[]): Promise<string>;
  createCommit(
    ref: RepoRef,
    message: string,
    treeSha: string,
    parents: string[],
  ): Promise<CommitResultSummary>;
  updateBranch(ref: RepoRef, commitSha: string): Promise<void>;
  /** True when `commitSha` is reachable from the current branch head. */
  isAncestor(ref: RepoRef, commitSha: string): Promise<boolean>;
}
