# Testing

## Running the suite

```bash
npm test              # vitest run — 427 tests in 28 files
npm run test:watch    # watch mode
npm run verify        # format check + lint + typecheck + tests + build
```

The suite never touches the network and never writes to a real repository. Remote behaviour
comes from `tests/fake-github.ts`, an in-memory implementation of the `GithubClient`
interface that reproduces the parts of GitHub that matter:

- blobs are content addressed with real `git blob` SHA-1 ids, so identical content always
  produces identical ids — which is what makes idempotency testable;
- a ref update is only accepted when it fast-forwards, so a branch that moved under us is
  rejected exactly like GitHub's `422`;
- trees are immutable snapshots, and an update can be made to leave the branch pointing at a
  commit that does **not** contain ours, which is how the "unverified write" path is tested.

## What is covered

### Unit tests (24 files)

| File                                                                                                                                                                                                              | Covers                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tags.test.ts`                                                                                                                                                                                                    | `Hash Table` → `Hash-Table`, Unicode, collapsing, reserved Windows names, length bounds, determinism, de-duplication                                                                                                                           |
| `slug.test.ts`                                                                                                                                                                                                    | `0217-contains-duplicate`, padding, diacritics, fallbacks, never-empty                                                                                                                                                                         |
| `paths.test.ts`                                                                                                                                                                                                   | Traversal, absolute paths, illegal characters, reserved names, length limits, and deterministic versioned filenames                                                                                                                            |
| `language.test.ts`                                                                                                                                                                                                | ~40 language mappings, alias canonicalisation (`C++` → `cpp`), unknown languages are refused                                                                                                                                                   |
| `normalize.test.ts`                                                                                                                                                                                               | **The Accepted-only gate** (every non-Accepted status), missing/blank code, missing ids, unsupported languages, missing metadata, CRLF/BOM normalisation, hash stability                                                                       |
| `hash.test.ts`                                                                                                                                                                                                    | Published sha256 and Git blob vectors, UTF-8 byte counting, base64                                                                                                                                                                             |
| `schedule.test.ts`                                                                                                                                                                                                | Ladder normalisation, Easy/Hard/Again transitions, doubling past the ladder, the 365-day cap, date arithmetic, due buckets and local day boundaries                                                                                            |
| `revisions.test.ts`                                                                                                                                                                                               | Schema validation, versionless migration, review application, history cap, manual date override                                                                                                                                                |
| `manifest.test.ts`                                                                                                                                                                                                | Schema validation, unsafe managed paths, mismatched keys, migration, and that upsert **keeps** obsolete category copies                                                                                                                        |
| `readme.test.ts`                                                                                                                                                                                                  | Template contents, editable-section extraction with and without markers, merge preservation, losslessness detection, idempotence                                                                                                               |
| `conflicts.test.ts`                                                                                                                                                                                               | All three-way states, README merge downgrade, machine-owned tracker files                                                                                                                                                                      |
| `resolve.test.ts`                                                                                                                                                                                                 | Cancel / replace / save-version, deterministic versioned names, collision handling, input immutability                                                                                                                                         |
| `plan.test.ts`                                                                                                                                                                                                    | Category copies from one canonical record, determinism, README merge, tracker backups, language accumulation, never planning a deletion                                                                                                        |
| `pipeline.test.ts`                                                                                                                                                                                                | `prepareSync` / `completeSync`, protector behaviour, stale-verdict protection, idempotency                                                                                                                                                     |
| `overview.test.ts`, `settings.test.ts`, `storage.test.ts`, `logger.test.ts`, `errors.test.ts`, `validation.test.ts`, `manifest-build.test.ts`, `leetcode-parse.test.ts`, `leetcode-detect.test.ts`, `dom.test.ts` | Views, settings coercion, storage degradation on corrupt data, redaction, error taxonomy, runtime validators, manifest permissions/CSP, LeetCode payload parsing and verdict classification, DOM creation/mutation helpers and date formatting |

### Integration tests (4 files)

| File                    | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `github-client.test.ts` | Auth header, no-retry on 401/404, `retry-after` honoured, 429/5xx retry, transport failure exhaustion, tree parsing and truncation, blob base64, tree construction, compare-based ancestry, repo list filtering by push permission                                                                                                                                                                                                                                                                                            |
| `github-auth.test.ts`   | Device-flow start, form encoding, GitHub errors, unreadable payloads, `authorization_pending` / `slow_down` / `access_denied` / `expired_token`, expiry bound, cancellation, viewer verification and scope parsing                                                                                                                                                                                                                                                                                                            |
| `github-commit.test.ts` | One commit per submission, one blob per distinct content, no-op when unchanged, idempotent retry, retry after a moved ref, rebasing onto a concurrent push, unverified write reported honestly, missing branch, transient network retry, parent linkage (no history rewrite)                                                                                                                                                                                                                                                  |
| `coordinator.test.ts`   | End-to-end: first sync, backup writes, tracker blob ids, every non-Accepted status, unsupported language, idempotency, multi-language accumulation, obsolete category copies retained, queueing when disconnected / auto-sync off, conflict detection, all three decisions, lossless README merge, transient retry, refusing to advance state on an unverified write, missing branch, revision transitions end to end, manual dates, badge count, restore into a fresh profile, disconnect, clear, export without credentials |

### Build and manifest

`tests/unit/manifest-build.test.ts` asserts the generated manifests are valid, that Chrome
gets a service worker and Firefox gets `background.scripts` plus a Gecko id, that hosts are
exactly LeetCode + GitHub with no `<all_urls>`, and that the CSP contains neither
`unsafe-eval` nor `unsafe-inline`. The build fails if any of that regresses.

## Verification levels

Be precise about what has been proven. This project distinguishes four levels:

| Level                  | Meaning                                                               |
| ---------------------- | --------------------------------------------------------------------- |
| **Unit tested**        | Pure logic, verified against sanitised fixtures                       |
| **Mocked integration** | Exercised against `tests/fake-github.ts`, including failure injection |
| **Live-verified**      | Confirmed against the real external service                           |
| **Manually verified**  | A human loaded the extension in a real browser and used it            |

| Behaviour                                                     | Level                                                                                                                                |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Accepted-only enforcement                                     | Unit tested + mocked integration                                                                                                     |
| Language/tag/path/README/manifest logic                       | Unit tested                                                                                                                          |
| GitHub retry, rate limit, conflict and commit behaviour       | Mocked integration                                                                                                                   |
| LeetCode `questionData` query and response shape              | **Live-verified** (see below)                                                                                                        |
| LeetCode `submissionDetails` and `submissionList` query shape | **Live-verified** (schema accepted; anonymous sessions receive `null`, which the parser handles)                                     |
| Same-origin GraphQL POST from a real browser page             | **Live-verified** (HTTP 200 from the page context)                                                                                   |
| Submit-button identification for the click trigger            | **Live-verified** (the real control is `<button data-e2e-locator="console-submit-button" aria-label="Submit">Submit</button>`)       |
| Absence of a verdict node on a fresh page load                | **Live-verified** (nothing to misread, so opening a solved problem cannot trigger a spurious sync)                                   |
| LeetCode's DOM test-hook convention                           | **Live-verified** (`data-e2e-locator`, values prefixed `console-*`)                                                                  |
| The verdict container's exact locator after a submission      | **Not live-verified** — it only exists after submitting, which needs an account. Mitigated by scanning every `data-e2e-locator` node |
| Extension loading, manifest validity and UI rendering         | **Verified in a real Chromium browser** (see below)                                                                                  |
| End-to-end sync: Accepted submission into a real repository   | **Not yet performed** — needs a GitHub account and an accepted submission; procedure below                                           |
| Firefox runtime behaviour                                     | **Not yet performed** — the Firefox bundle builds and passes output verification, but has not been loaded                            |

### Live verification performed

**API, from a plain HTTPS client** (`https://leetcode.com/graphql`):

