import { VERSION } from '../config';
import { MANIFEST_PATH, REVISIONS_PATH } from '../core/paths';
import { migrateManifest } from '../core/manifest';
import { createEmptyRevisionStore, migrateRevisionStore, applyReview } from '../core/revisions';
import { completeSync, prepareSync, type PreparedSync } from '../core/pipeline';
import { renderTrackerJson, type PlanResult } from '../core/plan';
import { applyConflictDecision } from '../core/resolve';
import type { ConflictDecision } from '../core/conflicts';
import type { PlannedFile, RawSubmission, ReviewRating, SyncPlan } from '../core/model';
import { summarizeSchedule } from '../core/schedule';
import type { ErrorCode } from '../shared/errors';
import { LeetSenseiError, messageForError, toLeetSenseiError } from '../shared/errors';
import { createLogger } from '../shared/logger';
import type { SyncStatusReport } from '../shared/messages';
import { gitBlobSha1 } from '../shared/hash';
import { commitFiles } from '../github/commit';
import { loadRemoteTree, pushPlan } from '../github/sync';
import type { GithubClient, RemoteTree, RepoListItem, RepoRef } from '../github/types';
import type { PendingJob, SyncState } from '../storage/repository';
import { StateRepository } from '../storage/repository';
import type { Settings } from '../storage/settings';
import { isRepoConfigured } from '../storage/settings';
import { buildOverview, type Overview } from './overview';

/**
 * Sync coordinator.
 *
 * The single place that turns a detected submission into repository content. It
 * is deliberately the only module that mutates the manifest and revision store,
 * and it serialises every operation so two submissions can never interleave
 * into a half-written commit.
 */

const logger = createLogger('coordinator');

const MAX_AUTO_RETRIES = 2;

export interface CoordinatorOptions {
  repository: StateRepository;
  createClient: (token: string) => GithubClient;
  now?: () => Date;
  onStatus?: (status: SyncStatusReport) => void;
}

export interface OperationResult {
  ok: boolean;
  message: string;
  code?: ErrorCode;
}

export interface RestoreResult extends OperationResult {
  problemsAdded: number;
  revisionsAdded: number;
}

export class SyncCoordinator {
  private readonly repository: StateRepository;
  private readonly createClient: (token: string) => GithubClient;
  private readonly now: () => Date;
  private readonly onStatus: (status: SyncStatusReport) => void;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(options: CoordinatorOptions) {
    this.repository = options.repository;
    this.createClient = options.createClient;
    this.now = options.now ?? (() => new Date());
    this.onStatus = options.onStatus ?? (() => undefined);
  }

  /** Serialises operations so concurrent messages cannot interleave writes. */
  private run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.tail.then(task, task);
    this.tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private nowIso(): string {
    return this.now().toISOString();
  }

  private refFrom(settings: Settings): RepoRef {
    if (!isRepoConfigured(settings)) {
      throw new LeetSenseiError(
        'not_connected',
        'Choose a GitHub repository and branch in the options page first.',
      );
    }
    return { owner: settings.repoOwner, repo: settings.repoName, branch: settings.branch };
  }

  private async publish(syncState: SyncState, status: SyncStatusReport): Promise<SyncStatusReport> {
    syncState.status = status;
    await this.repository.saveSyncState(syncState);
    this.onStatus(status);
    return status;
  }

  private statusPatch(partial: Partial<SyncStatusReport>): SyncStatusReport {
    return {
      phase: 'idle',
      submissionId: null,
      problemTitle: null,
      problemSlug: null,
      categories: [],
      message: '',
      errorCode: null,
      perCategory: [],
      updatedAt: this.nowIso(),
      ...partial,
    };
  }

  private async fail(
    syncState: SyncState,
    error: unknown,
    context: { submissionId?: string; problemTitle?: string | null; problemSlug?: string | null },
  ): Promise<SyncStatusReport> {
    const known = toLeetSenseiError(error);
    logger.warn(`sync failed (${known.code}): ${known.message}`);
    return this.publish(
      syncState,
      this.statusPatch({
        phase: 'failed',
        submissionId: context.submissionId ?? null,
        problemTitle: context.problemTitle ?? null,
        problemSlug: context.problemSlug ?? null,
        message: messageForError(known),
        errorCode: known.code,
      }),
    );
  }

