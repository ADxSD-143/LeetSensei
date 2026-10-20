import { describe, expect, it } from 'vitest';
import {
  MAX_CATEGORY_LENGTH,
  isReservedSegmentName,
  normalizeCategories,
  normalizeCategory,
} from '../../src/core/tags';

describe('normalizeCategory', () => {
  it('maps official LeetCode tags to deterministic folder names', () => {
    expect(normalizeCategory('Hash Table')).toBe('Hash-Table');
    expect(normalizeCategory('Two Pointers')).toBe('Two-Pointers');
    expect(normalizeCategory('Depth-First Search')).toBe('Depth-First-Search');
    expect(normalizeCategory('Breadth-First Search')).toBe('Breadth-First-Search');
    expect(normalizeCategory('Binary Search')).toBe('Binary-Search');
    expect(normalizeCategory('Union Find')).toBe('Union-Find');
    expect(normalizeCategory('Sliding Window')).toBe('Sliding-Window');
    expect(normalizeCategory('Array')).toBe('Array');
  });

  it('is stable for the same input', () => {
    const first = normalizeCategory('Hash Table');
    const second = normalizeCategory('Hash Table');
    expect(first).toBe(second);
  });

  it('collapses repeated separators and trims them', () => {
    expect(normalizeCategory('  Hash   Table  ')).toBe('Hash-Table');
    expect(normalizeCategory('Linked-List')).toBe('Linked-List');
    expect(normalizeCategory('--Trie--')).toBe('Trie');
  });

  it('replaces path separators instead of creating directories', () => {
    expect(normalizeCategory('a/b')).toBe('a-b');
    expect(normalizeCategory('a\\b')).toBe('a-b');
    expect(normalizeCategory('a:b')).toBe('a-b');
  });

  it('keeps unicode letters and digits', () => {
    expect(normalizeCategory('Ünicode Tag')).toBe('Ünicode-Tag');
    expect(normalizeCategory('日本語')).toBe('日本語');
  });

  it('keeps a trailing plus sign that is part of a language-style tag', () => {
    expect(normalizeCategory('C++')).toBe('C++');
  });

  it('never returns an empty or reserved folder name', () => {
    const emptyish = normalizeCategory('***');
    expect(emptyish).not.toBe('');
    expect(emptyish.startsWith('Tag-')).toBe(true);
    expect(normalizeCategory('Con')).toBe('Con-tag');
    expect(normalizeCategory('aux')).toBe('aux-tag');
    expect(normalizeCategory('LPT1')).toBe('LPT1-tag');
  });

  it('bounds the folder name length', () => {
    const long = normalizeCategory('A'.repeat(200));
    expect(long.length).toBeLessThanOrEqual(MAX_CATEGORY_LENGTH);
    expect(normalizeCategory('A'.repeat(200))).toBe(long);
  });
});

describe('isReservedSegmentName', () => {
  it('detects Windows device names including extension forms', () => {
    expect(isReservedSegmentName('CON')).toBe(true);
    expect(isReservedSegmentName('con')).toBe(true);
    expect(isReservedSegmentName('CON.txt')).toBe(true);
    expect(isReservedSegmentName('NUL')).toBe(true);
    expect(isReservedSegmentName('COM4')).toBe(true);
    expect(isReservedSegmentName('Console')).toBe(false);
    expect(isReservedSegmentName('.leetcode-tracker')).toBe(false);
  });
});

describe('normalizeCategories', () => {
  it('sorts, dedupes case-insensitively and drops blanks', () => {
    expect(normalizeCategories(['Two Pointers', 'Array', 'array', '', '  '])).toEqual([
      'Array',
      'Two-Pointers',
    ]);
  });

  it('dedupes tags that normalise to the same folder', () => {
    expect(normalizeCategories(['Hash Table', 'hash-table', 'Hash  Table'])).toEqual([
      'Hash-Table',
    ]);
  });

  it('is deterministic regardless of input order for the same set', () => {
    const a = normalizeCategories(['Trie', 'Array', 'Hash Table']);
    const b = normalizeCategories(['Hash Table', 'Trie', 'Array']);
    expect(a).toEqual(b);
  });

  it('returns an empty list for no tags', () => {
    expect(normalizeCategories([])).toEqual([]);
  });
});
