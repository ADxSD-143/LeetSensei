# Release runbook

How to produce and submit a Chrome Web Store build of LeetSensei. Firefox is a later phase.
Nothing here creates accounts or publishes on your behalf — steps marked **[you]** need your
credentials.

Related: [STORE_LISTING.md](STORE_LISTING.md) (listing copy), [PRIVACY.md](../PRIVACY.md),
[BROWSER_COMPATIBILITY.md](BROWSER_COMPATIBILITY.md).

---

## 0. One-time setup **[you]**

1. **Register a GitHub OAuth App** — GitHub → Settings → Developer settings → OAuth Apps → New.
   - Homepage URL: `https://github.com/ADxSD-143/LeetSensei`
   - **Enable "Device flow"**.
   - Copy the **Client ID**. It is public; there is no client secret to store.
2. **Register as a Chrome Web Store developer** — <https://chrome.google.com/webstore/devconsole>,
   pay the one-time fee, and enable 2-step verification on the Google account.
3. **Verify the contact email** the store will use.
4. **Publish the privacy policy** — after `PRIVACY.md` is on `main`, its GitHub URL is usable as
   the policy URL. (GitHub Pages is optional and gives a cleaner URL.)
5. Put the client id in your build environment. Never commit it:

   ```powershell
   # PowerShell (current session)
   $env:LEETSENSEI_GITHUB_CLIENT_ID = "Iv1.xxxxxxxxxxxx"
   ```

   ```bash
   # macOS / Linux
   export LEETSENSEI_GITHUB_CLIENT_ID=Iv1.xxxxxxxxxxxx
   ```

## 1. Pre-flight (every release)

```bash
git switch main
git pull --ff-only
npm ci --include=dev

npm run verify          # format, lint, typecheck, all tests, both builds, output check
```

`npm run verify` must be green. It also builds Firefox, which is not shipped yet but should
never regress.

## 2. Version

- Bump `version` in `package.json` (the manifest reads it; there is no second place).
- Add a `CHANGELOG.md` entry.
- Chrome Web Store versions can never decrease.

## 3. Build the store package

```bash
# Requires LEETSENSEI_GITHUB_CLIENT_ID; the build refuses to run without it.
npm run release
```

This runs the full verification, builds **chrome only** with the release flag (which requires
the client id and disables the personal-access-token path), archives `dist/chrome.zip`, and
re-runs the output check. Expect a line like:

```text
[chrome] packaged dist\chrome.zip (17 entries, 49 KB)
```

The archive is written by `scripts/zip.mjs`, a small dependency-free writer, rather than the
host's zip tool. That is deliberate: PowerShell's `Compress-Archive` and .NET Framework's
`ZipFile.CreateFromDirectory` both emit **backslashes** as the entry separator, which violates
the ZIP specification and risks rejection at upload. The built-in writer always uses forward
slashes and needs no `zip` binary, so the artifact is identical on Windows, macOS and Linux.

Confirm the artifact before uploading:

```bash
# Any of these works; the important part is that manifest.json is at the ROOT
# and that no entry name contains a backslash.
unzip -l dist/chrome.zip            # macOS / Linux
# Expand-Archive -Path dist/chrome.zip -DestinationPath .\zipcheck   # Windows
```

Expected entries, all at the archive root except `icons/`: `manifest.json`, `background.js`,
`content.js`, `popup.html/js/css`, `dashboard.html/js/css`, `options.html/js/css`,
`theme.css`, `icons/icon-16|32|48|128.png`. There must be no `.ts`, `.map` or `node_modules`.

Manual sanity check (2 minutes):

1. Load `dist/chrome` unpacked.
2. The options page shows **Connect GitHub** and no token field.
3. `chrome://extensions` shows **0 errors**.

## 4. End-to-end test **[you]**

Do this once per release on the release build. It is the only check that touches real
services.

| #   | Step                                                          | Expected                                                                                                                           |
| --- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Click **Connect GitHub**                                      | A code appears; the GitHub tab opens; the page advances by itself after you approve                                                |
| 2   | Repository step                                               | Your repositories load automatically; picking one loads branches; the default branch is preselected                                |
| 3   | **Finish setup**                                              | A green "Ready" card, with write access and branch confirmed                                                                       |
| 4   | Solve a problem, get **Accepted**                             | Popup reports a sync; the repository gains one folder per topic tag with `README.md` + `solution.<ext>`, plus `.leetcode-tracker/` |
| 5   | Submit a **Wrong Answer**                                     | Nothing is uploaded; no success is reported                                                                                        |
| 6   | Edit a solution on GitHub, sync again                         | LeetSensei stops and offers Replace / Save version / Cancel                                                                        |
| 7   | Write an approach into a problem README, sync again           | Your text survives                                                                                                                 |
| 8   | Rate a problem **Easy**, then **Again**                       | Intervals change as documented; `revisions.json` updates                                                                           |
| 9   | Reinstall the extension, **Restore from repository**          | Problems and review schedule return                                                                                                |
| 10  | **Disconnect**                                                | Token removed; solutions and revision data kept                                                                                    |
| 11  | (If applicable) private repo → **Allow private repositories** | Re-authorization succeeds and the repo becomes selectable                                                                          |

Record the browser versions used. Any failure here is a release blocker.

## 5. Upload and submit **[you]**

1. Chrome Web Store developer dashboard → **New item** → upload `dist/chrome.zip`.
2. Fill the listing from [STORE_LISTING.md](STORE_LISTING.md): name, short and detailed
   description, category, screenshots, privacy policy URL.
3. **Privacy practices** tab: answer exactly as in STORE_LISTING.md. Declare authentication
   information and website content; nothing sold; no remote code.
4. **Permission justifications**: paste from STORE_LISTING.md.
5. Submit for review. Review time is out of our control; expect days, not minutes.
6. Only after approval: mark the README install section as live.

## 6. After release

- Tag the commit (`git tag v1.0.0 && git push --tags`).
- Update `README.md` install instructions from "build from source" to the store link.
- Open a tracking issue for the Firefox submission (needs an addons.mozilla.org account and a
  source-code submission for the minified build; use `npm run build -- --no-minify` if the
  reviewer prefers readable output).

## Rollback

There is no "unpublish instantly": removing an item from the store does not uninstall it for
existing users. If a release is broken, publish a fixed version as soon as possible. Users can
always uninstall, and the extension never deletes their repository files.
