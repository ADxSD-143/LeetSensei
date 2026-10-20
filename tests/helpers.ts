import type { Manifest, ManifestFile, ManifestProblem } from '../src/core/manifest';
import { MANIFEST_SCHEMA_VERSION } from '../src/core/manifest';
import type { NormalizedSubmission, RawSubmission } from '../src/core/model';
import { normalizeSubmission } from '../src/core/normalize';

export const NOW = '2024-03-05T06:07:08.000Z';

export function makeRaw(overrides: Partial<RawSubmission> = {}): RawSubmission {
  return {
    submissionId: '123456789',
    status: 'Accepted',
    language: 'python3',
    code:
      'class Solution:\n' +
      '    def containsDuplicate(self, nums: list[int]) -> bool:\n' +
      '        return len(nums) != len(set(nums))\n',
    problemId: '217',
    problemTitle: 'Contains Duplicate',
    titleSlug: 'contains-duplicate',
    difficulty: 'Easy',
    tags: ['Array', 'Hash Table'],
    submittedAt: '2024-03-05T06:07:08.000Z',
    url: 'https://leetcode.com/problems/contains-duplicate/',
    ...overrides,
  };
}

export async function makeSubmission(
  overrides: Partial<RawSubmission> = {},
): Promise<NormalizedSubmission> {
  return normalizeSubmission(makeRaw(overrides));
}

export function makeFile(path: string, overrides: Partial<ManifestFile> = {}): ManifestFile {
  const segments = path.split('/');
  return {
    path,
    category: segments.length > 2 ? (segments[0] ?? null) : null,
    kind: path.endsWith('README.md') ? 'readme' : 'solution',
    language: path.endsWith('README.md') ? null : 'python3',
    hash: `hash:${path}`,
    blobSha: `blob:${path}`,
    version: 1,
    ...overrides,
  };
}

export function makeProblem(overrides: Partial<ManifestProblem> = {}): ManifestProblem {
  const base: ManifestProblem = {
    problemId: '0217',
    slug: '0217-contains-duplicate',
    title: 'Contains Duplicate',
    titleSlug: 'contains-duplicate',
    url: 'https://leetcode.com/problems/contains-duplicate/',
    difficulty: 'Easy',
    officialTags: ['Array', 'Hash Table'],
    categories: ['Array', 'Hash-Table'],
    metadataIncomplete: false,
    languages: ['python3'],
    files: [
      makeFile('Array/0217-contains-duplicate/README.md'),
      makeFile('Array/0217-contains-duplicate/solution.py'),
      makeFile('Hash-Table/0217-contains-duplicate/README.md'),
      makeFile('Hash-Table/0217-contains-duplicate/solution.py'),
    ],
    lastSyncedSubmissionId: '123456789',
    updatedAt: NOW,
  };
  return { ...base, ...overrides };
}

export function makeManifest(problems: ManifestProblem[] = []): Manifest {
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    generatedAt: NOW,
    problems: Object.fromEntries(problems.map((problem) => [problem.problemId, problem])),
  };
}
