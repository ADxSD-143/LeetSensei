import { describe, expect, it } from 'vitest';
import { LeetSenseiError } from '../../src/shared/errors';
import {
  assertSafeRepoPath,
  findPathProblem,
  isSafeRepoPath,
  joinRepoPath,
  problemDirectory,
  readmePath,
  solutionPath,
  versionStamp,
  versionedFileName,
  versionedPath,
} from '../../src/core/paths';

describe('path safety', () => {
  it('accepts the documented repository layout', () => {
    expect(isSafeRepoPath('Arrays/0217-contains-duplicate/README.md')).toBe(true);
    expect(isSafeRepoPath('Hash-Table/0217-contains-duplicate/solution.cpp')).toBe(true);
    expect(isSafeRepoPath('.leetcode-tracker/manifest.json')).toBe(true);
  });

  it('rejects traversal and absolute paths', () => {
    expect(isSafeRepoPath('../etc/passwd')).toBe(false);
    expect(isSafeRepoPath('Arrays/../../etc/passwd')).toBe(false);
    expect(isSafeRepoPath('/etc/passwd')).toBe(false);
    expect(isSafeRepoPath('C:/windows/system32')).toBe(false);
    expect(isSafeRepoPath('')).toBe(false);
  });

  it('rejects platform-hostile names', () => {
    expect(isSafeRepoPath('a/b\\c')).toBe(false);
    expect(isSafeRepoPath('a/<b>.py')).toBe(false);
    expect(isSafeRepoPath('a/b:c.py')).toBe(false);
    expect(isSafeRepoPath('a/b"c.py')).toBe(false);
    expect(isSafeRepoPath('a/trailing.' + '')).toBe(false);
    expect(isSafeRepoPath('a/ trailing')).toBe(false);
    expect(isSafeRepoPath('Arrays/CON')).toBe(false);
    expect(isSafeRepoPath('Arrays/CON.txt')).toBe(false);
    expect(isSafeRepoPath('a//b')).toBe(false);
    expect(isSafeRepoPath('a/b/')).toBe(false);
  });

  it('rejects control characters and over-long segments', () => {
    expect(isSafeRepoPath('a/b\u0000c')).toBe(false);
    expect(isSafeRepoPath(`a/${'b'.repeat(101)}`)).toBe(false);
    expect(isSafeRepoPath(`a/${'b'.repeat(99)}`)).toBe(true);
  });

  it('reports the reason for a rejection', () => {
    expect(findPathProblem('/etc/passwd')).toBe('is absolute');
    expect(findPathProblem('../x')).toBe('contains a traversal segment');
    expect(findPathProblem('a/../b')).toBe('contains a traversal segment');
    expect(findPathProblem('ok/path')).toBeNull();
  });

  it('throws a typed error from assertSafeRepoPath', () => {
    try {
      assertSafeRepoPath('../escape');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(LeetSenseiError);
      expect((error as LeetSenseiError).code).toBe('unsafe_path');
    }
  });
});

describe('path builders', () => {
  it('builds category-first paths', () => {
    expect(problemDirectory('Arrays', '0217-contains-duplicate')).toBe(
      'Arrays/0217-contains-duplicate',
    );
    expect(readmePath('Arrays', '0217-contains-duplicate')).toBe(
      'Arrays/0217-contains-duplicate/README.md',
    );
    expect(solutionPath('Hash-Table', '0217-contains-duplicate', 'py')).toBe(
      'Hash-Table/0217-contains-duplicate/solution.py',
    );
  });

  it('rejects unsafe segments while building', () => {
    expect(() => solutionPath('..', 'x', 'py')).toThrow(LeetSenseiError);
    expect(() => joinRepoPath('a', '../b')).toThrow(LeetSenseiError);
  });
});

describe('versioning', () => {
  it('formats a deterministic UTC stamp', () => {
    expect(versionStamp('2024-03-05T06:07:08.000Z', '2024-01-01T00:00:00.000Z')).toBe(
      '20240305-060708',
    );
  });

  it('falls back when the timestamp is unusable', () => {
    expect(versionStamp(null, '2024-03-05T06:07:08.000Z')).toBe('20240305-060708');
    expect(versionStamp('not-a-date', 'not-a-date')).toBe('19700101-000000');
  });

  it('names versioned copies without losing the extension', () => {
    expect(versionedFileName('solution.py', '20240305-060708')).toBe('solution.20240305-060708.py');
    expect(versionedFileName('README.md', '20240305-060708')).toBe('README.20240305-060708.md');
    expect(versionedFileName('solution.py', '20240305-060708', 2)).toBe(
      'solution.20240305-060708-2.py',
    );
  });

  it('avoids collisions deterministically', () => {
    const taken = new Set(['Arrays/0217-x/solution.20240305-060708.py']);
    const first = versionedPath('Arrays/0217-x/solution.py', '20240305-060708', taken);
    const second = versionedPath('Arrays/0217-x/solution.py', '20240305-060708', taken);
    expect(first).toBe('Arrays/0217-x/solution.20240305-060708-2.py');
    expect(second).toBe(first);
  });

  it('uses the plain stamp when the name is free', () => {
    expect(versionedPath('Arrays/0217-x/solution.py', '20240305-060708', new Set())).toBe(
      'Arrays/0217-x/solution.20240305-060708.py',
    );
  });
});
