---
name: github-pr-edits
description: Edit files on GitHub via pull requests — one PR per change round, version bumps for every edited component, and a PR summary table of new version numbers with short descriptions. Use when editing a GitHub repository, creating or updating pull requests, pushing branches to GitHub, opening PRs, or when the user asks to change code on GitHub.
---

# GitHub edits (pull request workflow)

Use this skill when making **any code change destined for GitHub**. Do not push directly to the default branch. Do not reuse a branch after its PR has been merged.

## Workflow (required)

1. **Branch** — `git checkout <default-branch> && git pull && git checkout -b <branch-name>`
2. **Edit** — Make the smallest correct change. Match existing patterns in the repo.
3. **Version bump** — If the repo tracks versions (see below), bump every component you changed.
4. **Commit** — Clear message; end with `Versions: …` when versions were bumped.
5. **Push** — `git push -u origin <branch-name>`
6. **Pull request** — Open a **new** PR to the default branch. One PR per round of work; if the previous PR merged, start a new branch and new PR.
7. **Summarize** — End your message to the user with the **PR summary table** (see below).

## Version bumps

Check whether the repo has a version manifest. If it does, bump **every** component whose code you touched — even one-line fixes.

### `mathoose/cursor-apps` (`versions.json`)

Format: `"N · Mon D, YYYY"` (increment **N**, update date).

| You changed… | Bump in `versions.json` |
|--------------|-------------------------|
| `index.html`, `apps.json`, `apps-backup.js`, `apps-shell.js`, `apps-shell.css`, `apps-photo-picker.js` | `launcher` |
| Files inside `habit-journal/` | `apps.habit-journal` |
| Files inside `things-book/` | `apps.things-book` |
| Any other `your-app/` folder | `apps.your-app` (folder name = app id) |

Rules:

- If you change both an app and shared shell files, bump **both** `launcher` and that app.
- New app: add a new `apps.<id>` entry starting at `1 · <today>`.
- Optional: bump `?v=N` on the app’s `app.js` / `styles.css` query string in `index.html` for cache bust on GitHub Pages.

See `ADD_APP.md` and `versions.json` in that repo.

### Other repos

Look for `package.json`, `VERSION`, `CHANGELOG.md`, or similar. Follow the repo’s existing versioning convention. If none exists, note “no version file” in the PR summary table.

## PR summary table (required every turn with code changes)

Always include this at the **end** of your response when you changed code:

| PR | Summary | Versions |
|----|---------|----------|
| [#N](https://github.com/owner/repo/pull/N) | One line: what the user gets after merging | `component` **N** — short description of change |

### Column rules

1. **PR** — Link to the full GitHub PR URL. One row per **open** PR that still needs merging.
2. **Summary** — User-facing outcome (not implementation detail). One short sentence.
3. **Versions** — List every bumped id as `id` **N** with an optional ` — short note`. Use the **new** version number after your edit.

If multiple components changed in one PR, list them all in the Versions column.

If nothing is open to merge, say that and list what was merged or pushed this turn.

## Commit message example

```
Fix Things Book import: snapshot iOS gallery files before async processing

Versions: things-book 5
```

## Remind the user

- Changes go live only after the PR is **merged** to the default branch (and any deploy pipeline runs).
- For `mathoose/cursor-apps`: live site is `https://mathoose.github.io/cursor-apps/` (GitHub Pages from **`main`**). App data on device (`localStorage` / IndexedDB) is not affected by deploys.

## Do not

- Skip version bumps for “small” fixes when the repo tracks versions.
- Fold unrelated work into one PR without user approval.
- Reuse a merged branch for new work — create a fresh branch and PR.
- Omit the PR summary table at the end of the turn.
