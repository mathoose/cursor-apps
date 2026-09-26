/**
 * Shareable direction card (canvas PNG) for City Axes.
 * Initialized from app.js with grid math + route state.
 */
(function (global) {
  "use strict";

  var deps = null;
  var W = 1080;
  var H = 1350;
  var TILE_URLS = [
    "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    "https://maps.wikimedia.org/osm-intl/{z}/{x}/{y}.png"
  ];

  function mount(d) {
    deps = d;
  }

  function hoodModule() {
    return typeof PhillyHoods !== "undefined" ? PhillyHoods : null;
  }

  function expandPtsWithRouteHoods(pts, geo, hoodStart, hoodEnd) {
    if (!geo || !geo.features) return;
    var hm = hoodModule();
    geo.features.forEach(function (f) {
      var name = f.properties && f.properties.name;
      if (name !== hoodStart && name !== hoodEnd) return;
      var rings = hm ? hm.ringsOf(f) : [];
      rings.forEach(function (ring) {
        ring.forEach(function (p) {
          pts.push([p[1], p[0]]);
        });
      });
    });
  }

  function buildPayload(start, end, opts) {
    if (!deps || !start || !end) return null;
    opts = opts || {};
    var A = deps.blocksOf(start.lat, start.lng);
    var B = deps.blocksOf(end.lat, end.lng);
    var change = deps.describeChange(start, end, opts);
    var transform =
      "(x, y) = (" + deps.formatSigned(A.x) + ", " + deps.formatSigned(A.y) + ") \u2192 (" +
      deps.formatSigned(B.x) + ", " + deps.formatSigned(B.y) + ")";
    var deltaLine = "\u0394x " + deps.formatSigned(change.dx) + "  \u00b7  \u0394y " + deps.formatSigned(change.dy);
    var poetry = deps.movementPoetry(change.dx, change.dy, A.y);
    var corner = deps.cornerOf(start, end, opts.xFirst);
    var payload = {
      start: start,
      end: end,
      xFirst: opts.xFirst !== false,
      change: change,
      transform: transform,
      deltaLine: deltaLine,
      poetry: poetry,
      startBlocks: A,
      endBlocks: B,
      corner: corner,
      hoodStart: null,
      hoodEnd: null
    };
    var hm = hoodModule();
    var geo = opts.geo || (hm && hm.getLoaded ? hm.getLoaded() : null);
    if (hm && geo) {
      payload.hoodStart = hm.hoodAt(start.lat, start.lng, geo);
      payload.hoodEnd = hm.hoodAt(end.lat, end.lng, geo);
    }
    return payload;
  }

  function projectBounds(payload, mapW, mapH, pad, geo) {
    pad = pad || 80;
    var pts = [
      [payload.start.lat, payload.start.lng],
      [payload.end.lat, payload.end.lng],
      [payload.corner.lat, payload.corner.lng],
      [deps.ORIGIN.lat, deps.ORIGIN.lng]
    ];
    expandPtsWithRouteHoods(pts, geo, payload.hoodStart, payload.hoodEnd);
    var xy = pts.map(function (p) {
      return deps.toXY(p[0], p[1]);
    });
    var minX = xy[0].x;
    var maxX = xy[0].x;
    var minY = xy[0].y;
    var maxY = xy[0].y;
    xy.forEach(function (p) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    });
    var spanX = Math.max(maxX - minX, deps.BLOCK_M * 5);
    var spanY = Math.max(maxY - minY, deps.BLOCK_M * 5);
    spanX = Math.min(spanX, deps.BLOCK_M * 42);
    spanY = Math.min(spanY, deps.BLOCK_M * 42);
    var cx = (minX + maxX) / 2;
    var cy = (minY + maxY) / 2;
    var scale = Math.min((mapW - pad * 2) / spanX, (mapH - pad * 2) / spanY);
    function projLatLng(lat, lng) {
      var p = deps.toXY(lat, lng);
      return {
        x: mapW / 2 + (p.x - cx) * scale,
        y: mapH / 2 - (p.y - cy) * scale
      };
    }
    return { projLatLng: projLatLng, scale: scale, cx: cx, cy: cy, mapW: mapW, mapH: mapH, pad: pad };
  }

  function viewLatLngBounds(view, mapW, mapH, pad) {
    pad = pad != null ? pad : view.pad || 80;
    var leftM = view.cx - (mapW / 2 - pad) / view.scale;
    var rightM = view.cx + (mapW / 2 - pad) / view.scale;
    var bottomM = view.cy - (mapH / 2 - pad) / view.scale;
    var topM = view.cy + (mapH / 2 - pad) / view.scale;
    var sw = deps.fromXY(leftM, bottomM);
    var ne = deps.fromXY(rightM, topM);
    return {
      south: sw.lat,
      north: ne.lat,
      west: sw.lng,
      east: ne.lng
    };
  }

  function latLngToTileFloat(lat, lng, z) {
    var n = Math.pow(2, z);
    var x = (lng + 180) / 360 * n;
    var latRad = lat * Math.PI / 180;
    var y = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n;
    return { x: x, y: y };
  }

  function tileLatLng(x, y, z) {
    var n = Math.pow(2, z);
    var lng = x / n * 360 - 180;
    var latRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n)));
    return { lat: latRad * 180 / Math.PI, lng: lng };
  }

  function pickTileZoom(view, lat) {
    var metersPerPx = 1 / view.scale;
    var z = Math.log2(156543.03 * Math.cos(lat * Math.PI / 180) / metersPerPx);
    return Math.max(11, Math.min(15, Math.round(z)));
  }

  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error("tile")); };
      img.src = url;
    });
  }

  function loadTileImage(z, x, y) {
    var i = 0;
    function tryNext() {
      if (i >= TILE_URLS.length) return Promise.reject(new Error("tile"));
      var url = TILE_URLS[i]
        .replace("{z}", String(z))
        .replace("{x}", String(x))
        .replace("{y}", String(y));
      i += 1;
      return loadImage(url).catch(tryNext);
    }
    return tryNext();
  }

  function drawBlockStreetGrid(ctx, projM, mapW, mapH) {
    var step = deps.BLOCK_M;
    var b;
    ctx.save();
    ctx.strokeStyle = "rgba(20, 36, 27, 0.12)";
    ctx.lineWidth = 1;
    for (b = -55; b <= 55; b++) {
      var xM = b * step;
      var a = projM(xM, -55 * step);
      var c = projM(xM, 55 * step);
      if (a.y < mapH + 40 || c.y > -40) {
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(c.x, c.y);
        ctx.stroke();
      }
      var yM = b * step;
      var d = projM(-55 * step, yM);
      var e = projM(55 * step, yM);
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(e.x, e.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawBasemapTiles(ctx, view, mapW, mapH, pad, bounds) {
    var latMid = (bounds.north + bounds.south) / 2;
    var z = pickTileZoom(view, latMid);
    var tMin = latLngToTileFloat(bounds.north, bounds.west, z);
    var tMax = latLngToTileFloat(bounds.south, bounds.east, z);
    var x0 = Math.floor(tMin.x);
    var x1 = Math.floor(tMax.x);
    var y0 = Math.floor(tMin.y);
    var y1 = Math.floor(tMax.y);
    var proj = view.projLatLng;
    var jobs = [];
    var loaded = 0;
    var x;
    var y;
    for (x = x0; x <= x1; x++) {
      for (y = y0; y <= y1; y++) {
        (function (tx, ty) {
          jobs.push(loadTileImage(z, tx, ty).then(function (img) {
            loaded += 1;
            var nw = tileLatLng(tx, ty, z);
            var se = tileLatLng(tx + 1, ty + 1, z);
            var p1 = proj(nw.lat, nw.lng);
            var p2 = proj(se.lat, se.lng);
            ctx.drawImage(img, p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
          }).catch(function () { /* skip failed tiles */ }));
        })(x, y);
      }
    }
    return Promise.all(jobs).then(function () { return loaded; });
  }

  function drawTextBlock(ctx, lines, x, y, maxW, lineH) {
    lines.forEach(function (line, i) {
      if (!line) return;
      ctx.fillText(line, x, y + i * lineH);
    });
  }

  function wrapText(ctx, text, maxW) {
    var words = String(text).split(/\s+/);
    var lines = [];
    var line = "";
    words.forEach(function (w) {
      var test = line ? line + " " + w : w;
      if (ctx.measureText(test).width > maxW && line) {
        lines.push(line);
        line = w;
      } else {
        line = test;
      }
    });
    if (line) lines.push(line);
    return lines;
  }

  function tickVisible(c, mapW, mapH) {
    return c.x >= -30 && c.x <= mapW + 30 && c.y >= -30 && c.y <= mapH + 30;
  }

  function featureInBounds(f, bounds, hm) {
    if (!bounds) return true;
    var rings = hm.ringsOf(f);
    var i;
    for (i = 0; i < rings.length; i++) {
      var ring = rings[i];
      var j;
      for (j = 0; j < ring.length; j++) {
        var lng = ring[j][0];
        var lat = ring[j][1];
        if (lat >= bounds.south && lat <= bounds.north &&
            lng >= bounds.west && lng <= bounds.east) {
          return true;
        }
      }
    }
    return false;
  }

  function drawPosterNeighborhoods(ctx, geo, proj, hoodStart, hoodEnd, bounds) {
    var hm = hoodModule();
    if (!hm || !geo) return;
    var sorted = geo.features.slice().sort(function (a, b) {
      function rank(f) {
        var n = f.properties && f.properties.name;
        if (n === hoodStart) return 2;
        if (n === hoodEnd) return 2;
        return 0;
      }
      return rank(a) - rank(b);
    });
    sorted.forEach(function (f) {
      var name = f.properties && f.properties.name;
      var role = name === hoodStart ? "start" : name === hoodEnd ? "end" : "other";
      if (role === "other" && !featureInBounds(f, bounds, hm)) return;
      var fill = hm.fillForName(name, role);
      var alpha = role === "other" ? 0.78 : 0.94;
      hm.drawFeature(ctx, f, function (lat, lng) {
        return proj(lat, lng);
      }, {
        fill: fill,
        stroke: "rgba(255,255,255,0.92)",
        lineWidth: role === "other" ? 2 : 3.5,
        alpha: alpha
      });
    });
    [hoodStart, hoodEnd].forEach(function (hoodName, idx) {
      if (!hoodName) return;
      var feature = geo.features.filter(function (f) {
        return f.properties && f.properties.name === hoodName;
      })[0];
      if (!feature) return;
      var c = hm.labelPointForFeature(feature);
      if (!c) return;
      var p = proj(c.lat, c.lng);
      var tag = idx === 0 ? "FROM" : "TO";
      ctx.font = "800 22px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      var label = tag + " \u00b7 " + hoodName;
      var tw = ctx.measureText(label).width + 28;
      ctx.fillStyle = idx === 0 ? "rgba(29, 78, 216, 0.92)" : "rgba(194, 65, 12, 0.92)";
      var bx = p.x - tw / 2;
      var by = p.y - 38;
      var bh = 34;
      var br = 8;
      ctx.beginPath();
      ctx.moveTo(bx + br, by);
      ctx.arcTo(bx + tw, by, bx + tw, by + bh, br);
      ctx.arcTo(bx + tw, by + bh, bx, by + bh, br);
      ctx.arcTo(bx, by + bh, bx, by, br);
      ctx.arcTo(bx, by, bx + tw, by, br);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillText(label, p.x, p.y - 21);
    });
  }

  function drawMapVectors(ctx, payload, view, mapW, mapH, geo) {
    var proj = view.projLatLng;

    function projM(xM, yM) {
      var ll = deps.fromXY(xM, yM);
      return proj(ll.lat, ll.lng);
    }

    drawBlockStreetGrid(ctx, projM, mapW, mapH);
    if (geo) {
      var bounds = viewLatLngBounds(view, mapW, mapH, view.pad);
      drawPosterNeighborhoods(ctx, geo, proj, payload.hoodStart, payload.hoodEnd, bounds);
    }

    var tickStep = view.scale < 0.35 ? 10 : 5;
    var b;
    for (b = -80; b <= 80; b += tickStep) {
      if (b === 0) continue;
      var cx = projM(b * deps.BLOCK_M, 0);
      var cy = projM(0, b * deps.BLOCK_M);
      if (tickVisible(cx, mapW, mapH)) drawTickOnCanvas(ctx, b, 0, "x", projM, view.scale);
      if (tickVisible(cy, mapW, mapH)) drawTickOnCanvas(ctx, 0, b, "y", projM, view.scale);
    }
    drawTickOnCanvas(ctx, 0, 0, "origin", projM, view.scale);

    drawAxisLine(ctx, projM, "market");
    drawAxisLine(ctx, projM, "broad");

    var A = proj(payload.start.lat, payload.start.lng);
    var C = proj(payload.corner.lat, payload.corner.lng);
    var B = proj(payload.end.lat, payload.end.lng);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.moveTo(A.x, A.y);
    ctx.lineTo(C.x, C.y);
    ctx.lineTo(B.x, B.y);
    ctx.stroke();
    ctx.strokeStyle = "#c2410c";
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(A.x, A.y);
    ctx.lineTo(C.x, C.y);
    ctx.lineTo(B.x, B.y);
    ctx.stroke();

    function dot(p, fill) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 14, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 4;
      ctx.stroke();
    }
    dot(A, "#1d4ed8");
    dot(B, "#c2410c");

    var oc = proj(deps.ORIGIN.lat, deps.ORIGIN.lng);
    ctx.beginPath();
    ctx.arc(oc.x, oc.y, 10, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.strokeStyle = "#14532d";
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  function drawMapScene(ctx, payload, opts, geo) {
    opts = opts || {};
    var footerH = 420;
    var mapH = (opts.height || H) - footerH;
    var mapW = opts.width || W;
    var pad = 72;

    ctx.fillStyle = "#c9a227";
    ctx.fillRect(0, 0, mapW, mapH);

    var view = projectBounds(payload, mapW, mapH, pad, geo);
    drawMapVectors(ctx, payload, view, mapW, mapH, geo);
    return { view: view, mapW: mapW, mapH: mapH, footerH: footerH, pad: pad };
  }

  function drawFooter(ctx, payload, layout) {
    var mapW = layout.mapW;
    var mapH = layout.mapH;
    var footerH = layout.footerH;
    ctx.fillStyle = "rgba(247, 250, 248, 0.98)";
    ctx.fillRect(0, mapH, mapW, footerH);
    ctx.strokeStyle = "#d5e4da";
    ctx.beginPath();
    ctx.moveTo(0, mapH);
    ctx.lineTo(mapW, mapH);
    ctx.stroke();

    var pad = 48;
    var y = mapH + 44;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#14532d";
    ctx.font = "800 36px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText("City Axes", pad, y);
    ctx.font = "600 22px -apple-system, sans-serif";
    ctx.fillStyle = "#5c6f64";
    ctx.fillText("City Hall is (0, 0)  \u00b7  Market is x  \u00b7  Broad is y", pad, y + 34);

    y += 72;
    ctx.fillStyle = "#14241b";
    ctx.font = "700 28px -apple-system, sans-serif";
    var hoodLine = "";
    if (payload.hoodStart || payload.hoodEnd) {
      hoodLine = (payload.hoodStart || "Start area") + "  \u2192  " + (payload.hoodEnd || "End area");
      ctx.fillText(hoodLine, pad, y);
      y += 36;
    }
    var routeTitle = payload.start.label + "  \u2192  " + payload.end.label;
    ctx.font = "600 24px -apple-system, sans-serif";
    ctx.fillStyle = "#475569";
    drawTextBlock(ctx, wrapText(ctx, routeTitle, mapW - pad * 2), pad, y, mapW, 30);

    y += 46;
    ctx.font = "600 24px -apple-system, sans-serif";
    ctx.fillStyle = "#334155";
    ctx.fillText(payload.transform, pad, y);
    y += 36;
    ctx.font = "700 26px -apple-system, sans-serif";
    ctx.fillStyle = "#15803d";
    ctx.fillText(payload.deltaLine, pad, y);

    y += 44;
    ctx.font = "600 23px -apple-system, sans-serif";
    ctx.fillStyle = "#1e3a8a";
    payload.poetry.split("\n").forEach(function (line) {
      ctx.fillText(line, pad, y);
      y += 30;
    });

    y += 8;
    ctx.font = "600 26px -apple-system, sans-serif";
    ctx.fillStyle = "#14241b";
    wrapText(ctx, payload.change.sentence, mapW - pad * 2).forEach(function (line) {
      ctx.fillText(line, pad, y);
      y += 32;
    });

    ctx.font = "500 20px -apple-system, sans-serif";
    ctx.fillStyle = "#5c6f64";
    ctx.fillText(payload.change.meta, pad, y + 8);
  }

  function renderToCanvas(payload, opts) {
    opts = opts || {};
    if (!deps || !payload) return null;
    var canvas = document.createElement("canvas");
    canvas.width = opts.width || W;
    canvas.height = opts.height || H;
    var ctx = canvas.getContext("2d");
    var geo = opts.geo || null;
    var layout = drawMapScene(ctx, payload, opts, geo);
    drawFooter(ctx, payload, layout);
    return canvas;
  }

  function renderToCanvasAsync(payload, opts) {
    opts = opts || {};
    if (!deps || !payload) return Promise.resolve(null);
    var canvas = document.createElement("canvas");
    canvas.width = opts.width || W;
    canvas.height = opts.height || H;
    var ctx = canvas.getContext("2d");
    var geo = opts.geo || null;
    var hm = hoodModule();
    var loadGeo = geo
      ? Promise.resolve(geo)
      : hm
        ? hm.load()
        : Promise.resolve(null);

    return loadGeo.then(function (g) {
      if (!g || !g.features || !g.features.length) {
        return Promise.reject(new Error("Neighborhood map data did not load"));
      }
      opts.geo = g;
      payload = buildPayload(payload.start, payload.end, {
        xFirst: payload.xFirst,
        geo: g
      }) || payload;
      var footerH = 420;
      var mapH = (opts.height || H) - footerH;
      var mapW = opts.width || W;
      var pad = 72;
      ctx.fillStyle = "#c9a227";
      ctx.fillRect(0, 0, mapW, mapH);
      var view = projectBounds(payload, mapW, mapH, pad, g);
      var bounds = viewLatLngBounds(view, mapW, mapH, pad);
      var tilePromise = opts.withBasemap === false
        ? Promise.resolve()
        : drawBasemapTiles(ctx, view, mapW, mapH, pad, bounds).catch(function () { });
      return tilePromise.then(function (tileCount) {
        ctx.save();
        ctx.fillStyle = tileCount ? "rgba(201, 162, 39, 0.14)" : "rgba(201, 162, 39, 0.22)";
        ctx.fillRect(0, 0, mapW, mapH);
        ctx.restore();
        drawMapVectors(ctx, payload, view, mapW, mapH, g);
        ctx.font = "500 14px -apple-system, sans-serif";
        ctx.fillStyle = "rgba(20, 36, 27, 0.55)";
        ctx.textAlign = "right";
        ctx.fillText("\u00a9 OpenStreetMap", mapW - 12, mapH - 10);
        var layout = { view: view, mapW: mapW, mapH: mapH, footerH: footerH };
        drawFooter(ctx, payload, layout);
        return canvas;
      });
    });
  }

  function drawAxisLine(ctx, projM, which) {
    var color = which === "market" ? "#15803d" : "#1d4ed8";
    var len = 22000;
    var a;
    var b;
    if (which === "market") {
      a = projM(-len, 0);
      b = projM(len, 0);
    } else {
      a = projM(0, -len);
      b = projM(0, len);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.92)";
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  function drawTickOnCanvas(ctx, xBlocks, yBlocks, axis, projM) {
    var cx = xBlocks * deps.BLOCK_M;
    var cy = yBlocks * deps.BLOCK_M;
    var half = 22;
    var a;
    var b;
    if (axis === "origin") {
      var c = projM(0, 0);
      ctx.strokeStyle = "#14532d";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(c.x - 8, c.y);
      ctx.lineTo(c.x + 8, c.y);
      ctx.moveTo(c.x, c.y - 8);
      ctx.lineTo(c.x, c.y + 8);
      ctx.stroke();
      ctx.font = "700 18px -apple-system, sans-serif";
      ctx.fillStyle = "#14532d";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText("0", c.x, c.y + 10);
      return;
    }
    if (axis === "x") {
      a = projM(cx, cy - half);
      b = projM(cx, cy + half);
    } else {
      a = projM(cx - half, cy);
      b = projM(cx + half, cy);
    }
    ctx.strokeStyle = axis === "x" ? "#15803d" : "#1d4ed8";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    var c = projM(cx, cy);
    var n = xBlocks || yBlocks;
    var label = (n > 0 ? "+" : "\u2212") + Math.abs(n);
    ctx.font = "700 17px -apple-system, sans-serif";
    ctx.fillStyle = axis === "x" ? "#14532d" : "#1e3a8a";
    ctx.textAlign = "center";
    ctx.textBaseline = axis === "x" ? "top" : "middle";
    if (axis === "x") ctx.fillText(label, c.x, c.y + 8);
    else ctx.fillText(label, c.x - 14, c.y);
  }

  function downloadCanvas(canvas, filename) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (!blob) {
          reject(new Error("Could not create image"));
          return;
        }
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = filename || "city-axes-direction.png";
        a.click();
        setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
        resolve(blob);
      }, "image/png");
    });
  }

  function shareCanvas(canvas, filename) {
    filename = filename || "city-axes-direction.png";
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (!blob) {
          reject(new Error("Could not create image"));
          return;
        }
        var file = new File([blob], filename, { type: "image/png" });
        if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
          navigator.share({
            files: [file],
            title: "City Axes directions",
            text: "My Philly grid shift"
          }).then(resolve).catch(function () {
            downloadCanvas(canvas, filename).then(resolve).catch(reject);
          });
          return;
        }
        downloadCanvas(canvas, filename).then(resolve).catch(reject);
      }, "image/png");
    });
  }

  function exportCurrentRoute(state, opts) {
    if (!state || !state.start || !state.end) return Promise.reject(new Error("Set start and end first"));
    opts = opts || {};
    var payload = buildPayload(state.start, state.end, { xFirst: state.xFirst });
    return renderToCanvasAsync(payload, {
      exportMode: true,
      withBasemap: opts.withBasemap !== false
    }).then(function (canvas) {
      var slug = (state.start.label + "-to-" + state.end.label)
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 48);
      return shareCanvas(canvas, slug + "-city-axes.png");
    });
  }

  function renderSample(name, start, end, xFirst) {
    var payload = buildPayload(start, end, { xFirst: xFirst });
    return renderToCanvasAsync(payload, { exportMode: true });
  }

  global.CityAxesExport = {
    mount: mount,
    buildPayload: buildPayload,
    renderToCanvas: renderToCanvas,
    renderToCanvasAsync: renderToCanvasAsync,
    exportCurrentRoute: exportCurrentRoute,
    renderSample: renderSample,
    downloadCanvas: downloadCanvas
  };
})(typeof window !== "undefined" ? window : this);
