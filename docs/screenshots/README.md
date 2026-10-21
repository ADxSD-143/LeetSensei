# Screenshots

## Current files

| File            | Size      | Use                                       |
| --------------- | --------- | ----------------------------------------- |
| `dashboard.png` | 1619×1109 | README illustration (development capture) |
| `options.png`   | 1619×1109 | README illustration (development capture) |
| `popup.png`     | 382×566   | README illustration (development capture) |

These were captured from the built extension loaded unpacked in Chromium with a fresh profile,
so they show genuine empty states. **They are not valid Chrome Web Store screenshots**: the
store requires 1280×800 or 640×400.

## Store screenshots (to be captured before submission)

Create `docs/screenshots/store/` with 1–5 images at exactly **1280×800**:

1. `01-connect.png` — the three-step setup card on the options page.
2. `02-popup.png` — the popup after setup, showing the destination and review count.
3. `03-dashboard.png` — the dashboard with a few problems listed.
4. `04-review-queue.png` — the review queue with overdue / due today / upcoming groups.
5. `05-conflict.png` — a conflict prompt (Replace / Save version / Cancel).

Because a store reviewer cannot sign in to a LeetCode account, the populated shots use
**clearly-labelled example data** seeded into `chrome.storage.local`. Keep the caption honest:
the listing text says screenshots show example data.

### How to regenerate

```bash
# 1. Build and load dist/chrome unpacked, then note the extension id.
npm run build:chrome

# 2. With the extension loaded, open the options page and seed demo data from its context:
#    (run in the extension page console)
#    chrome.storage.local.set({ 'leetsensei:manifest': {...}, 'leetsensei:revisions': {...} })

# 3. Resize the window to exactly 1280x800 (device scale factor 1) and capture.

# 4. Clear the demo data afterwards:
#    chrome.storage.local.remove(['leetsensei:manifest','leetsensei:revisions'])
```

Do not commit screenshots that contain a real account name, a real repository, or a real
token. The demo data must use an obviously fictional account.
