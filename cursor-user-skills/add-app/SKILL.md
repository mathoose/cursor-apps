---
name: add-app
description: Add a new app to mathoose/cursor-apps — folder scaffold, launcher entry, versions, backup wiring, and PNG home-screen icons that work when added to iOS/Android desktop. Use when creating a new app, scaffolding an app folder, or fixing missing/wrong add-to-home-screen icons.
---

# Add a new cursor-apps app

Use this skill when **creating a new app** in `mathoose/cursor-apps` or when an app’s **Add to Home Screen** icon is wrong (generic letter, blank, or missing).

## Home-screen icons (required — do not skip)

iOS Safari **does not use SVG** for `apple-touch-icon`. If you ship only `app-icon.svg`, the home screen shows a **generic letter** from the app title (e.g. “I” for Idea Notes).

Every app must ship a **180×180 PNG** and reference it in `index.html`:

| File | Purpose |
|------|---------|
| `your-app/app-icon.png` | Launcher grid + favicon + **Add to Home Screen** |
| `your-app/app-icon.svg` | Optional source art only — never the sole icon |

### Required `<head>` links

Match working apps (e.g. `photo-calendar`, `habit-journal`):

```html
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-title" content="Your App Name" />
<meta name="mobile-web-app-capable" content="yes" />
<meta name="theme-color" content="#…" />
<link rel="icon" href="app-icon.png" type="image/png" />
<link rel="apple-touch-icon" href="app-icon.png" />
```

**Do not** set `rel="apple-touch-icon"` to `.svg`. PNG only.

### If you design in SVG first

1. Save source as `app-icon.svg` (viewBox `0 0 180 180`).
2. Rasterize to PNG before committing:

```bash
./scripts/rasterize-app-icon.sh your-app
```

3. Commit **both** files; HTML must point at the PNG.

### Checklist before opening the PR

- [ ] `app-icon.png` exists and is **180×180**
- [ ] `index.html` uses `app-icon.png` for `rel="icon"` and `rel="apple-touch-icon"`
- [ ] `apple-mobile-web-app-title` matches the short name users see under the icon
- [ ] Launcher discovers the app (folder + `index.html`)

## Scaffold workflow

1. **Branch** — follow [github-pr-edits](../github-pr-edits/SKILL.md).
2. **Folder** — `your-app-name/index.html` (+ `app.js`, `styles.css` as needed).
3. **Icon** — create `app-icon.png` (180×180). Optional `app-icon.svg` as source; run rasterize script.
4. **`apps.json`** — add entry with `id`, `name`, `subtitle`, and `storageKey` if the app persists data.
5. **`versions.json`** — add `"your-app-name": "1 · Mon D, YYYY"`.
6. **Shared shell** in `index.html`:

```html
<link rel="stylesheet" href="../apps-shell.css" />
```

Header back link:

```html
<a href="https://mathoose.github.io/cursor-apps/" class="apps-home-back" data-apps-home aria-label="Back to Apps">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg>
</a>
```

Before `</body>`:

```html
<script src="../apps-backup.js"></script>
<script src="../apps-photo-picker.js"></script>
<script src="../apps-shell.js" defer></script>
```

7. **Backup** (if app stores data) — register in `apps.json` → `backup.apps` and `apps-backup.js` → `APP_REGISTRY`. See [ADD_APP.md](../../ADD_APP.md#unified-backup).
8. **Photo picker** — if users add photos, use `AppsPhotoPicker` (gallery **and** camera). See [ADD_APP.md](../../ADD_APP.md#photo-picker-gallery--camera).
9. **Version bump** — bump `apps.your-app-name` on every change to that folder; bump `launcher` if you touch shared shell files.
10. **PR** — one PR per round; include the summary table from github-pr-edits.

## Do not

- Ship a new app with SVG-only icons.
- Point `apple-touch-icon` at `app-icon.svg`.
- Skip `app-icon.png` because “the launcher can use SVG” — the launcher can, but **iOS home screen cannot**.
- Forget `versions.json` or the PR summary table.

## Reference

Full repo docs: [ADD_APP.md](../../ADD_APP.md)
