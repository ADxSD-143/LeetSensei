# Changelog

All notable changes to this project are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

Pre-release work only: browser smoke testing, screenshots and store packaging. See
[ROADMAP.md](ROADMAP.md).

## [0.1.0] — 2026-10-21

First working implementation. Everything below is covered by the automated suite
(427 tests across 28 files); nothing is published to a browser store yet.

### Added

**Foundation**

- Strict TypeScript project bundled with esbuild into classic `iife` scripts, so one code
  base produces Chrome MV3 (`service_worker`) and Firefox MV3 (`background.scripts`) builds
  from a single manifest builder that validates its own output.
- Vitest, ESLint and Prettier, with a `npm run verify` gate and a CI workflow.
- Dependency-free PNG icon generation. The extension ships **no runtime dependencies**.

**LeetCode adapter**

- Accepted-only detection, enforced twice: the page verdict classifies the outcome, and the
  submission record is re-checked before anything leaves the browser.
- Source code, language, problem id, title, difficulty and official topic tags read from
  LeetCode's own GraphQL API as a same-origin request. No cookie access, no password.
- Unsupported languages and extraction failures are reported explicitly; nothing is guessed
  and nothing is uploaded.
- The three queries used were validated against the live `leetcode.com/graphql` endpoint, and the
  page itself was inspected in a real browser session: the submit control, the absence of a
  verdict node before submitting, and LeetCode's `data-e2e-locator` convention are all
  live-verified. The verdict scan now uses that attribute instead of guessed class names, and a
  candidate node longer than 200 characters is ignored so prose mentioning "Time Limit Exceeded"
  cannot be misread as a verdict.

**Organization**

- Deterministic tag → folder mapping (`Hash Table` → `Hash-Table`), Unicode-safe and
  collision-safe, with Windows reserved-name and path-traversal protection.
- One canonical submission record produces every category copy, plus a per-problem README
  whose approach, complexity and notes survive every sync.
- Versioned manifest with validation and migration, tracked by sha256 and Git blob id.

**GitHub sync**

- OAuth **device flow** (no client secret) plus a fine-grained personal access token fallback.
- One submission → one commit through the Git data API; `force` is never sent.
- Three-way conflict detection with **Replace**, **Save version** (preserving the repository
  copy under a dated name) and **Cancel**. Nothing is overwritten silently.
- Bounded retry with exponential backoff and `retry-after`; rate limits, expired tokens,
  offline conditions and concurrent pushes all handled explicitly.
- Post-write verification: local state advances only after a commit is confirmed on the
  branch. An unconfirmed write is reported as unconfirmed, never as success.
- Idempotent by construction — content-addressed blobs mean a repeated event creates no
  duplicate files.
- Never deletes files; obsolete category copies are kept for review.

**Revision tracker**

- Interval ladder (default 1, 3, 7, 14, 30 days) with **Easy** advancing, **Hard** holding and
  **Again** resetting, plus a manual next-review override.
- Dashboard queue with overdue / due today / upcoming buckets, review history and a due count
  badge.
- Local state as the primary store, mirrored to `.leetcode-tracker/revisions.json` after each
  change, with a restore flow for reinstall or a new device.

**User interface**

- Popup (connection, last sync, per-category status, conflicts, quick actions), dashboard
  (problems, filters, review queue, conflicts, history) and options (account, destination,
  synchronization, revisions, data control, diagnostics, privacy).
- Loading, empty, error, partial-success and conflict states throughout; keyboard accessible;
  destructive actions confirmed. All text is rendered with `textContent` — no HTML injection
  path exists.

### Security

- No telemetry, no analytics, no third-party network destination.
- Minimal permissions (`storage`, `alarms`, LeetCode and GitHub hosts only) with a restrictive
  CSP; the build fails if either regresses.
- Token redaction in logs, no credentials in exports, no credentials in the repository.
- Path validation before any API call; untrusted payloads validated at every boundary.

### Verified in a real browser

- The unpacked build loads in Chromium (Chrome for Testing) with **0 runtime errors, 0 manifest
  errors and 0 install warnings**.
- The popup, dashboard and options pages all render, apply the shared theme (including the dark
  colour scheme) and communicate with the background service worker.
- Screenshots from that session are in [docs/screenshots](docs/screenshots) and the README.

### Known limitations

- Verdict detection depends on LeetCode's page markup for the trigger; everything after that
  uses the API. The page structure and submit control are live-verified, but the verdict
  container that appears _after_ a submission is not — see
  [docs/TESTING.md](docs/TESTING.md#verification-levels).
- A full end-to-end sync (Accepted submission into a real repository) has not been performed:
  it needs a GitHub account and an accepted submission.
- The Firefox bundle builds and passes output verification but has not been loaded in Firefox.
- Populated screenshots are not available yet, because they need synced data.
- Safari and mobile browsers are not supported.
