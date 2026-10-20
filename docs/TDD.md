# LeetSensei — Technical Design Document

**Status:** Proposed design; implementation has not started.

## Product
LeetSensei is an open-source browser extension that syncs Accepted LeetCode submissions to a user-selected GitHub repository, organizes each problem by official topic tags, and tracks revisions.

- License: MIT
- Target browsers: Chrome, Brave, Firefox and compatible browsers
- No telemetry, analytics, paid APIs or mandatory AI service

## Goals
1. Capture only Accepted submissions.
2. Support languages whose source can be extracted reliably.
3. Create category copies for every applicable official tag.
4. Never silently overwrite existing or manually edited files.
5. Schedule adaptive revisions based on user self-assessment.
6. Store revision data locally and back it up to the connected repository.
7. Keep code modular, tested and browser-portable.

## User flow
1. User installs the extension and opens the dashboard.
2. User connects GitHub with an appropriate public-client authorization flow.
3. User selects an existing repository and branch.
4. User submits a solution on LeetCode.
5. The adapter detects an Accepted result and extracts supported metadata/source.
6. Normalizer validates it and computes a stable source hash.
7. Planner maps official tags to category folders and proposes file changes.
8. Conflict checker compares local manifest and remote file state.
9. A safe change is committed in one logical Git commit where feasible.
10. If files conflict, the user chooses Replace, Save version or Cancel.
11. UI reports actual sync status and schedules a revision.
12. User marks a revision Easy, Hard or Again; next due date changes and backup updates.

## Example user repository
```text
user-solutions-repo/
├── Arrays/
│   └── 0217-contains-duplicate/
│       ├── README.md
│       ├── solution.cpp
│       └── solution.py
├── Hash-Table/
│   └── 0217-contains-duplicate/
│       ├── README.md
│       ├── solution.cpp
│       └── solution.py
└── .leetcode-tracker/
    ├── manifest.json
    └── revisions.json
```
The same canonical submission generates category copies. Categories are directly at repository root. Directory names use zero-padded problem IDs and normalized slugs. A problem README contains the problem link, difficulty, official tags, approach, time complexity and space complexity. Approach and complexity are user-entered using a template; AI is not required.

## Proposed modules
- **Popup/dashboard/options:** quick status, full revision dashboard, repository preferences.
- **Background coordinator:** validates events, deduplicates, coordinates sync and retry lifecycle.
- **LeetCode adapter:** isolates Accepted detection and source extraction; use fixture-based tests because the website may change.
- **Normalizer:** validates metadata and produces one canonical submission.
- **Category/path planner:** deterministic tag mapping and file layout; protect against collisions and unsafe paths.
- **Conflict checker:** detects changed remote content and prompts before replacement.
- **GitHub adapter:** authorization, repository/branch selection, read/write/commit operations.
- **Revision engine:** scheduling, self-assessment and due dates.
- **Storage layer:** versioned local state and validated restore/migration.

## Proposed data model
```ts
type AcceptedSubmission = {
  schemaVersion: 1;
  submissionKey: string;
  problemId: string;
  title: string;
  slug: string;
  problemUrl: string;
  difficulty?: "Easy" | "Medium" | "Hard";
  tags: string[];
  languageId: string;
  fileExtension: string;
  sourceCode: string;
  sourceHash: string;
  acceptedAt: string;
};

type ManagedFile = {
  path: string;
  problemId: string;
  languageId?: string;
  category: string;
  sourceHash: string;
  lastKnownRemoteSha?: string;
};

type RevisionState = {
  problemId: string;
  lastReviewedAt?: string;
  nextReviewAt: string;
  intervalDays: number;
  lastAssessment?: "easy" | "hard" | "again";
  reviewCount: number;
};
```
This model is illustrative; finalize schemas and runtime validation before implementation. Never store LeetCode cookies or credentials in these records.

## Manifest and reliability
The manifest is the source of truth for LeetSensei-managed paths and stores stable IDs, path mappings, hashes, and schema versions.
- Normalize each submission once and derive all category copies from it.
- Compare remote files with recorded hashes and remote SHAs before replacement.
- If a remote file changed since the last sync, stop and surface a conflict.
- If a request times out after a commit may have occurred, inspect GitHub state before retrying.
- Use bounded exponential backoff with jitter for retryable failures.
- Do not retry authorization/validation errors indefinitely.
- Report partial or uncertain sync accurately; do not claim success for all categories if only some changes landed.
- When tags change, add new copies as needed but preserve old copies until user review; never auto-delete them.

## Conflict behavior
For a target that already exists with different content, show a diff and:
- **Replace:** overwrite only after explicit confirmation.
- **Save version:** preserve existing content with a deterministic timestamp/versioned name.
- **Cancel:** do not change the conflicting file.

Manually edited remote files must not be silently overwritten.

## GitHub authorization and commits
Never embed a confidential OAuth client secret, personal access token or private key in the public extension. Choose a supported authorization flow before implementation. If an exchange service is required, constrain it to that exchange and do not send solution or revision activity through it. Only access the repository and branch explicitly selected by the user, with minimum permissions.

Group related writes with Git Trees/Commits API where feasible. Update the selected branch without force-pushing; if the ref update fails, re-read remote state and recover safely.

## Revision scheduling
Initial configurable intervals: 1, 3, 7, 14 and 30 days.
- Easy: move to a longer interval.
- Hard: keep or modestly increase the interval.
- Again: reset to the shortest interval.
Exact multipliers/caps remain to be finalized and tested. User can adjust due dates. Revising does not require resubmitting on LeetCode.

Local browser storage is primary. Back up changes to `.leetcode-tracker/revisions.json`. On restore, validate schema/size and show the user what will be applied. Resolve cases where both local and remote state changed since backup.

## Privacy
- No telemetry, analytics or unrelated page collection.
- Upload only the source/metadata needed for explicit sync to the selected repo.
- Minimal browser permissions, explained to the user.
- No LeetCode password collection.
- Provide disconnect and local-data-clear controls.
- Redact tokens and source content from logs.

## Testing strategy
**Unit tests:** Accepted validation, normalization, hashing, language mapping, path normalization/collisions, manifest migration, conflict detection, version naming, retry idempotency, uncertain write reconciliation and revision calculations.

**Adapter tests:** sanitized fixture-based tests for DOM/response variations; verify assumptions against the current LeetCode UI before each release.

**Integration tests:** token expiry, repository/branch selection, file conflicts, partial commit outcomes, retries, backup restore and disconnect.

**Browser tests:** Chromium and Firefox where practical; mock GitHub responses and use a dedicated test repo, never a user's real repo without explicit configuration.

## Principal risks
1. **Accepted detection/source extraction:** validate early; highest technical risk.
2. **Public extension authorization:** security review before GitHub write implementation.
3. **Partial remote writes:** grouped commits and reconciliation required.
4. **Manual remote edits:** protect via hashes and explicit review.
5. **Browser differences:** isolate APIs and test packaging/signing early.
6. **Tag changes:** preserve historical copies by default.

## Decisions before release
Finalize build framework/manifest, GitHub authorization flow and scopes, reliable LeetCode adapter, per-language filenames, precise interval algorithm, backup conflict UX, data retention, browser versions and store submission requirements.
