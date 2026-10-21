import { describe, expect, it } from 'vitest';
import {
  applySettingsPatch,
  defaultSettings,
  intervalsToInput,
  isRepoConfigured,
  normalizeSettings,
  readIntervalsFromInput,
  sanitizeBranchName,
  sanitizeRepoPart,
} from '../../src/storage/settings';

describe('defaultSettings', () => {
  it('is safe to use before anything is configured', () => {
    const settings = defaultSettings();
    expect(isRepoConfigured(settings)).toBe(false);
    expect(settings.branch).toBe('main');
    expect(settings.revisionIntervals).toEqual([1, 3, 7, 14, 30]);
    expect(settings.authScope).toBe('public_repo');
    expect(settings.autoSync).toBe(true);
  });
});

describe('normalizeSettings', () => {
  it('falls back to defaults for anything unusable', () => {
    expect(normalizeSettings(null)).toEqual(defaultSettings());
    expect(normalizeSettings([])).toEqual(defaultSettings());
    expect(normalizeSettings({ repoOwner: 5, autoSync: 'yes' })).toEqual(defaultSettings());
  });

  it('keeps valid values and trims them', () => {
    const settings = normalizeSettings({
      repoOwner: '  student  ',
      repoName: ' solutions ',
      branch: '  trunk  ',
      autoSync: false,
      detectSubmissions: false,
      fallbackCategory: '  Misc  ',
      revisionIntervals: [2, 4, 6],
      authScope: 'repo',
      theme: 'dark',
    });
    expect(settings).toMatchObject({
      repoOwner: 'student',
      repoName: 'solutions',
      branch: 'trunk',
      autoSync: false,
      detectSubmissions: false,
      fallbackCategory: 'Misc',
      revisionIntervals: [2, 4, 6],
      authScope: 'repo',
      theme: 'dark',
    });
  });

  it('rejects unknown enum values and repairs an empty branch', () => {
    const settings = normalizeSettings({ authScope: 'everything', theme: 'neon', branch: '   ' });
    expect(settings.authScope).toBe('public_repo');
    expect(settings.theme).toBe('dark');
    expect(settings.branch).toBe('main');
  });

  it('sanitises the revision ladder', () => {
    expect(
      normalizeSettings({ revisionIntervals: [0, -1, 3.6, 5000, 'x'] }).revisionIntervals,
    ).toEqual([4]);
    expect(normalizeSettings({ revisionIntervals: 'nope' }).revisionIntervals).toEqual([
      1, 3, 7, 14, 30,
    ]);
  });
});

describe('applySettingsPatch', () => {
  it('merges a patch and re-normalises', () => {
    const next = applySettingsPatch(defaultSettings(), {
      repoOwner: 'student',
      revisionIntervals: [1, 5],
    });
    expect(next.repoOwner).toBe('student');
    expect(next.revisionIntervals).toEqual([1, 5]);
    expect(next.branch).toBe('main');
  });

  it('ignores an invalid patch value', () => {
    const next = applySettingsPatch(defaultSettings(), { branch: '   ' });
    expect(next.branch).toBe('main');
  });
});

describe('isRepoConfigured', () => {
  it('requires both halves of the destination', () => {
    expect(isRepoConfigured({ ...defaultSettings(), repoOwner: 'a' })).toBe(false);
    expect(isRepoConfigured({ ...defaultSettings(), repoName: 'b' })).toBe(false);
    expect(isRepoConfigured({ ...defaultSettings(), repoOwner: 'a', repoName: 'b' })).toBe(true);
  });
});

describe('sanitizeBranchName', () => {
  it('accepts ordinary branch names', () => {
    expect(sanitizeBranchName('main')).toBe('main');
    expect(sanitizeBranchName('feature/leetcode-sync')).toBe('feature/leetcode-sync');
    expect(sanitizeBranchName('  release-1.2  ')).toBe('release-1.2');
  });

  it('rejects names git would refuse', () => {
    for (const name of [
      '',
      '   ',
      'with space',
      'has~tilde',
      'has^caret',
      'has:colon',
      'has?question',
      'has*star',
      'has[bracket',
      'back\\slash',
      'double..dot',
      'ends/',
      '/starts',
      'trailing.',
      'at@{brace',
      'ends.lock',
      '@',
    ]) {
      expect(sanitizeBranchName(name)).toBeNull();
    }
  });
});

describe('sanitizeRepoPart', () => {
  it('accepts GitHub names', () => {
    expect(sanitizeRepoPart('student')).toBe('student');
    expect(sanitizeRepoPart('my-org.name_1')).toBe('my-org.name_1');
  });

  it('rejects anything with a path or shell meaning', () => {
    for (const part of ['', '  ', '.', '..', 'a/b', 'a\\b', 'a b', 'a;b', 'a$b', 'a\u0000b']) {
      expect(sanitizeRepoPart(part)).toBeNull();
    }
  });
});

describe('revision interval input', () => {
  it('parses a comma or space separated list', () => {
    expect(readIntervalsFromInput('1, 3, 7')).toEqual([1, 3, 7]);
    expect(readIntervalsFromInput('1 3 7')).toEqual([1, 3, 7]);
    expect(readIntervalsFromInput('')).toEqual([1, 3, 7, 14, 30]);
    expect(readIntervalsFromInput('junk')).toEqual([1, 3, 7, 14, 30]);
    expect(readIntervalsFromInput('9, 9, 2')).toEqual([2, 9]);
  });

  it('round-trips through the input format', () => {
    expect(intervalsToInput(readIntervalsFromInput('3, 1, 7'))).toBe('1, 3, 7');
  });
});
