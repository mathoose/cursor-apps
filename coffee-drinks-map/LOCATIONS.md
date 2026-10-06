# Map pin locations (lat/lng)

Bar and cafe pins live in **`drinks.json`** and **`coffee.json`**. Edit those files (or run the sync scripts below); do not maintain `philly-dates/places.json` or `coffee-map/places.json` — those apps are archived.

## Recommended workflow

1. **Best accuracy (places with `googlePlaceId`):**
   ```bash
   export GOOGLE_PLACES_API_KEY=your_key
   cd philly-dates
   node sync-google-locations.js --provider google --threshold 50
   node sync-google-addresses.js
   node fetch-google-hours.js
   ```
   Scripts write **`coffee-drinks-map/drinks.json`** (and `sync-google-locations.js --catalog coffee` updates **`coffee.json`**).

2. **Align pins with OSM map labels (restaurant/bar POI nodes):**
   ```bash
   ./scripts/align-all-map-pins.sh
   ```

3. **No API key (OSM Photon, address-based):**
   ```bash
   ./scripts/sync-drink-catalog-locations.sh
   ```
   Results are cached in `scripts/location-photon-cache.json`. Moves over **1200 m** are skipped unless you pass `--allow-large-moves`.

   After a bulk photon run, `python3 scripts/reconcile-location-sync.py` can apply manual corrections documented in that script.

## Verify a fix

- Open **Coffee & Drinks**, zoom to street level, confirm the pin sits on the building.
- Tap **Open in Maps** and compare to the pin.
