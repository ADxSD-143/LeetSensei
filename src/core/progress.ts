import type { ReviewRating } from './model';
import type { RevisionStore } from './revisions';

/**
 * Progression as a *projection* of recorded review history.
 *
 * Nothing here is stored separately: XP and rank are recomputed from the review
 * events LeetSensei already persists, so a repository restore can never leave a
 * separate counter out of sync, and no statistic can drift from the real data.
 */

/** Points awarded for a recorded review, by self-assessment. */
export const XP_BY_RATING: Record<ReviewRating, number> = {
  again: 1,
  hard: 3,
  easy: 5,
};

export interface Rank {
  name: string;
  /** Cumulative XP at which this rank starts. */
  minXp: number;
}

/** Ascending ranks. Thresholds are cumulative and documented in the README. */
export const RANKS: readonly Rank[] = [
  { name: 'Ronin', minXp: 0 },
  { name: 'Ashigaru', minXp: 50 },
  { name: 'Bushi', minXp: 130 },
  { name: 'Samurai', minXp: 260 },
  { name: 'Kenshi', minXp: 450 },
  { name: 'Sensei', minXp: 700 },
];

export interface ProgressSummary {
  /** Recorded review events across every problem. */
  reviews: number;
  /** Reviews rated hard or easy. */
  successfulReviews: number;
  xp: number;
  /** Current rank, displayed as the "level" name. */
  rank: string;
  /** 1-based position in the rank ladder. */
  level: number;
  nextRank: string | null;
  /** XP earned inside the current rank. */
  rankXp: number;
  /** XP span of the current rank (0 at the top rank). */
  rankSpan: number;
  xpToNextRank: number;
  /** 0..1 progress within the current rank. */
  ratio: number;
  /** Consecutive local days with at least one review, ending today or yesterday. */
  streakDays: number;
  lastReviewAt: string | null;
}

const FALLBACK_RANK: Rank = { name: 'Ronin', minXp: 0 };
const DAY_MS = 86_400_000;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Local calendar day, so a streak matches what the user sees on their clock. */
export function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function shiftDays(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + delta);
}

/**
 * Consecutive days with at least one review. A streak that ended yesterday still
 * counts (you have not broken it yet today). Invalid timestamps are ignored.
 */
export function computeStreakDays(events: readonly { at: string }[], now: Date): number {
  const days = new Set<string>();
  for (const event of events) {
    const parsed = new Date(event.at);
    if (Number.isNaN(parsed.getTime())) continue;
    days.add(localDayKey(parsed));
  }
  if (days.size === 0) return 0;

  let cursor = startOfLocalDay(now);
  if (!days.has(localDayKey(cursor))) {
    cursor = shiftDays(cursor, -1);
    if (!days.has(localDayKey(cursor))) return 0;
  }

  let streak = 0;
  while (days.has(localDayKey(cursor))) {
    streak += 1;
    cursor = shiftDays(cursor, -1);
  }
  return streak;
}

/** Index of the highest rank whose threshold the XP has reached. */
export function rankIndexForXp(xp: number): number {
  let index = 0;
  for (let cursor = 0; cursor < RANKS.length; cursor += 1) {
    const candidate = RANKS[cursor];
    if (candidate && xp >= candidate.minXp) index = cursor;
  }
  return index;
}

export function computeProgress(revisions: RevisionStore, now: Date): ProgressSummary {
  const events = Object.values(revisions.problems).flatMap((record) => record.history);

  let xp = 0;
  let successfulReviews = 0;
  let lastReviewAt: string | null = null;
  for (const event of events) {
    xp += XP_BY_RATING[event.rating] ?? 0;
    if (event.rating !== 'again') successfulReviews += 1;
    if (lastReviewAt === null || event.at > lastReviewAt) lastReviewAt = event.at;
  }

  const index = rankIndexForXp(xp);
  const rank = RANKS[index] ?? FALLBACK_RANK;
  const next = RANKS[index + 1] ?? null;
  const rankXp = Math.max(0, xp - rank.minXp);
  const rankSpan = next === null ? 0 : next.minXp - rank.minXp;
  const ratio = rankSpan === 0 ? 1 : Math.min(1, rankXp / rankSpan);

  return {
    reviews: events.length,
    successfulReviews,
    xp,
    rank: rank.name,
    level: index + 1,
    nextRank: next?.name ?? null,
    rankXp,
    rankSpan,
    xpToNextRank: next === null ? 0 : Math.max(0, next.minXp - xp),
    ratio,
    streakDays: computeStreakDays(events, now),
    lastReviewAt,
  };
}

/** Whole days since the last review, or null when nothing has been reviewed. */
export function daysSinceLastReview(progress: ProgressSummary, now: Date): number | null {
  if (progress.lastReviewAt === null) return null;
  const last = new Date(progress.lastReviewAt);
  if (Number.isNaN(last.getTime())) return null;
  return Math.max(
    0,
    Math.round((startOfLocalDay(now).getTime() - startOfLocalDay(last).getTime()) / DAY_MS),
  );
}
