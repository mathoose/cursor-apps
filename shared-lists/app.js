(function () {
  "use strict";

  var L = window.SharedListsLogic;
  var STORAGE_KEY = "shared-lists-v1";
  var POLL_MS = 2000;

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
    listId: "",
    expanded: {},
    sheet: null,
    pollTimer: 0,
    saveTimer: 0,
    busy: false,
    colorPopOpen: false,
    activityPopOpen: false,
  };

  function $(id) { return document.getElementById(id); }

  function apiUrl(path) {
    var configured = String(window.OUR_LISTS_API || "").trim().replace(/\/$/, "");
    var rel = String(path || "").replace(/^\//, "");
    if (!configured) return rel;
    return configured + "/" + rel;
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
      var p = JSON.parse(localStorage.getItem(STORAGE_KEY) || "");
      if (!p || typeof p !== "object") {
        return { version: 3, profile: { displayName: "" }, household: { revision: 0, data: L.emptyData() } };
      }
      if (!p.rooms || typeof p.rooms !== "object") p.rooms = {};
      if (!p.profile || typeof p.profile !== "object") p.profile = { displayName: "" };
      p.profile.displayName = L.normalizeDisplayName(p.profile.displayName);
      if (!p.household || typeof p.household !== "object") {
        var carried = L.emptyData();
        Object.keys(p.rooms || {}).forEach(function (code) {
          if (p.rooms[code] && p.rooms[code].data) carried = L.mergeData(carried, p.rooms[code].data);
        });
        p.household = { revision: 0, data: carried };
      }
      p.rooms = {};
      p.activeCode = "";
      p.version = 3;
      return p;
    } catch (e) {
      return { version: 3, profile: { displayName: "" }, household: { revision: 0, data: L.emptyData() } };
    }
  }

  function profileName() {
    return L.normalizeDisplayName(loadCache().profile && loadCache().profile.displayName);
  }

  function setProfileName(name) {
    var cache = loadCache();
    cache.profile = cache.profile || {};
    cache.profile.displayName = L.normalizeDisplayName(name);
    cache.version = 2;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  }

  function saveCache() {
    var cache = loadCache();
    cache.version = 3;
    cache.household = {
      revision: state.revision || 0,
      data: L.normalizeData(state.data),
    };
    cache.rooms = {};
    cache.activeCode = "";
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

  function show(view) {
    state.view = view;
    ["viewJoin", "viewRoom", "viewList"].forEach(function (id) {
      $(id).hidden = id !== "view" + view.charAt(0).toUpperCase() + view.slice(1);
    });
    $("roomsBtn").hidden = view !== "room" && view !== "list";
    var settingsBtn = $("settingsBtn");
    if (settingsBtn) settingsBtn.hidden = view !== "room" && view !== "list";
    var sub = "Just the two of you";
    if (view === "room" && state.code) sub = "Code " + state.code;
    if (view === "list") {
      var list = L.findList(state.data, state.listId);
      sub = list ? L.displayTitle(list) : "List";
    }
    if (view === "pin") sub = state.code ? "Room " + state.code : sub;
    $("headerSub").textContent = sub;
  }

  function setStatus(text) {
    state.status = text || "";
    var el = $("roomSync");
    if (el) el.textContent = state.status;
  }

  function rpc(path, body) {
    return fetch(apiUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(function (res) {
      return res.text().then(function (text) {
        var payload = null;
        try { payload = text ? JSON.parse(text) : null; } catch (e) { payload = null; }
        if (!res.ok || !payload || typeof payload !== "object") {
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
    if (err && err.status === 401) return "Sign in with Cursor to open this list.";
    if (err && err.status === 429) return "Too many tries. Wait a minute and try again.";
    if (err && err.status === 404) {
      return "This page can’t start the shared list. Open Our Lists where the list server is running.";
    }
    return "Can’t reach the shared list. Check your connection and try again.";
  }

  function ensureEurope(data, revision) {
    if (L.activeLists(data).length || Number(revision) > 1) return data;
    return L.createList(data, { category: "packing", title: "Europe" }).data;
  }

  function showSignedOut(message) {
    stopPoll();
    show("join");
    if ($("codeHint")) $("codeHint").textContent = message || "Sign in with Cursor to open this list.";
  }

  function showHousehold() {
    var lists = L.activeLists(state.data);
    if (state.view === "list" && L.findList(state.data, state.listId)) show("list");
    else if (lists.length === 1) {
      state.listId = lists[0].id;
      show("list");
    } else show("room");
    render();
    startPoll();
  }

  function applyRemote(remoteData, revision) {
    var merged = L.pruneData(L.mergeData(state.data, ensureEurope(remoteData, revision)));
    var aheadOfRemote = !L.sameData(merged, remoteData);
    state.data = merged;
    state.revision = Number(revision) || 0;
    if (aheadOfRemote) {
      state.dirty = true;
      scheduleSave();
    } else {
      state.dirty = false;
      setStatus("Synced");
    }
    saveCache();
    showHousehold();
  }

  function pull() {
    if (state.saving) return Promise.resolve();
    return rpc("api/open", {}).then(function (res) {
      if (res && res.status === "ok") {
        applyRemote(res.data || L.emptyData(), res.revision);
        return;
      }
      setStatus("Saved on this phone");
    }).catch(function (err) {
      if (err && err.status === 401) {
        showSignedOut(explainSyncError(err));
        return;
      }
      if (L.activeLists(state.data).length) {
        showHousehold();
        setStatus(state.dirty ? "Offline — saved on this phone" : "Offline");
        return;
      }
      showSignedOut(explainSyncError(err));
    });
  }

  function saveNow() {
    if (state.saving) {
      state.saveAgain = true;
      return;
    }
    if (!state.dirty) return;
    clearTimeout(state.saveTimer);
    var code = state.code;
    var pin = state.pin;
    var revision = state.revision;
    var payload = L.pruneData(state.data);
    state.data = payload;
    state.saving = true;
    setStatus("Saving…");
    rpc("api/save", {
      data: payload,
      revision: revision,
    }).then(function (res) {
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
      } else if (res && (res.status === "too_big" || res.status === "bad_data")) {
        toast("This list is too large to save.");
      } else {
        setStatus("Saved on this phone");
      }
    }).catch(function (err) {
      if (err && err.status === 401) showSignedOut(explainSyncError(err));
      else setStatus("Offline — saved on this phone");
    }).then(function () {
      state.saving = false;
      saveCache();
      render();
      if (state.saveAgain && state.dirty) {
        state.saveAgain = false;
        saveNow();
      }
    });
  }

  function scheduleSave() {
    setStatus("Saving…");
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(saveNow, 450);
  }

  function mutate(next, listId) {
    state.data = L.normalizeData(next);
    if (listId) state.listId = listId;
    state.dirty = true;
    saveCache();
    render();
    scheduleSave();
  }

  function startPoll() {
    stopPoll();
    state.pollTimer = setInterval(function () {
      if (document.hidden) return;
      if (state.view === "room" || state.view === "list") pull();
    }, POLL_MS);
  }

  function stopPoll() {
    clearInterval(state.pollTimer);
    state.pollTimer = 0;
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
      ? "This code is new. Pick a PIN you’ll both remember. You’ll need it every time a new phone joins."
      : "This room already exists. Enter the PIN that was set the first time.";
    $("pinLabel").textContent = creating ? "New PIN" : "PIN";
    $("pinConfirmWrap").hidden = !creating;
    $("pinSubmit").textContent = creating ? "Create room" : "Open room";
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
    toast("That PIN doesn’t open this list.");
    showJoin();
    if ($("codeHint")) $("codeHint").textContent = "That PIN doesn’t open this list.";
  }

  function visibleItemCount(data) {
    var n = 0;
    L.activeLists(data).forEach(function (list) {
      n += L.visibleItems(list.items).length;
    });
    return n;
  }

  function enterRoom(code, pin, revision, data) {
    if (state.code && state.code !== code && state.dirty) saveNow();
    state.saveAgain = false;
    var cache = loadCache();
    var cached = cache.rooms[code];
    var localData = cached && cached.data ? cached.data : L.emptyData();
    var remoteData = data || L.emptyData();
    var remoteItems = visibleItemCount(remoteData);
    var merged = L.pruneData(L.mergeData(localData, remoteData));
    state.code = code;
    state.pin = pin;
    state.revision = Number(revision) || 0;
    state.data = merged;
    state.dirty = !L.sameData(merged, remoteData);
    state.listId = "";
    saveCache();
    show("room");
    if (state.dirty) {
      setStatus("Restoring…");
      scheduleSave();
      if (visibleItemCount(merged) > remoteItems) {
        toast("Merged in items saved on this phone");
      }
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
        var n = L.activeLists(cache.rooms[code].data).length;
        html += '<button type="button" class="saved-room" data-action="open-saved" data-code="' + esc(code) + '"><span><strong>' + esc(code) + '</strong><br><span class="fine">' + n + (n === 1 ? " list" : " lists") + '</span></span></button>';
      });
    }
    if ($("savedRooms")) $("savedRooms").innerHTML = html;
  }

  function noteCard(list) {
    var c = L.counts(list);
    var repeat = L.repeatLabel(list.repeatDays);
    var meta = (repeat ? repeat + " · " : "") + c.open + " open";
    if (c.done) meta += " · " + c.done + " done";
    meta += " · Last " + L.formatLastChanged(list.updatedAt);
    var latest = L.latestCardNote(list);
    var blurb = latest
      ? '<p class="note-blurb">' + esc(latest.text) + ' <span class="note-blurb-time">' + esc(L.formatLastChanged(latest.createdAt)) + "</span></p>"
      : "";
    return '<article class="note note-small tone-' + esc(list.color) + '"><button type="button" class="note-open" data-action="open-list" data-id="' + esc(list.id) + '"><span class="tape" aria-hidden="true"></span><strong>' + esc(L.displayTitle(list)) + "</strong>" + blurb + '<span class="note-meta">' + esc(meta) + '</span></button><button type="button" class="note-copy" data-action="copy-list" data-id="' + esc(list.id) + '">Copy</button></article>';
  }

  function renderRoom() {
    if (state.view !== "room") return;
    $("codePill").textContent = state.code;
    $("roomSync").textContent = state.status;
    var pastBtn = $("pastPackedBtn");
    if (pastBtn && window.TripPackingLogic) {
      pastBtn.hidden = !window.TripPackingLogic.pastPackedItems(state.data).length;
    }
    var groups = L.groupLists(state.data);
    if (!groups.length) {
      $("roomLists").innerHTML = '<p class="empty">The desk is empty. Tap <strong>New list</strong> to tear off a note.</p>';
      return;
    }
    var html = "";
    var today = L.activeLists(state.data).filter(function (list) { return L.repeatsOn(list, new Date()); });
    if (today.length) {
      html += '<p class="group-label">On the desk today</p><div class="desk">';
      today.forEach(function (list) { html += noteCard(list); });
      html += "</div>";
    }
    var todayIds = {};
    today.forEach(function (list) { todayIds[list.id] = true; });
    groups.forEach(function (group) {
      var rest = group.lists.filter(function (list) { return !todayIds[list.id]; });
      if (!rest.length) return;
      html += '<p class="group-label">' + esc(group.label) + '</p><div class="desk">';
      rest.forEach(function (list) { html += noteCard(list); });
      html += "</div>";
    });
    $("roomLists").innerHTML = html;
  }

  function stockBarHtml(listId, it) {
    var level = it.stock || "none";
    var label = it.stock === "low" ? "Low in fridge" : it.stock === "high" ? "Plenty in fridge" : it.stock === "medium" ? "Some left" : "Set fridge level";
    return '<button type="button" class="stock-bar stock-' + esc(level) + '" data-action="cycle-stock" data-list="' + esc(listId) + '" data-id="' + esc(it.id) + '" aria-label="' + esc(label) + '"></button>';
  }

  function usualHtml(listId, it) {
    function chip(val, label) {
      var on = it.usual === val ? " on" : "";
      return '<button type="button" class="usual-chip' + on + '" data-action="set-usual" data-usual="' + val + '" data-list="' + esc(listId) + '" data-id="' + esc(it.id) + '">' + label + "</button>";
    }
    return '<span class="usual-row">' + chip("yes", "Buy") + chip("sometimes", "Sometimes") + chip("no", "Skip") + "</span>";
  }

  function itemRow(list, it) {
    var listId = list.id;
    var on = it.checked ? " on" : "";
    var done = it.checked ? " done" : "";
    var sometimes = it.usual === "sometimes" && !it.checked ? " sometimes" : "";
    var grocery = L.isGroceryList(list)
      ? stockBarHtml(listId, it) + usualHtml(listId, it)
      : "";
    var comments = (it.comments || []).map(function (note) {
      var who = note.by ? note.by + ": " : "";
      return '<p class="item-detail">' + esc(who + note.text) + "</p>";
    }).join("");
    var noteLabel = list.category === "packing" ? "Where" : ((it.comments && it.comments.length) ? "Comments" : "Note");
    var emoji = L.itemEmoji(it.text);
    var emojiHtml = emoji
      ? '<span class="item-emoji" aria-hidden="true">' + emoji + "</span>"
      : '<span class="item-emoji item-emoji-empty" aria-hidden="true"></span>';
    return '<div class="item-row' + done + sometimes + '">'
      + '<button type="button" class="check' + on + '" data-action="toggle" data-list="' + esc(listId) + '" data-id="' + esc(it.id) + '" aria-label="' + (it.checked ? "Mark not done" : "Mark done") + '"></button>'
      + grocery
      + '<div class="item-body">' + emojiHtml + '<div class="item-copy"><span class="item-text">' + esc(it.text) + "</span>" + comments + "</div></div>"
      + '<button type="button" class="item-note-btn" data-action="edit-item-note" data-list="' + esc(listId) + '" data-id="' + esc(it.id) + '">' + noteLabel + "</button>"
      + '<button type="button" class="remove" data-action="remove" data-list="' + esc(listId) + '" data-id="' + esc(it.id) + '">Remove</button>'
      + "</div>";
  }

  function repeatStyleHtml(sel, live) {
    var dayAction = live ? "toggle-day" : "pick-day";
    var weekAction = live ? "set-weekdays" : "pick-weekdays";
    var days = L.DAYS.map(function (d) {
      var on = (sel.days || []).indexOf(d.id) !== -1;
      return '<button type="button" class="day-chip' + (on ? " on" : "") + '" data-action="' + dayAction + '" data-day="' + d.id + '">' + esc(d.label) + "</button>";
    }).join("");
    return '<p class="field-label">Comes back</p><div class="day-row">' + days + '</div><button type="button" class="chip" data-action="' + weekAction + '">Mon–Fri</button>';
  }

  function colorPopHtml(color) {
    return L.COLORS.map(function (c) {
      return '<button type="button" class="swatch swatch-' + c.id + (color === c.id ? " on" : "") + '" data-action="set-color" data-color="' + c.id + '" aria-label="' + esc(c.label) + '"></button>';
    }).join("");
  }

  function syncPaperPopScrim() {
    var scrim = $("paperPopScrim");
    if (!scrim) return;
    scrim.hidden = !(state.colorPopOpen || state.activityPopOpen);
  }

  function closeColorPop() {
    state.colorPopOpen = false;
    var pop = $("colorPop");
    if (pop) pop.hidden = true;
    var mark = $("colorMark");
    if (mark) mark.setAttribute("aria-expanded", "false");
    syncPaperPopScrim();
  }

  function linkify(text) {
    return esc(text).replace(/https?:\/\/[^\s<]+/g, function (url) {
      var clean = url.replace(/[),.;]+$/, "");
      var tail = url.slice(clean.length);
      return '<a href="' + clean + '" target="_blank" rel="noopener noreferrer">' + clean + "</a>" + tail;
    });
  }

  function cardNoteThreadHtml(list) {
    var notes = L.normalizeCardNotes(list);
    if (!notes.length) {
      return '<p class="fine card-note-empty">No comments yet. Post one, or add a link, and it shows on the other phone.</p>';
    }
    return notes.map(function (note) {
      var body = linkify(note.text);
      if (note.link && note.text !== note.link && note.text.indexOf(note.link) === -1) {
        body += '<br><a href="' + esc(note.link) + '" target="_blank" rel="noopener noreferrer">' + esc(note.link) + "</a>";
      }
      var who = note.by ? note.by + " · " : "";
      return '<article class="card-note-msg"><p class="card-note-text">' + body + '</p><p class="card-note-time">' + esc(who + L.formatLastChanged(note.createdAt)) + "</p></article>";
    }).join("");
  }

  function withDay(days, day) {
    var next = (days || []).slice();
    var index = next.indexOf(day);
    if (index === -1) next.push(day);
    else next.splice(index, 1);
    var order = {};
    L.DAYS.forEach(function (d, i) { order[d.id] = i; });
    next.sort(function (a, b) { return order[a] - order[b]; });
    return next;
  }

  function paintChoice(selector, attr, value) {
    document.querySelectorAll(selector).forEach(function (el) {
      el.classList.toggle("on", el.getAttribute(attr) === value);
    });
  }

  function renderItems() {
    if (state.view !== "list") return;
    var list = L.findList(state.data, state.listId);
    if (!list || list.deletedAt) {
      show("room");
      renderRoom();
      return;
    }
    var title = $("listTitle");
    if (document.activeElement !== title) title.value = list.title || "";
    var paper = $("paper");
    paper.className = "paper tone-" + list.color + " paper-small";
    var mark = $("colorMark");
    mark.className = "color-mark swatch-" + list.color;
    var pop = $("colorPop");
    if (state.colorPopOpen) {
      pop.hidden = false;
      pop.innerHTML = colorPopHtml(list.color);
      mark.setAttribute("aria-expanded", "true");
    } else {
      pop.hidden = true;
      mark.setAttribute("aria-expanded", "false");
    }
    var actPop = $("activityPop");
    var actMark = $("activityMark");
    if (state.activityPopOpen) {
      actPop.hidden = false;
      actPop.innerHTML = activityPopHtml(list);
      actMark.setAttribute("aria-expanded", "true");
    } else {
      actPop.hidden = true;
      actMark.setAttribute("aria-expanded", "false");
    }
    syncPaperPopScrim();
    $("cardNoteThread").innerHTML = cardNoteThreadHtml(list);
    var c = L.counts(list);
    var repeat = L.repeatLabel(list.repeatDays);
    var items = L.isGroceryList(list) ? L.shopItems(list) : L.visibleItems(list.items);
    var skipped = L.isGroceryList(list)
      ? L.visibleItems(list.items).filter(function (it) { return it.usual === "no"; })
      : [];
    var open = items.filter(function (it) { return !it.checked; });
    var done = items.filter(function (it) { return it.checked; });
    var html = "";
    if (!items.length && !skipped.length) html = '<p class="empty">Nothing on this note yet.</p>';
    if (L.isGroceryList(list) && !items.length && skipped.length) {
      html += '<p class="empty">Everything is set to Skip. Change Buy / Sometimes below.</p>';
    }
    if (open.length) {
      html += '<div class="item-section">';
      open.forEach(function (it) { html += itemRow(list, it); });
      html += "</div>";
    }
    if (done.length) {
      html += '<p class="section-label">Done</p><div class="item-section">';
      done.forEach(function (it) { html += itemRow(list, it); });
      html += "</div>";
    }
    if (skipped.length) {
      html += '<p class="section-label">Not on our list</p><div class="item-section skipped-section">';
      skipped.forEach(function (it) { html += itemRow(list, it, false); });
      html += "</div>";
    }
    $("itemList").innerHTML = html;
    var addPast = $("addPastBtn");
    if (addPast && window.TripPackingLogic) {
      var missing = list.category === "packing" ? window.TripPackingLogic.missingPast(state.data, list.id) : [];
      addPast.hidden = !missing.length;
    }
    renderHistory(list);
  }

  function renderHistory(list) {
    var earlier = L.earlierLists(state.data, list.id);
    if (!earlier.length) {
      $("historyBlock").innerHTML = "";
      return;
    }
    var currentKeys = {};
    L.visibleItems(list.items).forEach(function (it) {
      currentKeys[L.normalizeKey(it.text)] = true;
    });
    var histKind = (L.categoryLabel(list) || "note").toLowerCase();
    var html = '<p class="section-label">Earlier ' + esc(histKind) + " lists</p>";
    earlier.forEach(function (old) {
      var open = !!state.expanded[old.id];
      html += '<article class="history-card"><button type="button" class="history-head" data-action="expand" data-id="' + esc(old.id) + '"><span><strong>' + esc(L.displayTitle(old)) + '</strong><span class="history-meta">' + esc(formatWhen(old.createdAt)) + " · " + L.visibleItems(old.items).length + ' items</span></span><span>' + (open ? "Hide" : "Show") + "</span></button>";
      if (open) {
        html += '<div class="history-items"><button type="button" class="mini" data-action="add-all" data-source="' + esc(old.id) + '">Add all</button>';
        L.visibleItems(old.items).forEach(function (it) {
          var have = currentKeys[L.normalizeKey(it.text)];
          html += '<div class="item-row"><span class="item-text">' + esc(it.text) + '</span><button type="button" class="history-add" data-action="add-one" data-source="' + esc(old.id) + '" data-id="' + esc(it.id) + '"' + (have ? " disabled" : "") + ">" + (have ? "Added" : "Add") + "</button></div>";
        });
        html += "</div>";
      }
      html += "</article>";
    });
    $("historyBlock").innerHTML = html;
  }

  function render() {
    if (state.view === "room") renderRoom();
    if (state.view === "list") renderItems();
    if (state.view === "room" && state.code) $("headerSub").textContent = "Room " + state.code;
    if (state.view === "list") {
      var current = L.findList(state.data, state.listId);
      $("headerSub").textContent = current ? L.displayTitle(current) : "List";
    }
  }

  function closeSheet() {
    if (state.sheet && state.sheet.kind === "profile" && state.sheet.required) return;
    state.sheet = null;
    $("sheet").hidden = true;
    $("sheetBody").innerHTML = "";
  }

  function openProfileSheet(required) {
    var current = profileName();
    openSheet({
      kind: "profile",
      required: !!required,
      html: "<h2>Your name</h2><p>This name shows on comments, so you can tell who wrote what.</p>"
        + '<label class="field-label" for="profileNameInput">Name</label>'
        + '<input id="profileNameInput" type="text" maxlength="32" autocomplete="name" placeholder="Alex" value="' + esc(current) + '" />'
        + '<button type="button" class="btn btn-primary" data-action="save-profile">Save name</button>'
        + (required ? "" : '<button type="button" class="btn btn-quiet" data-action="close-sheet">Cancel</button>'),
    });
    setTimeout(function () {
      var input = $("profileNameInput");
      if (input) input.focus();
    }, 30);
  }

  function ensureProfile() {
    if (profileName()) return false;
    openProfileSheet(true);
    return true;
  }

  function closeActivityPop() {
    state.activityPopOpen = false;
    var pop = $("activityPop");
    if (pop) pop.hidden = true;
    var mark = $("activityMark");
    if (mark) mark.setAttribute("aria-expanded", "false");
    syncPaperPopScrim();
  }

  function closePaperPops() {
    closeColorPop();
    closeActivityPop();
    if (state.view === "list") renderItems();
  }

  function activityRowHtml(row) {
    if (row.type === "remove_item") {
      return '<p class="activity-row"><strong>' + esc(row.by) + "</strong> removed “" + esc(row.itemText) + "”"
        + ' <time datetime="' + esc(row.at) + '">' + esc(L.formatLastChanged(row.at)) + "</time></p>";
    }
    return "";
  }

  function activityPopHtml(list) {
    var rows = L.activityForList(state.data, list.id);
    var feed = rows.length
      ? rows.map(activityRowHtml).join("")
      : '<p class="activity-empty">No activity on this note yet.</p>';
    return '<div class="activity-pop-bar">'
      + '<p class="activity-pop-head">Activity &amp; schedule</p>'
      + '<button type="button" class="activity-pop-close" data-action="close-activity-pop">Done</button></div>'
      + '<div class="activity-repeat">' + repeatStyleHtml({ days: list.repeatDays }, true) + "</div>"
      + '<p class="field-label activity-section-label">Recent changes</p>'
      + '<div class="activity-feed">' + feed + "</div>";
  }

  function itemNoteSheet(listId, itemId) {
    var list = L.findList(state.data, listId);
    if (!list) return;
    var item = null;
    list.items.forEach(function (it) {
      if (it.id === itemId && !it.deletedAt) item = it;
    });
    if (!item) return;
    var packing = list.category === "packing";
    var thread = (item.comments || []).map(function (note) {
      var who = note.by ? note.by + " · " : "";
      return '<article class="card-note-msg"><p class="card-note-text">' + esc(note.text) + '</p><p class="card-note-time">' + esc(who + L.formatLastChanged(note.createdAt)) + "</p></article>";
    }).join("");
    openSheet({
      kind: "item-note",
      listId: listId,
      itemId: itemId,
      html: "<h2>" + esc(item.text) + "</h2><p>" + (packing ? "Where did you last see it?" : "A note both of you can see.") + "</p>"
        + '<div class="card-note-thread">' + (thread || '<p class="fine">No comments yet.</p>') + "</div>"
        + '<label class="field-label" for="itemNoteInput">' + (packing ? "Last place you saw it" : "Comment") + "</label>"
        + '<textarea id="itemNoteInput" rows="3" maxlength="280" placeholder="' + (packing ? "Hall closet, blue suitcase…" : "A note for both of you") + '"></textarea>'
        + '<button type="button" class="btn btn-primary" data-action="add-item-comment" data-list="' + esc(listId) + '" data-id="' + esc(itemId) + '">Add comment</button>'
        + '<button type="button" class="btn btn-quiet" data-action="close-sheet">Cancel</button>',
    });
    setTimeout(function () {
      var input = $("itemNoteInput");
      if (input) input.focus();
    }, 30);
  }

  function openSheet(sheet) {
    state.sheet = sheet;
    $("sheet").hidden = false;
    $("sheetBody").innerHTML = sheet.html;
  }

  function newListGroceryBlock() {
    if (L.shouldOfferGroceryStarter(state.data)) {
      return '<button type="button" class="btn btn-secondary" data-action="create-grocery-starter">Suggested grocery list (once per room)</button>';
    }
    if (L.groceryHistoryItems(state.data).length) {
      return '<button type="button" class="btn btn-secondary" data-action="open-grocery-history">New grocery list from past trips</button>';
    }
    return '<p class="fine">Check items off on a grocery run and they will show up here for the next list.</p>';
  }

  function groceryHistorySheet() {
    var history = L.groceryHistoryItems(state.data);
    var rows = history.map(function (row) {
      var when = formatWhen(row.checkedAt);
      var meta = row.tripTitle + (when ? " · " + when : "");
      if (row.times > 1) meta += " · " + row.times + "×";
      return '<label class="check-row"><input type="checkbox" data-history-key="' + esc(row.key) + '" checked /> ' + esc(row.text) + ' <span class="fine">' + esc(meta) + "</span></label>";
    }).join("");
    openSheet({
      kind: "grocery-history",
      html: "<h2>Past groceries</h2><p>Checked-off items from earlier grocery lists in this room.</p>" + rows + '<label class="field-label" for="historyTitle">List name</label><input id="historyTitle" type="text" maxlength="80" placeholder="Grocery list" /><label class="field-label" for="historyCardNote">First desk slip note (optional)</label><textarea id="historyCardNote" rows="2" maxlength="280" placeholder="Posted when you start the list"></textarea><button type="button" class="btn btn-primary" data-action="create-grocery-from-history">Start list with selected</button>',
    });
  }

  function newListSheet() {
    var sheet = {
      kind: "new",
      color: "butter",
      size: "small",
      days: [],
      html: "",
    };
    sheet.html = "<h2>New list</h2>" + newListGroceryBlock() + '<label class="field-label" for="newTitle">Name</label><input id="newTitle" type="text" maxlength="80" placeholder="Weekend, groceries, Aruba…" /><label class="field-label" for="newCardNote">First comment (optional)</label><textarea id="newCardNote" rows="2" maxlength="280" placeholder="Shows with your name when you post it"></textarea>' + repeatStyleHtml(sheet, false) + '<button type="button" class="btn btn-primary" data-action="create-list">Create list</button><button type="button" class="btn btn-secondary" data-action="create-packing">Packing trip</button>';
    openSheet(sheet);
  }

  function copySheet(listId) {
    var list = L.findList(state.data, listId);
    if (!list) return;
    var rows = L.visibleItems(list.items).map(function (it) {
      return '<label class="check-row"><input type="checkbox" data-copy-id="' + esc(it.id) + '" /> ' + esc(it.text) + "</label>";
    }).join("");
    openSheet({
      kind: "copy",
      listId: listId,
      html: "<h2>Copy " + esc(L.displayTitle(list)) + '</h2><p>Copied items start unchecked on a new list.</p><button type="button" class="btn btn-primary" data-action="copy-all" data-id="' + esc(listId) + '">Copy all</button><p class="field-label">Or choose some</p>' + (rows || '<p class="empty">This list has no items.</p>') + '<button type="button" class="btn btn-secondary" data-action="copy-selected" data-id="' + esc(listId) + '">Copy selected</button>',
    });
  }

  function deleteSheet() {
    var list = L.findList(state.data, state.listId);
    if (!list) return;
    openSheet({
      kind: "delete",
      html: "<h2>Delete " + esc(L.displayTitle(list)) + '</h2><p>It will leave this room on both phones.</p><button type="button" class="btn btn-primary" data-action="confirm-delete">Delete list</button><button type="button" class="btn btn-quiet" data-action="close-sheet">Keep it</button>',
    });
  }

  function forgetSheet() {
    openSheet({
      kind: "forget",
      html: "<h2>Clear the copy on this phone?</h2><p>The shared list stays. This phone will load it again.</p><button type=\"button\" class=\"btn btn-primary\" data-action=\"confirm-forget\">Clear this phone</button><button type=\"button\" class=\"btn btn-quiet\" data-action=\"close-sheet\">Cancel</button>",
    });
  }

  function openList(id) {
    state.listId = id;
    state.colorPopOpen = false;
    state.activityPopOpen = false;
    show("list");
    renderItems();
    $("addInput").focus();
  }

  function afterCopy(result) {
    if (!result.list) {
      toast("Pick at least one item.");
      return;
    }
    closeSheet();
    show("list");
    mutate(result.data, result.list.id);
    toast("Copied " + result.copied + (result.copied === 1 ? " item" : " items"));
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
    if (action === "open-list") { openList(id); return; }
    if (action === "copy-list") { copySheet(id); return; }
    if (action === "cycle-stock") {
      mutate(L.cycleItemStock(state.data, btn.getAttribute("data-list"), id));
      return;
    }
    if (action === "set-usual") {
      mutate(L.setItemUsual(state.data, btn.getAttribute("data-list"), id, btn.getAttribute("data-usual")));
      return;
    }
    if (action === "toggle") {
      mutate(L.toggleItem(state.data, btn.getAttribute("data-list"), id));
      return;
    }
    if (action === "remove") {
      if (!profileName()) {
        openProfileSheet(true);
        return;
      }
      mutate(L.removeItem(state.data, btn.getAttribute("data-list"), id, undefined, profileName()));
      return;
    }
    if (action === "save-profile") {
      var profileInput = $("profileNameInput");
      if (!profileInput || !L.normalizeDisplayName(profileInput.value)) {
        toast("Enter a name");
        return;
      }
      setProfileName(profileInput.value);
      state.sheet = null;
      $("sheet").hidden = true;
      $("sheetBody").innerHTML = "";
      toast("Saved your name");
      return;
    }
    if (action === "close-activity-pop") {
      closeActivityPop();
      renderItems();
      return;
    }
    if (action === "expand") {
      state.expanded[id] = !state.expanded[id];
      renderItems();
      return;
    }
    if (action === "add-one") {
      var one = L.addFromList(state.data, state.listId, btn.getAttribute("data-source"), [id]);
      if (!one.added) toast("Already on this list");
      else {
        mutate(one.data);
        toast("Added");
      }
      return;
    }
    if (action === "add-all") {
      var many = L.addFromList(state.data, state.listId, btn.getAttribute("data-source"), null);
      if (!many.added) toast("Nothing new to add");
      else {
        mutate(many.data);
        toast("Added " + many.added);
      }
      return;
    }
    if (action === "open-grocery-history") {
      groceryHistorySheet();
      return;
    }
    if (action === "create-grocery-starter") {
      if (!L.shouldOfferGroceryStarter(state.data)) {
        toast("Use past trips for the next grocery list");
        return;
      }
      var note = $("newCardNote") ? $("newCardNote").value : "";
      var title = $("newTitle") ? $("newTitle").value : "";
      var started = L.createGroceryStarter(state.data, {
        title: title,
        cardNote: note,
      });
      closeSheet();
      show("list");
      mutate(started.data, started.list.id);
      toast("Added " + started.list.items.length + " usual groceries");
      return;
    }
    if (action === "create-grocery-from-history") {
      var keys = [];
      document.querySelectorAll("[data-history-key]").forEach(function (box) {
        if (box.checked) keys.push(box.getAttribute("data-history-key"));
      });
      if (!keys.length) {
        toast("Pick at least one item");
        return;
      }
      var histTitle = $("historyTitle") ? $("historyTitle").value : "";
      var histNote = $("historyCardNote") ? $("historyCardNote").value : "";
      var fromPast = L.createGroceryFromHistory(state.data, {
        title: histTitle,
        cardNote: histNote,
      }, keys);
      if (!fromPast.list) {
        toast("Nothing to add");
        return;
      }
      closeSheet();
      show("list");
      mutate(fromPast.data, fromPast.list.id);
      toast("Added " + fromPast.copied + " from past trips");
      return;
    }
    if (action === "toggle-color-pop") {
      state.colorPopOpen = !state.colorPopOpen;
      renderItems();
      return;
    }
    if (action === "close-color-pop") {
      closeColorPop();
      return;
    }
    if (action === "pick-day") {
      state.sheet.days = withDay(state.sheet.days, btn.getAttribute("data-day"));
      document.querySelectorAll("#sheetBody .day-chip").forEach(function (el) {
        el.classList.toggle("on", state.sheet.days.indexOf(el.getAttribute("data-day")) !== -1);
      });
      return;
    }
    if (action === "pick-weekdays") {
      state.sheet.days = L.WEEKDAYS.slice();
      document.querySelectorAll("#sheetBody .day-chip").forEach(function (el) {
        el.classList.toggle("on", state.sheet.days.indexOf(el.getAttribute("data-day")) !== -1);
      });
      return;
    }
    if (action === "set-color") {
      mutate(L.setListStyle(state.data, state.listId, { color: btn.getAttribute("data-color") }));
      closeColorPop();
      return;
    }
    if (action === "toggle-day") {
      var listId = state.listId || btn.getAttribute("data-list");
      var current = L.findList(state.data, listId);
      if (!current) return;
      mutate(L.setListStyle(state.data, listId, { repeatDays: withDay(current.repeatDays, btn.getAttribute("data-day")) }), listId);
      return;
    }
    if (action === "set-weekdays") {
      var listIdWeek = state.listId || btn.getAttribute("data-list");
      mutate(L.setListStyle(state.data, listIdWeek, { repeatDays: L.WEEKDAYS.slice() }), listIdWeek);
      return;
    }
    if (action === "edit-item-note") {
      itemNoteSheet(btn.getAttribute("data-list"), id);
      return;
    }
    if (action === "add-item-comment") {
      if (ensureProfile()) return;
      var noteList = btn.getAttribute("data-list");
      var noteId = btn.getAttribute("data-id");
      var noteText = $("itemNoteInput") ? $("itemNoteInput").value : "";
      if (!L.normalizeCardNote(noteText)) {
        toast("Write where you saw it");
        return;
      }
      closeSheet();
      mutate(L.addItemComment(state.data, noteList, noteId, noteText, undefined, { by: profileName() }), noteList);
      toast("Comment added");
      return;
    }
    if (action === "create-list" || action === "create-packing") {
      var title = $("newTitle") ? $("newTitle").value : "";
      var deskNote = $("newCardNote") ? $("newCardNote").value : "";
      var created = L.createList(state.data, {
        category: action === "create-packing" ? "packing" : "custom",
        customName: "",
        title: title,
        color: state.sheet.color,
        size: state.sheet.size,
        repeatDays: state.sheet.days,
      });
      if (L.normalizeCardNote(deskNote)) {
        created.data = L.addCardNote(created.data, created.list.id, deskNote, undefined, { by: profileName() });
        created.list = L.findList(created.data, created.list.id);
      }
      closeSheet();
      show("list");
      mutate(created.data, created.list.id);
      return;
    }
    if (action === "add-past-to-list") {
      var missing = window.TripPackingLogic.missingPast(state.data, state.listId);
      var pickRows = missing.map(function (row) {
        return '<label class="check-row"><input type="checkbox" data-past-key="' + esc(row.key) + '" checked /> ' + esc(row.text) + ' <span class="fine">' + esc(window.TripPackingLogic.pastMeta(row)) + "</span></label>";
      }).join("");
      openSheet({
        kind: "add-past",
        html: "<h2>Past packed</h2><p>Add things from other trips that are not on this one yet.</p>" + pickRows + '<button type="button" class="btn btn-primary" data-action="add-selected-past">Add selected</button>',
      });
      return;
    }
    if (action === "add-selected-past") {
      var pastKeys = [];
      document.querySelectorAll("[data-past-key]").forEach(function (box) {
        if (box.checked) pastKeys.push(box.getAttribute("data-past-key"));
      });
      if (!pastKeys.length) {
        toast("Pick at least one thing");
        return;
      }
      var addedPast = window.TripPackingLogic.addPastToTrip(state.data, state.listId, pastKeys);
      closeSheet();
      mutate(addedPast.data, state.listId);
      toast("Added " + addedPast.added + " from past packed");
      return;
    }
    if (action === "open-past-packed") {
      var history = window.TripPackingLogic.pastPackedItems(state.data);
      var rows = history.map(function (row) {
        var selected = window.TripPackingLogic.defaultPastKeys(history).indexOf(row.key) !== -1;
        return '<label class="check-row"><input type="checkbox" data-history-key="' + esc(row.key) + '"' + (selected ? " checked" : "") + " /> " + esc(row.text) + ' <span class="fine">' + esc(window.TripPackingLogic.pastMeta(row)) + "</span></label>";
      }).join("");
      openSheet({
        kind: "past-packed",
        html: "<h2>Past packed</h2><p>What you packed on other trips. Packed items start selected.</p>" + rows + '<label class="field-label" for="historyTitle">Trip name</label><input id="historyTitle" type="text" maxlength="80" placeholder="Next trip" /><button type="button" class="btn btn-primary" data-action="create-from-past">Start trip with selected</button>',
      });
      return;
    }
    if (action === "create-from-past") {
      var keys = [];
      document.querySelectorAll("[data-history-key]").forEach(function (box) {
        if (box.checked) keys.push(box.getAttribute("data-history-key"));
      });
      if (!keys.length) {
        toast("Pick at least one thing");
        return;
      }
      var fromPast = window.TripPackingLogic.createTripFromPast(state.data, {
        title: $("historyTitle") ? $("historyTitle").value : "",
      }, keys);
      closeSheet();
      show("list");
      mutate(fromPast.data, fromPast.list.id);
      toast("Started with " + fromPast.added + " from past packed");
      return;
    }
    if (action === "copy-all") {
      afterCopy(L.copyList(state.data, id, null));
      return;
    }
    if (action === "copy-selected") {
      var ids = [];
      document.querySelectorAll("[data-copy-id]").forEach(function (box) {
        if (box.checked) ids.push(box.getAttribute("data-copy-id"));
      });
      afterCopy(L.copyList(state.data, id, ids));
      return;
    }
    if (action === "confirm-delete") {
      var next = L.deleteList(state.data, state.listId);
      closeSheet();
      state.listId = "";
      show("room");
      mutate(next);
      return;
    }
    if (action === "confirm-forget") {
      state.data = L.emptyData();
      state.revision = 0;
      state.dirty = false;
      state.listId = "";
      saveCache();
      closeSheet();
      pull();
      return;
    }
    if (action === "close-sheet") closeSheet();
  });

  $("roomsBtn").addEventListener("click", function () {
    state.listId = "";
    show("room");
    render();
  });
  $("settingsBtn").addEventListener("click", function () {
    openProfileSheet(false);
  });
  $("newListBtn").addEventListener("click", newListSheet);
  $("copyListBtn").addEventListener("click", function () { copySheet(state.listId); });
  $("deleteListBtn").addEventListener("click", deleteSheet);
  $("forgetBtn").addEventListener("click", forgetSheet);
  $("backLists").addEventListener("click", function () {
    closeColorPop();
    closeActivityPop();
    show("room");
    renderRoom();
  });
  $("colorMark").addEventListener("click", function (e) {
    e.preventDefault();
    e.stopPropagation();
    closeActivityPop();
    state.colorPopOpen = !state.colorPopOpen;
    renderItems();
  });
  $("activityMark").addEventListener("click", function (e) {
    e.preventDefault();
    e.stopPropagation();
    closeColorPop();
    state.activityPopOpen = !state.activityPopOpen;
    renderItems();
  });
  $("paperPopScrim").addEventListener("click", function (e) {
    e.preventDefault();
    e.stopPropagation();
    closePaperPops();
  });
  document.addEventListener(
    "pointerdown",
    function (e) {
      if (state.view !== "list") return;
      if (!state.colorPopOpen && !state.activityPopOpen) return;
      if (e.target.closest("#activityPop") || e.target.closest("#activityMark")) return;
      if (e.target.closest("#colorPop") || e.target.closest("#colorMark")) return;
      if (e.target.closest("#paperPopScrim")) return;
      closePaperPops();
    },
    true
  );
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
    var text = input.value;
    if (!L.normalizeText(text)) return;
    var result = L.addItem(state.data, state.listId, text);
    input.value = "";
    mutate(result.data);
    input.focus();
  });

  $("listTitle").addEventListener("change", function () {
    mutate(L.setListTitle(state.data, state.listId, $("listTitle").value));
  });

  $("cardNoteForm").addEventListener("submit", function (e) {
    e.preventDefault();
    if (state.view !== "list" || !state.listId) return;
    if (ensureProfile()) return;
    var draft = $("cardNoteDraft");
    var linkInput = $("cardNoteLink");
    var text = draft.value;
    var link = linkInput ? linkInput.value : "";
    if (!L.normalizeCardNote(text) && !L.normalizeLink(link)) {
      toast("Write a comment or add a link");
      return;
    }
    mutate(L.addCardNote(state.data, state.listId, text, undefined, {
      by: profileName(),
      link: link,
    }), state.listId);
    draft.value = "";
    if (linkInput) linkInput.value = "";
    toast("Comment posted");
  });

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && (state.view === "room" || state.view === "list")) pull();
  });

  function boot() {
    var cache = loadCache();
    if (cache.household && cache.household.data) {
      state.data = L.normalizeData(cache.household.data);
      state.revision = cache.household.revision || 0;
    }
    showSignedOut("Opening the list…");
    pull();
  }

  boot();
})();
