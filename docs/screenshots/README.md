# Screenshots

## Store screenshots (`store/`) — ready for the Chrome Web Store

| File                  | Size     | Shows                                                                                                                                  |
| --------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `01-connect.png`      | 1280×800 | Step 1 of the guided setup: the three-step indicator and the single "Connect GitHub" action, with no token field and no scope question |
| `02-dashboard.png`    | 1280×800 | The dashboard with five solved problems, showing topics, languages, categories and next-review state                                   |
| `03-review-queue.png` | 1280×800 | The review queue grouped into Overdue / Due today / Upcoming, with the Easy / Hard / Again controls                                    |

Captured from the built extension loaded unpacked in Chromium, at exactly 1280×800 with the
viewport set explicitly. **The populated screens use example data**: a fictional
`example-student` account, a fictional `example-student/leetcode-solutions` repository, and five
real LeetCode problems with synthetic review history. The store listing says so. No real
account, repository or token appears in any image.

## Regenerating them

```bash
# 1. Build and load dist/chrome unpacked; note the extension id.
npm run build:chrome

# 2. Produce validated demo state. This fails loudly if the payload would not pass
#    the manifest/revision validators, so a screenshot can never show a
#    "corrupt data" banner.
npm run demo-data > demo-state.json

# 3. With the extension loaded, seed it from an extension page's console:
#    chrome.storage.local.set(<contents of demo-state.json>)

# 4. For each view, set the viewport and capture:
#    agent-browser set viewport 1280 800
#    agent-browser screenshot docs/screenshots/store/01-connect.png

# 5. Clear the demo data when finished:
#    chrome.storage.local.remove(['leetsensei:settings','leetsensei:manifest',
#      'leetsensei:revisions','leetsensei:auth','leetsensei:sync'])
```

Capture `01-connect.png` against a **cleared** profile (no account, no repository) so it shows
step 1 rather than the ready state. Capture the other two after seeding.

## Legacy development captures

| File            | Size      | Use                                    |
| --------------- | --------- | -------------------------------------- |
| `dashboard.png` | 1619×1109 | Superseded by `store/02-dashboard.png` |
| `options.png`   | 1619×1109 | Superseded by `store/01-connect.png`   |
| `popup.png`     | 382×566   | Popup illustration; not store-sized    |

These came from the same real browser session on a fresh profile, so they are genuine empty
states, but they are the wrong dimensions for the store.

Do not commit screenshots that contain a real account name, a real repository, or a real token.
The demo data must use an obviously fictional account.
