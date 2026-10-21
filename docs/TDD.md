# LeetSensei — Technical Design Document

**Status:** implemented. This document records the locked design decisions. Where the
implementation had to choose a concrete answer, the choice is recorded under
[Resolved decisions](#resolved-decisions) and the code is the source of truth. See
[ARCHITECTURE.md](ARCHITECTURE.md) for how the modules actually fit together.

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
  difficulty?: 'Easy' | 'Medium' | 'Hard';
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
  lastAssessment?: 'easy' | 'hard' | 'again';
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

## Resolved decisions

Every item that was previously open. Each is implemented and covered by tests.

| Open question                         | Decision                                                                                                                                                                                    | Where                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Build framework and manifest strategy | TypeScript + esbuild, classic `iife` bundles, one shared manifest builder emitting Chrome (`service_worker`) and Firefox (`background.scripts`) MV3 manifests                               | `scripts/build.mjs`, `src/manifest/build-manifest.ts`   |
| GitHub authorization flow             | OAuth **device flow** (public `client_id`, no client secret, no exchange service), with a fine-grained personal access token as a user-supplied fallback                                    | `src/github/auth.ts`                                    |
| GitHub scopes                         | `public_repo` by default; `repo` only when the user explicitly selects a private destination                                                                                                | `src/storage/settings.ts`, options page                 |
| LeetCode extraction mechanism         | Verdict read from the live DOM as the _trigger_; code, language, difficulty, id and tags read from LeetCode's GraphQL API as a same-origin request. Accepted is asserted twice              | `src/adapters/leetcode/*`                               |
| Per-language file names               | `solution.<ext>`, one file per language extension; languages accumulate across submissions, and two languages sharing an extension resolve through the canonical id                         | `src/core/language.ts`, `src/core/plan.ts`              |
| Revision interval algorithm           | Ladder of days (default 1, 3, 7, 14, 30): **Again** resets to the shortest, **Hard** keeps, **Easy** advances one step and doubles past the end, capped at 365 days                         | `src/core/schedule.ts`                                  |
| Version file naming                   | UTC `YYYYMMDD-HHMMSS` stamp from the submission time, inserted before the extension (`solution.20240305-060708.py`), with a deterministic `-2`, `-3` suffix on collision                    | `src/core/paths.ts`                                     |
| Conflict data for decisions           | Repository content is fetched lazily, only when "Save version" is chosen, so a decision needs no extra download                                                                             | `src/core/resolve.ts`                                   |
| Restore conflicts (local vs remote)   | Per problem: the record with the later `lastReviewedAt` wins for revisions; the later `updatedAt` wins for manifest entries. Local wins ties                                                | `SyncCoordinator.restoreFromRemote`                     |
| Manifest and revision schemas         | `schemaVersion` 1, strict validation, versionless data migrated on load, newer versions refused, corrupt data degraded to empty with a warning                                              | `src/core/manifest.ts`, `src/core/revisions.ts`         |
| Tracker file ownership                | `.leetcode-tracker/*` is machine state, so a difference never blocks a sync; every other path uses the full conflict flow                                                                   | `src/core/conflicts.ts` (`owned`)                       |
| Retry policy                          | Retry only `network_error`, `rate_limited` and `remote_changed`; exponential backoff capped at 30s; `retry-after` honoured; authorization, validation and not-found errors fail immediately | `src/github/client.ts`, `src/github/commit.ts`          |
| Unverified writes                     | A commit that cannot be confirmed on the branch is reported as `verified: false`; local state is not advanced, and a retry converges because the operation is idempotent                    | `src/github/commit.ts`, `src/background/coordinator.ts` |
| Untagged submissions                  | Filed under a configurable fallback category (default `Uncategorized`), flagged `metadataIncomplete`, and stated in the README — no tags are invented                                       | `src/core/normalize.ts`                                 |
| Missing problem id                    | The folder is named from the title slug alone and the record is flagged incomplete, rather than inventing a number                                                                          | `src/core/slug.ts`                                      |
| Supported language list               | An explicit ~40-entry table; an unknown language is refused with a named error, never guessed                                                                                               | `src/core/language.ts`                                  |
| Browser versions                      | Chrome/Brave 111+, Firefox 115+                                                                                                                                                             | `src/manifest/build-manifest.ts`                        |
| Store submission                      | Not started. Requires maintainer accounts, signing and review; requirements are recorded in [BROWSER_COMPATIBILITY.md](BROWSER_COMPATIBILITY.md)                                            | —                                                       |

## Still open

1. **Verdict-detection resilience.** The DOM trigger is unit tested but not live-verified, and
   a LeetCode markup change would need a predicate update. The manual smoke test in
   [TESTING.md](TESTING.md#manual-browser-test-procedure-still-required) is the next step.
2. **Automated browser end-to-end tests.** Deferred with reasoning in
   [TESTING.md](TESTING.md#what-is-not-covered).
3. **Multi-device revision merging.** Restore currently resolves per problem by recency; a
   proper merge (union of history) would need a vector or timestamp-based rule.
