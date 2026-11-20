"use strict";

var assert = require("assert");
var L = require("../shared-lists/logic.js");
var P = require("./logic.js");

var t0 = "2026-11-01T15:00:00.000Z";
var t1 = "2026-11-02T15:00:00.000Z";
var t2 = "2026-11-03T15:00:00.000Z";

function beach() {
  var trip = P.createTrip(L.emptyData(), { id: "beach", title: "Beach", now: t0 });
  var withSocks = L.addItem(trip.data, "beach", "Socks", t0, "socks");
  var checked = L.toggleItem(withSocks.data, "beach", "socks", t0);
  var withBook = L.addItem(checked, "beach", "Book", t0, "book");
  var grocery = L.createList(withBook.data, {
    id: "groceries",
    category: "grocery",
    title: "Store",
    now: t0,
  });
  var milk = L.addItem(grocery.data, "groceries", "Milk", t0, "milk");
  return L.toggleItem(milk.data, "groceries", "milk", t0);
}

var data = beach();
assert.strictEqual(P.packingLists(data).length, 1);
assert.strictEqual(L.findList(data, "groceries").category, "grocery");

var past = P.pastPackedItems(data);
assert.deepStrictEqual(past.map(function (row) { return row.key; }), ["socks", "book"]);
assert.strictEqual(past[0].timesPacked, 1);
assert.strictEqual(past[1].timesPacked, 0);
assert.deepStrictEqual(P.defaultPastKeys(past), ["socks"]);
assert.strictEqual(P.pastMeta(past[0]), "Packed 1× · Beach");
assert.strictEqual(P.pastMeta(past[1]), "Listed on Beach");
assert.ok(!past.some(function (row) { return row.key === "milk"; }));

var city = P.createTrip(data, { id: "city", title: "City", now: t1 });
var citySocks = L.addItem(city.data, "city", "socks", t1, "city-socks");
var packedAgain = L.toggleItem(citySocks.data, "city", "city-socks", t1);
var again = P.pastPackedItems(packedAgain);
assert.strictEqual(again[0].key, "socks");
assert.strictEqual(again[0].timesPacked, 2);
assert.strictEqual(again[0].text, "socks");
assert.strictEqual(P.pastMeta(again[0]), "Packed 2× · City");

var next = P.createTripFromPast(packedAgain, { id: "next", title: "Mom's", now: t2 });
assert.strictEqual(next.added, 1);
var nextItems = L.visibleItems(next.list.items);
assert.deepStrictEqual(nextItems.map(function (it) { return it.text; }), ["socks"]);
assert.ok(nextItems.every(function (it) { return !it.checked; }));
assert.strictEqual(L.findList(next.data, "groceries").items.filter(function (it) {
  return it.id === "milk";
})[0].checked, true);

var both = P.createTripFromPast(packedAgain, { id: "both", title: "Both", now: t2 }, ["socks", "book"]);
assert.deepStrictEqual(L.visibleItems(both.list.items).map(function (it) { return L.normalizeKey(it.text); }), ["socks", "book"]);

var onlyListed = P.createTrip(L.emptyData(), { id: "listed", title: "Listed", now: t0 });
var bookOnly = L.addItem(onlyListed.data, "listed", "Book", t0, "only-book");
var listedPast = P.pastPackedItems(bookOnly.data);
assert.deepStrictEqual(P.defaultPastKeys(listedPast), ["book"]);

var removed = L.removeItem(data, "beach", "book", t1);
assert.ok(!P.pastPackedItems(removed).some(function (row) { return row.key === "book"; }));

var deleted = L.deleteList(data, "beach", t1);
assert.strictEqual(P.pastPackedItems(deleted).length, 0);
assert.ok(L.findList(deleted, "groceries"));

var usual = P.createTrip(L.emptyData(), { id: "usual", title: "First", now: t0, usual: true });
assert.strictEqual(usual.added, P.USUAL.length);
assert.strictEqual(L.visibleItems(usual.list.items)[0].text, P.USUAL[0]);
assert.strictEqual(L.visibleItems(usual.list.items)[P.USUAL.length - 1].text, P.USUAL[P.USUAL.length - 1]);
var firstId = L.visibleItems(usual.list.items)[0].id;
var phoneA = L.addItem(usual.data, "usual", "Sun hat", t1, "hat");
var phoneB = L.toggleItem(usual.data, "usual", firstId, t1);
var merged = L.mergeData(phoneA.data, phoneB);
assert.strictEqual(P.hasItem(L.findList(merged, "usual"), "Sun hat"), true);
assert.strictEqual(L.findList(merged, "usual").items.filter(function (it) { return it.id === firstId; })[0].checked, true);

var extra = P.addPastToTrip(next.data, "next", ["book"], { now: t2 });
assert.strictEqual(extra.added, 1);
assert.strictEqual(P.hasItem(extra.list, "Book"), true);
var dup = P.addPastToTrip(extra.data, "next", ["book", "socks"], { now: t2 });
assert.strictEqual(dup.added, 0);

var missing = P.missingPast(next.data, "next");
assert.ok(missing.some(function (row) { return row.key === "book"; }));
assert.ok(!missing.some(function (row) { return row.key === "socks"; }));

console.log("trip-packing logic ok");
