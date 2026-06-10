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
        var bins = Array.isArray(slice.storageBins) ? slice.storageBins.length : 0;
        var items = Object.keys(slice.items || {}).length;
        return items + " categor" + (items === 1 ? "y" : "ies") + ", " + outfits + " outfit" + (outfits === 1 ? "" : "s") + ", " + bins + " storage bin" + (bins === 1 ? "" : "s") + " (no photos)";
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
    },
  };

  /** Wardrobe metadata — photos live in IndexedDB (aruba-pack-photos-v1), never exported. */
  function sanitizeArubaSlice(slice) {
    var out = {
      version: slice.version || 5,
      opts: slice.opts || {},
      collapsed: slice.collapsed || {},
      wardrobeCollapsed: slice.wardrobeCollapsed || {},
      items: {},
      removed: Array.isArray(slice.removed) ? slice.removed.slice() : [],
      outfits: Array.isArray(slice.outfits) ? slice.outfits : [],
      tripPlan: slice.tripPlan || {},
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
    if (!isUnifiedBackup(bundle)) {
      return { ok: false, error: "Not a cursor-apps backup file" };
    }
    var imported = [];
    var failed = [];
    Object.keys(APP_REGISTRY).forEach(function (id) {
      var slice = bundle.apps[id];
      if (slice == null) return;
      if (APP_REGISTRY[id].writeSlice(slice)) imported.push(id);
      else failed.push(id);
    });
    return {
      ok: failed.length === 0,
      imported: imported,
      failed: failed,
      summary: summarizeBundle(bundle),
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
