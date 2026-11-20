"use strict";

var L = require("./logic.js");

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assert failed");
}

(function testHistory() {
  var r = L.addItem(L.emptyData(), { name: "Passports", location: "Bedroom desk", by: "Mike" });
  assert(r.item && r.item.history.length === 1, "history on create");
  var u = L.updateLocation(r.data, r.item.id, "Kitchen drawer", "Sarah");
  assert(u.item.location === "Kitchen drawer", "location updates");
  assert(u.item.history.length === 2, "history grows");
  var prev = L.previousLocations(u.item);
  assert(prev.length === 1 && prev[0].location === "Bedroom desk", "previous locations");
})();

(function testMerge() {
  var a = L.addItem(L.emptyData(), { id: "x1", name: "Keys", location: "A", by: "A", now: "2026-10-10T10:00:00.000Z" });
  var b = L.addItem(L.emptyData(), { id: "x1", name: "Keys", location: "B", by: "B", now: "2026-10-10T11:00:00.000Z" });
  var m = L.mergeData(a.data, b.data);
  var it = L.findItem(m, "x1");
  assert(it.location === "B", "newer location wins");
  assert(it.history.length >= 2, "merged history");
})();

(function testLookingFor() {
  var r = L.addItem(L.emptyData(), { name: "Keys", location: "Garage", by: "A" });
  var on = L.setLookingFor(r.data, r.item.id, true, "Sarah", "2026-10-11T12:00:00.000Z");
  assert(on.item.lookingFor && on.item.lookingFor.by === "Sarah", "looking for set");
  var note = L.addComment(on.data, r.item.id, "Last seen on hook", "Sarah");
  assert(note.item.comments.length === 1, "comment added");
  var alerts = L.lookingForAlerts(L.activeItems(note.data), "Mike");
  assert(alerts.length === 1, "alert for other user");
})();

console.log("dont-forget logic: ok");
