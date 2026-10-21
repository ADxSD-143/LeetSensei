# Browser compatibility

| Browser                          | Manifest | Background form                   | Status                                                                                |
| -------------------------------- | -------- | --------------------------------- | ------------------------------------------------------------------------------------- |
| Chrome 111+                      | MV3      | `service_worker` (classic script) | **Loaded unpacked in Chromium: accepted with 0 errors, pages render and respond**     |
| Brave (Chromium-based)           | MV3      | `service_worker`                  | Same build as Chrome; not yet loaded                                                  |
| Microsoft Edge                   | MV3      | `service_worker`                  | Same build as Chrome; not yet loaded                                                  |
| Vivaldi / Opera (Chromium-based) | MV3      | `service_worker`                  | Same build as Chrome; not yet loaded                                                  |
| Firefox 115+                     | MV3      | `background.scripts` event page   | Build and output verified; not yet loaded                                             |
| Safari                           | —        | —                                 | **Not supported.** Requires an Xcode wrapper and a different extension model.         |
| Mobile browsers                  | —        | —                                 | **Not supported.** No `chrome://extensions` equivalent for loading an unpacked build. |

"Build verified" means `npm run build` produces a loadable directory for that engine, the
generated manifest passes the project's own validation, and `npm run verify:dist` confirms every
referenced file exists and nothing unsafe is shipped.

"Loaded unpacked in Chromium" is stronger and applies to Chrome only so far: the built directory
was loaded into a real Chromium browser, Chrome reported 0 runtime errors, 0 manifest errors and
0 install warnings, and the popup, dashboard and options pages were each opened and inspected.
What is still unverified in every browser is a full sync of an accepted submission into a real
repository. See [TESTING.md](TESTING.md#manual-browser-test-procedure-still-required).

## What differs between engines, and how it is handled

### Background context

Chrome MV3 uses `background.service_worker`; Firefox MV3 uses `background.scripts`. One
builder (`src/manifest/build-manifest.ts`) emits the correct shape per target and refuses to
emit both. Both bundles are plain `iife` scripts, so neither engine needs
`"type": "module"`, which sidesteps the differences in ES-module support between engines and
avoids any CSP wrinkle.

A practical consequence worth knowing: Chrome can terminate a service worker while an
operation is in flight. LeetSensei is written for that:

- every operation is idempotent, so a restart mid-sync is safe to repeat;
- local state is advanced only after a verified write, so a terminated worker cannot leave
  the manifest describing files that were never written;
- the device-flow sign-in is driven by the options page, not by a long-lived message channel,
  so a worker restart cannot drop it.

### API namespace

Chromium exposes `chrome`; Firefox exposes `browser`. `src/shared/browser-api.ts` resolves
`browser ?? chrome` once and every call site awaits it. MV3 APIs return promises in both
engines, so one code path works in both. Importing that module in Node (unit tests) is safe:
the export throws only if it is actually used.

### Host permissions

Both engines grant cross-origin access for hosts declared in `host_permissions`. The declared
list is exactly `https://leetcode.com/*`, `https://api.github.com/*` and `https://github.com/*`.

### Firefox add-on identity

Firefox needs a stable `browser_specific_settings.gecko.id` for storage to persist across
reloads. The build emits `leetsensei@adxsd-143.github.io`. A published build should use an id
the maintainer controls.

### Firefox temporary add-ons

`about:debugging` installs are removed on restart. Permanent installation requires a signed
package from addons.mozilla.org. For development, `web-ext run --source-dir dist/firefox`
handles reloads.

### Icons and badge

`action.setBadgeText` and `action.setBadgeBackgroundColor` are supported in Chrome MV3 and
Firefox MV3; the badge is refreshed hourly by an alarm and after every review.

## Store requirements

Chrome Web Store is the first target; Firefox follows later. **No submission has been made
yet.** The listing copy, permission justifications and privacy-practices answers are prepared in
[STORE_LISTING.md](STORE_LISTING.md); the build/submit procedure is in [RELEASE.md](RELEASE.md).

- **Chrome Web Store:** single-purpose statement, a privacy-policy **URL** (use
  [PRIVACY.md](../PRIVACY.md) once it is on `main`), a justification for each permission, and
  screenshots at 1280×800. The review also rejects remotely hosted code; LeetSensei ships none
  and its CSP forbids `eval`.
- **Firefox Add-ons:** a minified build must be accompanied by the source it was built from.
  The source is this repository, so submit it — or use `npm run build -- --no-minify` for a
  readable build.
- **Both:** the version must be `x.y` or `x.y.z`; the manifest already complies, and it is read
  from `package.json` at build time.
- **Store builds differ from development builds:** `npm run release` requires a public OAuth
  client id and compiles out the personal-access-token path. A release build was verified in
  Chromium to render zero password fields and never mention personal access tokens.

## Reporting a compatibility problem

Include the browser and version, the build target you loaded, and the popup's reported status
message (which names the failure). If a LeetCode page change is the cause, the status message
says the extraction failed rather than reporting a false success.
