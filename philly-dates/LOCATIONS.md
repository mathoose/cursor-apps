# Map pin locations (lat/lng)

Happy-hour and bar pins use `lat` / `lng` in `places.json`. Addresses and hours can be refreshed from Google, but **coordinates are only updated by the location sync** (or when you edit them manually).

## Recommended workflow

1. **Best accuracy (118+ places with `googlePlaceId`):**
   ```bash
   export GOOGLE_PLACES_API_KEY=your_key
   cd philly-dates
   node sync-google-locations.js --provider google --threshold 50
   ```
   Uses Google Place Details `location` for each stored Place ID.

2. **Align pins with OSM map labels (restaurant/bar POI nodes):**
   ```bash
   ./scripts/align-all-map-pins.sh
   ```
   Uses `--align-osm` (named `restaurant` / `bar` / `pub` / `cafe` in OpenStreetMap). Updates even small offsets (~3 m) when the POI name matches your catalog.

3. **No API key (OSM Photon, address-based):**
   ```bash
   ./scripts/sync-drink-catalog-locations.sh
   ```
   Or `node philly-dates/sync-google-locations.js --provider photon`. Results are cached in `scripts/location-photon-cache.json`. Moves over **1200 m** are skipped unless you pass `--allow-large-moves` (use Google for those).

   After a bulk photon run, `python3 scripts/reconcile-location-sync.py` can apply manual corrections documented in that script.

3. **After hours refresh:** `fetch-google-hours.js` also updates pins when Google returns `location` (same API call as hours).

`sync-google-locations.js` mirrors `places.json` → `coffee-drinks-map/drinks.json` automatically.

## Verify a fix

- Open Coffee & Drinks or Philly Dates map, zoom to street level, confirm the pin sits on the building.
- Tap **Open in Maps** and compare to the pin.
