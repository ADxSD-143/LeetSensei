# Architecture Overview

**Status: implemented.** This document describes the code that exists in `src/`, not a
plan. See [docs/TDD.md](TDD.md) for the locked product decisions.

## Data flow

```text
LeetCode problem page (content script, isolated world)
  │  1. a Submit control is clicked, or a verdict node appears
  │  2. submissionList  -> newest unprocessed submission id
  │  3. submissionDetails -> source code, language, status, timestamp
  │  4. question -> id, title, difficulty, official topic tags
  ▼
background/coordinator            (the only writer of state)
  ▼
core/normalize                    Accepted-only gate + canonical record + hashes
  ▼
core/plan  (phase 1)              tags → category folders, README, solution files
  ▼
core/conflicts                    planned vs manifest vs remote, per path
  ▼  ┌─────────────── user decision required? ───────────────┐
  │  │ yes: store PendingJob, report "awaiting-decision"     │
  │  │ no : continue                                         │
  ▼  └───────────────────────────────────────────────────────-┘
core/resolve                      replace / save-version / cancel
  ▼
core/plan  (phase 2)              render manifest.json + revisions.json backups
  ▼
github/commit                     blobs → tree → commit → ref update → verify
  ▼
storage/*                         local manifest + revisions advanced only on success
  ▼
popup / dashboard / options       read-only views over local state
```

## Module boundaries

| Module                                 | Owns                                                                           | Must never                                           |
| -------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------- |
| `adapters/leetcode`                    | Everything LeetCode-specific: page detection, GraphQL queries, payload parsing | Know about GitHub, storage or file layout            |
| `core/normalize`                       | The Accepted-only gate, language mapping, hashing, canonical records           | Perform network writes                               |
| `core/tags`, `core/slug`, `core/paths` | Deterministic tag → folder naming and path safety                              | Depend on the network or the DOM                     |
| `core/readme`                          | The problem README template and merge of user-authored sections                | Invent an approach or complexity                     |
| `core/manifest`, `core/revisions`      | Versioned schemas, validation, migration                                       | Trust stored data without validating                 |
| `core/plan`                            | Deterministic file plans, category copies, tracker backups                     | Delete anything, or read the network                 |
| `core/conflicts`                       | Three-way classification of every planned path                                 | Write or fetch                                       |
| `core/resolve`                         | The three conflict decisions and versioned preservation                        | Overwrite without an explicit decision               |
| `github/auth`                          | Device flow and token verification                                             | Store or log a token                                 |
| `github/client`                        | REST access, timeouts, retry/backoff, error mapping                            | Contain business logic                               |
| `github/commit`                        | Grouping changes into one commit and verifying the result                      | Force-push, or report an unverified write as success |
| `background/coordinator`               | All state mutation; serialises every operation                                 | Be bypassed by the UI                                |
| `popup`, `dashboard`, `options`        | Rendering and user intent                                                      | Touch storage or the network directly                |

The UI only ever talks to the background over the typed message protocol in
`src/shared/messages.ts`. That keeps the trust boundary in one place.

## Key design decisions

### Why the GraphQL API instead of scraping the page

The verdict that tells us a submission was Accepted appears in the DOM, and it is the only
signal we can observe. Everything else — code, language, difficulty, topic tags — is read
from LeetCode's own GraphQL API, issued from the content script as a same-origin request.
Consequences:

- A renamed CSS class can only break the _trigger_, never the extracted data.
- A submission is re-validated against the API before anything leaves the browser, so a
  stale "Accepted" node cannot upload an outdated or rejected submission.
- The DOM layer is one small, defensive predicate (`pickResultVerdict`) with unit tests;
  the API layer is fixture-tested and live-verified.

The trigger scans LeetCode's own `data-e2e-locator` test hooks first — verified in a real
browser session, where the console UI is marked `console-submit-button`, `console-run-button`
and so on — rather than relying on guessed class names. Two further guards keep it honest:

- a candidate node longer than `MAX_VERDICT_TEXT_LENGTH` (200 characters) is ignored, because
  real problem statements mention "Time Limit Exceeded" and "Runtime Error" in prose;
- a verdict is only a _trigger_. The submission id must come from `submissionList`, the newest
  entry must be unprocessed, and both `submissionList` and `submissionDetails` must report
  `Accepted` before anything is uploaded.

### Why two planning phases

The manifest is a description of the files LeetSensei manages, and it is written into the
repository as a backup. A conflict decision can _add_ a file (a preserved version) or
_remove_ one (cancel), which changes what the manifest must say. Planning therefore runs in
two steps: `planContentFiles` produces the candidate files, conflicts are resolved, and only
then does `finalizePlan` render the manifest and revision backups. Without this split, a
cancelled file would still be recorded as managed.