  private blockReason(settings: Settings, auth: { token: string | null }): string | null {
    if (auth.token === null) {
      return 'Connect a GitHub account to start syncing. This submission is held until you do.';
    }
    if (!isRepoConfigured(settings)) {
      return 'Choose a destination repository in the options page. This submission is held until you do.';
    }
    return null;
  }

  private cached?: {
    refKey: string;
    headSha: string;
    treeSha: string;
    files: Map<string, string>;
    loadedAt: number;
  };

  /** Reuses a tree read made moments ago instead of re-listing the repository. */
  private async remoteTree(
    client: GithubClient,
    ref: RepoRef,
    syncState: SyncState,
    force = false,
  ): Promise<RemoteTree> {
    const fresh = this.cached;
    const refKey = `${ref.owner}/${ref.repo}@${ref.branch}`;
    const canReuse =
      !force &&
      fresh !== undefined &&
      fresh.refKey === refKey &&
      fresh.headSha === syncState.remoteHeadSha &&
      this.now().getTime() - fresh.loadedAt < 30_000;
    if (canReuse && fresh) {
      return {
        headSha: fresh.headSha,
        treeSha: fresh.treeSha,
        files: fresh.files,
        truncated: false,
      };
    }
    const tree = await loadRemoteTree(client, ref);
    syncState.remoteHeadSha = tree.headSha;
    syncState.remoteTreeSha = tree.treeSha;
    this.cached = {
      refKey,
      headSha: tree.headSha,
      treeSha: tree.treeSha,
      files: tree.files,
      loadedAt: this.now().getTime(),
    };
    return tree;
  }

  // ---------------------------------------------------------------- submission

  async handleAccepted(raw: RawSubmission): Promise<SyncStatusReport> {
    return this.run(async () => {
      const settings = await this.repository.loadSettings();
      const syncState = await this.repository.loadSyncState();
      const auth = await this.repository.loadAuth();
      syncState.lastSubmission = raw;

      if (!settings.detectSubmissions) {
        return this.publish(
          syncState,
          this.statusPatch({
            phase: 'idle',
            message: 'Submission detection is turned off in settings, so nothing was synced.',
          }),
        );
      }

      const blocked = this.blockReason(settings, auth);
      if (blocked !== null) {
        syncState.queued = [...syncState.queued, raw].slice(-20);
        await this.repository.saveSyncState(syncState);
        return this.publish(
          syncState,
          this.statusPatch({
            phase: 'detected',
            submissionId: raw.submissionId,
            problemTitle: raw.problemTitle,
            problemSlug: raw.titleSlug,
            message: blocked,
          }),
        );
      }

      if (!settings.autoSync) {
        syncState.queued = [...syncState.queued, raw].slice(-20);
        await this.repository.saveSyncState(syncState);
        return this.publish(
          syncState,
          this.statusPatch({
            phase: 'detected',
            submissionId: raw.submissionId,
            problemTitle: raw.problemTitle,
            problemSlug: raw.titleSlug,
            message: `Held for manual sync (${syncState.queued.length} waiting).`,
          }),
        );
      }

      return this.syncNow(raw, settings, syncState, auth.token);
    });
  }

  /** Syncs the headline submission of the queue, if any. */
  async syncQueued(): Promise<SyncStatusReport> {
    return this.run(async () => {
      const settings = await this.repository.loadSettings();
      const syncState = await this.repository.loadSyncState();
      const auth = await this.repository.loadAuth();
      const [next, ...rest] = syncState.queued;
      if (next === undefined) {
        return this.publish(
          syncState,
          this.statusPatch({ phase: 'idle', message: 'Nothing is waiting to sync.' }),
        );
      }
      syncState.queued = rest;
      const blocked = this.blockReason(settings, auth);
      if (blocked !== null) {
        syncState.queued = [next, ...rest];
        await this.repository.saveSyncState(syncState);
        return this.publish(
          syncState,
          this.statusPatch({ phase: 'failed', message: blocked, errorCode: 'not_connected' }),
        );
      }
      return this.syncNow(next, settings, syncState, auth.token);
    });
  }

