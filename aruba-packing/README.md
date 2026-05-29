# Aruba Pack — 7 days

Packing list + wardrobe photo grid for Aruba. All data stays on your device (localStorage + IndexedDB).

## Live site

After deploy, your URL will appear here:

- **Production:** https://aruba-pack-emily.netlify.app

## iPhone checklist

Open the **HTTPS** Netlify URL in Safari (not a local file).

- [ ] **List** — check items, change quantities, laundry/repeat toggles
- [ ] **Wardrobe** — tap **+** on a slot → Photo Library → thumbnail appears
- [ ] Take a new photo with the camera (if offered) → saves correctly
- [ ] Tap a photo → **Replace** / **Remove** work
- [ ] Force-close Safari, reopen → photos and checklist remain
- [ ] Change shirt count on List (e.g. 7 → 5) → extra wardrobe slots removed
- [ ] **Share → Add to Home Screen** → opens full screen; photos still work

## Privacy

- Checklist: browser `localStorage`
- Wardrobe photos: browser `IndexedDB` on your phone only — nothing is uploaded to Netlify

## Local use

Open `index.html` in a browser. For photos on iPhone, use the deployed HTTPS site.
