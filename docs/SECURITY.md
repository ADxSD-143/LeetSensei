# Security and Privacy

This document is the authoritative description of what LeetSensei can access, what it
stores, and what leaves your machine. It reflects the implemented code.

## Summary

| Question                  | Answer                                                                                                               |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Telemetry?                | None. No analytics, no crash reporting, no third-party services.                                                     |
| Network destinations      | `leetcode.com`, `github.com`, `api.github.com`. Nothing else.                                                        |
| LeetCode credentials      | Never requested. Passwords and cookies are never read.                                                               |
| Your GitHub token         | Stored in the extension's own storage; sent only to `api.github.com`. Never logged, never committed, never exported. |
| Source code you submitted | Written to the repository **you** choose. Never sent anywhere else, never executed.                                  |
| Permissions               | `storage`, `alarms`, plus host access to LeetCode and GitHub. No `<all_urls>`.                                       |
| Content script scope      | `https://leetcode.com/problems/*` only.                                                                              |

## Permissions and why each is needed

| Permission                 | Why                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------ |
| `storage`                  | Keep settings, the manifest and revision state in your browser profile.              |
| `alarms`                   | Refresh the "reviews due today" badge hourly.                                        |
| `https://leetcode.com/*`   | Read the problem page and issue same-origin GraphQL requests.                        |
| `https://api.github.com/*` | Authorization, repository reads and commits.                                         |
| `https://github.com/*`     | The OAuth device-flow endpoints (`/login/device/code`, `/login/oauth/access_token`). |

The content script is declared for `https://leetcode.com/problems/*` only, so it is not
injected into the rest of the site. A test asserts that no `<all_urls>` or `*://*/` entry
can slip into the manifest (`tests/unit/manifest-build.test.ts`).

## GitHub authorization

**Store builds have exactly one path: the OAuth device flow.** It needs only a public
`client_id`, which the maintainer injects at build time (`LEETSENSEI_GITHUB_CLIENT_ID`). There
is no client secret anywhere in the bundle, so nothing confidential can be extracted from it.
You approve the request in your own browser session at `github.com/login/device`, and
LeetSensei polls for the token. There is no exchange service, so no third party ever sees a
token, a submission or any activity.

Development builds additionally accept a **fine-grained personal access token**, which is
useful when working on the extension without a registered OAuth App. Release builds
(`npm run release`) compile that path out: `ALLOW_PAT` becomes `false`, the UI renders no token
field, and the `github/pat-save` message is rejected. Verified in a real browser: a release
build has **zero** password inputs and never mentions personal access tokens.

**No authorization exchange service exists in this project**, by design: the device flow
removes the need for one.

### Scope

The first authorization requests `public_repo`. This is the narrowest scope GitHub offers that
can write to a repository, but be precise about what it means: `public_repo` grants read/write
to **all of your public repositories**, not only the one you select. LeetSensei only ever
writes to the destination you chose — that restriction is enforced in the sync engine, not by
the token — but the token itself is broader. This is a GitHub limitation, and it is disclosed
in [PRIVACY.md](../PRIVACY.md) and the store listing.

`repo` (read/write on public _and_ private repositories) is requested **only** when you press
**Allow private repositories**, which is shown when a private destination is needed. It is
never requested automatically.

The token is never refreshed automatically: if you revoke it, LeetSensei asks you to reconnect.

## Where secrets live

- The token is stored under the `leetsensei:auth` key in `chrome.storage.local` /
  `browser.storage.local`. That store is isolated to the extension: web pages cannot read
  it, and no other extension can read it.
- Extension storage is **not** encrypted at rest. Anyone who can read your browser profile
  directory on disk can read it, exactly as with any other extension. This is why the
  recommended token is fine-grained and limited to one repository.
- The token is never written to the repository, never placed in a URL, never included in an
  export (`Coordinator.exportData` builds an explicit payload with no credential fields), and
  never included in a diagnostic report.
- Logging passes every value through `redact()` before formatting: values under
  token-shaped keys (`token`, `secret`, `password`, `cookie`, `device_code`, …) are replaced,
  and anything matching `gh[opsu]_…` or `Bearer …` is replaced even inside free text
  (`src/shared/logger.ts`, covered by `tests/unit/logger.test.ts`).

## Data storage

