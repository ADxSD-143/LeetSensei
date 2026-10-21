// Dev-only: prints a storage payload for store screenshots.
//
// The payload is validated with the project's own manifest and revision
// validators before printing, so seeding it into chrome.storage.local can never
// hit the "corrupt data" path and produce a misleading screenshot.
//
// The account, repository and problems are fictional and clearly labelled as
// example data in the store listing.
//
//   node scripts/demo-data.mjs            # JSON on stdout
//   node scripts/demo-data.mjs --out=x.json
import { writeFileSync } from 'node:fs';
import { validateManifest } from '../src/core/manifest.ts';
import { validateRevisionStore } from '../src/core/revisions.ts';
import { normalizeSettings } from '../src/storage/settings.ts';

const NOW = new Date();
const iso = (offsetDays = 0, hour = 9) => {
  const date = new Date(NOW);
  date.setDate(date.getDate() + offsetDays);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
};
const GENERATED = NOW.toISOString();
const ACCOUNT = 'example-student';
const REPO = 'leetcode-solutions';

const hash = (seed) => seed.padEnd(64, '0');
const blob = (seed) => seed.padEnd(40, '0');

/** @type {{id: string, slug: string, title: string, tags: string[], categories: string[], difficulty: string, language: string, extension: string}[]} */
const PROBLEMS = [
  {
    id: '0217',
    slug: '0217-contains-duplicate',
    title: 'Contains Duplicate',
    tags: ['Array', 'Hash Table'],
    categories: ['Array', 'Hash-Table'],
    difficulty: 'Easy',
    language: 'python3',
    extension: 'py',
  },
  {
    id: '0001',
    slug: '0001-two-sum',
    title: 'Two Sum',
    tags: ['Array', 'Hash Table'],
    categories: ['Array', 'Hash-Table'],
    difficulty: 'Easy',
    language: 'cpp',
    extension: 'cpp',
  },
  {
    id: '0042',
    slug: '0042-trapping-rain-water',
    title: 'Trapping Rain Water',
    tags: ['Two Pointers', 'Dynamic Programming', 'Stack'],
    categories: ['Dynamic-Programming', 'Stack', 'Two-Pointers'],
    difficulty: 'Hard',
    language: 'python3',
    extension: 'py',
  },
  {
    id: '0206',
    slug: '0206-reverse-linked-list',
    title: 'Reverse Linked List',
    tags: ['Linked List', 'Recursion'],
    categories: ['Linked-List', 'Recursion'],
    difficulty: 'Easy',
    language: 'java',
    extension: 'java',
  },
  {
    id: '0704',
    slug: '0704-binary-search',
    title: 'Binary Search',
    tags: ['Array', 'Binary Search'],
    categories: ['Array', 'Binary-Search'],
    difficulty: 'Easy',
    language: 'python3',
    extension: 'py',
  },
];

const problems = {};
for (const [index, problem] of PROBLEMS.entries()) {
  const files = [];
  for (const category of problem.categories) {
    const directory = `${category}/${problem.slug}`;
    for (const [suffix, kind] of [
      ['README.md', 'readme'],
      [`solution.${problem.extension}`, 'solution'],
    ]) {
      const path = `${directory}/${suffix}`;
      files.push({
        path,
        category,
        kind,
        language: kind === 'solution' ? problem.language : null,
        hash: hash(`${problem.id}-${category}-${suffix}`),
        blobSha: blob(`${problem.id}-${category}-${suffix}`),
        version: 1,
      });
    }
  }
  files.sort((left, right) => (left.path < right.path ? -1 : 1));

  problems[problem.id] = {
    problemId: problem.id,
    slug: problem.slug,
    title: problem.title,
    titleSlug: problem.slug.replace(/^\d+-/, ''),
    url: `https://leetcode.com/problems/${problem.slug.replace(/^\d+-/, '')}/`,
    difficulty: problem.difficulty,
    officialTags: problem.tags,
    categories: problem.categories,
    metadataIncomplete: false,
    languages: [problem.language],
    files,
    lastSyncedSubmissionId: String(100000000 + index),
    updatedAt: iso(-(index + 1), 18),
  };
}

