import type { ReviewRating } from './model';

/**
 * Revision scheduling.
 *
 * The ladder is a configurable, ascending list of day counts (default
 * 1, 3, 7, 14, 30). Self-assessment moves a problem along that ladder:
 *
 * | Rating  | Effect                                                        |
 * | ------- | ------------------------------------------------------------- |
 * | `again` | reset to the shortest interval                                |
 * | `hard`  | keep the current interval                                     |
 * | `easy`  | advance to the next longer interval, doubling past the ladder |
 *
 * The algorithm is pure and fully covered by unit tests, including the
 * day-boundary behaviour used by the dashboard buckets.
 */

export const DEFAULT_REVISION_INTERVALS: readonly number[] = [1, 3, 7, 14, 30];
export const MIN_INTERVAL_DAYS = 1;
export const MAX_INTERVAL_DAYS = 365;
const MAX_LADDER_LENGTH = 12;

const MS_PER_DAY = 86_400_000;

export type DueState = 'overdue' | 'due-today' | 'upcoming';

export function normalizeIntervals(input: readonly number[] | undefined): number[] {
  const source = input && input.length > 0 ? input : DEFAULT_REVISION_INTERVALS;
  const cleaned = new Set<number>();
  for (const value of source) {
    if (!Number.isFinite(value)) continue;
    const days = Math.round(value);
    if (days < MIN_INTERVAL_DAYS || days > MAX_INTERVAL_DAYS) continue;
    cleaned.add(days);
  }
  const sorted = [...cleaned].sort((left, right) => left - right).slice(0, MAX_LADDER_LENGTH);
  if (sorted.length === 0) return [...DEFAULT_REVISION_INTERVALS];
  return sorted;
}

function at(values: readonly number[], index: number, fallback: number): number {
  const value = values[index];
  return value === undefined ? fallback : value;
}

export function shortestInterval(intervals: readonly number[] | undefined): number {
  return at(normalizeIntervals(intervals), 0, MIN_INTERVAL_DAYS);
}

export function nextIntervalDays(
  currentIntervalDays: number,
  rating: ReviewRating,
  intervals: readonly number[] = DEFAULT_REVISION_INTERVALS,
): number {
  const ladder = normalizeIntervals(intervals);
  const fallback = at(ladder, 0, MIN_INTERVAL_DAYS);
  const current =
    Number.isFinite(currentIntervalDays) && currentIntervalDays >= MIN_INTERVAL_DAYS
      ? Math.round(currentIntervalDays)
      : fallback;

  if (rating === 'again') return fallback;
  if (rating === 'hard') return current;

  const next = ladder.find((value) => value > current);
  if (next !== undefined) return next;
  return Math.min(Math.max(current * 2, current + 1), MAX_INTERVAL_DAYS);
}

export function computeNextReviewAt(nowIso: string, intervalDays: number): string {
  const now = new Date(nowIso);
  const base = Number.isNaN(now.getTime()) ? new Date() : now;
  const days = Number.isFinite(intervalDays)
    ? Math.max(MIN_INTERVAL_DAYS, Math.round(intervalDays))
    : 1;
  return new Date(base.getTime() + days * MS_PER_DAY).toISOString();
}

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseDate(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Buckets a problem for the dashboard. Dates that cannot be parsed are treated
 * as due today so broken data is visible instead of silently ignored.
 */
export function classifyDue(nextReviewAt: string, now: Date): DueState {
  const next = parseDate(nextReviewAt);
  if (next === null) return 'due-today';
  const todayStart = startOfLocalDay(now).getTime();
  const tomorrowStart = todayStart + MS_PER_DAY;
  const target = next.getTime();
  if (target < todayStart) return 'overdue';
  if (target < tomorrowStart) return 'due-today';
  return 'upcoming';
}

/** Whole days between today and the review date (negative when overdue). */
export function daysUntil(nextReviewAt: string, now: Date): number {
  const next = parseDate(nextReviewAt);
  if (next === null) return 0;
  const todayStart = startOfLocalDay(now).getTime();
  const target = startOfLocalDay(next).getTime();
  return Math.round((target - todayStart) / MS_PER_DAY);
}

export interface ScheduleSummary {
  overdue: number;
  dueToday: number;
  upcoming: number;
  total: number;
}

export function summarizeSchedule(
  records: readonly { nextReviewAt: string }[],
  now: Date,
): ScheduleSummary {
  const summary: ScheduleSummary = { overdue: 0, dueToday: 0, upcoming: 0, total: records.length };
  for (const record of records) {
    const state = classifyDue(record.nextReviewAt, now);
    if (state === 'overdue') summary.overdue += 1;
    else if (state === 'due-today') summary.dueToday += 1;
    else summary.upcoming += 1;
  }
  return summary;
}
