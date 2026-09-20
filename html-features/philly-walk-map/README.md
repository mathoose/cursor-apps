# Philly walking map

Shared map box for apps used while walking around Philadelphia. Coffee Map and Philly Dates load `philly-walk-map.js` so they stay on the same streets.

## Status

### Approved

- Walking box: **Navy Yard** (south) → **Fishtown / Olde Kensington** (north)
- West through **45th St**; east of the river (**not Camden**)
- Includes **Brewerytown** around the Art Museum and the full **Navy Yard**
- Leaflet OSM tiles + `maxBounds` helper
- One-shot **Where am I** via `attachHereControl` / `locateOnce` (never `watchPosition`; coordinates are not stored)
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

var here = PhillyWalkMap.attachHereControl(map, {
  onChange: function (s) { /* update slider label / dim pins */ },
  onError: function (msg) { /* toast */ }
});
here.locate(); // one GPS fix
here.setMinutes(15); // resize walk circle only
here.clear(); // drop pin + circle
```

`photonBbox()` is the same box for Photon searches. Walk radius uses ~80 m/min (5–25 min slider).

## Source

- [coffee-map/app.js](../../coffee-map/app.js) — map init, seed filter, Photon bbox
- [philly-dates/app.js](../../philly-dates/app.js) — city Leaflet map

## Preview

```bash
open html-features/philly-walk-map/index.html
```
