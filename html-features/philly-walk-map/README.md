# Philly walking map

Shared map box **and pins** for apps used while walking around Philadelphia. Coffee Map and Philly Dates load `philly-walk-map.js` + `philly-walk-map.css` so they stay on the same streets and look the same.

## Status

### Approved

- Walking box: a little past the **Navy Yard** (south) → a little past **Fishtown / Olde Kensington** (north)
- West a few blocks past **45th St**; east of the river (**not Camden**)
- Includes **Brewerytown** around the Art Museum and the full **Navy Yard**
- Pan limits are **padded** (~1.8 km) with a soft viscosity so edge pins stay tappable
- Leaflet OSM tiles + `maxBounds` helper
- White-bordered **circle pins**; place names appear at zoom **15+**
- One-shot **Where am I** via `createHereSession` / `attachHereControl` / `locateOnce` (never `watchPosition`; coordinates are not stored)
- Shared **`createMap`**, distance helpers (`sortByDistance` / `formatDistance`), and here-button / here-bar CSS (`.philly-here-btn`, `.philly-here-bar`)
- Older hand-drawn Philly Dates art stays at [`philly-dates/city-map.svg`](../../philly-dates/city-map.svg) (archive only; not shown in the UI)

## When to use

Any in-app Philly map the user will use on foot. Load the script and CSS, then call `PhillyWalkMap.createMap(el)` (or the lower-level helpers).

```html
<link rel="stylesheet" href="../html-features/philly-walk-map/philly-walk-map.css" />
<script src="../html-features/philly-walk-map/philly-walk-map.js"></script>
```

```javascript
var map = PhillyWalkMap.createMap(document.getElementById('map'), {
  extraEl: document.getElementById('overlay') // optional zoom-label class target
});
PhillyWalkMap.fit(map);

if (PhillyWalkMap.contains(lat, lng)) { /* keep this pin */ }

var pin = PhillyWalkMap.addCirclePin([lat, lng], {
  fillColor: '#c2410c',
  label: 'Cafe name',
  labelInteractive: true,
  onClick: function () { /* open detail */ }
});
pin.addTo(map);

// Session location (works with or without a map; clear only on explicit Clear)
var here = PhillyWalkMap.createHereSession({
  onChange: function (s) {
    PhillyWalkMap.syncHereButtons(document.getElementById('hereBtn'), s);
    PhillyWalkMap.syncDistanceSortOption(document.getElementById('listSort'), s);
  },
  onError: function (msg) { /* toast */ }
});
here.attachToMap(map); // optional — draws you-pin + walk circle
here.locate();
here.setMinutes(15);
here.clear();

var nearest = PhillyWalkMap.sortByDistance(places, here.getState().lat, here.getState().lng);
PhillyWalkMap.formatDistance(120); // "120 m"
```

`contains()` / `photonBbox()` use the walking box. `panLatLngBounds()` is a little larger so you can pan past edge pins. Walk radius uses ~80 m/min (5–25 min slider).

## Source

- [coffee-map/app.js](../../coffee-map/app.js) — map init, seed filter, Photon bbox, list distance sort
- [philly-dates/app.js](../../philly-dates/app.js) — city Leaflet map, list distance sort

## Preview

```bash
open html-features/philly-walk-map/index.html
```
