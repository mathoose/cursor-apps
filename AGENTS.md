# Agent instructions (cursor-apps)

Instructions for Cloud Agents and other automated contributors working in this repo.

**Cursor user skills:** install to `~/.cursor/skills/` with the scripts below. They auto-apply in matching tasks, not for unrelated local work.

| Skill | Install | When it applies |
|-------|---------|-----------------|
| [github-pr-edits](cursor-user-skills/github-pr-edits/SKILL.md) | [`scripts/install-github-pr-edits-skill.sh`](scripts/install-github-pr-edits-skill.sh) | PRs, pushes, repo changes on GitHub |
| [add-app](cursor-user-skills/add-app/SKILL.md) | [`scripts/install-add-app-skill.sh`](scripts/install-add-app-skill.sh) | Creating a new app, scaffolding app folders, home-screen icon setup |
| [icon-redesign](cursor-user-skills/icon-redesign/SKILL.md) | [`scripts/install-icon-redesign-skill.sh`](scripts/install-icon-redesign-skill.sh) | Redesigning Home Screen icons — Current vs tone/PixelPot/DayCity/Passage export before any PR |
| [mobile-canvas-plot-inspect](cursor-user-skills/mobile-canvas-plot-inspect/SKILL.md) | [`scripts/install-mobile-canvas-plot-inspect-skill.sh`](scripts/install-mobile-canvas-plot-inspect-skill.sh) | Canvas plot press-and-hold scrub, tooltips, crosshairs (especially Habit Journal Stats plot) |

## Pull requests

**Create a new PR for each round of changes** (do not reuse a branch after its PR has been merged).

**User merges only:** never merge a PR and never push to `main`. Agent-side merge/push does not update the live apps. Push the feature branch, open a PR, and leave it for the user to merge. Do not use `gh pr merge`, `git push origin main`, or any merge/land action.

At the **end of every turn** where code changed, include a **PR summary table** like this:

| PR | Summary | Versions |
|----|---------|----------|
| [#42](https://github.com/mathoose/cursor-apps/pull/42) | Short description of what changed | habit-journal **10**, launcher **11** |

### Table rules

1. **PR column** — PR number only, as a markdown link to the full GitHub URL (`https://github.com/mathoose/cursor-apps/pull/N`). One row per open PR that needs merging. If nothing is open, say so and list what was merged this turn instead.
2. **Summary column** — One short line: what the user gets after merging (not implementation detail).
3. **Versions column** — Every app or component whose version changed in `versions.json`, using the format `app-id **N**` (bold the version number). Include `launcher` when the home screen / shared shell changed. Use the post-merge version the user should see at the bottom of each app.

### Also do on every code change

- Bump matching entries in **`versions.json`** (`"N · Mon D, YYYY"`).
- End commit messages with `Versions: …` listing what changed.
- Push the **feature branch** (not `main`) and create/update the PR before finishing the turn. Leave the PR open.
- Tell the user they must **merge the PR themselves** for changes to appear on `mathoose.github.io`. Never merge it for them.

## Icon redesigns

When the user asks to **redesign** app icons: follow [docs/ICON_REDESIGN.md](docs/ICON_REDESIGN.md) and the **icon-redesign** skill. Generate four style options, run `./scripts/export-icon-style-options.sh`, attach the comparison PNG, and **do not open a PR** until they pick. `icon-options/` is gitignored.

## Version numbers

See [ADD_APP.md](ADD_APP.md#version-numbers). All display versions live in `versions.json`.

## Deploy model

- Live site: `https://mathoose.github.io/cursor-apps/` (GitHub Pages from **`main`**).
- Habit data and other app data stay on the user's phone (`localStorage`); app updates do not erase it.
- **Pages source must be GitHub Actions** (Settings → Pages → Build and deployment → Source: **GitHub Actions** → workflow **Deploy Pages**). Legacy “deploy from branch” conflicts with the Actions workflow and can wedge deploys.

## UX changes — confirm first

Before **removing or simplifying** an existing user-facing interaction (tap cycles, states like yes/no/in-progress, tabs, labels), **ask the user to confirm**. Do not skip steps in multi-state flows (e.g. yes/no **ongoing** ◐ → ✓ → ✗) unless they explicitly request a shorter flow.

## Habit Journal — syntax check

After editing `habit-journal/index.html`, run `./scripts/verify-habit-journal-js.sh` before pushing. A syntax error in the inline script blanks the entire app.

## Cursor Cloud specific instructions

The apps are static HTML. There is no package install. Node and Python 3 are already on the image.

On boot, `start` serves this repository at http://127.0.0.1:8080/ (launcher at `/`, each app at `/<folder>/`). The home screen uses `apps.json` when the GitHub contents API is unreachable.

After editing `habit-journal/index.html`, run `./scripts/verify-habit-journal-js.sh` before pushing. A syntax error in the inline script blanks the entire app.

## Coffee & Drinks map (canonical)

**Philly Dates** and **Coffee Map** are launcher-hidden (archived). Do not bump or edit them for map/pin work unless the user asks to un-archive.

- **App:** `coffee-drinks-map/`
- **Catalogs:** `coffee-drinks-map/drinks.json`, `coffee-drinks-map/coffee.json`
- **Pin/address/hours tooling:** `philly-dates/sync-google-locations.js`, `sync-google-addresses.js`, `fetch-google-hours.js` (they write the coffee-drinks catalogs), `scripts/align-all-map-pins.sh`, `scripts/sync-drink-catalog-locations.sh`
- **Docs:** `coffee-drinks-map/LOCATIONS.md`
