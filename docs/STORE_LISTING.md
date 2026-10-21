# Chrome Web Store listing copy

Everything needed to fill in the Chrome Web Store developer dashboard, written to match the
shipped build (1.0.0). Copy from here rather than improvising, so the listing cannot drift
from the code.

Also see: [PRIVACY.md](../PRIVACY.md) (the privacy-policy URL) and
[RELEASE.md](RELEASE.md) (the build/submit runbook).

---

## Store metadata

| Field                          | Value                                                                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Name                           | LeetSensei                                                                                                                                                   |
| Short description (≤132 chars) | Save your Accepted LeetCode solutions to your own GitHub repository, organized by topic, with a revision queue.                                              |
| Category                       | Developer Tools                                                                                                                                              |
| Language                       | English                                                                                                                                                      |
| Homepage                       | https://github.com/ADxSD-143/LeetSensei                                                                                                                      |
| Support URL                    | https://github.com/ADxSD-143/LeetSensei/issues                                                                                                               |
| Privacy policy URL             | The GitHub URL of `PRIVACY.md` (or a GitHub Pages URL for the same file)                                                                                     |
| Version                        | 1.0.0                                                                                                                                                        |
| Single purpose                 | Save a user's Accepted LeetCode submissions to a GitHub repository they select, organized by official topic tags, and schedule revisions of solved problems. |

## Detailed description

```text
LeetSensei saves the LeetCode solutions you get Accepted into a GitHub repository you own,
and keeps track of what to revise.

Solve a problem on LeetCode and get it Accepted. LeetSensei copies the source you just
submitted into your repository — once for every official topic tag on the problem, so your
`solutions` repo becomes browsable by topic:

  Array/0217-contains-duplicate/solution.py
  Hash-Table/0217-contains-duplicate/solution.py

Each problem folder also gets a README with the problem link, difficulty and topics, plus
sections for your own approach, time complexity, space complexity and notes. Those sections
are yours: LeetSensei never overwrites what you wrote.

Then it helps you remember. Every solution is scheduled for review, and you tell it whether
the problem felt Easy, Hard or Again. Easy moves the problem further out, Hard keeps it where
it is, and Again brings it back to tomorrow. A dashboard shows what is overdue, due today and
coming up.

WHAT IT WILL NOT DO
• It only ever saves submissions LeetCode confirms as Accepted. Rejected and pending
  submissions are ignored.
• It never overwrites a file you edited on GitHub. If something changed, it asks: replace,
  keep your version as a dated copy, or skip.
• It never deletes files and never force-pushes.
• It never asks for your LeetCode password, and it does not read your cookies.
• It sends nothing to us. There is no LeetSensei server and no analytics.

SETUP
1. Install and click "Connect GitHub". Approve the one-time code on GitHub — there is no
   token to copy or paste.
2. Pick the repository and branch where your solutions should go.
3. Solve problems on LeetCode. Everything else is automatic.

You need a GitHub account and a repository you can push to. Public repositories work with the
default permission; private repositories need one extra tap ("Allow private repositories").

FREE AND OPEN SOURCE
MIT licensed. No account, no subscription, no paid service. Source, documentation and issue
tracker: https://github.com/ADxSD-143/LeetSensei
```

## Permission justifications

The dashboard requires one justification per permission. These match
`src/manifest/build-manifest.ts`.

| Permission                 | Justification (paste as-is)                                                                                                                                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`                  | Stores the user's settings, a manifest of the files LeetSensei created for them, and their revision schedule in the browser profile, so the extension works between sessions. The data stays on the device.                                                         |
| `alarms`                   | Runs an hourly refresh of the toolbar badge that shows how many revisions are due. It performs no network access.                                                                                                                                                   |
| `https://leetcode.com/*`   | Reads the LeetCode problem page the user has open and requests that user's own submission metadata and source code from LeetCode, in order to detect Accepted submissions. This uses the session the user already has; LeetSensei never reads cookies or passwords. |
| `https://api.github.com/*` | Lists the user's repositories during setup, and writes the selected submission's files to the specific repository and branch the user chose.                                                                                                                        |
| `https://github.com/*`     | Completes GitHub's OAuth device-flow sign-in (requests to /login/device/code and /login/oauth/access_token). No client secret is used or stored.                                                                                                                    |

## Privacy practices answers

Chrome Web Store asks a fixed set of questions. Answer them exactly like this.

| Question                                                                               | Answer  | Note                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does the extension collect personally identifiable information?                        | **No**  | No name, email, address or identifier is collected.                                                                                                                                       |
| Does it collect health information?                                                    | No      |                                                                                                                                                                                           |
| Does it collect financial and payment information?                                     | No      |                                                                                                                                                                                           |
| Does it collect authentication information?                                            | **Yes** | The GitHub OAuth token. Used only to authenticate GitHub API requests on the user's behalf. Not sold, not used for advertising, not used for any purpose unrelated to the single purpose. |
| Does it collect personal communications?                                               | No      |                                                                                                                                                                                           |
| Does it collect location?                                                              | No      |                                                                                                                                                                                           |
| Does it collect web history?                                                           | No      | The extension only touches `leetcode.com/problems/*` and the GitHub API; it does not read browsing history.                                                                               |
| Does it collect user activity?                                                         | No      | No clicks, keystrokes, mouse position or analytics are recorded.                                                                                                                          |
| Does it collect website content?                                                       | **Yes** | The problem metadata and the source code of an Accepted submission, which is the product's purpose. It is sent only to the GitHub repository the user selected.                           |
| Is the data sold to third parties?                                                     | **No**  | No third party receives data.                                                                                                                                                             |
| Is the data used or transferred for purposes unrelated to the single purpose?          | **No**  |                                                                                                                                                                                           |
| Is the data used or transferred to determine creditworthiness or for lending purposes? | **No**  |                                                                                                                                                                                           |
| Are you using remote code?                                                             | **No**  | All code ships in the package. The CSP forbids `unsafe-eval` and there is no remote script.                                                                                               |
| Does the extension use certificates to verify the integrity of code?                   | No      | Not applicable.                                                                                                                                                                           |

## Assets

| Asset            | Requirement                       | Status                                                                                                                                   |
| ---------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Store icon       | 128×128 PNG                       | `icons/icon-128.png` ✅                                                                                                                  |
| Screenshots      | 1280×800 or 640×400 PNG/JPEG, 1–5 | **Not yet captured.** The three existing images are 1619×1109 dev captures. Procedure in [screenshots/README.md](screenshots/README.md). |
| Small promo tile | 440×280 (optional)                | Not produced for 1.0.0                                                                                                                   |
| Marquee          | 1400×560 (optional)               | Not produced for 1.0.0                                                                                                                   |

Screenshots use clearly-labelled example data because a store reviewer cannot sign in to a
real LeetCode account. Do not present them as a specific user's data, and keep the note in the
description that they show example data.

## What reviewers may ask about

- **Why `https://github.com/*`?** Only the device-flow endpoints are called. A reviewer can
  confirm this in `src/github/auth.ts` (`DEVICE_CODE_URL`, `ACCESS_TOKEN_URL`).
- **Why does it need repo write access?** Writing the user's own solutions to the user's own
  repository is the entire function. It never writes anywhere else: the destination is chosen
  by the user and stored locally.
- **Does it work without the account?** Yes — it is fully usable offline for reviewing already
  synced problems; GitHub is only contacted when syncing or backing up.
- **Is the token shipped?** No. Only a public OAuth `client_id` is embedded; there is no client
  secret anywhere in the package. `npm run verify:dist` fails the build if a token-shaped or
  secret-shaped string appears.
