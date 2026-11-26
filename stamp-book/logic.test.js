"use strict";

var assert = require("assert");
var L = require("./logic.js");

// A new book opens on one page with the default shapes and colors.
var fresh = L.sanitize(null);
assert.strictEqual(fresh.pages.length, 1);
assert.deepStrictEqual(fresh.pages[0].shapes, ["circle", "square", "star"]);
assert.strictEqual(fresh.pages[0].colors.length, 9);
assert.strictEqual(fresh.activePageId, fresh.pages[0].id);
assert.strictEqual(fresh.stampSize, L.DEFAULT_SIZE);

// Every shape in the library has a drawable path.
L.SHAPES.forEach(function (shape) {
  assert.ok(shape.d && shape.d[0] === "M", shape.id);
  assert.ok(!/NaN/.test(shape.d), shape.id);
});

// Dates.
assert.strictEqual(L.iso(2026, 10, 5), "2026-11-05");
assert.strictEqual(L.daysInMonth(2026, 1), 28);
assert.strictEqual(L.daysInMonth(2028, 1), 29);
assert.strictEqual(L.parseISO("2026-02-30"), null);
assert.deepStrictEqual(L.parseISO("2026-11-25"), { year: 2026, month: 10, day: 25 });
assert.strictEqual(L.shiftISO("2026-12-31", 1), "2027-01-01");
assert.strictEqual(L.shiftISO("2026-03-01", -1), "2026-02-28");

// Colors.
assert.strictEqual(L.normalizeColor("#ABC"), "#aabbcc");
assert.strictEqual(L.normalizeColor("red"), null);
assert.strictEqual(L.isLightColor("#ffffff"), true);
assert.strictEqual(L.isLightColor("#ee4d3e"), false);
assert.strictEqual(L.colorName("#ee4d3e"), "Red");
assert.strictEqual(L.colorName("#123456"), "#123456");

// A stamp is held inside its cell at the current size.
assert.strictEqual(L.clampCenter(0, 0.2), 0.1);
assert.strictEqual(L.clampCenter(1, 0.2), 0.9);
assert.strictEqual(L.clampCenter(0.5, 0.2), 0.5);
assert.strictEqual(L.clampSize(9), L.MAX_SIZE);
assert.strictEqual(L.clampSize("x"), L.DEFAULT_SIZE);

// Stamping, overlap, tallies.
var page = L.newPage("Health", "health");
L.addStamp(page, "2026-11-25", "circle", "#ee4d3e", 0.5, 0.5, 0.24);
L.addStamp(page, "2026-11-25", "circle", "#ee4d3e", 0.52, 0.5, 0.24);
L.addStamp(page, "2026-11-25", "star", "#6ac466", 0.01, 0.99, 0.24);
L.addStamp(page, "2026-11-01", "square", "#2a5ce8", 0.3, 0.3, 0.24);
L.addStamp(page, "2026-02-28", "circle", "#ee4d3e", 0.3, 0.3, 0.24);
L.addStamp(page, "2025-11-25", "circle", "#ee4d3e", 0.3, 0.3, 0.24);
assert.strictEqual(L.addStamp(page, "2026-02-30", "circle", "#ee4d3e", 0.3, 0.3, 0.24), null);
assert.strictEqual(L.addStamp(page, "2026-11-02", "blob", "#ee4d3e", 0.3, 0.3, 0.24), null);

assert.strictEqual(L.dayStamps(page, "2026-11-25").length, 3);
assert.deepStrictEqual(L.dayStamps(page, "2026-11-25")[2], { s: "star", c: "#6ac466", x: 0.12, y: 0.88 });
assert.strictEqual(L.monthTally(page, 2026, 10), 4);
assert.deepStrictEqual(L.yearTallies(page, 2026), [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 4, 0]);
assert.strictEqual(L.sum(L.yearTallies(page, 2026)), 5);
assert.strictEqual(L.pageTotal(page), 6);
assert.deepStrictEqual(L.comboCounts(page, "2026"), {
  "circle|#ee4d3e": 3,
  "star|#6ac466": 1,
  "square|#2a5ce8": 1,
});
assert.deepStrictEqual(L.comboCounts(page, "2026-11-25"), { "circle|#ee4d3e": 2, "star|#6ac466": 1 });

// Erasing takes the topmost stamp under the finger.
var today = L.dayStamps(page, "2026-11-25");
assert.strictEqual(L.hitTest(today, 0.51, 0.5, 0.24), 1);
assert.strictEqual(L.hitTest(today, 0.12, 0.88, 0.24), 2);
assert.strictEqual(L.hitTest(today, 0.9, 0.1, 0.24), -1);
L.removeStamp(page, "2026-11-25", 1);
assert.strictEqual(L.dayStamps(page, "2026-11-25").length, 2);
L.removeStamp(page, "2026-02-28", 0);
assert.strictEqual(page.days["2026-02-28"], undefined);

// Legend lookups are per page and per shape + color.
page.legend.push({ shape: "circle", color: "#ee4d3e", label: "Workout" });
assert.strictEqual(L.findLegend(page, "circle", "#ee4d3e").label, "Workout");
assert.strictEqual(L.findLegend(page, "square", "#ee4d3e"), null);
assert.strictEqual(L.findLegend(L.newPage("Other"), "circle", "#ee4d3e"), null);

// Saved data is cleaned on load.
var messy = L.sanitize({
  stampSize: 3,
  activePageId: "gone",
  pages: [
    {
      id: "a",
      name: "  Mood   log ",
      shapes: ["star", "blob", "star"],
      colors: ["#FFF", "nope", "#ffffff", "#123456"],
      sel: { shape: "blob", color: "#123456" },
      legend: [
        { shape: "star", color: "#FFF", label: "  Good   day " },
        { shape: "star", color: "#ffffff", label: "Duplicate" },
        { shape: "blob", color: "#ffffff", label: "Bad shape" },
      ],
      days: {
        "2026-11-25": [{ s: "star", c: "#FFF", x: 2, y: -1 }, { s: "blob", c: "#fff", x: 0, y: 0 }],
        "2026-13-01": [{ s: "star", c: "#fff", x: 0.5, y: 0.5 }],
        "2026-11-26": [],
      },
    },
    { id: "a", name: "" },
    null,
  ],
});
assert.strictEqual(messy.stampSize, L.MAX_SIZE);
assert.strictEqual(messy.pages.length, 2);
assert.strictEqual(messy.activePageId, "a");
assert.strictEqual(messy.pages[0].name, "Mood log");
assert.deepStrictEqual(messy.pages[0].shapes, ["star"]);
assert.deepStrictEqual(messy.pages[0].colors, ["#ffffff", "#123456"]);
assert.deepStrictEqual(messy.pages[0].sel, { shape: "star", color: "#123456" });
assert.deepStrictEqual(messy.pages[0].legend, [{ shape: "star", color: "#ffffff", label: "Good day" }]);
assert.deepStrictEqual(messy.pages[0].days, { "2026-11-25": [{ s: "star", c: "#ffffff", x: 1, y: 0 }] });
assert.notStrictEqual(messy.pages[1].id, "a");
assert.strictEqual(messy.pages[1].name, "Page 2");
assert.deepStrictEqual(messy.pages[1].shapes, ["circle", "square", "star"]);

// Cleaning is stable: a second pass changes nothing.
assert.deepStrictEqual(L.sanitize(messy), messy);

console.log("stamp-book logic ok");
