(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("../shared-lists/logic.js"));
  } else {
    root.TripPackingLogic = factory(root.SharedListsLogic);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (L) {
  "use strict";

  var USUAL = [
    "Phone charger",
    "Headphones",
    "Toothbrush",
    "Toothpaste",
    "Medications",
    "Deodorant",
    "Underwear",
    "Socks",
    "Shirts",
    "Pants or shorts",
    "Pajamas",
    "Passport or ID",
  ];

  function packingLists(data) {
    return L.activeLists(data).filter(function (list) {
      return list.category === "packing";
    }).sort(function (a, b) {
      return L.stamp(b.createdAt) - L.stamp(a.createdAt);
    });
  }

  function hasItem(list, text) {
    var key = L.normalizeKey(text);
    if (!key || !list) return false;
    return L.visibleItems(list.items).some(function (it) {
      return L.normalizeKey(it.text) === key;
    });
  }

  function pastPackedItems(data, exceptListId) {
    var map = {};
    packingLists(data).forEach(function (list) {
      if (exceptListId && list.id === exceptListId) return;
      var title = L.displayTitle(list);
      L.visibleItems(list.items).forEach(function (it) {
        var key = L.normalizeKey(it.text);
        if (!key) return;
        if (!map[key]) {
          map[key] = {
            key: key,
            text: it.text,
            timesListed: 0,
            timesPacked: 0,
            lastTripTitle: title,
            lastAt: "",
            lastPackedAt: "",
          };
        }
        var row = map[key];
        row.timesListed += 1;
        if (it.checked) {
          var packedAt = it.checkedAt || it.updatedAt || list.updatedAt;
          row.timesPacked += 1;
          if (L.stamp(packedAt) >= L.stamp(row.lastPackedAt)) {
            row.lastPackedAt = packedAt;
            row.lastAt = packedAt;
            row.text = it.text;
            row.lastTripTitle = title;
          }
          return;
        }
        var seenAt = it.updatedAt || list.updatedAt;
        if (!row.lastPackedAt && L.stamp(seenAt) >= L.stamp(row.lastAt)) {
          row.lastAt = seenAt;
          row.text = it.text;
          row.lastTripTitle = title;
        }
      });
    });
    return Object.keys(map).map(function (key) { return map[key]; }).sort(function (a, b) {
      if (b.timesPacked !== a.timesPacked) return b.timesPacked - a.timesPacked;
      if (b.timesListed !== a.timesListed) return b.timesListed - a.timesListed;
      return L.stamp(b.lastAt) - L.stamp(a.lastAt);
    });
  }

  function missingPast(data, listId) {
    var list = L.findList(data, listId);
    var have = {};
    if (list) {
      L.visibleItems(list.items).forEach(function (it) {
        have[L.normalizeKey(it.text)] = true;
      });
    }
    return pastPackedItems(data, listId).filter(function (row) {
      return !have[row.key];
    });
  }

  function defaultPastKeys(rows) {
    var packed = (rows || []).filter(function (row) { return row.timesPacked > 0; });
    var source = packed.length ? packed : (rows || []);
    return source.map(function (row) { return row.key; });
  }

  function pastMeta(row) {
    var trip = row.lastTripTitle || "a past trip";
    if (row.timesPacked > 0 && row.timesListed > row.timesPacked) {
      return "Packed " + row.timesPacked + "× · listed " + row.timesListed + "× · " + trip;
    }
    if (row.timesPacked > 0) {
      return "Packed " + row.timesPacked + "× · " + trip;
    }
    return "Listed on " + trip;
  }

  function addNamedItems(data, listId, texts, opts) {
    opts = opts || {};
    var list = L.findList(data, listId);
    if (!list || list.deletedAt) return { data: L.normalizeData(data), added: 0, list: null };
    var have = {};
    L.visibleItems(list.items).forEach(function (it) {
      have[L.normalizeKey(it.text)] = true;
    });
    var pending = [];
    (texts || []).forEach(function (text) {
      var key = L.normalizeKey(text);
      if (!key || have[key]) return;
      have[key] = true;
      pending.push(text);
    });
    var base = L.stamp(opts.now || new Date().toISOString()) || Date.now();
    var next = data;
    var added = 0;
    pending.forEach(function (text, index) {
      var when = new Date(base + (pending.length - index) * 1000).toISOString();
      var res = L.addItem(next, listId, text, when, opts.ids ? opts.ids[added] : undefined);
      if (!res.item) return;
      next = res.data;
      added += 1;
    });
    return { data: next, added: added, list: L.findList(next, listId) };
  }

  function createTrip(data, opts) {
    opts = opts || {};
    var created = L.createList(data, {
      id: opts.id,
      category: "packing",
      title: opts.title || "",
      color: "blue",
      now: opts.now,
    });
    if (!opts.usual) return { data: created.data, list: created.list, added: 0 };
    var filled = addNamedItems(created.data, created.list.id, USUAL, {
      now: opts.now,
      ids: opts.itemIds,
    });
    return { data: filled.data, list: filled.list, added: filled.added };
  }

  function createTripFromPast(data, opts, keys) {
    opts = opts || {};
    var history = pastPackedItems(data, null);
    var pick = {};
    var chosenKeys = keys == null ? defaultPastKeys(history) : keys;
    chosenKeys.forEach(function (key) { pick[key] = true; });
    var texts = [];
    history.forEach(function (row) {
      if (pick[row.key]) texts.push(row.text);
    });
    var created = L.createList(data, {
      id: opts.id,
      category: "packing",
      title: opts.title || "",
      color: "blue",
      now: opts.now,
    });
    var filled = addNamedItems(created.data, created.list.id, texts, {
      now: opts.now,
      ids: opts.itemIds,
    });
    return { data: filled.data, list: filled.list, added: filled.added };
  }

  function addPastToTrip(data, listId, keys, opts) {
    opts = opts || {};
    var history = missingPast(data, listId);
    var pick = null;
    if (keys) {
      pick = {};
      keys.forEach(function (key) { pick[key] = true; });
    }
    var texts = [];
    history.forEach(function (row) {
      if (pick && !pick[row.key]) return;
      texts.push(row.text);
    });
    return addNamedItems(data, listId, texts, opts);
  }

  return {
    USUAL: USUAL,
    packingLists: packingLists,
    hasItem: hasItem,
    pastPackedItems: pastPackedItems,
    missingPast: missingPast,
    defaultPastKeys: defaultPastKeys,
    pastMeta: pastMeta,
    createTrip: createTrip,
    createTripFromPast: createTripFromPast,
    addPastToTrip: addPastToTrip,
  };
});
