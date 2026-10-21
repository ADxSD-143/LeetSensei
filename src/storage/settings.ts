import { isRecord, readBoolean, readString } from '../shared/validation';
import { DEFAULT_REVISION_INTERVALS, normalizeIntervals } from '../core/schedule';
import { FALLBACK_CATEGORY } from '../core/normalize';

/** User configuration. Persisted locally only; never uploaded. */

export type AuthScope = 'public_repo' | 'repo';
export type ThemePreference = 'auto' | 'light' | 'dark';

export interface Settings {
  repoOwner: string;
  repoName: string;
  branch: string;
  /** Sync as soon as an Accepted submission is detected. */
  autoSync: boolean;
  /** Master switch for the LeetCode content script. */
  detectSubmissions: boolean;
  /** Bucket used when LeetCode returns no topic tags. */
  fallbackCategory: string;
  /** Revision ladder in days. */
  revisionIntervals: number[];
  /**
   * `public_repo` is enough for a public destination repository; `repo` is
   * required only if the user picks a private one. Requested at sign-in time.
   */
  authScope: AuthScope;
  theme: ThemePreference;
}

export function defaultSettings(): Settings {
  return {
    repoOwner: '',
    repoName: '',
    branch: 'main',
    autoSync: true,
    detectSubmissions: true,
    fallbackCategory: FALLBACK_CATEGORY,
    revisionIntervals: [...DEFAULT_REVISION_INTERVALS],
    authScope: 'public_repo',
    // The cinematic dark theme is the intended first impression; "auto" and
    // "light" remain selectable, and existing stored preferences are respected.
    theme: 'dark',
  };
}

const THEMES: readonly ThemePreference[] = ['auto', 'light', 'dark'];
const AUTH_SCOPES: readonly AuthScope[] = ['public_repo', 'repo'];

/**
 * Merges stored values over the defaults and coerces anything invalid, so a
 * corrupt or hand-edited settings blob can never break the extension.
 */
export function normalizeSettings(value: unknown): Settings {
  const defaults = defaultSettings();
  if (!isRecord(value)) return defaults;

  const rawIntervals = value.revisionIntervals;
  const intervals = Array.isArray(rawIntervals)
    ? rawIntervals.filter((entry): entry is number => typeof entry === 'number')
    : undefined;

  const scope = readString(value, 'authScope');
  const theme = readString(value, 'theme');

  return {
    repoOwner: (readString(value, 'repoOwner') ?? '').trim(),
    repoName: (readString(value, 'repoName') ?? '').trim(),
    branch: (readString(value, 'branch') ?? defaults.branch).trim() || defaults.branch,
    autoSync: readBoolean(value, 'autoSync') ?? defaults.autoSync,
    detectSubmissions: readBoolean(value, 'detectSubmissions') ?? defaults.detectSubmissions,
    fallbackCategory:
      (readString(value, 'fallbackCategory') ?? defaults.fallbackCategory).trim() ||
      defaults.fallbackCategory,
    revisionIntervals: normalizeIntervals(intervals),
    authScope: AUTH_SCOPES.includes(scope as AuthScope) ? (scope as AuthScope) : defaults.authScope,
    theme: THEMES.includes(theme as ThemePreference) ? (theme as ThemePreference) : defaults.theme,
  };
}

export function isRepoConfigured(settings: Settings): boolean {
  return settings.repoOwner !== '' && settings.repoName !== '';
}

/** Applies a partial patch from the options page and re-normalises the result. */
export function applySettingsPatch(current: Settings, patch: Record<string, unknown>): Settings {
  return normalizeSettings({ ...current, ...patch });
}

/** Git ref names may not contain whitespace, control characters or `..`. */
export function sanitizeBranchName(branch: string): string | null {
  const trimmed = branch.trim();
  if (trimmed === '') return null;
  // eslint-disable-next-line no-control-regex -- rejected on purpose
  if (/[\u0000-\u001f\u007f ~^:?*[\\]/.test(trimmed)) return null;
  if (trimmed.startsWith('/') || trimmed.endsWith('/')) return null;
  if (trimmed.includes('..') || trimmed.includes('@{')) return null;
  if (trimmed.endsWith('.') || trimmed.endsWith('.lock')) return null;
  if (trimmed === '@') return null;
  return trimmed;
}

/** GitHub owner and repository names are limited to this character set. */
export function sanitizeRepoPart(part: string): string | null {
  const trimmed = part.trim();
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) return null;
  if (trimmed === '.' || trimmed === '..') return null;
  return trimmed;
}

export function readIntervalsFromInput(input: string): number[] {
  return normalizeIntervals(
    input
      .split(/[,\s]+/)
      .map((entry) => Number(entry.trim()))
      .filter((entry) => Number.isFinite(entry)),
  );
}

export function intervalsToInput(intervals: readonly number[]): string {
  return normalizeIntervals(intervals).join(', ');
}
