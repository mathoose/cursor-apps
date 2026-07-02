(function () {
  "use strict";

  var STORAGE_KEY = "media-shelf-v1";
  var DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var DAY_LABELS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  var HOME_WINDOW_DAYS = 5;

  var state = {
    shows: [],
    books: [],
    reminders: [],
    subscriptions: [],
  };

  var ui = {
    view: "home",
    watchFilter: "all",
    readFilter: "all",
    editingShowId: null,
    editingBookId: null,
    editingReminderId: null,
    editingSubscriptionId: null,
    detailShowId: null,
    detailBookId: null,
    showType: "binge",
    bookType: "book",
    subscriptionKind: "streaming",
    selectedDays: [],
    calendarMonth: null,
    selectedDate: null,
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
    return { version: 2, shows: [], books: [], reminders: [], subscriptions: [] };
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
      status: ["watching", "paused", "completed", "planning"].indexOf(raw.status) >= 0 ? raw.status : "watching",
      schedule: schedule,
      subscriptionId: raw.subscriptionId || null,
      notes: raw.notes ? String(raw.notes) : "",
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
      status: ["reading", "paused", "completed", "planning"].indexOf(raw.status) >= 0 ? raw.status : "reading",
      notes: raw.notes ? String(raw.notes) : "",
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
      version: 2,
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
    state.version = 2;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    render();
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
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
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

  function episodeLabel(show) {
    if (!show) return "";
    if (show.episode === 0 && !isWatchingEpisode(show)) return "Not started";
    return epShort(show.season, show.episode);
  }

  function lastFinishedLabel(show) {
    if (!show || show.episode === 0) return "Not started";
    return epShort(show.season, show.episode);
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
    var nextText = epShort(next.season, next.episode);
    if (compact) {
      if (next.season === show.season) nextText = "E" + next.episode;
      return "→ " + nextText;
    }
    return epShort(show.season, show.episode) + " → " + nextText;
  }

  function progressStatusLabel(show, now) {
    if (isWatchingEpisode(show)) return "Watching";
    var overdueDays = getShowOverdueDays(show, now);
    if (overdueDays > 0) {
      var missed = getLatestDueAirDate(show, now);
      return missed ? formatOverdueCompact(missed.toISOString()) : "Late";
    }
    return formatDaysSince(show.lastWatchedAt);
  }

  function bookProgressLabel(book) {
    if (!book) return "";
    var parts = [];
    if (book.chapter > 0) parts.push("Ch. " + book.chapter);
    if (book.page > 0) parts.push("p. " + book.page);
    if (!parts.length) return "Not started";
    return parts.join(" · ");
  }

  function showProgressPercent(show) {
    if (!show.totalEpisodes || show.totalEpisodes <= 0) return null;
    return Math.min(100, Math.round((show.episode / show.totalEpisodes) * 100));
  }

  function bookProgressPercent(book) {
    if (book.totalChapters && book.totalChapters > 0) {
      return Math.min(100, Math.round((book.chapter / book.totalChapters) * 100));
    }
    if (book.totalPages && book.totalPages > 0) {
      return Math.min(100, Math.round((book.page / book.totalPages) * 100));
    }
    return null;
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

  function formatOverdueCompact(dateIso) {
    var d = parseDate(dateIso);
    if (!d) return "Late";
    var now = new Date();
    var diffDays = Math.floor((startOfDay(now) - startOfDay(d)) / 86400000);
    if (diffDays <= 0) return "Today";
    if (diffDays === 1) return "1d late";
    return diffDays + "d late";
  }

  function formatDaysSince(dateIso) {
    var d = parseDate(dateIso);
    if (!d) return "Never";
    var now = new Date();
    var diffDays = Math.floor((startOfDay(now) - startOfDay(d)) / 86400000);
    if (diffDays <= 0) return "Today";
    if (diffDays === 1) return "1d";
    if (diffDays < 7) return diffDays + "d";
    if (diffDays < 30) return Math.floor(diffDays / 7) + "w";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function getShowOverdueDays(show, asOf) {
    if (!show || show.type !== "airing" || !show.schedule.length) return 0;
    if (isCaughtUp(show, asOf)) return 0;
    var missed = getLatestDueAirDate(show, asOf);
    if (!missed) return 0;
    return Math.floor((startOfDay(asOf || new Date()) - startOfDay(missed)) / 86400000);
  }

  function getWatchingShowsForHome() {
    var now = new Date();
    return state.shows
      .filter(function (s) { return s.status === "watching"; })
      .sort(function (a, b) {
        var aWatching = isWatchingEpisode(a) ? 1 : 0;
        var bWatching = isWatchingEpisode(b) ? 1 : 0;
        if (aWatching !== bWatching) return bWatching - aWatching;
        var aLate = getShowOverdueDays(a, now);
        var bLate = getShowOverdueDays(b, now);
        if (aLate !== bLate) return bLate - aLate;
        var aT = a.lastWatchedAt ? new Date(a.lastWatchedAt).getTime() : 0;
        var bT = b.lastWatchedAt ? new Date(b.lastWatchedAt).getTime() : 0;
        return aT - bT;
      });
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
      if (show.status !== "watching" || show.type !== "airing" || !show.schedule.length) return;
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
    var upcoming = [];
    var todayCount = 0;
    var byDate = {};

    items.forEach(function (item) {
      var d = parseDate(item.at);
      if (!d) return;
      var key = dateStr(d);
      if (!byDate[key]) byDate[key] = [];
      byDate[key].push(item);

      if (item.overdue) overdue.push(item);
      else if (d < homeWindowEnd) upcoming.push(item);

      if (isSameDay(d, now) || item.overdue) todayCount++;
    });

    return {
      all: items,
      overdue: overdue,
      upcoming: upcoming,
      todayCount: todayCount,
      badgeCount: overdue.length + items.filter(function (item) {
        if (item.overdue) return false;
        var d = parseDate(item.at);
        return d && isSameDay(d, now);
      }).length,
      byDate: byDate,
    };
  }

  function collectCalendarItems(rangeStart, rangeEnd) {
    var items = [];

    state.shows.forEach(function (show) {
      if (show.type !== "airing" || show.status === "completed" || !show.schedule.length) return;
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

  function renderShowRow(show) {
    var now = new Date();
    var overdueDays = getShowOverdueDays(show, now);
    var isOverdue = overdueDays > 0 && !isWatchingEpisode(show);
    var watching = isWatchingEpisode(show);
    var sinceLabel = progressStatusLabel(show, now);
    var rowClass = "show-row" + (isOverdue ? " overdue" : "") + (watching ? " in-progress" : "");
    var typeClass = show.type === "airing" ? "airing" : "binge";
    var epClass = "show-row-ep" + (watching ? " watching" : "");
    var quickAction = watching ? "finish" : "start";
    var quickLabel = watching ? "Finish episode" : "Start next episode";

    return (
      '<div class="' + rowClass + '">' +
      '<button type="button" class="show-row-main" data-show-id="' + escapeHtml(show.id) + '">' +
      '<span class="show-row-type ' + typeClass + '" aria-hidden="true"></span>' +
      '<span class="show-row-title">' + escapeHtml(show.title) + "</span>" +
      '<span class="' + epClass + '">' + escapeHtml(progressLabel(show, true)) + "</span>" +
      '<span class="show-row-since' + (isOverdue ? " overdue" : "") + (watching ? " watching" : "") + '">' + escapeHtml(sinceLabel) + "</span>" +
      "</button>" +
      '<button type="button" class="show-row-log' + (watching ? " finish" : "") + '" data-quick-log-show="' + escapeHtml(show.id) + '" data-quick-action="' + quickAction + '" aria-label="' + escapeHtml(quickLabel) + '">' + (watching ? "✓" : "+") + "</button>" +
      "</div>"
    );
  }

  function renderCustomReminderCompact(item) {
    var d = parseDate(item.at);
    var now = new Date();
    var whenLabel = d ? formatDateTime(item.at) : "No date";
    if (item.overdue) whenLabel = formatOverdueCompact(item.at);
    else if (d && isSameDay(d, now)) whenLabel = "Today";
    else if (d && isSameDay(d, addDays(now, 1))) whenLabel = "Tomorrow";

    return (
      '<button type="button" class="reminder-compact" data-reminder-id="' + escapeHtml(item.id) + '">' +
      '<span class="reminder-compact-title">' + escapeHtml(item.title) + "</span>" +
      '<span class="reminder-compact-when' + (item.overdue ? " overdue" : "") + '">' + escapeHtml(whenLabel) + "</span>" +
      "</button>"
    );
  }

  function renderShowCard(show) {
    var pct = showProgressPercent(show);
    var badgeClass = show.status === "completed" ? "completed" : show.type === "airing" ? "airing" : "binge";
    var badgeText = show.status === "completed" ? "Done" : show.type === "airing" ? "Airing" : "Binge";
    var last = show.lastWatchedAt ? formatRelative(show.lastWatchedAt) : "Never logged";
    var progressText = isWatchingEpisode(show)
      ? "Watching " + epShort(show.watchingSeason, show.watchingEpisode)
      : progressLabel(show);
    var nextAir = "";
    if (show.type === "airing" && show.status === "watching" && show.schedule.length) {
      var next = getNextAirDate(show);
      if (next) nextAir = '<div class="schedule-pill"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>Next: ' + escapeHtml(formatDateTime(next.toISOString())) + "</div>";
    }
    var progress = "";
    if (pct != null) {
      progress =
        '<div class="progress-wrap">' +
        '<div class="progress-bar"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
        '<div class="progress-label">' + show.episode + " / " + show.totalEpisodes + " episodes</div></div>";
    }
    var sub = show.subscriptionId ? getSubscription(show.subscriptionId) : null;
    var subPill = sub
      ? '<div class="schedule-pill sub-pill"><svg viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2"/></svg>' +
        escapeHtml(sub.name) + "</div>"
      : "";
    return (
      '<button type="button" class="media-card" data-show-id="' + escapeHtml(show.id) + '">' +
      '<div class="media-card-top"><h3>' + escapeHtml(show.title) + '</h3><span class="badge ' + badgeClass + '">' + badgeText + "</span></div>" +
      '<div class="media-meta"><span><strong>' + escapeHtml(progressText) + "</strong></span>" +
      '<span>Last finished: ' + escapeHtml(lastFinishedLabel(show)) + (show.lastWatchedAt ? " · " + escapeHtml(last) : "") + "</span></div>" +
      progress + nextAir + subPill +
      "</button>"
    );
  }

  function renderBookCard(book) {
    var pct = bookProgressPercent(book);
    var badgeClass = book.status === "completed" ? "completed" : book.type === "manga" ? "airing" : "binge";
    var badgeText = book.status === "completed" ? "Done" : book.type.charAt(0).toUpperCase() + book.type.slice(1);
    var last = book.lastReadAt ? formatRelative(book.lastReadAt) : "Never logged";
    var progress = "";
    if (pct != null) {
      var denom = book.totalChapters ? book.totalChapters + " ch" : book.totalPages + " pg";
      var num = book.totalChapters ? book.chapter : book.page;
      progress =
        '<div class="progress-wrap">' +
        '<div class="progress-bar"><div class="progress-fill" style="width:' + pct + '%;background:linear-gradient(90deg,#34d399,#059669)"></div></div>' +
        '<div class="progress-label">' + num + " / " + denom + "</div></div>";
    }
    var author = book.author ? '<span>' + escapeHtml(book.author) + "</span>" : "";
    return (
      '<button type="button" class="media-card" data-book-id="' + escapeHtml(book.id) + '">' +
      '<div class="media-card-top"><h3>' + escapeHtml(book.title) + '</h3><span class="badge ' + badgeClass + '">' + badgeText + "</span></div>" +
      '<div class="media-meta"><span><strong>' + escapeHtml(bookProgressLabel(book)) + "</strong></span>" +
      author + '<span>Last: ' + escapeHtml(last) + "</span></div>" +
      progress +
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
    else if (d && isSameDay(d, now)) cls += " today";
    else if (d && d < now) cls += " past";
    var iconClass = item.kind === "episode" ? "episode" : "custom";
    var iconSvg = item.kind === "episode"
      ? '<svg viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M10 9.5l5 3-5 3V9.5z" fill="currentColor" stroke="none"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>';
    var whenLabel = d ? formatDateTime(item.at) : "No date";
    if (item.overdue) whenLabel = formatOverdueLabel(item.at) + " · " + (d ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "");
    else if (d && isSameDay(d, now)) whenLabel = "Today · " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    else if (d && isSameDay(d, addDays(now, 1))) whenLabel = "Tomorrow · " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

    var attrs = item.auto ? ' data-auto-reminder="1"' : ' data-reminder-id="' + escapeHtml(item.id) + '"';
    if (item.showId) attrs += ' data-show-id="' + escapeHtml(item.showId) + '"';

    var quickLogBtn = showQuickLog
      ? '<button type="button" class="reminder-quick-log" data-quick-log-show="' + escapeHtml(item.showId) + '" aria-label="Mark watched">Watched</button>'
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

  function renderSubscriptionCard(sub) {
    var badgeClass = sub.active ? "airing" : "completed";
    var badgeText = sub.active ? "Active" : "Inactive";
    var kindLabel = sub.kind === "channel" ? "Channel" : "Streaming";
    var cost = sub.cost != null ? '<span>$' + sub.cost.toFixed(2) + "/mo</span>" : "";
    var notes = sub.notes ? '<p class="sub-notes">' + escapeHtml(sub.notes) + "</p>" : "";
    return (
      '<button type="button" class="media-card sub-card" data-subscription-id="' + escapeHtml(sub.id) + '">' +
      '<div class="media-card-top"><h3>' + escapeHtml(sub.name) + '</h3><span class="badge ' + badgeClass + '">' + badgeText + "</span></div>" +
      '<div class="media-meta"><span>' + kindLabel + "</span>" + cost + "</div>" +
      notes +
      "</button>"
    );
  }

  function filterShows() {
    return state.shows.filter(function (show) {
      if (ui.watchFilter === "all") return true;
      if (ui.watchFilter === "watching") return show.status === "watching" || show.status === "paused";
      if (ui.watchFilter === "binge") return show.type === "binge" && show.status !== "completed";
      if (ui.watchFilter === "airing") return show.type === "airing" && show.status !== "completed";
      if (ui.watchFilter === "completed") return show.status === "completed";
      return true;
    }).sort(function (a, b) {
      var aT = a.lastWatchedAt || a.updatedAt;
      var bT = b.lastWatchedAt || b.updatedAt;
      return new Date(bT) - new Date(aT);
    });
  }

  function filterBooks() {
    return state.books.filter(function (book) {
      if (ui.readFilter === "all") return true;
      if (ui.readFilter === "reading") return book.status === "reading" || book.status === "paused";
      if (ui.readFilter === "book") return book.type === "book" && book.status !== "completed";
      if (ui.readFilter === "manga") return (book.type === "manga" || book.type === "comic") && book.status !== "completed";
      if (ui.readFilter === "completed") return book.status === "completed";
      return true;
    }).sort(function (a, b) {
      var aT = a.lastReadAt || a.updatedAt;
      var bT = b.lastReadAt || b.updatedAt;
      return new Date(bT) - new Date(aT);
    });
  }

  function render() {
    var reminders = collectReminders();

    var watching = getWatchingShowsForHome();
    document.getElementById("homeWatching").innerHTML = watching.map(renderShowRow).join("");
    document.getElementById("homeWatchingEmpty").hidden = watching.length > 0;

    var now = new Date();
    var homeWindowEnd = addDays(startOfDay(now), HOME_WINDOW_DAYS + 1);
    var homeCustom = reminders.all.filter(function (item) {
      if (item.kind !== "custom") return false;
      if (item.overdue) return true;
      var d = parseDate(item.at);
      return d && d < homeWindowEnd;
    });
    var remindersLabel = document.getElementById("homeRemindersLabel");
    var remindersEl = document.getElementById("homeReminders");
    if (homeCustom.length > 0) {
      remindersLabel.hidden = false;
      remindersEl.hidden = false;
      remindersEl.innerHTML = homeCustom.map(renderCustomReminderCompact).join("");
    } else {
      remindersLabel.hidden = true;
      remindersEl.hidden = true;
      remindersEl.innerHTML = "";
    }

    var continueRead = state.books
      .filter(function (b) { return b.status === "reading"; })
      .sort(function (a, b) { return new Date(b.lastReadAt || 0) - new Date(a.lastReadAt || 0); })
      .slice(0, 4);
    document.getElementById("homeContinueRead").innerHTML = continueRead.map(renderBookCard).join("");
    document.getElementById("homeReadEmpty").hidden = continueRead.length > 0;

    var shows = filterShows();
    document.getElementById("watchList").innerHTML = shows.map(renderShowCard).join("");
    document.getElementById("watchEmpty").hidden = shows.length > 0;

    var books = filterBooks();
    document.getElementById("readList").innerHTML = books.map(renderBookCard).join("");
    document.getElementById("readEmpty").hidden = books.length > 0;

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
    fab.style.display =
      ui.view === "home" ||
      ui.view === "watch" ||
      ui.view === "read" ||
      ui.view === "calendar" ||
      ui.view === "subscriptions"
        ? "flex"
        : "none";
  }

  function setView(view) {
    ui.view = view;
    document.body.className = "view-" + view;
    document.querySelectorAll(".view").forEach(function (el) {
      el.classList.toggle("active", el.dataset.view === view);
    });
    document.querySelectorAll(".nav-btn").forEach(function (btn) {
      var on = btn.dataset.view === view;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });

    var titles = {
      home: ["Media Shelf", "Your watch list"],
      watch: ["Watching", "Shows & episodes"],
      read: ["Reading", "Books & manga"],
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
    if (!document.querySelector(".overlay.open")) {
      document.body.style.overflow = "";
    }
  }

  function closeAllOverlays() {
    document.querySelectorAll(".overlay.open").forEach(function (el) {
      el.classList.remove("open");
    });
    document.body.style.overflow = "";
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
      status: "watching",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (ui.editingShowId) {
      var existing = getShow(ui.editingShowId);
      if (existing) {
        payload.lastWatchedAt = existing.lastWatchedAt;
        payload.watchingSeason = existing.watchingSeason;
        payload.watchingEpisode = existing.watchingEpisode;
        payload.status = existing.status;
        payload.createdAt = existing.createdAt;
        payload.subscriptionId = document.getElementById("showSubscription").value || existing.subscriptionId || null;
        var editedEpisode = payload.episode;
        var editedSeason = payload.season;
        if (existing.watchingEpisode > 0) {
          var watchingAhead =
            editedSeason > existing.watchingSeason ||
            (editedSeason === existing.watchingSeason && editedEpisode >= existing.watchingEpisode);
          if (watchingAhead) {
            payload.watchingSeason = null;
            payload.watchingEpisode = null;
          }
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

  function syncShowDetailActions(show) {
    var watching = isWatchingEpisode(show);
    var next = getNextEpisode(show);
    document.getElementById("showWatchingNow").hidden = !watching;
    if (watching) {
      document.getElementById("showWatchingEpisode").textContent =
        "Currently watching: " + epShort(show.watchingSeason, show.watchingEpisode);
    }

    var lastLog = document.getElementById("showLastLog");
    if (show.episode > 0) {
      lastLog.hidden = false;
      document.getElementById("showLastLogEpisode").textContent = "Last finished: " + lastFinishedLabel(show);
      document.getElementById("showLastLogWhen").textContent = show.lastWatchedAt
        ? formatDateTime(show.lastWatchedAt) + " · " + formatRelative(show.lastWatchedAt)
        : "Not logged yet";
    } else {
      lastLog.hidden = true;
    }

    document.getElementById("logSeason").value = String(watching ? show.watchingSeason : next.season);
    document.getElementById("logEpisode").value = String(watching ? show.watchingEpisode : next.episode);
    document.getElementById("logWatchedAt").value = toDatetimeLocalValue(new Date());

    document.getElementById("showLogSectionLabel").textContent = watching
      ? "Finish this episode"
      : "Start or finish an episode";
    document.getElementById("logEpisodeLabel").textContent = watching ? "Episode to finish" : "Episode";
    document.getElementById("logWatchedAtField").hidden = false;
    document.getElementById("startWatchingBtn").hidden = watching || show.status === "completed";
    document.getElementById("logFinishedBtn").hidden = watching || show.status === "completed";
    document.getElementById("finishEpisodeBtn").hidden = !watching || show.status === "completed";
    document.getElementById("stopWatchingBtn").hidden = !watching || show.status === "completed";
  }

  function openShowDetail(id) {
    var show = getShow(id);
    if (!show) return;
    ui.detailShowId = id;
    document.getElementById("showDetailTitle").textContent = show.title;
    var badge = document.getElementById("showDetailBadge");
    badge.textContent = show.status === "completed" ? "Done" : show.type === "airing" ? "Airing" : "Binge";
    badge.className = "badge " + (show.status === "completed" ? "completed" : show.type === "airing" ? "airing" : "binge");

    syncShowDetailActions(show);

    var schedBlock = document.getElementById("showDetailSchedule");
    if (show.type === "airing") {
      schedBlock.hidden = false;
      document.getElementById("showDetailScheduleText").innerHTML =
        '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>' +
        escapeHtml(formatSchedule(show));
      var next = getNextAirDate(show);
      var catchUpHint = "";
      if (!isCaughtUp(show) && !isWatchingEpisode(show)) {
        catchUpHint = " Behind schedule — start the next episode when you're ready to catch up.";
      } else if (isWatchingEpisode(show)) {
        catchUpHint = " You're catching up — finish when this episode is done.";
      }
      document.getElementById("showDetailNextAir").textContent = next
        ? "Next episode airs: " + formatDateTime(next.toISOString()) + catchUpHint
        : show.schedule.length ? "No upcoming slot in the next 3 weeks" + catchUpHint : "Set release days in Edit";
    } else {
      schedBlock.hidden = true;
    }

    document.getElementById("showMarkCompleteBtn").hidden = show.status === "completed";
    openOverlay("showDetailOverlay");
  }

  function startWatchingEpisode() {
    var show = getShow(ui.detailShowId);
    if (!show) return;
    var season = parseInt(document.getElementById("logSeason").value, 10) || 1;
    var episode = parseInt(document.getElementById("logEpisode").value, 10) || 1;
    if (episode < 1) {
      showToast("Enter an episode number");
      return;
    }
    show.watchingSeason = season;
    show.watchingEpisode = episode;
    show.status = "watching";
    show.updatedAt = new Date().toISOString();
    syncShowDetailActions(show);
    save();
    showToast("Watching " + epShort(season, episode));
  }

  function finishEpisode() {
    var show = getShow(ui.detailShowId);
    if (!show) return;
    var season = parseInt(document.getElementById("logSeason").value, 10) || 1;
    var episode = parseInt(document.getElementById("logEpisode").value, 10) || 0;
    if (episode < 1) {
      showToast("Enter an episode number");
      return;
    }
    var watchedAt = fromDatetimeLocalValue(document.getElementById("logWatchedAt").value) || new Date().toISOString();

    show.season = season;
    show.episode = episode;
    show.lastWatchedAt = watchedAt;
    show.watchingSeason = null;
    show.watchingEpisode = null;
    show.status = "watching";
    show.updatedAt = new Date().toISOString();

    if (show.totalEpisodes && episode >= show.totalEpisodes) {
      show.status = "completed";
      closeOverlay("showDetailOverlay");
      save();
      showToast("Finished · show completed!");
      return;
    }
    syncShowDetailActions(show);
    save();
    showToast("Finished " + epShort(season, episode));
  }

  function stopWatchingEpisode() {
    var show = getShow(ui.detailShowId);
    if (!show || !isWatchingEpisode(show)) return;
    show.watchingSeason = null;
    show.watchingEpisode = null;
    show.updatedAt = new Date().toISOString();
    syncShowDetailActions(show);
    save();
    showToast("Stopped watching");
  }

  function quickLogEpisode(showId) {
    var show = getShow(showId);
    if (!show) return;
    if (isWatchingEpisode(show)) {
      show.season = show.watchingSeason;
      show.episode = show.watchingEpisode;
      show.lastWatchedAt = new Date().toISOString();
      show.watchingSeason = null;
      show.watchingEpisode = null;
      show.status = "watching";
      show.updatedAt = new Date().toISOString();
      if (show.totalEpisodes && show.episode >= show.totalEpisodes) {
        show.status = "completed";
        save();
        showToast("Finished · show completed!");
        return;
      }
      save();
      showToast("Finished " + epShort(show.season, show.episode));
      return;
    }
    var next = getNextEpisode(show);
    show.watchingSeason = next.season;
    show.watchingEpisode = next.episode;
    show.status = "watching";
    show.updatedAt = new Date().toISOString();
    save();
    showToast("Watching " + epShort(next.season, next.episode));
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
      status: "reading",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (ui.editingBookId) {
      var existing = getBook(ui.editingBookId);
      if (existing) {
        payload.lastReadAt = existing.lastReadAt;
        payload.status = existing.status;
        payload.createdAt = existing.createdAt;
      }
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

  function openBookDetail(id) {
    var book = getBook(id);
    if (!book) return;
    ui.detailBookId = id;
    document.getElementById("bookDetailTitle").textContent = book.title;
    var badge = document.getElementById("bookDetailBadge");
    badge.textContent = book.status === "completed" ? "Done" : book.type.charAt(0).toUpperCase() + book.type.slice(1);
    badge.className = "badge " + (book.status === "completed" ? "completed" : "binge");

    var lastLog = document.getElementById("bookLastLog");
    if (book.lastReadAt && (book.chapter > 0 || book.page > 0)) {
      lastLog.hidden = false;
      document.getElementById("bookLastLogProgress").textContent = "Last: " + bookProgressLabel(book);
      document.getElementById("bookLastLogWhen").textContent = formatDateTime(book.lastReadAt) + " · " + formatRelative(book.lastReadAt);
    } else {
      lastLog.hidden = true;
    }

    document.getElementById("logBookChapter").value = String(book.chapter > 0 ? book.chapter + 1 : 1);
    document.getElementById("logBookPage").value = String(book.page);
    document.getElementById("logReadAt").value = toDatetimeLocalValue(new Date());
    document.getElementById("bookMarkCompleteBtn").hidden = book.status === "completed";
    openOverlay("bookDetailOverlay");
  }

  function logRead() {
    var book = getBook(ui.detailBookId);
    if (!book) return;
    var chapter = parseInt(document.getElementById("logBookChapter").value, 10) || 0;
    var page = parseInt(document.getElementById("logBookPage").value, 10) || 0;
    var readAt = fromDatetimeLocalValue(document.getElementById("logReadAt").value) || new Date().toISOString();

    book.chapter = chapter;
    book.page = page;
    book.lastReadAt = readAt;
    book.status = "reading";
    book.updatedAt = new Date().toISOString();

    var done = false;
    if (book.totalChapters && chapter >= book.totalChapters) done = true;
    if (book.totalPages && page >= book.totalPages) done = true;
    if (done) {
      book.status = "completed";
      showToast("Logged · finished!");
    } else {
      showToast("Progress saved");
    }
    closeOverlay("bookDetailOverlay");
    save();
  }

  function populateReminderShowSelect() {
    var sel = document.getElementById("reminderLinkShow");
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
    if (ui.view === "read") {
      openBookForm(null);
      return;
    }
    if (ui.view === "watch") {
      openShowForm(null);
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
      openShowForm(null);
    });
    document.getElementById("addBookBtn").addEventListener("click", function () {
      closeOverlay("addPickerOverlay");
      openBookForm(null);
    });
    document.getElementById("addReminderBtn").addEventListener("click", function () {
      closeOverlay("addPickerOverlay");
      openReminderForm(null);
    });
    document.getElementById("addPickerCancel").addEventListener("click", function () {
      closeOverlay("addPickerOverlay");
    });

    document.querySelectorAll("#watchFilters .chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        ui.watchFilter = chip.dataset.filter;
        document.querySelectorAll("#watchFilters .chip").forEach(function (c) {
          c.classList.toggle("active", c === chip);
        });
        render();
      });
    });

    document.querySelectorAll("#readFilters .chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        ui.readFilter = chip.dataset.filter;
        document.querySelectorAll("#readFilters .chip").forEach(function (c) {
          c.classList.toggle("active", c === chip);
        });
        render();
      });
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

    document.getElementById("showDetailClose").addEventListener("click", function () {
      closeOverlay("showDetailOverlay");
    });
    document.getElementById("startWatchingBtn").addEventListener("click", startWatchingEpisode);
    document.getElementById("logFinishedBtn").addEventListener("click", function () {
      finishEpisode();
      closeOverlay("showDetailOverlay");
    });
    document.getElementById("finishEpisodeBtn").addEventListener("click", finishEpisode);
    document.getElementById("stopWatchingBtn").addEventListener("click", stopWatchingEpisode);
    document.getElementById("showEditBtn").addEventListener("click", function () {
      var show = getShow(ui.detailShowId);
      closeOverlay("showDetailOverlay");
      if (show) openShowForm(show);
    });
    document.getElementById("showMarkCompleteBtn").addEventListener("click", function () {
      var show = getShow(ui.detailShowId);
      if (!show) return;
      show.status = "completed";
      show.watchingSeason = null;
      show.watchingEpisode = null;
      show.updatedAt = new Date().toISOString();
      closeOverlay("showDetailOverlay");
      save();
      showToast("Marked completed");
    });
    document.getElementById("showDeleteBtn").addEventListener("click", function () {
      if (!confirm("Delete this show?")) return;
      state.shows = state.shows.filter(function (s) { return s.id !== ui.detailShowId; });
      closeOverlay("showDetailOverlay");
      save();
      showToast("Deleted");
    });

    document.getElementById("bookFormCancel").addEventListener("click", function () {
      closeOverlay("bookFormOverlay");
    });
    document.getElementById("bookFormSave").addEventListener("click", saveBookForm);

    document.getElementById("bookDetailClose").addEventListener("click", function () {
      closeOverlay("bookDetailOverlay");
    });
    document.getElementById("logReadBtn").addEventListener("click", logRead);
    document.getElementById("bookEditBtn").addEventListener("click", function () {
      var book = getBook(ui.detailBookId);
      closeOverlay("bookDetailOverlay");
      if (book) openBookForm(book);
    });
    document.getElementById("bookMarkCompleteBtn").addEventListener("click", function () {
      var book = getBook(ui.detailBookId);
      if (!book) return;
      book.status = "completed";
      book.updatedAt = new Date().toISOString();
      closeOverlay("bookDetailOverlay");
      save();
      showToast("Marked completed");
    });
    document.getElementById("bookDeleteBtn").addEventListener("click", function () {
      if (!confirm("Delete this item?")) return;
      state.books = state.books.filter(function (b) { return b.id !== ui.detailBookId; });
      closeOverlay("bookDetailOverlay");
      save();
      showToast("Deleted");
    });

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
      var quickLog = e.target.closest("[data-quick-log-show]");
      if (quickLog) {
        e.preventDefault();
        e.stopPropagation();
        quickLogEpisode(quickLog.dataset.quickLogShow);
        return;
      }
      var subBtn = e.target.closest("[data-subscription-id]");
      if (subBtn && !subBtn.closest(".overlay")) {
        var sub = getSubscription(subBtn.dataset.subscriptionId);
        if (sub) openSubscriptionForm(sub);
        return;
      }
      var showBtn = e.target.closest("[data-show-id]");
      if (showBtn && !showBtn.closest(".overlay") && !e.target.closest(".reminder-row")) {
        openShowDetail(showBtn.dataset.showId);
        return;
      }
      var showBtnInReminder = e.target.closest(".reminder-card[data-show-id]");
      if (showBtnInReminder) {
        openShowDetail(showBtnInReminder.dataset.showId);
        return;
      }
      var bookBtn = e.target.closest("[data-book-id]");
      if (bookBtn && !bookBtn.closest(".overlay")) {
        openBookDetail(bookBtn.dataset.bookId);
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
})();