  /** Replays the most recent submission, e.g. after fixing a failure. */
  async retryLast(): Promise<SyncStatusReport> {
    return this.run(async () => {
      const settings = await this.repository.loadSettings();
      const syncState = await this.repository.loadSyncState();
      const auth = await this.repository.loadAuth();
      const pending = await this.repository.loadPendingJob();
      if (pending !== null) {
        return this.publish(
          syncState,
          this.statusPatch({
            phase: 'awaiting-decision',
            message: 'Resolve the pending file conflict first.',
            errorCode: 'conflict',
          }),
        );
      }
      const last = syncState.lastSubmission;
      if (last === null) {
        return this.publish(
          syncState,
          this.statusPatch({ phase: 'idle', message: 'There is nothing to retry.' }),
        );
      }
      const blocked = this.blockReason(settings, auth);
      if (blocked !== null) {
        return this.publish(
          syncState,
          this.statusPatch({ phase: 'failed', message: blocked, errorCode: 'not_connected' }),
        );
      }
      return this.syncNow(last, settings, syncState, auth.token);
    });
  }

  private async syncNow(
    raw: RawSubmission,
    settings: Settings,
    syncState: SyncState,
    token: string | null,
  ): Promise<SyncStatusReport> {
    if (token === null) {
      return this.fail(syncState, new LeetSenseiError('auth_required', 'No GitHub token stored.'), {
        submissionId: raw.submissionId,
      });
    }

    let attempt = 0;
    for (;;) {
      attempt += 1;
      try {
        return await this.attemptSync(raw, settings, syncState, token);
      } catch (error) {
        const known = toLeetSenseiError(error);
        if (known.retryable && attempt <= MAX_AUTO_RETRIES) {
          logger.warn(`retrying sync after ${known.code} (attempt ${attempt})`);
          continue;
        }
        return this.fail(syncState, known, {
          submissionId: raw.submissionId,
          problemTitle: raw.problemTitle,
          problemSlug: raw.titleSlug,
        });
      }
    }
  }

  private async attemptSync(
    raw: RawSubmission,
    settings: Settings,
    syncState: SyncState,
    token: string,
  ): Promise<SyncStatusReport> {
    const ref = this.refFrom(settings);
    const client = this.createClient(token);
    const { value: manifest } = await this.repository.loadManifest();
    const { value: revisions } = await this.repository.loadRevisions();
    const tree = await this.remoteTree(client, ref, syncState, true);

    const outcome = await prepareSync({
      raw,
      manifest,
      revisions,
      remoteFiles: tree.files,
      knownTrackerShas: new Map(Object.entries(syncState.trackerShas)),
      readRemoteContent: async (path) => {
        const file = await client.getFileContent(ref, path);
        return file?.content ?? null;
      },
      nowIso: this.nowIso(),
      fallbackCategory: settings.fallbackCategory,
      revisionIntervals: settings.revisionIntervals,
    });

    if (!outcome.ok) {
      throw outcome.error;
    }

    const prepared: PreparedSync = outcome.prepared;

    if (prepared.conflicts.length > 0) {
      const job: PendingJob = {
        submission: prepared.submission,
        files: prepared.files,
        conflicts: prepared.conflicts.map((conflict) => ({
          path: conflict.path,
          state: conflict.state,
          message: conflict.message,
        })),
        preserved: [],
        createdAt: this.nowIso(),
      };
      await this.repository.savePendingJob(job);
      return this.publish(
        syncState,
        this.statusPatch({
          phase: 'awaiting-decision',
          submissionId: prepared.submission.submissionId,
          problemTitle: prepared.submission.title,
          problemSlug: prepared.submission.slug,
          categories: prepared.submission.categories,
          message: `${job.conflicts.length} file${job.conflicts.length === 1 ? '' : 's'} in ${prepared.submission.title} already exist with different content. Choose what to keep.`,
          errorCode: 'conflict',
        }),
      );
    }

    return this.writeSubmission({
      submission: prepared.submission,
      files: prepared.files,
      settings,
      syncState,
      token,
      tree,
      preserved: [],
    });
  }

