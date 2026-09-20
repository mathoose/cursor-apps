# Philly walking map

Shared map box for apps used while walking around Philadelphia. Coffee Map and Philly Dates load `philly-walk-map.js` so they stay on the same streets.

## Status

### Approved

- Walking box: **Oregon Ave** (south) → **Fishtown / Olde Kensington** (north)
- West through **45th St**; east of the river (**not Camden**)
- Includes **Brewerytown** around the Art Museum
- Leaflet OSM tiles + `maxBounds` helper

## When to use

Any in-app Philly map the user will use on foot. Load the script, then call `PhillyWalkMap.applyLimits(map)` and `PhillyWalkMap.fit(map)`.

```html
<script src="../html-features/philly-walk-map/philly-walk-map.js"></script>
```

```javascript
map = L.map('map', { zoomControl: false, maxZoom: 19 });
PhillyWalkMap.addTiles(map);
PhillyWalkMap.applyLimits(map);
PhillyWalkMap.fit(map);

if (PhillyWalkMap.contains(lat, lng)) { /* keep this pin */ }
```

`photonBbox()` is the same box for Photon searches.

## Source

- [coffee-map/app.js](../../coffee-map/app.js) — map init, seed filter, Photon bbox
- [philly-dates/app.js](../../philly-dates/app.js) — city Leaflet map

## Preview

```bash
open html-features/philly-walk-map/index.html
```