| Data                                        | Where                                      | Uploaded?                          |
| ------------------------------------------- | ------------------------------------------ | ---------------------------------- |
| Settings (repo, branch, intervals, toggles) | Local storage                              | No                                 |
| Manifest (managed paths, hashes, metadata)  | Local + `.leetcode-tracker/manifest.json`  | Yes, so a new device can reconcile |
| Revision state and history                  | Local + `.leetcode-tracker/revisions.json` | Yes, so a reinstall can restore it |
| Solution source code                        | Repository category folders                | Yes, that is the product           |
| GitHub token                                | Local storage only                         | Never                              |
| Logs                                        | In memory only, capped at 200 entries      | Never                              |

Nothing else is collected. There is no account system, no server, and no database.

## Repository-write safety

- **Only Accepted submissions are written.** The gate lives in `core/normalize.ts` and every
  other status has a test asserting it is refused.
- **Nothing is overwritten silently.** Every planned path is classified against three hashes
  (what we planned, what our manifest says we last wrote, what the repository currently
  holds). A file the user changed, or a file LeetSensei never created, requires an explicit
  Replace / Save version / Cancel decision.
- **Save version preserves the repository copy** under a deterministic dated name, derived
  from the submission timestamp.
- **No deletions, ever.** When a problem's tags change, new category copies are added and old
  ones are kept until you review them. Removing tags never deletes files.
- **No history rewriting.** `force` is never sent on a ref update; a concurrent push is
  detected and retried on a fresh base instead.
- **Path safety.** Every path is validated against traversal, absolute paths, control
  characters, illegal filename characters, Windows device names and over-length segments
  before it can reach the API (`core/paths.ts`).
- **Untrusted input.** LeetCode payloads, restored backups and stored settings are all
  validated at their boundaries. A corrupt manifest degrades to an empty one, which makes
  remote files look unmanaged — the safe direction, because that raises conflicts rather
  than overwriting.
- **Submitted code is never executed or evaluated.** It is treated as opaque text, and the
  UI only ever sets text via `textContent`, so problem titles and code cannot be interpreted
  as markup.

## Content Security Policy

Both manifests ship `script-src 'self'; object-src 'none'; base-uri 'none'`. There is no
`unsafe-eval`, no `unsafe-inline`, no remote script, no `eval`, and no dynamic code
generation. The build enforces this: `validateManifestShape` fails the build if a weak CSP
appears, and a test asserts it.

## What LeetSensei deliberately does not do

- No telemetry or analytics, and no "anonymous usage" endpoint.
- No paid or hosted API, LLM or database is required. Approach and complexity are written by
  you; nothing is generated.
- No LeetCode password, no session cookie jar, no reading of `document.cookie`.
- No password or secret embedded in the source, and none in the build output.
- No broad host permissions and no content script outside `/problems/*`.
- No automatic resubmission to LeetCode and no interaction with the LeetCode editor.

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private
[Security Advisory](https://github.com/ADxSD-143/LeetSensei/security/advisories/new) form,
or email the address on the maintainer's GitHub profile. Include the affected version, a
reproduction, and the impact. Expect an acknowledgement, and please allow time for a fix
before disclosure.

If you believe a token has leaked, revoke it immediately at
<https://github.com/settings/tokens> — LeetSensei is not required for revocation, and
disconnecting in Options removes the local copy.

## Verifying these claims yourself

Everything above is checkable in the source:

- Permissions and CSP: `src/manifest/build-manifest.ts` (and its tests).
- Redaction: `src/shared/logger.ts` + `tests/unit/logger.test.ts`.
- Token never exported: `tests/integration/coordinator.test.ts` → _"exports local state
  without any credential"_.
- Nothing overwritten silently: `tests/integration/coordinator.test.ts` → the conflict
  suite.
- No network in the test suite, and no real repository touched: `tests/fake-github.ts`.

## Residual risks

- **LeetCode page changes.** Verdict detection depends on page markup. A change breaks the
  _trigger_ with a visible error; it cannot corrupt data, because the extracted content comes
  from the API and is re-validated before use.
- **Unencrypted local storage.** Covered above; mitigated by using a repository-scoped token.
- **`chrome.storage.local` quota.** GitHub's tree endpoint can truncate very large
  repositories; LeetSensei detects that and reports it rather than guessing.
- **Browser-store policy.** Store requirements change; they are re-checked before any
  submission, which has not happened yet.