  private async writeSubmission(input: {
    submission: PreparedSync['submission'];
    files: PlannedFile[];
    settings: Settings;
    syncState: SyncState;
    token: string;
    tree: RemoteTree;
    preserved: string[];
  }): Promise<SyncStatusReport> {
    const { submission, files, settings, syncState, token, tree, preserved } = input;
    const ref = this.refFrom(settings);
    const client = this.createClient(token);
    const { value: manifest } = await this.repository.loadManifest();
    const { value: revisions } = await this.repository.loadRevisions();

    await this.publish(
      syncState,
      this.statusPatch({
        phase: 'uploading',
        submissionId: submission.submissionId,
        problemTitle: submission.title,
        problemSlug: submission.slug,
        categories: submission.categories,
        message: `Writing ${files.length} file${files.length === 1 ? '' : 's'} to ${ref.owner}/${ref.repo}@${ref.branch}...`,
      }),
    );

    const completed: PlanResult = await completeSync({
      submission,
      manifest,
      revisions,
      files,
      remoteFiles: tree.files,
      knownTrackerShas: new Map(Object.entries(syncState.trackerShas)),
      nowIso: this.nowIso(),
      revisionIntervals: settings.revisionIntervals,
    });

    const push = await pushPlan({
      client,
      ref,
      plan: completed.plan,
      includePath: () => true,
      remoteFiles: tree.files,
    });

    if (!push.verified) {
      throw new LeetSenseiError(
        'remote_changed',
        'The branch changed while LeetSensei was writing and the result could not be confirmed. Nothing was recorded locally; retry to reconcile.',
        { retryable: true },
      );
    }

    // Only now is the write confirmed, so only now is local state advanced.
    await this.repository.saveManifest(completed.nextManifest);
    await this.repository.saveRevisions(completed.nextRevisions);
    await this.repository.savePendingJob(null);

    syncState.trackerShas = trackerShas(completed.plan);
    syncState.remoteHeadSha = push.commitSha ?? syncState.remoteHeadSha;
    this.cached =
      push.commitSha === null
        ? undefined
        : {
            refKey: `${ref.owner}/${ref.repo}@${ref.branch}`,
            headSha: push.commitSha,
            treeSha: push.treeSha,
            files: push.remoteFiles,
            loadedAt: this.now().getTime(),
          };

    if (push.committed) {
      syncState.lastSyncedAt = this.nowIso();
    }

    const perCategory = perCategoryStatus(completed.plan, push.writtenPaths, push.skippedPaths);
    const failed = perCategory.filter((entry) => !entry.ok);
    const message = push.committed
      ? `Synced ${push.writtenPaths.length} file${push.writtenPaths.length === 1 ? '' : 's'} across ${completed.plan.categories.length} categor${completed.plan.categories.length === 1 ? 'y' : 'ies'}.`
      : 'Everything was already up to date; no commit was needed.';

    const notes = [...completed.plan.warnings];
    if (preserved.length > 0) {
      notes.push(
        `Preserved ${preserved.length} earlier version(s) instead of overwriting: ${preserved.join(', ')}.`,
      );
    }
    if (push.skippedPaths.length > 0 && push.committed) {
      notes.push(`${push.skippedPaths.length} file(s) already matched the repository.`);
    }
    if (tree.truncated) {
      notes.push(
        'The repository is very large, so GitHub truncated the file listing. Conflicts may be detected more conservatively than usual.',
      );
    }
    if (failed.length > 0) {
      notes.push(
        `Some categories were not fully written: ${failed.map((entry) => entry.category).join(', ')}. Retry to finish them.`,
      );
    }

    return this.publish(
      syncState,
      this.statusPatch({
        phase: 'done',
        submissionId: submission.submissionId,
        problemTitle: submission.title,
        problemSlug: submission.slug,
        categories: completed.plan.categories,
        message: [message, ...notes].join(' '),
        errorCode: null,
        perCategory,
      }),
    );
  }

