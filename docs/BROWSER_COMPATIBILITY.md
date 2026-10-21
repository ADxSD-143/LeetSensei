# Browser compatibility

| Browser                          | Manifest | Background form                   | Status                                                                                |
| -------------------------------- | -------- | --------------------------------- | ------------------------------------------------------------------------------------- |
| Chrome 111+                      | MV3      | `service_worker` (classic script) | Build verified; not yet loaded manually                                               |
| Brave (Chromium-based)           | MV3      | `service_worker`                  | Same build as Chrome; not yet loaded manually                                         |
| Microsoft Edge                   | MV3      | `service_worker`                  | Same build as Chrome; untested                                                        |
| Vivaldi / Opera (Chromium-based) | MV3      | `service_worker`                  | Same build as Chrome; untested                                                        |
| Firefox 115+                     | MV3      | `background.scripts` event page   | Build verified; not yet loaded manually                                               |
| Safari                           | —        | —                                 | **Not supported.** Requires an Xcode wrapper and a different extension model.         |
| Mobile browsers                  | —        | —                                 | **Not supported.** No `chrome://extensions` equivalent for loading an unpacked build. |

"Build verified" means `npm run build` produces a loadable directory for that engine and the
generated manifest passes the project's own validation (permissions, CSP, background shape).
"Loaded manually" would mean a human enabled the extension in that browser and synced a
submission — that has not happened yet, so treat runtime behaviour in every browser as
unverified until it does. See [TESTING.md](TESTING.md#manual-browser-test-procedure-not-yet-performed).

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

Checked before any submission; **no store submission has been made**:

- Chrome Web Store: a single-purpose description, a privacy policy URL (use
  [docs/SECURITY.md](SECURITY.md)), justification for each permission, and a review that
  rejects remotely hosted code. LeetSensei ships no remote code and no `eval`, so it should
  pass, but only a real review confirms it.
- Firefox Add-ons: a minified build must be accompanied by the source it was built from. The
  source is this repository, so submit it — or use `npm run build -- --no-minify` to produce a
  readable build that reviewers can read directly.
- Both: version must be `x.y` or `x.y.z`; the manifest already complies.

## Reporting a compatibility problem

Include the browser and version, the build target you loaded, and the popup's reported status
message (which names the failure). If a LeetCode page change is the cause, the status message
says the extraction failed rather than reporting a false success.
