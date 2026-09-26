(function () {
  "use strict";

  var STORAGE_KEY = "city-axes-v1";
  var BLOCK_M = 137;
  var WALK_M_PER_MIN = 80;
  var MI = 1609.344;

  // Broad & Market, fitted to OpenStreetMap centerlines.
  // Market runs about 9.2° south of east. Broad is perpendicular, about 9.3° east of north.
  var ORIGIN = { lat: 39.952374, lng: -75.163512 };
  var X_HAT = { e: 0.9870662022149217, n: -0.16031316990506841 };
  var Y_HAT = { e: 0.16107802812148986, n: 0.9869416744957589 };
  var M_PER_DEG_LAT = 111320;
  var M_PER_DEG_LNG = 111320 * Math.cos(ORIGIN.lat * Math.PI / 180);

  var LANDMARKS = [
    { id: "city-hall", name: "City Hall", neighborhood: "Center City", lat: 39.952374, lng: -75.163512 },
    { id: "reading-terminal", name: "Reading Terminal Market", neighborhood: "Market East", lat: 39.95334, lng: -75.15955 },
    { id: "30th-st", name: "30th Street Station", neighborhood: "University City", lat: 39.95564, lng: -75.18198 },
    { id: "art-museum", name: "Art Museum", neighborhood: "Fairmount", lat: 39.96563, lng: -75.181 },
    { id: "logan-circle", name: "Logan Circle", neighborhood: "Parkway", lat: 39.9578, lng: -75.1708 },
    { id: "rittenhouse", name: "Rittenhouse Square", neighborhood: "Rittenhouse", lat: 39.94957, lng: -75.17185 },
    { id: "independence", name: "Independence Hall", neighborhood: "Old City", lat: 39.94889, lng: -75.15004 },
    { id: "washington-sq", name: "Washington Square", neighborhood: "Washington Square", lat: 39.947, lng: -75.1524 },
    { id: "penns-landing", name: "Penn's Landing", neighborhood: "Delaware waterfront", lat: 39.9456, lng: -75.1412 },
    { id: "broad-south", name: "Broad & South", neighborhood: "South Street", lat: 39.94295, lng: -75.16545 },
    { id: "italian-market", name: "Italian Market", neighborhood: "Bella Vista", lat: 39.9377, lng: -75.1584 },
    { id: "queen-village", name: "Queen Village", neighborhood: "Queen Village", lat: 39.9368, lng: -75.1485 },
    { id: "pennsport", name: "Pennsport", neighborhood: "Pennsport", lat: 39.9258, lng: -75.149 },
    { id: "grad-hospital", name: "Graduate Hospital", neighborhood: "Graduate Hospital", lat: 39.9436, lng: -75.1735 },
    { id: "stadiums", name: "Stadiums", neighborhood: "South Philadelphia", lat: 39.9012, lng: -75.172 },
    { id: "navy-yard", name: "Navy Yard", neighborhood: "Navy Yard", lat: 39.8895, lng: -75.174 },
    { id: "fdr", name: "FDR Park", neighborhood: "South Philadelphia", lat: 39.8995, lng: -75.186 },
    { id: "penn", name: "Penn", neighborhood: "University City", lat: 39.9522, lng: -75.1932 },
    { id: "eastern-state", name: "Eastern State", neighborhood: "Fairmount", lat: 39.9684, lng: -75.1727 },
    { id: "brewerytown", name: "Brewerytown", neighborhood: "Brewerytown", lat: 39.9745, lng: -75.181 },
    { id: "broad-girard", name: "Broad & Girard", neighborhood: "Francisville", lat: 39.9722, lng: -75.1596 },
    { id: "temple", name: "Temple University", neighborhood: "North Philadelphia", lat: 39.9812, lng: -75.1554 },
    { id: "nolibs", name: "Northern Liberties", neighborhood: "Northern Liberties", lat: 39.9675, lng: -75.1425 },
    { id: "fishtown", name: "Fishtown", neighborhood: "Fishtown", lat: 39.9692, lng: -75.134 }
  ];

  var ZONE_PALETTE = [
    "#dbeafe", "#dcfce7", "#fce7f3", "#fef3c7", "#e0e7ff", "#ffedd5",
    "#ccfbf1", "#fae8ff", "#fee2e2", "#ecfccb", "#cffafe", "#f3e8ff",
    "#fed7aa", "#d1fae5", "#e2e8f0", "#fde68a", "#fbcfe8", "#bfdbfe"
  ];

  var NEIGHBORHOOD_ZONES = (function () {
    var seen = {};
    var out = [];
    LANDMARKS.forEach(function (lm) {
      var name = lm.neighborhood || lm.name;
      if (seen[name]) return;
      seen[name] = true;
      out.push({
        name: name,
        lat: lm.lat,
        lng: lm.lng,
        radiusM: 780,
        color: ZONE_PALETTE[out.length % ZONE_PALETTE.length]
      });
    });
    return out;
  })();

  var SOURCE_LABEL = { landmark: "Landmark", cafe: "Cafe", date: "Date" };
  var SOURCE_COLOR = { landmark: "#14532d", cafe: "#c2410c", date: "#9f1239" };

  var state = {
    mode: "start",
    xFirst: true,
    start: null,
    end: null,
    locating: false,
    layers: { landmarks: true, cafes: false, dates: false },
    query: ""
  };

  var catalog = [];
  var byId = {};
  var savedRaw = null;
  var slotTouched = { start: false, end: false };
  var map = null;
  var tileLayer = null;
  var tileSourceIndex = 0;
  var tileErrorCount = 0;
  var basemapLayer = null;
  var axisLayer = null;
  var tickLayer = null;
  var neighborhoodLayer = null;
  var routeLayer = null;

  var MAP_TILE_URLS = [
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    "https://maps.wikimedia.org/osm-intl/{z}/{x}/{y}.png"
  ];
  var pinGroups = {};
  var ignoreMapClickUntil = 0;
  var toastTimer = null;
  var framedKey = "";

  var sheet = document.getElementById("sheet");
  var hereBtn = document.getElementById("hereBtn");
  var hereBtnLabel = document.getElementById("hereBtnLabel");
  var searchInput = document.getElementById("searchInput");
  var resultsEl = document.getElementById("results");
  var live = document.getElementById("live");

  function inRegion(lat, lng) {
    if (typeof PhillyWalkMap !== "undefined" && PhillyWalkMap.contains) {
      return PhillyWalkMap.contains(lat, lng);
    }
    return lat >= 39.878 && lat <= 39.992 && lng >= -75.222 && lng <= -75.114;
  }

  function fromEN(eastM, northM) {
    return {
      lat: ORIGIN.lat + northM / M_PER_DEG_LAT,
      lng: ORIGIN.lng + eastM / M_PER_DEG_LNG
    };
  }

  function toXY(lat, lng) {
    var east = (lng - ORIGIN.lng) * M_PER_DEG_LNG;
    var north = (lat - ORIGIN.lat) * M_PER_DEG_LAT;
    return {
      x: east * X_HAT.e + north * X_HAT.n,
      y: east * Y_HAT.e + north * Y_HAT.n
    };
  }

  function fromXY(xM, yM) {
    return fromEN(xM * X_HAT.e + yM * Y_HAT.e, xM * X_HAT.n + yM * Y_HAT.n);
  }

  function round1(n) {
    return Math.round(n * 10) / 10;
  }

  function formatBlocks(n) {
    var v = Math.round(Math.abs(n) * 10) / 10;
    var s = v.toFixed(1);
    if (s.slice(-2) === ".0") s = s.slice(0, -2);
    return s;
  }

  function blocksLabel(n) {
    var s = formatBlocks(n);
    var v = parseFloat(s, 10);
    return s + (v === 1 ? " block" : " blocks");
  }

  function formatSigned(n) {
    var v = round1(n);
    if (Math.abs(v) < 0.05) return "0";
    return (v > 0 ? "+" : "\u2212") + formatBlocks(v);
  }

  function formatDist(meters) {
    var miles = meters / MI;
    if (miles >= 0.1) return miles.toFixed(miles >= 10 ? 1 : 2) + " mi";
    var feet = Math.round((meters * 3.28084) / 10) * 10;
    return feet + " ft";
  }

  function blocksOf(lat, lng) {
    var xy = toXY(lat, lng);
    return { x: round1(xy.x / BLOCK_M), y: round1(xy.y / BLOCK_M), raw: xy };
  }

  function sideWords(xB, yB) {
    var x = Math.abs(xB) < 0.05
      ? "on Broad"
      : formatBlocks(xB) + " blocks " + (xB > 0 ? "east" : "west") + " of Broad";
    var y = Math.abs(yB) < 0.05
      ? "on Market"
      : formatBlocks(yB) + " blocks " + (yB > 0 ? "north" : "south") + " of Market";
    return x + " \u00b7 " + y;
  }

  function toast(msg) {
    var el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 2800);
  }

  function sheetHeight() {
    return sheet ? sheet.offsetHeight : 280;
  }

  function syncSheetHeight() {
    var h = sheetHeight();
    document.documentElement.style.setProperty("--sheet-h", h + "px");
  }

  function readSaved() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var p = JSON.parse(raw);
      if (!p || typeof p !== "object") return null;
      return p;
    } catch (e) {
      return null;
    }
  }

  function persistable(pt) {
    if (!pt || pt.kind === "here") return null;
    if (pt.kind === "place" && pt.id) return { kind: "place", id: pt.id };
    if (pt.kind === "pin" && isFinite(pt.lat) && isFinite(pt.lng)) {
      return { kind: "pin", lat: pt.lat, lng: pt.lng };
    }
    return null;
  }

  function save() {
    var start = persistable(state.start);
    var end = persistable(state.end);
    var layersDefault = state.layers.landmarks && !state.layers.cafes && !state.layers.dates;
    if (!start && !end && state.xFirst && layersDefault) {
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
      return;
    }
    var payload = {
      version: 1,
      xFirst: !!state.xFirst,
      start: start,
      end: end,
      layers: {
        landmarks: !!state.layers.landmarks,
        cafes: !!state.layers.cafes,
        dates: !!state.layers.dates
      }
    };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(payload)); } catch (e) { /* ignore */ }
  }

  function materialize(saved) {
    if (!saved || typeof saved !== "object") return null;
    if (saved.kind === "pin" && isFinite(saved.lat) && isFinite(saved.lng) && inRegion(saved.lat, saved.lng)) {
      return { kind: "pin", lat: saved.lat, lng: saved.lng, label: "Dropped pin" };
    }
    if (saved.kind === "place" && saved.id && byId[saved.id]) return pointFromPlace(byId[saved.id]);
    return null;
  }

  function applySaved() {
    if (!savedRaw) return;
    if (!slotTouched.start && !state.start) {
      var start = materialize(savedRaw.start);
      if (start) state.start = start;
    }
    if (!slotTouched.end && !state.end) {
      var end = materialize(savedRaw.end);
      if (end) state.end = end;
    }
  }

  function pointFromPlace(p) {
    return {
      kind: "place",
      id: p.id,
      lat: p.lat,
      lng: p.lng,
      label: p.name,
      source: p.source
    };
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function setMode(mode) {
    state.mode = mode === "end" ? "end" : "start";
    renderSheet();
  }

  function setSlot(slot, point) {
    if (point && !inRegion(point.lat, point.lng)) {
      toast("That spot is outside this Philadelphia region.");
      return;
    }
    slotTouched[slot] = true;
    state[slot] = point;
    if (point && slot === "start" && !state.end) setMode("end");
    else if (point && slot === "end" && !state.start) setMode("start");
    save();
    renderSheet();
    renderRoute(true);
    if (live) {
      var text = document.getElementById("dirLine");
      live.textContent = text && !document.getElementById("change").hidden ? text.textContent : "";
    }
  }

  function clearSlot(slot) {
    slotTouched[slot] = true;
    state[slot] = null;
    save();
    renderSheet();
    renderRoute(false);
    if (!state.start && !state.end) fitRegion(true);
  }

  function clearAll() {
    slotTouched.start = true;
    slotTouched.end = true;
    state.start = null;
    state.end = null;
    state.mode = "start";
    framedKey = "";
    searchInput.value = "";
    state.query = "";
    renderResults();
    save();
    renderSheet();
    renderRoute(false);
    fitRegion(true);
    toast("Cleared — tap the map for a new start");
  }

  function fitRegion(animate) {
    if (!map || typeof PhillyWalkMap === "undefined") return;
    var padBottom = sheetHeight() + 24;
    map.fitBounds(PhillyWalkMap.latLngBounds(), {
      paddingTopLeft: [20, 76],
      paddingBottomRight: [20, padBottom],
      maxZoom: 12,
      animate: !!animate
    });
  }

  function mapViewValid() {
    if (!map || typeof PhillyWalkMap === "undefined") return false;
    var c = map.getCenter();
    var z = map.getZoom();
    if (!c || !isFinite(c.lat) || !isFinite(c.lng) || !isFinite(z) || z < PhillyWalkMap.minZoom) {
      return false;
    }
    return PhillyWalkMap.contains(c.lat, c.lng);
  }

  function ensureMapView() {
    if (!map || typeof PhillyWalkMap === "undefined") return;
    if (mapViewValid()) return;
    map.setView(
      [PhillyWalkMap.center.lat, PhillyWalkMap.center.lng],
      PhillyWalkMap.defaultZoom,
      { animate: false }
    );
  }

  function attachTileLayer(urlIndex) {
    if (!map || typeof L === "undefined") return;
    tileSourceIndex = urlIndex;
    tileErrorCount = 0;
    if (tileLayer) {
      map.removeLayer(tileLayer);
      tileLayer = null;
    }
    var url = MAP_TILE_URLS[urlIndex];
    tileLayer = L.tileLayer(url, {
      maxZoom: 19,
      subdomains: url.indexOf("{s}") >= 0 ? "abc" : "",
      attribution: "&copy; OpenStreetMap",
      crossOrigin: true
    });
    tileLayer.on("tileerror", function () {
      tileErrorCount += 1;
      if (tileErrorCount >= 4 && tileSourceIndex + 1 < MAP_TILE_URLS.length) {
        attachTileLayer(tileSourceIndex + 1);
        toast("Map tiles: trying alternate source\u2026");
      }
    });
    tileLayer.addTo(map);
  }

  function drawVectorBasemap() {
    if (!basemapLayer || !map) return;
    basemapLayer.clearLayers();
    if (typeof PhillyWalkMap === "undefined") return;
    var b = PhillyWalkMap.bounds;
    var region = [
      [b.south, b.west],
      [b.south, b.east],
      [b.north, b.east],
      [b.north, b.west]
    ];
    L.polygon(region, {
      color: "rgba(255,255,255,0.55)",
      weight: 1,
      fillColor: "#e8f0eb",
      fillOpacity: 1,
      interactive: false,
      pane: "vectorBasemapPane"
    }).addTo(basemapLayer);

    var renderer = L.canvas({ padding: 0.5 });
    var gridStyle = {
      color: "rgba(20, 36, 27, 0.13)",
      weight: 1,
      opacity: 1,
      interactive: false,
      renderer: renderer,
      pane: "vectorBasemapPane"
    };
    var block;
    for (block = -55; block <= 55; block++) {
      var xM = block * BLOCK_M;
      var a = fromXY(xM, -55 * BLOCK_M);
      var c = fromXY(xM, 55 * BLOCK_M);
      L.polyline([[a.lat, a.lng], [c.lat, c.lng]], gridStyle).addTo(basemapLayer);
      var yM = block * BLOCK_M;
      var d = fromXY(-55 * BLOCK_M, yM);
      var e = fromXY(55 * BLOCK_M, yM);
      L.polyline([[d.lat, d.lng], [e.lat, e.lng]], gridStyle).addTo(basemapLayer);
    }
  }

  function syncMapView(animate) {
    if (!map) return;
    map.invalidateSize(true);
    ensureMapView();
    drawVectorBasemap();
    drawAxes();
    if (state.start && state.end) frameRoute();
    else if (state.start || state.end) frameRoute();
    else fitRegion(animate !== false);
    ensureMapView();
  }

  function scheduleMapRefresh() {
    if (!map) return;
    syncMapView(false);
    setTimeout(function () { syncMapView(false); }, 80);
    setTimeout(function () { syncMapView(false); }, 350);
  }

  function setSheetCollapsed(collapsed) {
    document.body.classList.toggle("sheet-collapsed", collapsed);
    var btn = document.getElementById("sheetToggle");
    if (btn) {
      btn.textContent = collapsed ? "Show panel" : "More map";
      btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
    }
    syncSheetHeight();
    if (map) {
      requestAnimationFrame(function () {
        scheduleMapRefresh();
      });
    }
  }

  function swapSlots() {
    slotTouched.start = true;
    slotTouched.end = true;
    var tmp = state.start;
    state.start = state.end;
    state.end = tmp;
    save();
    renderSheet();
    renderRoute(true);
  }

  function cardinalDir(blocks, axis) {
    if (axis === "x") return blocks > 0 ? "east" : "west";
    return blocks > 0 ? "north" : "south";
  }

  function axisLandmark(blocks, axis, startYBlocks) {
    if (Math.abs(blocks) < 0.05) return null;
    if (axis === "x") {
      return blocks > 0 ? "towards the Delaware River" : "towards the Schuylkill";
    }
    if (blocks > 0) {
      return startYBlocks < 0 ? "towards City Hall" : "towards North Philadelphia";
    }
    return startYBlocks > 0 ? "towards City Hall" : "towards South Philadelphia";
  }

  function shiftWords(blocks, axis, startYBlocks) {
    if (Math.abs(blocks) < 0.05) {
      return axis === "x" ? "no east\u2013west shift" : "no north\u2013south shift";
    }
    var card = axis === "x" ? ("to the " + cardinalDir(blocks, "x")) : cardinalDir(blocks, "y");
    var land = axisLandmark(blocks, axis, startYBlocks);
    return land ? card + " \u00b7 " + land : card;
  }

  function travelSummary(dx, dy) {
    var parts = [];
    if (Math.abs(dy) >= 0.05) {
      parts.push(cardinalDir(dy, "y") + " " + blocksLabel(dy));
    }
    if (Math.abs(dx) >= 0.05) {
      var ew = cardinalDir(dx, "x") + " " + blocksLabel(dx);
      if (parts.length) ew = "and to the " + ew;
      else ew = "to the " + ew;
      parts.push(ew);
    }
    return parts.join(" ");
  }

  function capitalizeWord(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  function movementPoetry(dx, dy, startYBlocks) {
    var lines = [];
    if (Math.abs(dy) >= 0.05) {
      var yLand = axisLandmark(dy, "y", startYBlocks);
      lines.push(capitalizeWord(cardinalDir(dy, "y")) + (yLand ? " · " + yLand : ""));
    }
    if (Math.abs(dx) >= 0.05) {
      var xLand = axisLandmark(dx, "x", startYBlocks);
      var bit = "To the " + cardinalDir(dx, "x") + " · across Broad from where you are";
      if (xLand) bit += " · " + xLand;
      lines.push(bit);
    }
    return lines.join("\n");
  }

  function landmarkSummary(dx, dy, startYBlocks) {
    var parts = [];
    if (Math.abs(dy) >= 0.05) {
      var yLand = axisLandmark(dy, "y", startYBlocks);
      if (yLand) parts.push(yLand);
    }
    if (Math.abs(dx) >= 0.05) {
      var xLand = axisLandmark(dx, "x", startYBlocks);
      if (xLand) parts.push(xLand);
    }
    return parts.join(" and ");
  }

  function orderedLegPhrase(blocks, axis, startYBlocks) {
    if (Math.abs(blocks) < 0.05) return null;
    var card = axis === "x" ? ("to the " + cardinalDir(blocks, "x")) : cardinalDir(blocks, "y");
    var land = axisLandmark(blocks, axis, startYBlocks);
    var meters = Math.abs(blocks) * BLOCK_M;
    var dist = blocksLabel(blocks) + " (" + formatDist(meters) + ")";
    return card + " " + dist + (land ? " \u00b7 " + land : "");
  }

  function describeChange(a, b, opts) {
    opts = opts || {};
    var A = blocksOf(a.lat, a.lng);
    var B = blocksOf(b.lat, b.lng);
    var dx = round1(B.x - A.x);
    var dy = round1(B.y - A.y);
    var summary = travelSummary(dx, dy);
    var landmarks = landmarkSummary(dx, dy, A.y);
    var xLeg = orderedLegPhrase(dx, "x", A.y);
    var yLeg = orderedLegPhrase(dy, "y", A.y);
    var xFirst = typeof opts.xFirst === "boolean" ? opts.xFirst : state.xFirst;
    var first = xFirst ? xLeg : yLeg;
    var second = xFirst ? yLeg : xLeg;
    var sentence;
    if (summary && landmarks) {
      sentence = "Go " + summary + " \u2014 " + landmarks + ".";
    } else if (summary) {
      sentence = "Go " + summary + ".";
    } else if (first && second) {
      sentence = "Go " + first + ", then " + second + ".";
    } else if (first || second) {
      sentence = "Go " + (first || second) + ".";
    } else {
      sentence = "You are already on the same grid point.";
    }
    var gridM = (Math.abs(dx) + Math.abs(dy)) * BLOCK_M;
    var straight = (typeof PhillyWalkMap !== "undefined" && PhillyWalkMap.haversineMeters)
      ? PhillyWalkMap.haversineMeters(a.lat, a.lng, b.lat, b.lng)
      : Math.hypot(B.raw.x - A.raw.x, B.raw.y - A.raw.y);
    var pace = (typeof PhillyWalkMap !== "undefined" && PhillyWalkMap.WALK_M_PER_MIN) || WALK_M_PER_MIN;
    var minutes = Math.round(gridM / pace);
    var time = minutes < 1 ? "under a minute" : "about " + minutes + " min";
    var meta = formatDist(gridM) + " on the two shifts \u00b7 " + time + " \u00b7 " + formatDist(straight) + " straight";
    return { dx: dx, dy: dy, sentence: sentence, meta: meta };
  }

  function cornerOf(a, b, xFirst) {
    var A = toXY(a.lat, a.lng);
    var B = toXY(b.lat, b.lng);
    var xf = typeof xFirst === "boolean" ? xFirst : state.xFirst;
    return xf ? fromXY(B.x, A.y) : fromXY(A.x, B.y);
  }

  function fillPointBody(el, slot, point) {
    var k = slot === "start" ? "Start" : "End";
    if (!point) {
      el.innerHTML = '<span class="point-k">' + k + "</span>" +
        '<span class="point-name">' + (slot === state.mode ? "Tap the map" : "Not set") + "</span>" +
        '<span class="point-words">Search, tap a pin, or use Where am I for the start.</span>';
      return;
    }
    var b = blocksOf(point.lat, point.lng);
    el.innerHTML = '<span class="point-k">' + k + "</span>" +
      '<span class="point-name">' + esc(point.label) + "</span>" +
      '<span class="point-xy">(x, y) = (' + formatSigned(b.x) + ", " + formatSigned(b.y) + ")</span>" +
      '<span class="point-words">' + esc(sideWords(b.x, b.y)) + "</span>";
  }

  function renderSheet() {
    document.getElementById("modeStart").classList.toggle("on", state.mode === "start");
    document.getElementById("modeEnd").classList.toggle("on", state.mode === "end");
    document.getElementById("modeStart").setAttribute("aria-selected", state.mode === "start" ? "true" : "false");
    document.getElementById("modeEnd").setAttribute("aria-selected", state.mode === "end" ? "true" : "false");
    document.getElementById("startPoint").classList.toggle("on", state.mode === "start");
    document.getElementById("endPoint").classList.toggle("on", state.mode === "end");
    fillPointBody(document.getElementById("startBody"), "start", state.start);
    fillPointBody(document.getElementById("endBody"), "end", state.end);
    document.getElementById("startClear").hidden = !state.start;
    document.getElementById("endClear").hidden = !state.end;
    document.getElementById("orderX").classList.toggle("on", state.xFirst);
    document.getElementById("orderY").classList.toggle("on", !state.xFirst);
    searchInput.placeholder = state.mode === "start" ? "Search a start" : "Search an end";

    var change = document.getElementById("change");
    if (state.start && state.end) {
      var d = describeChange(state.start, state.end);
      document.getElementById("dxN").textContent = formatSigned(d.dx);
      document.getElementById("dyN").textContent = formatSigned(d.dy);
      var startBlocks = blocksOf(state.start.lat, state.start.lng);
      var endBlocks = blocksOf(state.end.lat, state.end.lng);
      document.getElementById("dxW").textContent = shiftWords(d.dx, "x", startBlocks.y);
      document.getElementById("dyW").textContent = shiftWords(d.dy, "y", startBlocks.y);
      document.getElementById("dirLine").textContent = d.sentence;
      document.getElementById("metaLine").textContent = d.meta;
      var transformEl = document.getElementById("transformLine");
      if (transformEl) {
        transformEl.textContent =
          "(x, y) = (" + formatSigned(startBlocks.x) + ", " + formatSigned(startBlocks.y) + ") \u2192 (" +
          formatSigned(endBlocks.x) + ", " + formatSigned(endBlocks.y) + ")  \u00b7  " +
          movementPoetry(d.dx, d.dy, startBlocks.y).replace(/\n/g, "  \u00b7  ");
        transformEl.hidden = false;
      }
      change.hidden = false;
      if (sheet) sheet.scrollTop = 0;
    } else {
      change.hidden = true;
      var transformElOff = document.getElementById("transformLine");
      if (transformElOff) transformElOff.hidden = true;
    }
    syncChips();
    var clearAllBtn = document.getElementById("clearAllBtn");
    if (clearAllBtn) clearAllBtn.disabled = !state.start && !state.end;
    var exportBtn = document.getElementById("exportCardBtn");
    if (exportBtn) exportBtn.hidden = !(state.start && state.end);
    requestAnimationFrame(syncSheetHeight);
  }

  function syncChips() {
    var mapChips = [
      ["layerLandmarks", state.layers.landmarks],
      ["layerCafes", state.layers.cafes],
      ["layerDates", state.layers.dates]
    ];
    mapChips.forEach(function (pair) {
      var el = document.getElementById(pair[0]);
      el.classList.toggle("on", pair[1]);
      el.setAttribute("aria-pressed", pair[1] ? "true" : "false");
    });
  }

  function markerIcon(className, html) {
    return L.divIcon({
      className: className,
      html: html,
      iconSize: [36, 18],
      iconAnchor: [18, 9]
    });
  }

  function ray(hat, sign) {
    var pts = [];
    var d;
    for (d = 40; d <= 20000; d += 40) {
      var ll = fromEN(hat.e * d * sign, hat.n * d * sign);
      if (!inRegion(ll.lat, ll.lng)) break;
      pts.push([ll.lat, ll.lng]);
    }
    return pts;
  }

  function drawAxes() {
    if (!axisLayer) return;
    axisLayer.clearLayers();
    var market = ray(X_HAT, -1).reverse().concat([[ORIGIN.lat, ORIGIN.lng]], ray(X_HAT, 1));
    var broad = ray(Y_HAT, -1).reverse().concat([[ORIGIN.lat, ORIGIN.lng]], ray(Y_HAT, 1));
    function stroke(latlngs, color) {
      L.polyline(latlngs, { color: "#ffffff", weight: 7, opacity: 0.9, interactive: false }).addTo(axisLayer);
      L.polyline(latlngs, { color: color, weight: 3.5, opacity: 0.95, interactive: false }).addTo(axisLayer);
    }
    stroke(market, "#15803d");
    stroke(broad, "#1d4ed8");

    L.circleMarker([ORIGIN.lat, ORIGIN.lng], {
      radius: 7,
      color: "#14532d",
      weight: 3,
      fillColor: "#ffffff",
      fillOpacity: 1,
      interactive: false
    }).addTo(axisLayer);

    L.marker(fromXY(15 * BLOCK_M, 2.4 * BLOCK_M), {
      interactive: false,
      icon: markerIcon("axis-tag market", "<span>x Market</span>")
    }).addTo(axisLayer);
    L.marker(fromXY(2.6 * BLOCK_M, 15 * BLOCK_M), {
      interactive: false,
      icon: markerIcon("axis-tag broad", "<span>y Broad</span>")
    }).addTo(axisLayer);

    var eastEnd = ray(X_HAT, 1);
    var northEnd = ray(Y_HAT, 1);
    if (eastEnd.length) {
      L.marker(eastEnd[eastEnd.length - 1], {
        interactive: false,
        icon: L.divIcon({
          className: "axis-arrow market",
          html: '<span style="transform:rotate(9deg);display:block">\u2192</span>',
          iconSize: [24, 24],
          iconAnchor: [12, 12]
        })
      }).addTo(axisLayer);
    }
    if (northEnd.length) {
      L.marker(northEnd[northEnd.length - 1], {
        interactive: false,
        icon: L.divIcon({
          className: "axis-arrow broad",
          html: '<span style="transform:rotate(9deg);display:block">\u2191</span>',
          iconSize: [24, 24],
          iconAnchor: [12, 12]
        })
      }).addTo(axisLayer);
    }

    drawTicks();
  }

  function tickStepForZoom() {
    if (!map) return 10;
    var z = map.getZoom();
    if (z >= 15) return 5;
    if (z >= 13) return 10;
    return 20;
  }

  function drawTicks() {
    if (!tickLayer || !map) return;
    tickLayer.clearLayers();
    var step = tickStepForZoom();
    var b;
    addTick(0, 0, "origin");
    for (b = -80; b <= 80; b += step) {
      if (b === 0) continue;
      addTick(b, 0, "x");
      addTick(0, b, "y");
    }
  }

  function tickSegment(xBlocks, yBlocks, axis) {
    var cx = xBlocks * BLOCK_M;
    var cy = yBlocks * BLOCK_M;
    var half = 28;
    if (axis === "origin") return null;
    if (axis === "x") {
      return [fromXY(cx, cy - half), fromXY(cx, cy + half)];
    }
    return [fromXY(cx - half, cy), fromXY(cx + half, cy)];
  }

  function addTick(xBlocks, yBlocks, axis) {
    var ll = fromXY(xBlocks * BLOCK_M, yBlocks * BLOCK_M);
    if (!inRegion(ll.lat, ll.lng) && axis !== "origin") return;
    if (axis === "origin") {
      var seg0 = tickSegment(0, 0, "x");
      if (seg0) {
        L.polyline(seg0, { color: "#14532d", weight: 2, opacity: 0.85, interactive: false }).addTo(tickLayer);
        L.polyline(tickSegment(0, 0, "y"), { color: "#14532d", weight: 2, opacity: 0.85, interactive: false }).addTo(tickLayer);
      }
      L.marker([ORIGIN.lat, ORIGIN.lng], {
        interactive: false,
        icon: L.divIcon({
          className: "axis-tick origin",
          html: "<span>0</span>",
          iconSize: [24, 20],
          iconAnchor: [12, 10]
        })
      }).addTo(tickLayer);
      return;
    }
    var seg = tickSegment(xBlocks, yBlocks, axis);
    if (seg) {
      L.polyline(seg, {
        color: axis === "x" ? "#15803d" : "#1d4ed8",
        weight: 3,
        opacity: 0.9,
        interactive: false
      }).addTo(tickLayer);
    }
    var n = xBlocks || yBlocks;
    var label = (n > 0 ? "+" : "\u2212") + Math.abs(n);
    var anchor = axis === "x" ? [18, 22] : [4, 9];
    L.marker([ll.lat, ll.lng], {
      interactive: false,
      icon: L.divIcon({
        className: "axis-tick" + (axis === "x" ? " market" : " broad"),
        html: "<span>" + label + "</span>",
        iconSize: [36, 18],
        iconAnchor: anchor
      })
    }).addTo(tickLayer);
  }

  function drawNeighborhoods() {
    if (!neighborhoodLayer) return;
    neighborhoodLayer.clearLayers();
    if (typeof PhillyHoods === "undefined" || !PhillyHoods.getLoaded()) return;
    var geo = PhillyHoods.getLoaded();
    var z = map ? map.getZoom() : 13;
    try {
    L.geoJSON(geo, {
      interactive: false,
      style: function (feat) {
        var name = feat.properties && feat.properties.name;
        return {
          color: "rgba(255,255,255,0.75)",
          weight: 1.4,
          fillColor: PhillyHoods.fillForName(name, "other"),
          fillOpacity: z >= 14 ? 0.38 : z >= 12 ? 0.24 : 0.14
        };
      },
      onEachFeature: function (feat, layer) {
        if (z < 13) return;
        var name = feat.properties && feat.properties.name;
        if (!name) return;
        var c = PhillyHoods.labelPointForFeature(feat);
        if (!c) return;
        L.marker([c.lat, c.lng], {
          interactive: false,
          icon: L.divIcon({
            className: "hood-label",
            html: "<span>" + esc(name) + "</span>",
            iconSize: [140, 24],
            iconAnchor: [70, 12]
          })
        }).addTo(neighborhoodLayer);
      }
    }).addTo(neighborhoodLayer);
    } catch (err) {
      console.warn("City Axes: neighborhood layer skipped", err);
    }
  }

  function endpointMarker(point, fill) {
    return L.circleMarker([point.lat, point.lng], {
      radius: 9,
      color: "#ffffff",
      weight: 3,
      fillColor: fill,
      fillOpacity: 1,
      interactive: false
    });
  }

  function renderRoute(fit) {
    if (!routeLayer) return;
    routeLayer.clearLayers();
    if (state.start) endpointMarker(state.start, "#1d4ed8").addTo(routeLayer);
    if (state.end) endpointMarker(state.end, "#c2410c").addTo(routeLayer);
    if (state.start && state.end) {
      var corner = cornerOf(state.start, state.end);
      var A = [state.start.lat, state.start.lng];
      var C = [corner.lat, corner.lng];
      var B = [state.end.lat, state.end.lng];
      L.polyline([A, C], { color: "#ffffff", weight: 10, opacity: 0.95, interactive: false }).addTo(routeLayer);
      L.polyline([C, B], { color: "#ffffff", weight: 10, opacity: 0.95, interactive: false }).addTo(routeLayer);
      L.polyline([A, C], { color: "#c2410c", weight: 5, opacity: 1, interactive: false }).addTo(routeLayer);
      L.polyline([C, B], { color: "#c2410c", weight: 5, opacity: 1, interactive: false }).addTo(routeLayer);
      L.circleMarker(C, {
        radius: 5,
        color: "#ffffff",
        weight: 2,
        fillColor: "#14241b",
        fillOpacity: 1,
        interactive: false
      }).addTo(routeLayer);
    }
    if (fit) frameRoute();
  }

  function frameRoute() {
    if (!map) return;
    var pts = [];
    if (state.start) pts.push([state.start.lat, state.start.lng]);
    if (state.end) pts.push([state.end.lat, state.end.lng]);
    if (state.start && state.end) {
      var corner = cornerOf(state.start, state.end);
      pts.push([corner.lat, corner.lng]);
    }
    var key = pts.map(function (p) { return p[0].toFixed(5) + "," + p[1].toFixed(5); }).join("|") + (state.xFirst ? ":x" : ":y");
    if (key === framedKey) return;
    framedKey = key;
    var padBottom = sheetHeight() + 28;
    if (pts.length >= 2) {
      map.fitBounds(L.latLngBounds(pts), {
        paddingTopLeft: [28, 96],
        paddingBottomRight: [28, padBottom],
        maxZoom: 13,
        animate: true
      });
    } else if (pts.length === 1) {
      var z = Math.min(Math.max(map.getZoom(), 12), 13);
      var projected = map.project(pts[0], z);
      projected.y += (sheetHeight() / 2) - 20;
      map.setView(map.unproject(projected, z), z, { animate: true });
    }
  }

  function drawPinGroup(source) {
    var group = pinGroups[source];
    if (!group) return;
    group.clearLayers();
    if (!state.layers[source === "landmark" ? "landmarks" : source === "cafe" ? "cafes" : "dates"]) return;
    catalog.forEach(function (p) {
      if (p.source !== source) return;
      var pinOpts = {
        fillColor: SOURCE_COLOR[source],
        radius: source === "landmark" ? 9 : 8,
        onClick: function () {
          ignoreMapClickUntil = Date.now() + 450;
          setSlot(state.mode, pointFromPlace(p));
        }
      };
      if (source === "landmark") {
        pinOpts.label = p.neighborhood || p.name;
        pinOpts.labelClass = "city-axes-landmark-label";
      } else if (map && map.getZoom() >= (PhillyWalkMap.labelZoom || 15)) {
        pinOpts.label = p.name;
      }
      var marker = PhillyWalkMap.addCirclePin([p.lat, p.lng], pinOpts);
      if (marker) marker.addTo(group);
    });
  }

  function renderPins() {
    drawPinGroup("landmark");
    drawPinGroup("cafe");
    drawPinGroup("date");
  }

  function rankPlace(p, q) {
    var name = p.name.toLowerCase();
    if (name.indexOf(q) === 0) return 0;
    if (name.indexOf(q) !== -1) return 1;
    return 2;
  }

  function renderResults() {
    var q = state.query.trim().toLowerCase();
    if (!q) {
      resultsEl.hidden = true;
      resultsEl.innerHTML = "";
      return;
    }
    var hits = catalog.filter(function (p) { return p.hay.indexOf(q) !== -1; });
    hits.sort(function (a, b) {
      var d = rankPlace(a, q) - rankPlace(b, q);
      if (d) return d;
      return a.name.localeCompare(b.name);
    });
    hits = hits.slice(0, 8);
    if (!hits.length) {
      resultsEl.hidden = false;
      resultsEl.innerHTML = '<p class="result-meta" style="padding:10px 12px;margin:0">No matches in this region.</p>';
      return;
    }
    resultsEl.hidden = false;
    resultsEl.innerHTML = hits.map(function (p) {
      var meta = SOURCE_LABEL[p.source] + (p.neighborhood ? " \u00b7 " + p.neighborhood : "");
      return '<button type="button" class="result" data-id="' + esc(p.id) + '">' +
        '<span class="result-name">' + esc(p.name) + "</span>" +
        '<span class="result-meta">' + esc(meta) + "</span></button>";
    }).join("");
  }

  function addPlace(raw, source) {
    if (!raw || typeof raw.lat !== "number" || typeof raw.lng !== "number") return;
    if (!inRegion(raw.lat, raw.lng)) return;
    var id = raw.id ? (source + ":" + raw.id) : (source + ":" + catalog.length + ":" + raw.name);
    if (byId[id]) return;
    var place = {
      id: id,
      name: String(raw.name || "Place"),
      neighborhood: raw.neighborhood ? String(raw.neighborhood) : "",
      address: raw.address ? String(raw.address) : "",
      lat: raw.lat,
      lng: raw.lng,
      source: source
    };
    place.hay = (place.name + " " + place.neighborhood + " " + place.address).toLowerCase();
    catalog.push(place);
    byId[id] = place;
  }

  function loadCatalog() {
    LANDMARKS.forEach(function (p) { addPlace(p, "landmark"); });
    applySaved();
    renderPins();
    renderSheet();
    renderRoute(!!(state.start || state.end));

    var hint = document.getElementById("loadHint");
    var cafesP = fetch("../coffee-map/places.json").then(function (r) { return r.ok ? r.json() : []; });
    var datesP = fetch("../philly-dates/places.json").then(function (r) { return r.ok ? r.json() : []; });
    Promise.all([cafesP, datesP]).then(function (pair) {
      (pair[0] || []).forEach(function (p) { addPlace(p, "cafe"); });
      (pair[1] || []).forEach(function (p, i) {
        addPlace({
          id: p.name ? (p.name + "-" + i) : String(i),
          name: p.name,
          neighborhood: p.neighborhood,
          address: p.address,
          lat: p.lat,
          lng: p.lng
        }, "date");
      });
      applySaved();
      renderPins();
      renderSheet();
      renderRoute(!!(state.start || state.end));
      var cafeN = catalog.filter(function (p) { return p.source === "cafe"; }).length;
      var dateN = catalog.filter(function (p) { return p.source === "date"; }).length;
      hint.textContent = cafeN + " cafes and " + dateN + " dates from the other maps, plus landmarks. Turn a layer on to see its pins.";
    }).catch(function () {
      hint.textContent = "Landmarks are ready. Cafes and dates did not load.";
    });
  }

  function locateHere() {
    if (state.locating) return;
    if (typeof PhillyWalkMap === "undefined" || !PhillyWalkMap.locateOnce) {
      toast("Location is not available on this device.");
      return;
    }
    state.locating = true;
    hereBtn.disabled = true;
    hereBtnLabel.textContent = "Finding you\u2026";
    PhillyWalkMap.locateOnce(function (fix) {
      state.locating = false;
      hereBtn.disabled = false;
      hereBtnLabel.textContent = "Where am I";
      if (!inRegion(fix.lat, fix.lng)) {
        toast("You are outside this Philadelphia region.");
        return;
      }
      setSlot("start", { kind: "here", lat: fix.lat, lng: fix.lng, label: "Where I am" });
    }, function (err) {
      state.locating = false;
      hereBtn.disabled = false;
      hereBtnLabel.textContent = "Where am I";
      toast(PhillyWalkMap.locateErrorMessage ? PhillyWalkMap.locateErrorMessage(err) : "Could not get location");
    });
  }

  function buildMap() {
    map = L.map("map", {
      zoomControl: true,
      maxZoom: 19,
      minZoom: PhillyWalkMap.minZoom,
      maxBounds: PhillyWalkMap.panLatLngBounds(),
      maxBoundsViscosity: PhillyWalkMap.maxBoundsViscosity,
      preferCanvas: true
    });
    map.createPane("vectorBasemapPane");
    map.getPane("vectorBasemapPane").style.zIndex = 250;
    attachTileLayer(0);
    map.setView(
      [PhillyWalkMap.center.lat, PhillyWalkMap.center.lng],
      PhillyWalkMap.defaultZoom,
      { animate: false }
    );
    PhillyWalkMap.applyLimits(map);
    PhillyWalkMap.ensurePinPane(map);
    PhillyWalkMap.bindZoomLabels(map);
    basemapLayer = L.layerGroup().addTo(map);
    neighborhoodLayer = L.layerGroup().addTo(map);
    axisLayer = L.layerGroup().addTo(map);
    tickLayer = L.layerGroup().addTo(map);
    routeLayer = L.layerGroup().addTo(map);
    drawNeighborhoods();
    map.on("zoomend", function () {
      drawTicks();
      drawNeighborhoods();
      if (state.layers.landmarks) drawPinGroup("landmark");
    });
    map.whenReady(function () {
      scheduleMapRefresh();
    });
    if (map.zoomControl && map.zoomControl.setPosition) {
      map.zoomControl.setPosition("topright");
    }
    pinGroups.landmark = L.layerGroup().addTo(map);
    pinGroups.cafe = L.layerGroup().addTo(map);
    pinGroups.date = L.layerGroup().addTo(map);
    map.on("click", function (e) {
      if (Date.now() < ignoreMapClickUntil) return;
      setSlot(state.mode, {
        kind: "pin",
        lat: e.latlng.lat,
        lng: e.latlng.lng,
        label: "Dropped pin"
      });
    });
  }

  function bindUi() {
    document.getElementById("modeStart").addEventListener("click", function () { setMode("start"); });
    document.getElementById("modeEnd").addEventListener("click", function () { setMode("end"); });
    document.getElementById("startBody").addEventListener("click", function () { setMode("start"); });
    document.getElementById("endBody").addEventListener("click", function () { setMode("end"); });
    document.getElementById("startClear").addEventListener("click", function () { clearSlot("start"); });
    document.getElementById("endClear").addEventListener("click", function () { clearSlot("end"); });
    document.getElementById("swapBtn").addEventListener("click", swapSlots);
    document.getElementById("clearAllBtn").addEventListener("click", clearAll);
    document.getElementById("sheetToggle").addEventListener("click", function () {
      setSheetCollapsed(!document.body.classList.contains("sheet-collapsed"));
    });
    document.getElementById("orderX").addEventListener("click", function () {
      state.xFirst = true;
      framedKey = "";
      save();
      renderSheet();
      renderRoute(true);
    });
    document.getElementById("orderY").addEventListener("click", function () {
      state.xFirst = false;
      framedKey = "";
      save();
      renderSheet();
      renderRoute(true);
    });
    hereBtn.addEventListener("click", locateHere);
    searchInput.addEventListener("input", function () {
      state.query = searchInput.value;
      renderResults();
    });
    searchInput.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      var first = resultsEl.querySelector(".result");
      if (!first) return;
      e.preventDefault();
      first.click();
    });
    resultsEl.addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest(".result") : null;
      if (!btn) return;
      var place = byId[btn.getAttribute("data-id")];
      if (!place) return;
      searchInput.value = "";
      state.query = "";
      renderResults();
      searchInput.blur();
      setSlot(state.mode, pointFromPlace(place));
    });
    document.getElementById("layerLandmarks").addEventListener("click", function () { toggleLayer("landmarks"); });
    document.getElementById("layerCafes").addEventListener("click", function () { toggleLayer("cafes"); });
    document.getElementById("layerDates").addEventListener("click", function () { toggleLayer("dates"); });
    var exportBtn = document.getElementById("exportCardBtn");
    if (exportBtn) {
      exportBtn.addEventListener("click", function () {
        if (!state.start || !state.end) {
          toast("Set a start and end first");
          return;
        }
        if (typeof CityAxesExport === "undefined") {
          toast("Export is not available");
          return;
        }
        exportBtn.disabled = true;
        toast("Building share image\u2026");
        CityAxesExport.exportCurrentRoute(state).then(function () {
          toast("Direction card saved — check Photos or Downloads");
        }).catch(function () {
          toast("Could not create image");
        }).finally(function () {
          exportBtn.disabled = false;
        });
      });
    }
    if (typeof ResizeObserver !== "undefined") {
      var observer = new ResizeObserver(syncSheetHeight);
      observer.observe(sheet);
    }
    window.addEventListener("resize", syncSheetHeight);
  }

  function toggleLayer(key) {
    state.layers[key] = !state.layers[key];
    save();
    renderSheet();
    var source = key === "landmarks" ? "landmark" : key === "cafes" ? "cafe" : "date";
    drawPinGroup(source);
  }

  function boot() {
    savedRaw = readSaved();
    if (savedRaw) {
      if (typeof savedRaw.xFirst === "boolean") state.xFirst = savedRaw.xFirst;
      if (savedRaw.layers && typeof savedRaw.layers === "object") {
        state.layers.landmarks = savedRaw.layers.landmarks !== false;
        state.layers.cafes = !!savedRaw.layers.cafes;
        state.layers.dates = !!savedRaw.layers.dates;
      }
    }
    if (typeof L === "undefined" || typeof PhillyWalkMap === "undefined") {
      toast("The map could not load. Check your connection and reopen.");
      return;
    }
    buildMap();
    bindUi();
    mountExportShare();
    if (typeof PhillyHoods !== "undefined") {
      PhillyHoods.load().then(function () {
        drawNeighborhoods();
        scheduleMapRefresh();
      });
    }
    loadCatalog();
    renderSheet();
    syncSheetHeight();
    renderRoute(false);
    scheduleMapRefresh();
    window.addEventListener("load", scheduleMapRefresh);
    window.addEventListener("orientationchange", function () {
      setTimeout(scheduleMapRefresh, 200);
    });
    window.addEventListener("pageshow", function (ev) {
      if (ev.persisted) scheduleMapRefresh();
    });
    if (/exportSamples=1/.test(location.search)) runExportSamples();
  }

  function mountExportShare() {
    if (typeof CityAxesExport === "undefined") return;
    CityAxesExport.mount({
      BLOCK_M: BLOCK_M,
      ORIGIN: ORIGIN,
      X_HAT: X_HAT,
      Y_HAT: Y_HAT,
      LANDMARKS: LANDMARKS,
      NEIGHBORHOOD_ZONES: NEIGHBORHOOD_ZONES,
      toXY: toXY,
      fromXY: fromXY,
      blocksOf: blocksOf,
      formatSigned: formatSigned,
      describeChange: describeChange,
      cornerOf: cornerOf,
      movementPoetry: movementPoetry
    });
  }

  function runExportSamples() {
    if (typeof CityAxesExport === "undefined") return;
    mountExportShare();
    var samples = [
      {
        name: "pennsport-to-queen-village",
        start: { label: "Dropped pin", lat: 39.928, lng: -75.152 },
        end: { label: "Queen Village", lat: 39.9368, lng: -75.1485 },
        xFirst: true
      },
      {
        name: "pennsport-to-reading-terminal",
        start: { label: "Pennsport", lat: 39.9258, lng: -75.149 },
        end: { label: "Reading Terminal Market", lat: 39.95334, lng: -75.15955 },
        xFirst: true
      }
    ];
    window.__cityAxesSampleDataUrls = {};
    window.__cityAxesSampleReady = false;
    Promise.all(samples.map(function (s) {
      return CityAxesExport.renderSample(s.name, s.start, s.end, s.xFirst).then(function (canvas) {
        if (canvas) window.__cityAxesSampleDataUrls[s.name] = canvas.toDataURL("image/png");
      });
    })).then(function () {
      window.__cityAxesSampleReady = true;
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
