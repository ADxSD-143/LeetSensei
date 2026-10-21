# Troubleshooting

Every failure path in LeetSensei produces a specific message. Find yours below.

## Nothing happens when I solve a problem

1. **Is detection on?** Options → Synchronization → _Detect Accepted submissions_.
2. **Is the problem page the right one?** The content script only runs on
   `https://leetcode.com/problems/*`. Open a problem and reload it after installing or
   updating the extension.
3. **Is it actually Accepted?** Wrong Answer, Runtime Error, Time Limit Exceeded,
   Compilation Error and Pending are all ignored on purpose. This is the most common
   "nothing happened" cause.
4. **Reload the page.** The script attaches on page load; a problem tab that was open before
   the extension was installed will not have it.
5. Check the popup for a status message. It always reports something, even when nothing was
   uploaded.

## "LeetSensei could not reach LeetCode to read the submission"

The same-origin GraphQL request failed.

- Sign in to LeetCode in the same browser profile. The request uses your existing session, so
  it fails while you are signed out.
- A VPN, proxy or privacy extension that blocks `leetcode.com` will cause this.
- If it persists while the site works normally, LeetCode has probably changed something.
  Open an issue with the popup's message; the request URL and query are in the source and can
  be re-validated against the live API.

## "LeetSensei does not have a file mapping for the language ..."

The submission used a language LeetSensei does not map to a file extension, and it refuses to
guess rather than write your code to a wrong extension. Nothing was uploaded.

Add the mapping to `src/core/language.ts` (a one-line table entry) and open a pull request, or
report the missing language. The error names the exact language string LeetCode returned.

## "LeetCode returned no topic tags, so this solution was filed under Uncategorized"

LeetCode did not report the problem's tags for that request, so LeetSensei used the fallback
bucket instead of inventing categories. The README says so as well. Move the folder by hand if
you prefer, or set a different fallback name in Options.

## "N files ... already exist with different content. Choose what to keep."

Working as designed: something at the destination path was not written by LeetSensei, or was
edited after the last sync. Your choices:

- **Replace** — the repository copy is overwritten with the new content. The old content is
  gone from the branch history only if you cannot recover it from Git history — you always can.
- **Save version** — LeetSensei keeps the repository's current content under a dated name
  (`solution.20240305-060708.py`) and writes the new content to the normal name. Nothing is
  lost.
- **Cancel** — the path is skipped entirely; other files in the same sync still land.

## "Choose a destination repository in the options page"

Options → Destination repository → _Load my repositories_ (or type `owner`/`repo`) and pick a
branch. Submissions detected meanwhile are held in the queue, not lost; the popup shows
"Sync now (N waiting)".

## "GitHub rejected the stored credentials" / "The GitHub token is invalid or has expired"

The token was revoked, expired, or never had write access.

1. Options → **Disconnect** (removes the stale token).
2. Reconnect with a new token: fine-grained, `Contents: Read and write`, on the destination
   repository only.
3. If you use the device flow, make sure the OAuth App still exists and still has device flow
   enabled.

## "GitHub API rate limit reached"

You hit GitHub's limit. LeetSensei backs off and retries automatically, honouring
`retry-after`; nothing is lost because every operation is idempotent. Press **Retry last
sync** in the popup later, or wait for the limit window to reset. Syncing dozens of problems
in a few minutes is the usual cause.

## "The branch changed while LeetSensei was writing ... retry to reconcile"

Someone (or another tool) pushed to the same branch while LeetSensei was committing.
LeetSensei retried automatically and could not confirm the result, so it deliberately did
**not** record the sync locally. Press **Retry last sync**: the files that did get written are
already identical to the plan, so the retry finishes the job rather than duplicating anything.

## "The branch \"x\" does not exist"

LeetSensei only writes to an existing branch and will not create one. Create it on GitHub and
paste the exact name into Options → Destination repository → Branch. The branch name is
validated as you save it: no spaces, no `..`, no leading or trailing `/`, no control characters.

## "LeetSensei does not support the branch name" / "not a valid GitHub owner name"

The value is not a valid Git ref or GitHub name. Fix the literal value in Options; LeetSensei
validates before saving so a bad value never reaches the API.

## "The stored manifest could not be read"

Local state was corrupted, so LeetSensei started from an empty manifest. That is the safe
direction: existing repository files are treated as unmanaged, which raises conflicts rather
than overwriting anything. To recover the real state, use Options → **Restore from repository**,
which reads `.leetcode-tracker/manifest.json` from the branch.

## The revision queue is empty after a reinstall

Restore it: Options → **Restore from repository**. LeetSensei reads
`.leetcode-tracker/revisions.json` and merges it, keeping whichever record was reviewed more
recently. If the repository has no backup yet, rate a problem and the backup is written
immediately.

## "Revision state saved locally. Connect GitHub to back it up."

Reviews always work offline; only the repository mirror needs a connection. The local state is
authoritative and the backup is written on the next review or when you press **Back up
revision state now** in Options → Revision preferences.

## An extension page shows "The LeetSensei background worker did not respond"

The service worker was asleep, starting up, or crashed. Reload the extension
(`chrome://extensions` → Reload, or re-load the temporary add-on in Firefox) and reopen the
page. If it repeats, Options → Diagnostics keeps the last 200 log lines, which is what a bug
report needs.

## I want to see what it is doing

- **Popup:** connection state, the last sync result, per-category status, the review count.
- **Dashboard:** every tracked problem, filters, the review queue, conflicts and history.
- **Options → Diagnostics:** the most recent log entries, redacted.

## I want to start over

- **Disconnect** — removes the stored token, keeps your local manifest and revision history.
- **Clear all local data** — removes everything LeetSensei stores locally. Repository files
  are never touched.
- To remove the repository side as well, delete the category folders and
  `.leetcode-tracker/` yourself. LeetSensei never deletes them for you.
