/**
 * Philadelphia neighborhood polygons (OpenDataPhilly, CC BY 4.0 — Robert Cheetham)
 * Clipped to the shared Philly walk region in philly-neighborhoods.geojson.
 */
(function (global) {
  "use strict";

  function geoJsonUrl() {
    var el = document.querySelector("script[src*='philly-hoods.js']");
    if (el && el.src) {
      return el.src.replace(/philly-hoods\.js(\?.*)?$/, "philly-neighborhoods.geojson");
    }
    return "philly-neighborhoods.geojson";
  }

  var loaded = null;
  var loadPromise = null;

  /** Poster-style fills (reference: neighborhood map prints). */
  var HOOD_FILL = {
    default: "#7c83c6",
    water: "#2bb8e8",
    park: "#5cb85c",
    start: "#f59e0b",
    end: "#ea580c",
    other: "#9ca3cf"
  };

  function load() {
    if (loaded) return Promise.resolve(loaded);
    if (loadPromise) return loadPromise;
    loadPromise = fetch(geoJsonUrl())
      .then(function (r) {
        if (!r.ok) throw new Error("Could not load neighborhoods");
        return r.json();
      })
      .then(function (geo) {
        loaded = geo;
        return geo;
      })
      .catch(function () {
        loaded = { type: "FeatureCollection", features: [] };
        return loaded;
      });
    return loadPromise;
  }

  function ringsOf(feature) {
    var g = feature.geometry;
    if (!g) return [];
    if (g.type === "Polygon") return g.coordinates || [];
    if (g.type === "MultiPolygon") {
      var out = [];
      (g.coordinates || []).forEach(function (poly) {
        if (poly && poly[0]) out.push(poly[0]);
      });
      return out;
    }
    return [];
  }

  function pointInRing(lng, lat, ring) {
    var inside = false;
    var i;
    var j;
    for (i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0];
      var yi = ring[i][1];
      var xj = ring[j][0];
      var yj = ring[j][1];
      var intersect = yi > lat !== yj > lat &&
        lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function featureContains(f, lng, lat) {
    var rings = ringsOf(f);
    var i;
    for (i = 0; i < rings.length; i++) {
      if (pointInRing(lng, lat, rings[i])) return true;
    }
    return false;
  }

  function hoodAt(lat, lng, geo) {
    geo = geo || loaded;
    if (!geo || !geo.features) return null;
    var i;
    for (i = 0; i < geo.features.length; i++) {
      var f = geo.features[i];
      if (featureContains(f, lng, lat)) {
        return f.properties && f.properties.name ? f.properties.name : null;
      }
    }
    return nearestHood(lat, lng, geo);
  }

  function ringCentroid(ring) {
    var lng = 0;
    var lat = 0;
    var n = ring.length || 1;
    ring.forEach(function (p) {
      lng += p[0];
      lat += p[1];
    });
    return { lng: lng / n, lat: lat / n };
  }

  function nearestHood(lat, lng, geo) {
    var best = null;
    var bestD = Infinity;
    geo.features.forEach(function (f) {
      var rings = ringsOf(f);
      if (!rings.length) return;
      var c = ringCentroid(rings[0]);
      var d = (c.lat - lat) * (c.lat - lat) + (c.lng - lng) * (c.lng - lng);
      if (d < bestD) {
        bestD = d;
        best = f.properties && f.properties.name;
      }
    });
    return bestD < 0.002 ? best : null;
  }

  function hashName(name) {
    var h = 0;
    var i;
    for (i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  function fillForName(name, role) {
    if (role === "start") return HOOD_FILL.start;
    if (role === "end") return HOOD_FILL.end;
    var hues = ["#6d74b8", "#8288c9", "#959bd4", "#767dc0", "#8b91cc", "#7077bd"];
    return hues[hashName(name) % hues.length];
  }

  /** Simplified water for stylized export (not survey data). */
  var WATER_FEATURES = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { name: "Delaware River" },
        geometry: {
          type: "Polygon",
          coordinates: [[
            [-75.114, 39.878], [-75.105, 39.878], [-75.105, 39.992], [-75.114, 39.992], [-75.114, 39.878]
          ]]
        }
      },
      {
        type: "Feature",
        properties: { name: "Schuylkill River" },
        geometry: {
          type: "Polygon",
          coordinates: [[
            [-75.222, 39.878], [-75.198, 39.878], [-75.192, 39.905], [-75.188, 39.935],
            [-75.184, 39.955], [-75.178, 39.975], [-75.174, 39.992], [-75.222, 39.992], [-75.222, 39.878]
          ]]
        }
      }
    ]
  };

  function drawPolygonRings(ctx, rings, projLatLng, style) {
    ctx.save();
    ctx.fillStyle = style.fill;
    ctx.strokeStyle = style.stroke || "rgba(255,255,255,0.85)";
    ctx.lineWidth = style.lineWidth != null ? style.lineWidth : 2;
    ctx.globalAlpha = style.alpha != null ? style.alpha : 1;
    rings.forEach(function (ring) {
      if (!ring || ring.length < 3) return;
      ctx.beginPath();
      ring.forEach(function (p, idx) {
        var c = projLatLng(p[1], p[0]);
        if (idx === 0) ctx.moveTo(c.x, c.y);
        else ctx.lineTo(c.x, c.y);
      });
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    });
    ctx.restore();
  }

  function drawFeature(ctx, feature, projLatLng, style) {
    var rings = ringsOf(feature);
    if (!rings.length) return;
    drawPolygonRings(ctx, rings, projLatLng, style);
  }

  function labelPointForFeature(feature) {
    var rings = ringsOf(feature);
    if (!rings.length) return null;
    return ringCentroid(rings[0]);
  }

  global.PhillyHoods = {
    load: load,
    getLoaded: function () { return loaded; },
    hoodAt: hoodAt,
    fillForName: fillForName,
    WATER_FEATURES: WATER_FEATURES,
    ringsOf: ringsOf,
    featureContains: featureContains,
    drawFeature: drawFeature,
    drawPolygonRings: drawPolygonRings,
    labelPointForFeature: labelPointForFeature,
    HOOD_FILL: HOOD_FILL
  };
})(typeof window !== "undefined" ? window : this);
