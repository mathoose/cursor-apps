(function () {
  "use strict";

  var STORAGE_KEY = "media-shelf-v1";
  var DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var DAY_LABELS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  var state = {
    shows: [],
    books: [],
    reminders: [],
  };

  var ui = {
    view: "home",
    watchFilter: "all",
    readFilter: "all",
    editingShowId: null,
    editingBookId: null,
    editingReminderId: null,
    detailShowId: null,
    detailBookId: null,
    showType: "binge",
    bookType: "book",
    selectedDays: [],
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
    return { version: 1, shows: [], books: [], reminders: [] };
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
      status: ["watching", "paused", "completed", "planning"].indexOf(raw.status) >= 0 ? raw.status : "watching",
      schedule: schedule,
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
      version: 1,
      shows: (raw.shows || []).map(normalizeShow).filter(Boolean),
      books: (raw.books || []).map(normalizeBook).filter(Boolean),
      reminders: (raw.reminders || []).map(normalizeReminder).filter(Boolean),
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    render();
  }

  function getShow(id) {
    return state.shows.find(function (s) { return s.id === id; }) || null;
  }

  function getBook(id) {
    return state.books.find(function (b) { return b.id === id; }) || null;
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

  function episodeLabel(show) {
    if (!show) return "";
    var ep = "S" + show.season + " E" + show.episode;
    if (show.episode === 0) return "Not started";
    return ep;
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

  function collectReminders() {
    var items = [];
    var now = new Date();
    var weekEnd = addDays(startOfDay(now), 7);

    state.shows.forEach(function (show) {
      if (show.status !== "watching" || show.type !== "airing" || !show.schedule.length) return;
      var next = getNextAirDate(show, now);
      if (!next) return;
      items.push({
        id: "air-" + show.id + "-" + next.getTime(),
        kind: "episode",
        title: show.title,
        subtitle: "New episode · " + formatSchedule(show),
        at: next.toISOString(),
        showId: show.id,
        auto: true,
      });
    });

    state.reminders.forEach(function (r) {
      if (!r.enabled || !r.at) return;
      var show = r.showId ? getShow(r.showId) : null;
      items.push({
        id: r.id,
        kind: "custom",
        title: r.title,
        subtitle: r.notes || (show ? "Linked to " + show.title : ""),
        at: r.at,
        showId: r.showId,
        auto: false,
      });
    });

    items.sort(function (a, b) {
      return new Date(a.at) - new Date(b.at);
    });

    var week = [];
    var later = [];
    var todayCount = 0;

    items.forEach(function (item) {
      var d = parseDate(item.at);
      if (!d) return;
      if (isSameDay(d, now)) todayCount++;
      if (d < weekEnd) week.push(item);
      else later.push(item);
    });

    return { all: items, week: week, later: later, todayCount: todayCount };
  }

  function renderShowCard(show) {
    var pct = showProgressPercent(show);
    var badgeClass = show.status === "completed" ? "completed" : show.type === "airing" ? "airing" : "binge";
    var badgeText = show.status === "completed" ? "Done" : show.type === "airing" ? "Airing" : "Binge";
    var last = show.lastWatchedAt ? formatRelative(show.lastWatchedAt) : "Never logged";
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
    return (
      '<button type="button" class="media-card" data-show-id="' + escapeHtml(show.id) + '">' +
      '<div class="media-card-top"><h3>' + escapeHtml(show.title) + '</h3><span class="badge ' + badgeClass + '">' + badgeText + "</span></div>" +
      '<div class="media-meta"><span><strong>' + escapeHtml(episodeLabel(show)) + "</strong></span>" +
      '<span>Last: ' + escapeHtml(last) + "</span></div>" +
      progress + nextAir +
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

  function renderReminderCard(item) {
    var d = parseDate(item.at);
    var now = new Date();
    var cls = "reminder-card";
    if (d && d < now && !isSameDay(d, now)) cls += " past";
    else if (d && isSameDay(d, now)) cls += " today";
    var iconClass = item.kind === "episode" ? "episode" : "custom";
    var iconSvg = item.kind === "episode"
      ? '<svg viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M10 9.5l5 3-5 3V9.5z" fill="currentColor" stroke="none"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>';
    var whenLabel = d ? formatDateTime(item.at) : "No date";
    if (d && isSameDay(d, now)) whenLabel = "Today · " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    else if (d && isSameDay(d, addDays(now, 1))) whenLabel = "Tomorrow · " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

    var attrs = item.auto ? ' data-auto-reminder="1"' : ' data-reminder-id="' + escapeHtml(item.id) + '"';
    if (item.showId) attrs += ' data-show-id="' + escapeHtml(item.showId) + '"';

    return (
      '<button type="button" class="' + cls + '"' + attrs + ">" +
      '<div class="reminder-icon ' + iconClass + '">' + iconSvg + "</div>" +
      '<div class="reminder-body"><h4>' + escapeHtml(item.title) + "</h4>" +
      (item.subtitle ? "<p>" + escapeHtml(item.subtitle) + "</p>" : "") +
      '<div class="reminder-when">' + escapeHtml(whenLabel) + "</div></div></button>"
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
    var watching = state.shows.filter(function (s) { return s.status === "watching"; });
    var reading = state.books.filter(function (b) { return b.status === "reading"; });
    document.getElementById("homeWatchCount").textContent = String(watching.length);
    document.getElementById("homeReadCount").textContent = String(reading.length);

    var reminders = collectReminders();
    var upcoming = reminders.week.slice(0, 5);
    document.getElementById("homeUpcoming").innerHTML = upcoming.map(renderReminderCard).join("");
    document.getElementById("homeUpcomingEmpty").hidden = upcoming.length > 0;

    var continueWatch = state.shows
      .filter(function (s) { return s.status === "watching"; })
      .sort(function (a, b) { return new Date(b.lastWatchedAt || 0) - new Date(a.lastWatchedAt || 0); })
      .slice(0, 4);
    document.getElementById("homeContinueWatch").innerHTML = continueWatch.map(renderShowCard).join("");
    document.getElementById("homeWatchEmpty").hidden = continueWatch.length > 0;

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

    document.getElementById("remindersWeek").innerHTML = reminders.week.map(renderReminderCard).join("");
    document.getElementById("remindersWeekEmpty").hidden = reminders.week.length > 0;
    document.getElementById("remindersLater").innerHTML = reminders.later.map(renderReminderCard).join("");
    document.getElementById("remindersLaterEmpty").hidden = reminders.later.length > 0;

    var airingShows = state.shows.filter(function (s) {
      return s.type === "airing" && s.status !== "completed" && s.schedule.length;
    });
    document.getElementById("remindersSchedules").innerHTML = airingShows.map(function (show) {
      var next = getNextAirDate(show);
      return (
        '<button type="button" class="media-card" data-show-id="' + escapeHtml(show.id) + '">' +
        '<div class="media-card-top"><h3>' + escapeHtml(show.title) + '</h3><span class="badge airing">Airing</span></div>' +
        '<div class="schedule-pill"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>' +
        escapeHtml(formatSchedule(show)) + "</div>" +
        (next ? '<div class="media-meta" style="margin-top:8px"><span>Next drop: <strong>' + escapeHtml(formatDateTime(next.toISOString())) + "</strong></span></div>" : "") +
        "</button>"
      );
    }).join("");
    document.getElementById("remindersSchedulesEmpty").hidden = airingShows.length > 0;

    var badge = document.getElementById("reminderBadge");
    if (reminders.todayCount > 0) {
      badge.hidden = false;
      badge.textContent = reminders.todayCount > 9 ? "9+" : String(reminders.todayCount);
    } else {
      badge.hidden = true;
    }

    updateFabVisibility();
    populateReminderShowSelect();
  }

  function updateFabVisibility() {
    var fab = document.getElementById("fabBtn");
    fab.style.display = ui.view === "home" || ui.view === "watch" || ui.view === "read" || ui.view === "reminders" ? "flex" : "none";
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
      home: ["Media Shelf", "Reading & watching"],
      watch: ["Watching", "Shows & episodes"],
      read: ["Reading", "Books & manga"],
      reminders: ["Reminders", "Episodes & alerts"],
    };
    var t = titles[view] || titles.home;
    document.getElementById("headerTitle").textContent = t[0];
    document.getElementById("headerSubtitle").textContent = t[1];
    updateFabVisibility();
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
      notes: document.getElementById("showNotes").value.trim(),
      status: "watching",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (ui.editingShowId) {
      var existing = getShow(ui.editingShowId);
      if (existing) {
        payload.lastWatchedAt = existing.lastWatchedAt;
        payload.status = existing.status;
        payload.createdAt = existing.createdAt;
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

  function openShowDetail(id) {
    var show = getShow(id);
    if (!show) return;
    ui.detailShowId = id;
    document.getElementById("showDetailTitle").textContent = show.title;
    var badge = document.getElementById("showDetailBadge");
    badge.textContent = show.status === "completed" ? "Done" : show.type === "airing" ? "Airing" : "Binge";
    badge.className = "badge " + (show.status === "completed" ? "completed" : show.type === "airing" ? "airing" : "binge");

    var lastLog = document.getElementById("showLastLog");
    if (show.lastWatchedAt && show.episode > 0) {
      lastLog.hidden = false;
      document.getElementById("showLastLogEpisode").textContent = "Last watched: " + episodeLabel(show);
      document.getElementById("showLastLogWhen").textContent = formatDateTime(show.lastWatchedAt) + " · " + formatRelative(show.lastWatchedAt);
    } else {
      lastLog.hidden = true;
    }

    var schedBlock = document.getElementById("showDetailSchedule");
    if (show.type === "airing") {
      schedBlock.hidden = false;
      document.getElementById("showDetailScheduleText").innerHTML =
        '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>' +
        escapeHtml(formatSchedule(show));
      var next = getNextAirDate(show);
      document.getElementById("showDetailNextAir").textContent = next
        ? "Next episode: " + formatDateTime(next.toISOString())
        : show.schedule.length ? "No upcoming slot in the next 3 weeks" : "Set release days in Edit";
    } else {
      schedBlock.hidden = true;
    }

    document.getElementById("logSeason").value = String(show.season);
    var nextEp = show.episode + 1;
    document.getElementById("logEpisode").value = String(nextEp);
    document.getElementById("logWatchedAt").value = toDatetimeLocalValue(new Date());
    document.getElementById("showMarkCompleteBtn").hidden = show.status === "completed";
    openOverlay("showDetailOverlay");
  }

  function logEpisode() {
    var show = getShow(ui.detailShowId);
    if (!show) return;
    var season = parseInt(document.getElementById("logSeason").value, 10) || 1;
    var episode = parseInt(document.getElementById("logEpisode").value, 10) || 0;
    var watchedAt = fromDatetimeLocalValue(document.getElementById("logWatchedAt").value) || new Date().toISOString();

    show.season = season;
    show.episode = episode;
    show.lastWatchedAt = watchedAt;
    show.status = "watching";
    show.updatedAt = new Date().toISOString();

    if (show.totalEpisodes && episode >= show.totalEpisodes) {
      show.status = "completed";
      showToast("Logged · show completed!");
    } else {
      showToast("Logged S" + season + " E" + episode);
    }
    closeOverlay("showDetailOverlay");
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
    if (ui.view === "reminders") {
      openReminderForm(null);
      return;
    }
    if (ui.view === "read") {
      openBookForm(null);
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
    document.getElementById("logEpisodeBtn").addEventListener("click", logEpisode);
    document.getElementById("showEditBtn").addEventListener("click", function () {
      var show = getShow(ui.detailShowId);
      closeOverlay("showDetailOverlay");
      if (show) openShowForm(show);
    });
    document.getElementById("showMarkCompleteBtn").addEventListener("click", function () {
      var show = getShow(ui.detailShowId);
      if (!show) return;
      show.status = "completed";
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
      var showBtn = e.target.closest("[data-show-id]");
      if (showBtn && !showBtn.closest(".overlay")) {
        openShowDetail(showBtn.dataset.showId);
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
        return;
      }
      var autoRem = e.target.closest("[data-auto-reminder][data-show-id]");
      if (autoRem) {
        openShowDetail(autoRem.dataset.showId);
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
