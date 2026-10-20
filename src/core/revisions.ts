import {
  invalid,
  isIsoTimestamp,
  isRecord,
  readNumber,
  readString,
  valid,
  type ValidationResult,
} from '../shared/validation';
import type { ReviewRating } from './model';
import { computeNextReviewAt, nextIntervalDays, shortestInterval } from './schedule';

/**
 * Revision state.
 *
 * One canonical record per problem (never per language or per category).
 * Stored locally as the primary copy and mirrored to
 * `.leetcode-tracker/revisions.json` in the connected repository so it survives
 * a reinstall or a move to another machine.
 */

export const REVISIONS_SCHEMA_VERSION = 1;
export const MAX_HISTORY_ENTRIES = 200;

export interface ReviewEvent {
  at: string;
  rating: ReviewRating;
  intervalBeforeDays: number;
  intervalAfterDays: number;
}

export interface RevisionRecord {
  problemId: string;
  slug: string;
  title: string;
  lastReviewedAt: string | null;
  nextReviewAt: string;
  currentIntervalDays: number;
  successfulReviews: number;
  history: ReviewEvent[];
}

export interface RevisionStore {
  schemaVersion: number;
  generatedAt: string;
  problems: Record<string, RevisionRecord>;
}

export function createEmptyRevisionStore(nowIso: string): RevisionStore {
  return { schemaVersion: REVISIONS_SCHEMA_VERSION, generatedAt: nowIso, problems: {} };
}

const RATINGS: readonly ReviewRating[] = ['again', 'hard', 'easy'];

function isRating(value: unknown): value is ReviewRating {
  return typeof value === 'string' && (RATINGS as readonly string[]).includes(value);
}

export function createRevisionRecord(input: {
  problemId: string;
  slug: string;
  title: string;
  nowIso: string;
  intervals?: readonly number[];
}): RevisionRecord {
  return {
    problemId: input.problemId,
    slug: input.slug,
    title: input.title,
    lastReviewedAt: null,
    nextReviewAt: computeNextReviewAt(input.nowIso, shortestInterval(input.intervals)),
    currentIntervalDays: shortestInterval(input.intervals),
    successfulReviews: 0,
    history: [],
  };
}

function validateEvent(value: unknown, where: string): ValidationResult<ReviewEvent> {
  if (!isRecord(value)) return invalid(`${where}: expected an object`);
  const at = readString(value, 'at');
  if (!isIsoTimestamp(at)) return invalid(`${where}.at: expected an ISO timestamp`);
  const rating = value.rating;
  if (!isRating(rating)) return invalid(`${where}.rating: expected again, hard or easy`);
  const intervalBeforeDays = readNumber(value, 'intervalBeforeDays') ?? 0;
  const intervalAfterDays = readNumber(value, 'intervalAfterDays') ?? 0;
  return valid({ at, rating, intervalBeforeDays, intervalAfterDays });
}

function validateRecord(value: unknown, key: string): ValidationResult<RevisionRecord> {
  if (!isRecord(value)) return invalid(`problems.${key}: expected an object`);
  const problemId = readString(value, 'problemId');
  if (!problemId) return invalid(`problems.${key}.problemId: required`);
  if (problemId !== key) return invalid(`problems.${key}.problemId: does not match its key`);
  const nextReviewAt = readString(value, 'nextReviewAt');
  if (!isIsoTimestamp(nextReviewAt))
    return invalid(`problems.${key}.nextReviewAt: expected an ISO timestamp`);
  const lastReviewedAtRaw = value.lastReviewedAt;
  const lastReviewedAt =
    lastReviewedAtRaw === null
      ? null
      : isIsoTimestamp(lastReviewedAtRaw)
        ? lastReviewedAtRaw
        : null;
  const currentIntervalDays = readNumber(value, 'currentIntervalDays');
  if (currentIntervalDays === undefined || currentIntervalDays < 1) {
    return invalid(`problems.${key}.currentIntervalDays: expected a positive number`);
  }
  const successfulReviews = readNumber(value, 'successfulReviews') ?? 0;
  const rawHistory = value.history;
  if (!Array.isArray(rawHistory)) return invalid(`problems.${key}.history: expected an array`);
  const history: ReviewEvent[] = [];
  for (const [index, rawEvent] of rawHistory.entries()) {
    const result = validateEvent(rawEvent, `problems.${key}.history[${index}]`);
    if (!result.ok) return result;
    history.push(result.value);
  }
  return valid({
    problemId,
    slug: readString(value, 'slug') ?? problemId,
    title: readString(value, 'title') ?? problemId,
    lastReviewedAt,
    nextReviewAt,
    currentIntervalDays,
    successfulReviews,
    history,
  });
}

