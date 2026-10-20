import { describe, expect, it } from 'vitest';
import {
  normalizeLanguageId,
  resolveLanguage,
  solutionFileName,
  supportedLanguageIds,
} from '../../src/core/language';

describe('resolveLanguage', () => {
  it('maps the documented LeetCode language ids to extensions', () => {
    expect(resolveLanguage('cpp')).toEqual({ id: 'cpp', label: 'C++', extension: 'cpp' });
    expect(resolveLanguage('python3')).toEqual({
      id: 'python3',
      label: 'Python 3',
      extension: 'py',
    });
    expect(resolveLanguage('java')?.extension).toBe('java');
    expect(resolveLanguage('golang')?.extension).toBe('go');
    expect(resolveLanguage('csharp')?.extension).toBe('cs');
    expect(resolveLanguage('typescript')?.extension).toBe('ts');
    expect(resolveLanguage('mysql')?.extension).toBe('sql');
    expect(resolveLanguage('rust')?.extension).toBe('rs');
  });

  it('tolerates display names', () => {
    expect(resolveLanguage('Python 3')?.id).toBe('python3');
    expect(resolveLanguage(' C++ ')?.id).toBe('cpp');
  });

  it('resolves aliases to the canonical LeetCode language id', () => {
    expect(resolveLanguage('C++')?.id).toBe('cpp');
    expect(resolveLanguage('C#')?.id).toBe('csharp');
    expect(resolveLanguage('F#')?.id).toBe('fsharp');
  });

  it('reports unknown languages instead of guessing', () => {
    expect(resolveLanguage('brainfuck')).toBeNull();
    expect(resolveLanguage('')).toBeNull();
    expect(resolveLanguage('COBOL-85-SPECIAL')).toBeNull();
  });
});

describe('normalizeLanguageId', () => {
  it('normalises separators and case', () => {
    expect(normalizeLanguageId('Python 3')).toBe('python3');
    expect(normalizeLanguageId('objective-c')).toBe('objectivec');
    expect(normalizeLanguageId('MS_SQL')).toBe('mssql');
  });
});

describe('supportedLanguageIds', () => {
  it('is sorted and includes the common contest languages', () => {
    const ids = supportedLanguageIds();
    expect(ids).toEqual([...ids].sort());
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ['cpp', 'java', 'python3', 'javascript', 'typescript', 'rust', 'go']) {
      expect(ids).toContain(id);
    }
  });

  it('does not expose alias keys as separate languages', () => {
    expect(supportedLanguageIds()).not.toContain('c++');
  });
});

describe('solutionFileName', () => {
  it('builds one file name per language extension', () => {
    expect(solutionFileName('py')).toBe('solution.py');
    expect(solutionFileName('cpp')).toBe('solution.cpp');
  });
});
