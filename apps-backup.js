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
    "voice-notes": {
      storageKey: "voice-notes-v1",
      legacyKeys: [],
      readSlice: function () {
        var raw = readKey("voice-notes-v1");
        if (!raw) return null;
        try {
          var p = JSON.parse(raw);
          var notes = Array.isArray(p) ? p : (p && Array.isArray(p.notes) ? p.notes : null);
          if (!notes) return null;
          return { notes: notes };
        } catch (e) {
          return null;
        }
      },
      writeSlice: function (slice) {
        var notes = Array.isArray(slice) ? slice : (slice && slice.notes);
        if (!Array.isArray(notes)) return false;
        var ok = writeKey("voice-notes-v1", JSON.stringify(notes));
        if (ok) {
          try {
            sessionStorage.setItem("voice-notes-v1-backup", JSON.stringify(notes));
          } catch (e) { /* ok */ }
        }
        return ok;
      },
      isLegacy: function (obj) {
        if (Array.isArray(obj)) return true;
        return obj && Array.isArray(obj.notes) && obj.format !== FORMAT;
      },
      summarize: function (slice) {
        var n = Array.isArray(slice) ? slice.length : (slice.notes ? slice.notes.length : 0);
        return n + " note" + (n === 1 ? "" : "s");
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
            counters: p.counters || [],
            counterLogs: p.counterLogs || {},
            matrixFilter: p.matrixFilter,
            compareHabitIds: p.compareHabitIds || [],
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
            counters: slice.counters || [],
            counterLogs: slice.counterLogs || {},
            matrixFilter: slice.matrixFilter || "all",
            compareHabitIds: slice.compareHabitIds || [],
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
          return p;
        } catch (e) {
          return null;
        }
      },
      writeSlice: function (slice) {
        if (!slice || typeof slice.items !== "object") return false;
        return writeKey("aruba-pack-v1", JSON.stringify(slice));
      },
      isLegacy: function (obj) {
        return obj && typeof obj.items === "object" && obj.format !== FORMAT;
      },
      summarize: function (slice) {
        var packed = 0;
        Object.keys(slice.items || {}).forEach(function (id) {
          if (slice.items[id] && slice.items[id].packed) packed++;
        });
        return packed + " packed / " + Object.keys(slice.items || {}).length + " items";
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
  };

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
      excluded: ["philly-dates-menu-photos"],
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