### Why authorization needs no secret

A public extension cannot ship a client secret. The GitHub **device flow** needs only a
public `client_id`: the user approves the request in their own browser session and the
extension polls for the token. There is no exchange service to trust, and nothing
confidential is in the bundle.

The trade-off is that the client id belongs to the extension publisher, so a locally built
copy without one falls back to a user-supplied fine-grained personal access token. Both
paths store the token in the extension's own isolated storage.

### Why "verified" is a first-class result

GitHub can accept a ref update and still leave the branch pointing somewhere else if
another actor pushed at the same moment. `commitFiles` therefore re-reads the branch after
updating it and, when the commit is not reachable, retries the whole operation against the
new tip (bounded). If it still cannot confirm, it returns `verified: false` and
`background/coordinator` refuses to advance the local manifest. Nothing is ever recorded as
synced unless the remote state agrees.

### Why blob ids rather than file downloads

Every managed file records both its sha256 (LeetSensei's own integrity hash) and its Git
blob id. Because Git blob ids are content addresses, the planner can compare planned content
against a remote file by id, needing neither a download nor a separate write. Only READMEs
are fetched, and only because their user-authored sections must be merged.

### Why the tracker directory is machine-owned

`.leetcode-tracker/manifest.json` and `revisions.json` are LeetSensei's own state, not user
content, so a difference there never blocks a sync (see `ClassifyInput.owned`). Every other
path is protected by the full conflict flow.

## Reliability model

- **One submission, one commit.** A submission's README and solution files, across every
  category, ship as a single commit built from the Git data API.
- **Content addressing makes retries free.** Re-running a sync produces identical blob ids,
  hence an identical tree; a tree that already matches results in no commit at all.
- **Fast-forward only.** `force` is never sent, and the commit's parent is the tip that was
  read, so a concurrent push is rejected by GitHub and retried on a fresh base.
- **Bounded retries.** Only retryable codes (`network_error`, `rate_limited`,
  `remote_changed`) are retried, with exponential backoff capped at 30s and `retry-after`
  honoured. Authorization, validation and not-found errors fail immediately.
- **Serialised operations.** `SyncCoordinator` funnels every operation through a promise
  chain, so two submissions can never interleave into a half-written commit.
- **State advances last.** The local manifest and revision store are updated only after a
  verified write.

## Revision scheduling

The ladder is a configurable ascending list of day counts, default `1, 3, 7, 14, 30`.

| Rating  | Effect                                                               | Rationale                                                                                 |
| ------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `again` | Reset to the shortest interval, `successfulReviews` back to 0        | You did not remember it, so start over                                                    |
| `hard`  | Keep the current interval                                            | You remembered it, but with difficulty; repeating the same gap is the conservative choice |
| `easy`  | Advance one ladder step; past the ladder, double, capped at 365 days | It was effortless, so demand less often                                                   |

`again` and `hard` increment nothing on `again`; `hard` and `easy` increment
`successfulReviews`. The queue buckets by _local_ day boundaries: `overdue` (before today),
`due-today`, `upcoming`. Unparsable dates are treated as due today so broken data is visible
rather than silently skipped.

The state lives locally as the primary copy and is mirrored to
`.leetcode-tracker/revisions.json` after every change, so a reinstall can restore it.

## Cross-browser build

| Concern         | Chrome / Brave                             | Firefox                              |
| --------------- | ------------------------------------------ | ------------------------------------ |
| Background      | `background.service_worker`                | `background.scripts`                 |
| Output format   | classic `iife` bundle (no ES modules)      | same                                 |
| Minimum version | `minimum_chrome_version: 111`              | `strict_min_version: 115.0`          |
| Add-on id       | n/a                                        | `browser_specific_settings.gecko.id` |
| API access      | `browser ?? chrome` with awaited MV3 calls | same                                 |

Both manifests are produced by one function, `src/manifest/build-manifest.ts`, which is also
unit-tested (permissions, CSP, background shape, no `<all_urls>`).

## Testing strategy

- Everything under `core/` is pure and unit tested.
- `tests/fake-github.ts` implements the `GithubClient` interface in memory, reproducing
  content-addressed blobs, fast-forward-only refs and concurrent pushes. The GitHub layers
  are integration tested against it — never against a real repository.
- LeetCode payload parsing is tested against sanitised fixtures; the queries themselves were
  validated against the live endpoint (see [TESTING.md](TESTING.md)).

## Known constraints

- Verdict detection needs a real page; it is not covered by an automated browser test.
- `getRemoteTree` uses GitHub's recursive tree endpoint, which truncates very large
  repositories. Truncation is reported and makes conflict detection conservative (unknown
  paths are treated as existing).
- The device flow needs a client id baked in at build time.
