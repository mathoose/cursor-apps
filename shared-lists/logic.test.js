"use strict";

var assert = require("assert");
var L = require("./logic.js");

var t0 = "2026-10-10T12:00:00.000Z";
var t1 = "2026-10-10T12:05:00.000Z";
var t2 = "2026-10-10T12:10:00.000Z";

function seed() {
  var created = L.createList(L.emptyData(), {
    id: "list-a",
    category: "grocery",
    title: "This week",
    now: t0,
  });
  var withMilk = L.addItem(created.data, "list-a", "Milk", t0, "milk");
  var withBread = L.addItem(withMilk.data, "list-a", "Bread", t1, "bread");
  return withBread.data;
}

var sorted = L.visibleItems(L.findList(seed(), "list-a").items);
assert.strictEqual(sorted.map(function (it) { return it.text; }).join(","), "Bread,Milk");

var checked = L.toggleItem(seed(), "list-a", "bread", t2);
var afterCheck = L.visibleItems(L.findList(checked, "list-a").items);
assert.deepStrictEqual(afterCheck.map(function (it) { return it.text + (it.checked ? ":done" : ""); }), ["Milk", "Bread:done"]);

var unchecked = L.toggleItem(checked, "list-a", "bread", "2026-10-10T12:15:00.000Z");
var back = L.visibleItems(L.findList(unchecked, "list-a").items);
assert.strictEqual(back[0].text, "Bread");
assert.strictEqual(back[0].checked, false);
assert.ok(back.every(function (it) { return !it.deletedAt; }));

var copiedAll = L.copyList(checked, "list-a", null, { now: t2, id: "list-b" });
assert.strictEqual(copiedAll.copied, 2);
assert.ok(copiedAll.list.items.every(function (it) { return !it.checked; }));
assert.strictEqual(copiedAll.list.category, "grocery");
assert.strictEqual(L.displayTitle(copiedAll.list), "Copy of This week");

var copiedSome = L.copyList(seed(), "list-a", ["milk"], { now: t2, id: "list-c" });
assert.strictEqual(copiedSome.copied, 1);
assert.strictEqual(copiedSome.list.items[0].text, "Milk");

var packing = L.createList(seed(), { id: "pack", category: "packing", title: "Beach", now: t1 });
var earlier = L.earlierLists(copiedAll.data, "list-b");
assert.strictEqual(earlier.length, 1);
assert.strictEqual(earlier[0].id, "list-a");
assert.strictEqual(L.earlierLists(packing.data, "pack").length, 0);

var added = L.addFromList(copiedAll.data, "list-b", "list-a", null, { now: "2026-10-10T13:00:00.000Z" });
assert.strictEqual(added.added, 0);
assert.strictEqual(added.skipped, 2);

var onlyMilk = L.copyList(seed(), "list-a", ["milk"], { now: t2, id: "list-d" });
var plus = L.addFromList(onlyMilk.data, "list-d", "list-a", null, { now: "2026-10-10T13:00:00.000Z" });
assert.strictEqual(plus.added, 1);
assert.strictEqual(plus.skipped, 1);
assert.strictEqual(L.visibleItems(L.findList(plus.data, "list-d").items)[0].text, "Bread");

var phoneA = L.addItem(seed(), "list-a", "Eggs", t2, "eggs");
var phoneB = L.toggleItem(seed(), "list-a", "milk", t2);
var merged = L.mergeData(phoneA.data, phoneB);
var names = L.visibleItems(L.findList(merged, "list-a").items).map(function (it) {
  return it.text + (it.checked ? ":done" : "");
});
assert.deepStrictEqual(names, ["Eggs", "Bread", "Milk:done"]);

var removed = L.removeItem(seed(), "list-a", "milk", t2);
var stale = seed();
var keepDelete = L.mergeData(removed, stale);
assert.ok(L.findList(keepDelete, "list-a").items.filter(function (it) { return it.id === "milk"; })[0].deletedAt);

assert.strictEqual(L.normalizeCode(" beach! "), "BEACH");
assert.strictEqual(L.codeError("ab"), "Use 4–12 letters or numbers.");
assert.strictEqual(L.codeError("home"), "");
assert.strictEqual(L.pinError("12"), "Use a PIN of 4–8 digits.");
assert.strictEqual(L.normalizePin("12-34"), "1234");

var groups = L.groupLists(packing.data);
assert.deepStrictEqual(groups.map(function (g) { return g.key; }), ["packing", "grocery"]);

var custom = L.createList(L.emptyData(), { id: "c1", category: "custom", customName: "Camping", now: t0 });
var custom2 = L.createList(custom.data, { id: "c2", category: "custom", customName: "camping", now: t1 });
assert.strictEqual(L.earlierLists(custom2.data, "c2")[0].id, "c1");

console.log("shared-lists logic ok");
