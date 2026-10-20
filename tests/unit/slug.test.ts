import { describe, expect, it } from 'vitest';
import { buildProblemSlug, normalizeTitleSlug, padProblemId, slugify } from '../../src/core/slug';

describe('slugify', () => {
  it('produces ascii kebab-case', () => {
    expect(slugify('Contains Duplicate')).toBe('contains-duplicate');
    expect(slugify('Contains Duplicate II')).toBe('contains-duplicate-ii');
    expect(slugify('3Sum Closest')).toBe('3sum-closest');
    expect(slugify('  Trailing   Spaces  ')).toBe('trailing-spaces');
  });

  it('strips diacritics', () => {
    expect(slugify('Café Society')).toBe('cafe-society');
  });

  it('returns an empty string when there is nothing usable', () => {
    expect(slugify('!!!')).toBe('');
  });
});

describe('normalizeTitleSlug', () => {
  it('sanitises an untrusted title slug', () => {
    expect(normalizeTitleSlug('two-sum')).toBe('two-sum');
    expect(normalizeTitleSlug('Two Sum')).toBe('two-sum');
    expect(normalizeTitleSlug('../etc/passwd')).toBe('etc-passwd');
  });

  it('falls back to a stable placeholder for unusable input', () => {
    const first = normalizeTitleSlug('###');
    expect(first).toBe(normalizeTitleSlug('###'));
    expect(first.startsWith('problem-')).toBe(true);
  });
});

describe('padProblemId', () => {
  it('zero-pads to four digits', () => {
    expect(padProblemId('217')).toBe('0217');
    expect(padProblemId('1')).toBe('0001');
    expect(padProblemId('2170')).toBe('2170');
    expect(padProblemId('10000')).toBe('10000');
  });

  it('ignores non numeric decoration', () => {
    expect(padProblemId(' 217 ')).toBe('0217');
  });
});

describe('buildProblemSlug', () => {
  it('builds the documented folder name', () => {
    expect(
      buildProblemSlug({
        problemId: '217',
        titleSlug: 'contains-duplicate',
        title: 'Contains Duplicate',
      }),
    ).toEqual({ slug: '0217-contains-duplicate', problemId: '0217', usedNumericId: true });
  });

  it('falls back to the title slug when the id is missing', () => {
    const result = buildProblemSlug({
      problemId: null,
      titleSlug: 'contains-duplicate',
      title: 'Contains Duplicate',
    });
    expect(result.slug).toBe('contains-duplicate');
    expect(result.problemId).toBe('contains-duplicate');
    expect(result.usedNumericId).toBe(false);
  });

  it('falls back to the title when the title slug is missing', () => {
    expect(buildProblemSlug({ problemId: '1', titleSlug: null, title: 'Two Sum' }).slug).toBe(
      '0001-two-sum',
    );
  });

  it('never produces an empty slug', () => {
    const result = buildProblemSlug({ problemId: null, titleSlug: null, title: null });
    expect(result.slug.length).toBeGreaterThan(0);
  });
});
