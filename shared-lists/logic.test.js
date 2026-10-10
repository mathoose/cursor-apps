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

var styled = L.createList(L.emptyData(), {
  id: "prio",
  category: "custom",
  customName: "Priority",
  title: "Add to my priority",
  color: "pink",
  size: "small",
  repeatDays: ["fri", "mon", "tue", "wed", "thu"],
  now: t0,
});
assert.strictEqual(styled.list.color, "pink");
assert.strictEqual(styled.list.size, "small");
assert.strictEqual(L.repeatLabel(styled.list.repeatDays), "Mon–Fri");
assert.strictEqual(L.repeatsOn(styled.list, new Date("2026-10-10T15:00:00")), false);
assert.strictEqual(L.repeatsOn(styled.list, new Date("2026-10-12T15:00:00")), true);
var withItem = L.addItem(styled.data, "prio", "Call the school", t1, "call");
var copiedStyle = L.copyList(withItem.data, "prio", null, { now: t2, id: "prio-copy" });
assert.strictEqual(copiedStyle.list.color, "pink");
assert.strictEqual(copiedStyle.list.size, "small");
assert.strictEqual(copiedStyle.list.repeatDays.join(","), "mon,tue,wed,thu,fri");
var other = L.createList(styled.data, { id: "gro", category: "grocery", title: "Store", now: t1 });
assert.strictEqual(L.listsForPriority(other.data, "gro", new Date("2026-10-12T15:00:00"))[0].id, "prio");
var painted = L.setListStyle(styled.data, "prio", { color: "blue", size: "large" }, t2);
assert.strictEqual(L.findList(painted, "prio").color, "blue");
assert.strictEqual(L.findList(painted, "prio").size, "large");
assert.strictEqual(L.repeatLabel(L.findList(painted, "prio").repeatDays), "Mon–Fri");
var older = L.setListStyle(styled.data, "prio", { color: "mint" }, t0);
var newer = L.setListStyle(styled.data, "prio", { color: "peach" }, t2);
var kept = L.mergeData(older, newer);
assert.strictEqual(L.findList(kept, "prio").color, "peach");

var grocery = L.createGroceryStarter(L.emptyData(), { now: t0, id: "gro" });
assert.strictEqual(grocery.list.items.length, L.GROCERY_SUGGESTIONS.length);
assert.strictEqual(grocery.list.items[0].stock, "medium");
assert.strictEqual(grocery.list.items[0].usual, "yes");
var skip = L.setItemUsual(grocery.data, "gro", grocery.list.items[0].id, "no", t1);
assert.strictEqual(L.shopItems(L.findList(skip, "gro")).length, L.GROCERY_SUGGESTIONS.length - 1);
var cycled = L.cycleItemStock(skip, "gro", grocery.list.items[1].id, t2);
assert.strictEqual(L.findList(cycled, "gro").items[1].stock, "high");
var noted = L.setListCardNote(cycled, "gro", "Shopping after work ~5pm", t2);
assert.strictEqual(L.findList(noted, "gro").cardNote, "Shopping after work ~5pm");
assert.ok(L.formatLastChanged(t2, L.stamp(t2) + 120000).indexOf("m ago") !== -1);
assert.strictEqual(L.shouldOfferGroceryStarter(L.emptyData()), true);
assert.strictEqual(L.shouldOfferGroceryStarter(grocery.data), false);
var bought = L.toggleItem(grocery.data, "gro", grocery.list.items[2].id, t2);
var trip = L.createList(bought, { id: "trip", category: "grocery", title: "Saturday run", now: t2 });
var withEggs = L.addItem(trip.data, "trip", "Eggs", t2, "eggs");
var doneEggs = L.toggleItem(withEggs.data, "trip", "eggs", t2);
assert.strictEqual(L.groceryHistoryItems(doneEggs).length, 2);
var fromPast = L.createGroceryFromHistory(doneEggs, { now: "2026-10-11T12:00:00.000Z", id: "newgro" }, null);
assert.strictEqual(fromPast.copied, 2);
assert.strictEqual(L.shouldOfferGroceryStarter(fromPast.data), false);
assert.strictEqual(L.findList(fromPast.data, "newgro").items[0].checked, false);

console.log("shared-lists logic ok");
