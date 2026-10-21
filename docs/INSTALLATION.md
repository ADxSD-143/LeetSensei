# Installation

**Status: the extension builds and loads from source on Chrome, Brave and Firefox.** It has
not been published to any browser store.

Everything below was run while building this repository, on Windows with Node 24. Commands
are the same on macOS and Linux.

## 1. Build

```bash
git clone https://github.com/ADxSD-143/LeetSensei.git
cd LeetSensei
npm ci --include=dev        # --include=dev matters if NODE_ENV=production is set
npm run build
npm run verify              # optional: format + lint + typecheck + tests + build
```

Expected output:

```text
[chrome] built 14 top-level entries -> dist\chrome
[firefox] built 14 top-level entries -> dist\firefox

Done. Load the unpacked extension from dist/<browser>/.
```

Both directories contain `manifest.json`, the five bundles, the three HTML pages, the CSS
files and `icons/`. No build step produces network access at runtime.

## 2. Chrome (and Brave, Edge, Vivaldi)

1. Open `chrome://extensions` (Brave: `brave://extensions`).
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the `dist/chrome` directory.
4. The LeetSensei icon appears in the toolbar. Pin it for easy access.
5. Click the icon, then **Options**.

To load it in a second browser profile, repeat with that profile's `chrome://extensions`.
Each profile keeps its own token and revision state.

## 3. Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…**.
3. Select `dist/firefox/manifest.json` (the file, not the directory).

Firefox removes temporary add-ons when it restarts. A permanent install requires a signed
package, which needs an account on addons.mozilla.org and passing review — neither has been
done for this version. For repeated development, use
[`web-ext`](https://extensionworkshop.com/documentation/develop/getting-started-with-web-ext/):

```bash
npx web-ext run --source-dir dist/firefox
```

## 4. Authorize GitHub

Open **Options** and pick one of the two paths.

### A. Personal access token (no rebuild required)

1. Create a **fine-grained** token at <https://github.com/settings/personal-access-tokens/new>.
2. Give it access to **only** the destination repository.
3. Permission: **Contents → Read and write**. Nothing else is needed.
4. Paste it into Options → GitHub account → _Advanced: use a personal access token instead_
   → **Save token**.

Because the token is scoped to one repository, a leak cannot touch anything else in your
account. Classic tokens with the `repo` scope also work but grant far more than LeetSensei
needs.

### B. Device flow (needs a client id at build time)

1. Register an OAuth App at <https://github.com/settings/developers>.
2. Enable **Device flow** for it. No client secret is needed or used.
3. Note the **Client ID** (it is public).
4. Rebuild with it:

   ```bash
   # Windows (cmd)
   set LEETSENSEI_GITHUB_CLIENT_ID=Iv1.xxxxxxxxxxxx
   npm run build
   ```

   PowerShell / macOS / Linux equivalents are in the [README](../README.md#connecting-github).

5. In Options, choose the scope (`public_repo`, or `repo` for a private destination) and
   click **Start GitHub sign-in**. Enter the displayed code at
   <https://github.com/login/device> and approve, then press **I approved it - continue**.

If no client id was baked in, LeetSensei says so clearly and points you at the token path
instead of failing silently.

## 5. Choose a destination

In Options → **Destination repository**:

1. Click **Load my repositories** and pick one (or type `owner` and `repo` and click **Save repository**).
2. Click **Load branches** and pick a branch (or type one).

Use an existing repository. LeetSensei creates category folders and a
`.leetcode-tracker/` state folder at its root, and only ever appends commits.

## 6. First sync

Solve any LeetCode problem and get it Accepted. Within a few seconds the popup reports the
result. If LeetCode's page markup has changed, the popup reports an extraction failure with
the reason instead of syncing nothing silently.

## Updating

```bash
git pull
npm ci --include=dev
npm run build
```

Then click **Reload** on the extension card (`chrome://extensions`) or re-load the temporary
add-on in Firefox. Local state is preserved; the manifest schema is versioned and migrated
automatically.

## Uninstalling

- **Extension only:** remove it from `chrome://extensions`. Local state is deleted with the
  extension's storage. Your repository files are untouched.
- **Everything:** also delete the `.leetcode-tracker/` folder and the category folders from
  your repository. LeetSensei never removes them for you.

Before uninstalling, use Options → **Export local data (JSON)** if you want a copy of your
manifest and revision schedule (it contains no credentials).
