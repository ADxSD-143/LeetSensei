import { describe, expect, it } from 'vitest';
import {
  RANKS,
  XP_BY_RATING,
  computeProgress,
  computeStreakDays,
  daysSinceLastReview,
  localDayKey,
  rankIndexForXp,
} from '../../src/core/progress';
import type { RevisionStore } from '../../src/core/revisions';
import type { ReviewRating } from '../../src/core/model';

const NOW = new Date(2026, 2, 15, 18, 30, 0); // 15 March 2026, local time

function at(daysAgo: number, hour = 12): string {
  const date = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - daysAgo, hour, 0, 0);
  return date.toISOString();
}

function store(
  histories: Record<string, { rating: ReviewRating; daysAgo: number }[]>,
): RevisionStore {
  const problems: RevisionStore['problems'] = {};
  for (const [problemId, events] of Object.entries(histories)) {
    const history = [...events]
      .sort((left, right) => right.daysAgo - left.daysAgo)
      .map((event) => ({
        at: at(event.daysAgo),
        rating: event.rating,
        intervalBeforeDays: 1,
        intervalAfterDays: 3,
      }));
    problems[problemId] = {
      problemId,
      slug: problemId,
      title: problemId,
      lastReviewedAt: history.length > 0 ? (history[history.length - 1]?.at ?? null) : null,
      nextReviewAt: at(-1),
      currentIntervalDays: 3,
      successfulReviews: history.filter((event) => event.rating !== 'again').length,
      history,
    };
  }
  return { schemaVersion: 1, generatedAt: NOW.toISOString(), problems };
}

describe('XP weights', () => {
  it('rewards remembering more than forgetting', () => {
    expect(XP_BY_RATING.easy).toBeGreaterThan(XP_BY_RATING.hard);
    expect(XP_BY_RATING.hard).toBeGreaterThan(XP_BY_RATING.again);
    expect(XP_BY_RATING.again).toBeGreaterThan(0);
  });
});

describe('computeProgress', () => {
  it('reports a zero state for a fresh profile', () => {
    const progress = computeProgress(store({}), NOW);
    expect(progress).toMatchObject({
      reviews: 0,
      successfulReviews: 0,
      xp: 0,
      rank: 'Ronin',
      level: 1,
      nextRank: 'Ashigaru',
      rankXp: 0,
      rankSpan: 50,
      xpToNextRank: 50,
      ratio: 0,
      streakDays: 0,
      lastReviewAt: null,
    });
  });

  it('sums XP from every recorded review', () => {
    // 2 easy (10) + 1 hard (3) + 1 again (1) = 14, across two problems.
    const progress = computeProgress(
      store({
        '0001': [
          { rating: 'easy', daysAgo: 4 },
          { rating: 'hard', daysAgo: 2 },
        ],
        '0002': [
          { rating: 'easy', daysAgo: 1 },
          { rating: 'again', daysAgo: 0 },
        ],
      }),
      NOW,
    );
    expect(progress.xp).toBe(14);
    expect(progress.reviews).toBe(4);
    expect(progress.successfulReviews).toBe(3);
  });

  it('does not double count when the same review appears twice', () => {
    // Two records pointing at the same timestamp are two genuine events, but a
    // duplicate *day* must not inflate the streak.
    const progress = computeProgress(
      store({
        '0001': [
          { rating: 'hard', daysAgo: 0 },
          { rating: 'hard', daysAgo: 0 },
        ],
      }),
      NOW,
    );
    expect(progress.xp).toBe(6);
    expect(progress.streakDays).toBe(1);
  });

  it('tracks progress inside the current rank', () => {
    // 12 easy = 60 XP -> Ashigaru (50..129), 10 into a span of 80.
    const events = Array.from({ length: 12 }, () => ({ rating: 'easy' as const, daysAgo: 3 }));
    const progress = computeProgress(store({ '0001': events }), NOW);
    expect(progress.xp).toBe(60);
    expect(progress.rank).toBe('Ashigaru');
    expect(progress.level).toBe(2);
    expect(progress.rankXp).toBe(10);
    expect(progress.rankSpan).toBe(80);
    expect(progress.ratio).toBeCloseTo(10 / 80);
    expect(progress.xpToNextRank).toBe(70);
  });

  it('caps at the top rank instead of overflowing', () => {
    // 140 easy = 700 XP, exactly Sensei.
    const events = Array.from({ length: 140 }, () => ({ rating: 'easy' as const, daysAgo: 5 }));
    const progress = computeProgress(store({ '0001': events }), NOW);
    expect(progress.rank).toBe('Sensei');
    expect(progress.level).toBe(RANKS.length);
    expect(progress.nextRank).toBeNull();
    expect(progress.ratio).toBe(1);
    expect(progress.xpToNextRank).toBe(0);
  });

  it('reports the most recent review', () => {
    const progress = computeProgress(
      store({
        '0001': [
          { rating: 'easy', daysAgo: 9 },
          { rating: 'hard', daysAgo: 2 },
        ],
      }),
      NOW,
    );
    expect(progress.lastReviewAt).toBe(at(2));
    expect(daysSinceLastReview(progress, NOW)).toBe(2);
  });

  it('has no days-since value before any review', () => {
    expect(daysSinceLastReview(computeProgress(store({}), NOW), NOW)).toBeNull();
  });
});

