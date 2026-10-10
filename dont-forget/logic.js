(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.DontForgetLogic = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var TOMBSTONE_MS = 30 * 24 * 60 * 60 * 1000;
  var MAX_NAME = 80;
  var MAX_LOCATION = 120;
  var MAX_DISPLAY_NAME = 32;

  function stamp(value) {
    var t = Date.parse(value || "");
    return isNaN(t) ? 0 : t;
  }

  function uid() {
    return "item-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  function normalizeText(text, max) {
    return String(text || "").trim().replace(/\s+/g, " ").slice(0, max || 140);
  }

  function normalizeDisplayName(name) {
    return normalizeText(name, MAX_DISPLAY_NAME);
  }

  function normalizeCode(code) {
    return String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  }

  function codeError(code) {
    var c = normalizeCode(code);
    if (c.length < 4) return "Use 4–12 letters or numbers.";
    return "";
  }

  function normalizePin(pin) {
    return String(pin || "").replace(/\D/g, "").slice(0, 8);
  }

  function pinError(pin) {
    var p = normalizePin(pin);
    if (p.length < 4) return "Use a PIN of 4–8 digits.";
    return "";
  }

  function emptyData() {
    return { items: [] };
  }

  function normalizeHistoryEntry(entry) {
    if (!entry || typeof entry !== "object") return null;
    var location = normalizeText(entry.location, MAX_LOCATION);
    if (!location) return null;
    var at = entry.at || entry.recordedAt;
    if (!at) at = new Date().toISOString();
    return {
      location: location,
      at: at,
      by: normalizeDisplayName(entry.by || entry.author || ""),
    };
  }

  function buildHistoryFromLegacy(item) {
    var loc = normalizeText(item.location, MAX_LOCATION);
    if (!loc) return [];
    return [{
      location: loc,
      at: item.recordedAt || item.createdAt || new Date().toISOString(),
      by: normalizeDisplayName(item.by || ""),
    }];
  }

  function normalizeItem(it) {
    if (!it || !it.id) return null;
    var name = normalizeText(it.name, MAX_NAME);
    if (!name) return null;
    var history = [];
    (it.history || []).forEach(function (h) {
      var row = normalizeHistoryEntry(h);
      if (row) history.push(row);
    });
    if (!history.length) history = buildHistoryFromLegacy(it);
    if (!history.length) return null;
    history.sort(function (a, b) { return stamp(b.at) - stamp(a.at); });
    var latest = history[0];
    return {
      id: String(it.id),
      name: name,
      location: latest.location,
      recordedAt: latest.at,
      createdAt: it.createdAt || history[history.length - 1].at || latest.at,
      history: history,
      deletedAt: it.deletedAt || null,
    };
  }

  function activeItems(data) {
    return normalizeData(data).items.filter(function (it) { return !it.deletedAt; });
  }

  function normalizeData(raw) {
    var data = raw && typeof raw === "object" ? raw : emptyData();
    var items = [];
    (data.items || []).forEach(function (it) {
      var row = normalizeItem(it);
      if (row) items.push(row);
    });
    items.sort(function (a, b) { return stamp(b.recordedAt) - stamp(a.recordedAt); });
    return { items: items };
  }

  function canonical(raw) {
    var data = normalizeData(raw);
    data.items.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
    data.items.forEach(function (it) {
      it.history.sort(function (a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : 0; });
    });
    return data;
  }

  function sameData(a, b) {
    return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
  }

  function findItem(data, itemId) {
    var items = normalizeData(data).items;
    var i;
    for (i = 0; i < items.length; i++) {
      if (items[i].id === itemId) return items[i];
    }
    return null;
  }

  function mapItems(data, itemId, fn) {
    var next = normalizeData(data);
    next.items = next.items.map(function (it) {
      if (it.id !== itemId) return it;
      return fn(it);
    });
    return next;
  }

  function addItem(data, opts) {
    opts = opts || {};
    var now = opts.now || new Date().toISOString();
    var name = normalizeText(opts.name, MAX_NAME);
    var location = normalizeText(opts.location, MAX_LOCATION);
    var by = normalizeDisplayName(opts.by);
    if (!name || !location) return { data: normalizeData(data), item: null };
    var item = normalizeItem({
      id: opts.id || uid(),
      name: name,
      location: location,
      recordedAt: now,
      createdAt: now,
      history: [{ location: location, at: now, by: by }],
    });
    var next = normalizeData(data);
    next.items.unshift(item);
    return { data: next, item: item };
  }

  function updateLocation(data, itemId, location, by, now) {
    location = normalizeText(location, MAX_LOCATION);
    by = normalizeDisplayName(by);
    now = now || new Date().toISOString();
    if (!location) return { data: normalizeData(data), item: null };
    var next = mapItems(data, itemId, function (it) {
      var history = (it.history || []).slice();
      var last = history[0];
      if (last && last.location === location && stamp(last.at) > stamp(now) - 5000) {
        return it;
      }
      history.unshift({ location: location, at: now, by: by });
      return normalizeItem({
        id: it.id,
        name: it.name,
        createdAt: it.createdAt,
        history: history,
        deletedAt: it.deletedAt,
      });
    });
    return { data: next, item: findItem(next, itemId) };
  }

  function deleteItem(data, itemId, now) {
    now = now || new Date().toISOString();
    return mapItems(data, itemId, function (it) {
      it.deletedAt = now;
      return it;
    });
  }

  function pickNewer(a, b) {
    if (!a) return b;
    if (!b) return a;
    return stamp(a.recordedAt) >= stamp(b.recordedAt) ? a : b;
  }

  function mergeHistory(aHist, bHist) {
    var map = {};
    function take(h) {
      var row = normalizeHistoryEntry(h);
      if (!row) return;
      var key = row.at + "|" + row.location.toLowerCase() + "|" + row.by.toLowerCase();
      map[key] = row;
    }
    (aHist || []).forEach(take);
    (bHist || []).forEach(take);
    var out = Object.keys(map).map(function (k) { return map[k]; });
    out.sort(function (a, b) { return stamp(b.at) - stamp(a.at); });
    return out;
  }

  function mergeItems(aItems, bItems) {
    var map = {};
    function take(it) {
      var row = normalizeItem(it);
      if (!row) return;
      if (!map[row.id]) {
        map[row.id] = row;
        return;
      }
      var shell = pickNewer(map[row.id], row);
      var deletedAt = map[row.id].deletedAt && row.deletedAt
        ? (stamp(map[row.id].deletedAt) >= stamp(row.deletedAt) ? map[row.id].deletedAt : row.deletedAt)
        : (map[row.id].deletedAt || row.deletedAt);
      map[row.id] = normalizeItem({
        id: shell.id,
        name: shell.name,
        createdAt: map[row.id].createdAt && row.createdAt
          ? (stamp(map[row.id].createdAt) <= stamp(row.createdAt) ? map[row.id].createdAt : row.createdAt)
          : (map[row.id].createdAt || row.createdAt),
        history: mergeHistory(map[row.id].history, row.history),
        deletedAt: deletedAt,
      });
    }
    (aItems || []).forEach(take);
    (bItems || []).forEach(take);
    return Object.keys(map).map(function (id) { return map[id]; });
  }

  function mergeData(a, b) {
    return { items: mergeItems(a && a.items, b && b.items) };
  }

  function pruneData(raw, nowMs) {
    var now = typeof nowMs === "number" ? nowMs : Date.now();
    var data = normalizeData(raw);
    data.items = data.items.filter(function (it) {
      return !(it.deletedAt && now - stamp(it.deletedAt) > TOMBSTONE_MS);
    });
    return data;
  }

  function uniqueLocations(data) {
    var seen = {};
    var out = [];
    activeItems(data).forEach(function (it) {
      (it.history || []).forEach(function (h) {
        var v = h.location;
        var key = v.toLowerCase();
        if (!seen[key]) {
          seen[key] = true;
          out.push(v);
        }
      });
    });
    return out;
  }

  function previousLocations(item) {
    var it = normalizeItem(item);
    if (!it || !it.history || it.history.length < 2) return [];
    return it.history.slice(1);
  }

  return {
    emptyData: emptyData,
    normalizeData: normalizeData,
    normalizeItem: normalizeItem,
    normalizeDisplayName: normalizeDisplayName,
    normalizeCode: normalizeCode,
    codeError: codeError,
    normalizePin: normalizePin,
    pinError: pinError,
    canonical: canonical,
    sameData: sameData,
    activeItems: activeItems,
    findItem: findItem,
    addItem: addItem,
    updateLocation: updateLocation,
    deleteItem: deleteItem,
    mergeData: mergeData,
    pruneData: pruneData,
    uniqueLocations: uniqueLocations,
    previousLocations: previousLocations,
    stamp: stamp,
    uid: uid,
  };
});