  // ------------------------------------------------------------------ conflicts

  async resolveConflict(path: string, decision: ConflictDecision): Promise<SyncStatusReport> {
    return this.run(async () => {
      const settings = await this.repository.loadSettings();
      const syncState = await this.repository.loadSyncState();
      const auth = await this.repository.loadAuth();
      const job = await this.repository.loadPendingJob();
      if (job === null) {
        return this.publish(
          syncState,
          this.statusPatch({ phase: 'idle', message: 'There is no pending conflict.' }),
        );
      }
      const blocked = this.blockReason(settings, auth);
      if (blocked !== null || auth.token === null) {
        return this.publish(
          syncState,
          this.statusPatch({
            phase: 'failed',
            message: blocked ?? 'Not connected.',
            errorCode: 'not_connected',
          }),
        );
      }

      try {
        const ref = this.refFrom(settings);
        const client = this.createClient(auth.token);
        const tree = await this.remoteTree(client, ref, syncState, true);

        let remoteContent: string | null = null;
        if (decision === 'save-version') {
          const remote = await client.getFileContent(ref, path);
          remoteContent = remote?.content ?? null;
        }

        const taken = new Set<string>([
          ...tree.files.keys(),
          ...job.files.map((file) => file.path),
        ]);
        const resolved = await applyConflictDecision({
          files: job.files,
          path,
          decision,
          remoteContent,
          taken,
          stampSourceIso: job.submission.submittedAt ?? job.createdAt,
          nowIso: this.nowIso(),
        });

        const remaining = job.conflicts.filter((conflict) => conflict.path !== path);
        const nextJob: PendingJob = {
          ...job,
          files: resolved.files,
          conflicts: remaining,
          preserved: resolved.preservedPath
            ? [...job.preserved, resolved.preservedPath]
            : job.preserved,
        };

        if (remaining.length > 0) {
          await this.repository.savePendingJob(nextJob);
          return this.publish(
            syncState,
            this.statusPatch({
              phase: 'awaiting-decision',
              submissionId: job.submission.submissionId,
              problemTitle: job.submission.title,
              problemSlug: job.submission.slug,
              categories: job.submission.categories,
              message: `${remaining.length} file${remaining.length === 1 ? '' : 's'} still need a decision.`,
              errorCode: 'conflict',
            }),
          );
        }

        return await this.writeSubmission({
          submission: job.submission,
          files: resolved.files,
          settings,
          syncState,
          token: auth.token,
          tree,
          preserved: nextJob.preserved,
        });
      } catch (error) {
        return this.fail(syncState, error, {
          submissionId: job.submission.submissionId,
          problemTitle: job.submission.title,
          problemSlug: job.submission.slug,
        });
      }
    });
  }

  // ------------------------------------------------------------------ revisions

  async reviewProblem(problemId: string, rating: ReviewRating): Promise<OperationResult> {
    return this.run(async () => {
      const settings = await this.repository.loadSettings();
      const { value: manifest } = await this.repository.loadManifest();
      const { value: revisions } = await this.repository.loadRevisions();
      const problem = manifest.problems[problemId];
      const updated = applyReview({
        store: revisions,
        problemId,
        rating,
        nowIso: this.nowIso(),
        intervals: settings.revisionIntervals,
        fallback: {
          slug: problem?.slug ?? problemId,
          title: problem?.title ?? problemId,
        },
      });
      await this.repository.saveRevisions(updated);
      const backup = await this.backupRevisionsInternal(updated, settings);
      const record = updated.problems[problemId];
      const next = record ? new Date(record.nextReviewAt).toISOString().slice(0, 10) : 'soon';
      return {
        ok: true,
        message: bodyMessage(rating, next, backup.message),
      };
    });
  }

