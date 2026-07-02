# Add a new app to this home screen

1. Create a folder: `your-app-name/` with `index.html` inside.
2. Add a **180×180** icon as `your-app-name/app-icon.png` (shows on the launcher).
3. Add an entry to **`apps.json`** (name + subtitle for the label under the icon).
4. In `index.html` `<head>`, include the shared back button to the launcher:

```html
<link rel="stylesheet" href="../apps-shell.css" />
```

In your header, add:

```html
<a href="https://mathoose.github.io/cursor-apps/" class="apps-home-back" data-apps-home aria-label="Back to Apps">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg>
</a>
```

Before `</body>`:

```html
<script src="../apps-backup.js"></script>
<script src="../apps-shell.js" defer></script>
```

5. Add the app to **`versions.json`** under `apps` with a starting version, e.g. `"your-app-name": "1 · Jul 1, 2026"`.
6. Push to `main` — the home page auto-discovers new folders on GitHub Pages.

The launcher lists every folder that contains `index.html`. `apps.json` only customizes the display name.

## Version numbers

All version strings live in **`versions.json`**:

- `launcher` — home screen (`index.html`, `apps.json`, `apps-backup.js`, `apps-shell.*`)
- `apps.<app-id>` — each app folder

Every app that includes `apps-shell.css` / `apps-shell.js` shows its version at the bottom of the screen. The launcher shows `launcher` at the bottom.

**When you change something, bump the matching version(s)** in `versions.json` (increment the number and update the date). Use the format `"N · Mon D, YYYY"`.

**End every commit message with the versions that changed**, for example:

```
Versions: launcher 10, adhd-task-tracker 12
```

**Saving data on iPhone:** Use one browser (Safari), normal (not Private) mode, and always the same URL (`mathoose.github.io`).

**Unified backup:** The Apps home screen has **Export all data** / **Import all data**. To include a new app in that bundle:

1. Add `storageKey` (and optional `legacyKeys`) under `backup.apps` in **`apps.json`**.
2. Register the app in **`apps-backup.js`** → `APP_REGISTRY` with `readSlice`, `writeSlice`, `isLegacy`, and `summarize`.
3. In the app’s import handler, accept unified files:

```javascript
var slice = parsed;
if (typeof AppsBackup !== 'undefined' && AppsBackup.isUnifiedBackup(parsed)) {
  slice = AppsBackup.getAppSlice(parsed, 'your-app-id');
  if (!slice) { /* toast: no data for this app */ return; }
}
// then validate and save slice as you do for app-only JSON
```

Per-app **Export JSON** / **Import JSON** can remain; they should accept either shape.
