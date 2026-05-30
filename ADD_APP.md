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

5. Push to `main` — the home page auto-discovers new folders on GitHub Pages.

The launcher lists every folder that contains `index.html`. `apps.json` only customizes the display name.

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
