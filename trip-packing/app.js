(function () {
  "use strict";

  var L = window.SharedListsLogic;
  var P = window.TripPackingLogic;
  var STORAGE_KEY = "trip-packing-v1";
  var POLL_MS = 2000;
  var CHECK_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>';

  var state = {
    view: "join",
    code: "",
    pin: "",
    pinMode: "enter",
    revision: 0,
    data: L.emptyData(),
    dirty: false,
    saving: false,
    saveAgain: false,
    status: "",
    tripId: "",
    pastMode: "new",
    pastTitle: "",
    pastSelected: {},
    sheet: null,
    pollTimer: 0,
    saveTimer: 0,
    busy: false,
  };

  function $(id) { return document.getElementById(id); }

  function config() {
    var c = window.SHARED_LISTS_CONFIG || {};
    var url = String(c.supabaseUrl || "").trim().replace(/\/$/, "");
    var key = String(c.supabaseAnonKey || "").trim();
    if (!url || !key) return null;
    return { url: url, key: key };
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function toast(msg) {
    var el = $("toast");
    el.hidden = false;
    el.textContent = msg;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.hidden = true; }, 2400);
  }

  function loadCache() {
    try {
      var parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "");
      if (!parsed || typeof parsed !== "object" || !parsed.rooms || typeof parsed.rooms !== "object") {
        return { version: 1, activeCode: "", rooms: {} };
      }
      parsed.version = 1;
      return parsed;
    } catch (e) {
      return { version: 1, activeCode: "", rooms: {} };
    }
  }

  function saveCache() {
    var cache = loadCache();
    cache.version = 1;
    if (state.code && state.pin) {
      cache.activeCode = state.code;
      cache.rooms[state.code] = {
        pin: state.pin,
        revision: state.revision || 0,
        data: L.normalizeData(state.data),
      };
    } else if (!state.code) {
      cache.activeCode = cache.activeCode || "";
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  }

  function formatWhen(iso) {
    var t = L.stamp(iso);
    if (!t) return "";
    try {
      return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    } catch (e) {
      return "";
    }
  }

  function inList() {
    return state.view === "trips" || state.view === "trip" || state.view === "past";
  }

  function show(view) {
    var changed = state.view !== view;
    state.view = view;
    ["viewSetup", "viewJoin", "viewPin", "viewTrips", "viewTrip", "viewPast"].forEach(function (id) {
      $(id).hidden = true;
    });
    var map = {
      setup: "viewSetup",
      join: "viewJoin",
      pin: "viewPin",
      trips: "viewTrips",
      trip: "viewTrip",
      past: "viewPast",
    };
    $(map[view]).hidden = false;
    $("codesBtn").hidden = !inList();
    var sub = "Trip lists & past packed";
    if (view === "trips" && state.code) sub = "Code " + state.code;
    if (view === "trip") {
      var list = L.findList(state.data, state.tripId);
      sub = list ? L.displayTitle(list) : "Trip";
    }
    if (view === "past") sub = "Past packed";
    if (view === "pin") sub = state.code ? "Code " + state.code : sub;
    $("headerSub").textContent = sub;
    if (changed) {
      $("toast").hidden = true;
      if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
    }
  }

  function setStatus(text) {
    state.status = text || "";
    ["roomSync", "tripSync"].forEach(function (id) {
      var el = $(id);
      if (el) el.textContent = state.status;
    });
  }

  function rpc(name, body) {
    var cfg = config();
    if (!cfg) return Promise.reject(new Error("setup"));
    return fetch(cfg.url + "/rest/v1/rpc/" + name, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: cfg.key,
        Authorization: "Bearer " + cfg.key,
      },
      body: JSON.stringify(body),
    }).then(function (res) {
      return res.text().then(function (text) {
        var payload = null;
        try { payload = text ? JSON.parse(text) : null; } catch (e) { payload = text; }
        if (!res.ok) {
          var err = new Error("sync");
          err.status = res.status;
          err.payload = payload;
          throw err;
        }
        return payload;
      });
    });
  }

  function explainSyncError(err) {
    var blob = JSON.stringify(err && err.payload || "");
    if (err && err.status === 401) return "The shared list key was rejected. Check shared-lists/config.js.";
    if (err && (err.status === 404 || /PGRST202|function/i.test(blob))) {
      return "Run shared-lists/supabase.sql in the Supabase SQL editor, then try again.";
    }
    return "Can’t reach the shared list. Check your connection and try again.";
  }

  function applyRemote(remoteData, revision) {
    var merged = L.pruneData(L.mergeData(state.data, remoteData));
    var ahead = !L.sameData(merged, remoteData);
    state.data = merged;
    state.revision = Number(revision) || 0;
    if (ahead) {
      state.dirty = true;
      scheduleSave();
    } else {
      state.dirty = false;
      setStatus("Synced");
    }
    saveCache();
    render();
  }

  function pull() {
    if (!state.code || !state.pin || state.saving) return Promise.resolve();
    return rpc("open_room", { p_code: state.code, p_pin: state.pin }).then(function (res) {
      if (!res || res.status === "bad_pin") {
        rejectPin();
        return;
      }
      if (res.status === "new") {
        toast("That list isn’t there anymore.");
        showJoin();
        return;
      }
      if (res.status === "ok") applyRemote(res.data || L.emptyData(), res.revision);
    }).catch(function () {
      setStatus(state.dirty ? "Offline — saved on this phone" : "Offline");
    });
  }

  function saveNow() {
    if (state.saving) {
      state.saveAgain = true;
      return;
    }
    if (!state.dirty || !state.code || !state.pin) return;
    clearTimeout(state.saveTimer);
    var code = state.code;
    var pin = state.pin;
    var revision = state.revision;
    var payload = L.pruneData(state.data);
    state.data = payload;
    state.saving = true;
    setStatus("Saving…");
    rpc("save_room", {
      p_code: code,
      p_pin: pin,
      p_data: payload,
      p_revision: revision,
    }).then(function (res) {
      if (state.code !== code) return;
      if (res && res.status === "ok") {
        state.revision = Number(res.revision) || state.revision;
        if (!state.saveAgain) {
          state.dirty = false;
          setStatus("Synced");
        }
      } else if (res && res.status === "conflict") {
        state.data = L.pruneData(L.mergeData(state.data, res.data || L.emptyData()));
        state.revision = Number(res.revision) || state.revision;
        state.dirty = true;
        state.saveAgain = true;
      } else if (res && res.status === "bad_pin") {
        rejectPin();
      } else if (res && (res.status === "too_big" || res.status === "bad_data")) {
        toast("This list is too large to save.");
      } else {
        setStatus("Saved on this phone");
      }
    }).catch(function () {
      if (state.code === code) setStatus("Offline — saved on this phone");
    }).then(function () {
      state.saving = false;
      if (state.code === code) {
        saveCache();
        render();
        if (state.saveAgain && state.dirty) {
          state.saveAgain = false;
          saveNow();
        }
      }
    });
  }

  function scheduleSave() {
    setStatus("Saving…");
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(saveNow, 450);
  }

  function mutate(next, tripId) {
    state.data = L.normalizeData(next);
    if (tripId) state.tripId = tripId;
    state.dirty = true;
    saveCache();
    render();
    scheduleSave();
  }

  function startPoll() {
    stopPoll();
    state.pollTimer = setInterval(function () {
      if (document.hidden) return;
      if (inList()) pull();
    }, POLL_MS);
  }

  function stopPoll() {
    clearInterval(state.pollTimer);
    state.pollTimer = 0;
  }

  function closeSheet() {
    state.sheet = null;
    $("sheet").hidden = true;
    $("sheetBody").innerHTML = "";
  }

  function showJoin() {
    stopPoll();
    closeSheet();
    show("join");
    renderSaved();
  }

  function openPin(mode) {
    state.pinMode = mode;
    show("pin");
    var creating = mode === "create";
    $("pinEyebrow").textContent = state.code;
    $("pinTitle").textContent = creating ? "Set a PIN" : "Enter the PIN";
    $("pinCopy").textContent = creating
      ? "This code is new. Pick a PIN you will both remember. A new phone needs the code and the PIN. This phone remembers it after that."
      : "This list already has a PIN. Enter it to open the same trips your wife sees.";
    $("pinLabel").textContent = creating ? "New PIN" : "PIN";
    $("pinConfirmWrap").hidden = !creating;
    $("pinSubmit").textContent = creating ? "Create list" : "Open list";
    $("pinHint").textContent = "";
    $("pinInput").value = "";
    $("pinConfirm").value = "";
    $("pinInput").focus();
  }

  function rejectPin() {
    var cache = loadCache();
    if (state.code && cache.rooms[state.code]) {
      cache.rooms[state.code].pin = "";
      if (cache.activeCode === state.code) cache.activeCode = "";
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
    }
    state.pin = "";
    state.dirty = false;
    stopPoll();
    toast("That PIN doesn’t match this list.");
    openPin("enter");
  }

  function packingCount(data) {
    return P.packingLists(data).length;
  }

  function enterRoom(code, pin, revision, data) {
    if (state.code && state.code !== code && state.dirty) saveNow();
    state.saveAgain = false;
    var cache = loadCache();
    var cached = cache.rooms[code];
    var localData = cached && cached.data ? cached.data : L.emptyData();
    var remoteData = data || L.emptyData();
    var merged = L.pruneData(L.mergeData(localData, remoteData));
    state.code = code;
    state.pin = pin;
    state.revision = Number(revision) || 0;
    state.data = merged;
    state.dirty = !L.sameData(merged, remoteData);
    state.tripId = "";
    saveCache();
    show("trips");
    if (state.dirty) {
      setStatus("Restoring…");
      scheduleSave();
    } else {
      setStatus("Synced");
    }
    render();
    startPoll();
    pull();
  }

  function renderSaved() {
    var cache = loadCache();
    var codes = Object.keys(cache.rooms || {}).filter(function (code) {
      return cache.rooms[code] && cache.rooms[code].pin;
    }).sort();
    var html = "";
    if (codes.length) {
      html += '<p class="saved-label">On this phone</p>';
      codes.forEach(function (code) {
        var n = packingCount(cache.rooms[code].data);
        html += '<button type="button" class="saved-room" data-action="open-saved" data-code="' + esc(code) + '"><span><strong>' + esc(code) + '</strong><br><span class="fine">' + n + (n === 1 ? " trip" : " trips") + "</span></span></button>";
      });
    }
    $("savedRooms").innerHTML = html;
  }

  function progressLabel(list) {
    var counts = L.counts(list);
    var total = counts.open + counts.done;
    if (!total) return "Nothing on this trip yet";
    if (!counts.done) return counts.open + (counts.open === 1 ? " thing to pack" : " things to pack");
    if (!counts.open) return "All " + total + " packed";
    return counts.open + " still to pack · " + counts.done + " packed";
  }

  function renderTrips() {
    if (state.view !== "trips") return;
    $("codePill").textContent = state.code;
    $("roomSync").textContent = state.status;
    var trips = P.packingLists(state.data);
    if (!trips.length) {
      $("tripList").innerHTML = '<p class="empty">No trips yet. Start one, check off what goes in the bag, and those items show up in Past packed next time.</p>';
      return;
    }
    $("tripList").innerHTML = trips.map(function (list) {
      var counts = L.counts(list);
      var total = counts.open + counts.done;
      var pct = total ? Math.round((counts.done / total) * 100) : 0;
      var when = formatWhen(list.createdAt);
      return '<button type="button" class="trip-card" data-action="open-trip" data-id="' + esc(list.id) + '"><strong>' + esc(L.displayTitle(list)) + "</strong><span class=\"fine\">" + esc((when ? when + " · " : "") + progressLabel(list)) + '</span><span class="meter" aria-hidden="true"><span style="width:' + pct + '%"></span></span></button>';
    }).join("");
  }

  function renderTrip() {
    if (state.view !== "trip") return;
    var list = L.findList(state.data, state.tripId);
    if (!list || list.deletedAt || list.category !== "packing") {
      show("trips");
      renderTrips();
      return;
    }
    var title = $("tripTitle");
    if (document.activeElement !== title) title.value = list.title || "";
    $("headerSub").textContent = L.displayTitle(list);
    $("tripProgress").textContent = progressLabel(list);
    $("tripSync").textContent = state.status;
    var items = L.visibleItems(list.items);
    var open = items.filter(function (it) { return !it.checked; });
    var done = items.filter(function (it) { return it.checked; });
    var html = "";
    if (!items.length) html = '<p class="empty">Add what you need to bring, or pull it in from Past packed.</p>';
    function row(it) {
      var emoji = L.itemEmoji(it.text);
      var emojiHtml = emoji ? '<span class="item-emoji" aria-hidden="true">' + emoji + "</span>" : "";
      return '<div class="item-row' + (it.checked ? " done" : "") + '">'
        + '<button type="button" class="check' + (it.checked ? " on" : "") + '" data-action="toggle" data-id="' + esc(it.id) + '" aria-pressed="' + (it.checked ? "true" : "false") + '" aria-label="' + esc((it.checked ? "Mark not packed: " : "Mark packed: ") + it.text) + '">' + (it.checked ? CHECK_SVG : "") + "</button>"
        + '<div class="item-body">' + emojiHtml + '<span class="item-text">' + esc(it.text) + "</span></div>"
        + '<button type="button" class="remove" data-action="remove" data-id="' + esc(it.id) + '" aria-label="' + esc("Remove " + it.text) + '">×</button>'
        + "</div>";
    }
    if (open.length) {
      html += '<p class="section-label">Still to pack</p>';
      open.forEach(function (it) { html += row(it); });
    }
    if (done.length) {
      html += '<p class="section-label">Packed</p>';
      done.forEach(function (it) { html += row(it); });
    }
    $("itemList").innerHTML = html;
    var missing = P.missingPast(state.data, list.id);
    $("addPastBtn").hidden = !missing.length;
    $("addPastBtn").textContent = missing.length === 1
      ? "Add 1 from past packed"
      : "Add from past packed";
  }

  function pastRows() {
    if (state.pastMode === "add") return P.missingPast(state.data, state.tripId);
    return P.pastPackedItems(state.data, null);
  }

  function renderPast() {
    if (state.view !== "past") return;
    var rows = pastRows();
    var adding = state.pastMode === "add";
    $("pastCopy").textContent = adding
      ? "Things from your other trips that are not on this one yet."
      : "Things from your trips. What you actually packed is already selected.";
    if (!rows.length) {
      $("pastRows").innerHTML = '<p class="empty">' + (adding
        ? "Nothing else from earlier trips. Check off what you bring on this one and it will be here next time."
        : "Nothing here yet. Check off what you bring on a trip and those items wait here for the next one.") + "</p>";
    } else {
      $("pastRows").innerHTML = rows.map(function (row) {
        var on = !!state.pastSelected[row.key];
        return '<label class="pick-row"><input type="checkbox" data-past-key="' + esc(row.key) + '"' + (on ? " checked" : "") + ' /><span class="pick-copy"><strong>' + esc(row.text) + '</strong><span class="fine">' + esc(P.pastMeta(row)) + "</span></span></label>";
      }).join("");
    }
    $("pastNameWrap").hidden = adding;
    var title = $("pastTitle");
    if (!adding && document.activeElement !== title) title.value = state.pastTitle || "";
    $("pastGo").hidden = !rows.length;
    $("pastGo").textContent = adding ? "Add selected" : "Start trip with selected";
    $("pastUsual").hidden = adding || !!P.pastPackedItems(state.data, null).length;
  }

  function render() {
    var top = document.scrollingElement ? document.scrollingElement.scrollTop : 0;
    if (state.view === "join") renderSaved();
    if (state.view === "trips") renderTrips();
    if (state.view === "trip") renderTrip();
    if (state.view === "past") renderPast();
    if (document.scrollingElement) document.scrollingElement.scrollTop = top;
  }

  function openSheet(html) {
    state.sheet = true;
    $("sheet").hidden = false;
    $("sheetBody").innerHTML = html;
  }

  function newTripSheet() {
    var past = P.pastPackedItems(state.data, null);
    var fromPast = past.length
      ? '<button type="button" class="btn btn-primary" data-action="sheet-past">Start from past packed</button>'
      : "";
    openSheet(
      "<h2>New trip</h2><p>Name it, then pack from what you brought before or start fresh.</p>"
      + '<label class="field-label" for="newTitle">Trip name</label><input id="newTitle" type="text" maxlength="80" placeholder="Aruba, weekend, Mom\'s" />'
      + fromPast
      + '<button type="button" class="btn ' + (past.length ? "btn-secondary" : "btn-primary") + '" data-action="create-empty">Empty trip</button>'
      + '<button type="button" class="btn btn-quiet" data-action="create-usual">Add usual travel things</button>'
    );
    setTimeout(function () {
      var input = $("newTitle");
      if (input) input.focus();
    }, 30);
  }

  function sheetTitle() {
    var input = $("newTitle");
    return input ? input.value : "";
  }

  function openTrip(id) {
    state.tripId = id;
    show("trip");
    renderTrip();
    $("addInput").value = "";
    $("addInput").focus();
  }

  function openPast(mode, title) {
    state.pastMode = mode;
    if (mode === "new") state.pastTitle = title || state.pastTitle || "";
    state.pastSelected = {};
    var rows = mode === "add" ? P.missingPast(state.data, state.tripId) : P.pastPackedItems(state.data, null);
    P.defaultPastKeys(rows).forEach(function (key) { state.pastSelected[key] = true; });
    show("past");
    renderPast();
  }

  function selectedPastKeys() {
    var keys = [];
    document.querySelectorAll("[data-past-key]").forEach(function (box) {
      if (box.checked) keys.push(box.getAttribute("data-past-key"));
    });
    return keys;
  }

  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-action]");
    if (!btn) return;
    var action = btn.getAttribute("data-action");
    var id = btn.getAttribute("data-id");
    if (action === "open-saved") {
      var code = btn.getAttribute("data-code");
      var room = loadCache().rooms[code];
      if (!room || !room.pin) return;
      enterRoom(code, room.pin, room.revision || 0, room.data);
      setStatus("Checking list…");
      return;
    }
    if (action === "open-trip") { openTrip(id); return; }
    if (action === "toggle") {
      mutate(L.toggleItem(state.data, state.tripId, id));
      return;
    }
    if (action === "remove") {
      mutate(L.removeItem(state.data, state.tripId, id));
      return;
    }
    if (action === "sheet-past") {
      var name = sheetTitle();
      closeSheet();
      openPast("new", name);
      return;
    }
    if (action === "create-empty") {
      var created = P.createTrip(state.data, { title: sheetTitle() });
      closeSheet();
      state.tripId = created.list.id;
      show("trip");
      mutate(created.data);
      $("addInput").value = "";
      $("addInput").focus();
      return;
    }
    if (action === "create-usual") {
      var usual = P.createTrip(state.data, { title: sheetTitle(), usual: true });
      closeSheet();
      state.tripId = usual.list.id;
      show("trip");
      mutate(usual.data);
      $("addInput").value = "";
      toast("Added " + usual.added + " usual things");
      return;
    }
    if (action === "confirm-delete") {
      var next = L.deleteList(state.data, state.tripId);
      closeSheet();
      state.tripId = "";
      show("trips");
      mutate(next);
      return;
    }
    if (action === "confirm-forget") {
      var cache = loadCache();
      delete cache.rooms[state.code];
      if (cache.activeCode === state.code) cache.activeCode = "";
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
      state.code = "";
      state.pin = "";
      state.data = L.emptyData();
      state.dirty = false;
      closeSheet();
      showJoin();
      return;
    }
    if (action === "close-sheet") closeSheet();
  });

  document.addEventListener("change", function (e) {
    var box = e.target.closest("[data-past-key]");
    if (!box) return;
    var key = box.getAttribute("data-past-key");
    if (box.checked) state.pastSelected[key] = true;
    else delete state.pastSelected[key];
  });

  $("joinForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var code = L.normalizeCode($("codeInput").value);
    var err = L.codeError(code);
    $("codeHint").textContent = err || "4–12 letters or numbers.";
    if (err || state.busy) return;
    state.busy = true;
    rpc("room_status", { p_code: code }).then(function (status) {
      state.code = code;
      if (status === "new") openPin("create");
      else if (status === "exists") openPin("enter");
      else $("codeHint").textContent = "Use 4–12 letters or numbers.";
    }).catch(function (err2) {
      $("codeHint").textContent = explainSyncError(err2);
    }).then(function () { state.busy = false; });
  });

  $("pinForm").addEventListener("submit", function (e) {
    e.preventDefault();
    if (state.busy) return;
    var pin = L.normalizePin($("pinInput").value);
    var pinErr = L.pinError(pin);
    if (pinErr) {
      $("pinHint").textContent = pinErr;
      return;
    }
    if (state.pinMode === "create" && pin !== L.normalizePin($("pinConfirm").value)) {
      $("pinHint").textContent = "Those PINs don’t match.";
      return;
    }
    state.busy = true;
    $("pinHint").textContent = "";
    var call = state.pinMode === "create"
      ? rpc("create_room", { p_code: state.code, p_pin: pin, p_data: L.emptyData() })
      : rpc("open_room", { p_code: state.code, p_pin: pin });
    call.then(function (res) {
      if (!res) return;
      if (res.status === "exists") {
        openPin("enter");
        $("pinHint").textContent = "That code was just created. Enter its PIN.";
        return;
      }
      if (res.status === "bad_pin") {
        $("pinHint").textContent = "That PIN doesn’t match this list.";
        return;
      }
      if (res.status === "new") {
        openPin("create");
        return;
      }
      if (res.status === "ok") enterRoom(state.code, pin, res.revision, res.data || L.emptyData());
      else $("pinHint").textContent = "Couldn’t open the list.";
    }).catch(function (err2) {
      $("pinHint").textContent = explainSyncError(err2);
    }).then(function () { state.busy = false; });
  });

  $("pinBack").addEventListener("click", function () {
    state.code = "";
    showJoin();
    $("codeInput").focus();
  });

  $("codesBtn").addEventListener("click", function () {
    if (state.dirty) saveNow();
    showJoin();
  });

  $("newTripBtn").addEventListener("click", newTripSheet);
  $("pastPackedBtn").addEventListener("click", function () { openPast("new", ""); });
  $("addPastBtn").addEventListener("click", function () { openPast("add"); });
  $("backTrips").addEventListener("click", function () {
    show("trips");
    renderTrips();
  });
  $("pastBack").addEventListener("click", function () {
    if (state.pastMode === "add" && state.tripId) {
      show("trip");
      renderTrip();
      return;
    }
    show("trips");
    renderTrips();
  });

  $("pastGo").addEventListener("click", function () {
    var keys = selectedPastKeys();
    if (!keys.length) {
      toast("Pick at least one thing");
      return;
    }
    if (state.pastMode === "add") {
      var added = P.addPastToTrip(state.data, state.tripId, keys);
      if (!added.added) {
        toast("Those are already on this trip");
        return;
      }
      show("trip");
      mutate(added.data, state.tripId);
      $("addInput").value = "";
      toast("Added " + added.added + " from past packed");
      return;
    }
    var title = $("pastTitle") ? $("pastTitle").value : state.pastTitle;
    var created = P.createTripFromPast(state.data, { title: title }, keys);
    state.tripId = created.list.id;
    show("trip");
    mutate(created.data);
    $("addInput").value = "";
    toast("Started with " + created.added + " from past packed");
  });

  $("pastUsual").addEventListener("click", function () {
    var title = $("pastTitle") ? $("pastTitle").value : "";
    var usual = P.createTrip(state.data, { title: title, usual: true });
    state.tripId = usual.list.id;
    show("trip");
    mutate(usual.data);
    $("addInput").value = "";
    toast("Added " + usual.added + " usual things");
  });

  $("pastTitle").addEventListener("input", function () {
    state.pastTitle = $("pastTitle").value;
  });

  $("deleteTripBtn").addEventListener("click", function () {
    var list = L.findList(state.data, state.tripId);
    if (!list) return;
    openSheet("<h2>Delete " + esc(L.displayTitle(list)) + '?</h2><p>It leaves the shared list on both phones.</p><button type="button" class="btn btn-primary" data-action="confirm-delete">Delete trip</button><button type="button" class="btn btn-quiet" data-action="close-sheet">Keep it</button>');
  });

  $("forgetBtn").addEventListener("click", function () {
    openSheet("<h2>Forget " + esc(state.code) + ' on this phone?</h2><p>The trips stay in the shared list. You can open them again with the code and PIN.</p><button type="button" class="btn btn-primary" data-action="confirm-forget">Forget on this phone</button><button type="button" class="btn btn-quiet" data-action="close-sheet">Cancel</button>');
  });

  $("sheetBackdrop").addEventListener("click", closeSheet);
  $("codePill").addEventListener("click", function () {
    var text = state.code;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast("Copied " + text); }, function () { toast(text); });
    } else toast(text);
  });

  $("addForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var input = $("addInput");
    var list = L.findList(state.data, state.tripId);
    if (!list) return;
    if (!L.normalizeText(input.value)) return;
    if (P.hasItem(list, input.value)) {
      toast("Already on this trip");
      return;
    }
    var result = L.addItem(state.data, state.tripId, input.value);
    input.value = "";
    mutate(result.data);
    input.focus();
  });

  $("tripTitle").addEventListener("input", function () {
    state.data = L.setListTitle(state.data, state.tripId, $("tripTitle").value);
    state.dirty = true;
    saveCache();
    scheduleSave();
    var list = L.findList(state.data, state.tripId);
    $("headerSub").textContent = list ? L.displayTitle(list) : "Trip";
  });

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && inList()) pull();
  });

  function boot() {
    if (!config()) {
      show("setup");
      return;
    }
    var cache = loadCache();
    var code = cache.activeCode;
    var room = code && cache.rooms[code];
    if (room && room.pin) {
      state.code = code;
      state.pin = room.pin;
      state.revision = room.revision || 0;
      state.data = L.normalizeData(room.data);
      show("trips");
      render();
      startPoll();
      setStatus("Checking list…");
      pull();
      return;
    }
    showJoin();
  }

  boot();
})();