```text
questionData       HTTP 200 →
  {"data":{"question":{"questionId":"217","questionFrontendId":"217",
   "title":"Contains Duplicate","titleSlug":"contains-duplicate",
   "difficulty":"Easy","topicTags":[{"name":"Array","slug":"array"},
   {"name":"Hash Table","slug":"hash-table"},{"name":"Sorting","slug":"sorting"}]}}}

submissionList     HTTP 200 → {"data":{"submissionList":{"submissions":null}}}
submissionDetails  HTTP 200 → {"data":{"submissionDetails":null}}   (no GraphQL errors)
problem page       HTTP 403  (bot protection for non-browser clients)
```

**Page structure, from a real browser session** (Chromium via CDP, headed, on
`/problems/contains-duplicate/description/`):

```text
title                     "Contains Duplicate - LeetCode"
meta[name=csrf-token]     absent
data-e2e-locator values   console-submit-button, console-run-button,
                          console-testcase-tag, console-testcase-input
[class*="result"] nodes   none
Submit control            <button data-e2e-locator="console-submit-button"
                            aria-label="Submit">Submit</button>
GraphQL from the page     POST /graphql/ → HTTP 200, question payload as above
submissionList from page  POST /graphql/ → HTTP 200, {"submissions":null}
verdict node on load      none
```

