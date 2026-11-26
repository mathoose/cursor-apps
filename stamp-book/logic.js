(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.StampBookLogic = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var MIN_SIZE = 0.1;
  var MAX_SIZE = 0.5;
  var DEFAULT_SIZE = 0.24;
  var MAX_NAME = 40;
  var MAX_LABEL = 60;

  // Shapes are drawn around 0,0 inside a SHAPE_BOX × SHAPE_BOX square, so one scale sets the
  // stamp size.
  var SHAPE_BOX = 100;

  function polygon(points) {
    return "M" + points.map(function (p) {
      return Math.round(p[0] * 10) / 10 + " " + Math.round(p[1] * 10) / 10;
    }).join("L") + "Z";
  }

  function radial(count, radiusAt, startDeg) {
    var points = [];
    for (var i = 0; i < count; i++) {
      var angle = ((startDeg + (360 / count) * i) * Math.PI) / 180;
      var radius = radiusAt(i);
      points.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
    }
    return points;
  }

  var PLUS = [
    [-16, -50], [16, -50], [16, -16], [50, -16], [50, 16], [16, 16],
    [16, 50], [-16, 50], [-16, 16], [-50, 16], [-50, -16], [-16, -16],
  ];

  var SHAPES = [
    { id: "circle", name: "Circle", d: "M-50 0a50 50 0 1 0 100 0a50 50 0 1 0-100 0Z" },
    {
      id: "square",
      name: "Square",
      d: "M-36-44h72a8 8 0 0 1 8 8v72a8 8 0 0 1-8 8h-72a8 8 0 0 1-8-8v-72a8 8 0 0 1 8-8Z",
    },
    {
      id: "star",
      name: "Star",
      d: polygon(radial(10, function (i) { return i % 2 ? 25 : 58; }, -90).map(function (p) {
        return [p[0], p[1] + 5];
      })),
    },
    { id: "triangle", name: "Triangle", d: polygon([[0, -50], [54, 42], [-54, 42]]) },
    { id: "diamond", name: "Diamond", d: polygon([[0, -56], [44, 0], [0, 56], [-44, 0]]) },
    {
      id: "heart",
      name: "Heart",
      d: "M0 48C-66 6-56-46-25-46C-10-46 0-35 0-24C0-35 10-46 25-46C56-46 66 6 0 48Z",
    },
    { id: "hexagon", name: "Hexagon", d: polygon(radial(6, function () { return 54; }, -90)) },
    { id: "plus", name: "Plus", d: polygon(PLUS) },
    {
      id: "cross",
      name: "Cross",
      d: polygon(PLUS.map(function (p) {
        var c = Math.SQRT1_2;
        return [(p[0] - p[1]) * c, (p[0] + p[1]) * c];
      })),
    },
    {
      id: "ring",
      name: "Ring",
      d: "M-50 0a50 50 0 1 0 100 0a50 50 0 1 0-100 0ZM-27 0a27 27 0 1 0 54 0a27 27 0 1 0-54 0Z",
    },
    { id: "moon", name: "Moon", d: "M22-47A50 50 0 1 0 22 47A40 40 0 1 1 22-47Z" },
  ];

  var SHAPE_BY_ID = {};
  SHAPES.forEach(function (shape) { SHAPE_BY_ID[shape.id] = shape; });

  var DEFAULT_SHAPES = ["circle", "square", "star"];

  var DEFAULT_COLORS = [
    "#ee4d3e", "#f7cd45", "#2a5ce8", "#6ac466", "#1e4d3b",
    "#66ddea", "#c440d4", "#ffffff", "#000000",
  ];

  var COLOR_NAMES = {
    "#ee4d3e": "Red",
    "#f7cd45": "Yellow",
    "#2a5ce8": "Blue",
    "#6ac466": "Green",
    "#1e4d3b": "Dark green",
    "#66ddea": "Aqua",
    "#c440d4": "Purple",
    "#ffffff": "White",
    "#000000": "Black",
  };

  function shapeById(id) {
    return SHAPE_BY_ID[id] || null;
  }

  function normalizeColor(value) {
    var text = String(value == null ? "" : value).trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(text)) return text;
    if (/^#[0-9a-f]{3}$/.test(text)) {
      return "#" + text[1] + text[1] + text[2] + text[2] + text[3] + text[3];
    }
    return null;
  }

  function colorName(color) {
    return COLOR_NAMES[color] || String(color || "").toUpperCase();
  }

  function isLightColor(color) {
    var c = normalizeColor(color);
    if (!c) return false;
    var red = parseInt(c.slice(1, 3), 16);
    var green = parseInt(c.slice(3, 5), 16);
    var blue = parseInt(c.slice(5, 7), 16);
    return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255 > 0.82;
  }

  function comboKey(shape, color) {
    return shape + "|" + color;
  }

  function clampSize(value) {
    var n = Number(value);
    if (!isFinite(n)) return DEFAULT_SIZE;
    return Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(n * 100) / 100));
  }

  // Keeps the whole stamp inside its cell so it never spills into the next day.
  function clampCenter(value, size) {
    var half = size / 2;
    return Math.min(1 - half, Math.max(half, value));
  }

  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function iso(year, monthIndex, day) {
    return year + "-" + pad2(monthIndex + 1) + "-" + pad2(day);
  }

  function daysInMonth(year, monthIndex) {
    return new Date(year, monthIndex + 1, 0).getDate();
  }

  function parseISO(text) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text || ""));
    if (!m) return null;
    var year = Number(m[1]);
    var monthIndex = Number(m[2]) - 1;
    var day = Number(m[3]);
    if (monthIndex < 0 || monthIndex > 11 || day < 1 || day > daysInMonth(year, monthIndex)) return null;
    return { year: year, month: monthIndex, day: day };
  }

  function shiftISO(text, deltaDays) {
    var p = parseISO(text);
    if (!p) return text;
    var d = new Date(p.year, p.month, p.day + deltaDays);
    return iso(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function makeId() {
    return "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function cleanName(value, fallback) {
    var text = String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
    return text || fallback;
  }

  function cleanLabel(value) {
    return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, MAX_LABEL);
  }

  function newPage(name, id) {
    return {
      id: id || makeId(),
      name: cleanName(name, "Page 1"),
      shapes: DEFAULT_SHAPES.slice(),
      colors: DEFAULT_COLORS.slice(),
      sel: { shape: DEFAULT_SHAPES[0], color: DEFAULT_COLORS[0] },
      legend: [],
      days: {},
    };
  }

  function emptyState() {
    var page = newPage("Page 1");
    return { version: 1, stampSize: DEFAULT_SIZE, activePageId: page.id, pages: [page] };
  }

  function cleanStamp(raw) {
    if (!raw || typeof raw !== "object") return null;
    var color = normalizeColor(raw.c);
    var x = Number(raw.x);
    var y = Number(raw.y);
    if (!shapeById(raw.s) || !color || !isFinite(x) || !isFinite(y)) return null;
    return {
      s: raw.s,
      c: color,
      x: Math.min(1, Math.max(0, Math.round(x * 1000) / 1000)),
      y: Math.min(1, Math.max(0, Math.round(y * 1000) / 1000)),
    };
  }

  function cleanPage(raw, index, usedIds) {
    if (!raw || typeof raw !== "object") return null;
    var id = typeof raw.id === "string" && raw.id && !usedIds[raw.id] ? raw.id : makeId();
    usedIds[id] = true;
    var page = newPage(cleanName(raw.name, "Page " + (index + 1)), id);

    if (Array.isArray(raw.shapes)) {
      var shapes = [];
      raw.shapes.forEach(function (shapeId) {
        if (shapeById(shapeId) && shapes.indexOf(shapeId) < 0) shapes.push(shapeId);
      });
      if (shapes.length) page.shapes = shapes;
    }

    if (Array.isArray(raw.colors)) {
      var colors = [];
      raw.colors.forEach(function (value) {
        var color = normalizeColor(value);
        if (color && colors.indexOf(color) < 0) colors.push(color);
      });
      if (colors.length) page.colors = colors;
    }

    var selShape = raw.sel && shapeById(raw.sel.shape) ? raw.sel.shape : null;
    var selColor = raw.sel ? normalizeColor(raw.sel.color) : null;
    page.sel = {
      shape: selShape || page.shapes[0],
      color: selColor || page.colors[0],
    };

    if (Array.isArray(raw.legend)) {
      var seen = {};
      raw.legend.forEach(function (entry) {
        if (!entry || typeof entry !== "object") return;
        var color = normalizeColor(entry.color);
        if (!shapeById(entry.shape) || !color) return;
        var key = comboKey(entry.shape, color);
        if (seen[key]) return;
        seen[key] = true;
        page.legend.push({ shape: entry.shape, color: color, label: cleanLabel(entry.label) });
      });
    }

    if (raw.days && typeof raw.days === "object") {
      Object.keys(raw.days).forEach(function (date) {
        if (!parseISO(date) || !Array.isArray(raw.days[date])) return;
        var stamps = raw.days[date].map(cleanStamp).filter(Boolean);
        if (stamps.length) page.days[date] = stamps;
      });
    }

    return page;
  }

  function sanitize(raw) {
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.pages)) return emptyState();
    var usedIds = {};
    var pages = [];
    raw.pages.forEach(function (entry) {
      var page = cleanPage(entry, pages.length, usedIds);
      if (page) pages.push(page);
    });
    if (!pages.length) return emptyState();
    var active = pages.some(function (page) { return page.id === raw.activePageId; })
      ? raw.activePageId
      : pages[0].id;
    return {
      version: 1,
      stampSize: raw.stampSize == null ? DEFAULT_SIZE : clampSize(raw.stampSize),
      activePageId: active,
      pages: pages,
    };
  }

  function findLegend(page, shape, color) {
    if (!page || !Array.isArray(page.legend)) return null;
    for (var i = 0; i < page.legend.length; i++) {
      if (page.legend[i].shape === shape && page.legend[i].color === color) return page.legend[i];
    }
    return null;
  }

  function dayStamps(page, date) {
    return (page && page.days && page.days[date]) || [];
  }

  function monthTally(page, year, monthIndex) {
    var total = 0;
    var last = daysInMonth(year, monthIndex);
    for (var day = 1; day <= last; day++) {
      total += dayStamps(page, iso(year, monthIndex, day)).length;
    }
    return total;
  }

  function yearTallies(page, year) {
    var out = [];
    for (var m = 0; m < 12; m++) out.push(monthTally(page, year, m));
    return out;
  }

  function sum(list) {
    return list.reduce(function (a, b) { return a + b; }, 0);
  }

  // Counts per shape + color. Pass a prefix such as "2026" or "2026-11-25" to limit the dates.
  function comboCounts(page, prefix) {
    var counts = {};
    if (!page || !page.days) return counts;
    Object.keys(page.days).forEach(function (date) {
      if (prefix && date.indexOf(prefix) !== 0) return;
      page.days[date].forEach(function (stamp) {
        var key = comboKey(stamp.s, stamp.c);
        counts[key] = (counts[key] || 0) + 1;
      });
    });
    return counts;
  }

  function pageTotal(page) {
    if (!page || !page.days) return 0;
    return sum(Object.keys(page.days).map(function (date) { return page.days[date].length; }));
  }

  // Index of the topmost stamp under the point, or -1.
  function hitTest(stamps, x, y, size) {
    var reach = Math.max(size * 0.6, 0.06);
    for (var i = stamps.length - 1; i >= 0; i--) {
      var dx = clampCenter(stamps[i].x, size) - x;
      var dy = clampCenter(stamps[i].y, size) - y;
      if (dx * dx + dy * dy <= reach * reach) return i;
    }
    return -1;
  }

  function addStamp(page, date, shape, color, x, y, size) {
    var stamp = cleanStamp({ s: shape, c: color, x: clampCenter(x, size), y: clampCenter(y, size) });
    if (!stamp || !parseISO(date)) return null;
    if (!page.days[date]) page.days[date] = [];
    page.days[date].push(stamp);
    return stamp;
  }

  function removeStamp(page, date, index) {
    var stamps = page.days[date];
    if (!stamps || index < 0 || index >= stamps.length) return null;
    var removed = stamps.splice(index, 1)[0];
    if (!stamps.length) delete page.days[date];
    return removed;
  }

  return {
    MIN_SIZE: MIN_SIZE,
    MAX_SIZE: MAX_SIZE,
    DEFAULT_SIZE: DEFAULT_SIZE,
    MAX_NAME: MAX_NAME,
    MAX_LABEL: MAX_LABEL,
    SHAPE_BOX: SHAPE_BOX,
    SHAPES: SHAPES,
    DEFAULT_SHAPES: DEFAULT_SHAPES,
    DEFAULT_COLORS: DEFAULT_COLORS,
    shapeById: shapeById,
    normalizeColor: normalizeColor,
    colorName: colorName,
    isLightColor: isLightColor,
    comboKey: comboKey,
    clampSize: clampSize,
    clampCenter: clampCenter,
    iso: iso,
    daysInMonth: daysInMonth,
    parseISO: parseISO,
    shiftISO: shiftISO,
    makeId: makeId,
    cleanName: cleanName,
    cleanLabel: cleanLabel,
    newPage: newPage,
    emptyState: emptyState,
    sanitize: sanitize,
    findLegend: findLegend,
    dayStamps: dayStamps,
    monthTally: monthTally,
    yearTallies: yearTallies,
    sum: sum,
    comboCounts: comboCounts,
    pageTotal: pageTotal,
    hitTest: hitTest,
    addStamp: addStamp,
    removeStamp: removeStamp,
  };
});
