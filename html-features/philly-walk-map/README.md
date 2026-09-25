# Philly walking map

Shared map box **and pins** for apps used while walking around Philadelphia. Coffee Map, Philly Dates, and City Axes load `philly-walk-map.js` + `philly-walk-map.css` so they stay on the same streets and look the same.

## Status

### Approved

- Walking box: a little past the **Navy Yard** (south) → a little past **Fishtown / Olde Kensington** (north)
- West a few blocks past **45th St**; east of the river (**not Camden**)
- Includes **Brewerytown** around the Art Museum and the full **Navy Yard**
- Pan limits are **padded** (~1.8 km) with a soft viscosity so edge pins stay tappable
- Leaflet OSM tiles + `maxBounds` helper
- White-bordered **circle pins**; place names appear at zoom **15+**
- One-shot **Where am I** via `attachHereControl` / `locateOnce` (never `watchPosition`; coordinates are not stored)
- Older hand-drawn Philly Dates art stays at [`philly-dates/city-map.svg`](../../philly-dates/city-map.svg) (archive only; not shown in the UI)

## When to use

Any in-app Philly map the user will use on foot. Load the script and CSS, then call `PhillyWalkMap.applyLimits(map)` and `PhillyWalkMap.fit(map)`.

```html
<link rel="stylesheet" href="../html-features/philly-walk-map/philly-walk-map.css" />
<script src="../html-features/philly-walk-map/philly-walk-map.js"></script>
```

```javascript
map = L.map('map', {
  zoomControl: false,
  maxZoom: 19,
  minZoom: PhillyWalkMap.minZoom,
  maxBounds: PhillyWalkMap.panLatLngBounds(),
  maxBoundsViscosity: PhillyWalkMap.maxBoundsViscosity
});
PhillyWalkMap.addTiles(map);
PhillyWalkMap.applyLimits(map);
PhillyWalkMap.ensurePinPane(map);
PhillyWalkMap.bindZoomLabels(map);
PhillyWalkMap.fit(map);

if (PhillyWalkMap.contains(lat, lng)) { /* keep this pin */ }

var pin = PhillyWalkMap.addCirclePin([lat, lng], {
  fillColor: '#c2410c',
  label: 'Cafe name',
  labelInteractive: true,
  onClick: function () { /* open detail */ }
});
pin.addTo(map);

var here = PhillyWalkMap.attachHereControl(map, {
  onChange: function (s) { /* update slider label / dim pins */ },
  onError: function (msg) { /* toast */ }
});
here.locate(); // one GPS fix
here.setMinutes(15); // resize walk circle only
here.clear(); // drop pin + circle
```

`contains()` / `photonBbox()` use the walking box. `panLatLngBounds()` is a little larger so you can pan past edge pins. Walk radius uses ~80 m/min (5–25 min slider).

## Source

- [coffee-map/app.js](../../coffee-map/app.js) — map init, seed filter, Photon bbox
- [philly-dates/app.js](../../philly-dates/app.js) — city Leaflet map

## Preview

```bash
open html-features/philly-walk-map/index.html
```