  async setNextReview(problemId: string, nextReviewAt: string): Promise<OperationResult> {
    return this.run(async () => {
      const parsed = new Date(nextReviewAt);
      if (Number.isNaN(parsed.getTime())) {
        return { ok: false, message: 'That is not a valid date.', code: 'validation_failed' };
      }
      const { value: revisions } = await this.repository.loadRevisions();
      if (!revisions.problems[problemId]) {
        return { ok: false, message: 'That problem has no revision record.', code: 'not_found' };
      }
      const updated = {
        ...revisions,
        problems: {
          ...revisions.problems,
          [problemId]: { ...revisions.problems[problemId], nextReviewAt: parsed.toISOString() },
        },
      };
      await this.repository.saveRevisions(updated);
      return { ok: true, message: `Next review set to ${parsed.toISOString().slice(0, 10)}.` };
    });
  }

  async backupRevisions(): Promise<OperationResult> {
    return this.run(async () => {
      const settings = await this.repository.loadSettings();
      const { value: revisions } = await this.repository.loadRevisions();
      const result = await this.backupRevisionsInternal(revisions, settings);
      return {
        ok: result.ok,
        message: result.message,
        ...(result.code ? { code: result.code } : {}),
      };
    });
  }

  private async backupRevisionsInternal(
    revisions: ReturnType<typeof createEmptyRevisionStore>,
    settings: Settings,
  ): Promise<{ ok: boolean; message: string; code?: ErrorCode }> {
    const auth = await this.repository.loadAuth();
    if (auth.token === null) {
      return {
        ok: false,
        message: 'Revision state saved locally. Connect GitHub to back it up.',
        code: 'auth_required',
      };
    }
    if (!isRepoConfigured(settings)) {
      return {
        ok: false,
        message: 'Revision state saved locally. Choose a repository to back it up.',
        code: 'not_connected',
      };
    }

    try {
      const ref = this.refFrom(settings);
      const client = this.createClient(auth.token);
      const tree = await this.remoteTree(client, ref, await this.repository.loadSyncState(), true);

      const remote = await client.getFileContent(ref, REVISIONS_PATH);
      if (remote !== null && revisionPayloadEquals(remote.content, revisions)) {
        return { ok: true, message: 'Revision backup already current.' };
      }

      const content = renderTrackerJson({ ...revisions, generatedAt: this.nowIso() });
      const outcome = await commitFiles({
        client,
        ref,
        message: 'Update LeetSensei revision state',
        files: [
          {
            path: REVISIONS_PATH,
            content,
            blobSha: await blobShaOf(content),
          },
        ],
        remoteFiles: tree.files,
      });

      if (!outcome.verified) {
        return {
          ok: false,
          message: 'The backup could not be confirmed on the branch. Retry later.',
          code: 'remote_changed',
        };
      }
      return { ok: true, message: 'Revision backup written.' };
    } catch (error) {
      const known = toLeetSenseiError(error);
      logger.warn(`revision backup failed: ${known.message}`);
      return { ok: false, message: messageForError(known), code: known.code };
    }
  }

  // ---------------------------------------------------------------- restore

