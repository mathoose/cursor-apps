# App icon redesign workflow

When the user asks to **redesign** or **update** a Home Screen icon, deliver a **review export first**. Do not open a PR or change the live `app-icon.png` until they pick a style.

## Deliverable: Current vs four styles

| Column | Style | Notes |
|--------|--------|--------|
| 1 | **Current** | From `icon-previous/app-icon.png` (saved before any experiment) |
| 2 | **tone** | Risograph halftone, stipple dots, cream paper |
| 3 | **PixelPot** | Soft 3D clay, sage background, matte tactile objects |
| 4 | **DayCity** | Isometric vector, blue/white, architectural miniatures |
| 5 | **Passage** | Navy square, circular lens/aperture, photo inside, map pin |

Use the user’s reference sheet (four sample icons in one row) as the visual target for those four columns.

## Agent steps

1. **Back up** — Copy `app-icon.png` (and `app-icon.svg` if present) to `your-app/icon-previous/`. Do not overwrite `icon-previous` if it already holds the true original.
2. **Generate options** — Create **180×180 PNGs** (full-bleed, no text, no phone mockup):
   - `your-app/icon-options/tone.png`
   - `your-app/icon-options/pixelpot.png`
   - `your-app/icon-options/daycity.png`
   - `your-app/icon-options/passage.png`  
   Subject = one clear metaphor for **that app** (read `apps.json` name/subtitle). If two apps would look alike (e.g. Focus checklist vs Our Lists), change the **object**, not just the style.
3. **Export** — Run:
   ```bash
   ./scripts/export-icon-style-options.sh your-app-id
   # multiple apps in one sheet:
   ./scripts/export-icon-style-options.sh habit-journal shared-lists
   ```
   Default output: `/opt/cursor/artifacts/icon-style-options.png` — attach this image in the chat for the user to circle picks.
4. **Wait** — No `versions.json` bump, no PR, no change to `app-icon.png` until the user names choices (e.g. “Coffee: tone, Lists: PixelPot”).
5. **Apply** — Copy the chosen file to `app-icon.png`, bump that app in `versions.json`, commit, open PR. Keep `icon-previous/` for revert.

## What not to commit (by default)

These paths are gitignored so option grids do not land in PRs:

- `**/icon-options/`
- `**/icon-style-comparison.png`

Only commit `icon-previous/` when applying a final icon (revert path), and commit the new `app-icon.png` after the user chooses.

## Related

- Home Screen PNG requirements: [ADD_APP.md](../ADD_APP.md), [add-app skill](../cursor-user-skills/add-app/SKILL.md)
- Rasterize from SVG: `./scripts/rasterize-app-icon.sh your-app`
