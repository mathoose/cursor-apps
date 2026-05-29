# Add a new app to this home screen

1. Create a folder: `your-app-name/` with `index.html` inside.
2. Add a **180×180** icon as `your-app-name/app-icon.png` (shows on the launcher).
3. Add an entry to **`apps.json`** (name + subtitle for the label under the icon).
4. Push to `main` — the home page auto-discovers new folders on GitHub Pages.

The launcher lists every folder that contains `index.html`. `apps.json` only customizes the display name.