Conclusions drawn, and only these:

1. `questionData` returns exactly the shape `parseQuestionResponse` expects, including
   `topicTags`, so problem metadata extraction is verified against the real service — from both
   a plain client and a browser page.
2. `submissionList` and `submissionDetails` are accepted by the live schema (no GraphQL
   `errors`), so every field name in those queries exists. Anonymous sessions receive `null`,
   which the parsers handle by returning `[]` / `null` rather than throwing.
3. **The same-origin GraphQL POST works from a browser page context**, which is how the content
   script actually issues it. There is no CORS or bot-protection problem for a real request.
4. There is **no `<meta name="csrf-token">`**, so `readCsrfToken` returns null and the header is
   simply omitted — and the request still succeeds. The CSRF plumbing is a safe no-op in
   practice.
5. The submit control is a real `<button>` whose text is exactly `Submit`, so the click
   listener's `closest('button')` + `isSubmitControl` path is confirmed against the live page.
6. LeetCode marks its console UI with `data-e2e-locator`, so scanning that attribute is better
   founded than guessing class names. **It is now the first entry in `RESULT_NODE_SELECTORS`.**
7. On a fresh page load there is **no verdict node**, so merely opening a problem you have
   already solved cannot trigger a sync.
8. Body text on a real problem page _does_ contain verdict-like phrases in prose (the console
   panel is labelled "Test Result", and statements mention time limits). A loose text search
   over the page would therefore produce false verdicts. This is why classification is scoped to
   candidate nodes **and** why a node longer than `MAX_VERDICT_TEXT_LENGTH` (200 characters) is
   ignored — a real verdict is short. Both behaviours are unit tested.

Do not read more into this than it says: the _queries_, the _submit control_ and the _page
structure_ are verified; the verdict container's own locator is not, because it requires a
submission.

### Extension loaded in a real browser

The built `dist/chrome` directory was loaded unpacked into a real Chromium browser (Chrome
for Testing, driven over CDP) and inspected through `chrome.developerPrivate`:

```text
id                heikpkcfelgnnolfmcdkdncahoombiog
name              LeetSensei
version           0.1.0
state             ENABLED
location          UNPACKED
runtime errors    0
manifest errors   0
install warnings  0
```

All three extension pages were then opened and their rendered output and computed styles
inspected:

