(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SharedListsLogic = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var CATEGORIES = [
    { id: "packing", label: "Packing" },
    { id: "grocery", label: "Grocery" },
    { id: "leaving", label: "Leaving the house" },
  ];
  var CATEGORY_ORDER = ["packing", "grocery", "leaving"];
  var TOMBSTONE_MS = 30 * 24 * 60 * 60 * 1000;

  function stamp(value) {
    var t = Date.parse(value || "");
    return isNaN(t) ? 0 : t;
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function normalizeText(text) {
    return String(text || "").trim().replace(/\s+/g, " ").slice(0, 140);
  }

  function normalizeKey(text) {
    return normalizeText(text).toLowerCase();
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
    return { lists: [] };
  }

  function categoryLabel(list) {
    if (!list) return "List";
    if (list.category === "custom") return normalizeText(list.customName) || "Other";
    var i;
    for (i = 0; i < CATEGORIES.length; i++) {
      if (CATEGORIES[i].id === list.category) return CATEGORIES[i].label;
    }
    return "Other";
  }

  function categoryKey(list) {
    if (!list) return "custom:other";
    if (list.category === "custom") return "custom:" + (normalizeKey(list.customName) || "other");
    if (list.category === "packing" || list.category === "grocery" || list.category === "leaving") {
      return list.category;
    }
    return "custom:" + (normalizeKey(list.category) || "other");
  }

  function normalizeItem(it) {
    if (!it || !it.id) return null;
    var text = normalizeText(it.text);
    if (!text) return null;
    var checked = !!it.checked && !it.deletedAt;
    return {
      id: String(it.id),
      text: text,
      checked: checked,
      createdAt: it.createdAt || new Date().toISOString(),
      updatedAt: it.updatedAt || it.createdAt || new Date().toISOString(),
      checkedAt: checked ? (it.checkedAt || it.updatedAt || null) : null,
      deletedAt: it.deletedAt || null,
    };
  }

  function normalizeList(list) {
    if (!list || !list.id) return null;
    var category = list.category === "packing" || list.category === "grocery" || list.category === "leaving"
      ? list.category
      : "custom";
    var customName = category === "custom" ? (normalizeText(list.customName || list.category) || "Other") : "";
    var items = [];
    (list.items || []).forEach(function (it) {
      var row = normalizeItem(it);
      if (row) items.push(row);
    });
    return {
      id: String(list.id),
      category: category,
      customName: customName,
      title: normalizeText(list.title),
      createdAt: list.createdAt || new Date().toISOString(),
      updatedAt: list.updatedAt || list.createdAt || new Date().toISOString(),
      deletedAt: list.deletedAt || null,
      items: items,
    };
  }

  function normalizeData(raw) {
    var data = raw && typeof raw === "object" ? raw : emptyData();
    var lists = [];
    (data.lists || []).forEach(function (list) {
      var row = normalizeList(list);
      if (row) lists.push(row);
    });
    return { lists: lists };
  }

  function canonical(raw) {
    var data = normalizeData(raw);
    data.lists.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
    data.lists.forEach(function (list) {
      list.items.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
    });
    return data;
  }

  function sameData(a, b) {
    return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
  }

  function activeLists(data) {
    return normalizeData(data).lists.filter(function (list) { return !list.deletedAt; });
  }

  function findList(data, listId) {
    var lists = normalizeData(data).lists;
    var i;
    for (i = 0; i < lists.length; i++) {
      if (lists[i].id === listId) return lists[i];
    }
    return null;
  }

  function visibleItems(items) {
    return (items || []).filter(function (it) { return it && !it.deletedAt; }).sort(function (a, b) {
      if (!!a.checked !== !!b.checked) return a.checked ? 1 : -1;
      if (!a.checked) return stamp(b.createdAt) - stamp(a.createdAt);
      return stamp(b.checkedAt || b.updatedAt) - stamp(a.checkedAt || a.updatedAt);
    });
  }

  function counts(list) {
    var open = 0;
    var done = 0;
    visibleItems(list && list.items).forEach(function (it) {
      if (it.checked) done += 1;
      else open += 1;
    });
    return { open: open, done: done };
  }

  function mapList(data, listId, fn) {
    var next = normalizeData(data);
    next.lists = next.lists.map(function (list) {
      if (list.id !== listId) return list;
      return fn(list);
    });
    return next;
  }

  function createList(data, opts) {
    opts = opts || {};
    var now = opts.now || new Date().toISOString();
    var category = opts.category === "packing" || opts.category === "grocery" || opts.category === "leaving"
      ? opts.category
      : "custom";
    var list = normalizeList({
      id: opts.id || uid(),
      category: category,
      customName: opts.customName || "",
      title: opts.title || "",
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      items: [],
    });
    var next = normalizeData(data);
    next.lists.push(list);
    return { data: next, list: list };
  }

  function setListTitle(data, listId, title, now) {
    now = now || new Date().toISOString();
    return mapList(data, listId, function (list) {
      list.title = normalizeText(title);
      list.updatedAt = now;
      return list;
    });
  }

  function deleteList(data, listId, now) {
    now = now || new Date().toISOString();
    return mapList(data, listId, function (list) {
      list.deletedAt = now;
      list.updatedAt = now;
      return list;
    });
  }

  function addItem(data, listId, text, now, id) {
    var clean = normalizeText(text);
    if (!clean) return { data: normalizeData(data), item: null };
    now = now || new Date().toISOString();
    var item = normalizeItem({
      id: id || uid(),
      text: clean,
      checked: false,
      createdAt: now,
      updatedAt: now,
      checkedAt: null,
      deletedAt: null,
    });
    var next = mapList(data, listId, function (list) {
      list.items.push(item);
      list.updatedAt = now;
      return list;
    });
    return { data: next, item: item };
  }

  function toggleItem(data, listId, itemId, now) {
    now = now || new Date().toISOString();
    return mapList(data, listId, function (list) {
      list.items = list.items.map(function (it) {
        if (it.id !== itemId || it.deletedAt) return it;
        var checked = !it.checked;
        it.checked = checked;
        it.checkedAt = checked ? now : null;
        it.updatedAt = now;
        return it;
      });
      list.updatedAt = now;
      return list;
    });
  }

  function removeItem(data, listId, itemId, now) {
    now = now || new Date().toISOString();
    return mapList(data, listId, function (list) {
      list.items = list.items.map(function (it) {
        if (it.id !== itemId) return it;
        it.deletedAt = now;
        it.updatedAt = now;
        return it;
      });
      list.updatedAt = now;
      return list;
    });
  }

  function takenKeys(list) {
    var keys = {};
    visibleItems(list.items).forEach(function (it) {
      keys[normalizeKey(it.text)] = true;
    });
    return keys;
  }

  function earlierLists(data, listId) {
    var current = findList(data, listId);
    if (!current || current.deletedAt) return [];
    var key = categoryKey(current);
    return activeLists(data).filter(function (list) {
      return list.id !== listId && categoryKey(list) === key;
    }).sort(function (a, b) {
      return stamp(b.createdAt) - stamp(a.createdAt);
    });
  }

  function groupLists(data) {
    var groups = [];
    var byKey = {};
    activeLists(data).forEach(function (list) {
      var key = categoryKey(list);
      if (!byKey[key]) {
        byKey[key] = { key: key, label: categoryLabel(list), lists: [] };
        groups.push(byKey[key]);
      }
      byKey[key].lists.push(list);
    });
    groups.forEach(function (group) {
      group.lists.sort(function (a, b) { return stamp(b.createdAt) - stamp(a.createdAt); });
    });
    groups.sort(function (a, b) {
      var ai = CATEGORY_ORDER.indexOf(a.key);
      var bi = CATEGORY_ORDER.indexOf(b.key);
      if (ai === -1) ai = 50;
      if (bi === -1) bi = 50;
      if (ai !== bi) return ai - bi;
      return a.label.localeCompare(b.label);
    });
    return groups;
  }

  function cloneItemsUnchecked(items, now, idFactory) {
    var made = [];
    items.forEach(function (it, index) {
      var when = new Date(stamp(now) - index * 1000).toISOString();
      made.push(normalizeItem({
        id: idFactory ? idFactory(it, index) : uid(),
        text: it.text,
        checked: false,
        createdAt: when,
        updatedAt: when,
        checkedAt: null,
        deletedAt: null,
      }));
    });
    return made;
  }

  function copyList(data, sourceId, itemIds, opts) {
    opts = opts || {};
    var source = findList(data, sourceId);
    if (!source || source.deletedAt) return { data: normalizeData(data), list: null, copied: 0 };
    var visible = visibleItems(source.items);
    var pick = null;
    if (itemIds) {
      pick = {};
      itemIds.forEach(function (id) { pick[id] = true; });
    }
    var chosen = visible.filter(function (it) { return !pick || pick[it.id]; });
    if (!chosen.length) return { data: normalizeData(data), list: null, copied: 0 };
    var now = opts.now || new Date().toISOString();
    var title = normalizeText(opts.title);
    if (!title) title = source.title ? ("Copy of " + source.title) : categoryLabel(source);
    var created = createList(data, {
      id: opts.id,
      category: source.category,
      customName: source.customName,
      title: title,
      now: now,
    });
    created.list.items = cloneItemsUnchecked(chosen, now, opts.itemId);
    created.list.updatedAt = now;
    created.data = mapList(created.data, created.list.id, function () { return created.list; });
    return { data: created.data, list: created.list, copied: chosen.length };
  }

  function addFromList(data, targetId, sourceId, itemIds, opts) {
    opts = opts || {};
    var target = findList(data, targetId);
    var source = findList(data, sourceId);
    if (!target || target.deletedAt || !source) {
      return { data: normalizeData(data), added: 0, skipped: 0 };
    }
    var visible = visibleItems(source.items);
    var pick = null;
    if (itemIds) {
      pick = {};
      itemIds.forEach(function (id) { pick[id] = true; });
    }
    var keys = takenKeys(target);
    var nowBase = stamp(opts.now || new Date().toISOString());
    var added = 0;
    var skipped = 0;
    var made = [];
    visible.forEach(function (it) {
      if (pick && !pick[it.id]) return;
      var key = normalizeKey(it.text);
      if (keys[key]) {
        skipped += 1;
        return;
      }
      keys[key] = true;
      var when = new Date(nowBase - added * 1000).toISOString();
      made.push(normalizeItem({
        id: opts.itemId ? opts.itemId(it, added) : uid(),
        text: it.text,
        checked: false,
        createdAt: when,
        updatedAt: when,
        checkedAt: null,
        deletedAt: null,
      }));
      added += 1;
    });
    if (!added) return { data: normalizeData(data), added: 0, skipped: skipped };
    var next = mapList(data, targetId, function (list) {
      made.forEach(function (it) { list.items.push(it); });
      list.updatedAt = new Date(nowBase).toISOString();
      return list;
    });
    return { data: next, added: added, skipped: skipped };
  }

  function pickNewer(a, b) {
    if (!a) return b;
    if (!b) return a;
    return stamp(a.updatedAt) >= stamp(b.updatedAt) ? a : b;
  }

  function mergeItems(aItems, bItems) {
    var map = {};
    function take(it) {
      var row = normalizeItem(it);
      if (!row) return;
      map[row.id] = pickNewer(map[row.id], row);
    }
    (aItems || []).forEach(take);
    (bItems || []).forEach(take);
    return Object.keys(map).map(function (id) { return map[id]; });
  }

  function mergeData(a, b) {
    var map = {};
    function take(list) {
      var row = normalizeList(list);
      if (!row) return;
      if (!map[row.id]) {
        map[row.id] = row;
        return;
      }
      var shell = pickNewer(map[row.id], row);
      map[row.id] = normalizeList({
        id: shell.id,
        category: shell.category,
        customName: shell.customName,
        title: shell.title,
        createdAt: shell.createdAt,
        updatedAt: shell.updatedAt,
        deletedAt: shell.deletedAt,
        items: mergeItems(map[row.id].items, row.items),
      });
    }
    (a && a.lists || []).forEach(take);
    (b && b.lists || []).forEach(take);
    return { lists: Object.keys(map).map(function (id) { return map[id]; }) };
  }

  function pruneData(raw, nowMs) {
    var now = typeof nowMs === "number" ? nowMs : Date.now();
    var data = normalizeData(raw);
    data.lists = data.lists.filter(function (list) {
      if (list.deletedAt && now - stamp(list.deletedAt) > TOMBSTONE_MS) return false;
      list.items = list.items.filter(function (it) {
        return !(it.deletedAt && now - stamp(it.deletedAt) > TOMBSTONE_MS);
      });
      return true;
    });
    return data;
  }

  function displayTitle(list) {
    if (!list) return "List";
    return list.title || categoryLabel(list);
  }

  return {
    CATEGORIES: CATEGORIES,
    normalizeText: normalizeText,
    normalizeKey: normalizeKey,
    normalizeCode: normalizeCode,
    codeError: codeError,
    normalizePin: normalizePin,
    pinError: pinError,
    emptyData: emptyData,
    normalizeData: normalizeData,
    canonical: canonical,
    sameData: sameData,
    categoryLabel: categoryLabel,
    categoryKey: categoryKey,
    activeLists: activeLists,
    findList: findList,
    visibleItems: visibleItems,
    counts: counts,
    createList: createList,
    setListTitle: setListTitle,
    deleteList: deleteList,
    addItem: addItem,
    toggleItem: toggleItem,
    removeItem: removeItem,
    earlierLists: earlierLists,
    groupLists: groupLists,
    copyList: copyList,
    addFromList: addFromList,
    mergeData: mergeData,
    pruneData: pruneData,
    displayTitle: displayTitle,
    stamp: stamp,
  };
});
