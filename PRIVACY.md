# LeetSensei Privacy Policy

**Effective date:** 21 October 2026
**Applies to:** the LeetSensei browser extension, version 1.0.0 and later.

LeetSensei is an open-source extension that saves the LeetCode solutions you get Accepted
into a GitHub repository you choose, and helps you revise them later. This policy explains
exactly what it stores, what it sends, and to whom. It is deliberately short, because
LeetSensei does very little: there is no account system, no server of ours, and no analytics.

## The short version

- **No telemetry, no analytics, no advertising, no tracking.**
- The only network destinations are `leetcode.com`, `github.com` and `api.github.com`.
- Your GitHub token is stored in this browser profile and sent only to GitHub.
- The only thing uploaded is the solution and problem metadata you would see on LeetCode,
  written to the repository you selected.
- Nothing is sold or shared with third parties. There is no third party.

## What LeetSensei stores on your device

Stored in your browser's extension storage (`chrome.storage.local`), which web pages cannot
read:

| Data                                                                             | Why                                                     |
| -------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Your settings (destination repository, branch, sync toggles, revision intervals) | So you configure it once                                |
| A manifest of the files it created, with hashes                                  | So it can detect changes and never overwrite your edits |
| Your revision history and next review dates                                      | So the revision queue survives restarts                 |
| Your GitHub access token                                                         | So it does not ask you to sign in on every action       |

**The token is not encrypted at rest.** Anyone who can read your browser profile directory on
disk can read it, as with any extension. LeetSensei therefore asks GitHub for the narrowest
scope that works: read/write on **public** repositories by default, and read/write on **all**
repositories only if you explicitly choose "Allow private repositories". You can remove the
token at any time with **Options → Disconnect**, and remove everything else with **Clear all
local data**.

## What LeetSensei sends, and where

| Destination      | What is sent                                                                                                   | When                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `leetcode.com`   | Requests for the problem metadata and the submission you just made, using the session your browser already has | When you press Submit, or when a problem page shows a judging result          |
| `github.com`     | The OAuth device-flow requests that sign you in                                                                | Only during sign-in                                                           |
| `api.github.com` | Your token, and the files to write (solution source, generated README, and the two small state files)          | When syncing, backing up revisions, or listing your repositories during setup |

Nothing else leaves your browser. There is no LeetSensei server, no proxy, no logging
endpoint, and no crash reporting. Diagnostics logs exist only in memory, are capped at 200
lines, and are never uploaded.

## What LeetSensei does not do

- It does **not** read or store your LeetCode password, and it does **not** read your cookies.
  LeetCode requests run inside the page you already have open, using its existing session.
- It does **not** upload Wrong Answer, Runtime Error, Time Limit Exceeded, Compilation Error or
  pending submissions. Only submissions LeetCode confirms as Accepted are ever written.
- It does **not** execute or evaluate the code you submit. It treats it as text.
- It does **not** read other websites, your browsing history, your tabs, or other extensions.
- It does **not** collect usage statistics, device identifiers, or location.
- It does **not** delete anything in your repository, and never force-pushes.

## Permissions, in plain language

- **storage** — save your settings, the file manifest and your revision history in this
  browser profile.
- **alarms** — refresh the "reviews due today" badge once an hour.
- **leetcode.com** — read the problem page and ask LeetCode for the submission you made.
- **api.github.com** — write your solutions to the repository you picked.
- **github.com** — sign you in with GitHub's device flow (no client secret is involved).

## Data you can remove

| To remove                            | How                                                                   |
| ------------------------------------ | --------------------------------------------------------------------- |
| Your GitHub access                   | Options → **Disconnect** (deletes the stored token)                   |
| Everything LeetSensei stores locally | Options → **Clear all local data**                                    |
| Solutions already written to GitHub  | Delete them in your repository; LeetSensei never deletes them for you |
| The repository state folder          | Delete `.leetcode-tracker/` in your repository                        |

Uninstalling the extension removes its local storage, including the token.

## Children

LeetSensei is a developer tool for LeetCode users and is not directed at children under 13.

## Changes to this policy

If this policy changes, the update will be committed to the project repository with a new
effective date, and the change will be noted in `CHANGELOG.md`. Because the extension collects
nothing new silently, any new data flow would require a new version and a fresh disclosure.

## Contact

Open an issue at <https://github.com/ADxSD-143/LeetSensei/issues> for privacy questions, or use
the private security advisory form for anything sensitive:
<https://github.com/ADxSD-143/LeetSensei/security/advisories/new>.

LeetSensei is free and open source under the MIT license. You can verify every statement above
in the source code — see `docs/SECURITY.md` for a map of which file implements which promise.
