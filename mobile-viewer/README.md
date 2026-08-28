# Tracker Viewer

Read-only phone viewer for exports from `daily-tank-tracker.html`.

**Live:** https://mathoose.github.io/cursor-apps/mobile-viewer/

Safari → Share → **Add to Home Screen**.

## How to load an export

1. On the desktop tracker, use **Export ZIP**.
2. Get that `.zip` (or a bare `full-backup.json` you extracted) onto the phone — AirDrop, Files, iCloud Drive, etc.
3. Open Tracker Viewer and tap **Choose tracker export**.
4. Pick the ZIP or `full-backup.json`. Parsing can take 10–30 seconds if there are lots of photos.

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
