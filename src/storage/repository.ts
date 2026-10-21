import type { Manifest } from '../core/manifest';
import { createEmptyManifest, migrateManifest } from '../core/manifest';
import type { NormalizedSubmission, PlannedFile, RawSubmission } from '../core/model';
import { MANIFEST_PATH, REVISIONS_PATH } from '../core/paths';
import type { RevisionStore } from '../core/revisions';
import { createEmptyRevisionStore, migrateRevisionStore } from '../core/revisions';
import type { SyncStatusReport } from '../shared/messages';
import type { StorageArea } from './area';
import type { Settings } from './settings';
import { defaultSettings, normalizeSettings } from './settings';

/**
 * Typed access to everything LeetSensei keeps locally.
 *
 * Corruption is always reported and degraded safely: an unreadable manifest
 * becomes an empty one (which makes every remote file look unmanaged, so
 * conflicts are raised instead of anything being overwritten).
 */

export const STORAGE_KEYS = {
  settings: 'leetsensei:settings',
  manifest: 'leetsensei:manifest',
  revisions: 'leetsensei:revisions',
  auth: 'leetsensei:auth',
  sync: 'leetsensei:sync',
  pending: 'leetsensei:pending',
} as const;

export interface AuthState {
  token: string | null;
  login: string | null;
  scopes: string[];
  method: 'device' | 'pat' | null;
  savedAt: string | null;
}

export interface SyncState {
  /** Git blob ids of the tracker backups LeetSensei last wrote. */
  trackerShas: Record<string, string>;
  lastSyncedAt: string | null;
  status: SyncStatusReport;
  remoteHeadSha: string | null;
  remoteTreeSha: string | null;
  /** Submissions held because auto-sync is off or GitHub is not connected yet. */
  queued: RawSubmission[];
  /** Last handled submission, so "Retry" has something to replay. */
  lastSubmission: RawSubmission | null;
}

export interface PendingConflictView {
  path: string;
  state: string;
  message: string;
}

export interface PendingJob {
  submission: NormalizedSubmission;
  files: PlannedFile[];
  conflicts: PendingConflictView[];
  /** Versioned copies created while resolving conflicts. */
  preserved: string[];
  createdAt: string;
}

const MAX_QUEUED_SUBMISSIONS = 20;

export function emptyAuth(): AuthState {
  return { token: null, login: null, scopes: [], method: null, savedAt: null };
}

export function idleStatus(): SyncStatusReport {
  return {
    phase: 'idle',
    submissionId: null,
    problemTitle: null,
    problemSlug: null,
    categories: [],
    message: 'No submission synced yet.',
    errorCode: null,
    updatedAt: new Date(0).toISOString(),
    perCategory: [],
  };
}

export function emptySyncState(): SyncState {
  return {
    trackerShas: {},
    lastSyncedAt: null,
    status: idleStatus(),
    remoteHeadSha: null,
    remoteTreeSha: null,
    queued: [],
    lastSubmission: null,
  };
}

export interface LoadResult<T> {
  value: T;
  warnings: string[];
}

export class StateRepository {
  constructor(private readonly area: StorageArea) {}

  async loadSettings(): Promise<Settings> {
    const stored = await this.area.get<unknown>(STORAGE_KEYS.settings);
    return stored === undefined ? defaultSettings() : normalizeSettings(stored);
  }

  async saveSettings(settings: Settings): Promise<void> {
    await this.area.set(STORAGE_KEYS.settings, normalizeSettings(settings));
  }

  async loadManifest(): Promise<LoadResult<Manifest>> {
    const nowIso = new Date().toISOString();
    const stored = await this.area.get<unknown>(STORAGE_KEYS.manifest);
    if (stored === undefined) {
      return { value: createEmptyManifest(nowIso), warnings: [] };
    }
    const outcome = migrateManifest(stored, nowIso);
    if (!outcome.ok || !outcome.manifest) {
      return {
        value: createEmptyManifest(nowIso),
        warnings: [
          `Stored manifest could not be read (${outcome.errors[0] ?? 'unknown error'}). Starting from an empty manifest; existing repository files are treated as unmanaged and will never be overwritten silently.`,
        ],
      };
    }
    return { value: outcome.manifest, warnings: outcome.warnings };
  }

  async saveManifest(manifest: Manifest): Promise<void> {
    await this.area.set(STORAGE_KEYS.manifest, manifest);
  }

