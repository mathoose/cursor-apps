---
name: github-pr-edits
description: Edit mathoose/cursor-apps on GitHub with one PR per change round, mandatory version bumps in versions.json, and a PR summary table of new versions with short descriptions. Use for any code change, bug fix, or new feature in this repo.
---

# GitHub edits for cursor-apps

Use this skill for **every** code change in `mathoose/cursor-apps`. Do not push directly to `main`. Do not reuse a branch after its PR has been merged.

Live site: `https://mathoose.github.io/cursor-apps/` (GitHub Pages from **`main`** only).

## Workflow (required)

1. **Branch** — `git checkout main && git pull && git checkout -b cursor/<short-description>-1838`
2. **Edit** — Make the smallest correct change. Match existing patterns in the touched app folder.
3. **Version bump** — Update **`versions.json`** for every component you changed (see below).
4. **Commit** — Clear message; end with `Versions: …` listing bumped ids and numbers.
5. **Push** — `git push -u origin cursor/<short-description>-1838`
6. **Pull request** — Open a **new** PR to `main` (draft is fine). One PR per round of work; if the previous PR merged, start a new branch and new PR.
7. **Summarize** — End your message to the user with the **PR summary table** (see below).

## Version bumps (`versions.json`)

Format: `"N · Mon D, YYYY"` (increment **N**, update date).

| You changed… | Bump in `versions.json` |
|--------------|-------------------------|
| `index.html`, `apps.json`, `apps-backup.js`, `apps-shell.js`, `apps-shell.css`, `apps-photo-picker.js` | `launcher` |
| Files inside `habit-journal/` | `apps.habit-journal` |
| Files inside `things-book/` | `apps.things-book` |
| Any other `your-app/` folder | `apps.your-app` (folder name = app id) |

**Rules:**

- Bump **every** app or shared component whose code you touched — even one-line fixes.
- If you change both an app and shared shell files, bump **both** `launcher` and that app.
- New app: add a new `apps.<id>` entry starting at `1 · <today>`.
- Optional: bump `?v=N` on the app’s `app.js` / `styles.css` query string in `index.html` when you need cache bust on GitHub Pages.

Reference: [ADD_APP.md](../../ADD_APP.md#version-numbers), [versions.json](../../versions.json).

## PR summary table (required every turn with code changes)

Always include this at the **end** of your response when you changed code:

| PR | Summary | Versions |
|----|---------|----------|
| [#N](https://github.com/mathoose/cursor-apps/pull/N) | One line: what the user gets after merging | `things-book` **5** — fixed photo import on iOS |

### Column rules

1. **PR** — Link to `https://github.com/mathoose/cursor-apps/pull/N`. One row per **open** PR that still needs merging.
2. **Summary** — User-facing outcome (not implementation detail). One short sentence.
3. **Versions** — List every bumped id from `versions.json` as `id` **N** with an optional ` — short note` after each if helpful. Use the **new** version number after your edit. Include `launcher` when bumped.

If multiple apps changed in one PR, list them all in the Versions column, e.g.  
`launcher` **13**, `things-book` **5** — import fix, `dont-forget` **2** — gallery picker

If nothing is open to merge, say that and list what was merged or pushed this turn.

## Commit message example

```
Fix Things Book import: snapshot iOS gallery files before async processing

Versions: things-book 5
```

## Remind the user

- Changes appear on the phone **only after** the PR is **merged to `main`** and GitHub Pages deploys.
- App data on device (`localStorage` / IndexedDB) is not affected by deploys; clearing Safari website data is what wipes it.

## Do not

- Skip version bumps for “small” fixes.
- Fold unrelated work into one PR without user approval.
- Reuse a merged branch for new work — create a fresh branch and PR.
- Omit the PR summary table at the end of the turn.