| Page             | Result                                                                                                                                                                                        |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `popup.html`     | Rendered the connection prompt, an idle sync card, `0 overdue / 0 due today / 0 upcoming` and the quick actions — which means `data/overview` round-tripped to the background worker and back |
| `dashboard.html` | Rendered the status card, the four tabs (`Problems (0)`, `Review queue (0)`, `Conflicts (0)`, `History`), all four filters and the empty state                                                |
| `options.html`   | Rendered all eight sections, 13 buttons and 9 inputs, including the repository, branch, interval and token controls                                                                           |

Computed styles confirm the shared theme actually applied rather than merely loading:

```text
styleSheets        theme.css (62 rules), dashboard.css (6 rules)
body background    rgb(15, 20, 25)   = --ls-bg        (#0f1419)
card background    rgb(22, 28, 36)   = --ls-surface   (#161c24)
card radius        8px               = --ls-radius
badge background   rgb(22, 35, 47)   = --ls-info-bg
selected tab line  rgb(90, 169, 245) = --ls-accent    (#5aa9f5)
```

What this proves: the manifest is valid enough for Chrome to accept it, the background
service worker starts and answers messages, the message protocol works end to end, the
defaults are seeded on first run, the theme and dark-mode branch apply, and every empty state
renders. Screenshots from this run are in [docs/screenshots](screenshots) and the README.

What it does **not** prove: that a real Accepted submission syncs into a real repository, or
that the same pages behave identically in Firefox. Both remain outstanding below.

## Manual browser test procedure (still required)

This is the test that turns "implemented" into "manually verified". It needs a real browser
and a GitHub account, so a maintainer must run it.

1. Build and load the unpacked extension for each browser
   ([INSTALLATION.md](INSTALLATION.md)).
2. **Options:** connect GitHub with a repository-scoped token or the device flow; select a
   repository and branch; verify the connection.
3. **Popup:** confirm it shows the account, the destination and "No submission synced yet".
4. **LeetCode:** open a problem, submit an incorrect solution. Confirm **nothing** is
   uploaded — the popup must not report a success, and the repository must be unchanged.
5. Submit a correct solution and get **Accepted**. Confirm the popup reports a sync, and that
   the repository now contains one folder per topic tag, each with `README.md` and
   `solution.<ext>`, plus `.leetcode-tracker/manifest.json` and `revisions.json`.
6. Solve the same problem in a second language. Confirm a second `solution.*` file appears in
   every category copy and both are listed in the manifest.
7. Edit a solution file on GitHub, then solve that problem again. Confirm LeetSensei stops and
   asks for a decision, and that each of Replace / Save version / Cancel behaves as described
   (Save version leaves a dated copy of your edit).
8. Write an approach into a problem README on GitHub, then solve that problem again. Confirm
   the approach survives the sync.
9. Disconnect the network and submit an Accepted solution. Confirm a clear, retryable error
   and that retrying after reconnecting produces exactly one commit.
10. **Dashboard:** rate problems Easy / Hard / Again and confirm the interval and next-review
    date change as documented; set a manual date.
11. Reinstall the extension (or use a fresh profile) and restore from the repository. Confirm
    the problem list and review schedule come back.
12. Confirm the popup badge shows the due-review count and that keyboard navigation reaches
    every control.

Record the browser and version each time. Anything above that fails is a bug report with a
reproduction, not a documentation update.

## What is not covered

- **No automated browser end-to-end tests.** Playwright with a loaded extension is possible
  (the `.gitignore` already excludes its reports) but it would still need a real LeetCode
  session to be meaningful, and a fake LeetCode would only re-test what the unit tests
  already cover. Adding it is tracked in [ROADMAP.md](../ROADMAP.md); until then, the manual
  procedure above is the honest substitute.
- **No remote integration against a real GitHub repository.** The integration tests use the
  in-memory client. A live test repository would need credentials in CI, which this project
  will not require of contributors.
- **No coverage threshold.** Coverage numbers are not enforced because a line-coverage gate
  would not catch the failures that matter here (a missing conflict branch, an unverified
  write reported as success). The behavioural tests are the gate.
- **Very large repositories.** The truncation path is unit tested; a real 100k-file repository
  has not been exercised.