  async loadRevisions(): Promise<LoadResult<RevisionStore>> {
    const nowIso = new Date().toISOString();
    const stored = await this.area.get<unknown>(STORAGE_KEYS.revisions);
    if (stored === undefined) {
      return { value: createEmptyRevisionStore(nowIso), warnings: [] };
    }
    const outcome = migrateRevisionStore(stored, nowIso);
    if (!outcome.ok || !outcome.store) {
      return {
        value: createEmptyRevisionStore(nowIso),
        warnings: [
          `Stored revision data could not be read (${outcome.errors[0] ?? 'unknown error'}). A repository backup can be restored from the options page.`,
        ],
      };
    }
    return { value: outcome.store, warnings: outcome.warnings };
  }

  async saveRevisions(revisions: RevisionStore): Promise<void> {
    await this.area.set(STORAGE_KEYS.revisions, revisions);
  }

  async loadAuth(): Promise<AuthState> {
    const stored = await this.area.get<Partial<AuthState>>(STORAGE_KEYS.auth);
    if (!stored) return emptyAuth();
    return {
      token: typeof stored.token === 'string' && stored.token !== '' ? stored.token : null,
      login: typeof stored.login === 'string' ? stored.login : null,
      scopes: Array.isArray(stored.scopes)
        ? stored.scopes.filter((s) => typeof s === 'string')
        : [],
      method: stored.method === 'device' || stored.method === 'pat' ? stored.method : null,
      savedAt: typeof stored.savedAt === 'string' ? stored.savedAt : null,
    };
  }

  async saveAuth(auth: AuthState): Promise<void> {
    await this.area.set(STORAGE_KEYS.auth, auth);
  }

  async loadSyncState(): Promise<SyncState> {
    const stored = await this.area.get<Partial<SyncState>>(STORAGE_KEYS.sync);
    if (!stored) return emptySyncState();
    const trackerShas: Record<string, string> = {};
    if (stored.trackerShas && typeof stored.trackerShas === 'object') {
      for (const [path, sha] of Object.entries(stored.trackerShas)) {
        if (typeof sha === 'string') trackerShas[path] = sha;
      }
    }
    return {
      trackerShas,
      lastSyncedAt: typeof stored.lastSyncedAt === 'string' ? stored.lastSyncedAt : null,
      status: stored.status ?? idleStatus(),
      remoteHeadSha: typeof stored.remoteHeadSha === 'string' ? stored.remoteHeadSha : null,
      remoteTreeSha: typeof stored.remoteTreeSha === 'string' ? stored.remoteTreeSha : null,
      queued: Array.isArray(stored.queued) ? stored.queued.slice(0, MAX_QUEUED_SUBMISSIONS) : [],
      lastSubmission: stored.lastSubmission ?? null,
    };
  }

  async saveSyncState(state: SyncState): Promise<void> {
    await this.area.set(STORAGE_KEYS.sync, state);
  }

  async loadPendingJob(): Promise<PendingJob | null> {
    const stored = await this.area.get<PendingJob>(STORAGE_KEYS.pending);
    if (!stored || typeof stored !== 'object') return null;
    if (!Array.isArray(stored.files) || !Array.isArray(stored.conflicts)) return null;
    return stored;
  }

  async savePendingJob(job: PendingJob | null): Promise<void> {
    if (job === null) {
      await this.area.remove(STORAGE_KEYS.pending);
      return;
    }
    await this.area.set(STORAGE_KEYS.pending, job);
  }

  /** Known tracker backup blob ids, as a path -> sha map for the pipeline. */
  async loadTrackerShas(): Promise<Map<string, string>> {
    const sync = await this.loadSyncState();
    const entries = Object.entries(sync.trackerShas).filter(([, sha]) => sha !== '');
    if (entries.length === 0) {
      return new Map([
        [MANIFEST_PATH, ''],
        [REVISIONS_PATH, ''],
      ]);
    }
    return new Map(entries);
  }

  /** Removes credentials only; solutions, manifest and revisions stay. */
  async clearCredentials(): Promise<void> {
    await this.area.remove(STORAGE_KEYS.auth);
  }

  /** Removes every key LeetSensei owns. */
  async clearAll(): Promise<void> {
    for (const key of Object.values(STORAGE_KEYS)) {
      await this.area.remove(key);
    }
  }
}
