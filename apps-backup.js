/**
 * Unified backup for mathoose.github.io/cursor-apps (same-origin localStorage).
 * Include: <script src="apps-backup.js"></script> or ../apps-backup.js from subfolders.
 */
(function (global) {
  "use strict";

  var FORMAT = "cursor-apps-backup";
  var BUNDLE_VERSION = 1;

  var APP_REGISTRY = {
    "habit-journal": {
      storageKey: "habit-journal-v2",
      legacyKeys: ["habit-journal-v1"],
      readSlice: function () {
        var raw = readKey("habit-journal-v2") || readKey("habit-journal-v1");
        if (!raw) return null;
        try {
          var p = JSON.parse(raw);
          if (!p || !Array.isArray(p.habits)) return null;
          return {
            version: p.version || 2,
            year: p.year,
            month: p.month,
            habits: p.habits,
            cells: p.cells || {},
            categories: Array.isArray(p.categories) ? p.categories : undefined,
            categoryFilter: typeof p.categoryFilter === "string" ? p.categoryFilter : undefined,
          };
        } catch (e) {
          return null;
        }
      },
      writeSlice: function (slice) {
        if (!slice || !Array.isArray(slice.habits)) return false;
        var out = {
          version: 2,
          year: typeof slice.year === "number" ? slice.year : new Date().getFullYear(),
          month: typeof slice.month === "number" ? slice.month : new Date().getMonth(),
          habits: slice.habits,
          cells: slice.cells || {},
        };
        if (Array.isArray(slice.categories) && slice.categories.length) {
          out.categories = slice.categories;
        }
        if (typeof slice.categoryFilter === "string") {
          out.categoryFilter = slice.categoryFilter;
        }
        return writeKey("habit-journal-v2", JSON.stringify(out));
      },
      isLegacy: function (obj) {
        return obj && Array.isArray(obj.habits) && obj.format !== FORMAT;
      },
      summarize: function (slice) {
        var marks = slice.cells ? Object.keys(slice.cells).length : 0;
        return (slice.habits ? slice.habits.length : 0) + " habits, " + marks + " marks";
      },
      mergeSlice: function (existing, incoming) {
        if (!incoming) return existing;
        if (!existing) return incoming;
        var out = {
          version: 2,
          year: typeof existing.year === "number" ? existing.year : new Date().getFullYear(),
          month: typeof existing.month === "number" ? existing.month : new Date().getMonth(),
          habits: (existing.habits || []).slice(),
          cells: Object.assign({}, existing.cells || {}),
          categories: (existing.categories || []).slice(),
          categoryFilter: existing.categoryFilter || "all",
        };
        var habitIds = {};
        out.habits.forEach(function (h) { habitIds[h.id] = true; });
        (incoming.habits || []).forEach(function (h) {
          if (!habitIds[h.id]) {
            out.habits.push(h);
            habitIds[h.id] = true;
          }
        });
        Object.keys(incoming.cells || {}).forEach(function (k) {
          if (!out.cells[k]) out.cells[k] = incoming.cells[k];
        });
        var catIds = {};
        out.categories.forEach(function (c) { catIds[c.id] = true; });
        (incoming.categories || []).forEach(function (c) {
          if (!catIds[c.id]) {
            out.categories.push(c);
            catIds[c.id] = true;
          }
        });
        return out;
      },
    },
    "adhd-task-tracker": {
      storageKey: "adhd-tracker-v1",
      legacyKeys: [],
      readSlice: function () {
        var raw = readKey("adhd-tracker-v1");
        if (!raw) return null;
        try {
          var p = JSON.parse(raw);
          if (!p || !Array.isArray(p.tasks)) return null;
          return {
            version: p.version || 1,
            tasks: p.tasks,
            lists: p.lists || [],
            activeListId: p.activeListId,
            matrixFilter: p.matrixFilter || "all",
          };
        } catch (e) {
          return null;
        }
      },
      writeSlice: function (slice) {
        if (!slice || !Array.isArray(slice.tasks)) return false;
        return writeKey(
          "adhd-tracker-v1",
          JSON.stringify({
            version: slice.version || 1,
            tasks: slice.tasks,
            lists: slice.lists || [],
            activeListId: slice.activeListId || "inbox",
            matrixFilter: slice.matrixFilter || "all",
          })
        );
      },
      isLegacy: function (obj) {
        return obj && Array.isArray(obj.tasks) && obj.format !== FORMAT;
      },
      summarize: function (slice) {
        return slice.tasks.length + " task" + (slice.tasks.length === 1 ? "" : "s");
      },
      mergeSlice: function (existing, incoming) {
        if (!incoming) return existing;
        if (!existing) return incoming;
        var taskIds = {};
        (existing.tasks || []).forEach(function (t) { taskIds[t.id] = true; });
        var tasks = (existing.tasks || []).slice();
        (incoming.tasks || []).forEach(function (t) {
          if (!taskIds[t.id]) {
            tasks.push(t);
            taskIds[t.id] = true;
          }
        });
        var listIds = {};
        (existing.lists || []).forEach(function (l) { listIds[l.id] = true; });
        var lists = (existing.lists || []).slice();
        (incoming.lists || []).forEach(function (l) {
          if (!listIds[l.id]) {
            lists.push(l);
            listIds[l.id] = true;
          }
        });
        return {
          version: existing.version || 1,
          tasks: tasks,
          lists: lists,
          activeListId: existing.activeListId || "inbox",
          matrixFilter: existing.matrixFilter || "all",
        };
      },
    },
    "aruba-packing": {
      storageKey: "aruba-pack-v1",
      legacyKeys: [],
      readSlice: function () {
        var raw = readKey("aruba-pack-v1");
        if (!raw) return null;
        try {
          var p = JSON.parse(raw);
          if (!p || typeof p.items !== "object") return null;
          return sanitizeArubaSlice(p);
        } catch (e) {
          return null;
        }
      },
      writeSlice: function (slice) {
        if (!slice || typeof slice.items !== "object") return false;
        return writeKey("aruba-pack-v1", JSON.stringify(sanitizeArubaSlice(slice)));
      },
      isLegacy: function (obj) {
        return obj && typeof obj.items === "object" && obj.format !== FORMAT;
      },
      summarize: function (slice) {
        var outfits = Array.isArray(slice.outfits) ? slice.outfits.length : 0;
        var trips = Array.isArray(slice.trips) ? slice.trips.length : 0;
        var bins = Array.isArray(slice.storageBins) ? slice.storageBins.length : 0;
        var items = Object.keys(slice.items || {}).length;
        return items + " categor" + (items === 1 ? "y" : "ies") + ", " + outfits + " outfit" + (outfits === 1 ? "" : "s") + ", " + trips + " trip" + (trips === 1 ? "" : "s") + ", " + bins + " storage bin" + (bins === 1 ? "" : "s") + " (no photos)";
      },
      mergeSlice: function (existing, incoming) {
        if (!incoming) return existing;
        if (!existing) return incoming;
        var out = sanitizeArubaSlice(existing);
        var inc = sanitizeArubaSlice(incoming);
        Object.keys(inc.items || {}).forEach(function (id) {
          if (!out.items[id]) out.items[id] = inc.items[id];
        });
        (inc.removed || []).forEach(function (id) {
          if (out.removed.indexOf(id) < 0) out.removed.push(id);
        });
        var outfitIds = {};
        (out.outfits || []).forEach(function (o) { if (o && o.id) outfitIds[o.id] = true; });
        (inc.outfits || []).forEach(function (o) {
          if (o && o.id && !outfitIds[o.id]) out.outfits.push(o);
        });
        var tripIds = {};
        (out.trips || []).forEach(function (t) { if (t && t.id) tripIds[t.id] = true; });
        (inc.trips || []).forEach(function (t) {
          if (t && t.id && !tripIds[t.id]) out.trips.push(t);
        });
        (inc.closet || []).forEach(function (id) {
          if (out.closet.indexOf(id) < 0) out.closet.push(id);
        });
        (inc.customWardrobeCategories || []).forEach(function (c) {
          if (!out.customWardrobeCategories.some(function (x) { return x === c || (x && c && x.id === c.id); })) {
            out.customWardrobeCategories.push(c);
          }
        });
        Object.keys(inc.randomizerPool || {}).forEach(function (k) {
          if (!out.randomizerPool[k]) out.randomizerPool[k] = inc.randomizerPool[k];
        });
        var binIds = {};
        (out.storageBins || []).forEach(function (b) { if (b && b.id) binIds[b.id] = true; });
        (inc.storageBins || []).forEach(function (b) {
          if (b && b.id && !binIds[b.id]) out.storageBins.push(b);
        });
        return out;
      },
    },
    "meal-menu": {
      storageKey: "meal-menu-v1",
      legacyKeys: [],
      readSlice: function () {
        var raw = readKey("meal-menu-v1");
        if (!raw) return null;
        try {
          var p = JSON.parse(raw);
          if (!p || !Array.isArray(p.entries)) return null;
          return p;
        } catch (e) {
          return null;
        }
      },
      writeSlice: function (slice) {
        if (!slice || !Array.isArray(slice.entries)) return false;
        return writeKey("meal-menu-v1", JSON.stringify(slice));
      },
      isLegacy: function (obj) {
        return obj && Array.isArray(obj.entries) && obj.format !== FORMAT;
      },
      summarize: function (slice) {
        var n = slice.entries ? slice.entries.length : 0;
        var fav = slice.entries ? slice.entries.filter(function (e) { return e.favorite; }).length : 0;
        return n + " meal" + (n === 1 ? "" : "s") + (fav ? ", " + fav + " favorites" : "");
      },
      mergeSlice: function (existing, incoming) {
        if (!incoming) return existing;
        if (!existing) return incoming;
        var out = Object.assign({}, existing);
        out.entries = (existing.entries || []).slice();
        out.tags = (existing.tags || []).slice();
        out.categories = (existing.categories || []).slice();
        out.mealLog = (existing.mealLog || []).slice();
        out.entryPhotos = Object.assign({}, existing.entryPhotos || {});
        var entryIds = {};
        out.entries.forEach(function (e) { if (e && e.id) entryIds[e.id] = true; });
        (incoming.entries || []).forEach(function (e) {
          if (e && e.id && !entryIds[e.id]) {
            out.entries.push(e);
            entryIds[e.id] = true;
          }
        });
        var tagIds = {};
        out.tags.forEach(function (t) { if (t && t.id) tagIds[t.id] = true; });
        (incoming.tags || []).forEach(function (t) {
          if (t && t.id && !tagIds[t.id]) out.tags.push(t);
        });
        var catIds = {};
        out.categories.forEach(function (c) { if (c && c.id) catIds[c.id] = true; });
        (incoming.categories || []).forEach(function (c) {
          if (c && c.id && !catIds[c.id]) out.categories.push(c);
        });
        var logIds = {};
        out.mealLog.forEach(function (l) { if (l && l.id) logIds[l.id] = true; });
        (incoming.mealLog || []).forEach(function (l) {
          if (l && l.id && !logIds[l.id]) out.mealLog.push(l);
        });
        Object.assign(out.entryPhotos, incoming.entryPhotos || {});
        return out;
      },
    },
    "philly-dates": {
      storageKey: "philly-dates-v2",
      legacyKeys: ["philly-hh-app-v1"],
      readSlice: function () {
        var raw = readKey("philly-dates-v2") || readKey("philly-hh-app-v1");
        if (!raw) return null;
        try {
          var p = JSON.parse(raw);
          if (!p || typeof p !== "object") return null;
          return p;
        } catch (e) {
          return null;
        }
      },
      writeSlice: function (slice) {
        if (!slice || typeof slice !== "object") return false;
        return writeKey("philly-dates-v2", JSON.stringify(slice));
      },
      isLegacy: function (obj) {
        if (!obj || obj.format === FORMAT) return false;
        return (
          Array.isArray(obj.favorites) ||
          (obj.overrides && typeof obj.overrides === "object") ||
          (obj.edits && typeof obj.edits === "object")
        );
      },
      summarize: function (slice) {
        var fav = Array.isArray(slice.favorites) ? slice.favorites.length : 0;
        return fav + " favorite" + (fav === 1 ? "" : "s");
      },
      mergeSlice: function (existing, incoming) {
        if (!incoming) return existing;
        if (!existing) return incoming;
        var out = Object.assign({}, existing);
        var favSet = {};
        (existing.favorites || []).forEach(function (f) { favSet[f] = true; });
        out.favorites = (existing.favorites || []).slice();
        (incoming.favorites || []).forEach(function (f) {
          if (!favSet[f]) {
            out.favorites.push(f);
            favSet[f] = true;
          }
        });
        out.overrides = Object.assign({}, existing.overrides || {});
        Object.keys(incoming.overrides || {}).forEach(function (k) {
          if (!out.overrides[k]) out.overrides[k] = incoming.overrides[k];
        });
        out.edits = Object.assign({}, existing.edits || {});
        Object.keys(incoming.edits || {}).forEach(function (k) {
          if (!out.edits[k]) out.edits[k] = incoming.edits[k];
        });
        out.menuPhotos = Object.assign({}, existing.menuPhotos || {}, incoming.menuPhotos || {});
        return out;
      },
    },
    "dont-forget": {
      storageKey: "dont-forget-v1",
      legacyKeys: [],
      readSlice: function () {
        var raw = readKey("dont-forget-v1");
        if (!raw) return null;
        try {
          var p = JSON.parse(raw);
          if (!p || !Array.isArray(p.items)) return null;
          return p;
        } catch (e) {
          return null;
        }
      },
      writeSlice: function (slice) {
        if (!slice || !Array.isArray(slice.items)) return false;
        return writeKey("dont-forget-v1", JSON.stringify(slice));
      },
      isLegacy: function (obj) {
        return obj && Array.isArray(obj.items) && obj.format !== FORMAT;
      },
      summarize: function (slice) {
        var n = slice.items ? slice.items.length : 0;
        return n + " item" + (n === 1 ? "" : "s") + " (no photos)";
      },
      mergeSlice: function (existing, incoming) {
        if (!incoming) return existing;
        if (!existing) return incoming;
        var itemIds = {};
        (existing.items || []).forEach(function (it) { itemIds[it.id] = true; });
        var items = (existing.items || []).slice();
        (incoming.items || []).forEach(function (it) {
          if (!itemIds[it.id]) {
            items.push(it);
            itemIds[it.id] = true;
          }
        });
        return { version: 1, items: items };
      },
    },
    "rep-tracker": {
      storageKey: "rep-tracker-v1",
      legacyKeys: [],
      readSlice: function () {
        var raw = readKey("rep-tracker-v1");
        if (!raw) return null;
        try {
          var p = JSON.parse(raw);
          if (!p || typeof p !== "object") return null;
          return p;
        } catch (e) {
          return null;
        }
      },
      writeSlice: function (slice) {
        if (!slice || typeof slice !== "object") return false;
        return writeKey("rep-tracker-v1", JSON.stringify(slice));
      },
      isLegacy: function (obj) {
        return obj && obj.notes && typeof obj.notes === "object" && obj.format !== FORMAT;
      },
      summarize: function (slice) {
        var n = slice.notes ? Object.keys(slice.notes).length : 0;
        return n + " note" + (n === 1 ? "" : "s");
      },
      mergeSlice: function (existing, incoming) {
        if (!incoming) return existing;
        if (!existing) return incoming;
        var notes = Object.assign({}, existing.notes || {});
        Object.keys(incoming.notes || {}).forEach(function (k) {
          if (!notes[k]) notes[k] = incoming.notes[k];
        });
        return Object.assign({}, existing, { notes: notes });
      },
    },
    "process-guide": {
      storageKey: "process-guide-v1",
      legacyKeys: [],
      readSlice: function () {
        var raw = readKey("process-guide-v1");
        if (!raw) return null;
        try {
          var p = JSON.parse(raw);
          if (!p || !Array.isArray(p.processes)) return null;
          return { version: p.version || 1, processes: p.processes };
        } catch (e) {
          return null;
        }
      },
      writeSlice: function (slice) {
        if (!slice || !Array.isArray(slice.processes)) return false;
        return writeKey(
          "process-guide-v1",
          JSON.stringify({ version: slice.version || 1, processes: slice.processes })
        );
      },
      isLegacy: function (obj) {
        return obj && Array.isArray(obj.processes) && obj.format !== FORMAT;
      },
      summarize: function (slice) {
        var n = slice.processes ? slice.processes.length : 0;
        return n + " process" + (n === 1 ? "" : "es");
      },
      mergeSlice: function (existing, incoming) {
        if (!incoming) return existing;
        if (!existing) return incoming;
        var out = { version: 1, processes: (existing.processes || []).slice() };
        var ids = {};
        out.processes.forEach(function (p) { ids[p.id] = true; });
        (incoming.processes || []).forEach(function (p) {
          if (!p) return;
          if (ids[p.id]) {
            var copy = JSON.parse(JSON.stringify(p));
            copy.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
            out.processes.push(copy);
            ids[copy.id] = true;
          } else {
            out.processes.push(p);
            ids[p.id] = true;
          }
        });
        return out;
      },
    },
    "media-shelf": {
      storageKey: "media-shelf-v1",
      legacyKeys: [],
      readSlice: function () {
        var raw = readKey("media-shelf-v1");
        if (!raw) return null;
        try {
          var p = JSON.parse(raw);
          if (!p || !Array.isArray(p.shows) || !Array.isArray(p.books)) return null;
          return {
            version: p.version || 1,
            shows: p.shows,
            books: p.books,
            reminders: Array.isArray(p.reminders) ? p.reminders : [],
          };
        } catch (e) {
          return null;
        }
      },
      writeSlice: function (slice) {
        if (!slice || !Array.isArray(slice.shows) || !Array.isArray(slice.books)) return false;
        return writeKey(
          "media-shelf-v1",
          JSON.stringify({
            version: slice.version || 1,
            shows: slice.shows,
            books: slice.books,
            reminders: Array.isArray(slice.reminders) ? slice.reminders : [],
          })
        );
      },
      isLegacy: function (obj) {
        return obj && Array.isArray(obj.shows) && obj.format !== FORMAT;
      },
      summarize: function (slice) {
        var shows = slice.shows ? slice.shows.length : 0;
        var books = slice.books ? slice.books.length : 0;
        return shows + " show" + (shows === 1 ? "" : "s") + ", " + books + " book" + (books === 1 ? "" : "s");
      },
      mergeSlice: function (existing, incoming) {
        if (!incoming) return existing;
        if (!existing) return incoming;
        var out = {
          version: 1,
          shows: (existing.shows || []).slice(),
          books: (existing.books || []).slice(),
          reminders: (existing.reminders || []).slice(),
        };
        var showIds = {};
        var bookIds = {};
        var remIds = {};
        out.shows.forEach(function (s) { showIds[s.id] = true; });
        out.books.forEach(function (b) { bookIds[b.id] = true; });
        out.reminders.forEach(function (r) { remIds[r.id] = true; });
        (incoming.shows || []).forEach(function (s) {
          if (!s || showIds[s.id]) return;
          out.shows.push(s);
          showIds[s.id] = true;
        });
        (incoming.books || []).forEach(function (b) {
          if (!b || bookIds[b.id]) return;
          out.books.push(b);
          bookIds[b.id] = true;
        });
        (incoming.reminders || []).forEach(function (r) {
          if (!r || remIds[r.id]) return;
          out.reminders.push(r);
          remIds[r.id] = true;
        });
        return out;
      },
    },
  };

  /** Wardrobe metadata — photos live in IndexedDB (aruba-pack-photos-v1), never exported. */
  function sanitizeArubaSlice(slice) {
    var out = {
      version: slice.version || 6,
      opts: slice.opts || {},
      collapsed: slice.collapsed || {},
      wardrobeCollapsed: slice.wardrobeCollapsed || {},
      items: {},
      removed: Array.isArray(slice.removed) ? slice.removed.slice() : [],
      outfits: Array.isArray(slice.outfits) ? slice.outfits : [],
      trips: Array.isArray(slice.trips) ? slice.trips : [],
      closet: Array.isArray(slice.closet) ? slice.closet : [],
      customWardrobeCategories: Array.isArray(slice.customWardrobeCategories) ? slice.customWardrobeCategories : [],
      randomizerPool: slice.randomizerPool && typeof slice.randomizerPool === "object" ? slice.randomizerPool : {},
      storageBins: Array.isArray(slice.storageBins) ? slice.storageBins : [],
    };
    Object.keys(slice.items || {}).forEach(function (id) {
      var row = slice.items[id];
      if (!row || typeof row !== "object") return;
      out.items[id] = {
        packed: !!row.packed,
        qty: typeof row.qty === "number" ? row.qty : 1,
        custom: !!row.custom,
      };
      if (row.label) out.items[id].label = String(row.label).slice(0, 120);
      if (row.category) out.items[id].category = String(row.category).slice(0, 40);
      if (row.note) out.items[id].note = String(row.note).slice(0, 200);
      if (row.garmentTag) out.items[id].garmentTag = String(row.garmentTag).slice(0, 40);
    });
    return out;
  }

  function readKey(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function writeKey(key, json) {
    try {
      localStorage.setItem(key, json);
      return true;
    } catch (e) {
      return false;
    }
  }

  function isUnifiedBackup(obj) {
    return !!(obj && obj.format === FORMAT && obj.apps && typeof obj.apps === "object");
  }

  function getAppSlice(bundle, appId) {
    if (!bundle) return null;
    if (isUnifiedBackup(bundle)) {
      var slice = bundle.apps[appId];
      return slice === undefined ? null : slice;
    }
    var reg = APP_REGISTRY[appId];
    if (reg && reg.isLegacy(bundle)) return bundle;
    return null;
  }

  function isLegacyAppBackup(obj, appId) {
    var reg = APP_REGISTRY[appId];
    return !!(reg && reg.isLegacy(obj));
  }

  function exportAll() {
    var apps = {};
    var included = [];
    Object.keys(APP_REGISTRY).forEach(function (id) {
      var slice = APP_REGISTRY[id].readSlice();
      if (slice != null) {
        apps[id] = slice;
        included.push(id);
      }
    });
    return {
      format: FORMAT,
      version: BUNDLE_VERSION,
      exportedAt: new Date().toISOString(),
      excluded: ["philly-dates-menu-photos", "aruba-packing-wardrobe-photos", "meal-menu-photos-v1", "adhd-tracker-photos-v1", "dont-forget-photos-v1"],
      apps: apps,
      _meta: { included: included },
    };
  }

  function summarizeBundle(bundle) {
    if (!isUnifiedBackup(bundle)) return "Invalid backup file";
    var parts = [];
    var count = 0;
    Object.keys(APP_REGISTRY).forEach(function (id) {
      var slice = bundle.apps[id];
      if (slice == null) return;
      count++;
      var reg = APP_REGISTRY[id];
      parts.push(reg.summarize(slice));
    });
    if (!count) return "No app data in file";
    return count + " app" + (count === 1 ? "" : "s") + ": " + parts.join("; ");
  }

  function importAll(bundle, options) {
    options = options || {};
    var mode = options.mode || "merge";
    if (!isUnifiedBackup(bundle)) {
      return { ok: false, error: "Not a cursor-apps backup file" };
    }
    var imported = [];
    var failed = [];
    Object.keys(APP_REGISTRY).forEach(function (id) {
      var slice = bundle.apps[id];
      if (slice == null) return;
      var reg = APP_REGISTRY[id];
      var toWrite = slice;
      if (mode === "merge" && reg.mergeSlice) {
        toWrite = reg.mergeSlice(reg.readSlice(), slice);
      }
      if (reg.writeSlice(toWrite)) imported.push(id);
      else failed.push(id);
    });
    return {
      ok: failed.length === 0,
      imported: imported,
      failed: failed,
      summary: summarizeBundle(bundle),
      mode: mode,
    };
  }

  function downloadBundle(bundle, filename) {
    var blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename || defaultFilename();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  function defaultFilename() {
    var d = new Date();
    var stamp =
      d.getFullYear() +
      "-" +
      String(d.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(d.getDate()).padStart(2, "0");
    return "cursor-apps-backup-" + stamp + ".json";
  }

  function parseBackupFile(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        try {
          resolve(JSON.parse(reader.result));
        } catch (e) {
          reject(new Error("Invalid JSON"));
        }
      };
      reader.onerror = function () {
        reject(new Error("Could not read file"));
      };
      reader.readAsText(file);
    });
  }

  var AppsBackup = {
    FORMAT: FORMAT,
    BUNDLE_VERSION: BUNDLE_VERSION,
    APP_REGISTRY: APP_REGISTRY,
    isUnifiedBackup: isUnifiedBackup,
    getAppSlice: getAppSlice,
    isLegacyAppBackup: isLegacyAppBackup,
    exportAll: exportAll,
    importAll: importAll,
    summarizeBundle: summarizeBundle,
    downloadBundle: downloadBundle,
    defaultFilename: defaultFilename,
    parseBackupFile: parseBackupFile,
  };

  global.AppsBackup = AppsBackup;
})(typeof window !== "undefined" ? window : global);
