import { describe, expect, it } from 'vitest';
import {
  isIsoTimestamp,
  isNonEmptyString,
  isRecord,
  isSafeRelativePathShape,
  parseJson,
  readBoolean,
  readNumber,
  readString,
  readStringArray,
  valid,
} from '../../src/shared/validation';

describe('isRecord', () => {
  it('accepts plain objects only', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord('x')).toBe(false);
  });
});

describe('readers', () => {
  const source = { s: 'text', n: 5, b: true, arr: ['a', 'b'], mixed: ['a', 1], obj: { k: 1 } };

  it('reads the right types', () => {
    expect(readString(source, 's')).toBe('text');
    expect(readString(source, 'n')).toBeUndefined();
    expect(readNumber(source, 'n')).toBe(5);
    expect(readNumber(source, 'missing')).toBeUndefined();
    expect(readBoolean(source, 'b')).toBe(true);
    expect(readBoolean(source, 's')).toBeUndefined();
    expect(readStringArray(source, 'arr')).toEqual(['a', 'b']);
    expect(readStringArray(source, 'mixed')).toBeUndefined();
    expect(isNonEmptyString('  x  ')).toBe(true);
    expect(isNonEmptyString('   ')).toBe(false);
  });

  it('rejects non finite numbers', () => {
    expect(readNumber({ n: Number.NaN }, 'n')).toBeUndefined();
    expect(readNumber({ n: Number.POSITIVE_INFINITY }, 'n')).toBeUndefined();
  });
});

describe('parseJson', () => {
  it('parses valid json', () => {
    expect(parseJson('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
  });

  it('never throws on invalid json', () => {
    const result = parseJson('{oops');
    expect(result.ok).toBe(false);
  });
});

describe('isIsoTimestamp', () => {
  it('accepts ISO 8601 timestamps', () => {
    expect(isIsoTimestamp('2024-03-05T06:07:08.000Z')).toBe(true);
    expect(isIsoTimestamp('2024-03-05T06:07:08Z')).toBe(true);
    expect(isIsoTimestamp('2024-03-05T06:07:08+05:30')).toBe(true);
  });

  it('rejects other formats', () => {
    expect(isIsoTimestamp('2024-03-05')).toBe(false);
    expect(isIsoTimestamp('yesterday')).toBe(false);
    expect(isIsoTimestamp(1_700_000_000)).toBe(false);
    expect(isIsoTimestamp(null)).toBe(false);
  });
});

describe('isSafeRelativePathShape', () => {
  it('accepts plain relative paths', () => {
    expect(isSafeRelativePathShape('a/b/c.py')).toBe(true);
    expect(isSafeRelativePathShape('.leetcode-tracker/manifest.json')).toBe(true);
  });

  it('rejects traversal, absolute and control characters', () => {
    expect(isSafeRelativePathShape('../x')).toBe(false);
    expect(isSafeRelativePathShape('/x')).toBe(false);
    expect(isSafeRelativePathShape('C:\\x')).toBe(false);
    expect(isSafeRelativePathShape('a//b')).toBe(false);
    expect(isSafeRelativePathShape('a\u0000b')).toBe(false);
    expect(isSafeRelativePathShape('')).toBe(false);
    expect(isSafeRelativePathShape(5)).toBe(false);
  });
});

describe('valid', () => {
  it('wraps a value', () => {
    expect(valid(1)).toEqual({ ok: true, value: 1 });
  });
});
