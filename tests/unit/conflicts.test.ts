import { describe, expect, it } from 'vitest';
import { classifyFile, isConflictDecision, summarizeComparisons } from '../../src/core/conflicts';

const file = { path: 'Array/0217-x/solution.py', blobSha: 'planned', kind: 'solution' as const };

describe('classifyFile', () => {
  it('treats a brand new path as safe to create', () => {
    const comparison = classifyFile({ file, remoteBlobSha: null, knownBlobSha: null });
    expect(comparison.state).toBe('new');
    expect(comparison.requiresDecision).toBe(false);
  });

  it('treats identical unmanaged content as unchanged', () => {
    const comparison = classifyFile({ file, remoteBlobSha: 'planned', knownBlobSha: null });
    expect(comparison.state).toBe('unchanged');
    expect(comparison.requiresDecision).toBe(false);
  });

  it('protects a file LeetSensei never created', () => {
    const comparison = classifyFile({ file, remoteBlobSha: 'someone-elses', knownBlobSha: null });
    expect(comparison.state).toBe('unmanaged-existing');
    expect(comparison.requiresDecision).toBe(true);
  });

  it('updates its own untouched file', () => {
    const comparison = classifyFile({ file, remoteBlobSha: 'known', knownBlobSha: 'known' });
    expect(comparison.state).toBe('update');
    expect(comparison.requiresDecision).toBe(false);
  });

  it('is a no-op when its own file already matches the plan', () => {
    const comparison = classifyFile({ file, remoteBlobSha: 'planned', knownBlobSha: 'planned' });
    expect(comparison.state).toBe('unchanged');
    expect(comparison.requiresDecision).toBe(false);
  });

  it('recreates a managed file that was deleted remotely', () => {
    const comparison = classifyFile({ file, remoteBlobSha: null, knownBlobSha: 'known' });
    expect(comparison.state).toBe('update');
    expect(comparison.requiresDecision).toBe(false);
  });

  it('flags a remote edit as a conflict', () => {
    const comparison = classifyFile({ file, remoteBlobSha: 'edited', knownBlobSha: 'known' });
    expect(comparison.state).toBe('remote-modified');
    expect(comparison.requiresDecision).toBe(true);
    expect(comparison.message).toMatch(/changed in the repository/);
  });

  it('downgrades a remote edit when the README merge provably kept user text', () => {
    const comparison = classifyFile({
      file: { ...file, kind: 'readme' },
      remoteBlobSha: 'edited',
      knownBlobSha: 'known',
      losslessMerge: true,
    });
    expect(comparison.state).toBe('update');
    expect(comparison.requiresDecision).toBe(false);
    expect(comparison.losslessMerge).toBe(true);
  });

  it('still flags a README merge that would lose content', () => {
    const comparison = classifyFile({
      file: { ...file, kind: 'readme' },
      remoteBlobSha: 'edited',
      knownBlobSha: 'known',
      losslessMerge: false,
    });
    expect(comparison.requiresDecision).toBe(true);
  });

  it('refreshes LeetSensei-owned tracker backups without asking', () => {
    const tracked = { ...file, kind: 'manifest' as const };
    expect(
      classifyFile({ file: tracked, remoteBlobSha: null, knownBlobSha: null, owned: true }),
    ).toMatchObject({ state: 'new', requiresDecision: false });
    expect(
      classifyFile({ file: tracked, remoteBlobSha: 'planned', knownBlobSha: null, owned: true }),
    ).toMatchObject({ state: 'unchanged', requiresDecision: false });
    expect(
      classifyFile({ file: tracked, remoteBlobSha: 'old', knownBlobSha: 'known', owned: true }),
    ).toMatchObject({ state: 'update', requiresDecision: false });
  });
});

describe('summarizeComparisons', () => {
  it('counts each outcome', () => {
    const summary = summarizeComparisons([
      classifyFile({ file, remoteBlobSha: null, knownBlobSha: null }),
      classifyFile({ file, remoteBlobSha: 'known', knownBlobSha: 'known' }),
      classifyFile({ file, remoteBlobSha: 'planned', knownBlobSha: 'planned' }),
      classifyFile({ file, remoteBlobSha: 'foreign', knownBlobSha: null }),
    ]);
    expect(summary).toMatchObject({ newFiles: 1, updates: 1, unchanged: 1, conflicts: 1 });
    expect(summary.byPath.get(file.path)?.state).toBe('unmanaged-existing');
  });

  it('handles an empty list', () => {
    expect(summarizeComparisons([])).toMatchObject({ newFiles: 0, conflicts: 0 });
  });
});

describe('isConflictDecision', () => {
  it('accepts only the documented decisions', () => {
    expect(isConflictDecision('replace')).toBe(true);
    expect(isConflictDecision('save-version')).toBe(true);
    expect(isConflictDecision('cancel')).toBe(true);
    expect(isConflictDecision('overwrite')).toBe(false);
    expect(isConflictDecision(null)).toBe(false);
  });
});
