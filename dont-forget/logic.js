(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.DontForgetLogic = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var TOMBSTONE_MS = 30 * 24 * 60 * 60 * 1000;
  var MAX_NAME = 80;
  var MAX_LOCATION = 120;
  var MAX_DISPLAY_NAME = 32;
  var MAX_COMMENT = 280;

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

  function commentId() {
    return "cmt-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  function normalizeLookingForRaw(lf) {
    if (!lf || typeof lf !== "object") return null;
    var at = lf.at || lf.since;
    if (!at) return null;
    return {
      active: !!lf.active,
      at: at,
      by: normalizeDisplayName(lf.by),
    };
  }

  function normalizeLookingFor(lf) {
    var row = normalizeLookingForRaw(lf);
    if (!row || !row.active) return null;
    return { active: true, at: row.at, by: row.by };
  }

  function normalizeComment(c) {
    if (!c || typeof c !== "object") return null;
    var text = normalizeText(c.text, MAX_COMMENT);
    if (!text) return null;
    var at = c.at || new Date().toISOString();
    return {
      id: String(c.id || commentId()),
      text: text,
      at: at,
      by: normalizeDisplayName(c.by),
    };
  }

  function normalizeComments(list) {
    var out = [];
    (list || []).forEach(function (c) {
      var row = normalizeComment(c);
      if (row) out.push(row);
    });
    out.sort(function (a, b) { return stamp(a.at) - stamp(b.at); });
    return out;
  }

  function mergeLookingFor(a, b) {
    var ra = normalizeLookingForRaw(a);
    var rb = normalizeLookingForRaw(b);
    if (!ra) return rb && rb.active ? { active: true, at: rb.at, by: rb.by } : null;
    if (!rb) return ra.active ? { active: true, at: ra.at, by: ra.by } : null;
    var pick = stamp(ra.at) >= stamp(rb.at) ? ra : rb;
    return pick.active ? { active: true, at: pick.at, by: pick.by } : null;
  }

  function mergeComments(aList, bList) {
    var map = {};
    function take(c) {
      var row = normalizeComment(c);
      if (!row) return;
      var prev = map[row.id];
      if (!prev || stamp(row.at) >= stamp(prev.at)) map[row.id] = row;
    }
    (aList || []).forEach(take);
    (bList || []).forEach(take);
    var out = Object.keys(map).map(function (id) { return map[id]; });
    out.sort(function (a, b) { return stamp(a.at) - stamp(b.at); });
    return out;
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
    var lookingFor = normalizeLookingFor(it.lookingFor);
    return {
      id: String(it.id),
      name: name,
      location: latest.location,
      recordedAt: latest.at,
      createdAt: it.createdAt || history[history.length - 1].at || latest.at,
      history: history,
      lookingFor: lookingFor,
      comments: normalizeComments(it.comments),
      deletedAt: it.deletedAt || null,
    };
  }

  function activeItems(data) {
    return normalizeData(data).items.filter(function (it) { return !it.deletedAt; });
  }

  function itemsForDisplay(items, viewerName) {
    viewerName = normalizeDisplayName(viewerName);
    var list = (items || []).slice();
    list.sort(function (a, b) {
      var aLf = a.lookingFor;
      var bLf = b.lookingFor;
      var aRank = aLf ? (aLf.by && aLf.by.toLowerCase() === viewerName.toLowerCase() ? 1 : 0) : 2;
      var bRank = bLf ? (bLf.by && bLf.by.toLowerCase() === viewerName.toLowerCase() ? 1 : 0) : 2;
      if (aRank !== bRank) return aRank - bRank;
      if (aRank < 2 && bRank < 2) {
        var d = stamp(bLf.at) - stamp(aLf.at);
        if (d) return d;
      }
      return stamp(b.recordedAt) - stamp(a.recordedAt);
    });
    return list;
  }

  function lookingForAlerts(items, viewerName) {
    viewerName = normalizeDisplayName(viewerName);
    return itemsForDisplay(
      (items || []).filter(function (it) { return it.lookingFor && it.lookingFor.active; }),
      viewerName
    ).filter(function (it) {
      return it.lookingFor && it.lookingFor.by &&
        it.lookingFor.by.toLowerCase() !== viewerName.toLowerCase();
    });
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
      it.comments.sort(function (a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : 0; });
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
        lookingFor: it.lookingFor,
        comments: it.comments,
        deletedAt: it.deletedAt,
      });
    });
    return { data: next, item: findItem(next, itemId) };
  }

  function setLookingFor(data, itemId, active, by, now) {
    by = normalizeDisplayName(by);
    now = now || new Date().toISOString();
    var next = mapItems(data, itemId, function (it) {
      var lf = active
        ? { active: true, at: now, by: by }
        : { active: false, at: now, by: by };
      return normalizeItem({
        id: it.id,
        name: it.name,
        createdAt: it.createdAt,
        history: it.history,
        lookingFor: lf,
        comments: it.comments,
        deletedAt: it.deletedAt,
      });
    });
    return { data: next, item: findItem(next, itemId) };
  }

  function addComment(data, itemId, text, by, now) {
    text = normalizeText(text, MAX_COMMENT);
    by = normalizeDisplayName(by);
    now = now || new Date().toISOString();
    if (!text) return { data: normalizeData(data), item: null };
    var next = mapItems(data, itemId, function (it) {
      var comments = (it.comments || []).slice();
      comments.push({ id: commentId(), text: text, at: now, by: by });
      return normalizeItem({
        id: it.id,
        name: it.name,
        createdAt: it.createdAt,
        history: it.history,
        lookingFor: it.lookingFor,
        comments: comments,
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
        lookingFor: mergeLookingFor(map[row.id].lookingFor, row.lookingFor),
        comments: mergeComments(map[row.id].comments, row.comments),
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
    itemsForDisplay: itemsForDisplay,
    lookingForAlerts: lookingForAlerts,
    setLookingFor: setLookingFor,
    addComment: addComment,
    stamp: stamp,
    uid: uid,
  };
});