describe('rankIndexForXp', () => {
  it('uses the documented cumulative thresholds', () => {
    expect(rankIndexForXp(0)).toBe(0);
    expect(rankIndexForXp(49)).toBe(0);
    expect(rankIndexForXp(50)).toBe(1);
    expect(rankIndexForXp(129)).toBe(1);
    expect(rankIndexForXp(130)).toBe(2);
    expect(rankIndexForXp(259)).toBe(2);
    expect(rankIndexForXp(260)).toBe(3);
    expect(rankIndexForXp(449)).toBe(3);
    expect(rankIndexForXp(450)).toBe(4);
    expect(rankIndexForXp(699)).toBe(4);
    expect(rankIndexForXp(700)).toBe(5);
    expect(rankIndexForXp(10_000)).toBe(RANKS.length - 1);
  });

  it('treats negative XP as the first rank rather than crashing', () => {
    expect(rankIndexForXp(-5)).toBe(0);
  });
});

describe('computeStreakDays', () => {
  it('counts consecutive days ending today', () => {
    expect(computeStreakDays([{ at: at(0) }, { at: at(1) }, { at: at(2) }], NOW)).toBe(3);
  });

  it('keeps a streak that ended yesterday', () => {
    expect(computeStreakDays([{ at: at(1) }, { at: at(2) }], NOW)).toBe(2);
  });

  it('breaks on a missed day', () => {
    expect(computeStreakDays([{ at: at(0) }, { at: at(2) }, { at: at(3) }], NOW)).toBe(1);
  });

  it('is zero when the last review is older than yesterday', () => {
    expect(computeStreakDays([{ at: at(3) }], NOW)).toBe(0);
  });

  it('counts a day once regardless of how many reviews it holds', () => {
    expect(computeStreakDays([{ at: at(0, 9) }, { at: at(0, 21) }, { at: at(1, 10) }], NOW)).toBe(
      2,
    );
  });

  it('handles an empty history and unparsable timestamps', () => {
    expect(computeStreakDays([], NOW)).toBe(0);
    expect(computeStreakDays([{ at: 'not-a-date' }], NOW)).toBe(0);
  });

  it('uses local calendar days', () => {
    const lateEvening = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate(), 23, 0, 0);
    const earlyMorning = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate(), 0, 30, 0);
    expect(localDayKey(lateEvening)).toBe(localDayKey(earlyMorning));
    expect(computeStreakDays([{ at: lateEvening.toISOString() }], earlyMorning)).toBe(1);
  });
});
