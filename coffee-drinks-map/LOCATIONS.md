# Map pin locations (lat/lng)

Bar, cafe, and restaurant pins live in **`drinks.json`**, **`coffee.json`**, and **`food.json`**. Edit those files (or run the sync scripts below); do not maintain `philly-dates/places.json` or `coffee-map/places.json` — those apps are archived.

## Recommended workflow

1. **Best accuracy (places with `googlePlaceId`):**
   ```bash
   export GOOGLE_PLACES_API_KEY=your_key
   cd philly-dates
   node sync-google-locations.js --provider google --threshold 50
   node sync-google-addresses.js
   node fetch-google-hours.js --catalog drinks
   ```
   Scripts write **`coffee-drinks-map/drinks.json`** (use `--catalog coffee` or `--catalog food` for the other catalogs; `sync-google-locations.js --catalog coffee` updates **`coffee.json`**).

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

## Hours backfill (Google, chunked)

Green/red map pins need a structured **`hours`** object (`Monday` → `open` / `close`). The fetch script fills that from Google **Places API (New)** (`hoursSource: google`).

**Setup:** enable Places API (New) in Google Cloud, create an API key, then:

```bash
export GOOGLE_PLACES_API_KEY=your_key
cd philly-dates
```

**Order:** **food** (largest gap), then **coffee**, then any **drinks** still missing `hoursSource: google`.

Run in batches (~50 places ≈ ~100 API calls). Repeat until few skips:

```bash
node fetch-google-hours.js --catalog food --limit 50
node fetch-google-hours.js --catalog coffee --limit 50
```

Or from the repo root:

```bash
./scripts/fetch-catalog-hours.sh food 50
./scripts/fetch-catalog-hours.sh coffee 50
```

**Optional first pass** (stores `googlePlaceId` so hours fetch can skip text search):

```bash
node sync-google-addresses.js --catalog food --all --limit 50
node sync-google-addresses.js --catalog coffee --all --limit 50
```

Spot fixes: `--only "Restaurant A,Cafe B"` or `--force` to re-fetch.

Coffee pins stuck **grey** with empty `hours: {}` (OSM placeholder): run

```bash
node fetch-google-hours.js --catalog coffee --only-empty --limit 50
```

Repeat until the script reports few skips. Commit updated JSON and open a PR (or merge small PRs per batch).

Billing: pay-per-request with monthly Maps Platform credit; see [Places usage and billing](https://developers.google.com/maps/documentation/places/web-service/usage-and-billing).

## Verify a fix

- Open **Coffee & Drinks**, zoom to street level, confirm the pin sits on the building.
- Tap **Open in Maps** and compare to the pin.