const manifest = { schemaVersion: 1, generatedAt: GENERATED, problems };

const review = (problemId, offsetDays, intervalDays, history = []) => ({
  problemId,
  slug: problems[problemId].slug,
  title: problems[problemId].title,
  lastReviewedAt: history.length > 0 ? history[history.length - 1].at : null,
  nextReviewAt: iso(offsetDays),
  currentIntervalDays: intervalDays,
  successfulReviews: history.filter((event) => event.rating !== 'again').length,
  history,
});

const revisions = {
  schemaVersion: 1,
  generatedAt: GENERATED,
  problems: {
    '0217': review('0217', -3, 7, [
      { at: iso(-10, 20), rating: 'easy', intervalBeforeDays: 1, intervalAfterDays: 3 },
      { at: iso(-6, 20), rating: 'hard', intervalBeforeDays: 3, intervalAfterDays: 7 },
      { at: iso(-4, 20), rating: 'again', intervalBeforeDays: 7, intervalAfterDays: 1 },
    ]),
    '0001': review('0001', 0, 3, [
      { at: iso(-4, 21), rating: 'hard', intervalBeforeDays: 1, intervalAfterDays: 3 },
    ]),
    '0042': review('0042', 5, 14, [
      { at: iso(-9, 21), rating: 'easy', intervalBeforeDays: 7, intervalAfterDays: 14 },
    ]),
    '0206': review('0206', 12, 30, [
      { at: iso(-18, 21), rating: 'easy', intervalBeforeDays: 14, intervalAfterDays: 30 },
    ]),
    '0704': review('0704', 1, 1),
  },
};

const settings = normalizeSettings({
  repoOwner: ACCOUNT,
  repoName: REPO,
  branch: 'main',
  autoSync: true,
  detectSubmissions: true,
  fallbackCategory: 'Uncategorized',
  revisionIntervals: [1, 3, 7, 14, 30],
  authScope: 'public_repo',
  theme: 'auto',
});

const auth = {
  // Obvious placeholder; never a real credential, and never displayed.
  token: 'demo-placeholder-not-a-credential',
  login: ACCOUNT,
  scopes: ['public_repo'],
  method: 'device',
  savedAt: iso(-20, 12),
};

const sync = {
  trackerShas: {},
  lastSyncedAt: iso(0, 18),
  status: {
    phase: 'done',
    submissionId: '100000004',
    problemTitle: 'Binary Search',
    problemSlug: '0704-binary-search',
    categories: ['Array', 'Binary-Search'],
    message: 'Synced 4 files across 2 categories.',
    errorCode: null,
    updatedAt: iso(0, 18),
    perCategory: [
      { category: 'Array', ok: true, error: null },
      { category: 'Binary-Search', ok: true, error: null },
    ],
  },
  remoteHeadSha: null,
  remoteTreeSha: null,
  queued: [],
  lastSubmission: null,
};

const manifestCheck = validateManifest(manifest);
if (!manifestCheck.ok) {
  console.error('demo manifest is invalid:', manifestCheck.errors);
  process.exit(1);
}
const revisionCheck = validateRevisionStore(revisions);
if (!revisionCheck.ok) {
  console.error('demo revisions are invalid:', revisionCheck.errors);
  process.exit(1);
}

const payload = {
  'leetsensei:settings': settings,
  'leetsensei:manifest': manifest,
  'leetsensei:revisions': revisions,
  'leetsensei:auth': auth,
  'leetsensei:sync': sync,
};

const json = `${JSON.stringify(payload, null, 2)}\n`;
const out = process.argv.slice(2).find((arg) => arg.startsWith('--out='));
if (out) {
  writeFileSync(out.slice('--out='.length), json);
  console.error(`wrote ${out.slice('--out='.length)}`);
} else {
  process.stdout.write(json);
}