  async restoreFromRemote(): Promise<RestoreResult> {
    return this.run(async () => {
      const settings = await this.repository.loadSettings();
      const auth = await this.repository.loadAuth();
      const syncState = await this.repository.loadSyncState();

      try {
        if (auth.token === null) {
          throw new LeetSenseiError('auth_required', 'Connect GitHub before restoring.');
        }
        const ref = this.refFrom(settings);
        const client = this.createClient(auth.token);
        const tree = await this.remoteTree(client, ref, syncState, true);

        const localManifest = await this.repository.loadManifest();
        const localRevisions = await this.repository.loadRevisions();

        let problemsAdded = 0;
        let revisionsAdded = 0;

        if (tree.files.has(MANIFEST_PATH)) {
          const remoteFile = await client.getFileContent(ref, MANIFEST_PATH);
          if (remoteFile !== null) {
            const outcome = migrateManifest(
              JSON.parse(remoteFile.content) as unknown,
              this.nowIso(),
            );
            if (!outcome.ok || !outcome.manifest) {
              throw new LeetSenseiError(
                'invalid_manifest',
                `The repository manifest could not be used (${outcome.errors[0] ?? 'invalid data'}).`,
              );
            }
            const merged = {
              ...localManifest.value,
              problems: { ...localManifest.value.problems },
            };
            for (const [problemId, remoteProblem] of Object.entries(outcome.manifest.problems)) {
              const local = merged.problems[problemId];
              if (!local || remoteProblem.updatedAt > local.updatedAt) {
                merged.problems[problemId] = remoteProblem;
                problemsAdded += 1;
              }
            }
            merged.generatedAt = this.nowIso();
            await this.repository.saveManifest(merged);
          }
        }

        if (tree.files.has(REVISIONS_PATH)) {
          const remoteFile = await client.getFileContent(ref, REVISIONS_PATH);
          if (remoteFile !== null) {
            const outcome = migrateRevisionStore(
              JSON.parse(remoteFile.content) as unknown,
              this.nowIso(),
            );
            if (!outcome.ok || !outcome.store) {
              throw new LeetSenseiError(
                'invalid_revision_data',
                `The repository revision backup could not be used (${outcome.errors[0] ?? 'invalid data'}).`,
              );
            }
            const base = localRevisions.value;
            const merged = { ...base, problems: { ...base.problems } };
            for (const [problemId, remoteRecord] of Object.entries(outcome.store.problems)) {
              const local = merged.problems[problemId];
              const remoteIsNewer =
                local === undefined ||
                (remoteRecord.lastReviewedAt ?? '') > (local.lastReviewedAt ?? '');
              if (remoteIsNewer) {
                merged.problems[problemId] = remoteRecord;
                revisionsAdded += 1;
              }
            }
            merged.generatedAt = this.nowIso();
            await this.repository.saveRevisions(merged);
          }
        }

        // Adopt the repository's tracker blob ids so the next sync matches up.
        syncState.trackerShas = {
          ...syncState.trackerShas,
          ...(blobIdOrNothing(tree, MANIFEST_PATH) ?? {}),
          ...(blobIdOrNothing(tree, REVISIONS_PATH) ?? {}),
        };
        await this.repository.saveSyncState(syncState);

        return {
          ok: true,
          problemsAdded,
          revisionsAdded,
          message: `Restored ${problemsAdded} problem${problemsAdded === 1 ? '' : 's'} and ${revisionsAdded} revision record${revisionsAdded === 1 ? '' : 's'} from the repository.`,
        };
      } catch (error) {
        const known = toLeetSenseiError(error);
        return {
          ok: false,
          problemsAdded: 0,
          revisionsAdded: 0,
          message: messageForError(known),
          code: known.code,
        };
      }
    });
  }

  // ---------------------------------------------------------------- github

  async listRepos(): Promise<RepoListItem[]> {
    return this.run(async () => {
      const auth = await this.repository.loadAuth();
      if (auth.token === null) {
        throw new LeetSenseiError('auth_required', 'Connect GitHub first.');
      }
      return this.createClient(auth.token).listRepos();
    });
  }

  async listBranches(owner: string, repo: string): Promise<string[]> {
    return this.run(async () => {
      const auth = await this.repository.loadAuth();
      if (auth.token === null) {
        throw new LeetSenseiError('auth_required', 'Connect GitHub first.');
      }
      const settings = await this.repository.loadSettings();
      return this.createClient(auth.token).listBranches({
        owner,
        repo,
        branch: settings.branch,
      });
    });
  }

  // ---------------------------------------------------------------- overview

  async getOverview(): Promise<Overview> {
    return this.run(async () => {
      const [settings, manifest, revisions, syncState, auth, pending] = await Promise.all([
        this.repository.loadSettings(),
        this.repository.loadManifest(),
        this.repository.loadRevisions(),
        this.repository.loadSyncState(),
        this.repository.loadAuth(),
        this.repository.loadPendingJob(),
      ]);
      return buildOverview({
        settings,
        manifest: manifest.value,
        revisions: revisions.value,
        syncState,
        auth,
        pending,
        now: this.now(),
        version: VERSION,
      });
    });
  }

  async getPendingJob(): Promise<PendingJob | null> {
    return this.run(() => this.repository.loadPendingJob());
  }

