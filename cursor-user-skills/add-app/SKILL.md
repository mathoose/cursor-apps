---
name: add-app
description: Add a new app to mathoose/cursor-apps — folder scaffold, launcher entry, versions, backup wiring, PNG home-screen icons, a quick-export line that never covers tabs or page content, and an intent test that the page does what it was built to do. Use when creating a new app, scaffolding an app folder, fixing missing/wrong add-to-home-screen icons, or checking that an app works before a PR.
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

## Test the page with intent

Before opening a PR, use the app the way a person would. Drive the real page (a browser, two if two people share data). A render of the first screen is not the test. Do the thing the app is for, and check the result on the screen.

For a list two people share, open **two separate browser sessions** (separate profiles or contexts, so they do not share saved codes):

1. On the first screen, start a list: enter a new code, set the PIN, and confirm it. The first use must **create** the list. It must not stop because that code was not found.
2. On the second screen, enter the same code and PIN and open the list.
3. On the first screen, create a list. Set the name in the **settings cog**. Add an item, a comment, and a link.
4. On the second screen, see that list, item, comment, link, and name. Set a different name in the settings cog, then add a comment.
5. On the first screen, see the second person’s comment with their name.

Fix anything that fails and run the same path again.

### Checklist before opening the PR

- [ ] `app-icon.png` exists and is **180×180**
- [ ] `index.html` uses `app-icon.png` for `rel="icon"` and `rel="apple-touch-icon"`
- [ ] `apple-mobile-web-app-title` matches the short name users see under the icon
- [ ] Launcher discovers the app (folder + `index.html`)
- [ ] The quick-export line sits in its own row and does not cover tabs, toolbars, or page content

## Quick export line (required — do not cover it)

`apps-shell.js` adds a pill **Export** button on every app, including ones you are editing. It shows days since the last backup and downloads a full backup.

The Export pill sits in a fixed bar just above the bottom chrome (`.bottom-dock`, `.bottom-nav`, or `.tabbar`). It must never paint on top of tabs, Mark/Eraser bars, FABs, or the last row of content.

- Put bottom tabs in one fixed bar. Do not add a second fixed strip that occupies the same space.
- Bars that show and hide (mode bars, toolbars) belong **inside** that bottom chrome, so the export line stays above the whole stack.
- Do not set `overflow: hidden` on the bottom chrome — that clips the export line.
- Do not give `#appsQuickExport` / `.apps-quick-export` a new `position` or `z-index` that pulls it over other controls.
- Leave room under the page content. The shell adds the line’s height to `body` padding; don’t freeze `padding-bottom` inline in a way that ignores a bar appearing later.
- After any layout change, check a phone-width screen: the export text is fully above the tab bar, and the last card or row is fully above the export text.

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
- Let the export line overlap tabs, toolbars, or page content.

## Reference

Full repo docs: [ADD_APP.md](../../ADD_APP.md)
