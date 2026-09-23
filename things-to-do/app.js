(function () {
  "use strict";

  var STORAGE_KEY = "things-to-do-v1";
  var APP_ID = "things-to-do";
  var EXPORT_FORMAT = "things-to-do-data";
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  var seedEvents = [];
  var seedLoaded = false;
  var state = loadData();
  var editingId = null;
  var openMonths = {};
  var openWeeks = {};
  var searchQuery = "";
  var toastTimer = null;
  var els = {};

  function uid() {
    return "evt-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function todayKey() {
    return localDateKey(new Date());
  }

  function localDateKey(date) {
    var y = date.getFullYear();
    var m = String(date.getMonth() + 1).padStart(2, "0");
    var d = String(date.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + d;
  }

  function parseDate(key) {
    var parts = String(key || "").split("-");
    if (parts.length !== 3) return null;
    var date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return isNaN(date.getTime()) ? null : date;
  }

  function startOfWeek(date) {
    var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    d.setDate(d.getDate() - d.getDay());
    return d;
  }

  function addDays(date, n) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
  }

  function weekKey(date) {
    return localDateKey(startOfWeek(date));
  }

  function monthKey(date) {
    return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0");
  }

  function currentWeekKey() {
    return weekKey(new Date());
  }

  function currentMonthKey() {
    return monthKey(new Date());
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function defaultData() {
    return { version: 1, events: [], overrides: {}, hiddenSeedIds: [] };
  }

  function loadData() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultData();
      var parsed = JSON.parse(raw);
      return normalizeData(parsed);
    } catch (e) {
      return defaultData();
    }
  }

  function saveData(next) {
    if (next) state = normalizeData(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      toast("Could not save");
    }
  }

  function normalizeLocation(loc) {
    if (!loc) return null;
    if (typeof loc === "string") {
      var text = loc.trim();
      if (!text) return null;
      return { name: text, address: text };
    }
    var name = String(loc.name || "").trim();
    var address = String(loc.address || "").trim();
    if (!name && !address) return null;
    return { name: name || address, address: address || name };
  }

  function normalizeEvent(event, fallbackSource) {
    if (!event || !event.title || !event.startDate) return null;
    var startDate = String(event.startDate).slice(0, 10);
    var endDate = String(event.endDate || event.startDate).slice(0, 10);
    if (endDate < startDate) endDate = startDate;
    var locations = [];
    (event.locations || []).forEach(function (loc) {
      var clean = normalizeLocation(loc);
      if (clean) locations.push(clean);
    });
    return {
      id: event.id || uid(),
      title: String(event.title).trim().slice(0, 120),
      startDate: startDate,
      endDate: endDate,
      startTime: event.startTime ? String(event.startTime).slice(0, 5) : "",
      endTime: event.endTime ? String(event.endTime).slice(0, 5) : "",
      hours: String(event.hours || "").trim().slice(0, 160),
      description: String(event.description || "").trim().slice(0, 500),
      url: String(event.url || "").trim(),
      locations: locations,
      source: event.source || fallbackSource || "user",
      createdAt: event.createdAt || nowIso(),
      updatedAt: event.updatedAt || event.createdAt || nowIso()
    };
  }

  function normalizeData(raw) {
    var data = defaultData();
    if (!raw || typeof raw !== "object") return data;
    data.version = 1;
    var seen = {};
    (raw.events || []).forEach(function (event) {
      var clean = normalizeEvent(event, "user");
      if (!clean || seen[clean.id]) return;
      seen[clean.id] = true;
      data.events.push(clean);
    });
    Object.keys(raw.overrides || {}).forEach(function (id) {
      var clean = normalizeEvent(Object.assign({ id: id, title: (raw.overrides[id] && raw.overrides[id].title) || "Event", startDate: (raw.overrides[id] && raw.overrides[id].startDate) || todayKey() }, raw.overrides[id]), "seed");
      if (clean) data.overrides[id] = clean;
    });
    var hidden = {};
    (raw.hiddenSeedIds || []).forEach(function (id) {
      if (!id || hidden[id]) return;
      hidden[id] = true;
      data.hiddenSeedIds.push(String(id));
    });
    return data;
  }

  function mergeSeedIntoData(data, seeds) {
    data = normalizeData(data);
    var hidden = {};
    data.hiddenSeedIds.forEach(function (id) { hidden[id] = true; });
    var have = {};
    data.events.forEach(function (event) { have[event.id] = true; });
    seeds.forEach(function (seed) {
      var clean = normalizeEvent(Object.assign({}, seed, { source: "seed" }), "seed");
      if (!clean || hidden[clean.id] || have[clean.id]) return;
      data.events.push(clean);
      have[clean.id] = true;
    });
    return data;
  }

  function visibleEvents() {
    var hidden = {};
    state.hiddenSeedIds.forEach(function (id) { hidden[id] = true; });
    var query = searchQuery.trim().toLowerCase();
    return state.events.filter(function (event) {
      if (!event || hidden[event.id]) return false;
      var merged = applyOverride(event);
      if (!query) return true;
      var hay = [merged.title, merged.description, merged.hours, merged.url].concat(
        (merged.locations || []).map(function (loc) { return loc.name + " " + loc.address; })
      ).join(" ").toLowerCase();
      return hay.indexOf(query) !== -1;
    }).map(applyOverride);
  }

  function applyOverride(event) {
    var over = state.overrides[event.id];
    if (!over) return event;
    return Object.assign({}, event, over, { id: event.id, source: event.source });
  }

  function eachDate(startKey, endKey, fn) {
    var start = parseDate(startKey);
    var end = parseDate(endKey) || start;
    if (!start) return;
    var cursor = start;
    var guard = 0;
    while (cursor <= end && guard < 120) {
      fn(cursor);
      cursor = addDays(cursor, 1);
      guard += 1;
    }
  }

  function formatRange(startKey, endKey) {
    var start = parseDate(startKey);
    var end = parseDate(endKey);
    if (!start) return "";
    if (!end || startKey === endKey) {
      return MONTHS_SHORT[start.getMonth()] + " " + start.getDate();
    }
    if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
      return MONTHS_SHORT[start.getMonth()] + " " + start.getDate() + "–" + end.getDate();
    }
    return MONTHS_SHORT[start.getMonth()] + " " + start.getDate() + " – " + MONTHS_SHORT[end.getMonth()] + " " + end.getDate();
  }

  function formatWeekLabel(sundayKey) {
    var start = parseDate(sundayKey);
    var end = addDays(start, 6);
    return formatRange(localDateKey(start), localDateKey(end));
  }

  function formatTime(value) {
    if (!value) return "";
    var parts = String(value).split(":");
    var h = Number(parts[0]);
    var m = parts[1] || "00";
    if (!isFinite(h)) return value;
    var suffix = h >= 12 ? "pm" : "am";
    var hour = h % 12;
    if (!hour) hour = 12;
    return m === "00" ? hour + suffix : hour + ":" + m + suffix;
  }

  function formatWhen(event) {
    var range = formatRange(event.startDate, event.endDate);
    if (event.hours) return range + " · " + event.hours;
    var start = formatTime(event.startTime);
    var end = formatTime(event.endTime);
    if (start && end) return range + " · " + start + "–" + end;
    if (start) return range + " · " + start;
    return range;
  }

  function mapsUrl(loc) {
    var q = (loc.address && loc.address !== loc.name) ? loc.name + ", " + loc.address : (loc.address || loc.name);
    return "https://maps.apple.com/?q=" + encodeURIComponent(q);
  }

  function isPast(event) {
    return event.endDate < todayKey();
  }

  function groupCabinet(events) {
    var months = {};
    events.forEach(function (event) {
      var monthSeen = {};
      var weekSeen = {};
      eachDate(event.startDate, event.endDate, function (date) {
        var mk = monthKey(date);
        var wk = weekKey(date);
        if (!months[mk]) months[mk] = { key: mk, date: new Date(date.getFullYear(), date.getMonth(), 1), weeks: {} };
        if (!monthSeen[mk]) {
          monthSeen[mk] = true;
          months[mk].count = (months[mk].count || 0) + 1;
        }
        if (!months[mk].weeks[wk]) months[mk].weeks[wk] = { key: wk, events: [], ids: {} };
        if (!weekSeen[wk]) {
          weekSeen[wk] = true;
          months[mk].weeks[wk].events.push(event);
        }
      });
    });
    return Object.keys(months).sort().map(function (mk) {
      var month = months[mk];
      month.weekList = Object.keys(month.weeks).sort().map(function (wk) { return month.weeks[wk]; });
      return month;
    });
  }

  function ensureOpenDefaults(months) {
    var curMonth = currentMonthKey();
    var curWeek = currentWeekKey();
    if (!Object.keys(openMonths).length) {
      months.forEach(function (month) {
        if (month.key === curMonth || month.weekList.some(function (week) { return week.key === curWeek; })) {
          openMonths[month.key] = true;
        }
      });
    }
    if (!Object.keys(openWeeks).length) {
      openWeeks[curWeek] = true;
    }
    if (searchQuery.trim()) {
      months.forEach(function (month) {
        openMonths[month.key] = true;
        month.weekList.forEach(function (week) { openWeeks[week.key] = true; });
      });
    }
  }

  function render() {
    var events = visibleEvents().sort(function (a, b) {
      if (a.startDate !== b.startDate) return a.startDate < b.startDate ? -1 : 1;
      return (a.startTime || "").localeCompare(b.startTime || "");
    });
    var months = groupCabinet(events);
    ensureOpenDefaults(months);
    els.headerSub.textContent = events.length ? events.length + " filed things" : "The file cabinet";
    els.emptyState.hidden = months.length > 0;
    els.cabinet.hidden = months.length === 0;
    els.cabinet.innerHTML = months.map(renderMonth).join("");
  }

  function renderMonth(month) {
    var open = !!openMonths[month.key];
    var current = month.key === currentMonthKey();
    var label = MONTHS[month.date.getMonth()] + " " + month.date.getFullYear();
    return (
      '<section class="month-drawer" data-month="' + escapeHtml(month.key) + '">' +
        '<button type="button" class="drawer-face' + (open ? " open" : "") + (current ? " current" : "") + '" data-toggle-month="' + escapeHtml(month.key) + '">' +
          '<span class="brass-plate">' + escapeHtml(MONTHS_SHORT[month.date.getMonth()]) + "</span>" +
          '<span class="drawer-label"><span class="name">' + escapeHtml(label) + '</span><span class="meta">' + month.count + " thing" + (month.count === 1 ? "" : "s") + "</span></span>" +
          '<svg class="drawer-chevron" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>' +
        "</button>" +
        '<div class="drawer-body' + (open ? " open" : "") + '">' +
          month.weekList.map(renderWeek).join("") +
        "</div>" +
      "</section>"
    );
  }

  function renderWeek(week) {
    var open = !!openWeeks[week.key];
    var current = week.key === currentWeekKey();
    return (
      '<div class="week-folder" data-week="' + escapeHtml(week.key) + '">' +
        '<button type="button" class="folder-tab' + (open ? " open" : "") + (current ? " current" : "") + '" data-toggle-week="' + escapeHtml(week.key) + '">' +
          '<span><span class="week-name">Week of ' + escapeHtml(formatWeekLabel(week.key)) + (current ? '<span class="this-week">This week</span>' : "") + '</span></span>' +
          '<span class="week-meta">' + week.events.length + "</span>" +
        "</button>" +
        '<div class="folder-body' + (open ? " open" : "") + '">' +
          week.events.map(renderEvent).join("") +
        "</div>" +
      "</div>"
    );
  }

  function renderEvent(event) {
    var locs = (event.locations || []).map(function (loc) {
      return (
        '<a class="loc-link" href="' + escapeHtml(mapsUrl(loc)) + '" target="_blank" rel="noopener noreferrer">' +
          '<span class="loc-name">' + escapeHtml(loc.name) + "</span>" +
          (loc.address && loc.address !== loc.name ? '<span class="loc-address">' + escapeHtml(loc.address) + "</span>" : "") +
        "</a>"
      );
    }).join("");
    var link = event.url
      ? '<a class="event-link" href="' + escapeHtml(event.url) + '" target="_blank" rel="noopener noreferrer">Event homepage →</a>'
      : "";
    return (
      '<article class="event-card' + (isPast(event) ? " past" : "") + '" data-event-id="' + escapeHtml(event.id) + '">' +
        '<div class="event-top">' +
          "<h3 class=\"event-title\">" + escapeHtml(event.title) + "</h3>" +
          '<button type="button" class="edit-event" data-edit="' + escapeHtml(event.id) + '" aria-label="Edit">' +
            '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>' +
          "</button>" +
        "</div>" +
        '<p class="event-when">' + escapeHtml(formatWhen(event)) + "</p>" +
        (event.description ? '<p class="event-desc">' + escapeHtml(event.description) + "</p>" : "") +
        (locs ? '<div class="event-locations">' + locs + "</div>" : "") +
        link +
      "</article>"
    );
  }

  function toast(message) {
    els.toast.textContent = message;
    els.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.toast.classList.remove("show"); }, 2200);
  }

  function locationRowHtml(loc) {
    loc = loc || { name: "", address: "" };
    return (
      '<div class="location-row">' +
        '<input type="text" class="loc-name-input" placeholder="Place name" value="' + escapeHtml(loc.name || "") + '" />' +
        '<input type="text" class="loc-address-input" placeholder="Address" value="' + escapeHtml(loc.address || "") + '" />' +
        '<button type="button" class="remove-loc">Remove location</button>' +
      "</div>"
    );
  }

  function addLocationRow(loc) {
    els.locationRows.insertAdjacentHTML("beforeend", locationRowHtml(loc));
  }

  function readLocations() {
    return Array.prototype.map.call(els.locationRows.querySelectorAll(".location-row"), function (row) {
      return normalizeLocation({
        name: row.querySelector(".loc-name-input").value,
        address: row.querySelector(".loc-address-input").value
      });
    }).filter(Boolean);
  }

  function openEventSheet(event) {
    editingId = event ? event.id : null;
    els.eventSheetTitle.textContent = event ? "Edit thing" : "File a thing";
    els.titleInput.value = event ? event.title : "";
    els.startDateInput.value = event ? event.startDate : todayKey();
    els.endDateInput.value = event ? event.endDate : "";
    els.startTimeInput.value = event ? event.startTime : "";
    els.endTimeInput.value = event ? event.endTime : "";
    els.hoursInput.value = event ? event.hours : "";
    els.descInput.value = event ? event.description : "";
    els.urlInput.value = event ? event.url : "";
    els.locationRows.innerHTML = "";
    var locs = event && event.locations && event.locations.length ? event.locations : [{ name: "", address: "" }];
    locs.forEach(addLocationRow);
    els.deleteEventBtn.hidden = !event;
    els.eventSheetOverlay.hidden = false;
    setTimeout(function () { els.titleInput.focus(); }, 50);
  }

  function closeEventSheet() {
    els.eventSheetOverlay.hidden = true;
    editingId = null;
  }

  function findEvent(id) {
    for (var i = 0; i < state.events.length; i++) {
      if (state.events[i].id === id) return applyOverride(state.events[i]);
    }
    return null;
  }

  function saveEventFromForm(e) {
    e.preventDefault();
    var title = els.titleInput.value.trim();
    var startDate = els.startDateInput.value;
    if (!title || !startDate) {
      toast("Need a name and start date");
      return;
    }
    var payload = {
      title: title,
      startDate: startDate,
      endDate: els.endDateInput.value || startDate,
      startTime: els.startTimeInput.value,
      endTime: els.endTimeInput.value,
      hours: els.hoursInput.value,
      description: els.descInput.value,
      url: els.urlInput.value,
      locations: readLocations(),
      updatedAt: nowIso()
    };
    if (editingId) {
      var existing = null;
      state.events.forEach(function (event) { if (event.id === editingId) existing = event; });
      if (existing && existing.source === "seed") {
        state.overrides[editingId] = normalizeEvent(Object.assign({}, existing, payload, { id: editingId }), "seed");
      } else if (existing) {
        Object.assign(existing, normalizeEvent(Object.assign({}, existing, payload), "user"));
      }
      toast("Updated");
    } else {
      var created = normalizeEvent(Object.assign({}, payload, { id: uid(), source: "user", createdAt: nowIso() }), "user");
      state.events.push(created);
      openMonths[created.startDate.slice(0, 7)] = true;
      var start = parseDate(created.startDate);
      if (start) openWeeks[weekKey(start)] = true;
      toast("Filed");
    }
    saveData();
    closeEventSheet();
    render();
  }

  function deleteEditing() {
    if (!editingId) return;
    var existing = null;
    state.events.forEach(function (event) { if (event.id === editingId) existing = event; });
    if (!existing) return;
    if (!window.confirm("Remove “" + existing.title + "” from the cabinet?")) return;
    if (existing.source === "seed" && state.hiddenSeedIds.indexOf(existing.id) === -1) {
      state.hiddenSeedIds.push(existing.id);
    }
    state.events = state.events.filter(function (event) { return event.id !== editingId; });
    delete state.overrides[editingId];
    saveData();
    closeEventSheet();
    render();
    toast("Removed");
  }

  function jumpToThisWeek() {
    searchQuery = "";
    els.searchInput.value = "";
    openMonths = {};
    openWeeks = {};
    openMonths[currentMonthKey()] = true;
    openWeeks[currentWeekKey()] = true;
    render();
    var node = els.cabinet.querySelector('[data-week="' + currentWeekKey() + '"]');
    if (node) node.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function exportJson() {
    saveData();
    var payload = {
      format: EXPORT_FORMAT,
      exportedAt: nowIso(),
      data: normalizeData(state)
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "things-to-do-" + todayKey() + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast("Exported");
  }

  function extractImportData(parsed) {
    if (typeof AppsBackup !== "undefined" && AppsBackup.isUnifiedBackup(parsed)) {
      return AppsBackup.getAppSlice(parsed, APP_ID);
    }
    if (parsed && parsed.format === EXPORT_FORMAT && parsed.data) return parsed.data;
    return parsed;
  }

  function mergeData(existing, incoming) {
    existing = normalizeData(existing);
    incoming = normalizeData(incoming);
    var out = {
      version: 1,
      events: existing.events.slice(),
      overrides: Object.assign({}, existing.overrides),
      hiddenSeedIds: existing.hiddenSeedIds.slice()
    };
    var ids = {};
    out.events.forEach(function (event) { ids[event.id] = event; });
    incoming.events.forEach(function (event) {
      if (ids[event.id]) {
        if (new Date(event.updatedAt) > new Date(ids[event.id].updatedAt)) Object.assign(ids[event.id], event);
        return;
      }
      out.events.push(event);
      ids[event.id] = event;
    });
    Object.keys(incoming.overrides || {}).forEach(function (id) {
      var cur = out.overrides[id];
      var next = incoming.overrides[id];
      if (!cur || new Date(next.updatedAt) > new Date(cur.updatedAt)) out.overrides[id] = next;
    });
    var hidden = {};
    out.hiddenSeedIds.forEach(function (id) { hidden[id] = true; });
    incoming.hiddenSeedIds.forEach(function (id) {
      if (!hidden[id]) {
        out.hiddenSeedIds.push(id);
        hidden[id] = true;
      }
    });
    return normalizeData(out);
  }

  function importJsonFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onerror = function () { toast("Could not read file"); };
    reader.onload = function () {
      try {
        var parsed = JSON.parse(reader.result);
        var slice = extractImportData(parsed);
        if (!slice) {
          toast("No Things To Do data in file");
          return;
        }
        state = mergeData(state, slice);
        if (seedEvents.length) state = mergeSeedIntoData(state, seedEvents);
        saveData();
        render();
        toast("Imported");
      } catch (e) {
        toast("Invalid JSON");
      } finally {
        els.importJsonFile.value = "";
      }
    };
    reader.readAsText(file);
  }

  function loadSeed() {
    return fetch("events.json?v=1")
      .then(function (res) { return res.ok ? res.json() : []; })
      .catch(function () { return []; })
      .then(function (list) {
        seedEvents = Array.isArray(list) ? list : [];
        seedLoaded = true;
        if (!seedEvents.length) return;
        state = mergeSeedIntoData(state, seedEvents);
        saveData();
        render();
      });
  }

  function cacheElements() {
    [
      "headerSub", "jumpWeekBtn", "addBtn", "settingsBtn", "searchInput", "cabinet", "emptyState",
      "eventSheetOverlay", "eventSheetTitle", "eventForm", "titleInput", "startDateInput", "endDateInput",
      "startTimeInput", "endTimeInput", "hoursInput", "descInput", "urlInput", "locationRows",
      "addLocationBtn", "deleteEventBtn", "eventSheetCancel", "eventSheetSave",
      "settingsOverlay", "settingsCloseBtn", "exportJsonBtn", "importJsonFile", "toast"
    ].forEach(function (id) { els[id] = document.getElementById(id); });
  }

  function bindEvents() {
    els.addBtn.addEventListener("click", function () { openEventSheet(null); });
    els.jumpWeekBtn.addEventListener("click", jumpToThisWeek);
    els.settingsBtn.addEventListener("click", function () { els.settingsOverlay.hidden = false; });
    els.settingsCloseBtn.addEventListener("click", function () { els.settingsOverlay.hidden = true; });
    els.settingsOverlay.addEventListener("click", function (e) {
      if (e.target === els.settingsOverlay) els.settingsOverlay.hidden = true;
    });
    els.eventSheetCancel.addEventListener("click", closeEventSheet);
    els.eventSheetOverlay.addEventListener("click", function (e) {
      if (e.target === els.eventSheetOverlay) closeEventSheet();
    });
    els.eventForm.addEventListener("submit", saveEventFromForm);
    els.addLocationBtn.addEventListener("click", function () { addLocationRow(); });
    els.locationRows.addEventListener("click", function (e) {
      var btn = e.target.closest(".remove-loc");
      if (!btn) return;
      var rows = els.locationRows.querySelectorAll(".location-row");
      if (rows.length <= 1) {
        rows[0].querySelector(".loc-name-input").value = "";
        rows[0].querySelector(".loc-address-input").value = "";
        return;
      }
      btn.closest(".location-row").remove();
    });
    els.deleteEventBtn.addEventListener("click", deleteEditing);
    els.exportJsonBtn.addEventListener("click", exportJson);
    els.importJsonFile.addEventListener("change", function () {
      importJsonFile(els.importJsonFile.files && els.importJsonFile.files[0]);
    });
    els.searchInput.addEventListener("input", function () {
      searchQuery = els.searchInput.value;
      render();
    });
    els.cabinet.addEventListener("click", function (e) {
      var monthBtn = e.target.closest("[data-toggle-month]");
      if (monthBtn) {
        var mk = monthBtn.getAttribute("data-toggle-month");
        openMonths[mk] = !openMonths[mk];
        render();
        return;
      }
      var weekBtn = e.target.closest("[data-toggle-week]");
      if (weekBtn) {
        var wk = weekBtn.getAttribute("data-toggle-week");
        openWeeks[wk] = !openWeeks[wk];
        render();
        return;
      }
      var editBtn = e.target.closest("[data-edit]");
      if (editBtn) {
        var event = findEvent(editBtn.getAttribute("data-edit"));
        if (event) openEventSheet(event);
      }
    });
  }

  cacheElements();
  bindEvents();
  render();
  loadSeed();
})();
