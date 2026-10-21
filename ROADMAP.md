# LeetSensei Roadmap

Phases 0–5 are implemented and tested. What remains is browser verification, release
packaging and the things that need maintainer accounts.

Legend: `[x]` done and verified · `[~]` implemented, not yet verified in a real browser ·
`[ ]` not started

## Phase 0 — Specification and repository setup

- [x] Public GitHub repository created
- [x] MIT license selected
- [x] Architecture, security, installation, testing, compatibility and troubleshooting docs

## Phase 1 — Extension foundation

- [x] TypeScript + esbuild build, strict typechecking, ESLint, Prettier, Vitest
- [x] One manifest builder producing valid Chrome and Firefox MV3 manifests
- [x] Popup, dashboard, options page, content script and background worker
- [x] Shared Chrome/Brave/Firefox codebase (`browser ?? chrome`, classic `iife` bundles)
- [x] Dependency-free icon generation
- [x] CI workflow running format, lint, typecheck, tests and build

## Phase 2 — LeetCode adapter (highest technical risk)

- [x] Accepted-only detection, validated twice (page verdict, then the submission record)
- [x] Source code, language, problem id, title, difficulty and official tags via LeetCode's GraphQL API
- [x] Sanitised fixtures and adapter tests for every parsing path
- [x] Clear reported errors for unsupported languages and extraction failures
- [x] GraphQL queries validated against the live endpoint, from a plain client and from a real browser page
- [x] Submit-button identification and the absence of a pre-submission verdict node verified against the live page
- [x] LeetCode's own `data-e2e-locator` hook scanned first, instead of relying on guessed class names
- [~] The verdict container that appears _after_ a submission — still unverified, because it needs an account; see the manual procedure in [docs/TESTING.md](docs/TESTING.md#manual-browser-test-procedure-not-yet-performed)

## Phase 3 — Solution organization

- [x] Canonical submission record with deterministic sha256 and Git blob hashes
- [x] Official tags mapped to stable, collision-safe, Unicode-safe folder names
- [x] Per-problem README with preserved approach / complexity / notes sections
- [x] Every applicable category represented; copies generated from one canonical record
- [x] Manifest of managed files with schema versioning and migration
- [x] Path traversal, reserved name and length validation

## Phase 4 — GitHub sync

- [x] Device-flow authorization (no client secret) plus a fine-grained token fallback
- [x] Repository and branch selection, validated before saving
- [x] Conflict detection: Replace / Save version / Cancel, with a dated preserved copy
- [x] One submission → one commit via the Git data API
- [x] Idempotent retries with bounded backoff and rate-limit awareness
- [x] Post-write verification; local state advances only after a confirmed commit
- [x] Never force-pushes, never deletes, never overwrites silently

## Phase 5 — Revision tracker

- [x] Dashboard review queue with overdue / due today / upcoming buckets
- [x] Configurable ladder, default 1, 3, 7, 14, 30 days
- [x] Easy advances, Hard holds, Again resets — documented and tested, including date boundaries
- [x] Local primary storage with per-change backup to `.leetcode-tracker/revisions.json`
- [x] Restore with validation and an explicit local-versus-remote merge rule
- [x] Manual next-review override
- [x] History view and due-count badge

## Phase 6 — Cross-browser QA and release

- [x] Unit and integration tests (403 tests, no network, no real repository)
- [x] Offline, retry, duplicate event, conflict, partial write and unverified write cases
- [x] Permissions and privacy review recorded in [docs/SECURITY.md](docs/SECURITY.md)
- [x] Browser-specific installation and compatibility documentation
- [ ] **Manual browser smoke test in Chrome and Firefox** — the next concrete task
- [ ] Automated browser end-to-end harness (Playwright with a loaded extension)
- [ ] Screenshots in the README
- [ ] Publish packages: Chrome Web Store, Firefox Add-ons
- [ ] Publish release notes for the first public build

## Next up

1. **Manual smoke test.** Follow
   [docs/TESTING.md](docs/TESTING.md#manual-browser-test-procedure-not-yet-performed) in Chrome
   and Firefox. This is the only way the verdict-detection step becomes verified, and it needs
   a real browser and a GitHub account.
2. Fix anything it surfaces, adding a regression test for each bug.
3. Capture screenshots and finish the README section.
4. Add a Playwright harness for the extension pages (popup, dashboard, options) with a mocked
   background, which needs no LeetCode session.
5. Register the OAuth App, bake in the client id, and prepare store listings.

## Deliberately out of scope

- AI-generated explanations and approaches (the README is yours to fill in)
- Automatic LeetCode resubmission
- Hosted accounts, a server, a database or any required paid service
- Telemetry, analytics or usage tracking
- Deleting or pruning files in your repository
- Force-pushing or rewriting branch history
- Safari and mobile browsers

## MVP acceptance criteria

| #   | Criterion                                                                | Status                                                    |
| --- | ------------------------------------------------------------------------ | --------------------------------------------------------- |
| 1   | Only Accepted submissions are eligible for sync                          | ✅ Enforced in one validator, tested for every status     |
| 2   | Retrying the same submission does not duplicate managed files            | ✅ Content-addressed blobs; covered end to end            |
| 3   | All applicable official tag categories are represented                   | ✅ One commit, every category, tested                     |
| 4   | Existing or manually edited remote files are never silently overwritten  | ✅ Three-way classification; conflicts require a decision |
| 5   | Sync errors are visible and retryable                                    | ✅ Coded errors surfaced in the popup and dashboard       |
| 6   | Revision state can be restored from the repository backup                | ✅ Restore flow tested against the in-memory GitHub       |
| 7   | No telemetry or analytics is sent                                        | ✅ No third-party destination exists in the code          |
| 8   | Tests cover normalization, conflict handling, retries and revision logic | ✅ 403 tests, 27 files                                    |
