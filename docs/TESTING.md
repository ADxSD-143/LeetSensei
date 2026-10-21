# Testing

## Running the suite

```bash
npm test              # vitest run — 403 tests in 27 files
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

### Unit tests (15 files)

| File                                                                                                                                                                                               | Covers                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tags.test.ts`                                                                                                                                                                                     | `Hash Table` → `Hash-Table`, Unicode, collapsing, reserved Windows names, length bounds, determinism, de-duplication                                                                        |
| `slug.test.ts`                                                                                                                                                                                     | `0217-contains-duplicate`, padding, diacritics, fallbacks, never-empty                                                                                                                      |
| `paths.test.ts`                                                                                                                                                                                    | Traversal, absolute paths, illegal characters, reserved names, length limits, and deterministic versioned filenames                                                                         |
| `language.test.ts`                                                                                                                                                                                 | ~40 language mappings, alias canonicalisation (`C++` → `cpp`), unknown languages are refused                                                                                                |
| `normalize.test.ts`                                                                                                                                                                                | **The Accepted-only gate** (every non-Accepted status), missing/blank code, missing ids, unsupported languages, missing metadata, CRLF/BOM normalisation, hash stability                    |
| `hash.test.ts`                                                                                                                                                                                     | Published sha256 and Git blob vectors, UTF-8 byte counting, base64                                                                                                                          |
| `schedule.test.ts`                                                                                                                                                                                 | Ladder normalisation, Easy/Hard/Again transitions, doubling past the ladder, the 365-day cap, date arithmetic, due buckets and local day boundaries                                         |
| `revisions.test.ts`                                                                                                                                                                                | Schema validation, versionless migration, review application, history cap, manual date override                                                                                             |
| `manifest.test.ts`                                                                                                                                                                                 | Schema validation, unsafe managed paths, mismatched keys, migration, and that upsert **keeps** obsolete category copies                                                                     |
| `readme.test.ts`                                                                                                                                                                                   | Template contents, editable-section extraction with and without markers, merge preservation, losslessness detection, idempotence                                                            |
| `conflicts.test.ts`                                                                                                                                                                                | All three-way states, README merge downgrade, machine-owned tracker files                                                                                                                   |
| `resolve.test.ts`                                                                                                                                                                                  | Cancel / replace / save-version, deterministic versioned names, collision handling, input immutability                                                                                      |
| `plan.test.ts`                                                                                                                                                                                     | Category copies from one canonical record, determinism, README merge, tracker backups, language accumulation, never planning a deletion                                                     |
| `pipeline.test.ts`                                                                                                                                                                                 | `prepareSync` / `completeSync`, protector behaviour, stale-verdict protection, idempotency                                                                                                  |
| `overview.test.ts`, `settings.test.ts`, `storage.test.ts`, `logger.test.ts`, `errors.test.ts`, `validation.test.ts`, `manifest-build.test.ts`, `leetcode-parse.test.ts`, `leetcode-detect.test.ts` | Views, settings coercion, storage degradation on corrupt data, redaction, error taxonomy, runtime validators, manifest permissions/CSP, LeetCode payload parsing and verdict classification |

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

| Behaviour                                                     | Level                                                                                                                               |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Accepted-only enforcement                                     | Unit tested + mocked integration                                                                                                    |
| Language/tag/path/README/manifest logic                       | Unit tested                                                                                                                         |
| GitHub retry, rate limit, conflict and commit behaviour       | Mocked integration                                                                                                                  |
| LeetCode `questionData` query and response shape              | **Live-verified** (see below)                                                                                                       |
| LeetCode `submissionDetails` and `submissionList` query shape | **Live-verified** (schema accepted; anonymous sessions receive `null`, which the parser handles)                                    |
| LeetCode verdict **DOM detection**                            | **Not live-verified** — the problem page returns HTTP 403 to non-browser clients, so the rendered DOM cannot be inspected from here |
| Extraction of a real Accepted submission's source code        | **Not live-verified** — requires an authenticated browser session                                                                   |
| Extension loading and use in Chrome / Firefox                 | **Not yet performed** — see the manual procedure below                                                                              |

### Live verification performed

Run against `https://leetcode.com/graphql` on 2026-10-21 with a plain HTTPS client:

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

Conclusions drawn, and only these:

1. `questionData` returns exactly the shape `parseQuestionResponse` expects, including
   `topicTags`, so problem metadata extraction is verified against the real service.
2. `submissionList` and `submissionDetails` are accepted by the live schema (no GraphQL
   `errors`), so every field name in those queries exists. Anonymous sessions receive `null`,
   which `parseSubmissionListResponse` and `parseSubmissionDetailsResponse` handle by
   returning `[]` / `null` rather than throwing — unit tested.
3. The page HTML is **not** reachable to a non-browser client, which is why the design reads
   the verdict from the live DOM in a content script and takes everything else from the API.

Do not read more into this than it says: the _queries_ are validated, the _DOM selectors_ are
not.

## Manual browser test procedure (not yet performed)

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
