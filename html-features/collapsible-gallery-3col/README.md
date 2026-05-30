# Collapsible gallery (3-column)

Horizontal category chips, expand/collapse individual items, expand-all / collapse-all toolbar, expanded row (max 3 across) above a 3-column collapsed grid.

## Status

### Approved

- Collapsed 3-column grid layout (vertical page scroll)
- Horizontal scrollable category filter chips
- Per-item expand/collapse toggle (caret + name chip)
- Expand all / Collapse all toolbar with `aria-pressed` active state
- Expanded items render in a row above collapsed items; row centers when 2–3 expanded
- Category filter hides non-matching items and prunes expand state for filtered-out items

### WIP

- **Expanded card inner content** — in Habit Journal this holds a year heatmap; layout is not finalized. This demo uses a placeholder block instead.

## When to use

Reuse when you have many labeled items grouped by category and want:

- A compact collapsed view (3 names per row)
- Optional expansion of one or more items into a detail area above the grid
- Bulk expand/collapse controls

## Source

Extracted from [habit-journal/index.html](../../habit-journal/index.html):

| Piece | Lines (approx.) |
|-------|-------------------|
| CSS: category filters, toolbar, gallery, 3-col grid, cards | 282–428 |
| JS: expand state, render grid, expand/collapse all | 1045–1046, 1251–1370, 1375–1383, 2142–2188 |

Stripped from reference: heatmaps, fullscreen, eraser mode, localStorage, pin stars, habit-specific data.

## Preview

```bash
open html-features/collapsible-gallery-3col/index.html
```
