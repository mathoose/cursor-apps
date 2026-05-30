# HTML Features Reference

Local-only UI pattern library for this repo. Each folder is a minimal, self-contained demo you can open in a browser without the app launcher or `apps-shell`.

**Not deployed** — these are not listed in `apps.json` or the home screen.

## How to preview

```bash
open html-features/collapsible-gallery-3col/index.html
```

## How to use with Cursor

When starting a new app or feature that needs a proven interaction:

> Reference `html-features/<pattern-name>` for the interaction model. Adapt styling to this app's theme; keep the expand/collapse and layout behavior.

## Catalog

| Pattern | Folder | Status | Use when |
|---------|--------|--------|----------|
| Collapsible gallery (3-col grid, expand/collapse all) | [collapsible-gallery-3col/](collapsible-gallery-3col/) | Collapsed layout approved; expanded inner content WIP | Many items grouped by category; horizontal chip filters; expand individual items into a row above a 3-column collapsed grid |

## Adding a new pattern

1. Create `html-features/your-pattern-name/` with `index.html` and `README.md`.
2. Keep `index.html` self-contained (inline CSS + JS, no app data).
3. Document **Approved** vs **WIP** in the pattern README.
4. Link the source app file and line range you copied from.
5. Add a row to the catalog table above.

Add patterns only when the **interaction** is done the way you want — not when a whole app ships.
