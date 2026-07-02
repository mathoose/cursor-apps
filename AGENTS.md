# Agent instructions (cursor-apps)

Instructions for Cloud Agents and other automated contributors working in this repo.

## Pull requests

**Create a new PR for each round of changes** (do not reuse a branch after its PR has been merged).

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
- Push the branch and create/update the PR before finishing the turn.
- Tell the user they must **merge to `main`** for changes to appear on `mathoose.github.io`.

## Version numbers

See [ADD_APP.md](ADD_APP.md#version-numbers). All display versions live in `versions.json`.

## Deploy model

- Live site: `https://mathoose.github.io/cursor-apps/` (GitHub Pages from **`main`**).
- Habit data and other app data stay on the user's phone (`localStorage`); app updates do not erase it.
