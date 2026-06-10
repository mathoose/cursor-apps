# Closet Picker

Wardrobe photo gallery, random outfit picker, seasonal storage bins, and trip outfit calendar. All data stays on your device (localStorage + IndexedDB).

## Live site

- **Production:** https://aruba-pack-emily.netlify.app
- **GitHub Pages:** https://mathoose.github.io/cursor-apps/aruba-packing/

## Features

- **Closet** — add wardrobe photos (camera or import), organize by category
- **Pick** — choose which items go into the randomizer pool; random outfit with swipe-through by category
- **Storage** — pack seasonal clothes into labeled bins (e.g. “yellow bin basement labeled 2”)
- **Travel** — calendar to assign outfits to trip days; packing gallery of unique pieces needed

## iPhone checklist

Open the **HTTPS** URL in Safari (not a local file).

- [ ] **Closet** — tap **+** on a slot → Photo Library → thumbnail appears
- [ ] **Pick** — select items, tap **Random outfit**, use arrows to swap pieces
- [ ] **Storage** — store items in a labeled bin; return to closet when needed
- [ ] **Travel** — assign outfits to days; packing gallery updates
- [ ] Force-close Safari, reopen → photos and data remain
- [ ] **Share → Add to Home Screen** → opens full screen

## Privacy

- Wardrobe metadata: browser `localStorage`
- Photos: browser `IndexedDB` on your phone only — nothing is uploaded

## Local use

Open `index.html` in a browser. For photos on iPhone, use the deployed HTTPS site.