export function validateRevisionStore(value: unknown): ValidationResult<RevisionStore> {
  if (!isRecord(value)) return invalid('revisions: expected an object');
  const schemaVersion = readNumber(value, 'schemaVersion');
  if (schemaVersion === undefined) return invalid('revisions.schemaVersion: required');
  if (schemaVersion > REVISIONS_SCHEMA_VERSION) {
    return invalid(
      `revisions.schemaVersion: ${schemaVersion} was written by a newer LeetSensei and cannot be read`,
    );
  }
  const problemsValue = value.problems;
  if (!isRecord(problemsValue)) return invalid('revisions.problems: expected an object');

  const problems: Record<string, RevisionRecord> = {};
  const errors: string[] = [];
  for (const [key, entry] of Object.entries(problemsValue)) {
    const result = validateRecord(entry, key);
    if (!result.ok) {
      errors.push(...result.errors);
      continue;
    }
    problems[key] = result.value;
  }
  if (errors.length > 0) return invalid(...errors);

  const generatedAt = readString(value, 'generatedAt');
  return valid({
    schemaVersion,
    generatedAt: isIsoTimestamp(generatedAt) ? generatedAt : new Date(0).toISOString(),
    problems,
  });
}

export interface RevisionMigrationOutcome {
  ok: boolean;
  store?: RevisionStore;
  migratedFrom: number | null;
  warnings: string[];
  errors: string[];
}

export function migrateRevisionStore(value: unknown, nowIso: string): RevisionMigrationOutcome {
  if (!isRecord(value)) {
    return {
      ok: false,
      migratedFrom: null,
      warnings: [],
      errors: ['revisions: expected an object'],
    };
  }
  const rawVersion = readNumber(value, 'schemaVersion');
  if (rawVersion === undefined) {
    if (!isRecord(value.problems)) {
      return {
        ok: false,
        migratedFrom: null,
        warnings: [],
        errors: ['revisions: unrecognised shape and no schemaVersion'],
      };
    }
    const result = validateRevisionStore({ ...value, schemaVersion: REVISIONS_SCHEMA_VERSION });
    if (!result.ok) return { ok: false, migratedFrom: 0, warnings: [], errors: result.errors };
    return {
      ok: true,
      store: result.value,
      migratedFrom: 0,
      warnings: ['Migrated versionless revision data to schema 1.'],
      errors: [],
    };
  }
  const result = validateRevisionStore(value);
  if (!result.ok)
    return { ok: false, migratedFrom: rawVersion, warnings: [], errors: result.errors };
  void nowIso;
  return {
    ok: true,
    store: result.value,
    migratedFrom: rawVersion === REVISIONS_SCHEMA_VERSION ? null : rawVersion,
    warnings: [],
    errors: [],
  };
}

export function applyReview(input: {
  store: RevisionStore;
  problemId: string;
  rating: ReviewRating;
  nowIso: string;
  intervals?: readonly number[];
  fallback?: { slug: string; title: string };
}): RevisionStore {
  const { store, problemId, rating, nowIso, intervals, fallback } = input;
  const existing =
    store.problems[problemId] ??
    createRevisionRecord({
      problemId,
      slug: fallback?.slug ?? problemId,
      title: fallback?.title ?? problemId,
      nowIso,
      ...(intervals ? { intervals } : {}),
    });

  const before = existing.currentIntervalDays;
  const after = nextIntervalDays(before, rating, intervals);

  const updated: RevisionRecord = {
    ...existing,
    lastReviewedAt: nowIso,
    currentIntervalDays: after,
    nextReviewAt: computeNextReviewAt(nowIso, after),
    successfulReviews: rating === 'again' ? 0 : existing.successfulReviews + 1,
    history: [
      ...existing.history,
      { at: nowIso, rating, intervalBeforeDays: before, intervalAfterDays: after },
    ].slice(-MAX_HISTORY_ENTRIES),
  };

  return {
    ...store,
    problems: { ...store.problems, [problemId]: updated },
  };
}

export function setNextReview(
  store: RevisionStore,
  problemId: string,
  nextReviewAt: string,
): RevisionStore {
  const existing = store.problems[problemId];
  if (!existing) return store;
  return {
    ...store,
    problems: { ...store.problems, [problemId]: { ...existing, nextReviewAt } },
  };
}

export function upsertRevisionRecord(store: RevisionStore, record: RevisionRecord): RevisionStore {
  const existing = store.problems[record.problemId];
  if (!existing) {
    return { ...store, problems: { ...store.problems, [record.problemId]: record } };
  }
  // Local scheduling wins over a restored record that has no review history.
  return store;
}

export function listRevisions(store: RevisionStore): RevisionRecord[] {
  return Object.values(store.problems).sort((left, right) =>
    left.nextReviewAt < right.nextReviewAt ? -1 : left.nextReviewAt > right.nextReviewAt ? 1 : 0,
  );
}
