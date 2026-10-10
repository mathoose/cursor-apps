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
  var COLORS = [
    { id: "butter", label: "Butter" },
    { id: "pink", label: "Pink" },
    { id: "mint", label: "Mint" },
    { id: "blue", label: "Blue" },
    { id: "peach", label: "Peach" },
    { id: "lilac", label: "Lilac" },
  ];
  var SIZES = [
    { id: "small", label: "Slip" },
    { id: "medium", label: "Page" },
    { id: "large", label: "Pad" },
  ];
  var DAYS = [
    { id: "sun", label: "Sun" },
    { id: "mon", label: "Mon" },
    { id: "tue", label: "Tue" },
    { id: "wed", label: "Wed" },
    { id: "thu", label: "Thu" },
    { id: "fri", label: "Fri" },
    { id: "sat", label: "Sat" },
  ];
  var WEEKDAYS = ["mon", "tue", "wed", "thu", "fri"];
  var DAY_INDEX = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  var TOMBSTONE_MS = 30 * 24 * 60 * 60 * 1000;
  var GROCERY_SUGGESTIONS = [
    "Milk", "Eggs", "Bread", "Butter", "Cheese", "Yogurt", "Coffee", "Bananas", "Apples",
    "Salad greens", "Onions", "Garlic", "Chicken", "Ground beef", "Pasta", "Rice",
    "Cereal", "Orange juice", "Snacks", "Ice cream", "Toilet paper", "Paper towels",
    "Dish soap", "Laundry detergent", "Trash bags",
  ];
  var STOCK_CYCLE = ["low", "medium", "high"];

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

  function normalizeCardNote(text) {
    return String(text || "").trim().replace(/\s+/g, " ").slice(0, 280);
  }

  function normalizeCardNoteEntry(entry, fallbackWhen) {
    if (!entry || !entry.id) return null;
    var text = normalizeCardNote(entry.text);
    if (!text) return null;
    return {
      id: String(entry.id),
      text: text,
      createdAt: entry.createdAt || fallbackWhen || new Date().toISOString(),
    };
  }

  function normalizeCardNotes(list) {
    var notes = [];
    (list.cardNotes || []).forEach(function (entry) {
      var row = normalizeCardNoteEntry(entry, list.updatedAt || list.createdAt);
      if (row) notes.push(row);
    });
    if (!notes.length && list.cardNote) {
      var legacy = normalizeCardNote(list.cardNote);
      if (legacy) {
        notes.push({
          id: String(list.id || "note") + "-legacy",
          text: legacy,
          createdAt: list.updatedAt || list.createdAt || new Date().toISOString(),
        });
      }
    }
    notes.sort(function (a, b) { return stamp(a.createdAt) - stamp(b.createdAt); });
    return notes;
  }

  function mergeCardNotes(aList, bList) {
    var map = {};
    function take(entry, fallbackWhen) {
      var row = normalizeCardNoteEntry(entry, fallbackWhen);
      if (!row) return;
      if (!map[row.id] || stamp(row.createdAt) >= stamp(map[row.id].createdAt)) map[row.id] = row;
    }
    normalizeCardNotes(aList || {}).forEach(function (n) { take(n, n.createdAt); });
    normalizeCardNotes(bList || {}).forEach(function (n) { take(n, n.createdAt); });
    return Object.keys(map).map(function (id) { return map[id]; }).sort(function (a, b) {
      return stamp(a.createdAt) - stamp(b.createdAt);
    });
  }

  function latestCardNote(list) {
    var notes = normalizeCardNotes(list);
    return notes.length ? notes[notes.length - 1] : null;
  }

  function normalizeUsual(value) {
    if (value === "sometimes" || value === "no") return value;
    return "yes";
  }

  function normalizeStock(value) {
    if (value === "low" || value === "medium" || value === "high") return value;
    return null;
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
    return { lists: [], meta: { groceryStarterUsed: false } };
  }

  function normalizeMeta(raw, lists) {
    var meta = raw && raw.meta && typeof raw.meta === "object" ? raw.meta : {};
    var used = !!meta.groceryStarterUsed;
    if (!used && lists && lists.length) {
      var i;
      for (i = 0; i < lists.length; i++) {
        if (lists[i].category === "grocery") {
          used = true;
          break;
        }
      }
    }
    if (!used && raw && Array.isArray(raw.lists)) {
      raw.lists.forEach(function (list) {
        if (list && list.category === "grocery") used = true;
      });
    }
    return { groceryStarterUsed: used };
  }

  function withMeta(data, patch) {
    var next = normalizeData(data);
    next.meta = Object.assign({}, next.meta, patch || {});
    return next;
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
      usual: normalizeUsual(it.usual),
      stock: normalizeStock(it.stock),
      createdAt: it.createdAt || new Date().toISOString(),
      updatedAt: it.updatedAt || it.createdAt || new Date().toISOString(),
      checkedAt: checked ? (it.checkedAt || it.updatedAt || null) : null,
      deletedAt: it.deletedAt || null,
    };
  }

  function defaultColor(id) {
    var n = 0;
    String(id || "note").split("").forEach(function (ch) { n += ch.charCodeAt(0); });
    return COLORS[n % COLORS.length].id;
  }

  function normalizeColor(color, id) {
    var i;
    for (i = 0; i < COLORS.length; i++) {
      if (COLORS[i].id === color) return color;
    }
    return defaultColor(id);
  }

  function normalizeSize(size) {
    if (size === "medium" || size === "large") return size;
    return "small";
  }

  function normalizeRepeatDays(days) {
    var seen = {};
    var out = [];
    (days || []).forEach(function (day) {
      var id = String(day || "").toLowerCase().slice(0, 3);
      if (!Object.prototype.hasOwnProperty.call(DAY_INDEX, id) || seen[id]) return;
      seen[id] = true;
      out.push(id);
    });
    out.sort(function (a, b) { return DAY_INDEX[a] - DAY_INDEX[b]; });
    return out;
  }

  function repeatLabel(days) {
    var list = normalizeRepeatDays(days);
    if (!list.length) return "";
    if (list.length === 7) return "Every day";
    if (list.join(",") === WEEKDAYS.join(",")) return "Mon–Fri";
    return list.map(function (id) {
      var i;
      for (i = 0; i < DAYS.length; i++) if (DAYS[i].id === id) return DAYS[i].label;
      return id;
    }).join(" ");
  }

  function dayId(date) {
    var names = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    var d = date instanceof Date ? date : new Date();
    return names[d.getDay()];
  }

  function repeatsOn(list, date) {
    var days = normalizeRepeatDays(list && list.repeatDays);
    if (!days.length) return false;
    return days.indexOf(dayId(date)) !== -1;
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
    var id = String(list.id);
    return {
      id: id,
      category: category,
      customName: customName,
      title: normalizeText(list.title),
      color: normalizeColor(list.color, id),
      size: normalizeSize(list.size),
      repeatDays: normalizeRepeatDays(list.repeatDays),
      cardNotes: normalizeCardNotes(list),
      createdAt: list.createdAt || new Date().toISOString(),
      updatedAt: list.updatedAt || list.createdAt || new Date().toISOString(),
      deletedAt: list.deletedAt || null,
      items: items,
    };
  }

  function formatLastChanged(iso, nowMs) {
    var t = stamp(iso);
    if (!t) return "";
    var now = typeof nowMs === "number" ? nowMs : Date.now();
    var diff = now - t;
    if (diff < 45000) return "just now";
    if (diff < 3600000) return Math.floor(diff / 60000) + "m ago";
    if (diff < 86400000) return Math.floor(diff / 3600000) + "h ago";
    if (diff < 604800000) return Math.floor(diff / 86400000) + "d ago";
    try {
      return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    } catch (e) {
      return "";
    }
  }

  function isGroceryList(list) {
    return !!(list && list.category === "grocery");
  }

  function shopItems(list) {
    return visibleItems(list && list.items).filter(function (it) {
      return it.usual !== "no";
    });
  }

  function nextStock(stock) {
    var cur = normalizeStock(stock);
    if (!cur) return "low";
    var i = STOCK_CYCLE.indexOf(cur);
    return STOCK_CYCLE[(i + 1) % STOCK_CYCLE.length];
  }

  function normalizeData(raw) {
    var data = raw && typeof raw === "object" ? raw : emptyData();
    var lists = [];
    (data.lists || []).forEach(function (list) {
      var row = normalizeList(list);
      if (row) lists.push(row);
    });
    return { lists: lists, meta: normalizeMeta(data, lists) };
  }

  function shouldOfferGroceryStarter(data) {
    return !normalizeData(data).meta.groceryStarterUsed;
  }

  function groceryHistoryItems(data) {
    var map = {};
    normalizeData(data).lists.forEach(function (list) {
      if (list.category !== "grocery") return;
      var listTitle = displayTitle(list);
      var tripAt = list.updatedAt;
      (list.items || []).forEach(function (it) {
        if (!it || it.deletedAt || !it.checked) return;
        var key = normalizeKey(it.text);
        var checkedAt = it.checkedAt || it.updatedAt;
        if (!map[key]) {
          map[key] = {
            key: key,
            text: it.text,
            usual: it.usual,
            stock: it.stock,
            checkedAt: checkedAt,
            tripTitle: listTitle,
            tripAt: tripAt,
            times: 1,
          };
          return;
        }
        map[key].times += 1;
        if (stamp(checkedAt) >= stamp(map[key].checkedAt)) {
          map[key].checkedAt = checkedAt;
          map[key].usual = it.usual;
          map[key].stock = it.stock;
          map[key].tripTitle = listTitle;
          map[key].tripAt = tripAt;
        }
      });
    });
    return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) {
      return stamp(b.checkedAt) - stamp(a.checkedAt);
    });
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
      color: opts.color,
      size: opts.size,
      repeatDays: opts.repeatDays,
      cardNote: opts.cardNote,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      items: [],
    });
    var next = normalizeData(data);
    next.lists.push(list);
    return { data: next, list: list };
  }

  function setListStyle(data, listId, patch, now) {
    patch = patch || {};
    now = now || new Date().toISOString();
    return mapList(data, listId, function (list) {
      if (patch.color) list.color = normalizeColor(patch.color, list.id);
      if (patch.size) list.size = normalizeSize(patch.size);
      if (Array.isArray(patch.repeatDays)) list.repeatDays = normalizeRepeatDays(patch.repeatDays);
      list.updatedAt = now;
      return list;
    });
  }

  function addCardNote(data, listId, text, now) {
    now = now || new Date().toISOString();
    var note = normalizeCardNote(text);
    if (!note) return normalizeData(data);
    return mapList(data, listId, function (list) {
      var notes = normalizeCardNotes(list);
      notes.push({ id: uid(), text: note, createdAt: now });
      list.cardNotes = notes;
      list.updatedAt = now;
      return list;
    });
  }

  function setListCardNote(data, listId, note, now) {
    return addCardNote(data, listId, note, now);
  }

  function setItemUsual(data, listId, itemId, usual, now) {
    now = now || new Date().toISOString();
    return mapList(data, listId, function (list) {
      list.items = list.items.map(function (it) {
        if (it.id !== itemId || it.deletedAt) return it;
        it.usual = normalizeUsual(usual);
        it.updatedAt = now;
        return it;
      });
      list.updatedAt = now;
      return list;
    });
  }

  function setItemStock(data, listId, itemId, stock, now) {
    now = now || new Date().toISOString();
    return mapList(data, listId, function (list) {
      list.items = list.items.map(function (it) {
        if (it.id !== itemId || it.deletedAt) return it;
        it.stock = normalizeStock(stock);
        it.updatedAt = now;
        return it;
      });
      list.updatedAt = now;
      return list;
    });
  }

  function cycleItemStock(data, listId, itemId, now) {
    var list = findList(data, listId);
    if (!list) return normalizeData(data);
    var item = null;
    list.items.forEach(function (it) {
      if (it.id === itemId) item = it;
    });
    if (!item) return normalizeData(data);
    return setItemStock(data, listId, itemId, nextStock(item.stock), now);
  }

  function createGroceryStarter(data, opts) {
    opts = opts || {};
    var now = opts.now || new Date().toISOString();
    var nowMs = stamp(now);
    var created = createList(data, {
      id: opts.id,
      category: "grocery",
      title: opts.title || "Grocery list",
      color: opts.color || "butter",
      size: "small",
      cardNote: opts.cardNote || "",
      now: now,
    });
    var items = [];
    GROCERY_SUGGESTIONS.forEach(function (text, index) {
      var when = new Date(nowMs - index * 1000).toISOString();
      items.push(normalizeItem({
        id: uid(),
        text: text,
        checked: false,
        usual: "yes",
        stock: "medium",
        createdAt: when,
        updatedAt: when,
        checkedAt: null,
        deletedAt: null,
      }));
    });
    created.list.items = items;
    created.list.updatedAt = now;
    created.data = mapList(created.data, created.list.id, function () { return created.list; });
    created.data = withMeta(created.data, { groceryStarterUsed: true });
    return created;
  }

  function createGroceryFromHistory(data, opts, keys) {
    opts = opts || {};
    var history = groceryHistoryItems(data);
    var pick = null;
    if (keys) {
      pick = {};
      keys.forEach(function (k) { pick[k] = true; });
    }
    var chosen = history.filter(function (row) { return !pick || pick[row.key]; });
    if (!chosen.length) return { data: normalizeData(data), list: null, copied: 0 };
    var now = opts.now || new Date().toISOString();
    var nowMs = stamp(now);
    var created = createList(data, {
      id: opts.id,
      category: "grocery",
      title: opts.title || "Grocery list",
      color: opts.color || "butter",
      size: "small",
      cardNote: opts.cardNote,
      now: now,
    });
    var items = [];
    chosen.forEach(function (row, index) {
      var when = new Date(nowMs - index * 1000).toISOString();
      items.push(normalizeItem({
        id: uid(),
        text: row.text,
        checked: false,
        usual: row.usual,
        stock: row.stock,
        createdAt: when,
        updatedAt: when,
        checkedAt: null,
        deletedAt: null,
      }));
    });
    created.list.items = items;
    created.list.updatedAt = now;
    created.data = mapList(created.data, created.list.id, function () { return created.list; });
    created.data = withMeta(created.data, { groceryStarterUsed: true });
    return { data: created.data, list: created.list, copied: items.length };
  }

  function listsForPriority(data, excludeId, date) {
    var today = [];
    var repeating = [];
    activeLists(data).forEach(function (list) {
      if (list.id === excludeId) return;
      if (!list.repeatDays.length) return;
      repeating.push(list);
      if (repeatsOn(list, date || new Date())) today.push(list);
    });
    return today.length ? today : repeating;
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
      color: source.color,
      size: source.size,
      repeatDays: source.repeatDays,
      cardNotes: normalizeCardNotes(source),
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
      var left = map[row.id];
      var right = row;
      var shell = pickNewer(left, right);
      map[row.id] = normalizeList({
        id: shell.id,
        category: shell.category,
        customName: shell.customName,
        title: shell.title,
        color: shell.color,
        size: shell.size,
        repeatDays: shell.repeatDays,
        cardNotes: mergeCardNotes(left, right),
        createdAt: shell.createdAt,
        updatedAt: shell.updatedAt,
        deletedAt: shell.deletedAt,
        items: mergeItems(left.items, right.items),
      });
    }
    (a && a.lists || []).forEach(take);
    (b && b.lists || []).forEach(take);
    var lists = Object.keys(map).map(function (id) { return map[id]; });
    return {
      lists: lists,
      meta: normalizeMeta({
        meta: {
          groceryStarterUsed: !!((a && a.meta && a.meta.groceryStarterUsed) || (b && b.meta && b.meta.groceryStarterUsed)),
        },
        lists: lists,
      }, lists),
    };
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
    COLORS: COLORS,
    SIZES: SIZES,
    DAYS: DAYS,
    WEEKDAYS: WEEKDAYS,
    GROCERY_SUGGESTIONS: GROCERY_SUGGESTIONS,
    repeatLabel: repeatLabel,
    dayId: dayId,
    repeatsOn: repeatsOn,
    listsForPriority: listsForPriority,
    normalizeText: normalizeText,
    normalizeCardNote: normalizeCardNote,
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
    createGroceryStarter: createGroceryStarter,
    createGroceryFromHistory: createGroceryFromHistory,
    shouldOfferGroceryStarter: shouldOfferGroceryStarter,
    groceryHistoryItems: groceryHistoryItems,
    setListStyle: setListStyle,
    normalizeCardNotes: normalizeCardNotes,
    latestCardNote: latestCardNote,
    addCardNote: addCardNote,
    setListCardNote: setListCardNote,
    setItemUsual: setItemUsual,
    setItemStock: setItemStock,
    cycleItemStock: cycleItemStock,
    setListTitle: setListTitle,
    formatLastChanged: formatLastChanged,
    isGroceryList: isGroceryList,
    shopItems: shopItems,
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
