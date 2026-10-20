import { describe, expect, it } from 'vitest';
import {
  MANIFEST_SCHEMA_VERSION,
  allManagedPaths,
  createEmptyManifest,
  findManagedFile,
  migrateManifest,
  upsertProblem,
  validateManifest,
} from '../../src/core/manifest';
import { NOW, makeFile, makeManifest, makeProblem } from '../helpers';

describe('createEmptyManifest', () => {
  it('starts at the current schema version', () => {
    expect(createEmptyManifest(NOW)).toEqual({
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      generatedAt: NOW,
      problems: {},
    });
  });
});

describe('validateManifest', () => {
  it('accepts a well formed manifest', () => {
    const result = validateManifest(makeManifest([makeProblem()]));
    expect(result.ok).toBe(true);
  });

  it('accepts the empty manifest', () => {
    expect(validateManifest(createEmptyManifest(NOW)).ok).toBe(true);
  });

  it('rejects non objects and missing versions', () => {
    expect(validateManifest(null).ok).toBe(false);
    expect(validateManifest([]).ok).toBe(false);
    expect(validateManifest({ problems: {} }).ok).toBe(false);
  });

  it('rejects a manifest written by a newer schema', () => {
    const result = validateManifest({
      ...createEmptyManifest(NOW),
      schemaVersion: MANIFEST_SCHEMA_VERSION + 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/newer LeetSensei/);
  });

  it('rejects unsafe managed paths', () => {
    const problem = makeProblem({ files: [makeFile('../../escape/solution.py')] });
    const result = validateManifest(makeManifest([problem]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/unsafe or missing path/);
  });

  it('rejects a record whose key does not match its problemId', () => {
    const result = validateManifest({
      schemaVersion: 1,
      generatedAt: NOW,
      problems: { '0217': makeProblem({ problemId: '0218' }) },
    });
    expect(result.ok).toBe(false);
  });

  it('rejects malformed files', () => {
    const problem = makeProblem({
      files: [
        {
          path: 'a/b.py',
          category: null,
          kind: 'source',
          language: null,
          hash: 'h',
          blobSha: 'b',
          version: 1,
        } as never,
      ],
    });
    expect(validateManifest(makeManifest([problem])).ok).toBe(false);
  });

  it('rejects a bad timestamp', () => {
    const problem = makeProblem({ updatedAt: 'yesterday' });
    expect(validateManifest(makeManifest([problem])).ok).toBe(false);
  });
});

describe('migrateManifest', () => {
  it('upgrades a versionless manifest and reports the migration', () => {
    const legacy = {
      generatedAt: NOW,
      problems: { '0217': makeProblem() },
    };
    const outcome = migrateManifest(legacy, NOW);
    expect(outcome.ok).toBe(true);
    expect(outcome.migratedFrom).toBe(0);
    expect(outcome.warnings.length).toBe(1);
    expect(outcome.manifest?.schemaVersion).toBe(MANIFEST_SCHEMA_VERSION);
  });

  it('leaves a current manifest untouched', () => {
    const outcome = migrateManifest(makeManifest([makeProblem()]), NOW);
    expect(outcome.ok).toBe(true);
    expect(outcome.migratedFrom).toBeNull();
  });

  it('refuses unrecognised data', () => {
    expect(migrateManifest({ hello: 'world' }, NOW).ok).toBe(false);
    expect(migrateManifest('nope', NOW).ok).toBe(false);
  });
});

describe('upsertProblem', () => {
  it('adds a new problem', () => {
    const manifest = upsertProblem(createEmptyManifest(NOW), makeProblem());
    expect(Object.keys(manifest.problems)).toEqual(['0217']);
  });

  it('keeps files it already manages, including obsolete category copies', () => {
    const existing = makeProblem();
    const obsolete = makeFile('Old-Tag/0217-contains-duplicate/solution.py', {
      category: 'Old-Tag',
    });
    const manifest = makeManifest([{ ...existing, files: [...existing.files, obsolete] }]);

    const updated = upsertProblem(
      manifest,
      makeProblem({
        categories: ['Array'],
        files: [makeFile('Array/0217-contains-duplicate/solution.py', { blobSha: 'new-blob' })],
      }),
    );

    const problem = updated.problems['0217'];
    expect(problem).toBeDefined();
    const paths = problem?.files.map((file) => file.path) ?? [];
    expect(paths).toContain('Old-Tag/0217-contains-duplicate/solution.py');
    expect(paths).toContain('Hash-Table/0217-contains-duplicate/README.md');
    expect(
      problem?.files.find((file) => file.path.endsWith('Array/0217-contains-duplicate/solution.py'))
        ?.blobSha,
    ).toBe('new-blob');
  });

  it('returns a new object and never mutates the input', () => {
    const original = makeManifest([]);
    const updated = upsertProblem(original, makeProblem());
    expect(original.problems).toEqual({});
    expect(updated).not.toBe(original);
  });
});

describe('lookups', () => {
  it('finds a managed file and its problem', () => {
    const manifest = makeManifest([makeProblem()]);
    const found = findManagedFile(manifest, 'Array/0217-contains-duplicate/solution.py');
    expect(found?.problem.problemId).toBe('0217');
    expect(findManagedFile(manifest, 'Array/9999-nope/solution.py')).toBeNull();
  });

  it('lists every managed path', () => {
    const paths = allManagedPaths(makeManifest([makeProblem()]));
    expect(paths.size).toBe(4);
    expect(paths.has('Hash-Table/0217-contains-duplicate/README.md')).toBe(true);
  });
});
