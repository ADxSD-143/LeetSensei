import type { Overview } from '../background/overview';
import { computeProgress } from '../core/progress';
import type { RevisionStore } from '../core/revisions';
import type { PendingJob } from '../storage/repository';
import { isRecord } from '../shared/validation';

/**
 * Runtime validation for the `data/overview` response.
 *
 * The UI used to cast that response straight to a type. That hides a real
 * failure mode: an extension page and the background are separate bundles, and
 * a Manifest V3 service worker keeps the code it was started with until the
 * extension is reloaded. Reloading the dashboard tab alone therefore pairs a
 * new page with an older background, and any field the page expects but the
 * older background never sent arrives as `undefined` — which crashed the
 * dashboard on `overview.progress.streakDays`.
 *
 * Two things happen here instead of a crash:
 *   1. Progress is *derived* when the producer omitted it. That is safe because
 *      progress is a pure projection of the revision store (see
 *      `src/core/progress.ts`); nothing is invented and the data model is
 *      unchanged.
 *   2. Anything else that does not match the contract raises a diagnostic that
 *      names the missing field and the action that fixes it.
 */

export class IncompatibleOverviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IncompatibleOverviewError';
  }
}

export interface GuardedOverviewResponse {
  overview: Overview;
  pending: PendingJob | null;
  revisions: RevisionStore;
  /**
   * True when the response carried no usable `progress` and it was recomputed
   * from the revision store. The caller should tell the user to reload the
   * extension, because the background is older than the page.
   */
  recoveredProgress: boolean;
}

export const STALE_BUILD_HINT =
  'The dashboard and the extension background are running different builds. ' +
  'Reload LeetSensei from your extensions page (brave://extensions or chrome://extensions), then reopen the dashboard.';

/** Fields the dashboard reads directly from the overview. */
const REQUIRED_OVERVIEW_KEYS = [
  'connected',
  'status',
  'schedule',
  'problems',
  'revisions',
  'settings',
] as const;

/** Every numeric field of `ProgressSummary` that the dashboard renders. */
const REQUIRED_PROGRESS_NUMBERS = [
  'reviews',
  'successfulReviews',
  'xp',
  'level',
  'rankXp',
  'rankSpan',
  'xpToNextRank',
  'ratio',
  'streakDays',
] as const;

function usableProgress(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (typeof value.rank !== 'string') return false;
  if (value.nextRank !== null && typeof value.nextRank !== 'string') return false;
  if (value.lastReviewAt !== null && typeof value.lastReviewAt !== 'string') return false;
  return REQUIRED_PROGRESS_NUMBERS.every((key) => typeof value[key] === 'number');
}

function usableStore(value: unknown): value is RevisionStore {
  if (!isRecord(value) || !isRecord(value.problems)) return false;
  // computeProgress walks every record's history, so a malformed record has to
  // be caught here rather than throwing from the middle of the derivation.
  return Object.values(value.problems).every(
    (record) => isRecord(record) && Array.isArray(record.history),
  );
}

export function readOverviewResponse(value: unknown, now: Date): GuardedOverviewResponse {
  if (!isRecord(value)) {
    throw new IncompatibleOverviewError(
      `The background worker did not return an overview object. ${STALE_BUILD_HINT}`,
    );
  }

  const rawOverview = value.overview;
  if (!isRecord(rawOverview)) {
    throw new IncompatibleOverviewError(
      `The overview response has no "overview". ${STALE_BUILD_HINT}`,
    );
  }

  const missing = REQUIRED_OVERVIEW_KEYS.filter((key) => rawOverview[key] === undefined);
  if (missing.length > 0) {
    throw new IncompatibleOverviewError(
      `The overview response is missing ${missing.map((key) => `"${key}"`).join(', ')}. ${STALE_BUILD_HINT}`,
    );
  }
  if (!Array.isArray(rawOverview.problems) || !Array.isArray(rawOverview.revisions)) {
    throw new IncompatibleOverviewError(
      `The overview response has malformed "problems" or "revisions" rows. ${STALE_BUILD_HINT}`,
    );
  }

  const revisions = value.revisions;
  if (!usableStore(revisions)) {
    throw new IncompatibleOverviewError(
      `The overview response has no usable revision store. ${STALE_BUILD_HINT}`,
    );
  }

  const pending = value.pending ?? null;
  if (pending !== null && (!isRecord(pending) || !Array.isArray(pending.conflicts))) {
    throw new IncompatibleOverviewError(
      `The overview response has a malformed "pending" job. ${STALE_BUILD_HINT}`,
    );
  }

  const recoveredProgress = !usableProgress(rawOverview.progress);
  // Spread rather than assign: the caller keeps the object it was given.
  const overview: Overview = recoveredProgress
    ? { ...(rawOverview as unknown as Overview), progress: computeProgress(revisions, now) }
    : (rawOverview as unknown as Overview);

  return {
    overview,
    pending: pending as PendingJob | null,
    revisions,
    recoveredProgress,
  };
}
