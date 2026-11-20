---
name: icon-redesign
description: Redesign mathoose/cursor-apps Home Screen icons — back up current art, generate tone/PixelPot/DayCity/Passage options, export a Current-vs-four-styles comparison PNG, apply only after the user picks. Use when the user asks to redesign, refresh, or restyle app icons or launcher icons for iOS Add to Home Screen.
---

# App icon redesign

Use when the user wants **new Home Screen icons**, not when fixing a missing PNG (use **add-app** for that).

## Hard rules

1. **Export before PR** — Always produce `Current + tone + PixelPot + DayCity + Passage` via `./scripts/export-icon-style-options.sh` and show `/opt/cursor/artifacts/icon-style-options.png` in the chat.
2. **Do not merge options** — `icon-options/` is gitignored; do not open a PR until the user picks styles.
3. **Do not change live icons** — Leave `app-icon.png` alone until they choose.
4. **Keep revert** — Save originals under `your-app/icon-previous/`.

Full workflow and style notes: [docs/ICON_REDESIGN.md](../../docs/ICON_REDESIGN.md).

## Quick checklist

- [ ] `icon-previous/` has the current `app-icon.png`
- [ ] Four files in `icon-options/` (180×180 PNG each)
- [ ] Ran `./scripts/export-icon-style-options.sh <app-id> …`
- [ ] User circled or named picks
- [ ] Then: copy winner → `app-icon.png`, bump `versions.json`, PR

## Multi-app requests

One export can include several rows:

```bash
./scripts/export-icon-style-options.sh coffee-drinks-map habit-journal shared-lists
```

Each row uses that app’s `icon-previous` + `icon-options`.

## Distinct metaphors

If the user names multiple apps in one batch (e.g. Focus + Our Lists), avoid the same clipboard/checklist in every style. Vary the subject per app while keeping the column style consistent.
