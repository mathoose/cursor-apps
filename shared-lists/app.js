(function () {
  "use strict";

  var L = window.SharedListsLogic;
  var STORAGE_KEY = "shared-lists-v1";
  var POLL_MS = 4000;

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
      var p = JSON.parse(localStorage.getItem(STORAGE_KEY) || "");
      if (!p || typeof p !== "object" || !p.rooms || typeof p.rooms !== "object") {
        return { version: 1, activeCode: "", rooms: {} };
      }
      p.version = 1;
      return p;
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

  function show(view) {
    state.view = view;
    ["viewSetup", "viewJoin", "viewPin", "viewRoom", "viewList"].forEach(function (id) {
      $(id).hidden = id !== "view" + view.charAt(0).toUpperCase() + view.slice(1);
    });
    $("roomsBtn").hidden = view !== "room" && view !== "list";
    var sub = "Shared checklists";
    if (view === "room" && state.code) sub = "Room " + state.code;
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
    if (err && err.status === 401) return "The anon key was rejected. Check config.js.";
    if (err && (err.status === 404 || /PGRST202|function/i.test(blob))) {
      return "Run shared-lists/supabase.sql in the Supabase SQL editor, then try again.";
    }
    return "Can’t reach the shared room. Check your connection and try again.";
  }

  function applyRemote(remoteData, revision) {
    var merged = L.pruneData(L.mergeData(state.data, remoteData));
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
        toast("That room isn’t there anymore.");
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
        toast("This room is too large to save.");
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
    toast("That PIN doesn’t match this room.");
    openPin("enter");
  }

  function enterRoom(code, pin, revision, data) {
    if (state.code && state.code !== code && state.dirty) saveNow();
    state.saveAgain = false;
    state.code = code;
    state.pin = pin;
    state.revision = Number(revision) || 0;
    state.data = L.normalizeData(data || L.emptyData());
    state.dirty = false;
    state.listId = "";
    saveCache();
    show("room");
    setStatus("Synced");
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
    $("savedRooms").innerHTML = html;
  }

  function renderRoom() {
    if (state.view !== "room") return;
    $("codePill").textContent = state.code;
    $("roomSync").textContent = state.status;
    var groups = L.groupLists(state.data);
    if (!groups.length) {
      $("roomLists").innerHTML = '<p class="empty">No lists yet. Start one for packing, groceries, or leaving the house.</p>';
      return;
    }
    var html = "";
    groups.forEach(function (group) {
      html += '<p class="group-label">' + esc(group.label) + "</p>";
      group.lists.forEach(function (list) {
        var c = L.counts(list);
        html += '<article class="list-card"><button type="button" class="list-open" data-action="open-list" data-id="' + esc(list.id) + '"><strong>' + esc(L.displayTitle(list)) + '</strong><span class="fine">' + esc(formatWhen(list.createdAt)) + " · " + c.open + " open · " + c.done + ' done</span></button><button type="button" class="mini" data-action="copy-list" data-id="' + esc(list.id) + '">Copy</button></article>';
      });
    });
    $("roomLists").innerHTML = html;
  }

  function itemRow(listId, it) {
    var on = it.checked ? " on" : "";
    var done = it.checked ? " done" : "";
    return '<div class="item-row' + done + '"><button type="button" class="check' + on + '" data-action="toggle" data-list="' + esc(listId) + '" data-id="' + esc(it.id) + '" aria-label="' + (it.checked ? "Mark not done" : "Mark done") + '"></button><span class="item-text">' + esc(it.text) + '</span><button type="button" class="remove" data-action="remove" data-list="' + esc(listId) + '" data-id="' + esc(it.id) + '">Remove</button></div>';
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
    var c = L.counts(list);
    $("listMeta").textContent = L.categoryLabel(list) + " · " + c.open + " open · " + c.done + " done · " + (state.status || "");
    var items = L.visibleItems(list.items);
    var open = items.filter(function (it) { return !it.checked; });
    var done = items.filter(function (it) { return it.checked; });
    var html = "";
    if (!items.length) html = '<p class="empty">Nothing on this list yet.</p>';
    if (open.length) {
      html += '<div class="item-section">';
      open.forEach(function (it) { html += itemRow(list.id, it); });
      html += "</div>";
    }
    if (done.length) {
      html += '<p class="section-label">Done</p><div class="item-section">';
      done.forEach(function (it) { html += itemRow(list.id, it); });
      html += "</div>";
    }
    $("itemList").innerHTML = html;
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
    var html = '<p class="section-label">Earlier ' + esc(L.categoryLabel(list).toLowerCase()) + " lists</p>";
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
  }

  function closeSheet() {
    state.sheet = null;
    $("sheet").hidden = true;
    $("sheetBody").innerHTML = "";
  }

  function openSheet(sheet) {
    state.sheet = sheet;
    $("sheet").hidden = false;
    $("sheetBody").innerHTML = sheet.html;
  }

  function newListSheet() {
    var chips = L.CATEGORIES.map(function (cat) {
      return '<button type="button" class="chip' + (cat.id === "grocery" ? " on" : "") + '" data-action="pick-cat" data-cat="' + cat.id + '">' + esc(cat.label) + "</button>";
    }).join("");
    chips += '<button type="button" class="chip" data-action="pick-cat" data-cat="custom">Other</button>';
    openSheet({
      kind: "new",
      category: "grocery",
      html: '<h2>New list</h2><p class="field-label">Category</p><div class="chips" id="catChips">' + chips + '</div><div id="customWrap" hidden><label class="field-label" for="customName">Category name</label><input id="customName" type="text" maxlength="40" placeholder="Camping" /></div><label class="field-label" for="newTitle">Name</label><input id="newTitle" type="text" maxlength="80" placeholder="This week" /><button type="button" class="btn btn-primary" data-action="create-list">Create list</button>',
    });
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
      html: "<h2>Forget " + esc(state.code) + ' on this phone?</h2><p>The lists stay in the room. You can join again with the code and PIN.</p><button type="button" class="btn btn-primary" data-action="confirm-forget">Forget on this phone</button><button type="button" class="btn btn-quiet" data-action="close-sheet">Cancel</button>',
    });
  }

  function openList(id) {
    state.listId = id;
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
      setStatus("Checking room…");
      return;
    }
    if (action === "open-list") { openList(id); return; }
    if (action === "copy-list") { copySheet(id); return; }
    if (action === "toggle") {
      mutate(L.toggleItem(state.data, btn.getAttribute("data-list"), id));
      return;
    }
    if (action === "remove") {
      mutate(L.removeItem(state.data, btn.getAttribute("data-list"), id));
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
    if (action === "pick-cat") {
      state.sheet.category = btn.getAttribute("data-cat");
      document.querySelectorAll("#catChips .chip").forEach(function (chip) {
        chip.classList.toggle("on", chip.getAttribute("data-cat") === state.sheet.category);
      });
      $("customWrap").hidden = state.sheet.category !== "custom";
      return;
    }
    if (action === "create-list") {
      var category = state.sheet.category || "grocery";
      var customName = $("customName") ? $("customName").value : "";
      if (category === "custom" && !L.normalizeText(customName)) {
        toast("Name this category");
        return;
      }
      var title = $("newTitle") ? $("newTitle").value : "";
      var created = L.createList(state.data, { category: category, customName: customName, title: title });
      closeSheet();
      show("list");
      mutate(created.data, created.list.id);
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
    var err = L.pinError(pin);
    if (err) {
      $("pinHint").textContent = err;
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
        state.pinMode = "enter";
        openPin("enter");
        $("pinHint").textContent = "That code was just created. Enter its PIN.";
        return;
      }
      if (res.status === "bad_pin") {
        $("pinHint").textContent = "That PIN doesn’t match this room.";
        return;
      }
      if (res.status === "new") {
        openPin("create");
        return;
      }
      if (res.status === "ok") enterRoom(state.code, pin, res.revision, res.data || L.emptyData());
      else $("pinHint").textContent = "Couldn’t open the room.";
    }).catch(function (err2) {
      $("pinHint").textContent = explainSyncError(err2);
    }).then(function () { state.busy = false; });
  });

  $("pinBack").addEventListener("click", function () {
    state.code = "";
    showJoin();
    $("codeInput").focus();
  });

  $("roomsBtn").addEventListener("click", showJoin);
  $("newListBtn").addEventListener("click", newListSheet);
  $("copyListBtn").addEventListener("click", function () { copySheet(state.listId); });
  $("deleteListBtn").addEventListener("click", deleteSheet);
  $("forgetBtn").addEventListener("click", forgetSheet);
  $("backLists").addEventListener("click", function () {
    show("room");
    renderRoom();
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

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && (state.view === "room" || state.view === "list")) pull();
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
      show("room");
      render();
      startPoll();
      setStatus("Checking room…");
      pull();
      return;
    }
    showJoin();
  }

  boot();
})();
