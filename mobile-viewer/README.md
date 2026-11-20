# Tracker Viewer

Read-only phone viewer for exports from `daily-tank-tracker.html` / tank tracker v2.

Each batch opens as **one activity column**: results, adjustments, and linked emails, color-coded. Emails with an Outlook/Graph link use **Open in Outlook** (opens the Outlook app on iPhone when the app is installed).

**Live:** https://mathoose.github.io/cursor-apps/mobile-viewer/

Safari → Share → **Add to Home Screen**.

## How to load an export

1. On the desktop tracker, use **Export ZIP** (save it to Google Drive).
2. In Tracker Viewer tap **Load latest from Google Drive** (or **Open Google Drive** on the first screen).
3. Open Drive, then come back and tap **Choose the export**. On iPhone: Browse → Google Drive → the newest ZIP or `full-backup.json`.
4. Parsing can take 10–30 seconds if there are lots of photos.

**Batches** is one column for the batch you pick in the dropdown (active batches first): results, adjustments, emails, DRB, and notes.

The page is a **still snapshot**. To refresh, export again from the desktop tracker and use **Load new export**.

## Your data never goes in this repo

GitHub Pages is public. **Do not commit export files.**

- Exports stay on the phone and are read locally in the browser.
- The app does not upload, POST, or send snapshot data anywhere.
- After a successful load, the snapshot is cached in **IndexedDB** (`trackerViewer`) so you do not have to re-pick the file every time.
- iOS Safari can evict that cache under storage pressure. If that happens you will see the load screen again — pick the export file once more.

Ignored by git: `*.zip`, `full-backup.json`, `tracker-export*`, `*-share-*.zip`.

## Read-only

Nothing in this app can add, edit, or delete tracker records. Search and the file picker are the only text fields.
