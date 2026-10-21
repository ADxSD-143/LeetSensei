import type { Manifest } from '../core/manifest';
import {
  classifyDue,
  summarizeSchedule,
  type DueState,
  type ScheduleSummary,
} from '../core/schedule';
import type { RevisionStore } from '../core/revisions';
import { computeProgress, type ProgressSummary } from '../core/progress';
import type { SyncStatusReport } from '../shared/messages';
import type { AuthState, PendingJob, SyncState } from '../storage/repository';
import type { Settings } from '../storage/settings';
import { isRepoConfigured } from '../storage/settings';

/** Read-only views for the popup, dashboard and options pages. */

export interface ProblemSummary {
  problemId: string;
  slug: string;
  title: string;
  url: string;
  difficulty: string;
  officialTags: string[];
  categories: string[];
  languages: string[];
  metadataIncomplete: boolean;
  fileCount: number;
  updatedAt: string;
  nextReviewAt: string | null;
  dueState: DueState | null;
}

export interface RevisionRow extends ProblemSummary {
  nextReviewAt: string;
  dueState: DueState;
  currentIntervalDays: number;
  successfulReviews: number;
  lastReviewedAt: string | null;
  lastRating: string | null;
  reviewCount: number;
}

/**
 * Where the user is in first-time setup. Drives both the options page and the
 * popup so they always agree on the next action.
 */
export type SetupState = 'needs-github' | 'needs-repository' | 'ready';

export function deriveSetupState(connected: boolean, settings: Settings): SetupState {
  if (!connected) return 'needs-github';
  return isRepoConfigured(settings) ? 'ready' : 'needs-repository';
}

export interface Overview {
  connected: boolean;
  login: string | null;
  authMethod: AuthState['method'];
  repo: { owner: string; repo: string; branch: string } | null;
  settings: Settings;
  lastSyncedAt: string | null;
  status: SyncStatusReport;
  schedule: ScheduleSummary;
  problems: ProblemSummary[];
  revisions: RevisionRow[];
  /** Problems that have a revision record but no manifest entry, and vice versa. */
  orphans: string[];
  pendingConflicts: { path: string; state: string; message: string }[];
  queuedSubmissions: number;
  version: string;
  /** The single next step in first-time setup. */
  setup: SetupState;
  /** XP, rank and streak, always derived from recorded review history. */
  progress: ProgressSummary;
}

function lastRatingOf(store: RevisionStore, problemId: string): string | null {
  const history = store.problems[problemId]?.history ?? [];
  const last = history[history.length - 1];
  return last?.rating ?? null;
}

export function toProblemSummaries(
  manifest: Manifest,
  revisions: RevisionStore,
  now: Date,
): ProblemSummary[] {
  return Object.values(manifest.problems)
    .map((problem) => {
      const record = revisions.problems[problem.problemId];
      return {
        problemId: problem.problemId,
        slug: problem.slug,
        title: problem.title,
        url: problem.url,
        difficulty: problem.difficulty,
        officialTags: problem.officialTags,
        categories: [...new Set(problem.categories)],
        languages: problem.languages,
        metadataIncomplete: problem.metadataIncomplete,
        fileCount: problem.files.length,
        updatedAt: problem.updatedAt,
        nextReviewAt: record?.nextReviewAt ?? null,
        dueState: record ? classifyDue(record.nextReviewAt, now) : null,
      };
    })
    .sort((left, right) => (left.problemId < right.problemId ? -1 : 1));
}

export function toRevisionRows(
  manifest: Manifest,
  revisions: RevisionStore,
  now: Date,
): RevisionRow[] {
  const summaries = new Map(
    toProblemSummaries(manifest, revisions, now).map((summary) => [summary.problemId, summary]),
  );

  return Object.values(revisions.problems)
    .map((record) => {
      const summary = summaries.get(record.problemId);
      return {
        problemId: record.problemId,
        slug: summary?.slug ?? record.slug,
        title: summary?.title ?? record.title,
        url: summary?.url ?? '',
        difficulty: summary?.difficulty ?? 'Unknown',
        officialTags: summary?.officialTags ?? [],
        categories: summary?.categories ?? [],
        languages: summary?.languages ?? [],
        metadataIncomplete: summary?.metadataIncomplete ?? false,
        fileCount: summary?.fileCount ?? 0,
        updatedAt: summary?.updatedAt ?? record.nextReviewAt,
        nextReviewAt: record.nextReviewAt,
        dueState: classifyDue(record.nextReviewAt, now),
        currentIntervalDays: record.currentIntervalDays,
        successfulReviews: record.successfulReviews,
        lastReviewedAt: record.lastReviewedAt,
        lastRating: lastRatingOf(revisions, record.problemId),
        reviewCount: record.history.length,
      };
    })
    .sort((left, right) =>
      left.nextReviewAt < right.nextReviewAt ? -1 : left.nextReviewAt > right.nextReviewAt ? 1 : 0,
    );
}

export function findOrphans(manifest: Manifest, revisions: RevisionStore): string[] {
  const orphans = new Set<string>();
  for (const problemId of Object.keys(revisions.problems)) {
    if (!manifest.problems[problemId]) orphans.add(problemId);
  }
  for (const problemId of Object.keys(manifest.problems)) {
    if (!revisions.problems[problemId]) orphans.add(problemId);
  }
  return [...orphans].sort();
}

export function buildOverview(input: {
  settings: Settings;
  manifest: Manifest;
  revisions: RevisionStore;
  syncState: SyncState;
  auth: AuthState;
  pending: PendingJob | null;
  now: Date;
  version: string;
}): Overview {
  const { settings, manifest, revisions, syncState, auth, pending, now } = input;
  const connected = auth.token !== null;
  return {
    connected,
    login: auth.login,
    authMethod: auth.method,
    repo: isRepoConfigured(settings)
      ? { owner: settings.repoOwner, repo: settings.repoName, branch: settings.branch }
      : null,
    settings,
    lastSyncedAt: syncState.lastSyncedAt,
    status: syncState.status,
    schedule: summarizeSchedule(Object.values(revisions.problems), now),
    problems: toProblemSummaries(manifest, revisions, now),
    revisions: toRevisionRows(manifest, revisions, now),
    orphans: findOrphans(manifest, revisions),
    pendingConflicts: pending?.conflicts ?? [],
    queuedSubmissions: syncState.queued?.length ?? 0,
    version: input.version,
    setup: deriveSetupState(connected, settings),
    progress: computeProgress(revisions, now),
  };
}
