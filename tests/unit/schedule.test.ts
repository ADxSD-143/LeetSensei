import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REVISION_INTERVALS,
  MAX_INTERVAL_DAYS,
  classifyDue,
  computeNextReviewAt,
  daysUntil,
  nextIntervalDays,
  normalizeIntervals,
  summarizeSchedule,
} from '../../src/core/schedule';

describe('normalizeIntervals', () => {
  it('falls back to the documented ladder', () => {
    expect(normalizeIntervals(undefined)).toEqual([1, 3, 7, 14, 30]);
    expect(normalizeIntervals([])).toEqual([...DEFAULT_REVISION_INTERVALS]);
  });

  it('drops invalid values, dedupes and sorts', () => {
    expect(normalizeIntervals([30, 1, 1, -5, 0, Number.NaN, 3.4])).toEqual([1, 3, 30]);
  });

  it('caps the values it will accept', () => {
    expect(normalizeIntervals([1, 9_999])).toEqual([1]);
  });
});

describe('nextIntervalDays', () => {
  it('resets to the shortest interval on Again', () => {
    expect(nextIntervalDays(30, 'again')).toBe(1);
    expect(nextIntervalDays(0, 'again')).toBe(1);
  });

  it('keeps the current interval on Hard', () => {
    expect(nextIntervalDays(14, 'hard')).toBe(14);
    expect(nextIntervalDays(1, 'hard')).toBe(1);
  });

  it('advances one ladder step on Easy', () => {
    expect(nextIntervalDays(1, 'easy')).toBe(3);
    expect(nextIntervalDays(3, 'easy')).toBe(7);
    expect(nextIntervalDays(7, 'easy')).toBe(14);
    expect(nextIntervalDays(14, 'easy')).toBe(30);
  });

  it('doubles past the end of the ladder and stays bounded', () => {
    expect(nextIntervalDays(30, 'easy')).toBe(60);
    expect(nextIntervalDays(200, 'easy')).toBe(365);
    expect(nextIntervalDays(MAX_INTERVAL_DAYS, 'easy')).toBe(365);
  });

  it('advances to the next ladder value from an off-ladder interval', () => {
    expect(nextIntervalDays(2, 'easy')).toBe(3);
    expect(nextIntervalDays(20, 'easy')).toBe(30);
  });

  it('treats a corrupt current interval as the shortest', () => {
    expect(nextIntervalDays(Number.NaN, 'hard')).toBe(1);
    expect(nextIntervalDays(-4, 'hard')).toBe(1);
  });

  it('honours a custom ladder', () => {
    expect(nextIntervalDays(2, 'easy', [2, 5, 9])).toBe(5);
    expect(nextIntervalDays(9, 'easy', [2, 5, 9])).toBe(18);
  });
});

describe('computeNextReviewAt', () => {
  it('adds whole days in UTC terms', () => {
    expect(computeNextReviewAt('2024-01-01T00:00:00.000Z', 3)).toBe('2024-01-04T00:00:00.000Z');
    expect(computeNextReviewAt('2024-01-01T00:00:00.000Z', 30)).toBe('2024-01-31T00:00:00.000Z');
  });

  it('handles a month and year boundary', () => {
    expect(computeNextReviewAt('2024-12-31T23:00:00.000Z', 1)).toBe('2025-01-01T23:00:00.000Z');
  });

  it('clamps non positive intervals to one day', () => {
    expect(computeNextReviewAt('2024-01-01T00:00:00.000Z', 0)).toBe('2024-01-02T00:00:00.000Z');
  });
});

describe('day boundaries', () => {
  const now = new Date(2024, 5, 10, 12, 0, 0);

  it('classifies overdue, due today and upcoming in local time', () => {
    expect(classifyDue(new Date(2024, 5, 9, 23, 0, 0).toISOString(), now)).toBe('overdue');
    expect(classifyDue(new Date(2024, 5, 10, 0, 0, 0).toISOString(), now)).toBe('due-today');
    expect(classifyDue(new Date(2024, 5, 10, 23, 59, 59).toISOString(), now)).toBe('due-today');
    expect(classifyDue(new Date(2024, 5, 11, 0, 0, 0).toISOString(), now)).toBe('upcoming');
  });

  it('treats an unparsable date as due today so it is visible', () => {
    expect(classifyDue('not-a-date', now)).toBe('due-today');
  });

  it('counts whole days from the start of today', () => {
    expect(daysUntil(new Date(2024, 5, 10, 23, 0, 0).toISOString(), now)).toBe(0);
    expect(daysUntil(new Date(2024, 5, 11, 1, 0, 0).toISOString(), now)).toBe(1);
    expect(daysUntil(new Date(2024, 5, 9, 23, 0, 0).toISOString(), now)).toBe(-1);
    expect(daysUntil('nonsense', now)).toBe(0);
  });

  it('summarises the whole queue', () => {
    const summary = summarizeSchedule(
      [
        { nextReviewAt: new Date(2024, 5, 1).toISOString() },
        { nextReviewAt: new Date(2024, 5, 10, 9).toISOString() },
        { nextReviewAt: new Date(2024, 5, 20).toISOString() },
        { nextReviewAt: new Date(2024, 6, 1).toISOString() },
      ],
      now,
    );
    expect(summary).toEqual({ overdue: 1, dueToday: 1, upcoming: 2, total: 4 });
  });

  it('summarises an empty queue', () => {
    expect(summarizeSchedule([], now)).toEqual({
      overdue: 0,
      dueToday: 0,
      upcoming: 0,
      total: 0,
    });
  });
});
