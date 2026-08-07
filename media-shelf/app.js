(function () {
  "use strict";

  var STORAGE_KEY = "media-shelf-v1";
  var LAST_OPEN_KEY = "media-shelf-last-open";
  var GATE_MS = 60 * 60 * 1000;
  var DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var DAY_LABELS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var SHELF_ORDER = ["up-next", "alone", "active", "shelved", "done"];
  var SHELF_LABELS = {
    "up-next": "Up next",
    alone: "Alone",
    active: "Active",
    shelved: "Shelved",
    done: "Done",
  };
  var HOME_WINDOW_DAYS = 5;

  var state = {
    version: 3,
    shows: [],
    books: [],
    reminders: [],
    subscriptions: [],
  };

  var ui = {
    view: "home",
    homeFilter: "all",
    editingShowId: null,
    editingBookId: null,
    editingReminderId: null,
    editingSubscriptionId: null,
    quickLogKind: null,
    quickLogId: null,
    quickLogShelf: "active",
    quickAddKind: null,
    quickAddShelf: "active",
    showType: "binge",
    bookType: "book",
    subscriptionKind: "streaming",
    selectedDays: [],
    calendarMonth: null,
    selectedDate: null,
    gateVisible: false,
  };

  var toastTimer = null;

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function showToast(msg) {
    var el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.remove("show");
    }, 2800);
  }

  function defaultData() {
    return { version: 3, shows: [], books: [], reminders: [], subscriptions: [] };
  }

  function inferShelfFromLegacy(status, kind) {
    if (status === "completed") return "done";
    if (status === "paused" || status === "planning") return "shelved";
    return "active";
  }

  function normalizeShelf(raw, status, kind) {
    var allowed = ["active", "up-next", "alone", "shelved", "done"];
    if (raw && allowed.indexOf(raw) >= 0) return raw;
    return inferShelfFromLegacy(status, kind);
  }

  function statusFromShelf(shelf, kind) {
    if (shelf === "done") return kind === "show" ? "completed" : "completed";
    if (shelf === "shelved") return kind === "show" ? "paused" : "paused";
    return kind === "show" ? "watching" : "reading";
  }

  function normalizeShow(raw) {
    if (!raw || !raw.title) return null;
    var schedule = Array.isArray(raw.schedule)
      ? raw.schedule
          .map(function (s) {
            if (!s || typeof s.day !== "number") return null;
            var parts = String(s.time || "20:00").split(":");
            return {
              day: Math.max(0, Math.min(6, s.day)),
              hour: parseInt(parts[0], 10) || 20,
              minute: parseInt(parts[1], 10) || 0,
            };
          })
          .filter(Boolean)
      : [];
    var status = ["watching", "paused", "completed", "planning"].indexOf(raw.status) >= 0 ? raw.status : "watching";
    var shelf = normalizeShelf(raw.shelf, status, "show");
    status = statusFromShelf(shelf, "show");
    return {
      id: raw.id || uid(),
      title: String(raw.title).trim(),
      type: raw.type === "airing" ? "airing" : "binge",
      season: Math.max(1, parseInt(raw.season, 10) || 1),
      episode: Math.max(0, parseInt(raw.episode, 10) || 0),
      totalEpisodes: raw.totalEpisodes != null && raw.totalEpisodes !== "" ? Math.max(0, parseInt(raw.totalEpisodes, 10)) : null,
      totalSeasons: raw.totalSeasons != null && raw.totalSeasons !== "" ? Math.max(0, parseInt(raw.totalSeasons, 10)) : null,
      lastWatchedAt: raw.lastWatchedAt || null,
      watchingSeason: (function () {
        var ep = parseInt(raw.watchingEpisode, 10);
        if (!ep || ep <= 0) return null;
        return Math.max(1, parseInt(raw.watchingSeason, 10) || parseInt(raw.season, 10) || 1);
      })(),
      watchingEpisode: (function () {
        var ep = parseInt(raw.watchingEpisode, 10);
        return ep > 0 ? ep : null;
      })(),
      status: status,
      shelf: shelf,
      schedule: schedule,
      subscriptionId: raw.subscriptionId || null,
      notes: raw.notes ? String(raw.notes) : "",
      lastComment: raw.lastComment ? String(raw.lastComment) : "",
      createdAt: raw.createdAt || new Date().toISOString(),
      updatedAt: raw.updatedAt || new Date().toISOString(),
    };
  }

  function normalizeSubscription(raw) {
    if (!raw || !raw.name) return null;
    var cost = raw.cost;
    if (cost != null && cost !== "") cost = parseFloat(cost);
    else cost = null;
    return {
      id: raw.id || uid(),
      name: String(raw.name).trim(),
      kind: raw.kind === "channel" ? "channel" : "streaming",
      active: raw.active !== false,
      cost: cost != null && !isNaN(cost) ? cost : null,
      notes: raw.notes ? String(raw.notes) : "",
      createdAt: raw.createdAt || new Date().toISOString(),
      updatedAt: raw.updatedAt || new Date().toISOString(),
    };
  }

  function normalizeBook(raw) {
    if (!raw || !raw.title) return null;
    var status = ["reading", "paused", "completed", "planning"].indexOf(raw.status) >= 0 ? raw.status : "reading";
    var shelf = normalizeShelf(raw.shelf, status, "book");
    status = statusFromShelf(shelf, "book");
    return {
      id: raw.id || uid(),
      title: String(raw.title).trim(),
      author: raw.author ? String(raw.author).trim() : "",
      type: ["book", "manga", "comic"].indexOf(raw.type) >= 0 ? raw.type : "book",
      chapter: Math.max(0, parseInt(raw.chapter, 10) || 0),
      page: Math.max(0, parseInt(raw.page, 10) || 0),
      totalChapters: raw.totalChapters != null && raw.totalChapters !== "" ? Math.max(0, parseInt(raw.totalChapters, 10)) : null,
      totalPages: raw.totalPages != null && raw.totalPages !== "" ? Math.max(0, parseInt(raw.totalPages, 10)) : null,
      lastReadAt: raw.lastReadAt || null,
      status: status,
      shelf: shelf,
      notes: raw.notes ? String(raw.notes) : "",
      lastComment: raw.lastComment ? String(raw.lastComment) : "",
      createdAt: raw.createdAt || new Date().toISOString(),
      updatedAt: raw.updatedAt || new Date().toISOString(),
    };
  }

  function normalizeReminder(raw) {
    if (!raw || !raw.title) return null;
    return {
      id: raw.id || uid(),
      title: String(raw.title).trim(),
      at: raw.at || raw.datetime || null,
      showId: raw.showId || raw.linkedShowId || null,
      bookId: raw.bookId || raw.linkedBookId || null,
      notes: raw.notes ? String(raw.notes) : "",
      enabled: raw.enabled !== false,
      createdAt: raw.createdAt || new Date().toISOString(),
    };
  }

  function normalizeData(raw) {
    if (!raw || typeof raw !== "object") return defaultData();
    return {
      version: 3,
      shows: (raw.shows || []).map(normalizeShow).filter(Boolean),
      books: (raw.books || []).map(normalizeBook).filter(Boolean),
      reminders: (raw.reminders || []).map(normalizeReminder).filter(Boolean),
      subscriptions: (raw.subscriptions || []).map(normalizeSubscription).filter(Boolean),
    };
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        state = defaultData();
        return;
      }
      state = normalizeData(JSON.parse(raw));
    } catch (e) {
      state = defaultData();
    }
  }

  function save() {
    state.version = 3;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    render();
  }

  function touchLastOpen() {
    try {
      localStorage.setItem(LAST_OPEN_KEY, String(Date.now()));
    } catch (e) {}
  }

  function shouldShowGate() {
    try {
      var last = parseInt(localStorage.getItem(LAST_OPEN_KEY), 10);
      if (!last || isNaN(last)) return true;
      return Date.now() - last >= GATE_MS;
    } catch (e) {
      return true;
    }
  }

  function getShow(id) {
    return state.shows.find(function (s) { return s.id === id; }) || null;
  }

  function getBook(id) {
    return state.books.find(function (b) { return b.id === id; }) || null;
  }

  function getSubscription(id) {
    return state.subscriptions.find(function (s) { return s.id === id; }) || null;
  }

  function dateStr(d) {
    var pad = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function todayStr() {
    return dateStr(new Date());
  }

  function formatTime12(hour, minute) {
    var h = hour % 12 || 12;
    var m = (minute < 10 ? "0" : "") + minute;
    var ampm = hour < 12 ? "AM" : "PM";
    return h + ":" + m + " " + ampm;
  }

  function parseDate(iso) {
    if (!iso) return null;
    var d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
  }

  function toDatetimeLocalValue(date) {
    var d = date instanceof Date ? date : new Date(date);
    var pad = function (n) { return (n < 10 ? "0" : "") + n; };
    return (
      d.getFullYear() +
      "-" + pad(d.getMonth() + 1) +
      "-" + pad(d.getDate()) +
      "T" + pad(d.getHours()) +
      ":" + pad(d.getMinutes())
    );
  }

  function fromDatetimeLocalValue(val) {
    if (!val) return null;
    var d = new Date(val);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  function formatRelative(dateIso) {
    var d = parseDate(dateIso);
    if (!d) return "Never";
    var now = new Date();
    var diffMs = now - d;
    var diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return diffMins + " min ago";
    var diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return diffHours + " hr ago";
    var diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return diffDays + " days ago";
    if (diffDays < 30) return Math.floor(diffDays / 7) + " wk ago";
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
    });
  }

  function formatDateTime(dateIso) {
    var d = parseDate(dateIso);
    if (!d) return "";
    return d.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function isSameDay(a, b) {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function addDays(d, n) {
    var out = new Date(d);
    out.setDate(out.getDate() + n);
    return out;
  }

  function getNextAirDate(show, fromDate) {
    if (!show || show.type !== "airing" || !show.schedule.length) return null;
    var from = fromDate ? new Date(fromDate) : new Date();
    var best = null;
    for (var offset = 0; offset < 21; offset++) {
      var day = addDays(startOfDay(from), offset);
      var dow = day.getDay();
      show.schedule.forEach(function (slot) {
        if (slot.day !== dow) return;
        var candidate = new Date(day);
        candidate.setHours(slot.hour, slot.minute, 0, 0);
        if (candidate <= from) return;
        if (!best || candidate < best) best = candidate;
      });
    }
    return best;
  }

  function getPreviousAirDate(show, beforeDate) {
    if (!show || show.type !== "airing" || !show.schedule.length) return null;
    var before = beforeDate ? new Date(beforeDate) : new Date();
    var best = null;
    for (var offset = 0; offset <= 28; offset++) {
      var day = addDays(startOfDay(before), -offset);
      var dow = day.getDay();
      show.schedule.forEach(function (slot) {
        if (slot.day !== dow) return;
        var candidate = new Date(day);
        candidate.setHours(slot.hour, slot.minute, 0, 0);
        if (candidate > before) return;
        if (!best || candidate > best) best = candidate;
      });
    }
    return best;
  }

  function getLatestDueAirDate(show, asOf) {
    return getPreviousAirDate(show, asOf || new Date());
  }

  function isCaughtUp(show, asOf) {
    if (!show || show.type !== "airing" || !show.schedule.length) return true;
    var due = getLatestDueAirDate(show, asOf || new Date());
    if (!due) return true;
    if (!show.lastWatchedAt) {
      if (show.createdAt && due < new Date(show.createdAt)) return true;
      return false;
    }
    return new Date(show.lastWatchedAt) >= due;
  }

  function getAirDatesInRange(show, start, end) {
    if (!show || show.type !== "airing" || !show.schedule.length) return [];
    var results = [];
    var cursor = startOfDay(start);
    var endDay = startOfDay(end);
    while (cursor <= endDay) {
      var dow = cursor.getDay();
      show.schedule.forEach(function (slot) {
        if (slot.day !== dow) return;
        var candidate = new Date(cursor);
        candidate.setHours(slot.hour, slot.minute, 0, 0);
        if (candidate >= start && candidate <= end) results.push(new Date(candidate));
      });
      cursor = addDays(cursor, 1);
    }
    return results.sort(function (a, b) { return a - b; });
  }

  function formatSchedule(show) {
    if (!show.schedule || !show.schedule.length) return "No schedule set";
    var days = show.schedule
      .slice()
      .sort(function (a, b) { return a.day - b.day; })
      .map(function (s) { return DAY_LABELS_LONG[s.day]; });
    var uniqueDays = [];
    days.forEach(function (d) {
      if (uniqueDays.indexOf(d) < 0) uniqueDays.push(d);
    });
    var time = show.schedule[0];
    var timeStr = formatTime12(time.hour, time.minute);
    var allSameTime = show.schedule.every(function (s) {
      return s.hour === time.hour && s.minute === time.minute;
    });
    if (uniqueDays.length === 1) return uniqueDays[0] + "s · " + timeStr;
    if (allSameTime) return uniqueDays.join(" & ") + " · " + timeStr;
    return uniqueDays.join(", ") + " · varied times";
  }

  function epShort(season, episode) {
    return "S" + season + " E" + episode;
  }

  function isWatchingEpisode(show) {
    return !!(show && show.watchingEpisode > 0);
  }

  function getNextEpisode(show) {
    if (!show) return { season: 1, episode: 1 };
    if (isWatchingEpisode(show)) {
      return { season: show.watchingSeason, episode: show.watchingEpisode };
    }
    if (show.episode === 0) return { season: show.season || 1, episode: 1 };
    return { season: show.season, episode: show.episode + 1 };
  }

  function progressLabel(show, compact) {
    if (!show) return "";
    if (isWatchingEpisode(show)) {
      var watchingText = epShort(show.watchingSeason, show.watchingEpisode);
      if (compact && show.watchingSeason === show.season) watchingText = "E" + show.watchingEpisode;
      return "▶ " + watchingText;
    }
    var next = getNextEpisode(show);
    if (show.episode === 0) {
      var startText = epShort(next.season, next.episode);
      if (compact && next.season === (show.season || 1)) startText = "E" + next.episode;
      return "→ " + startText;
    }
    if (compact) {
      var nextText = epShort(next.season, next.episode);
      if (next.season === show.season) nextText = "E" + next.episode;
      return "→ " + nextText;
    }
    return epShort(show.season, show.episode) + " → " + epShort(next.season, next.episode);
  }

  function bookProgressLabel(book) {
    if (!book) return "";
    var parts = [];
    if (book.chapter > 0) parts.push("Ch. " + book.chapter);
    if (book.page > 0) parts.push("p. " + book.page);
    if (!parts.length) return "Not started";
    return parts.join(" · ");
  }

  function formatOverdueLabel(dateIso) {
    var d = parseDate(dateIso);
    if (!d) return "Overdue";
    var now = new Date();
    var diffDays = Math.floor((startOfDay(now) - startOfDay(d)) / 86400000);
    if (diffDays <= 0) return "Due today";
    if (diffDays === 1) return "1 day late";
    return diffDays + " days late";
  }

  function formatDaysSince(dateIso) {
    var d = parseDate(dateIso);
    if (!d) return "Never";
    var now = new Date();
    var diffDays = Math.floor((startOfDay(now) - startOfDay(d)) / 86400000);
    if (diffDays <= 0) return "Today";
    if (diffDays === 1) return "1d ago";
    if (diffDays < 7) return diffDays + "d ago";
    if (diffDays < 30) return Math.floor(diffDays / 7) + "w ago";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function getShowOverdueDays(show, asOf) {
    if (!show || show.type !== "airing" || !show.schedule.length) return 0;
    if (show.shelf === "shelved" || show.shelf === "done") return 0;
    if (isCaughtUp(show, asOf)) return 0;
    var missed = getLatestDueAirDate(show, asOf);
    if (!missed) return 0;
    return Math.floor((startOfDay(asOf || new Date()) - startOfDay(missed)) / 86400000);
  }

  function itemActivityAt(item) {
    if (item.kind === "show") {
      return item.lastWatchedAt || item.updatedAt || item.createdAt || "";
    }
    return item.lastReadAt || item.updatedAt || item.createdAt || "";
  }

  function toUnifiedItem(showOrBook, kind) {
    if (kind === "show") {
      return {
        kind: "show",
        mediaType: "show",
        id: showOrBook.id,
        title: showOrBook.title,
        shelf: showOrBook.shelf || "active",
        progress: progressLabel(showOrBook, true),
        meta: formatDaysSince(showOrBook.lastWatchedAt),
        comment: showOrBook.lastComment || "",
        activityAt: itemActivityAt(showOrBook),
        overdue: getShowOverdueDays(showOrBook, new Date()) > 0,
        inProgress: isWatchingEpisode(showOrBook),
        raw: showOrBook,
      };
    }
    return {
      kind: "book",
      mediaType: showOrBook.type,
      id: showOrBook.id,
      title: showOrBook.title,
      shelf: showOrBook.shelf || "active",
      progress: bookProgressLabel(showOrBook),
      meta: formatDaysSince(showOrBook.lastReadAt),
      comment: showOrBook.lastComment || "",
      activityAt: itemActivityAt(showOrBook),
      overdue: false,
      inProgress: false,
      raw: showOrBook,
    };
  }

  function allUnifiedItems() {
    var items = [];
    state.shows.forEach(function (s) {
      items.push(toUnifiedItem(s, "show"));
    });
    state.books.forEach(function (b) {
      items.push(toUnifiedItem(b, "book"));
    });
    return items;
  }

  function filterUnified(items) {
    var f = ui.homeFilter;
    return items.filter(function (item) {
      if (f === "all") return item.shelf !== "shelved" && item.shelf !== "done";
      if (f === "show") return item.mediaType === "show" && item.shelf !== "done";
      if (f === "book") return item.mediaType === "book" && item.shelf !== "done";
      if (f === "manga") return (item.mediaType === "manga" || item.mediaType === "comic") && item.shelf !== "done";
      if (f === "shelved") return item.shelf === "shelved";
      if (f === "done") return item.shelf === "done";
      return true;
    });
  }

  function sortByActivity(a, b) {
    return new Date(b.activityAt || 0) - new Date(a.activityAt || 0);
  }

  function getRecentForGate() {
    return allUnifiedItems()
      .filter(function (item) {
        return item.shelf !== "done" && item.shelf !== "shelved";
      })
      .sort(sortByActivity)
      .slice(0, 9);
  }

  function buildEpisodeReminderItem(show, atDate, overdue) {
    return {
      id: "air-" + show.id + "-" + atDate.getTime(),
      kind: "episode",
      title: show.title,
      subtitle: overdue ? "Missed episode · " + formatSchedule(show) : "New episode · " + formatSchedule(show),
      at: atDate.toISOString(),
      showId: show.id,
      auto: true,
      overdue: !!overdue,
    };
  }

  function collectReminders() {
    var items = [];
    var now = new Date();
    var homeWindowEnd = addDays(startOfDay(now), HOME_WINDOW_DAYS + 1);

    state.shows.forEach(function (show) {
      if (show.shelf === "done" || show.shelf === "shelved") return;
      if (show.type !== "airing" || !show.schedule.length) return;
      if (!isCaughtUp(show, now)) {
        var missed = getLatestDueAirDate(show, now);
        if (missed) items.push(buildEpisodeReminderItem(show, missed, true));
      } else {
        var next = getNextAirDate(show, now);
        if (next) items.push(buildEpisodeReminderItem(show, next, false));
      }
    });

    state.reminders.forEach(function (r) {
      if (!r.enabled || !r.at) return;
      var show = r.showId ? getShow(r.showId) : null;
      var d = parseDate(r.at);
      var overdue = d && d < now && !isSameDay(d, now);
      items.push({
        id: r.id,
        kind: "custom",
        title: r.title,
        subtitle: r.notes || (show ? "Linked to " + show.title : ""),
        at: r.at,
        showId: r.showId,
        auto: false,
        overdue: !!overdue,
      });
    });

    items.sort(function (a, b) {
      return new Date(a.at) - new Date(b.at);
    });

    var overdue = [];
    var byDate = {};

    items.forEach(function (item) {
      var d = parseDate(item.at);
      if (!d) return;
      var key = dateStr(d);
      if (!byDate[key]) byDate[key] = [];
      byDate[key].push(item);
      if (item.overdue) overdue.push(item);
    });

    return {
      all: items,
      overdue: overdue,
      badgeCount: overdue.length + items.filter(function (item) {
        if (item.overdue) return false;
        var d = parseDate(item.at);
        return d && isSameDay(d, now);
      }).length,
      byDate: byDate,
      homeWindowEnd: homeWindowEnd,
    };
  }

  function collectCalendarItems(rangeStart, rangeEnd) {
    var items = [];

    state.shows.forEach(function (show) {
      if (show.type !== "airing" || show.shelf === "done" || !show.schedule.length) return;
      getAirDatesInRange(show, rangeStart, rangeEnd).forEach(function (d) {
        items.push(buildEpisodeReminderItem(show, d, false));
      });
    });

    state.reminders.forEach(function (r) {
      if (!r.enabled || !r.at) return;
      var d = parseDate(r.at);
      if (!d || d < rangeStart || d > rangeEnd) return;
      var show = r.showId ? getShow(r.showId) : null;
      var now = new Date();
      items.push({
        id: r.id,
        kind: "custom",
        title: r.title,
        subtitle: r.notes || (show ? "Linked to " + show.title : ""),
        at: r.at,
        showId: r.showId,
        auto: false,
        overdue: d < now && !isSameDay(d, now),
      });
    });

    items.sort(function (a, b) {
      return new Date(a.at) - new Date(b.at);
    });

    var byDate = {};
    items.forEach(function (item) {
      var d = parseDate(item.at);
      if (!d) return;
      var key = dateStr(d);
      if (!byDate[key]) byDate[key] = [];
      byDate[key].push(item);
    });

    return { all: items, byDate: byDate };
  }

  function mediaTypeLabel(type) {
    if (type === "show") return "Show";
    if (type === "manga") return "Manga";
    if (type === "comic") return "Comic";
    return "Book";
  }

  function renderMediaRow(item) {
    var typeClass = "type-" + item.mediaType;
    var rowClass = "media-row " + typeClass;
    if (item.overdue) rowClass += " overdue";
    if (item.inProgress) rowClass += " in-progress";
    var metaParts = [];
    metaParts.push('<span class="kind-tag">' + escapeHtml(mediaTypeLabel(item.mediaType)) + "</span>");
    if (item.overdue) metaParts.push("Behind");
    else metaParts.push(escapeHtml(item.meta));
    if (item.comment) {
      metaParts.push('<span class="comment-preview">“' + escapeHtml(item.comment.length > 40 ? item.comment.slice(0, 40) + "…" : item.comment) + '”</span>');
    }
    var dataAttr = item.kind === "show"
      ? 'data-show-id="' + escapeHtml(item.id) + '"'
      : 'data-book-id="' + escapeHtml(item.id) + '"';
    var bumpAttr = item.kind === "show"
      ? 'data-bump-show="' + escapeHtml(item.id) + '"'
      : 'data-bump-book="' + escapeHtml(item.id) + '"';

    return (
      '<div class="' + rowClass + '">' +
      '<button type="button" class="media-row-main" ' + dataAttr + ">" +
      '<span class="media-row-bar" aria-hidden="true"></span>' +
      '<span class="media-row-title">' + escapeHtml(item.title) + "</span>" +
      '<span class="media-row-prog">' + escapeHtml(item.progress) + "</span>" +
      '<span class="media-row-meta">' + metaParts.join(" · ") + "</span>" +
      "</button>" +
      '<button type="button" class="media-row-bump" ' + bumpAttr + ' aria-label="Quick bump">+</button>' +
      "</div>"
    );
  }

  function renderConsumeTile(item) {
    if (!item) {
      return '<button type="button" class="consume-tile empty" data-consume-empty="1">+</button>';
    }
    var typeClass = "type-" + item.mediaType;
    var dataAttr = item.kind === "show"
      ? 'data-show-id="' + escapeHtml(item.id) + '"'
      : 'data-book-id="' + escapeHtml(item.id) + '"';
    return (
      '<button type="button" class="consume-tile ' + typeClass + '" ' + dataAttr + ">" +
      '<span class="consume-tile-kind">' + escapeHtml(mediaTypeLabel(item.mediaType)) + "</span>" +
      '<span class="consume-tile-title">' + escapeHtml(item.title) + "</span>" +
      '<span class="consume-tile-prog">' + escapeHtml(item.progress) + "</span>" +
      "</button>"
    );
  }

  function renderSubscriptionCard(sub) {
    var badgeClass = sub.active ? "airing" : "completed";
    var badgeText = sub.active ? "Active" : "Inactive";
    var kindLabel = sub.kind === "channel" ? "Channel" : "Streaming";
    var cost = sub.cost != null ? "<span>$" + sub.cost.toFixed(2) + "/mo</span>" : "";
    var notes = sub.notes ? '<p class="sub-notes">' + escapeHtml(sub.notes) + "</p>" : "";
    return (
      '<button type="button" class="media-card sub-card" data-subscription-id="' + escapeHtml(sub.id) + '">' +
      '<div class="media-card-top"><h3>' + escapeHtml(sub.name) + '</h3><span class="badge ' + badgeClass + '">' + badgeText + "</span></div>" +
      '<div class="media-meta"><span>' + kindLabel + "</span>" + cost + "</div>" +
      notes +
      "</button>"
    );
  }

  function renderReminderCard(item, options) {
    options = options || {};
    var showQuickLog = options.showQuickLog !== false && item.kind === "episode" && item.showId;
    var d = parseDate(item.at);
    var now = new Date();
    var cls = "reminder-card";
    if (item.overdue) cls += " overdue";
    var iconClass = item.kind === "episode" ? "episode" : "custom";
    var iconSvg = item.kind === "episode"
      ? '<svg viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M10 9.5l5 3-5 3V9.5z" fill="currentColor" stroke="none"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>';
    var whenLabel = d ? formatDateTime(item.at) : "No date";
    if (item.overdue) whenLabel = formatOverdueLabel(item.at);
    else if (d && isSameDay(d, now)) whenLabel = "Today · " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

    var attrs = item.auto ? ' data-auto-reminder="1"' : ' data-reminder-id="' + escapeHtml(item.id) + '"';
    if (item.showId) attrs += ' data-show-id="' + escapeHtml(item.showId) + '"';

    var quickLogBtn = showQuickLog
      ? '<button type="button" class="reminder-quick-log" data-bump-show="' + escapeHtml(item.showId) + '" aria-label="Mark watched">+</button>'
      : "";

    return (
      '<div class="reminder-row">' +
      '<button type="button" class="' + cls + '"' + attrs + ">" +
      '<div class="reminder-icon ' + iconClass + '">' + iconSvg + "</div>" +
      '<div class="reminder-body"><h4>' + escapeHtml(item.title) + "</h4>" +
      (item.subtitle ? "<p>" + escapeHtml(item.subtitle) + "</p>" : "") +
      '<div class="reminder-when">' + escapeHtml(whenLabel) + "</div></div></button>" +
      quickLogBtn +
      "</div>"
    );
  }

  function renderHome() {
    var items = filterUnified(allUnifiedItems());
    var wrap = document.getElementById("homeSections");
    var empty = document.getElementById("homeEmpty");

    if (!items.length) {
      wrap.innerHTML = "";
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    var byShelf = {};
    SHELF_ORDER.forEach(function (s) { byShelf[s] = []; });
    items.forEach(function (item) {
      var shelf = item.shelf || "active";
      if (!byShelf[shelf]) byShelf[shelf] = [];
      byShelf[shelf].push(item);
    });

    var html = "";
    SHELF_ORDER.forEach(function (shelf) {
      var list = byShelf[shelf] || [];
      if (!list.length) return;
      if (ui.homeFilter === "all" && (shelf === "shelved" || shelf === "done")) return;
      list.sort(function (a, b) {
        if (a.inProgress !== b.inProgress) return a.inProgress ? -1 : 1;
        if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
        return sortByActivity(a, b);
      });
      html +=
        '<div class="section-head"><p class="section-label">' + escapeHtml(SHELF_LABELS[shelf] || shelf) +
        '</p><span class="section-count">' + list.length + "</span></div>" +
        '<div class="shelf-list">' + list.map(renderMediaRow).join("") + "</div>";
    });
    wrap.innerHTML = html;
  }

  function renderConsumeGate() {
    var grid = document.getElementById("consumeGrid");
    var recent = getRecentForGate();
    var tiles = [];
    for (var i = 0; i < 9; i++) {
      tiles.push(renderConsumeTile(recent[i] || null));
    }
    grid.innerHTML = tiles.join("");
  }

  function showGate(show) {
    ui.gateVisible = !!show;
    var gate = document.getElementById("consumeGate");
    gate.hidden = !show;
    document.body.classList.toggle("gate-open", !!show);
    if (show) renderConsumeGate();
  }

  function dismissGate() {
    showGate(false);
    touchLastOpen();
  }

  function render() {
    var reminders = collectReminders();
    renderHome();
    renderCalendar();

    var streaming = state.subscriptions.filter(function (s) { return s.kind === "streaming"; });
    var channels = state.subscriptions.filter(function (s) { return s.kind === "channel"; });
    document.getElementById("subsStreaming").innerHTML = streaming.map(renderSubscriptionCard).join("");
    document.getElementById("subsStreamingEmpty").hidden = streaming.length > 0;
    document.getElementById("subsChannels").innerHTML = channels.map(renderSubscriptionCard).join("");
    document.getElementById("subsChannelsEmpty").hidden = channels.length > 0;

    var badge = document.getElementById("calendarBadge");
    if (reminders.badgeCount > 0) {
      badge.hidden = false;
      badge.textContent = reminders.badgeCount > 9 ? "9+" : String(reminders.badgeCount);
    } else {
      badge.hidden = true;
    }

    updateFabVisibility();
    populateReminderShowSelect();
    populateSubscriptionSelect();
    if (ui.gateVisible) renderConsumeGate();
  }

  function renderCalendar() {
    if (!ui.calendarMonth) {
      var d = new Date();
      ui.calendarMonth = { year: d.getFullYear(), month: d.getMonth() };
    }
    if (!ui.selectedDate) ui.selectedDate = todayStr();

    var year = ui.calendarMonth.year;
    var month = ui.calendarMonth.month;
    var monthDate = new Date(year, month, 1);
    var monthLabel = document.getElementById("calMonthLabel");
    if (monthLabel) {
      monthLabel.textContent = monthDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    }

    var rangeStart = new Date(year, month, 1, 0, 0, 0, 0);
    var rangeEnd = new Date(year, month + 1, 0, 23, 59, 59, 999);
    var calData = collectCalendarItems(rangeStart, rangeEnd);

    var grid = document.getElementById("calGrid");
    if (!grid) return;

    var html = "";
    ["S", "M", "T", "W", "T", "F", "S"].forEach(function (label) {
      html += '<div class="cal-dow">' + label + "</div>";
    });

    var firstDow = monthDate.getDay();
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var prevMonthDays = new Date(year, month, 0).getDate();
    var py = month === 0 ? year - 1 : year;
    var pm = month === 0 ? 11 : month - 1;

    var i;
    for (i = firstDow - 1; i >= 0; i--) {
      var pd = prevMonthDays - i;
      var pds = dateStr(new Date(py, pm, pd));
      html += makeCalDayHtml(pds, pd, calData.byDate[pds], true);
    }
    for (var day = 1; day <= daysInMonth; day++) {
      var ds = dateStr(new Date(year, month, day));
      html += makeCalDayHtml(ds, day, calData.byDate[ds], false);
    }
    var totalCells = firstDow + daysInMonth;
    var trailing = (7 - (totalCells % 7)) % 7;
    var ny = month === 11 ? year + 1 : year;
    var nm = month === 11 ? 0 : month + 1;
    for (i = 1; i <= trailing; i++) {
      var nds = dateStr(new Date(ny, nm, i));
      html += makeCalDayHtml(nds, i, calData.byDate[nds], true);
    }
    grid.innerHTML = html;
    renderCalAgenda(calData);
  }

  function makeCalDayHtml(dateKey, dayNum, items, otherMonth) {
    var isToday = dateKey === todayStr();
    var isSelected = dateKey === ui.selectedDate;
    var cls = "cal-day";
    if (otherMonth) cls += " other-month";
    if (isToday) cls += " today";
    if (isSelected) cls += " selected";
    var dots = "";
    if (items && items.length) {
      dots = '<div class="cal-dots">';
      items.slice(0, 4).forEach(function (item) {
        var dotCls = item.overdue ? "overdue" : item.kind === "episode" ? "episode" : "custom";
        dots += '<span class="cal-dot ' + dotCls + '"></span>';
      });
      dots += "</div>";
    }
    return (
      '<button type="button" class="' + cls + '" data-cal-date="' + escapeHtml(dateKey) + '">' +
      '<span class="cal-day-num">' + dayNum + "</span>" + dots +
      "</button>"
    );
  }

  function renderCalAgenda(calData) {
    var agenda = document.getElementById("calAgenda");
    var agendaEmpty = document.getElementById("calAgendaEmpty");
    var agendaLabel = document.getElementById("calAgendaLabel");
    if (!agenda) return;

    var selected = ui.selectedDate || todayStr();
    var items = (calData && calData.byDate[selected]) || [];
    var selectedDate = parseDate(selected + "T12:00:00");
    if (agendaLabel && selectedDate) {
      agendaLabel.textContent = isSameDay(selectedDate, new Date())
        ? "Today"
        : selectedDate.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
    }

    agenda.innerHTML = items.map(function (item) {
      return renderReminderCard(item, { showQuickLog: false });
    }).join("");
    agendaEmpty.hidden = items.length > 0;
  }

  function updateFabVisibility() {
    var fab = document.getElementById("fabBtn");
    fab.style.display = ui.gateVisible ? "none" : "flex";
  }

  function setView(view) {
    ui.view = view;
    document.body.className = (ui.gateVisible ? "gate-open " : "") + "view-" + view;
    document.querySelectorAll(".view").forEach(function (el) {
      el.classList.toggle("active", el.dataset.view === view);
    });
    document.querySelectorAll(".nav-btn").forEach(function (btn) {
      var on = btn.dataset.view === view;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });

    var titles = {
      home: ["Media Shelf", "Shows, books & manga"],
      calendar: ["Calendar", "Episodes & reminders"],
      subscriptions: ["Subscriptions", "Streaming & channels"],
    };
    var t = titles[view] || titles.home;
    document.getElementById("headerTitle").textContent = t[0];
    document.getElementById("headerSubtitle").textContent = t[1];
    updateFabVisibility();
    if (view === "calendar") renderCalendar();
  }

  function openOverlay(id) {
    document.getElementById(id).classList.add("open");
    document.body.style.overflow = "hidden";
  }

  function closeOverlay(id) {
    document.getElementById(id).classList.remove("open");
    if (!document.querySelector(".overlay.open") && !ui.gateVisible) {
      document.body.style.overflow = "";
    }
  }

  function setShelfChips(containerId, shelf) {
    document.querySelectorAll("#" + containerId + " .shelf-chip").forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.shelf === shelf);
    });
  }

  function openQuickLog(kind, id) {
    ui.quickLogKind = kind;
    ui.quickLogId = id;
    var titleEl = document.getElementById("quickLogTitle");
    var metaEl = document.getElementById("quickLogMeta");
    var dot = document.getElementById("quickLogDot");
    var showFields = document.getElementById("quickLogShowFields");
    var bookFields = document.getElementById("quickLogBookFields");
    var startBtn = document.getElementById("qlStartBtn");

    if (kind === "show") {
      var show = getShow(id);
      if (!show) return;
      ui.quickLogShelf = show.shelf || "active";
      titleEl.textContent = show.title;
      var metaBits = [show.type === "airing" ? "Airing" : "Binge"];
      if (show.lastWatchedAt) metaBits.push("Last " + formatRelative(show.lastWatchedAt));
      metaEl.textContent = metaBits.join(" · ");
      dot.className = "type-dot type-show";
      showFields.hidden = false;
      bookFields.hidden = true;
      var next = getNextEpisode(show);
      document.getElementById("qlSeason").value = String(next.season);
      document.getElementById("qlEpisode").value = String(next.episode);
      document.getElementById("qlComment").value = "";
      startBtn.hidden = isWatchingEpisode(show) || show.shelf === "done";
      startBtn.textContent = "Mark in progress";
    } else {
      var book = getBook(id);
      if (!book) return;
      ui.quickLogShelf = book.shelf || "active";
      titleEl.textContent = book.title;
      var bMeta = [mediaTypeLabel(book.type)];
      if (book.author) bMeta.push(book.author);
      if (book.lastReadAt) bMeta.push(formatRelative(book.lastReadAt));
      metaEl.textContent = bMeta.join(" · ");
      dot.className = "type-dot type-" + book.type;
      showFields.hidden = true;
      bookFields.hidden = false;
      document.getElementById("qlChapter").value = String(book.chapter > 0 ? book.chapter + 1 : 1);
      document.getElementById("qlPage").value = String(book.page || 0);
      document.getElementById("qlComment").value = "";
      startBtn.hidden = true;
    }
    setShelfChips("quickLogShelf", ui.quickLogShelf);
    openOverlay("quickLogOverlay");
  }

  function applyShelfToItem(item, shelf, kind) {
    item.shelf = shelf;
    item.status = statusFromShelf(shelf, kind);
    if (shelf === "done") {
      if (kind === "show") {
        item.watchingSeason = null;
        item.watchingEpisode = null;
      }
    }
  }

  function saveQuickLog() {
    var comment = document.getElementById("qlComment").value.trim();
    var shelf = ui.quickLogShelf || "active";

    if (ui.quickLogKind === "show") {
      var show = getShow(ui.quickLogId);
      if (!show) return;
      var season = parseInt(document.getElementById("qlSeason").value, 10) || 1;
      var episode = parseInt(document.getElementById("qlEpisode").value, 10) || 0;
      if (episode < 1 && shelf !== "shelved" && shelf !== "done") {
        showToast("Enter an episode");
        return;
      }
      if (episode >= 1) {
        show.season = season;
        show.episode = episode;
        show.lastWatchedAt = new Date().toISOString();
        show.watchingSeason = null;
        show.watchingEpisode = null;
      }
      if (comment) show.lastComment = comment;
      applyShelfToItem(show, shelf, "show");
      if (show.totalEpisodes && episode >= show.totalEpisodes) {
        applyShelfToItem(show, "done", "show");
      }
      show.updatedAt = new Date().toISOString();
      closeOverlay("quickLogOverlay");
      dismissGate();
      save();
      showToast(episode >= 1 ? "Logged " + epShort(season, episode) : "Updated");
      return;
    }

    var book = getBook(ui.quickLogId);
    if (!book) return;
    var chapter = parseInt(document.getElementById("qlChapter").value, 10) || 0;
    var page = parseInt(document.getElementById("qlPage").value, 10) || 0;
    book.chapter = chapter;
    book.page = page;
    book.lastReadAt = new Date().toISOString();
    if (comment) book.lastComment = comment;
    applyShelfToItem(book, shelf, "book");
    if ((book.totalChapters && chapter >= book.totalChapters) || (book.totalPages && page >= book.totalPages)) {
      applyShelfToItem(book, "done", "book");
    }
    book.updatedAt = new Date().toISOString();
    closeOverlay("quickLogOverlay");
    dismissGate();
    save();
    showToast("Progress saved");
  }

  function markShowInProgress() {
    var show = getShow(ui.quickLogId);
    if (!show) return;
    var season = parseInt(document.getElementById("qlSeason").value, 10) || 1;
    var episode = parseInt(document.getElementById("qlEpisode").value, 10) || 1;
    show.watchingSeason = season;
    show.watchingEpisode = episode;
    applyShelfToItem(show, ui.quickLogShelf === "done" ? "active" : ui.quickLogShelf || "active", "show");
    show.updatedAt = new Date().toISOString();
    closeOverlay("quickLogOverlay");
    dismissGate();
    save();
    showToast("Watching " + epShort(season, episode));
  }

  function bumpShow(id) {
    var show = getShow(id);
    if (!show) return;
    if (isWatchingEpisode(show)) {
      show.season = show.watchingSeason;
      show.episode = show.watchingEpisode;
      show.lastWatchedAt = new Date().toISOString();
      show.watchingSeason = null;
      show.watchingEpisode = null;
      applyShelfToItem(show, show.shelf === "done" ? "active" : show.shelf || "active", "show");
      if (show.totalEpisodes && show.episode >= show.totalEpisodes) {
        applyShelfToItem(show, "done", "show");
        save();
        showToast("Finished · completed!");
        return;
      }
      save();
      showToast("Finished " + epShort(show.season, show.episode));
      return;
    }
    var next = getNextEpisode(show);
    show.watchingSeason = next.season;
    show.watchingEpisode = next.episode;
    applyShelfToItem(show, show.shelf === "done" || show.shelf === "shelved" ? "active" : show.shelf || "active", "show");
    show.updatedAt = new Date().toISOString();
    save();
    showToast("Watching " + epShort(next.season, next.episode));
  }

  function bumpBook(id) {
    openQuickLog("book", id);
  }

  function openQuickAdd(kind) {
    ui.quickAddKind = kind;
    ui.quickAddShelf = "active";
    var titles = {
      show: ["New show", "Just a title — tweak details later"],
      book: ["New book", "Add it in one tap"],
      manga: ["New manga", "Add it in one tap"],
      comic: ["New comic", "Add it in one tap"],
    };
    var t = titles[kind] || titles.book;
    document.getElementById("quickAddTitle").textContent = t[0];
    document.getElementById("quickAddSubtitle").textContent = t[1];
    document.getElementById("quickAddName").value = "";
    document.getElementById("quickAddAuthor").value = "";
    document.getElementById("quickAddAuthorField").hidden = kind === "show";
    document.getElementById("quickAddMoreBtn").hidden = false;
    setShelfChips("quickAddShelf", "active");
    openOverlay("quickAddOverlay");
    setTimeout(function () {
      document.getElementById("quickAddName").focus();
    }, 280);
  }

  function saveQuickAdd() {
    var title = document.getElementById("quickAddName").value.trim();
    if (!title) {
      showToast("Enter a title");
      return;
    }
    var shelf = ui.quickAddShelf || "active";
    var now = new Date().toISOString();

    if (ui.quickAddKind === "show") {
      var show = normalizeShow({
        id: uid(),
        title: title,
        type: "binge",
        season: 1,
        episode: 0,
        shelf: shelf,
        status: statusFromShelf(shelf, "show"),
        createdAt: now,
        updatedAt: now,
      });
      state.shows.unshift(show);
      closeOverlay("quickAddOverlay");
      dismissGate();
      save();
      showToast("Added");
      openQuickLog("show", show.id);
      return;
    }

    var bookType = ui.quickAddKind === "manga" ? "manga" : ui.quickAddKind === "comic" ? "comic" : "book";
    var book = normalizeBook({
      id: uid(),
      title: title,
      author: document.getElementById("quickAddAuthor").value.trim(),
      type: bookType,
      chapter: 0,
      page: 0,
      shelf: shelf,
      status: statusFromShelf(shelf, "book"),
      createdAt: now,
      updatedAt: now,
    });
    state.books.unshift(book);
    closeOverlay("quickAddOverlay");
    dismissGate();
    save();
    showToast("Added");
    openQuickLog("book", book.id);
  }

  function buildDayPicker() {
    var wrap = document.getElementById("showDayPicker");
    wrap.innerHTML = DAY_LABELS.map(function (label, i) {
      var active = ui.selectedDays.indexOf(i) >= 0 ? " active" : "";
      return '<button type="button" class="day-btn' + active + '" data-day="' + i + '">' + label + "</button>";
    }).join("");
  }

  function syncShowTypeUI() {
    var isAiring = ui.showType === "airing";
    document.getElementById("showScheduleField").hidden = !isAiring;
    document.getElementById("showTimeField").hidden = !isAiring;
    document.getElementById("showTypeHint").textContent = isAiring
      ? "New episodes drop on set days — we'll remind you."
      : "All episodes are out — track how far you've gotten.";
    document.querySelectorAll("#showTypeSeg button").forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.type === ui.showType);
    });
  }

  function resetShowForm(show) {
    ui.editingShowId = show ? show.id : null;
    ui.showType = show ? show.type : "binge";
    ui.selectedDays = show && show.schedule ? show.schedule.map(function (s) { return s.day; }) : [];
    document.getElementById("showFormTitle").textContent = show ? "Edit show" : "Add show";
    document.getElementById("showTitle").value = show ? show.title : "";
    document.getElementById("showSeason").value = show ? String(show.season) : "1";
    document.getElementById("showEpisode").value = show ? String(show.episode) : "0";
    document.getElementById("showTotalEpisodes").value = show && show.totalEpisodes != null ? String(show.totalEpisodes) : "";
    document.getElementById("showTotalSeasons").value = show && show.totalSeasons != null ? String(show.totalSeasons) : "";
    document.getElementById("showNotes").value = show ? show.notes : "";
    populateSubscriptionSelect(show ? show.subscriptionId : "");
    var timeVal = "20:00";
    if (show && show.schedule && show.schedule[0]) {
      var s = show.schedule[0];
      timeVal = (s.hour < 10 ? "0" : "") + s.hour + ":" + (s.minute < 10 ? "0" : "") + s.minute;
    }
    document.getElementById("showReleaseTime").value = timeVal;
    buildDayPicker();
    syncShowTypeUI();
  }

  function openShowForm(show) {
    resetShowForm(show || null);
    openOverlay("showFormOverlay");
    setTimeout(function () {
      document.getElementById("showTitle").focus();
    }, 280);
  }

  function saveShowForm() {
    var title = document.getElementById("showTitle").value.trim();
    if (!title) {
      showToast("Enter a show title");
      return;
    }
    if (ui.showType === "airing" && !ui.selectedDays.length) {
      showToast("Pick at least one release day");
      return;
    }
    var timeParts = document.getElementById("showReleaseTime").value.split(":");
    var hour = parseInt(timeParts[0], 10) || 20;
    var minute = parseInt(timeParts[1], 10) || 0;
    var schedule = ui.showType === "airing"
      ? ui.selectedDays.map(function (day) {
          return { day: day, hour: hour, minute: minute, time: hour + ":" + (minute < 10 ? "0" : "") + minute };
        })
      : [];

    var totalEp = document.getElementById("showTotalEpisodes").value;
    var totalSeas = document.getElementById("showTotalSeasons").value;
    var existing = ui.editingShowId ? getShow(ui.editingShowId) : null;
    var payload = {
      id: ui.editingShowId || uid(),
      title: title,
      type: ui.showType,
      season: parseInt(document.getElementById("showSeason").value, 10) || 1,
      episode: parseInt(document.getElementById("showEpisode").value, 10) || 0,
      totalEpisodes: totalEp === "" ? null : parseInt(totalEp, 10),
      totalSeasons: totalSeas === "" ? null : parseInt(totalSeas, 10),
      schedule: schedule,
      subscriptionId: document.getElementById("showSubscription").value || null,
      notes: document.getElementById("showNotes").value.trim(),
      shelf: existing ? existing.shelf : "active",
      status: existing ? existing.status : "watching",
      lastComment: existing ? existing.lastComment : "",
      lastWatchedAt: existing ? existing.lastWatchedAt : null,
      watchingSeason: existing ? existing.watchingSeason : null,
      watchingEpisode: existing ? existing.watchingEpisode : null,
      createdAt: existing ? existing.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (ui.editingShowId) {
      if (existing && existing.watchingEpisode > 0) {
        var editedEpisode = payload.episode;
        var editedSeason = payload.season;
        var watchingAhead =
          editedSeason > existing.watchingSeason ||
          (editedSeason === existing.watchingSeason && editedEpisode >= existing.watchingEpisode);
        if (watchingAhead) {
          payload.watchingSeason = null;
          payload.watchingEpisode = null;
        }
      }
      state.shows = state.shows.map(function (s) {
        return s.id === ui.editingShowId ? normalizeShow(payload) : s;
      });
      showToast("Show updated");
    } else {
      state.shows.unshift(normalizeShow(payload));
      showToast("Show added");
    }
    closeOverlay("showFormOverlay");
    save();
  }

  function resetBookForm(book) {
    ui.editingBookId = book ? book.id : null;
    ui.bookType = book ? book.type : "book";
    document.getElementById("bookFormTitle").textContent = book ? "Edit" : "Add to read";
    document.getElementById("bookTitle").value = book ? book.title : "";
    document.getElementById("bookAuthor").value = book ? book.author : "";
    document.getElementById("bookChapter").value = book ? String(book.chapter) : "0";
    document.getElementById("bookPage").value = book ? String(book.page) : "0";
    document.getElementById("bookTotalChapters").value = book && book.totalChapters != null ? String(book.totalChapters) : "";
    document.getElementById("bookTotalPages").value = book && book.totalPages != null ? String(book.totalPages) : "";
    document.getElementById("bookNotes").value = book ? book.notes : "";
    document.querySelectorAll("#bookTypeSeg button").forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.type === ui.bookType);
    });
  }

  function openBookForm(book) {
    resetBookForm(book || null);
    openOverlay("bookFormOverlay");
    setTimeout(function () {
      document.getElementById("bookTitle").focus();
    }, 280);
  }

  function saveBookForm() {
    var title = document.getElementById("bookTitle").value.trim();
    if (!title) {
      showToast("Enter a title");
      return;
    }
    var totalCh = document.getElementById("bookTotalChapters").value;
    var totalPg = document.getElementById("bookTotalPages").value;
    var existing = ui.editingBookId ? getBook(ui.editingBookId) : null;
    var payload = {
      id: ui.editingBookId || uid(),
      title: title,
      author: document.getElementById("bookAuthor").value.trim(),
      type: ui.bookType,
      chapter: parseInt(document.getElementById("bookChapter").value, 10) || 0,
      page: parseInt(document.getElementById("bookPage").value, 10) || 0,
      totalChapters: totalCh === "" ? null : parseInt(totalCh, 10),
      totalPages: totalPg === "" ? null : parseInt(totalPg, 10),
      notes: document.getElementById("bookNotes").value.trim(),
      shelf: existing ? existing.shelf : "active",
      status: existing ? existing.status : "reading",
      lastComment: existing ? existing.lastComment : "",
      lastReadAt: existing ? existing.lastReadAt : null,
      createdAt: existing ? existing.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (ui.editingBookId) {
      state.books = state.books.map(function (b) {
        return b.id === ui.editingBookId ? normalizeBook(payload) : b;
      });
      showToast("Updated");
    } else {
      state.books.unshift(normalizeBook(payload));
      showToast("Added to shelf");
    }
    closeOverlay("bookFormOverlay");
    save();
  }

  function populateSubscriptionSelect(selectedId) {
    var sel = document.getElementById("showSubscription");
    if (!sel) return;
    var val = selectedId != null ? selectedId : sel.value;
    var active = state.subscriptions.filter(function (s) { return s.active; });
    sel.innerHTML = '<option value="">None</option>' +
      active.map(function (s) {
        var label = s.name + (s.kind === "channel" ? " (TV)" : "");
        return '<option value="' + escapeHtml(s.id) + '">' + escapeHtml(label) + "</option>";
      }).join("");
    sel.value = val || "";
  }

  function resetSubscriptionForm(sub) {
    ui.editingSubscriptionId = sub ? sub.id : null;
    ui.subscriptionKind = sub ? sub.kind : "streaming";
    document.getElementById("subscriptionFormTitle").textContent = sub ? "Edit subscription" : "Add subscription";
    document.getElementById("subscriptionName").value = sub ? sub.name : "";
    document.getElementById("subscriptionCost").value = sub && sub.cost != null ? String(sub.cost) : "";
    document.getElementById("subscriptionNotes").value = sub ? sub.notes : "";
    document.getElementById("subscriptionActive").checked = sub ? sub.active !== false : true;
    document.getElementById("subscriptionDeleteBtn").hidden = !sub;
    document.querySelectorAll("#subscriptionKindSeg button").forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.kind === ui.subscriptionKind);
    });
  }

  function openSubscriptionForm(sub) {
    resetSubscriptionForm(sub || null);
    openOverlay("subscriptionFormOverlay");
    setTimeout(function () {
      document.getElementById("subscriptionName").focus();
    }, 280);
  }

  function saveSubscriptionForm() {
    var name = document.getElementById("subscriptionName").value.trim();
    if (!name) {
      showToast("Enter a name");
      return;
    }
    var costVal = document.getElementById("subscriptionCost").value;
    var payload = {
      id: ui.editingSubscriptionId || uid(),
      name: name,
      kind: ui.subscriptionKind,
      active: document.getElementById("subscriptionActive").checked,
      cost: costVal === "" ? null : parseFloat(costVal),
      notes: document.getElementById("subscriptionNotes").value.trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (ui.editingSubscriptionId) {
      var existing = getSubscription(ui.editingSubscriptionId);
      if (existing) payload.createdAt = existing.createdAt;
      state.subscriptions = state.subscriptions.map(function (s) {
        return s.id === ui.editingSubscriptionId ? normalizeSubscription(payload) : s;
      });
      showToast("Subscription updated");
    } else {
      state.subscriptions.unshift(normalizeSubscription(payload));
      showToast("Subscription added");
    }
    closeOverlay("subscriptionFormOverlay");
    save();
  }

  function deleteSubscription() {
    if (!ui.editingSubscriptionId || !confirm("Delete this subscription?")) return;
    state.subscriptions = state.subscriptions.filter(function (s) {
      return s.id !== ui.editingSubscriptionId;
    });
    state.shows.forEach(function (show) {
      if (show.subscriptionId === ui.editingSubscriptionId) show.subscriptionId = null;
    });
    closeOverlay("subscriptionFormOverlay");
    save();
    showToast("Deleted");
  }

  function populateReminderShowSelect() {
    var sel = document.getElementById("reminderLinkShow");
    if (!sel) return;
    var val = sel.value;
    sel.innerHTML = '<option value="">None</option>' +
      state.shows.map(function (s) {
        return '<option value="' + escapeHtml(s.id) + '">' + escapeHtml(s.title) + "</option>";
      }).join("");
    sel.value = val;
  }

  function openReminderForm(reminder) {
    ui.editingReminderId = reminder ? reminder.id : null;
    document.getElementById("reminderFormTitle").textContent = reminder ? "Edit reminder" : "Add reminder";
    document.getElementById("reminderTitle").value = reminder ? reminder.title : "";
    document.getElementById("reminderWhen").value = reminder && reminder.at
      ? toDatetimeLocalValue(reminder.at)
      : toDatetimeLocalValue(new Date());
    document.getElementById("reminderLinkShow").value = reminder && reminder.showId ? reminder.showId : "";
    document.getElementById("reminderNotes").value = reminder ? reminder.notes : "";
    populateReminderShowSelect();
    if (reminder && reminder.showId) {
      document.getElementById("reminderLinkShow").value = reminder.showId;
    }
    openOverlay("reminderFormOverlay");
  }

  function saveReminderForm() {
    var title = document.getElementById("reminderTitle").value.trim();
    if (!title) {
      showToast("Enter a reminder title");
      return;
    }
    var at = fromDatetimeLocalValue(document.getElementById("reminderWhen").value);
    if (!at) {
      showToast("Pick a date and time");
      return;
    }
    var payload = {
      id: ui.editingReminderId || uid(),
      title: title,
      at: at,
      showId: document.getElementById("reminderLinkShow").value || null,
      notes: document.getElementById("reminderNotes").value.trim(),
      enabled: true,
      createdAt: new Date().toISOString(),
    };

    if (ui.editingReminderId) {
      state.reminders = state.reminders.map(function (r) {
        return r.id === ui.editingReminderId ? normalizeReminder(payload) : r;
      });
      showToast("Reminder updated");
    } else {
      state.reminders.unshift(normalizeReminder(payload));
      showToast("Reminder set");
    }
    closeOverlay("reminderFormOverlay");
    save();
  }

  function handleFab() {
    if (ui.view === "calendar") {
      openReminderForm(null);
      return;
    }
    if (ui.view === "subscriptions") {
      openSubscriptionForm(null);
      return;
    }
    openOverlay("addPickerOverlay");
  }

  function exportJson() {
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "media-shelf-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    showToast("Exported");
  }

  function importJson(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = JSON.parse(reader.result);
        if (typeof AppsBackup !== "undefined" && AppsBackup.isUnifiedBackup(parsed)) {
          var slice = AppsBackup.getAppSlice(parsed, "media-shelf");
          if (!slice) {
            showToast("No Media Shelf data in that file");
            return;
          }
          parsed = slice;
        }
        if (!confirm("Replace your Media Shelf data with this file?")) return;
        state = normalizeData(parsed);
        save();
        showToast("Imported");
      } catch (e) {
        showToast("Could not read file");
      }
    };
    reader.readAsText(file);
  }

  function bindEvents() {
    document.querySelectorAll(".nav-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setView(btn.dataset.view);
      });
    });

    document.getElementById("fabBtn").addEventListener("click", handleFab);

    document.getElementById("addShowBtn").addEventListener("click", function () {
      closeOverlay("addPickerOverlay");
      openQuickAdd("show");
    });
    document.getElementById("addBookBtn").addEventListener("click", function () {
      closeOverlay("addPickerOverlay");
      openQuickAdd("book");
    });
    document.getElementById("addMangaBtn").addEventListener("click", function () {
      closeOverlay("addPickerOverlay");
      openQuickAdd("manga");
    });
    document.getElementById("addReminderBtn").addEventListener("click", function () {
      closeOverlay("addPickerOverlay");
      openReminderForm(null);
    });
    document.getElementById("addPickerCancel").addEventListener("click", function () {
      closeOverlay("addPickerOverlay");
    });

    document.getElementById("quickAddCancel").addEventListener("click", function () {
      closeOverlay("quickAddOverlay");
    });
    document.getElementById("quickAddSave").addEventListener("click", saveQuickAdd);
    document.getElementById("quickAddName").addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        saveQuickAdd();
      }
    });
    document.getElementById("quickAddMoreBtn").addEventListener("click", function () {
      var title = document.getElementById("quickAddName").value.trim();
      var author = document.getElementById("quickAddAuthor").value.trim();
      closeOverlay("quickAddOverlay");
      if (ui.quickAddKind === "show") {
        openShowForm(title ? { title: title, type: "binge", season: 1, episode: 0, shelf: ui.quickAddShelf } : null);
        if (title) document.getElementById("showTitle").value = title;
      } else {
        var type = ui.quickAddKind === "manga" ? "manga" : ui.quickAddKind === "comic" ? "comic" : "book";
        openBookForm(title ? { title: title, author: author, type: type, chapter: 0, page: 0, shelf: ui.quickAddShelf } : null);
        ui.bookType = type;
        document.querySelectorAll("#bookTypeSeg button").forEach(function (btn) {
          btn.classList.toggle("active", btn.dataset.type === type);
        });
      }
    });
    document.getElementById("quickAddShelf").addEventListener("click", function (e) {
      var chip = e.target.closest(".shelf-chip");
      if (!chip) return;
      ui.quickAddShelf = chip.dataset.shelf;
      setShelfChips("quickAddShelf", ui.quickAddShelf);
    });

    document.querySelectorAll("#homeFilters .chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        ui.homeFilter = chip.dataset.filter;
        document.querySelectorAll("#homeFilters .chip").forEach(function (c) {
          c.classList.toggle("active", c === chip);
        });
        renderHome();
      });
    });

    document.getElementById("consumeSkipBtn").addEventListener("click", dismissGate);
    document.getElementById("consumeAddBtn").addEventListener("click", function () {
      dismissGate();
      openOverlay("addPickerOverlay");
    });

    document.getElementById("consumeGrid").addEventListener("click", function (e) {
      var emptyTile = e.target.closest("[data-consume-empty]");
      if (emptyTile) {
        dismissGate();
        openOverlay("addPickerOverlay");
        return;
      }
      var showTile = e.target.closest(".consume-tile[data-show-id]");
      if (showTile) {
        openQuickLog("show", showTile.dataset.showId);
        return;
      }
      var bookTile = e.target.closest(".consume-tile[data-book-id]");
      if (bookTile) {
        openQuickLog("book", bookTile.dataset.bookId);
      }
    });

    document.getElementById("qlSaveBtn").addEventListener("click", saveQuickLog);
    document.getElementById("qlStartBtn").addEventListener("click", markShowInProgress);
    document.getElementById("qlCloseBtn").addEventListener("click", function () {
      closeOverlay("quickLogOverlay");
    });
    document.getElementById("qlEditBtn").addEventListener("click", function () {
      closeOverlay("quickLogOverlay");
      if (ui.quickLogKind === "show") {
        var show = getShow(ui.quickLogId);
        if (show) openShowForm(show);
      } else {
        var book = getBook(ui.quickLogId);
        if (book) openBookForm(book);
      }
    });
    document.getElementById("qlDeleteBtn").addEventListener("click", function () {
      if (ui.quickLogKind === "show") {
        if (!confirm("Delete this show?")) return;
        state.shows = state.shows.filter(function (s) { return s.id !== ui.quickLogId; });
      } else {
        if (!confirm("Delete this item?")) return;
        state.books = state.books.filter(function (b) { return b.id !== ui.quickLogId; });
      }
      closeOverlay("quickLogOverlay");
      save();
      showToast("Deleted");
    });
    document.getElementById("quickLogShelf").addEventListener("click", function (e) {
      var chip = e.target.closest(".shelf-chip");
      if (!chip) return;
      ui.quickLogShelf = chip.dataset.shelf;
      setShelfChips("quickLogShelf", ui.quickLogShelf);
    });

    document.getElementById("showTypeSeg").addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-type]");
      if (!btn) return;
      ui.showType = btn.dataset.type;
      syncShowTypeUI();
    });

    document.getElementById("showDayPicker").addEventListener("click", function (e) {
      var btn = e.target.closest(".day-btn");
      if (!btn) return;
      var day = parseInt(btn.dataset.day, 10);
      var idx = ui.selectedDays.indexOf(day);
      if (idx >= 0) ui.selectedDays.splice(idx, 1);
      else ui.selectedDays.push(day);
      buildDayPicker();
    });

    document.getElementById("bookTypeSeg").addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-type]");
      if (!btn) return;
      ui.bookType = btn.dataset.type;
      document.querySelectorAll("#bookTypeSeg button").forEach(function (b) {
        b.classList.toggle("active", b === btn);
      });
    });

    document.getElementById("showFormCancel").addEventListener("click", function () {
      closeOverlay("showFormOverlay");
    });
    document.getElementById("showFormSave").addEventListener("click", saveShowForm);

    document.getElementById("bookFormCancel").addEventListener("click", function () {
      closeOverlay("bookFormOverlay");
    });
    document.getElementById("bookFormSave").addEventListener("click", saveBookForm);

    document.getElementById("reminderFormCancel").addEventListener("click", function () {
      closeOverlay("reminderFormOverlay");
    });
    document.getElementById("reminderFormSave").addEventListener("click", saveReminderForm);

    document.getElementById("subscriptionFormCancel").addEventListener("click", function () {
      closeOverlay("subscriptionFormOverlay");
    });
    document.getElementById("subscriptionFormSave").addEventListener("click", saveSubscriptionForm);
    document.getElementById("subscriptionDeleteBtn").addEventListener("click", deleteSubscription);
    document.getElementById("subscriptionKindSeg").addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-kind]");
      if (!btn) return;
      ui.subscriptionKind = btn.dataset.kind;
      document.querySelectorAll("#subscriptionKindSeg button").forEach(function (b) {
        b.classList.toggle("active", b === btn);
      });
    });

    document.getElementById("calPrevBtn").addEventListener("click", function () {
      var year = ui.calendarMonth.year;
      var month = ui.calendarMonth.month;
      ui.calendarMonth = month === 0 ? { year: year - 1, month: 11 } : { year: year, month: month - 1 };
      renderCalendar();
    });
    document.getElementById("calNextBtn").addEventListener("click", function () {
      var year = ui.calendarMonth.year;
      var month = ui.calendarMonth.month;
      ui.calendarMonth = month === 11 ? { year: year + 1, month: 0 } : { year: year, month: month + 1 };
      renderCalendar();
    });
    document.getElementById("calGrid").addEventListener("click", function (e) {
      var dayBtn = e.target.closest("[data-cal-date]");
      if (!dayBtn) return;
      ui.selectedDate = dayBtn.dataset.calDate;
      renderCalendar();
    });

    document.getElementById("settingsBtn").addEventListener("click", function () {
      openOverlay("settingsOverlay");
    });
    document.getElementById("settingsCloseBtn").addEventListener("click", function () {
      closeOverlay("settingsOverlay");
    });
    document.getElementById("exportJsonBtn").addEventListener("click", exportJson);
    document.getElementById("importJsonFile").addEventListener("change", function (e) {
      var file = e.target.files && e.target.files[0];
      e.target.value = "";
      importJson(file);
    });

    document.querySelectorAll(".overlay").forEach(function (overlay) {
      overlay.addEventListener("click", function (e) {
        if (e.target === overlay) closeOverlay(overlay.id);
      });
    });

    document.addEventListener("click", function (e) {
      var bumpShowBtn = e.target.closest("[data-bump-show]");
      if (bumpShowBtn) {
        e.preventDefault();
        e.stopPropagation();
        bumpShow(bumpShowBtn.dataset.bumpShow);
        return;
      }
      var bumpBookBtn = e.target.closest("[data-bump-book]");
      if (bumpBookBtn) {
        e.preventDefault();
        e.stopPropagation();
        bumpBook(bumpBookBtn.dataset.bumpBook);
        return;
      }
      var subBtn = e.target.closest("[data-subscription-id]");
      if (subBtn && !subBtn.closest(".overlay")) {
        var sub = getSubscription(subBtn.dataset.subscriptionId);
        if (sub) openSubscriptionForm(sub);
        return;
      }
      var showBtn = e.target.closest("[data-show-id]");
      if (showBtn && !e.target.closest(".reminder-row")) {
        openQuickLog("show", showBtn.dataset.showId);
        return;
      }
      var showBtnInReminder = e.target.closest(".reminder-card[data-show-id]");
      if (showBtnInReminder) {
        openQuickLog("show", showBtnInReminder.dataset.showId);
        return;
      }
      var bookBtn = e.target.closest("[data-book-id]");
      if (bookBtn) {
        openQuickLog("book", bookBtn.dataset.bookId);
        return;
      }
      var remBtn = e.target.closest("[data-reminder-id]");
      if (remBtn) {
        var rem = state.reminders.find(function (r) { return r.id === remBtn.dataset.reminderId; });
        if (rem) openReminderForm(rem);
      }
    });

    var header = document.getElementById("appHeader");
    window.addEventListener("scroll", function () {
      header.classList.toggle("scrolled", window.scrollY > 8);
    }, { passive: true });
  }

  load();
  bindEvents();
  render();

  if (shouldShowGate() && getRecentForGate().length > 0) {
    showGate(true);
  } else {
    touchLastOpen();
  }
})();