  // ---------------------------------------------------------------- data

  async disconnect(): Promise<OperationResult> {
    return this.run(async () => {
      await this.repository.clearCredentials();
      const syncState = await this.repository.loadSyncState();
      syncState.remoteHeadSha = null;
      syncState.remoteTreeSha = null;
      this.cached = undefined;
      await this.publish(
        syncState,
        this.statusPatch({
          phase: 'idle',
          message:
            'GitHub disconnected and the stored token was removed. Your synced solutions and local revision data were kept.',
        }),
      );
      return { ok: true, message: 'GitHub disconnected and the stored token was removed.' };
    });
  }

  async clearLocalData(): Promise<OperationResult> {
    return this.run(async () => {
      await this.repository.clearAll();
      this.cached = undefined;
      this.onStatus({
        phase: 'idle',
        submissionId: null,
        problemTitle: null,
        problemSlug: null,
        categories: [],
        message: 'All local LeetSensei data was cleared.',
        errorCode: null,
        updatedAt: this.nowIso(),
        perCategory: [],
      });
      return {
        ok: true,
        message: 'All local LeetSensei data was cleared. Repository files were not touched.',
      };
    });
  }

  /** Exports local state. Never includes the GitHub token. */
  async exportData(): Promise<{ filename: string; json: string }> {
    return this.run(async () => {
      const settings = await this.repository.loadSettings();
      const manifest = await this.repository.loadManifest();
      const revisions = await this.repository.loadRevisions();
      const payload = {
        product: 'LeetSensei',
        version: VERSION,
        exportedAt: this.nowIso(),
        note: 'This export contains no credentials.',
        settings,
        manifest: manifest.value,
        revisions: revisions.value,
      };
      return {
        filename: `leetsensei-export-${this.nowIso().slice(0, 10)}.json`,
        json: `${JSON.stringify(payload, null, 2)}\n`,
      };
    });
  }

  /** Summary used by the popup badge. */
  async dueCount(): Promise<number> {
    const { value: revisions } = await this.repository.loadRevisions();
    const summary = summarizeSchedule(Object.values(revisions.problems), this.now());
    return summary.overdue + summary.dueToday;
  }
}

function blobIdOrNothing(tree: RemoteTree, path: string): Record<string, string> | null {
  const sha = tree.files.get(path);
  return sha === undefined ? null : { [path]: sha };
}

function trackerShas(plan: SyncPlan): Record<string, string> {
  const result: Record<string, string> = {};
  for (const file of plan.trackerFiles) result[file.path] = file.blobSha;
  return result;
}

export function perCategoryStatus(
  plan: SyncPlan,
  writtenPaths: readonly string[],
  skippedPaths: readonly string[],
): SyncStatusReport['perCategory'] {
  const written = new Set(writtenPaths);
  const skipped = new Set(skippedPaths);
  return plan.categories.map((category) => {
    const paths = plan.files.filter((file) => file.category === category).map((file) => file.path);
    const pending = paths.filter((path) => !written.has(path) && !skipped.has(path));
    return {
      category,
      ok: pending.length === 0,
      error: pending.length === 0 ? null : `not written: ${pending.join(', ')}`,
    };
  });
}

function revisionPayloadEquals(remoteContent: string, revisions: unknown): boolean {
  const outcome = migrateRevisionStore(
    JSON.parse(remoteContent) as unknown,
    new Date().toISOString(),
  );
  if (!outcome.ok || !outcome.store) return false;
  const expected = revisions as { problems?: unknown };
  return JSON.stringify(outcome.store.problems) === JSON.stringify(expected.problems ?? {});
}

async function blobShaOf(content: string): Promise<string> {
  return gitBlobSha1(content);
}

function bodyMessage(rating: ReviewRating, nextDate: string, backup: string): string {
  const labels: Record<ReviewRating, string> = {
    again: 'Marked Again',
    hard: 'Marked Hard',
    easy: 'Marked Easy',
  };
  return `${labels[rating]}. Next review ${nextDate}. ${backup}`;
}
