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

## 4. First-time setup (three steps)

Open the extension and click the LeetSensei icon, then **Options**. Setup is a guided flow with
no tokens to create, no scope names to understand, and no manual polling.

### Step 1 — Connect GitHub

1. Click **Connect GitHub**. A one-time code appears and a GitHub tab opens.
2. Click **Copy code & open GitHub** and approve the request on GitHub.
3. Return to the options page. It detects the approval by itself and moves to step 2.

LeetSensei uses GitHub's **OAuth device flow**, so there is no password to type here and no
client secret anywhere in the extension. The permission requested first is `public_repo`:
read/write on **public** repositories.

### Step 2 — Choose where solutions go

1. Your repositories load automatically. Pick one from the list (only repositories you can
   push to are shown).
2. Pick a branch. The repository's default branch is preselected.
3. Click **Finish setup**. LeetSensei verifies the repository is reachable, that you have
   write access, and that the branch exists before it says it is ready.

Use an existing repository. LeetSensei creates category folders and a `.leetcode-tracker/`
state folder at its root, and only ever appends commits.

**Private destination repository?** The default permission cannot see private repositories.
Click **Allow private repositories** and approve once more; LeetSensei re-authorizes with the
`repo` scope and then lists them. Nothing wider is ever requested automatically.

**Repository not in the list?** Expand _Enter a repository manually_ and type the owner,
repository and branch — the same verification runs.

### Step 3 — Ready

The card turns green. From then on, solving a problem on LeetCode is all you do.

> **Development builds only:** a locally built copy can alternatively use a fine-grained
> personal access token (Options → Advanced settings → _Development: use a personal access
> token instead_). Store builds do not offer this and reject the request, because normal
> onboarding must not require a token. A release build (`npm run release`) refuses to run
> without a client id and compiles the token path out entirely.

## 5. First sync

Solve any LeetCode problem and get it Accepted. Within a few seconds the popup reports the
result. If LeetCode's page markup has changed, the popup reports an extraction failure with
the reason instead of syncing nothing silently.

## 6. Building a store package

Building with your own OAuth client id is a maintainer task:

```bash
$env:LEETSENSEI_GITHUB_CLIENT_ID = "Iv1.xxxxxxxxxxxx"   # PowerShell
npm run release
```

`npm run release` runs the full verification, refuses to build without a valid client id,
disables the personal-access-token path, builds Chrome only, and writes `dist/chrome.zip`.
The complete procedure is in [RELEASE.md](RELEASE.md).

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
