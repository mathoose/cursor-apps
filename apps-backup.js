/**
 * Unified backup for mathoose.github.io/cursor-apps (same-origin localStorage).
 * Include: <script src="apps-backup.js"></script> or ../apps-backup.js from subfolders.
 */
(function (global) {
  "use strict";

  var FORMAT = "cursor-apps-backup";
  var BUNDLE_VERSION = 1;
  var LAUNCHER_META_KEY = "cursor-apps-launcher-meta-v1";
  var OTHER_APP_ID = "__other__";

  var APP_LABELS = {
    "habit-journal": "Habit Journal",
    "body-journal": "Body Journal",
    "adhd-task-tracker": "Focus",
    "aruba-packing": "Closet Picker",
    "meal-menu": "Our Menu",
    "philly-dates": "Philly Dates",
    "dont-forget": "Don't Forget",
    "process-guide": "Process Guide",
    "media-shelf": "Media Shelf",
    "shopping-list": "Our Groceries",
    "world-cup-2026": "World Cup",
    "times-tables": "Times Tables",
    "things-book": "Things Book",
  };

  var PHOTO_DATABASES = [
    { appId: "aruba-packing", db: "aruba-pack-photos-v1", store: "photos" },
    { appId: "meal-menu", db: "meal-menu-photos-v1", store: "photos" },
    { appId: "dont-forget", db: "dont-forget-photos-v1", store: "photos" },
    { appId: "adhd-task-tracker", db: "adhd-tracker-photos-v1", store: "photos" },
    { appId: "process-guide", db: "process-guide-photos-v1", store: "photos" },
    { appId: "philly-dates", db: "philly-dates-menu-photos-v1", store: "menus" },
    { appId: "things-book", db: "things-book-photos-v1", store: "photos" },
  ];

  var EXTRA_JSON_KEYS = {
    "world-cup-2026": ["world-cup-2026-scores-v1", "world-cup-2026-knockout-v1"],
    "habit-journal": ["habit-journal-meta-v1", "habit-journal-local-v1"],
  };

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
    "body-journal": {
      storageKey: "body-journal-v1",
      legacyKeys: [],
      readSlice: function () {
        var raw = readKey("body-journal-v1");
        if (!raw) return null;
        try {
          var p = JSON.parse(raw);
          if (!p || !Array.isArray(p.topics) || !Array.isArray(p.entries)) return null;
          return {
            version: p.version || 1,
            topics: p.topics,
            entries: p.entries,
            settings: p.settings && typeof p.settings === "object" ? p.settings : {},
          };
        } catch (e) {
          return null;
        }
      },
      writeSlice: function (slice) {
        if (!slice || !Array.isArray(slice.topics) || !Array.isArray(slice.entries)) return false;
        return writeKey(
          "body-journal-v1",
          JSON.stringify({
            version: slice.version || 1,
            topics: slice.topics,
            entries: slice.entries,
            settings: slice.settings && typeof slice.settings === "object" ? slice.settings : {},
          })
        );
      },
      isLegacy: function (obj) {
        return obj && Array.isArray(obj.topics) && Array.isArray(obj.entries) && obj.format !== FORMAT;
      },
      summarize: function (slice) {
        var entries = slice.entries ? slice.entries.length : 0;
        var topics = slice.topics ? slice.topics.length : 0;
        return entries + " journal entr" + (entries === 1 ? "y" : "ies") + ", " + topics + " topic" + (topics === 1 ? "" : "s");
      },
      mergeSlice: function (existing, incoming) {
        if (!incoming) return existing;
        if (!existing) return incoming;
        var topics = (existing.topics || []).slice();
        var entries = (existing.entries || []).slice();
        var topicIds = {};
        var topicNames = {};
        var remap = {};
        topics.forEach(function (topic) {
          if (!topic) return;
          topicIds[topic.id] = true;
          topicNames[String(topic.name || "").toLowerCase()] = topic.id;
        });
        (incoming.topics || []).forEach(function (topic) {
          if (!topic || !topic.id) return;
          var key = String(topic.name || "").toLowerCase();
          if (topicIds[topic.id]) {
            remap[topic.id] = topic.id;
            return;
          }
          if (topicNames[key]) {
            remap[topic.id] = topicNames[key];
            return;
          }
          topics.push(topic);
          topicIds[topic.id] = true;
          topicNames[key] = topic.id;
          remap[topic.id] = topic.id;
        });
        var entryIds = {};
        entries.forEach(function (entry) { if (entry && entry.id) entryIds[entry.id] = true; });
        (incoming.entries || []).forEach(function (entry) {
          if (!entry || !entry.id || entryIds[entry.id]) return;
          var copy = Object.assign({}, entry);
          if (copy.topicId && remap[copy.topicId]) copy.topicId = remap[copy.topicId];
          entries.push(copy);
          entryIds[copy.id] = true;
        });
        entries.sort(function (a, b) {
          return new Date(b.createdAt) - new Date(a.createdAt);
        });
        return {
          version: 1,
          topics: topics,
          entries: entries,
          settings: Object.assign({}, existing.settings || {}, incoming.settings || {}),
        };
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
            categories: p.categories || [],
            activeListId: p.activeListId,
            matrixFilter: p.matrixFilter || "all",
            categoryFilter: p.categoryFilter || "all",
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
        return n + " process" + (n === 1 ? "" : "es") + " (no photos)";
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
            version: p.version || 2,
            shows: p.shows,
            books: p.books,
            reminders: Array.isArray(p.reminders) ? p.reminders : [],
            subscriptions: Array.isArray(p.subscriptions) ? p.subscriptions : [],
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
            version: slice.version || 2,
            shows: slice.shows,
            books: slice.books,
            reminders: Array.isArray(slice.reminders) ? slice.reminders : [],
            subscriptions: Array.isArray(slice.subscriptions) ? slice.subscriptions : [],
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
          version: 2,
          shows: (existing.shows || []).slice(),
          books: (existing.books || []).slice(),
          reminders: (existing.reminders || []).slice(),
          subscriptions: (existing.subscriptions || []).slice(),
        };
        var showIds = {};
        var bookIds = {};
        var remIds = {};
        var subIds = {};
        out.shows.forEach(function (s) { showIds[s.id] = true; });
        out.books.forEach(function (b) { bookIds[b.id] = true; });
        out.reminders.forEach(function (r) { remIds[r.id] = true; });
        out.subscriptions.forEach(function (s) { subIds[s.id] = true; });
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
        (incoming.subscriptions || []).forEach(function (s) {
          if (!s || subIds[s.id]) return;
          out.subscriptions.push(s);
          subIds[s.id] = true;
        });
        return out;
      },
    },
    "shopping-list": {
      storageKey: "shopping-list-v1",
      legacyKeys: [],
      readSlice: function () {
        var raw = readKey("shopping-list-v1");
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
        return writeKey("shopping-list-v1", JSON.stringify(slice));
      },
      isLegacy: function (obj) {
        return obj && Array.isArray(obj.items) && obj.format !== FORMAT;
      },
      summarize: function (slice) {
        var n = slice.items ? slice.items.length : 0;
        return n + " grocery item" + (n === 1 ? "" : "s");
      },
      mergeSlice: function (existing, incoming) {
        if (!incoming) return existing;
        if (!existing) return incoming;
        var out = {
          version: 1,
          items: (existing.items || []).slice(),
        };
        var ids = {};
        var keys = {};
        out.items.forEach(function (it) {
          ids[it.id] = true;
          keys[(it.text || "").toLowerCase().trim()] = true;
        });
        (incoming.items || []).forEach(function (it) {
          if (!it || !it.text) return;
          var key = String(it.text).toLowerCase().trim();
          if (ids[it.id] || keys[key]) return;
          out.items.push(it);
          ids[it.id] = true;
          keys[key] = true;
        });
        return out;
      },
    },
    "times-tables": {
      storageKey: "times-tables-v1",
      legacyKeys: [],
      readSlice: function () {
        var raw = readKey("times-tables-v1");
        if (!raw) return null;
        try {
          var p = JSON.parse(raw);
          if (!p || !Array.isArray(p.scores)) return null;
          return p;
        } catch (e) {
          return null;
        }
      },
      writeSlice: function (slice) {
        if (!slice || !Array.isArray(slice.scores)) return false;
        return writeKey("times-tables-v1", JSON.stringify(slice));
      },
      isLegacy: function (obj) {
        return obj && Array.isArray(obj.scores) && obj.format !== FORMAT;
      },
      summarize: function (slice) {
        var n = slice.scores ? slice.scores.length : 0;
        return n + " saved run" + (n === 1 ? "" : "s");
      },
      mergeSlice: function (existing, incoming) {
        if (!incoming) return existing;
        if (!existing) return incoming;
        var out = {
          version: 1,
          scores: (existing.scores || []).slice(),
        };
        var ids = {};
        out.scores.forEach(function (s) { ids[s.id] = true; });
        (incoming.scores || []).forEach(function (s) {
          if (!s || !s.id || ids[s.id]) return;
          out.scores.push(s);
          ids[s.id] = true;
        });
        out.scores.sort(function (a, b) {
          return new Date(a.date) - new Date(b.date);
        });
        return out;
      },
    },
    "things-book": {
      storageKey: "things-book-v1",
      legacyKeys: [],
      readSlice: function () {
        var raw = readKey("things-book-v1");
        if (!raw) return null;
        try {
          var p = JSON.parse(raw);
          if (!p || !Array.isArray(p.lists)) return null;
          return p;
        } catch (e) {
          return null;
        }
      },
      writeSlice: function (slice) {
        if (!slice || !Array.isArray(slice.lists)) return false;
        return writeKey("things-book-v1", JSON.stringify(slice));
      },
      isLegacy: function (obj) {
        return obj && Array.isArray(obj.lists) && obj.format !== FORMAT;
      },
      summarize: function (slice) {
        var lists = slice.lists ? slice.lists.length : 0;
        var items = slice.items ? slice.items.length : 0;
        return lists + " list" + (lists === 1 ? "" : "s") + ", " + items + " thing" + (items === 1 ? "" : "s") + " (no photos)";
      },
      mergeSlice: function (existing, incoming) {
        if (!incoming) return existing;
        if (!existing) return incoming;
        var listIds = {};
        var tagIds = {};
        var itemIds = {};
        var lists = (existing.lists || []).slice();
        var tags = (existing.tags || []).slice();
        var items = (existing.items || []).slice();
        var tagFilters = Object.assign({}, existing.tagFilters || {});
        lists.forEach(function (l) { listIds[l.id] = true; });
        tags.forEach(function (t) { tagIds[t.id] = true; });
        items.forEach(function (it) { itemIds[it.id] = true; });
        (incoming.lists || []).forEach(function (l) {
          if (!l || !l.id || listIds[l.id]) return;
          lists.push(l);
          listIds[l.id] = true;
        });
        (incoming.tags || []).forEach(function (t) {
          if (!t || !t.id || tagIds[t.id]) return;
          tags.push(t);
          tagIds[t.id] = true;
        });
        (incoming.items || []).forEach(function (it) {
          if (!it || !it.id || itemIds[it.id]) return;
          items.push(it);
          itemIds[it.id] = true;
        });
        Object.keys(incoming.tagFilters || {}).forEach(function (k) {
          if (!tagFilters[k]) tagFilters[k] = incoming.tagFilters[k];
        });
        return {
          version: 1,
          lists: lists,
          tags: tags,
          items: items,
          tagFilters: tagFilters,
        };
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

  function readLauncherMeta() {
    try {
      var raw = localStorage.getItem(LAUNCHER_META_KEY);
      if (!raw) return {};
      var p = JSON.parse(raw);
      return p && typeof p === "object" ? p : {};
    } catch (e) {
      return {};
    }
  }

  function writeLauncherMeta(meta) {
    try {
      localStorage.setItem(LAUNCHER_META_KEY, JSON.stringify(meta || {}));
      return true;
    } catch (e) {
      return false;
    }
  }

  function recordLastExport() {
    var meta = readLauncherMeta();
    meta.lastExportedAt = new Date().toISOString();
    writeLauncherMeta(meta);
    return meta.lastExportedAt;
  }

  function getLastExportedAt() {
    var ts = readLauncherMeta().lastExportedAt;
    return typeof ts === "string" ? ts : null;
  }

  var EXPORT_REMINDER_DAYS = 5;
  var EXPORT_REMINDER_MS = EXPORT_REMINDER_DAYS * 24 * 60 * 60 * 1000;

  function hasSavedAppData() {
    return Object.keys(APP_REGISTRY).some(function (id) {
      return APP_REGISTRY[id].readSlice() != null;
    });
  }

  function getDaysSinceLastExport() {
    var ts = getLastExportedAt();
    if (!ts) return null;
    var d = new Date(ts);
    if (isNaN(d.getTime())) return null;
    return Math.floor((Date.now() - d.getTime()) / (24 * 60 * 60 * 1000));
  }

  function isExportReminderDue() {
    if (!hasSavedAppData()) return false;
    var ts = getLastExportedAt();
    if (!ts) return true;
    var d = new Date(ts);
    if (isNaN(d.getTime())) return true;
    return Date.now() - d.getTime() >= EXPORT_REMINDER_MS;
  }

  function getHiddenAppIds() {
    var meta = readLauncherMeta();
    return Array.isArray(meta.hiddenApps) ? meta.hiddenApps.filter(Boolean) : [];
  }

  function setHiddenAppIds(ids) {
    var meta = readLauncherMeta();
    meta.hiddenApps = (ids || []).filter(Boolean);
    writeLauncherMeta(meta);
    return meta.hiddenApps;
  }

  function getAppOrderIds() {
    var meta = readLauncherMeta();
    return Array.isArray(meta.appOrder) ? meta.appOrder.filter(Boolean) : [];
  }

  function setAppOrderIds(ids) {
    var meta = readLauncherMeta();
    meta.appOrder = (ids || []).filter(Boolean);
    writeLauncherMeta(meta);
    return meta.appOrder;
  }

  function mergeAppOrderIds(incoming) {
    if (!Array.isArray(incoming) || !incoming.length) return getAppOrderIds();
    return setAppOrderIds(incoming.filter(function (id) {
      return isKnownAppId(id);
    }));
  }

  function hideApp(appId) {
    if (!appId) return getHiddenAppIds();
    var ids = getHiddenAppIds();
    if (ids.indexOf(appId) >= 0) return ids;
    ids.push(appId);
    return setHiddenAppIds(ids);
  }

  function unhideApp(appId) {
    if (!appId) return getHiddenAppIds();
    return setHiddenAppIds(getHiddenAppIds().filter(function (id) {
      return id !== appId;
    }));
  }

  function mergeHiddenAppIds(incoming) {
    if (!Array.isArray(incoming) || !incoming.length) return getHiddenAppIds();
    var merged = getHiddenAppIds().slice();
    incoming.forEach(function (id) {
      if (id && merged.indexOf(id) < 0) merged.push(id);
    });
    return setHiddenAppIds(merged);
  }

  function isKnownAppId(appId) {
    return !!APP_REGISTRY[appId];
  }

  function deleteKey(key) {
    try {
      localStorage.removeItem(key);
      return true;
    } catch (e) {
      return false;
    }
  }

  function getAppStorageKeys(appId) {
    var keys = [];
    var reg = APP_REGISTRY[appId];
    if (reg) {
      keys.push(reg.storageKey);
      (reg.legacyKeys || []).forEach(function (k) {
        keys.push(k);
      });
    }
    (EXTRA_JSON_KEYS[appId] || []).forEach(function (k) {
      keys.push(k);
    });
    return keys;
  }

  function deleteAppJson(appId) {
    getAppStorageKeys(appId).forEach(deleteKey);
  }

  function getOtherStorageKeys() {
    var accounted = getAccountedStorageKeys();
    var keys = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (key && !accounted[key]) keys.push(key);
      }
    } catch (e) {}
    return keys;
  }

  function deleteOtherJson() {
    getOtherStorageKeys().forEach(deleteKey);
  }

  function deleteAppPhotos(appId) {
    var match = null;
    PHOTO_DATABASES.forEach(function (cfg) {
      if (cfg.appId === appId) match = cfg;
    });
    if (!match) return Promise.resolve();
    return clearPhotoStore(match.db, match.store);
  }

  function deleteAppData(appId) {
    if (appId === OTHER_APP_ID) {
      deleteOtherJson();
      return Promise.resolve({ ok: true, appId: appId });
    }
    if (!isKnownAppId(appId)) {
      return Promise.resolve({ ok: false, error: "Unknown app" });
    }
    deleteAppJson(appId);
    unhideApp(appId);
    return deleteAppPhotos(appId).then(function () {
      return { ok: true, appId: appId };
    });
  }

  function cleanBackup(bundle) {
    var removedApps = [];
    var removedHidden = [];
    if (!bundle || typeof bundle !== "object") {
      return { bundle: null, removedApps: removedApps, removedHidden: removedHidden };
    }
    if (!isUnifiedBackup(bundle)) {
      return { bundle: bundle, removedApps: removedApps, removedHidden: removedHidden };
    }
    var out = {
      format: bundle.format,
      version: bundle.version,
      exportedAt: bundle.exportedAt,
      excluded: Array.isArray(bundle.excluded) ? bundle.excluded.slice() : [],
      apps: {},
      launcher: { hiddenApps: [], appOrder: [] },
      _meta: { included: [] },
    };
    Object.keys(bundle.apps || {}).forEach(function (id) {
      if (isKnownAppId(id)) {
        out.apps[id] = bundle.apps[id];
      } else {
        removedApps.push(id);
      }
    });
    out._meta.included = Object.keys(out.apps);
    if (bundle.launcher && Array.isArray(bundle.launcher.hiddenApps)) {
      bundle.launcher.hiddenApps.forEach(function (id) {
        if (isKnownAppId(id)) out.launcher.hiddenApps.push(id);
        else removedHidden.push(id);
      });
    }
    if (bundle.launcher && Array.isArray(bundle.launcher.appOrder)) {
      bundle.launcher.appOrder.forEach(function (id) {
        if (isKnownAppId(id)) out.launcher.appOrder.push(id);
      });
    }
    return { bundle: out, removedApps: removedApps, removedHidden: removedHidden };
  }

  function summarizeCleanResult(result) {
    if (!result) return "";
    var parts = [];
    if (result.removedApps && result.removedApps.length) {
      parts.push(
        result.removedApps.length +
          " removed app" +
          (result.removedApps.length === 1 ? "" : "s") +
          ": " +
          result.removedApps.map(appLabel).join(", ")
      );
    }
    if (result.removedHidden && result.removedHidden.length) {
      parts.push(
        result.removedHidden.length +
          " old hidden-app" +
          (result.removedHidden.length === 1 ? "" : "s")
      );
    }
    return parts.length ? parts.join("; ") : "Already clean";
  }

  function formatBytes(bytes) {
    var n = Number(bytes);
    if (!isFinite(n) || n < 0) return "—";
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10 * 1024 ? 1 : 0) + " KB";
    if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0) + " MB";
    return (n / (1024 * 1024 * 1024)).toFixed(1) + " GB";
  }

  function getAppJsonBytes(appId) {
    var total = 0;
    var reg = APP_REGISTRY[appId];
    if (reg) {
      var keys = [reg.storageKey].concat(reg.legacyKeys || []);
      keys.forEach(function (key) {
        var val = readKey(key);
        if (val) total += (key.length + val.length) * 2;
      });
    }
    (EXTRA_JSON_KEYS[appId] || []).forEach(function (key) {
      var val = readKey(key);
      if (val) total += (key.length + val.length) * 2;
    });
    return total;
  }

  function getAccountedStorageKeys() {
    var keys = {};
    keys[LAUNCHER_META_KEY] = true;
    Object.keys(APP_REGISTRY).forEach(function (appId) {
      var reg = APP_REGISTRY[appId];
      keys[reg.storageKey] = true;
      (reg.legacyKeys || []).forEach(function (k) {
        keys[k] = true;
      });
      (EXTRA_JSON_KEYS[appId] || []).forEach(function (k) {
        keys[k] = true;
      });
    });
    return keys;
  }

  function getOtherJsonBytes() {
    var accounted = getAccountedStorageKeys();
    var total = 0;
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (!key || accounted[key]) continue;
        var val = localStorage.getItem(key) || "";
        total += (key.length + val.length) * 2;
      }
    } catch (e) {}
    return total;
  }

  function clearPhotoStore(dbName, storeName) {
    return new Promise(function (resolve, reject) {
      var req;
      try {
        req = indexedDB.open(dbName);
      } catch (e) {
        reject(e);
        return;
      }
      req.onerror = function () {
        reject(req.error || new Error("Could not open photo database"));
      };
      req.onsuccess = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(storeName)) {
          db.close();
          resolve(0);
          return;
        }
        var tx = db.transaction(storeName, "readwrite");
        tx.objectStore(storeName).clear();
        tx.oncomplete = function () {
          db.close();
          resolve(1);
        };
        tx.onerror = function () {
          db.close();
          reject(tx.error);
        };
      };
    });
  }

  function getLocalStorageBytes() {
    var total = 0;
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (!key) continue;
        var val = localStorage.getItem(key) || "";
        total += (key.length + val.length) * 2;
      }
    } catch (e) {}
    return total;
  }

  function idbSumStoreBytes(dbName, storeName) {
    return new Promise(function (resolve) {
      var req;
      try {
        req = indexedDB.open(dbName);
      } catch (e) {
        resolve(0);
        return;
      }
      req.onerror = function () {
        resolve(0);
      };
      req.onsuccess = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(storeName)) {
          db.close();
          resolve(0);
          return;
        }
        var tx = db.transaction(storeName, "readonly");
        var store = tx.objectStore(storeName);
        var allReq = store.getAll();
        allReq.onsuccess = function () {
          var rows = allReq.result || [];
          var bytes = 0;
          rows.forEach(function (row) {
            if (row instanceof Blob) bytes += row.size;
            else if (typeof row === "string") bytes += row.length * 2;
          });
          db.close();
          resolve(bytes);
        };
        allReq.onerror = function () {
          db.close();
          resolve(0);
        };
      };
    });
  }

  function getIndexedDBPhotoBytes() {
    return Promise.all(
      PHOTO_DATABASES.map(function (cfg) {
        return idbSumStoreBytes(cfg.db, cfg.store);
      })
    ).then(function (parts) {
      var total = 0;
      parts.forEach(function (n) {
        total += n;
      });
      return total;
    });
  }

  function getStorageBreakdown() {
    var rows = {};
    Object.keys(APP_REGISTRY).forEach(function (appId) {
      rows[appId] = {
        appId: appId,
        label: appLabel(appId),
        jsonBytes: getAppJsonBytes(appId),
        photoBytes: 0,
      };
    });
    if (EXTRA_JSON_KEYS["world-cup-2026"]) {
      rows["world-cup-2026"] = {
        appId: "world-cup-2026",
        label: appLabel("world-cup-2026"),
        jsonBytes: getAppJsonBytes("world-cup-2026"),
        photoBytes: 0,
      };
    }
    return Promise.all(
      PHOTO_DATABASES.map(function (cfg) {
        return idbSumStoreBytes(cfg.db, cfg.store).then(function (bytes) {
          return { appId: cfg.appId, photoBytes: bytes };
        });
      })
    ).then(function (photoParts) {
      photoParts.forEach(function (p) {
        if (!rows[p.appId]) {
          rows[p.appId] = {
            appId: p.appId,
            label: appLabel(p.appId),
            jsonBytes: getAppJsonBytes(p.appId),
            photoBytes: 0,
          };
        }
        rows[p.appId].photoBytes = p.photoBytes;
      });
      var apps = Object.keys(rows)
        .map(function (id) {
          var r = rows[id];
          r.totalBytes = r.jsonBytes + r.photoBytes;
          return r;
        })
        .filter(function (r) {
          return r.totalBytes > 0;
        })
        .sort(function (a, b) {
          return b.totalBytes - a.totalBytes;
        });
      return {
        apps: apps,
        otherJsonBytes: getOtherJsonBytes(),
      };
    });
  }

  function formatAppStorageParts(row) {
    var parts = [];
    if (row.photoBytes > 0) parts.push(formatBytes(row.photoBytes) + " photos");
    if (row.jsonBytes > 0) parts.push(formatBytes(row.jsonBytes) + " data");
    return parts.length ? parts.join(" · ") : "—";
  }

  function getStorageStats() {
    var localBytes = getLocalStorageBytes();
    var lastExportedAt = getLastExportedAt();
    var estimatePromise =
      typeof navigator !== "undefined" && navigator.storage && navigator.storage.estimate
        ? navigator.storage.estimate().catch(function () {
            return null;
          })
        : Promise.resolve(null);
    return Promise.all([estimatePromise, getIndexedDBPhotoBytes(), getStorageBreakdown()]).then(function (parts) {
      var estimate = parts[0];
      var photoBytes = parts[1];
      var breakdown = parts[2];
      return {
        localStorageBytes: localBytes,
        photoBytes: photoBytes,
        totalBytes: estimate && typeof estimate.usage === "number" ? estimate.usage : localBytes + photoBytes,
        quotaBytes: estimate && typeof estimate.quota === "number" ? estimate.quota : null,
        lastExportedAt: lastExportedAt,
        breakdown: breakdown,
      };
    });
  }

  function formatExportDate(iso) {
    if (!iso) return "Never";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "Never";
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function appLabel(appId) {
    return APP_LABELS[appId] || appId.replace(/-/g, " ").replace(/\b\w/g, function (c) {
      return c.toUpperCase();
    });
  }

  function listBundleApps(bundle) {
    if (!isUnifiedBackup(bundle)) return [];
    var out = [];
    Object.keys(APP_REGISTRY).forEach(function (id) {
      var slice = bundle.apps[id];
      if (slice == null) return;
      var reg = APP_REGISTRY[id];
      out.push({
        id: id,
        label: appLabel(id),
        summary: reg.summarize(slice),
      });
    });
    out.sort(function (a, b) {
      return a.label.localeCompare(b.label);
    });
    return out;
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
    return cleanBackup({
      format: FORMAT,
      version: BUNDLE_VERSION,
      exportedAt: new Date().toISOString(),
      excluded: ["philly-dates-menu-photos", "aruba-packing-wardrobe-photos", "meal-menu-photos-v1", "adhd-tracker-photos-v1", "dont-forget-photos-v1", "process-guide-photos-v1"],
      apps: apps,
      launcher: { hiddenApps: getHiddenAppIds(), appOrder: getAppOrderIds() },
      _meta: { included: included },
    }).bundle;
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
    var only = Array.isArray(options.appIds) ? options.appIds : null;
    var cleaned = cleanBackup(bundle);
    bundle = cleaned.bundle;
    if (!isUnifiedBackup(bundle)) {
      return { ok: false, error: "Not a cursor-apps backup file", cleaned: cleaned };
    }
    var imported = [];
    var failed = [];
    var skipped = [];
    Object.keys(APP_REGISTRY).forEach(function (id) {
      var slice = bundle.apps[id];
      if (slice == null) return;
      if (only && only.indexOf(id) < 0) {
        skipped.push(id);
        return;
      }
      var reg = APP_REGISTRY[id];
      var toWrite = slice;
      if (mode === "merge" && reg.mergeSlice) {
        toWrite = reg.mergeSlice(reg.readSlice(), slice);
      }
      if (reg.writeSlice(toWrite)) imported.push(id);
      else failed.push(id);
    });
    if (bundle.launcher && Array.isArray(bundle.launcher.hiddenApps)) {
      mergeHiddenAppIds(bundle.launcher.hiddenApps);
    }
    if (bundle.launcher && Array.isArray(bundle.launcher.appOrder) && bundle.launcher.appOrder.length) {
      mergeAppOrderIds(bundle.launcher.appOrder);
    }
    return {
      ok: failed.length === 0,
      imported: imported,
      failed: failed,
      skipped: skipped,
      summary: summarizeBundle(bundle),
      mode: mode,
      cleaned: cleaned,
    };
  }

  function downloadBundle(bundle, filename, options) {
    options = options || {};
    if (options.recordExport !== false) recordLastExport();
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

  function cleanedFilename() {
    return defaultFilename().replace("cursor-apps-backup-", "cursor-apps-backup-cleaned-");
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
    OTHER_APP_ID: OTHER_APP_ID,
    APP_REGISTRY: APP_REGISTRY,
    APP_LABELS: APP_LABELS,
    isUnifiedBackup: isUnifiedBackup,
    isKnownAppId: isKnownAppId,
    getAppSlice: getAppSlice,
    isLegacyAppBackup: isLegacyAppBackup,
    exportAll: exportAll,
    importAll: importAll,
    cleanBackup: cleanBackup,
    summarizeCleanResult: summarizeCleanResult,
    deleteAppData: deleteAppData,
    summarizeBundle: summarizeBundle,
    listBundleApps: listBundleApps,
    downloadBundle: downloadBundle,
    defaultFilename: defaultFilename,
    cleanedFilename: cleanedFilename,
    parseBackupFile: parseBackupFile,
    getStorageStats: getStorageStats,
    getStorageBreakdown: getStorageBreakdown,
    formatAppStorageParts: formatAppStorageParts,
    getLocalStorageBytes: getLocalStorageBytes,
    clearPhotoStore: clearPhotoStore,
    PHOTO_DATABASES: PHOTO_DATABASES,
    formatBytes: formatBytes,
    formatExportDate: formatExportDate,
    getLastExportedAt: getLastExportedAt,
    recordLastExport: recordLastExport,
    EXPORT_REMINDER_DAYS: EXPORT_REMINDER_DAYS,
    hasSavedAppData: hasSavedAppData,
    getDaysSinceLastExport: getDaysSinceLastExport,
    isExportReminderDue: isExportReminderDue,
    getHiddenAppIds: getHiddenAppIds,
    setHiddenAppIds: setHiddenAppIds,
    hideApp: hideApp,
    unhideApp: unhideApp,
    getAppOrderIds: getAppOrderIds,
    setAppOrderIds: setAppOrderIds,
    mergeAppOrderIds: mergeAppOrderIds,
  };

  global.AppsBackup = AppsBackup;
})(typeof window !== "undefined" ? window : global);
