(function () {
  "use strict";

  var STORAGE_KEY = "done-today-v1";
  var APP_ID = "done-today";
  var EXPORT_FORMAT = "done-today-data";
  var DAY_START = 360; // 6:00
  var DAY_END = 1380; // 23:00
  var DAY_SPAN = DAY_END - DAY_START;
  var PX_PER_MIN = 0.72;
  var VISIBLE_HOURS_TARGET = 9;
  var MIN_DURATION = 5;
  var HOLD_MS = 180;

  var DURATION_OPTIONS = [
    { id: "instant", label: "Instant", minutes: 0 },
    { id: "15", label: "15m", minutes: 15 },
    { id: "20", label: "20m", minutes: 20 },
    { id: "30", label: "30m", minutes: 30 },
    { id: "45", label: "45m", minutes: 45 },
    { id: "60", label: "1h", minutes: 60 },
    { id: "90", label: "1.5h", minutes: 90 },
    { id: "120", label: "2h", minutes: 120 },
  ];

  var WINDOW_PRESETS = {
    anytime: { type: "anytime", label: "Anytime" },
    morning: { type: "between", startMin: 420, endMin: 720, label: "Morning" },
    afternoon: { type: "between", startMin: 720, endMin: 1020, label: "Afternoon" },
    evening: { type: "between", startMin: 1020, endMin: 1320, label: "Evening" },
    after20: { type: "after", startMin: 1200, label: "After 8pm" },
    between13_16: { type: "between", startMin: 780, endMin: 960, label: "1–4pm" },
  };

  var KEYWORD_HINTS = [
    { re: /grocer|store|errand|shop/i, duration: 45, window: "between13_16" },
    { re: /walk|stroll|brownie|dog/i, duration: 30, window: "after20" },
    { re: /coffee|tea|breakfast/i, duration: 20, window: "morning" },
    { re: /lunch|meal|eat/i, duration: 45, window: "between13_16" },
    { re: /gym|workout|run|yoga/i, duration: 60, window: "morning" },
    { re: /dinner|cook/i, duration: 45, window: "evening" },
    { re: /call|email|admin/i, duration: 15, window: "anytime" },
    { re: /laundry|clean|chore/i, duration: 45, window: "afternoon" },
    { re: /commute|drive|transit/i, duration: 30, window: "anytime" },
    { re: /meditat|journal|read/i, duration: 20, window: "evening" },
  ];

  var state = {
    view: "today",
    selectedDate: todayKey(),
    addMode: "pending",
    durationId: "30",
    windowId: "anytime",
    editing: null,
    updatingId: null,
    historyQuery: "",
    boardDragId: null,
    boardDragGhost: null,
    startPendingId: null,
    startSheetMode: "now",
  };

  var data = loadData();
  var toastTimer = null;
  var dragState = null;
  var tickTimer = null;

  var UPDATE_HINTS = [
    { re: /laundr|washer|dryer|wash/i, tips: ["Loaded washer", "Moved to dryer", "Folding", "Put away"] },
    { re: /dish/i, tips: ["Started washing", "Unloading", "Put away"] },
    { re: /cook|dinner|meal|bake/i, tips: ["Prepping", "On the stove", "In the oven", "Plating"] },
    { re: /errand|shop|grocer/i, tips: ["Left home", "At the store", "Heading back"] },
    { re: /clean|chore/i, tips: ["Started", "Halfway", "Finishing up"] },
  ];

  function uid(prefix) {
    return (prefix || "id") + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  function todayKey() {
    return dateKey(new Date());
  }

  function dateKey(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function parseDateKey(key) {
    var p = String(key || "").split("-");
    if (p.length !== 3) return new Date();
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }

  function addDays(key, n) {
    var d = parseDateKey(key);
    d.setDate(d.getDate() + n);
    return dateKey(d);
  }

  function startOfWeek(key) {
    var d = parseDateKey(key);
    var day = d.getDay();
    var diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return dateKey(d);
  }

  function nowMinutes() {
    var n = new Date();
    return n.getHours() * 60 + n.getMinutes();
  }

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function round5(n) {
    return Math.round(n / 5) * 5;
  }

  function formatTime(min) {
    min = ((Math.round(min) % 1440) + 1440) % 1440;
    var h = Math.floor(min / 60);
    var m = min % 60;
    var ampm = h >= 12 ? "pm" : "am";
    var h12 = h % 12;
    if (h12 === 0) h12 = 12;
    return h12 + ":" + String(m).padStart(2, "0") + ampm;
  }

  function formatDuration(min) {
    if (!min || min <= 0) return "Instant";
    if (min < 60) return min + " min";
    var h = Math.floor(min / 60);
    var m = min % 60;
    if (!m) return h + "h";
    return h + "h " + m + "m";
  }

  function formatElapsed(ms) {
    ms = Math.max(0, ms || 0);
    var totalSec = Math.floor(ms / 1000);
    var h = Math.floor(totalSec / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    var s = totalSec % 60;
    if (h > 0) return h + "h " + String(m).padStart(2, "0") + "m";
    if (m > 0) return m + "m " + String(s).padStart(2, "0") + "s";
    return s + "s";
  }

  function formatClockFromIso(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return formatTime(d.getHours() * 60 + d.getMinutes());
  }

  function timeInputValue(d) {
    d = d || new Date();
    return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }

  function minutesFromTimeInput(value) {
    if (!value) return null;
    var p = String(value).split(":");
    return parseInt(p[0], 10) * 60 + parseInt(p[1] || "0", 10);
  }

  function isoFromDateKeyAndTime(key, timeValue) {
    var d = parseDateKey(key);
    var min = minutesFromTimeInput(timeValue);
    if (min == null) return new Date().toISOString();
    d.setHours(Math.floor(min / 60), min % 60, 0, 0);
    return d.toISOString();
  }

  function suggestUpdates(title) {
    for (var i = 0; i < UPDATE_HINTS.length; i++) {
      if (UPDATE_HINTS[i].re.test(title)) return UPDATE_HINTS[i].tips.slice();
    }
    return ["Started", "Update", "Almost done"];
  }

  function isRunning(item) {
    return !!(item && item.timerStartedAt);
  }

  function activeItems() {
    return data.pending
      .filter(isRunning)
      .slice()
      .sort(function (a, b) {
        return String(b.timerStartedAt).localeCompare(String(a.timerStartedAt));
      });
  }

  function waitingPendingForDate(date) {
    return pendingForDate(date).filter(function (p) { return !isRunning(p); });
  }

  function formatRelativeDay(isoOrKey) {
    if (!isoOrKey) return "Never";
    var key = isoOrKey.length > 10 ? dateKey(new Date(isoOrKey)) : isoOrKey;
    var today = todayKey();
    if (key === today) return "Today";
    if (key === addDays(today, -1)) return "Yesterday";
    var d = parseDateKey(key);
    return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  }

  function formatLongDate(key) {
    var d = parseDateKey(key);
    var today = todayKey();
    var label = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    if (key === today) return "Today · " + label;
    if (key === addDays(today, -1)) return "Yesterday · " + label;
    if (key === addDays(today, 1)) return "Tomorrow · " + label;
    return label;
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function normalizeTitle(t) {
    return String(t || "").replace(/\s+/g, " ").trim();
  }

  function titleKey(t) {
    return normalizeTitle(t).toLowerCase();
  }

  function toast(msg) {
    var el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.remove("show");
    }, 2600);
  }

  function defaultData() {
    return {
      version: 1,
      catalog: [],
      pending: [],
      entries: [],
    };
  }

  function normalizeWindow(win) {
    if (!win || typeof win !== "object") return { type: "anytime" };
    var type = win.type === "after" || win.type === "between" || win.type === "at" || win.type === "anytime"
      ? win.type
      : "anytime";
    var out = { type: type };
    if (typeof win.startMin === "number") out.startMin = clamp(Math.round(win.startMin), 0, 1435);
    if (typeof win.endMin === "number") out.endMin = clamp(Math.round(win.endMin), 0, 1440);
    return out;
  }

  function normalizeCatalogItem(it) {
    if (!it || !it.id || !normalizeTitle(it.title)) return null;
    return {
      id: it.id,
      title: normalizeTitle(it.title),
      defaultDurationMin: typeof it.defaultDurationMin === "number" ? Math.max(0, Math.round(it.defaultDurationMin)) : 30,
      defaultWindow: normalizeWindow(it.defaultWindow),
      lastDoneAt: it.lastDoneAt || null,
      lastDoneDate: it.lastDoneDate || (it.lastDoneAt ? dateKey(new Date(it.lastDoneAt)) : null),
      doneCount: typeof it.doneCount === "number" ? it.doneCount : 0,
      recurring: it.recurring && it.recurring.freq === "daily" ? { freq: "daily" } : null,
      updatedAt: it.updatedAt || new Date().toISOString(),
    };
  }

  function normalizeUpdates(list) {
    if (!Array.isArray(list)) return [];
    return list
      .filter(function (u) { return u && normalizeTitle(u.text); })
      .map(function (u) {
        return {
          id: u.id || uid("upd"),
          text: normalizeTitle(u.text),
          at: u.at || new Date().toISOString(),
        };
      });
  }

  function normalizePending(it) {
    if (!it || !it.id || !normalizeTitle(it.title)) return null;
    var durationMin = it.durationMin === 0 || it.instant ? 0 : Math.max(0, Math.round(Number(it.durationMin) || 30));
    var win = normalizeWindow(it.window);
    var scheduled = !!it.scheduled;
    var startMin = typeof it.startMin === "number" ? it.startMin : null;
    var endMin = typeof it.endMin === "number" ? it.endMin : null;
    if (it.scheduled === undefined) {
      if (it.timerStartedAt) {
        scheduled = true;
      } else if (typeof startMin === "number" && typeof endMin === "number") {
        var bounds = windowBounds(win);
        var dur = durationMin > 0 ? durationMin : MIN_DURATION;
        var place = suggestedPlacement(dur, win, it.date || todayKey());
        var mismatch = Math.abs(startMin - place.startMin) > 45;
        if (win.type !== "anytime" && (startMin < bounds.lo - 30 || startMin > bounds.hi + 30)) {
          scheduled = false;
          startMin = null;
          endMin = null;
        } else if (mismatch && win.type !== "anytime") {
          startMin = place.startMin;
          endMin = place.endMin;
          scheduled = true;
        } else {
          scheduled = true;
        }
      } else {
        scheduled = false;
        startMin = null;
        endMin = null;
      }
    }
    if (!scheduled) {
      startMin = null;
      endMin = null;
    }
    return {
      id: it.id,
      catalogId: it.catalogId || null,
      title: normalizeTitle(it.title),
      durationMin: durationMin,
      window: win,
      scheduled: scheduled,
      startMin: startMin,
      endMin: endMin,
      recurring: it.recurring && it.recurring.freq === "daily" ? { freq: "daily" } : null,
      date: it.date || todayKey(),
      createdAt: it.createdAt || new Date().toISOString(),
      timerStartedAt: typeof it.timerStartedAt === "string" ? it.timerStartedAt : null,
      updates: normalizeUpdates(it.updates),
    };
  }

  function normalizeEntry(it) {
    if (!it || !it.id || !normalizeTitle(it.title)) return null;
    var startMin = typeof it.startMin === "number" ? clamp(Math.round(it.startMin), 0, 1435) : nowMinutes();
    var durationMin = typeof it.durationMin === "number" ? Math.max(0, Math.round(it.durationMin)) : 30;
    if (durationMin === 0) durationMin = 5;
    var endMin = typeof it.endMin === "number" ? Math.max(startMin + MIN_DURATION, Math.round(it.endMin)) : startMin + durationMin;
    if (endMin > 1440) {
      endMin = 1440;
      startMin = Math.max(0, endMin - durationMin);
    }
    return {
      id: it.id,
      catalogId: it.catalogId || null,
      title: normalizeTitle(it.title),
      date: it.date || todayKey(),
      startMin: startMin,
      endMin: endMin,
      durationMin: Math.max(MIN_DURATION, endMin - startMin),
      createdAt: it.createdAt || new Date().toISOString(),
      timerStartedAt: typeof it.timerStartedAt === "string" ? it.timerStartedAt : null,
      updates: normalizeUpdates(it.updates),
    };
  }

  function normalizeData(raw) {
    var d = raw && typeof raw === "object" ? raw : defaultData();
    var out = defaultData();
    out.version = 1;
    out.catalog = (Array.isArray(d.catalog) ? d.catalog : []).map(normalizeCatalogItem).filter(Boolean);
    out.pending = (Array.isArray(d.pending) ? d.pending : []).map(normalizePending).filter(Boolean);
    out.entries = (Array.isArray(d.entries) ? d.entries : []).map(normalizeEntry).filter(Boolean);
    return out;
  }

  function loadData() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultData();
      return normalizeData(JSON.parse(raw));
    } catch (e) {
      return defaultData();
    }
  }

  function saveData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeData(data)));
  }

  function windowLabel(win) {
    win = normalizeWindow(win);
    if (win.type === "anytime") return "Anytime";
    if (win.type === "after") return "After " + formatTime(win.startMin || 0);
    if (win.type === "at") return "At " + formatTime(win.startMin || 0);
    if (win.type === "between") {
      return formatTime(win.startMin || 0) + "–" + formatTime(win.endMin || 0);
    }
    return "Anytime";
  }

  function windowFromId(id) {
    var p = WINDOW_PRESETS[id] || WINDOW_PRESETS.anytime;
    return normalizeWindow(p);
  }

  function windowIdFromWindow(win) {
    win = normalizeWindow(win);
    var keys = Object.keys(WINDOW_PRESETS);
    for (var i = 0; i < keys.length; i++) {
      var p = WINDOW_PRESETS[keys[i]];
      if (p.type !== win.type) continue;
      if (p.type === "anytime") return keys[i];
      if (p.type === "after" && p.startMin === win.startMin) return keys[i];
      if (p.type === "between" && p.startMin === win.startMin && p.endMin === win.endMin) return keys[i];
    }
    return "anytime";
  }

  function durationIdFromMin(min) {
    if (!min) return "instant";
    for (var i = 0; i < DURATION_OPTIONS.length; i++) {
      if (DURATION_OPTIONS[i].minutes === min) return DURATION_OPTIONS[i].id;
    }
    return "30";
  }

  function durationFromId(id) {
    for (var i = 0; i < DURATION_OPTIONS.length; i++) {
      if (DURATION_OPTIONS[i].id === id) return DURATION_OPTIONS[i].minutes;
    }
    return 30;
  }

  function suggestFromTitle(title) {
    var hint = { duration: 30, window: "anytime" };
    for (var i = 0; i < KEYWORD_HINTS.length; i++) {
      if (KEYWORD_HINTS[i].re.test(title)) {
        hint = { duration: KEYWORD_HINTS[i].duration, window: KEYWORD_HINTS[i].window };
        break;
      }
    }
    var cat = findCatalogByTitle(title);
    if (cat) {
      hint.duration = cat.defaultDurationMin;
      hint.window = windowIdFromWindow(cat.defaultWindow);
      if (hint.window === "anytime" && cat.defaultWindow && cat.defaultWindow.type !== "anytime") {
        hint.customWindow = cat.defaultWindow;
      }
    }
    return hint;
  }

  function parseNaturalInput(raw) {
    var text = normalizeTitle(raw);
    var recurring = /recurring\s+daily|every\s+day|daily/i.test(text);
    text = text.replace(/\b(recurring\s+daily|every\s+day|daily)\b/gi, "").trim();

    var durationMin = null;
    var durMatch = text.match(/\((\s*\d+\s*(?:min|mins|minutes|m|hr|hrs|hour|hours)?\s*)\)/i)
      || text.match(/\b(\d+)\s*(min|mins|minutes|m)\b/i)
      || text.match(/\b(\d+(?:\.\d+)?)\s*(hr|hrs|hour|hours|h)\b/i);
    if (/\binstant\b/i.test(text)) {
      durationMin = 0;
      text = text.replace(/\binstant\b/gi, "").trim();
    } else if (durMatch) {
      var n = parseFloat(durMatch[1]);
      var unit = (durMatch[2] || "min").toLowerCase();
      if (/hr|hour|h/.test(unit)) durationMin = Math.round(n * 60);
      else durationMin = Math.round(n);
      text = text.replace(durMatch[0], "").trim();
    }

    var window = { type: "anytime" };
    var between = text.match(/(?:between|from)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|to|and)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    var after = text.match(/\bafter\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    var sometime = text.match(/some\s*time\s+between/i);
    if (between) {
      window = {
        type: "between",
        startMin: parseClock(between[1], between[2], between[3], between[6]),
        endMin: parseClock(between[4], between[5], between[6] || between[3], between[3]),
      };
      text = text.replace(between[0], "").replace(/some\s*time/i, "").trim();
    } else if (after) {
      window = {
        type: "after",
        startMin: parseClock(after[1], after[2], after[3]),
      };
      text = text.replace(after[0], "").trim();
    } else if (sometime) {
      text = text.replace(/some\s*time\s+between/i, "").trim();
    }

    text = text.replace(/[()]/g, " ").replace(/\s+/g, " ").trim();
    text = text
      .replace(/\b(some\s*time\s+)?(between|from)\b/gi, " ")
      .replace(/\b(morning|afternoon|evening|anytime|tonight)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) text = normalizeTitle(raw).replace(/\([^)]*\)/g, "").replace(/\b(recurring\s+daily|every\s+day|daily|instant|morning|afternoon|evening|anytime|tonight)\b/gi, "").replace(/\s+/g, " ").trim() || "Task";

    var hint = suggestFromTitle(text);
    if (durationMin == null) durationMin = hint.duration;
    if (window.type === "anytime") {
      if (hint.customWindow) window = hint.customWindow;
      else window = windowFromId(hint.window);
    }

    return {
      title: text,
      durationMin: durationMin,
      window: window,
      recurring: recurring ? { freq: "daily" } : null,
      windowId: windowIdFromWindow(window),
      durationId: durationIdFromMin(durationMin),
    };
  }

  function parseClock(h, m, ampm, fallbackAmpm) {
    var hour = parseInt(h, 10);
    var min = m ? parseInt(m, 10) : 0;
    var ap = (ampm || fallbackAmpm || "").toLowerCase();
    if (!ap) {
      if (hour >= 1 && hour <= 6) ap = "pm";
      else if (hour >= 7 && hour <= 11) ap = "am";
      else if (hour === 12) ap = "pm";
    }
    if (ap === "pm" && hour < 12) hour += 12;
    if (ap === "am" && hour === 12) hour = 0;
    return clamp(hour * 60 + min, 0, 1435);
  }

  function findCatalogByTitle(title) {
    var key = titleKey(title);
    if (!key) return null;
    for (var i = 0; i < data.catalog.length; i++) {
      if (titleKey(data.catalog[i].title) === key) return data.catalog[i];
    }
    return null;
  }

  function upsertCatalog(title, opts) {
    opts = opts || {};
    var existing = opts.catalogId
      ? data.catalog.find(function (c) { return c.id === opts.catalogId; })
      : findCatalogByTitle(title);
    if (existing) {
      existing.title = normalizeTitle(title) || existing.title;
      if (typeof opts.durationMin === "number") existing.defaultDurationMin = opts.durationMin;
      if (opts.window) existing.defaultWindow = normalizeWindow(opts.window);
      if (opts.recurring !== undefined) existing.recurring = opts.recurring;
      if (opts.markDone) {
        existing.doneCount = (existing.doneCount || 0) + 1;
        existing.lastDoneAt = new Date().toISOString();
        existing.lastDoneDate = opts.date || todayKey();
      }
      existing.updatedAt = new Date().toISOString();
      return existing;
    }
    var item = {
      id: uid("task"),
      title: normalizeTitle(title),
      defaultDurationMin: typeof opts.durationMin === "number" ? opts.durationMin : 30,
      defaultWindow: normalizeWindow(opts.window || { type: "anytime" }),
      lastDoneAt: opts.markDone ? new Date().toISOString() : null,
      lastDoneDate: opts.markDone ? (opts.date || todayKey()) : null,
      doneCount: opts.markDone ? 1 : 0,
      recurring: opts.recurring || null,
      updatedAt: new Date().toISOString(),
    };
    data.catalog.unshift(item);
    return item;
  }

  function windowBounds(win) {
    win = normalizeWindow(win);
    if (win.type === "between") {
      return {
        lo: win.startMin || DAY_START,
        hi: win.endMin || DAY_END,
      };
    }
    if (win.type === "after") {
      return { lo: win.startMin || 0, hi: DAY_END };
    }
    if (win.type === "at") {
      var at = win.startMin || DAY_START;
      return { lo: at, hi: Math.min(1440, at + 120) };
    }
    return { lo: DAY_START, hi: DAY_END };
  }

  function suggestedPlacement(durationMin, win, date) {
    durationMin = durationMin > 0 ? durationMin : MIN_DURATION;
    win = normalizeWindow(win);
    var bounds = windowBounds(win);
    var lo = bounds.lo;
    var hi = bounds.hi;
    var start;
    var now = date === todayKey() ? nowMinutes() : lo;

    if (win.type === "anytime") {
      if (date === todayKey()) {
        start = round5(clamp(now, DAY_START, DAY_END - durationMin));
      } else {
        start = round5(lo + Math.max(0, Math.floor((hi - lo - durationMin) / 2)));
      }
    } else if (win.type === "after") {
      start = date === todayKey() ? Math.max(lo, now) : lo;
      start = round5(start);
    } else if (win.type === "at") {
      start = round5(win.startMin || lo);
    } else {
      if (now < lo) start = lo;
      else if (now > hi - durationMin) start = Math.max(lo, hi - durationMin);
      else start = now;
      start = round5(start);
      if (start + durationMin > hi) start = Math.max(lo, hi - durationMin);
    }

    start = clamp(start, 0, 1440 - durationMin);
    return { startMin: start, endMin: start + durationMin };
  }

  function isScheduledPending(item) {
    return !!(item && item.scheduled && typeof item.startMin === "number" && typeof item.endMin === "number");
  }

  function ensurePendingPlacement(item) {
    if (!item) return item;
    if (!isScheduledPending(item)) return item;
    var dur = item.durationMin > 0 ? item.durationMin : MIN_DURATION;
    if (item.endMin - item.startMin < MIN_DURATION) {
      item.endMin = item.startMin + dur;
    }
    return item;
  }

  function schedulePending(id, startMin, date) {
    var item = findPending(id);
    if (!item) return;
    var dur = item.durationMin > 0 ? item.durationMin : MIN_DURATION;
    var bounds = windowBounds(item.window);
    startMin = round5(startMin);
    startMin = clamp(startMin, bounds.lo, Math.max(bounds.lo, bounds.hi - dur));
    startMin = clamp(startMin, DAY_START, 1440 - dur);
    item.scheduled = true;
    item.startMin = startMin;
    item.endMin = startMin + dur;
    if (date) item.date = date;
    saveData();
  }

  function unschedulePending(id) {
    var item = findPending(id);
    if (!item || isRunning(item)) return;
    item.scheduled = false;
    item.startMin = null;
    item.endMin = null;
    saveData();
  }

  function matchCatalogSuggestions(query) {
    var q = titleKey(query);
    if (!q || q.length < 1) return [];
    return data.catalog
      .filter(function (c) {
        return titleKey(c.title).indexOf(q) !== -1;
      })
      .sort(function (a, b) {
        var aExact = titleKey(a.title).indexOf(q) === 0 ? 0 : 1;
        var bExact = titleKey(b.title).indexOf(q) === 0 ? 0 : 1;
        if (aExact !== bExact) return aExact - bExact;
        return (b.doneCount || 0) - (a.doneCount || 0);
      })
      .slice(0, 6);
  }

  function pendingForDate(date) {
    return data.pending
      .filter(function (p) {
        if (isRunning(p)) return false;
        if (p.date === date) return true;
        if (p.recurring && p.recurring.freq === "daily") {
          var doneSame = data.entries.some(function (e) {
            return e.date === date && titleKey(e.title) === titleKey(p.title);
          });
          return !doneSame && p.date <= date;
        }
        return false;
      })
      .sort(function (a, b) {
        var as = isScheduledPending(a) ? a.startMin : 9999;
        var bs = isScheduledPending(b) ? b.startMin : 9999;
        return as - bs;
      });
  }

  function boardPendingForDate(date) {
    return pendingForDate(date).filter(function (p) {
      return !isRunning(p) && !isScheduledPending(p);
    });
  }

  function scheduledPendingForDate(date) {
    return pendingForDate(date).filter(function (p) {
      return !isRunning(p) && isScheduledPending(p);
    });
  }

  function entriesForDate(date) {
    return data.entries
      .filter(function (e) { return e.date === date; })
      .sort(function (a, b) { return a.startMin - b.startMin; });
  }

  function setChipSelection(container, attr, value) {
    if (!container) return;
    Array.prototype.forEach.call(container.querySelectorAll(".chip"), function (btn) {
      btn.classList.toggle("selected", btn.getAttribute(attr) === String(value));
    });
  }

  function updateSuggestHint() {
    var hint = document.getElementById("suggestHint");
    if (!hint) return;
    var dur = durationFromId(state.durationId);
    var win = windowFromId(state.windowId);
    var modeLabel = state.addMode === "start"
      ? "starts a timer now"
      : state.addMode === "done"
        ? "logs as done"
        : "adds to still to do";
    hint.textContent = "Suggested: " + formatDuration(dur) + " · " + windowLabel(win)
      + (document.getElementById("recurringDaily").checked ? " · daily" : "")
      + " · " + modeLabel;
  }

  function renderDateNav() {
    var pill = document.getElementById("datePill");
    if (pill) pill.textContent = formatLongDate(state.selectedDate);
    var sub = document.getElementById("headerSubtitle");
    if (sub) {
      if (state.view === "today") sub.textContent = "Journal what you did";
      else if (state.view === "week") sub.textContent = "Daily & weekly calendar";
      else sub.textContent = "Last time you did each task";
    }
  }

  function renderSuggestions() {
    var list = document.getElementById("suggestList");
    var input = document.getElementById("addInput");
    if (!list || !input) return;
    var q = input.value;
    var matches = matchCatalogSuggestions(q);
    if (!matches.length || !normalizeTitle(q)) {
      list.hidden = true;
      list.innerHTML = "";
      return;
    }
    list.hidden = false;
    list.innerHTML = matches.map(function (c) {
      return (
        '<button type="button" class="suggest-item" data-catalog-id="' + escapeHtml(c.id) + '">' +
          "<strong>" + escapeHtml(c.title) + "</strong>" +
          "<span>" + formatDuration(c.defaultDurationMin) + " · " + escapeHtml(windowLabel(c.defaultWindow)) +
          " · last " + escapeHtml(formatRelativeDay(c.lastDoneDate || c.lastDoneAt)) + "</span>" +
        "</button>"
      );
    }).join("");
  }

  function trackWidth() {
    return Math.round(DAY_SPAN * PX_PER_MIN);
  }

  function minToX(min) {
    return (clamp(min, DAY_START, DAY_END) - DAY_START) * PX_PER_MIN;
  }

  function xToMin(x) {
    return round5(DAY_START + x / PX_PER_MIN);
  }

  function buildHourMarks(container, className) {
    if (!container) return;
    var html = "";
    for (var h = Math.floor(DAY_START / 60); h <= Math.floor(DAY_END / 60); h++) {
      var min = h * 60;
      var left = minToX(min);
      html += '<div class="' + className + '" style="left:' + left + 'px">' + formatHourLabel(h) + "</div>";
    }
    container.style.width = trackWidth() + "px";
    container.innerHTML = html;
  }

  function formatHourLabel(h) {
    var ampm = h >= 12 ? "p" : "a";
    var h12 = h % 12;
    if (h12 === 0) h12 = 12;
    return h12 + ampm;
  }

  function renderTimelineBands(highlightWin) {
    var bands = document.getElementById("timelineBands");
    if (!bands) return;
    var highlightId = highlightWin ? windowIdFromWindow(highlightWin) : null;
    var defs = [
      { id: "morning", lo: 420, hi: 720, label: "Morning" },
      { id: "afternoon", lo: 720, hi: 1020, label: "Afternoon" },
      { id: "evening", lo: 1020, hi: 1320, label: "Evening" },
      { id: "between13_16", lo: 780, hi: 960, label: "1–4p" },
      { id: "after20", lo: 1200, hi: DAY_END, label: "8p+" },
    ];
    bands.style.width = trackWidth() + "px";
    bands.innerHTML = defs.map(function (d) {
      var left = minToX(d.lo);
      var width = Math.max(8, minToX(d.hi) - left);
      var on = highlightId === d.id;
      return (
        '<div class="tl-band band-' + d.id + (on ? " highlight" : "") + '" style="left:' + left + "px;width:" + width + 'px" title="' + escapeHtml(d.label) + '">' +
          '<span class="tl-band-label">' + escapeHtml(d.label) + "</span>" +
        "</div>"
      );
    }).join("");
  }

  function scrollTimelineToMin(min, smooth) {
    var scroll = document.getElementById("timelineScroll");
    if (!scroll) return;
    var target = Math.max(0, minToX(min) - scroll.clientWidth * 0.15);
    if (smooth && scroll.scrollTo) {
      scroll.scrollTo({ left: target, behavior: "smooth" });
    } else {
      scroll.scrollLeft = target;
    }
  }

  function renderTimeline() {
    var scroll = document.getElementById("timelineScroll");
    var track = document.getElementById("timelineTrack");
    var hours = document.getElementById("timelineHours");
    var blocks = document.getElementById("timelineBlocks");
    var nowEl = document.getElementById("timelineNow");
    var legend = document.getElementById("timelineLegend");
    if (!track || !blocks) return;

    var dragItem = state.boardDragId ? findPending(state.boardDragId) : null;
    renderTimelineBands(dragItem ? dragItem.window : null);
    if (scroll) {
      scroll.classList.toggle("drop-target", !!state.boardDragId);
    }

    buildHourMarks(hours, "tl-hour");
    track.style.width = trackWidth() + "px";
    blocks.style.width = trackWidth() + "px";
    blocks.style.position = "absolute";
    blocks.style.inset = "0";

    var date = state.selectedDate;
    var entries = entriesForDate(date);
    var scheduled = scheduledPendingForDate(date);
    var boardCount = boardPendingForDate(date).length;
    var active = activeItems().filter(function (p) {
      return dateKey(new Date(p.timerStartedAt)) === date || date === todayKey();
    });
    var html = "";

    active.forEach(function (p) {
      var start = new Date(p.timerStartedAt);
      var startMin = start.getHours() * 60 + start.getMinutes();
      var endMin = date === todayKey() ? Math.max(startMin + MIN_DURATION, nowMinutes()) : startMin + Math.max(p.durationMin || 30, MIN_DURATION);
      var left = minToX(startMin);
      var width = Math.max(36, minToX(endMin) - left);
      html +=
        '<div class="tl-block active-ghost" data-kind="pending" data-id="' + escapeHtml(p.id) + '" style="left:' + left + "px;width:" + width + 'px">' +
          '<span class="range-handle left" data-handle="start"></span>' +
          '<span class="tl-block-label range-mid" data-handle="move">' + escapeHtml(p.title) + "</span>" +
          '<span class="range-handle right" data-handle="end"></span>' +
        "</div>";
    });

    scheduled.forEach(function (p) {
      ensurePendingPlacement(p);
      var left = minToX(p.startMin);
      var width = Math.max(36, minToX(p.endMin) - left);
      html +=
        '<div class="tl-block pending-ghost" data-kind="pending" data-id="' + escapeHtml(p.id) + '" style="left:' + left + "px;width:" + width + 'px">' +
          '<span class="range-handle left" data-handle="start"></span>' +
          '<span class="tl-block-label range-mid" data-handle="move">' + escapeHtml(p.title) + "</span>" +
          '<span class="range-handle right" data-handle="end"></span>' +
        "</div>";
    });

    entries.forEach(function (e) {
      var left = minToX(e.startMin);
      var width = Math.max(36, minToX(e.endMin) - left);
      html +=
        '<div class="tl-block" data-kind="entry" data-id="' + escapeHtml(e.id) + '" style="left:' + left + "px;width:" + width + 'px">' +
          '<span class="range-handle left" data-handle="start"></span>' +
          '<span class="tl-block-label range-mid" data-handle="move">' + escapeHtml(e.title) + "</span>" +
          '<span class="range-handle right" data-handle="end"></span>' +
        "</div>";
    });
    blocks.innerHTML = html;

    var schedCount = document.getElementById("scheduledCount");
    if (schedCount) schedCount.textContent = String(scheduled.length + active.length);

    if (legend) {
      legend.innerHTML =
        "<span>" + entries.length + " done · " + scheduled.length + " scheduled · " + boardCount + " on board</span>" +
        "<span>~" + VISIBLE_HOURS_TARGET + "h visible · swipe for full day</span>";
    }

    if (nowEl) {
      if (date === todayKey()) {
        nowEl.hidden = false;
        nowEl.style.left = minToX(nowMinutes()) + "px";
      } else {
        nowEl.hidden = true;
      }
    }

    if (scroll && !scroll.dataset.scrolled) {
      var focus = date === todayKey() ? nowMinutes() : DAY_START + 240;
      scrollTimelineToMin(focus, false);
      scroll.dataset.scrolled = "1";
    }
  }

  function updatesHtml(updates) {
    if (!updates || !updates.length) return "";
    return (
      '<ul class="update-list">' +
      updates.map(function (u) {
        return (
          "<li><span class=\"update-time\">" + escapeHtml(formatClockFromIso(u.at)) +
          "</span><span>" + escapeHtml(u.text) + "</span></li>"
        );
      }).join("") +
      "</ul>"
    );
  }

  function renderActiveList() {
    var list = document.getElementById("activeList");
    var empty = document.getElementById("activeEmpty");
    var count = document.getElementById("activeCount");
    var head = document.getElementById("activeHead");
    var items = activeItems();
    if (count) count.textContent = String(items.length);
    if (head) head.hidden = false;
    if (!list) return;
    if (!items.length) {
      list.innerHTML = "";
      if (empty) empty.hidden = state.view !== "today";
      // Keep empty hint visible lightly when today and nothing running
      if (empty) empty.hidden = true;
      return;
    }
    if (empty) empty.hidden = true;
    list.innerHTML = items.map(function (p) {
      var started = new Date(p.timerStartedAt);
      var elapsed = formatElapsed(Date.now() - started.getTime());
      var startedLabel = formatClockFromIso(p.timerStartedAt);
      return (
        '<li class="item-card active" data-id="' + escapeHtml(p.id) + '">' +
          '<div class="item-main">' +
            '<p class="item-title">' + escapeHtml(p.title) + "</p>" +
            '<p class="item-meta">Started ' + escapeHtml(startedLabel) +
              " · " + escapeHtml(elapsed) + " elapsed" +
              (p.updates && p.updates.length ? " · " + p.updates.length + " update" + (p.updates.length === 1 ? "" : "s") : "") +
            "</p>" +
            '<div class="timer-badge" data-timer-for="' + escapeHtml(p.id) + '">' + escapeHtml(elapsed) + "</div>" +
          "</div>" +
          '<div class="item-actions">' +
            '<button type="button" class="mini-btn primary" data-action="complete">Done</button>' +
            '<button type="button" class="mini-btn" data-action="update">Update</button>' +
            '<button type="button" class="mini-btn" data-action="edit">Edit</button>' +
          "</div>" +
          updatesHtml(p.updates) +
        "</li>"
      );
    }).join("");
  }

  function renderPendingList() {
    var list = document.getElementById("pendingList");
    var empty = document.getElementById("pendingEmpty");
    var count = document.getElementById("pendingCount");
    var items = boardPendingForDate(state.selectedDate);
    if (count) count.textContent = String(items.length);
    if (!list) return;
    if (!items.length) {
      list.innerHTML = "";
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    list.innerHTML = items.map(function (p) {
      var dur = p.durationMin > 0 ? formatDuration(p.durationMin) : "Instant";
      var when = windowLabel(p.window);
      var bandId = windowIdFromWindow(p.window);
      return (
        '<li class="board-chip pending" data-board-id="' + escapeHtml(p.id) + '" data-band="' + escapeHtml(bandId) + '">' +
          '<span class="board-grip" aria-hidden="true">⋮⋮</span>' +
          '<div class="board-chip-main">' +
            '<p class="item-title">' + escapeHtml(p.title) + "</p>" +
            '<p class="item-meta">' + escapeHtml(dur) + " · " + escapeHtml(when) +
              (p.recurring ? " · daily" : "") + "</p>" +
          "</div>" +
          '<div class="board-chip-actions">' +
            '<button type="button" class="mini-btn start" data-action="start">Start</button>' +
            '<button type="button" class="mini-btn" data-action="schedule">Place</button>' +
            '<button type="button" class="mini-btn primary" data-action="complete">Done</button>' +
            '<button type="button" class="mini-btn" data-action="edit">Edit</button>' +
          "</div>" +
        "</li>"
      );
    }).join("");
  }

  function rangeScrubHtml(startMin, endMin) {
    var left = minToX(startMin);
    var width = Math.max(28, minToX(endMin) - left);
    return (
      '<div class="range-meta"><span>' + escapeHtml(formatTime(startMin) + " – " + formatTime(endMin)) +
        "</span><span>" + escapeHtml(formatDuration(endMin - startMin)) + "</span></div>" +
      '<div class="range-scrub">' +
        '<div class="range-scrub-hours" style="width:' + trackWidth() + 'px"></div>' +
        '<div class="range-block" style="left:' + left + "px;width:" + width + "px;top:18px\">" +
          '<span class="range-handle left" data-handle="start"></span>' +
          '<span class="range-mid" data-handle="move"></span>' +
          '<span class="range-handle right" data-handle="end"></span>' +
        "</div>" +
      "</div>"
    );
  }

  function paintInlineHourMarks() {
    Array.prototype.forEach.call(document.querySelectorAll(".item-range .range-scrub-hours"), function (el) {
      buildHourMarks(el, "range-hour");
    });
  }

  function renderDoneList() {
    var list = document.getElementById("doneList");
    var empty = document.getElementById("doneEmpty");
    var count = document.getElementById("doneCount");
    var items = entriesForDate(state.selectedDate);
    if (count) count.textContent = String(items.length);
    if (!list) return;
    if (!items.length) {
      list.innerHTML = "";
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    list.innerHTML = items.map(function (e) {
      var cat = e.catalogId
        ? data.catalog.find(function (c) { return c.id === e.catalogId; })
        : findCatalogByTitle(e.title);
      var lastNote = cat && cat.doneCount > 1
        ? " · done " + cat.doneCount + "×"
        : "";
      var updateNote = e.updates && e.updates.length
        ? " · " + e.updates.length + " update" + (e.updates.length === 1 ? "" : "s")
        : "";
      return (
        '<li class="item-card done" data-id="' + escapeHtml(e.id) + '">' +
          '<div class="item-main">' +
            '<p class="item-title">' + escapeHtml(e.title) + "</p>" +
            '<p class="item-meta">' + escapeHtml(formatTime(e.startMin) + " – " + formatTime(e.endMin)) +
              " · " + escapeHtml(formatDuration(e.durationMin)) + escapeHtml(lastNote) + escapeHtml(updateNote) + "</p>" +
          "</div>" +
          '<div class="item-actions">' +
            '<button type="button" class="mini-btn" data-action="edit-entry">Edit</button>' +
          "</div>" +
          updatesHtml(e.updates) +
          '<div class="item-range" data-kind="entry" data-id="' + escapeHtml(e.id) + '">' +
            rangeScrubHtml(e.startMin, e.endMin) +
          "</div>" +
        "</li>"
      );
    }).join("");
  }

  function renderWeek() {
    var grid = document.getElementById("weekGrid");
    var journal = document.getElementById("weekJournal");
    var empty = document.getElementById("weekEmpty");
    var label = document.getElementById("weekLabel");
    if (!grid) return;
    var start = startOfWeek(state.selectedDate);
    if (label) {
      var end = addDays(start, 6);
      label.textContent = formatRelativeDay(start) === "Today"
        ? "This week"
        : formatLongDate(start).replace(/^.*?·\s*/, "") + " – " + formatLongDate(end).replace(/^.*?·\s*/, "");
    }
    var html = "";
    var weekEntries = [];
    for (var i = 0; i < 7; i++) {
      var key = addDays(start, i);
      var d = parseDateKey(key);
      var entries = entriesForDate(key);
      var pending = pendingForDate(key);
      weekEntries = weekEntries.concat(entries.map(function (e) {
        return Object.assign({}, e, { _date: key });
      }));
      var dots = "";
      entries.slice(0, 4).forEach(function () {
        dots += '<span class="week-dot"></span>';
      });
      pending.slice(0, 3).forEach(function () {
        dots += '<span class="week-dot pending"></span>';
      });
      html +=
        '<button type="button" class="week-day' +
          (key === todayKey() ? " today" : "") +
          (key === state.selectedDate ? " selected" : "") +
          '" data-date="' + key + '">' +
          '<span class="week-day-name">' + d.toLocaleDateString(undefined, { weekday: "short" }) + "</span>" +
          '<span class="week-day-num">' + d.getDate() + "</span>" +
          '<span class="week-dots">' + dots + "</span>" +
          '<span class="week-day-count">' + entries.length + " done</span>" +
        "</button>";
    }
    grid.innerHTML = html;

    weekEntries.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return b.startMin - a.startMin;
    });
    if (!journal) return;
    if (!weekEntries.length) {
      journal.innerHTML = "";
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    journal.innerHTML = weekEntries.map(function (e) {
      return (
        '<li class="item-card done">' +
          '<div class="item-main">' +
            '<p class="item-title">' + escapeHtml(e.title) + "</p>" +
            '<p class="item-meta">' + escapeHtml(formatLongDate(e.date)) + " · " +
              escapeHtml(formatTime(e.startMin) + " – " + formatTime(e.endMin)) + "</p>" +
          "</div>" +
        "</li>"
      );
    }).join("");
  }

  function renderHistory() {
    var list = document.getElementById("catalogList");
    var empty = document.getElementById("catalogEmpty");
    var count = document.getElementById("catalogCount");
    var q = titleKey(state.historyQuery);
    var items = data.catalog.slice().sort(function (a, b) {
      var ad = a.lastDoneDate || "";
      var bd = b.lastDoneDate || "";
      if (ad !== bd) return ad < bd ? 1 : -1;
      return titleKey(a.title).localeCompare(titleKey(b.title));
    });
    if (q) {
      items = items.filter(function (c) {
        return titleKey(c.title).indexOf(q) !== -1;
      });
    }
    if (count) count.textContent = String(items.length);
    if (!list) return;
    if (!items.length) {
      list.innerHTML = "";
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    list.innerHTML = items.map(function (c) {
      return (
        '<li class="item-card">' +
          '<div class="item-main">' +
            '<p class="item-title">' + escapeHtml(c.title) + "</p>" +
            '<p class="item-meta">' + escapeHtml(formatDuration(c.defaultDurationMin)) +
              " · " + escapeHtml(windowLabel(c.defaultWindow)) +
              (c.recurring ? " · daily" : "") +
              ' · <span class="catalog-last">last ' + escapeHtml(formatRelativeDay(c.lastDoneDate || c.lastDoneAt)) + "</span>" +
              (c.doneCount ? " · " + c.doneCount + "×" : "") +
            "</p>" +
          "</div>" +
          '<div class="item-actions">' +
            '<button type="button" class="mini-btn primary" data-action="reuse" data-id="' + escapeHtml(c.id) + '">Add</button>' +
          "</div>" +
        "</li>"
      );
    }).join("");
  }

  function renderAll() {
    renderDateNav();
    setChipSelection(document.getElementById("durationChips"), "data-duration", state.durationId);
    setChipSelection(document.getElementById("windowChips"), "data-window", state.windowId);
    document.getElementById("modePending").classList.toggle("selected", state.addMode === "pending");
    document.getElementById("modeStart").classList.toggle("selected", state.addMode === "start");
    document.getElementById("modeDone").classList.toggle("selected", state.addMode === "done");
    updateSuggestHint();
    if (state.view === "today") {
      renderActiveList();
      renderPendingList();
      renderDoneList();
      renderTimeline();
      paintInlineHourMarks();
      ensureTick();
    } else if (state.view === "week") {
      renderWeek();
      stopTick();
    } else {
      renderHistory();
      stopTick();
    }
  }

  function switchView(view) {
    state.view = view;
    document.body.className = "view-" + view;
    Array.prototype.forEach.call(document.querySelectorAll(".view"), function (el) {
      el.classList.toggle("active", el.getAttribute("data-view") === view);
    });
    Array.prototype.forEach.call(document.querySelectorAll(".nav-btn"), function (btn) {
      var on = btn.getAttribute("data-view") === view;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    var dateNav = document.getElementById("dateNav");
    if (dateNav) dateNav.hidden = view === "history";
    var scroll = document.getElementById("timelineScroll");
    if (scroll) delete scroll.dataset.scrolled;
    renderAll();
  }

  function applyParsedToForm(parsed, fromCatalog) {
    if (!parsed) return;
    if (parsed.title) document.getElementById("addInput").value = parsed.title;
    if (parsed.durationId) state.durationId = parsed.durationId;
    else if (typeof parsed.durationMin === "number") state.durationId = durationIdFromMin(parsed.durationMin);
    if (parsed.windowId) state.windowId = parsed.windowId;
    else if (parsed.window) state.windowId = windowIdFromWindow(parsed.window);
    if (fromCatalog && fromCatalog.recurring) {
      document.getElementById("recurringDaily").checked = true;
    } else if (parsed.recurring) {
      document.getElementById("recurringDaily").checked = true;
    }
    setChipSelection(document.getElementById("durationChips"), "data-duration", state.durationId);
    setChipSelection(document.getElementById("windowChips"), "data-window", state.windowId);
    updateSuggestHint();
    renderSuggestions();
  }

  function addFromForm(e) {
    if (e) e.preventDefault();
    var input = document.getElementById("addInput");
    var raw = input.value;
    if (!normalizeTitle(raw)) {
      toast("Type a task first");
      return;
    }
    var parsed = parseNaturalInput(raw);
    if (!parsed.title) {
      toast("Couldn’t read that task");
      return;
    }
    var durationMin = durationFromId(state.durationId);
    if (parsed.durationMin != null && state.durationId === durationIdFromMin(parsed.durationMin)) {
      durationMin = parsed.durationMin;
    } else if (document.activeElement === input) {
      durationMin = durationFromId(state.durationId);
    }
    // Prefer chips if user changed them after typing; natural parse seeds chips on input.
    durationMin = durationFromId(state.durationId);
    var win = windowFromId(state.windowId);
    var recurring = document.getElementById("recurringDaily").checked ? { freq: "daily" } : null;
    var cat = upsertCatalog(parsed.title, {
      durationMin: durationMin,
      window: win,
      recurring: recurring,
    });

    if (state.addMode === "done") {
      completeTask({
        title: cat.title,
        catalogId: cat.id,
        durationMin: durationMin || MIN_DURATION,
        window: win,
        date: state.selectedDate,
      });
      toast("Logged as done");
    } else {
      var pendingItem = {
        id: uid("todo"),
        catalogId: cat.id,
        title: cat.title,
        durationMin: durationMin,
        window: win,
        scheduled: false,
        startMin: null,
        endMin: null,
        recurring: recurring,
        date: state.selectedDate,
        createdAt: new Date().toISOString(),
        timerStartedAt: null,
        updates: [],
      };
      data.pending.unshift(pendingItem);
      saveData();
      if (state.addMode === "start") {
        openStartSheet(pendingItem.id);
        toast("When did you start?");
      } else {
        toast("Added to still need to do");
      }
    }

    input.value = "";
    document.getElementById("recurringDaily").checked = false;
    document.getElementById("suggestList").hidden = true;
    state.durationId = "30";
    state.windowId = "anytime";
    renderAll();
  }

  function completeTask(opts) {
    var pendingItem = opts.pendingId ? findPending(opts.pendingId) : null;
    var updates = normalizeUpdates((pendingItem && pendingItem.updates) || opts.updates || []);
    var timerStartedAt = (pendingItem && pendingItem.timerStartedAt) || opts.timerStartedAt || null;
    var durationMin = opts.durationMin > 0 ? opts.durationMin : MIN_DURATION;
    var place;

    if (timerStartedAt) {
      var start = new Date(timerStartedAt);
      var startMin = start.getHours() * 60 + start.getMinutes();
      if (opts.useFixedRange && opts.startMin != null && opts.endMin != null) {
        place = { startMin: opts.startMin, endMin: opts.endMin };
        durationMin = Math.max(MIN_DURATION, place.endMin - place.startMin);
      } else {
        var elapsedMin = Math.max(MIN_DURATION, Math.round((Date.now() - start.getTime()) / 60000));
        var endMin;
        if (dateKey(start) === todayKey()) {
          endMin = Math.max(startMin + MIN_DURATION, nowMinutes());
          endMin = Math.max(endMin, Math.min(1440, startMin + elapsedMin));
        } else {
          endMin = Math.min(1440, startMin + elapsedMin);
          if (endMin <= startMin) endMin = 1440;
        }
        place = { startMin: startMin, endMin: endMin };
        durationMin = endMin - startMin;
      }
    } else if (opts.startMin != null) {
      place = { startMin: opts.startMin, endMin: opts.endMin || opts.startMin + durationMin };
    } else {
      place = suggestedPlacement(durationMin, opts.window || { type: "anytime" }, opts.date || state.selectedDate);
    }

    var entryDate = opts.date || state.selectedDate;
    if (timerStartedAt) {
      entryDate = dateKey(new Date(timerStartedAt));
    }

    var cat = upsertCatalog(opts.title, {
      catalogId: opts.catalogId,
      durationMin: opts.durationMin,
      window: opts.window,
      markDone: true,
      date: entryDate,
    });
    data.entries.push({
      id: uid("done"),
      catalogId: cat.id,
      title: cat.title,
      date: entryDate,
      startMin: place.startMin,
      endMin: place.endMin,
      durationMin: Math.max(MIN_DURATION, place.endMin - place.startMin),
      createdAt: new Date().toISOString(),
      timerStartedAt: timerStartedAt,
      updates: updates,
    });
    if (opts.pendingId) {
      if (pendingItem && pendingItem.recurring && pendingItem.recurring.freq === "daily") {
        pendingItem.timerStartedAt = null;
        pendingItem.updates = [];
      } else {
        data.pending = data.pending.filter(function (p) { return p.id !== opts.pendingId; });
      }
    }
    saveData();
  }

  function applyInProgressStart(item, startedAtIso) {
    var start = new Date(startedAtIso);
    if (isNaN(start.getTime())) start = new Date();
    item.timerStartedAt = start.toISOString();
    item.scheduled = true;
    item.startMin = start.getHours() * 60 + start.getMinutes();
    item.endMin = item.startMin + Math.max(item.durationMin || MIN_DURATION, MIN_DURATION);
    if (!Array.isArray(item.updates)) item.updates = [];
    var hasStarted = item.updates.some(function (u) { return u.text === "Started"; });
    if (!hasStarted) {
      item.updates.push({
        id: uid("upd"),
        text: "Started",
        at: item.timerStartedAt,
      });
    }
    saveData();
  }

  function setStartSheetMode(mode) {
    state.startSheetMode = mode === "earlier" ? "earlier" : "now";
    document.getElementById("startModeNow").classList.toggle("selected", state.startSheetMode === "now");
    document.getElementById("startModeEarlier").classList.toggle("selected", state.startSheetMode === "earlier");
    document.getElementById("startEarlierFields").hidden = state.startSheetMode !== "earlier";
    document.getElementById("startConfirmBtn").textContent = state.startSheetMode === "now" ? "Start now" : "Continue";
    updateStartSheetPreview();
  }

  function updateStartSheetPreview() {
    var hint = document.getElementById("startSheetHint");
    if (!hint || state.startSheetMode !== "earlier") return;
    var startIso = isoFromDateKeyAndTime(state.selectedDate, document.getElementById("startTimeStarted").value);
    var elapsed = formatElapsed(Date.now() - new Date(startIso).getTime());
    var endVal = document.getElementById("startTimeEnded").value;
    if (endVal) {
      hint.textContent = "Will log a finished session from your start and end times.";
    } else {
      hint.textContent = "No end time — timer keeps running (" + elapsed + " so far from that start).";
    }
  }

  function openStartSheet(id) {
    var item = findPending(id);
    if (!item) return;
    if (item.timerStartedAt) {
      toast("Already running");
      return;
    }
    state.startPendingId = id;
    document.getElementById("startSheetTitle").textContent = "Start · " + item.title;
    document.getElementById("startSheetSub").textContent = "Pick now or when you actually started.";
    document.getElementById("startTimeStarted").value = timeInputValue(new Date());
    document.getElementById("startTimeEnded").value = "";
    setStartSheetMode("now");
    document.getElementById("startOverlay").hidden = false;
  }

  function closeStartSheet() {
    state.startPendingId = null;
    document.getElementById("startOverlay").hidden = true;
  }

  function confirmStartSheet() {
    var item = findPending(state.startPendingId);
    if (!item) {
      closeStartSheet();
      return;
    }
    var date = state.selectedDate;

    if (state.startSheetMode === "now") {
      applyInProgressStart(item, new Date().toISOString());
      closeStartSheet();
      toast("Timer started");
      renderAll();
      return;
    }

    var startIso = isoFromDateKeyAndTime(date, document.getElementById("startTimeStarted").value);
    var endMin = minutesFromTimeInput(document.getElementById("startTimeEnded").value);
    var startMin = minutesFromTimeInput(document.getElementById("startTimeStarted").value);

    if (endMin == null || !document.getElementById("startTimeEnded").value) {
      applyInProgressStart(item, startIso);
      closeStartSheet();
      toast("Timer from " + formatClockFromIso(startIso));
      renderAll();
      return;
    }

    if (endMin <= startMin) {
      toast("End time must be after start");
      return;
    }

    completeTask({
      pendingId: item.id,
      title: item.title,
      catalogId: item.catalogId,
      durationMin: endMin - startMin,
      window: item.window,
      date: date,
      timerStartedAt: startIso,
      startMin: startMin,
      endMin: endMin,
      useFixedRange: true,
      updates: [{ id: uid("upd"), text: "Started", at: startIso }],
    });
    closeStartSheet();
    toast("Logged session");
    renderAll();
  }

  function startTimer(id) {
    openStartSheet(id);
  }

  function openUpdateSheet(id) {
    var item = findPending(id);
    if (!item) return;
    state.updatingId = id;
    document.getElementById("updateSheetTitle").textContent = "Update · " + item.title;
    document.getElementById("updateSheetSub").textContent = item.timerStartedAt
      ? "Running " + formatElapsed(Date.now() - new Date(item.timerStartedAt).getTime())
      : "Add a progress note";
    document.getElementById("updateInput").value = "";
    var chips = document.getElementById("updateSuggestChips");
    chips.innerHTML = suggestUpdates(item.title).map(function (tip) {
      return '<button type="button" class="chip" data-update-tip="' + escapeHtml(tip) + '">' + escapeHtml(tip) + "</button>";
    }).join("");
    document.getElementById("updateOverlay").hidden = false;
    setTimeout(function () {
      document.getElementById("updateInput").focus();
    }, 50);
  }

  function closeUpdateSheet() {
    state.updatingId = null;
    document.getElementById("updateOverlay").hidden = true;
  }

  function saveUpdate(text) {
    var item = findPending(state.updatingId);
    if (!item) return;
    text = normalizeTitle(text);
    if (!text) {
      toast("Type an update");
      return;
    }
    if (!Array.isArray(item.updates)) item.updates = [];
    item.updates.push({
      id: uid("upd"),
      text: text,
      at: new Date().toISOString(),
    });
    if (!item.timerStartedAt) {
      item.timerStartedAt = new Date().toISOString();
    }
    if (!item.scheduled) {
      var now = new Date();
      item.scheduled = true;
      item.startMin = now.getHours() * 60 + now.getMinutes();
      item.endMin = item.startMin + Math.max(item.durationMin || MIN_DURATION, MIN_DURATION);
    }
    saveData();
    closeUpdateSheet();
    renderAll();
    toast("Update added");
  }

  function refreshTimerBadges() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-timer-for]"), function (el) {
      var id = el.getAttribute("data-timer-for");
      var item = findPending(id);
      if (!item || !item.timerStartedAt) return;
      el.textContent = formatElapsed(Date.now() - new Date(item.timerStartedAt).getTime());
    });
  }

  function ensureTick() {
    if (tickTimer) return;
    if (!activeItems().length) return;
    tickTimer = setInterval(function () {
      if (!activeItems().length) {
        stopTick();
        return;
      }
      refreshTimerBadges();
    }, 1000);
  }

  function stopTick() {
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  }

  function findPending(id) {
    return data.pending.find(function (p) { return p.id === id; });
  }

  function updateItemRange(kind, id, startMin, endMin) {
    startMin = clamp(round5(startMin), 0, 1435);
    endMin = clamp(round5(endMin), startMin + MIN_DURATION, 1440);
    if (kind === "pending") {
      var p = findPending(id);
      if (!p) return;
      p.scheduled = true;
      p.startMin = startMin;
      p.endMin = endMin;
      p.durationMin = p.durationMin === 0 ? 0 : endMin - startMin;
      if (p.durationMin === 0) {
        p.endMin = startMin + MIN_DURATION;
      }
      upsertCatalog(p.title, { catalogId: p.catalogId, durationMin: p.durationMin, window: p.window });
    } else {
      var e = data.entries.find(function (x) { return x.id === id; });
      if (!e) return;
      e.startMin = startMin;
      e.endMin = endMin;
      e.durationMin = endMin - startMin;
    }
    saveData();
  }

  function openEdit(kind, id) {
    var item = kind === "pending" ? findPending(id) : data.entries.find(function (x) { return x.id === id; });
    if (!item) return;
    var place = isScheduledPending(item)
      ? { startMin: item.startMin, endMin: item.endMin }
      : suggestedPlacement(item.durationMin || MIN_DURATION, item.window, state.selectedDate);
    state.editing = {
      kind: kind,
      id: id,
      title: item.title,
      durationMin: item.durationMin,
      window: item.window || { type: "anytime" },
      startMin: place.startMin,
      endMin: place.endMin,
      recurring: !!(item.recurring && item.recurring.freq === "daily"),
      catalogId: item.catalogId || null,
    };
    document.getElementById("editTitle").textContent = kind === "pending" ? "Edit to-do" : "Edit done entry";
    document.getElementById("editName").value = item.title;
    document.getElementById("editRecurring").checked = state.editing.recurring;
    document.getElementById("editRecurringWrap").hidden = kind !== "pending";
    document.getElementById("editDoneBtn").hidden = kind !== "pending";
    renderEditChips();
    renderEditRange();
    document.getElementById("editOverlay").hidden = false;
  }

  function renderEditChips() {
    var durWrap = document.getElementById("editDurationChips");
    var winWrap = document.getElementById("editWindowChips");
    var durId = durationIdFromMin(state.editing.durationMin);
    durWrap.innerHTML = DURATION_OPTIONS.map(function (d) {
      return '<button type="button" class="chip' + (d.id === durId ? " selected" : "") +
        '" data-duration="' + d.id + '">' + d.label + "</button>";
    }).join("");
    var winId = windowIdFromWindow(state.editing.window);
    winWrap.innerHTML = Object.keys(WINDOW_PRESETS).map(function (id) {
      return '<button type="button" class="chip' + (id === winId ? " selected" : "") +
        '" data-window="' + id + '">' + WINDOW_PRESETS[id].label + "</button>";
    }).join("");
  }

  function renderEditRange() {
    var ed = state.editing;
    if (!ed) return;
    document.getElementById("editRangeLabel").textContent = formatTime(ed.startMin) + " – " + formatTime(ed.endMin);
    document.getElementById("editDurationLabel").textContent = formatDuration(ed.endMin - ed.startMin);
    var hours = document.getElementById("editRangeHours");
    buildHourMarks(hours, "range-hour");
    var block = document.getElementById("editRangeBlock");
    var left = minToX(ed.startMin);
    var width = Math.max(28, minToX(ed.endMin) - left);
    block.style.left = left + "px";
    block.style.width = width + "px";
    var scrub = document.getElementById("editRangeScrub");
    scrub.scrollLeft = Math.max(0, left - 80);
  }

  function saveEdit() {
    var ed = state.editing;
    if (!ed) return;
    var title = normalizeTitle(document.getElementById("editName").value);
    if (!title) {
      toast("Title required");
      return;
    }
    if (ed.kind === "pending") {
      var p = findPending(ed.id);
      if (!p) return;
      p.title = title;
      p.durationMin = ed.durationMin;
      p.window = normalizeWindow(ed.window);
      p.startMin = ed.startMin;
      p.endMin = ed.endMin;
      p.scheduled = true;
      p.recurring = document.getElementById("editRecurring").checked ? { freq: "daily" } : null;
      var cat = upsertCatalog(title, {
        catalogId: p.catalogId,
        durationMin: p.durationMin,
        window: p.window,
        recurring: p.recurring,
      });
      p.catalogId = cat.id;
    } else {
      var e = data.entries.find(function (x) { return x.id === ed.id; });
      if (!e) return;
      e.title = title;
      e.startMin = ed.startMin;
      e.endMin = ed.endMin;
      e.durationMin = ed.endMin - ed.startMin;
      var cat2 = upsertCatalog(title, {
        catalogId: e.catalogId,
        durationMin: e.durationMin,
        markDone: false,
      });
      e.catalogId = cat2.id;
    }
    saveData();
    closeEdit();
    renderAll();
    toast("Saved");
  }

  function closeEdit() {
    state.editing = null;
    document.getElementById("editOverlay").hidden = true;
  }

  function minFromTimelineClientX(clientX) {
    var scroll = document.getElementById("timelineScroll");
    if (!scroll) return DAY_START;
    var rect = scroll.getBoundingClientRect();
    var x = clientX - rect.left + scroll.scrollLeft;
    return clamp(xToMin(x), DAY_START, DAY_END - MIN_DURATION);
  }

  function beginBoardDrag(e, id) {
    var item = findPending(id);
    if (!item || isRunning(item)) return;
    e.preventDefault();
    state.boardDragId = id;
    var chip = e.target.closest("[data-board-id]");
    if (chip) chip.classList.add("dragging");
    scrollTimelineToMin(windowBounds(item.window).lo, true);
    renderTimeline();

    function move() {
      renderTimeline();
    }
    function up(ev) {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (chip) chip.classList.remove("dragging");
      var dropId = state.boardDragId;
      state.boardDragId = null;
      var scroll = document.getElementById("timelineScroll");
      if (dropId && scroll) {
        var rect = scroll.getBoundingClientRect();
        var inside = ev.clientX >= rect.left - 8 && ev.clientX <= rect.right + 8 &&
          ev.clientY >= rect.top - 8 && ev.clientY <= rect.bottom + 8;
        if (inside) {
          schedulePending(dropId, minFromTimelineClientX(ev.clientX), state.selectedDate);
          scrollTimelineToMin(findPending(dropId).startMin, true);
          toast("Dropped on schedule");
        }
      }
      renderAll();
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  function bindRangeDrag(root) {
    root.addEventListener("pointerdown", onPointerDown, true);
  }

  function onPointerDown(e) {
    var handleEl = e.target.closest("[data-handle]");
    var block = e.target.closest(".range-block, .tl-block");
    if (!handleEl || !block) return;

    var kind = block.getAttribute("data-kind");
    var id = block.getAttribute("data-id");
    var isEdit = block.id === "editRangeBlock";
    var handle = handleEl.getAttribute("data-handle");

    if (handle === "move") {
      // require short hold before moving so horizontal page scroll still works
      var holdTimer = setTimeout(function () {
        beginDrag(e, block, handle, kind, id, isEdit);
      }, HOLD_MS);
      var cancelHold = function () {
        clearTimeout(holdTimer);
        window.removeEventListener("pointerup", cancelHold);
        window.removeEventListener("pointercancel", cancelHold);
        window.removeEventListener("pointermove", moveWhileWaiting);
      };
      var startX = e.clientX;
      var moveWhileWaiting = function (ev) {
        if (Math.abs(ev.clientX - startX) > 8) cancelHold();
      };
      window.addEventListener("pointerup", cancelHold);
      window.addEventListener("pointercancel", cancelHold);
      window.addEventListener("pointermove", moveWhileWaiting);
      return;
    }

    beginDrag(e, block, handle, kind, id, isEdit);
  }

  function beginDrag(e, block, handle, kind, id, isEdit) {
    e.preventDefault();
    e.stopPropagation();
    var startMin;
    var endMin;
    if (isEdit && state.editing) {
      startMin = state.editing.startMin;
      endMin = state.editing.endMin;
    } else if (kind === "pending") {
      var p = findPending(id);
      if (!p) return;
      if (!isScheduledPending(p)) return;
      ensurePendingPlacement(p);
      startMin = p.startMin;
      endMin = p.endMin;
      p.scheduled = true;
    } else {
      var ent = data.entries.find(function (x) { return x.id === id; });
      if (!ent) return;
      startMin = ent.startMin;
      endMin = ent.endMin;
    }

    var scrub = block.closest(".range-scrub, .timeline-scroll") || block.parentElement;
    dragState = {
      handle: handle,
      kind: kind,
      id: id,
      isEdit: isEdit,
      startMin: startMin,
      endMin: endMin,
      originStart: startMin,
      originEnd: endMin,
      originX: e.clientX,
      pointerId: e.pointerId,
      scrub: scrub,
      block: block,
    };
    block.classList.add("dragging");
    try { block.setPointerCapture(e.pointerId); } catch (err) {}
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  }

  function onPointerMove(e) {
    if (!dragState) return;
    var dx = e.clientX - dragState.originX;
    var dMin = round5(dx / PX_PER_MIN);
    var start = dragState.originStart;
    var end = dragState.originEnd;
    var dur = end - start;

    if (dragState.handle === "move") {
      start = clamp(round5(dragState.originStart + dMin), 0, 1440 - dur);
      end = start + dur;
    } else if (dragState.handle === "start") {
      start = clamp(round5(dragState.originStart + dMin), 0, end - MIN_DURATION);
    } else if (dragState.handle === "end") {
      end = clamp(round5(dragState.originEnd + dMin), start + MIN_DURATION, 1440);
    }

    dragState.startMin = start;
    dragState.endMin = end;

    var left = minToX(start);
    var width = Math.max(28, minToX(end) - left);
    dragState.block.style.left = left + "px";
    dragState.block.style.width = width + "px";

    if (dragState.isEdit && state.editing) {
      state.editing.startMin = start;
      state.editing.endMin = end;
      state.editing.durationMin = end - start;
      document.getElementById("editRangeLabel").textContent = formatTime(start) + " – " + formatTime(end);
      document.getElementById("editDurationLabel").textContent = formatDuration(end - start);
    } else {
      var card = dragState.block.closest(".item-card, .item-range");
      var meta = card && card.querySelector(".range-meta");
      if (meta) {
        meta.innerHTML = "<span>" + escapeHtml(formatTime(start) + " – " + formatTime(end)) +
          "</span><span>" + escapeHtml(formatDuration(end - start)) + "</span>";
      }
    }
  }

  function onPointerUp() {
    if (!dragState) return;
    var ds = dragState;
    ds.block.classList.remove("dragging");
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);

    if (ds.isEdit && state.editing) {
      state.editing.startMin = ds.startMin;
      state.editing.endMin = ds.endMin;
      state.editing.durationMin = ds.endMin - ds.startMin;
      // sync duration chip if exact match
      renderEditChips();
    } else if (ds.kind && ds.id) {
      updateItemRange(ds.kind, ds.id, ds.startMin, ds.endMin);
      renderAll();
    }
    dragState = null;
  }

  function downloadBlob(blob, filename) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 500);
  }

  function exportJson() {
    var payload = {
      format: EXPORT_FORMAT,
      version: 1,
      exportedAt: new Date().toISOString(),
      data: normalizeData(data),
    };
    downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), "done-today-backup.json");
    toast("Exported");
  }

  function importJsonFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = JSON.parse(reader.result);
        var slice = parsed;
        if (typeof AppsBackup !== "undefined" && AppsBackup.isUnifiedBackup(parsed)) {
          slice = AppsBackup.getAppSlice(parsed, APP_ID);
          if (!slice) {
            toast("No Done Today data in that backup");
            return;
          }
        } else if (parsed && parsed.format === EXPORT_FORMAT && parsed.data) {
          slice = parsed.data;
        } else if (parsed && parsed.format === "cursor-apps-backup") {
          toast("No Done Today data in that backup");
          return;
        }
        var incoming = normalizeData(slice);
        data = mergeData(data, incoming);
        saveData();
        renderAll();
        toast("Imported");
      } catch (err) {
        toast("Import failed");
      }
    };
    reader.readAsText(file);
  }

  function mergeData(existing, incoming) {
    var out = normalizeData(existing);
    var catIds = {};
    var catKeys = {};
    out.catalog.forEach(function (c) {
      catIds[c.id] = true;
      catKeys[titleKey(c.title)] = c;
    });
    (incoming.catalog || []).forEach(function (c) {
      var key = titleKey(c.title);
      if (catKeys[key]) {
        var cur = catKeys[key];
        if ((c.doneCount || 0) > (cur.doneCount || 0)) cur.doneCount = c.doneCount;
        if (c.lastDoneDate && (!cur.lastDoneDate || c.lastDoneDate > cur.lastDoneDate)) {
          cur.lastDoneDate = c.lastDoneDate;
          cur.lastDoneAt = c.lastDoneAt;
        }
        return;
      }
      if (catIds[c.id]) c.id = uid("task");
      out.catalog.push(c);
      catIds[c.id] = true;
      catKeys[key] = c;
    });
    var pendingIds = {};
    out.pending.forEach(function (p) { pendingIds[p.id] = true; });
    (incoming.pending || []).forEach(function (p) {
      if (pendingIds[p.id]) return;
      out.pending.push(p);
      pendingIds[p.id] = true;
    });
    var entryIds = {};
    out.entries.forEach(function (e) { entryIds[e.id] = true; });
    (incoming.entries || []).forEach(function (e) {
      if (entryIds[e.id]) return;
      out.entries.push(e);
      entryIds[e.id] = true;
    });
    return normalizeData(out);
  }

  function onInputChange() {
    var raw = document.getElementById("addInput").value;
    renderSuggestions();
    if (!normalizeTitle(raw)) {
      updateSuggestHint();
      return;
    }
    var parsed = parseNaturalInput(raw);
    if (parsed.durationId) state.durationId = parsed.durationId;
    if (parsed.windowId) state.windowId = parsed.windowId;
    if (parsed.recurring) document.getElementById("recurringDaily").checked = true;
    setChipSelection(document.getElementById("durationChips"), "data-duration", state.durationId);
    setChipSelection(document.getElementById("windowChips"), "data-window", state.windowId);
    updateSuggestHint();
  }

  function wire() {
    document.getElementById("addForm").addEventListener("submit", addFromForm);
    document.getElementById("addInput").addEventListener("input", onInputChange);

    document.getElementById("durationChips").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-duration]");
      if (!btn) return;
      state.durationId = btn.getAttribute("data-duration");
      setChipSelection(document.getElementById("durationChips"), "data-duration", state.durationId);
      updateSuggestHint();
    });
    document.getElementById("windowChips").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-window]");
      if (!btn) return;
      state.windowId = btn.getAttribute("data-window");
      setChipSelection(document.getElementById("windowChips"), "data-window", state.windowId);
      updateSuggestHint();
    });
    document.getElementById("modePending").addEventListener("click", function () {
      state.addMode = "pending";
      renderAll();
    });
    document.getElementById("modeStart").addEventListener("click", function () {
      state.addMode = "start";
      renderAll();
    });
    document.getElementById("modeDone").addEventListener("click", function () {
      state.addMode = "done";
      renderAll();
    });
    document.getElementById("recurringDaily").addEventListener("change", updateSuggestHint);

    document.getElementById("suggestList").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-catalog-id]");
      if (!btn) return;
      var cat = data.catalog.find(function (c) { return c.id === btn.getAttribute("data-catalog-id"); });
      if (!cat) return;
      applyParsedToForm({
        title: cat.title,
        durationMin: cat.defaultDurationMin,
        durationId: durationIdFromMin(cat.defaultDurationMin),
        window: cat.defaultWindow,
        windowId: windowIdFromWindow(cat.defaultWindow),
        recurring: cat.recurring,
      }, cat);
    });

    document.getElementById("prevDayBtn").addEventListener("click", function () {
      state.selectedDate = addDays(state.selectedDate, -1);
      var scroll = document.getElementById("timelineScroll");
      if (scroll) delete scroll.dataset.scrolled;
      renderAll();
    });
    document.getElementById("nextDayBtn").addEventListener("click", function () {
      state.selectedDate = addDays(state.selectedDate, 1);
      var scroll = document.getElementById("timelineScroll");
      if (scroll) delete scroll.dataset.scrolled;
      renderAll();
    });
    document.getElementById("datePill").addEventListener("click", function () {
      state.selectedDate = todayKey();
      var scroll = document.getElementById("timelineScroll");
      if (scroll) delete scroll.dataset.scrolled;
      renderAll();
    });

    Array.prototype.forEach.call(document.querySelectorAll(".nav-btn"), function (btn) {
      btn.addEventListener("click", function () {
        switchView(btn.getAttribute("data-view"));
      });
    });

    function handlePendingCardAction(e) {
      var btn = e.target.closest("[data-action]");
      var card = e.target.closest(".item-card, .board-chip");
      if (!btn || !card) return;
      var id = card.getAttribute("data-id") || card.getAttribute("data-board-id");
      var item = findPending(id);
      if (!item) return;
      var action = btn.getAttribute("data-action");
      if (action === "start") {
        startTimer(id);
      } else if (action === "schedule") {
        var place = suggestedPlacement(item.durationMin || MIN_DURATION, item.window, state.selectedDate);
        schedulePending(id, place.startMin, state.selectedDate);
        scrollTimelineToMin(place.startMin, true);
        toast("Placed in " + windowLabel(item.window));
        renderAll();
      } else if (action === "update") {
        openUpdateSheet(id);
      } else if (action === "complete") {
        var opts = {
          pendingId: item.id,
          title: item.title,
          catalogId: item.catalogId,
          durationMin: item.durationMin || MIN_DURATION,
          window: item.window,
          date: state.selectedDate,
        };
        if (isScheduledPending(item)) {
          opts.startMin = item.startMin;
          opts.endMin = item.endMin;
        }
        completeTask(opts);
        toast(item.timerStartedAt ? "Closed out — logged" : "Nice — logged");
        renderAll();
      } else if (action === "edit") {
        openEdit("pending", id);
      }
    }

    document.getElementById("pendingList").addEventListener("click", handlePendingCardAction);
    document.getElementById("pendingList").addEventListener("pointerdown", function (e) {
      if (e.target.closest("button")) return;
      var chip = e.target.closest("[data-board-id]");
      if (!chip) return;
      beginBoardDrag(e, chip.getAttribute("data-board-id"));
    });
    document.getElementById("activeList").addEventListener("click", handlePendingCardAction);

    document.getElementById("updateSuggestChips").addEventListener("click", function (e) {
      var tip = e.target.closest("[data-update-tip]");
      if (!tip) return;
      document.getElementById("updateInput").value = tip.getAttribute("data-update-tip");
      document.getElementById("updateInput").focus();
    });
    document.getElementById("updateSaveBtn").addEventListener("click", function () {
      saveUpdate(document.getElementById("updateInput").value);
    });
    document.getElementById("updateInput").addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        saveUpdate(document.getElementById("updateInput").value);
      }
    });
    document.getElementById("updateCloseBtn").addEventListener("click", closeUpdateSheet);
    document.getElementById("updateOverlay").addEventListener("click", function (e) {
      if (e.target.id === "updateOverlay") closeUpdateSheet();
    });

    document.getElementById("startModeNow").addEventListener("click", function () {
      setStartSheetMode("now");
    });
    document.getElementById("startModeEarlier").addEventListener("click", function () {
      setStartSheetMode("earlier");
    });
    document.getElementById("startTimeStarted").addEventListener("input", updateStartSheetPreview);
    document.getElementById("startTimeEnded").addEventListener("input", updateStartSheetPreview);
    document.getElementById("startConfirmBtn").addEventListener("click", confirmStartSheet);
    document.getElementById("startCloseBtn").addEventListener("click", closeStartSheet);
    document.getElementById("startOverlay").addEventListener("click", function (e) {
      if (e.target.id === "startOverlay") closeStartSheet();
    });

    document.getElementById("doneList").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-action='edit-entry']");
      var card = e.target.closest(".item-card");
      if (!btn || !card) return;
      openEdit("entry", card.getAttribute("data-id"));
    });

    document.getElementById("weekGrid").addEventListener("click", function (e) {
      var day = e.target.closest("[data-date]");
      if (!day) return;
      state.selectedDate = day.getAttribute("data-date");
      switchView("today");
    });

    document.getElementById("catalogList").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-action='reuse']");
      if (!btn) return;
      var cat = data.catalog.find(function (c) { return c.id === btn.getAttribute("data-id"); });
      if (!cat) return;
      switchView("today");
      applyParsedToForm({
        title: cat.title,
        durationMin: cat.defaultDurationMin,
        durationId: durationIdFromMin(cat.defaultDurationMin),
        window: cat.defaultWindow,
        windowId: windowIdFromWindow(cat.defaultWindow),
        recurring: cat.recurring,
      }, cat);
      document.getElementById("addInput").focus();
    });

    document.getElementById("historySearch").addEventListener("input", function (e) {
      state.historyQuery = e.target.value;
      renderHistory();
    });

    document.getElementById("settingsBtn").addEventListener("click", function () {
      document.getElementById("settingsOverlay").hidden = false;
    });
    document.getElementById("settingsCloseBtn").addEventListener("click", function () {
      document.getElementById("settingsOverlay").hidden = true;
    });
    document.getElementById("settingsOverlay").addEventListener("click", function (e) {
      if (e.target.id === "settingsOverlay") document.getElementById("settingsOverlay").hidden = true;
    });
    document.getElementById("exportJsonBtn").addEventListener("click", exportJson);
    document.getElementById("importJsonFile").addEventListener("change", function (e) {
      importJsonFile(e.target.files && e.target.files[0]);
      e.target.value = "";
    });

    document.getElementById("editCloseBtn").addEventListener("click", closeEdit);
    document.getElementById("editOverlay").addEventListener("click", function (e) {
      if (e.target.id === "editOverlay") closeEdit();
    });
    document.getElementById("editSaveBtn").addEventListener("click", saveEdit);
    document.getElementById("editDeleteBtn").addEventListener("click", function () {
      var ed = state.editing;
      if (!ed) return;
      if (ed.kind === "pending") {
        data.pending = data.pending.filter(function (p) { return p.id !== ed.id; });
      } else {
        data.entries = data.entries.filter(function (x) { return x.id !== ed.id; });
      }
      saveData();
      closeEdit();
      renderAll();
      toast("Deleted");
    });
    document.getElementById("editDoneBtn").addEventListener("click", function () {
      var ed = state.editing;
      if (!ed || ed.kind !== "pending") return;
      var p = findPending(ed.id);
      if (!p) return;
      p.title = normalizeTitle(document.getElementById("editName").value) || p.title;
      p.startMin = ed.startMin;
      p.endMin = ed.endMin;
      p.durationMin = ed.durationMin;
      completeTask({
        pendingId: p.id,
        title: p.title,
        catalogId: p.catalogId,
        durationMin: p.durationMin || MIN_DURATION,
        window: p.window,
        startMin: p.startMin,
        endMin: p.endMin,
        date: state.selectedDate,
      });
      closeEdit();
      renderAll();
      toast("Logged as done");
    });
    document.getElementById("editDurationChips").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-duration]");
      if (!btn || !state.editing) return;
      var minutes = durationFromId(btn.getAttribute("data-duration"));
      state.editing.durationMin = minutes;
      if (minutes === 0) {
        state.editing.endMin = state.editing.startMin + MIN_DURATION;
      } else {
        state.editing.endMin = state.editing.startMin + minutes;
      }
      renderEditChips();
      renderEditRange();
    });
    document.getElementById("editWindowChips").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-window]");
      if (!btn || !state.editing) return;
      state.editing.window = windowFromId(btn.getAttribute("data-window"));
      var place = suggestedPlacement(state.editing.durationMin || MIN_DURATION, state.editing.window, state.selectedDate);
      state.editing.startMin = place.startMin;
      state.editing.endMin = place.endMin;
      renderEditChips();
      renderEditRange();
    });

    bindRangeDrag(document.getElementById("viewToday"));
    bindRangeDrag(document.getElementById("editOverlay"));

    window.addEventListener("scroll", function () {
      document.getElementById("appHeader").classList.toggle("scrolled", window.scrollY > 4);
    }, { passive: true });
  }

  // Seed a couple of examples on first launch so the UI isn’t empty.
  function maybeSeed() {
    if (data.catalog.length || data.pending.length || data.entries.length) return;
    var laundry = upsertCatalog("Laundry", {
      durationMin: 90,
      window: windowFromId("anytime"),
    });
    var grocery = upsertCatalog("Go to grocery store", {
      durationMin: 45,
      window: windowFromId("between13_16"),
    });
    var walk = upsertCatalog("Night walk brownie", {
      durationMin: 30,
      window: windowFromId("after20"),
      recurring: { freq: "daily" },
    });
    data.pending.push({
      id: uid("todo"),
      catalogId: grocery.id,
      title: grocery.title,
      durationMin: 45,
      window: grocery.defaultWindow,
      scheduled: false,
      startMin: null,
      endMin: null,
      recurring: null,
      date: todayKey(),
      createdAt: new Date().toISOString(),
      timerStartedAt: null,
      updates: [],
    });
    data.pending.push({
      id: uid("todo"),
      catalogId: walk.id,
      title: walk.title,
      durationMin: 30,
      window: walk.defaultWindow,
      scheduled: false,
      startMin: null,
      endMin: null,
      recurring: { freq: "daily" },
      date: todayKey(),
      createdAt: new Date().toISOString(),
      timerStartedAt: null,
      updates: [],
    });
    data.pending.push({
      id: uid("todo"),
      catalogId: laundry.id,
      title: laundry.title,
      durationMin: 90,
      window: laundry.defaultWindow,
      scheduled: false,
      startMin: null,
      endMin: null,
      recurring: null,
      date: todayKey(),
      createdAt: new Date().toISOString(),
      timerStartedAt: null,
      updates: [],
    });
    saveData();
  }

  maybeSeed();
  wire();
  switchView("today");
})();
