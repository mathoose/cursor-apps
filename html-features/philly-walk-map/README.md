# Philly walking map

Shared map box for apps used while walking around Philadelphia. Coffee Map and Philly Dates load `philly-walk-map.js` so they stay on the same streets.

## Status

### Approved

- Walking box: **Navy Yard** (south) → **Fishtown / Olde Kensington** (north)
- West through **45th St**; east of the river (**not Camden**)
- Includes **Brewerytown** around the Art Museum and the full **Navy Yard**
- Leaflet OSM tiles + `maxBounds` helper
- Older hand-drawn Philly Dates art stays at [`philly-dates/city-map.svg`](../../philly-dates/city-map.svg) (archive only; not shown in the UI)

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
