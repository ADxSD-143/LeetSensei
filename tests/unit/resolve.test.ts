import { describe, expect, it } from 'vitest';
import { applyConflictDecision, unresolvedConflicts } from '../../src/core/resolve';
import type { PlannedFile } from '../../src/core/model';

function planned(path: string, content: string, overrides: Partial<PlannedFile> = {}): PlannedFile {
  return {
    path,
    category: 'Array',
    kind: 'solution',
    language: 'python3',
    content,
    contentHash: `hash:${content}`,
    blobSha: `blob:${content}`,
    version: 1,
    ...overrides,
  };
}

const STAMP_SOURCE = '2024-03-05T06:07:08.000Z';
const NOW = '2024-03-06T00:00:00.000Z';

describe('applyConflictDecision', () => {
  it('drops the file when the user cancels', async () => {
    const files = [planned('Array/0217-x/solution.py', 'new')];
    const outcome = await applyConflictDecision({
      files,
      path: 'Array/0217-x/solution.py',
      decision: 'cancel',
      remoteContent: 'old',
      taken: new Set(),
      stampSourceIso: STAMP_SOURCE,
      nowIso: NOW,
    });
    expect(outcome.files).toEqual([]);
    expect(outcome.skipped).toEqual(['Array/0217-x/solution.py']);
  });

  it('keeps the plan untouched when the user replaces', async () => {
    const files = [planned('Array/0217-x/solution.py', 'new')];
    const outcome = await applyConflictDecision({
      files,
      path: 'Array/0217-x/solution.py',
      decision: 'replace',
      remoteContent: 'old',
      taken: new Set(),
      stampSourceIso: STAMP_SOURCE,
      nowIso: NOW,
    });
    expect(outcome.files).toEqual(files);
    expect(outcome.preservedPath).toBeNull();
  });

  it('preserves the repository content under a deterministic versioned name', async () => {
    const files = [planned('Array/0217-x/solution.py', 'new')];
    const outcome = await applyConflictDecision({
      files,
      path: 'Array/0217-x/solution.py',
      decision: 'save-version',
      remoteContent: 'their code\n',
      taken: new Set(),
      stampSourceIso: STAMP_SOURCE,
      nowIso: NOW,
    });
    expect(outcome.preservedPath).toBe('Array/0217-x/solution.20240305-060708.py');
    const preserved = outcome.files.find((file) => file.path === outcome.preservedPath);
    expect(preserved?.content).toBe('their code\n');
    expect(preserved?.version).toBe(2);
    expect(outcome.files).toHaveLength(2);
    expect(new Set(outcome.files.map((file) => file.path)).size).toBe(2);
  });

  it('avoids collisions with paths that already exist', async () => {
    const files = [planned('Array/0217-x/solution.py', 'new')];
    const outcome = await applyConflictDecision({
      files,
      path: 'Array/0217-x/solution.py',
      decision: 'save-version',
      remoteContent: 'their code\n',
      taken: new Set(['Array/0217-x/solution.20240305-060708.py']),
      stampSourceIso: STAMP_SOURCE,
      nowIso: NOW,
    });
    expect(outcome.preservedPath).toBe('Array/0217-x/solution.20240305-060708-2.py');
  });

  it('behaves like replace when there is no remote content to keep', async () => {
    const files = [planned('Array/0217-x/solution.py', 'new')];
    const outcome = await applyConflictDecision({
      files,
      path: 'Array/0217-x/solution.py',
      decision: 'save-version',
      remoteContent: null,
      taken: new Set(),
      stampSourceIso: STAMP_SOURCE,
      nowIso: NOW,
    });
    expect(outcome.preservedPath).toBeNull();
    expect(outcome.files).toEqual(files);
  });

  it('ignores unknown paths', async () => {
    const files = [planned('Array/0217-x/solution.py', 'new')];
    const outcome = await applyConflictDecision({
      files,
      path: 'does/not/exist.py',
      decision: 'cancel',
      remoteContent: null,
      taken: new Set(),
      stampSourceIso: STAMP_SOURCE,
      nowIso: NOW,
    });
    expect(outcome.files).toEqual(files);
  });

  it('is deterministic for identical inputs', async () => {
    const input = {
      files: [planned('Array/0217-x/solution.py', 'new')],
      path: 'Array/0217-x/solution.py',
      decision: 'save-version' as const,
      remoteContent: 'their code\n',
      taken: new Set<string>(),
      stampSourceIso: STAMP_SOURCE,
      nowIso: NOW,
    };
    const first = await applyConflictDecision(input);
    const second = await applyConflictDecision(input);
    expect(first.preservedPath).toBe(second.preservedPath);
  });
});

describe('unresolvedConflicts', () => {
  it('keeps only paths that are still planned', () => {
    const plan = { files: [planned('a/b.py', 'x')], trackerFiles: [] };
    expect(unresolvedConflicts(plan, ['a/b.py', 'gone/c.py'])).toEqual(['a/b.py']);
  });
});
