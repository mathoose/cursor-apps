(function () {
  "use strict";

  var L = window.JotLogic;
  var APP_ID = "jot";
  var TIMER_PRESETS = [5, 10, 15, 25, 45, 60];
  var ICONS = {
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 21h4"/>',
    timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.5 2M9.5 2.5h5"/>',
    chevron: '<path d="M9 6l6 6-6 6"/>',
    folder: '<path d="M3 7.5a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    more: '<path d="M5 12h.01M12 12h.01M19 12h.01"/>',
  };
  var COLOR_NAMES = { yellow: "Yellow", pink: "Pink", blue: "Blue", green: "Green", orange: "Orange", purple: "Purple" };
  var HOLD_MS = 320;
  var HOLD_SLOP = 10;
  var MOUSE_SLOP = 6;

  var state = load();
  var ui = {
    view: "inbox",
    listId: null,
    showDone: {},
    fresh: {},
    sheetItemId: null,
    sheetPickTime: false,
    sheetOtherTimer: false,
    sheetNoteId: null,
    sheetFolderId: null,
    newFolder: false,
    pendingNoteId: null,
    alertKey: "",
  };
  var drag = { active: false, pending: null, quietUntil: 0 };
  var toastTimer = null;
  var captures = {};

  // ---- DOM helpers ----

  function $(id) {
    return document.getElementById(id);
  }

  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === "text") el.textContent = v;
      else if (k === "class") el.className = v;
      else el.setAttribute(k, v === true ? "" : v);
    });
    (children || []).forEach(function (c) {
      if (c) el.appendChild(c);
    });
    return el;
  }

  function icon(name) {
    var holder = document.createElement("span");
    holder.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICONS[name] + "</svg>";
    return holder.firstChild;
  }

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function plural(n, word) {
    if (n === 1) return n + " " + word;
    return n + " " + (/y$/.test(word) ? word.slice(0, -1) + "ies" : word + "s");
  }

  /** "2 lines, 1 list and 3 stickies", leaving out whatever there is none of. */
  function countList(parts) {
    var shown = parts.filter(function (p) { return p[0] > 0; }).map(function (p) { return plural(p[0], p[1]); });
    if (shown.length < 2) return shown.join("");
    return shown.slice(0, -1).join(", ") + " and " + shown[shown.length - 1];
  }

  // ---- storage ----

  function load() {
    try {
      var raw = localStorage.getItem(L.STORAGE_KEY);
      return L.normalizeState(raw ? JSON.parse(raw) : null);
    } catch (e) {
      return L.emptyState();
    }
  }

  function save() {
    try {
      localStorage.setItem(L.STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      toast("Couldn’t save on this phone. Storage is full or turned off.");
      return false;
    }
  }

  function commit(next) {
    if (next === state) return false;
    state = next;
    save();
    render();
    return true;
  }

  // ---- toast ----

  function hideToast() {
    clearTimeout(toastTimer);
    $("toast").hidden = true;
  }

  function toast(message, opts) {
    var el = $("toast");
    clear(el);
    el.appendChild(h("span", { text: message }));
    if (opts && opts.action) {
      var btn = h("button", { type: "button", class: "toast-action", text: opts.action });
      btn.addEventListener("click", function () {
        hideToast();
        opts.onAction();
      });
      el.appendChild(btn);
    }
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, opts && opts.action ? 8000 : 2800);
  }

  // ---- alerts: timers, reminders, Shortcuts ----

  function handOff(url) {
    window.location.href = url;
  }

  function startTimer(minutes, label) {
    var handed = state.settings.timerReady;
    var next = L.addTimer(state, { minutes: minutes, label: label, now: new Date(), handedOff: handed });
    if (next === state) {
      toast("Timers run from 1 minute to 24 hours");
      return;
    }
    commit(next);
    var name = L.formatMinutes(next.timers[0].minutes) + " timer";
    if (handed) {
      toast(name + " started. Opening Clock…");
      handOff(L.timerShortcutUrl(state.settings, next.timers[0].minutes));
    } else {
      toast(name + " started");
    }
  }

  function afterReminderSet(text, when, handed, replacedApple) {
    var label = L.formatWhen(when, new Date());
    if (handed) {
      toast("Reminder set for " + label + "." + (replacedApple ? " The earlier one is still in Reminders." : ""));
      handOff(L.reminderShortcutUrl(state.settings, text, when));
      return;
    }
    toast("Remind " + label + ". Only shows while Jot is open.", { action: "Set up", onAction: openSettings });
  }

  function addReminderLine(text, when, listId) {
    var id = L.uid("i");
    var handed = state.settings.reminderReady;
    ui.fresh[id] = true;
    commit(L.addItem(state, { id: id, text: text, listId: listId, now: new Date(), remindAt: when, handedOff: handed }));
    afterReminderSet(text, when, handed, false);
  }

  function setItemReminder(id, when) {
    var before = L.findItem(state, id);
    if (!before) return;
    var date = new Date(when);
    if (isNaN(date.getTime()) || date.getTime() <= Date.now()) {
      toast("Pick a time that hasn’t passed");
      return;
    }
    var handed = state.settings.reminderReady;
    var replacedApple = before.handedOff && !!before.remindAt;
    commit(L.setReminder(state, id, date, handed));
    closeSheets();
    afterReminderSet(before.text, date, handed, replacedApple);
  }

  function alertKey(now) {
    var keys = [];
    state.timers.forEach(function (t) {
      if (L.timerLeftMs(t, now) <= 0) keys.push("t:" + t.id);
    });
    L.dueItems(state, now).forEach(function (it) {
      keys.push("i:" + it.id);
    });
    return keys.join("\n");
  }

  function tick() {
    if (drag.active) return;
    var now = new Date();
    var key = alertKey(now);
    if (key !== ui.alertKey) {
      var before = ui.alertKey ? ui.alertKey.split("\n") : [];
      var fresh = key ? key.split("\n").filter(function (k) { return before.indexOf(k) < 0; }) : [];
      render();
      if (fresh.length) announce(fresh[0]);
      return;
    }
    Array.prototype.forEach.call(document.querySelectorAll("[data-countdown]"), function (node) {
      var id = node.getAttribute("data-countdown");
      var timer = state.timers.filter(function (t) { return t.id === id; })[0];
      if (timer) node.textContent = L.formatCountdown(L.timerLeftMs(timer, now)) + " left";
    });
  }

  function announce(key) {
    var id = key.slice(2);
    if (key.charAt(0) === "t") {
      var timer = state.timers.filter(function (t) { return t.id === id; })[0];
      if (timer) toast("Time’s up: " + (timer.label || L.formatMinutes(timer.minutes) + " timer"));
      return;
    }
    var item = L.findItem(state, id);
    if (item) toast("Due now: " + item.text);
  }

  // ---- rendering ----

  function scopeKey(listId) {
    return listId || "inbox";
  }

  /** Done lines stay in view on a list (you want to see what is packed) and fold away in the Inbox. */
  function doneShown(listId) {
    var key = scopeKey(listId);
    return key in ui.showDone ? ui.showDone[key] : !!listId;
  }

  function reminderMeta(item, now) {
    if (!item.remindAt || item.done) return null;
    var when = new Date(item.remindAt);
    var label = L.formatWhen(when, now);
    if (when.getTime() <= now.getTime()) return { text: "Due " + label, due: true };
    if (item.handedOff) return { text: "Reminder set for " + label, due: false };
    return { text: "Remind " + label + " · only while Jot is open", due: false };
  }

  function checkButton(item) {
    return h("button", {
      type: "button",
      class: "check",
      role: "checkbox",
      "aria-checked": String(item.done),
      "aria-label": (item.done ? "Uncheck: " : "Check off: ") + item.text,
      "data-act": "toggle",
    }, [h("span", { class: "check-ring" }, [icon("check")])]);
  }

  function itemRow(item, now) {
    var meta = reminderMeta(item, now);
    var cls = "item" + (item.done ? " done" : "") + (meta && meta.due ? " due" : "") + (ui.fresh[item.id] ? " fresh" : "");
    return h("div", { class: cls, "data-id": item.id }, [
      checkButton(item),
      h("button", { type: "button", class: "item-body", "data-act": "open" }, [
        h("span", { class: "item-text", text: item.text }),
        meta && h("span", { class: "item-meta", text: meta.text }),
      ]),
    ]);
  }

  /** `inline` is a list shown folded open on the Lists tab, where there is no box to type in. */
  function renderItems(container, listId, inline) {
    var now = new Date();
    var v = L.visibleItems(state, listId);
    clear(container);
    if (!v.open.length && !v.done.length) {
      var how = "Type a thought above and hit return. Sort it later, or never.";
      if (inline) how = "Tap its name to open it and add lines.";
      else if (listId) how = "Type above and hit return. Paste a few lines to add them all at once.";
      container.appendChild(h("div", { class: "empty" }, [
        h("strong", { text: listId ? "Nothing on this list yet" : "Nothing here yet" }),
        h("span", { text: how }),
      ]));
      return;
    }
    if (!v.open.length) {
      container.appendChild(h("div", { class: "empty" }, [h("strong", { text: listId ? "Everything is checked" : "All clear" })]));
    }
    v.open.forEach(function (item) {
      container.appendChild(itemRow(item, now));
    });
    if (!v.done.length) return;
    var shown = doneShown(listId);
    container.appendChild(h("div", { class: "done-head" }, [
      h("button", { type: "button", class: "done-toggle", "data-act": "done-toggle", "aria-expanded": String(shown) }, [
        icon("chevron"),
        h("span", { text: "Done · " + v.done.length }),
      ]),
      shown && h("button", { type: "button", class: "done-clear link", "data-act": "clear-done", text: "Clear done" }),
    ]));
    if (!shown) return;
    v.done.forEach(function (item) {
      container.appendChild(itemRow(item, now));
    });
  }

  function renderNow() {
    var area = $("nowArea");
    var now = new Date();
    var timers = L.sortedTimers(state);
    var due = L.dueItems(state, now);
    clear(area);
    area.hidden = !timers.length && !due.length;
    if (area.hidden) return;

    timers.forEach(function (t) {
      var left = L.timerLeftMs(t, now);
      var finished = left <= 0;
      area.appendChild(h("div", { class: "now-row" + (finished ? " alert" : "") }, [
        h("span", { class: "now-icon" }, [icon("timer")]),
        h("div", { class: "now-text" }, [
          h("strong", { text: t.label || L.formatMinutes(t.minutes) + " timer" }),
          finished
            ? h("span", { class: "now-sub", text: "Time’s up · " + L.formatMinutes(t.minutes) })
            : h("span", { class: "now-sub", "data-countdown": t.id, text: L.formatCountdown(left) + " left" }),
        ]),
        h("button", { type: "button", class: "now-btn", "data-act": "timer-stop", "data-timer": t.id, text: finished ? "Dismiss" : "Stop" }),
      ]));
    });

    due.forEach(function (item) {
      area.appendChild(h("div", { class: "now-row alert", "data-id": item.id }, [
        checkButton(item),
        h("button", { type: "button", class: "now-text", "data-act": "open" }, [
          h("strong", { text: item.text }),
          h("span", { class: "now-sub", text: "Due " + L.formatWhen(item.remindAt, now) }),
        ]),
        h("button", { type: "button", class: "now-btn", "data-act": "due-clear", text: "Clear" }),
      ]));
    });

    var hereTimers = timers.filter(function (t) { return !t.handedOff; }).length;
    var hereDue = due.filter(function (it) { return !it.handedOff; }).length;
    if (hereTimers || hereDue) {
      var all = hereTimers + hereDue === timers.length + due.length;
      var needsSetup = (hereTimers && !state.settings.timerReady) || (hereDue && !state.settings.reminderReady);
      area.appendChild(h("p", { class: "now-note" }, [
        h("span", { text: (all ? "These only show" : "Some of these only show") + " while Jot is open. " }),
        needsSetup && h("button", { type: "button", class: "link", "data-act": "setup", text: "Set up alerts" }),
      ]));
    }
  }

  function progressText(p) {
    if (!p.total) return "Empty";
    return p.done + " of " + p.total + " checked";
  }

  function renderListCards() {
    var box = $("listCards");
    clear(box);
    if (!state.lists.length) {
      box.appendChild(h("div", { class: "empty" }, [
        h("strong", { text: "No lists yet" }),
        h("span", { text: "Name one above: Beach trip, Costco, Weekend bag." }),
      ]));
      return;
    }
    if (state.lists.length > 1) {
      var allOpen = state.lists.every(function (l) { return l.expanded; });
      box.appendChild(h("div", { class: "lists-tools" }, [
        h("button", { type: "button", class: "link", "data-act": "lists-toggle-all", "data-open": String(!allOpen), text: allOpen ? "Collapse all" : "Expand all" }),
      ]));
    }
    state.lists.forEach(function (list) {
      var p = L.listProgress(state, list.id);
      var meter = null;
      if (p.total) {
        meter = h("span", { class: "meter" }, [h("i")]);
        meter.firstChild.style.width = Math.round((p.done / p.total) * 100) + "%";
      }
      var lines = null;
      if (list.expanded) {
        lines = h("div", { class: "list-card-lines" });
        renderItems(lines, list.id, true);
      }
      box.appendChild(h("div", { class: "list-card" + (list.expanded ? " open" : ""), "data-scope": list.id }, [
        h("div", { class: "list-card-head" }, [
          h("button", {
            type: "button",
            class: "list-card-toggle",
            "data-act": "list-toggle",
            "data-list": list.id,
            "aria-expanded": String(list.expanded),
            "aria-label": (list.expanded ? "Hide the lines of " : "Show the lines of ") + list.name,
          }, [icon("chevron")]),
          h("button", { type: "button", class: "list-card-main", "data-act": "open-list", "data-list": list.id }, [
            h("strong", { text: list.name }),
            h("span", { text: progressText(p) }),
            meter,
          ]),
        ]),
        lines,
      ]));
    });
  }

  // ---- stickies and folders ----

  function stickyCard(note) {
    return h("button", {
      type: "button",
      class: "sticky sticky-" + note.color + (ui.fresh[note.id] ? " fresh" : ""),
      "data-act": "open-note",
      "data-note": note.id,
    }, [h("span", { class: "sticky-text", text: note.text })]);
  }

  function stickyGrid(notes) {
    var grid = h("div", { class: "sticky-grid" });
    notes.forEach(function (note) {
      grid.appendChild(stickyCard(note));
    });
    return grid;
  }

  function renderNotes() {
    var loose = L.notesIn(state, null);
    var box = $("looseNotes");
    clear(box);
    if (!state.notes.length) {
      box.appendChild(h("div", { class: "empty" }, [
        h("strong", { text: "No stickies yet" }),
        h("span", { text: "Type above and hit return. One sticky per thought." }),
      ]));
    } else if (!loose.length) {
      box.appendChild(h("p", { class: "fine loose-empty", text: "Every sticky is in a folder." }));
    } else {
      box.appendChild(stickyGrid(loose));
    }

    $("newFolderForm").hidden = !ui.newFolder;
    $("newFolderBtn").setAttribute("aria-expanded", String(ui.newFolder));
    $("newFolderBtn").textContent = ui.newFolder ? "Cancel" : "New folder";
    $("newFolderInput").placeholder = ui.pendingNoteId ? "Name its new folder…" : "Name a new folder…";
    $("dragHint").hidden = !state.notes.length || !state.folders.length;

    var list = $("folderList");
    clear(list);
    if (!state.folders.length && !ui.newFolder) {
      list.appendChild(h("p", { class: "fine", text: "No folders yet. Make one for each kind of thing: Ideas, House, 3D prints." }));
    }
    state.folders.forEach(function (folder) {
      var notes = L.notesIn(state, folder.id);
      var open = !folder.collapsed;
      var inside = null;
      if (open) inside = notes.length ? stickyGrid(notes) : h("p", { class: "fine folder-empty", text: "Empty. Drag a sticky here." });
      list.appendChild(h("div", { class: "folder" + (open ? " open" : ""), "data-folder": folder.id, "data-drop": "folder:" + folder.id }, [
        h("div", { class: "folder-head" }, [
          h("button", { type: "button", class: "folder-toggle", "data-act": "folder-toggle", "aria-expanded": String(open) }, [
            icon("chevron"),
            icon("folder"),
            h("span", { class: "folder-name", text: folder.name }),
            h("span", { class: "folder-count", text: String(notes.length), "aria-label": plural(notes.length, "sticky") }),
          ]),
          h("button", { type: "button", class: "folder-more", "data-act": "folder-edit", "aria-label": "Rename or delete " + folder.name }, [icon("more")]),
        ]),
        inside,
      ]));
    });
  }

  function renderListDetail() {
    var list = L.findList(state, ui.listId);
    var p = L.listProgress(state, list.id);
    var nameInput = $("listName");
    if (document.activeElement !== nameInput) nameInput.value = list.name;
    $("listInput").placeholder = "Add to " + list.name + "…";
    $("listProgress").textContent = p.total ? progressText(p) : "";
    $("uncheckAllBtn").disabled = !p.done;
    renderItems($("listItems"), list.id);
  }

  function render() {
    // Redrawing would pull the sticky out from under the finger that is dragging it.
    if (drag.active) {
      drag.stale = true;
      return;
    }
    if (ui.view === "list" && !L.findList(state, ui.listId)) {
      ui.view = "lists";
      ui.listId = null;
    }
    var tab = ui.view === "list" ? "lists" : ui.view;
    renderNow();
    $("viewInbox").hidden = ui.view !== "inbox";
    $("viewNotes").hidden = ui.view !== "notes";
    $("viewLists").hidden = ui.view !== "lists";
    $("viewList").hidden = ui.view !== "list";
    $("headerSub").textContent = { inbox: "Get it out of your head", notes: "Stickies and folders", lists: "Packing, shopping, anything" }[tab];
    Array.prototype.forEach.call(document.querySelectorAll(".nav-btn"), function (btn) {
      var on = btn.getAttribute("data-view") === tab;
      btn.classList.toggle("active", on);
      if (on) btn.setAttribute("aria-current", "page");
      else btn.removeAttribute("aria-current");
    });
    if (ui.view === "inbox") renderItems($("inboxItems"), null);
    else if (ui.view === "notes") renderNotes();
    else if (ui.view === "lists") renderListCards();
    else renderListDetail();
    ui.fresh = {};
    ui.alertKey = alertKey(new Date());
  }

  function setView(view, listId) {
    ui.view = view;
    ui.listId = view === "list" ? listId : null;
    ui.newFolder = false;
    ui.pendingNoteId = null;
    render();
    window.scrollTo(0, 0);
  }

  // ---- capture box ----

  function bindCapture(cfg) {
    var input = cfg.input;
    var box = cfg.suggest;
    var parsed = null;

    function refresh() {
      input.style.height = "auto";
      input.style.height = input.scrollHeight + "px";
      parsed = null;
      if (input.value.indexOf("\n") < 0) {
        var p = L.parseCapture(input.value, new Date());
        if (p.suggestion) parsed = p;
      }
      clear(box);
      box.hidden = !parsed;
      if (!parsed) return;
      box.appendChild(h("button", { type: "button", class: "chip", "data-suggest": true }, [
        icon(parsed.suggestion.kind === "timer" ? "timer" : "bell"),
        h("span", { text: parsed.suggestion.label }),
      ]));
      box.appendChild(h("span", { class: "suggest-hint", text: "or hit return to save it as typed" }));
    }

    function reset() {
      input.value = "";
      refresh();
    }

    function saveAsTyped() {
      var lines = L.splitLines(input.value);
      if (!lines.length) {
        reset();
        input.focus();
        return;
      }
      var listId = cfg.listId();
      var now = new Date();
      var next = state;
      lines.slice().reverse().forEach(function (text) {
        var id = L.uid("i");
        ui.fresh[id] = true;
        next = L.addItem(next, { id: id, text: text, listId: listId, now: now });
      });
      reset();
      commit(next);
      if (lines.length > 1) toast("Added " + lines.length + " lines");
      input.focus();
    }

    function useSuggestion() {
      if (!parsed) return;
      var p = parsed;
      reset();
      input.focus();
      if (p.suggestion.kind === "timer") startTimer(p.suggestion.minutes, p.text);
      else addReminderLine(p.text, p.suggestion.at, cfg.listId());
    }

    input.addEventListener("input", refresh);
    input.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
      e.preventDefault();
      saveAsTyped();
    });
    input.addEventListener("beforeinput", function (e) {
      if (e.inputType !== "insertLineBreak") return;
      e.preventDefault();
      saveAsTyped();
    });
    cfg.form.addEventListener("submit", function (e) {
      e.preventDefault();
      saveAsTyped();
    });
    cfg.form.addEventListener("click", function (e) {
      if (!e.target.closest("button")) input.focus();
    });
    // Keeps the cursor (and the phone keyboard) in the box while the chip is tapped.
    box.addEventListener("mousedown", function (e) {
      if (e.target.closest("[data-suggest]")) e.preventDefault();
    });
    box.addEventListener("click", function (e) {
      if (e.target.closest("[data-suggest]")) useSuggestion();
    });

    return { reset: reset };
  }

  // ---- lines ----

  function toggleLine(id) {
    var item = L.findItem(state, id);
    if (!item) return;
    commit(L.toggleItem(state, id, new Date()));
    if (item.done || item.listId) return;
    toast("Checked off", {
      action: "Undo",
      onAction: function () {
        var current = L.findItem(state, id);
        if (current && current.done) commit(L.toggleItem(state, id, new Date()));
      },
    });
  }

  function hasAppleReminder(item) {
    return item.handedOff && !!item.remindAt && Date.parse(item.remindAt) > Date.now();
  }

  function deleteLine(id) {
    var item = L.findItem(state, id);
    if (!item) return;
    var taken = L.takeItems(state, function (it) { return it.id === id; });
    commit(taken.state);
    toast(hasAppleReminder(item) ? "Deleted. Its reminder is still in Reminders." : "Deleted", {
      action: "Undo",
      onAction: function () {
        commit(L.restoreItems(state, taken.removed));
      },
    });
  }

  function clearDone(listId) {
    var taken = L.takeItems(state, function (it) {
      return it.done && (it.listId || null) === (listId || null);
    });
    if (!taken.removed.length) return;
    commit(taken.state);
    toast("Cleared " + plural(taken.removed.length, "done line"), {
      action: "Undo",
      onAction: function () {
        commit(L.restoreItems(state, taken.removed));
      },
    });
  }

  function onMainClick(e) {
    // The click that ends a drag belongs to the drag, not to whatever is under it.
    if (Date.now() < drag.quietUntil) return;
    var actEl = e.target.closest("[data-act]");
    if (!actEl) return;
    var row = actEl.closest("[data-id]");
    var id = row ? row.getAttribute("data-id") : null;
    var scope = actEl.closest("[data-scope]");
    var listId = scope ? scope.getAttribute("data-scope") : ui.view === "list" ? ui.listId : null;
    var folderEl = actEl.closest("[data-folder]");
    var folderId = folderEl ? folderEl.getAttribute("data-folder") : null;
    switch (actEl.getAttribute("data-act")) {
      case "open-note":
        openNoteSheet(actEl.getAttribute("data-note"));
        break;
      case "folder-toggle":
        var folder = L.findFolder(state, folderId);
        if (folder) commit(L.setFolderCollapsed(state, folderId, !folder.collapsed));
        break;
      case "folder-edit":
        openFolderSheet(folderId);
        break;
      case "list-toggle":
        var list = L.findList(state, actEl.getAttribute("data-list"));
        if (list) commit(L.setListExpanded(state, list.id, !list.expanded));
        break;
      case "lists-toggle-all":
        commit(L.setAllListsExpanded(state, actEl.getAttribute("data-open") === "true"));
        break;
      case "toggle":
        toggleLine(id);
        break;
      case "open":
        openItemSheet(id);
        break;
      case "done-toggle":
        ui.showDone[scopeKey(listId)] = !doneShown(listId);
        render();
        break;
      case "clear-done":
        clearDone(listId);
        break;
      case "open-list":
        setView("list", actEl.getAttribute("data-list"));
        break;
      case "timer-stop":
        stopTimer(actEl.getAttribute("data-timer"));
        break;
      case "due-clear":
        commit(L.clearReminder(state, id));
        toast("Reminder cleared");
        break;
      case "setup":
        openSettings();
        break;
    }
  }

  function stopTimer(id) {
    var timer = state.timers.filter(function (t) { return t.id === id; })[0];
    if (!timer) return;
    var running = L.timerLeftMs(timer, new Date()) > 0;
    commit(L.removeTimer(state, id));
    if (running) toast(timer.handedOff ? "Stopped here. The Clock timer is still running." : "Timer stopped");
  }

  // ---- line sheet ----

  function showSheet(id) {
    // A toast left over from the last action would sit on top of the sheet.
    hideToast();
    $(id).hidden = false;
    document.body.classList.add("sheet-open");
  }

  function saveSheetText() {
    var field = $("sheetText");
    if (!field || !ui.sheetItemId) return;
    var next = L.updateItemText(state, ui.sheetItemId, field.value);
    if (next === state) return;
    state = next;
    save();
  }

  function closeSheets() {
    if (!$("itemSheet").hidden) saveSheetText();
    if (!$("noteSheet").hidden) saveNoteSheet();
    $("itemSheet").hidden = true;
    $("noteSheet").hidden = true;
    $("settingsSheet").hidden = true;
    document.body.classList.remove("sheet-open");
    ui.sheetItemId = null;
    ui.sheetPickTime = false;
    ui.sheetOtherTimer = false;
    ui.sheetNoteId = null;
    ui.sheetFolderId = null;
    render();
  }

  function localInputValue(date) {
    function pad(n) { return (n < 10 ? "0" : "") + n; }
    return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) + "T" + pad(date.getHours()) + ":" + pad(date.getMinutes());
  }

  function reminderOptions(now) {
    var options = [{ label: "In 1 hour", when: new Date(now.getTime() + 60 * 60000) }];
    var tonight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 20, 0);
    if (tonight.getTime() - now.getTime() > 30 * 60000) options.push({ label: "Tonight 8 PM", when: tonight });
    options.push({ label: "Tomorrow 9 AM", when: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0) });
    return options;
  }

  function sheetChip(label, action, data, pressed, attr) {
    var attrs = { type: "button", class: "chip quiet", text: label };
    attrs[attr || "data-sheet"] = action;
    Object.keys(data || {}).forEach(function (k) { attrs["data-" + k] = data[k]; });
    if (pressed != null) attrs["aria-pressed"] = String(pressed);
    return h("button", attrs);
  }

  function renderItemSheet() {
    var item = L.findItem(state, ui.sheetItemId);
    if (!item) {
      closeSheets();
      return;
    }
    var now = new Date();
    var body = $("itemSheetBody");
    clear(body);
    body.appendChild(h("div", { class: "sheet-handle" }));

    body.appendChild(h("label", { class: "sr-only", for: "sheetText", text: "Edit this line" }));
    var field = h("textarea", { id: "sheetText", rows: "2", maxlength: "2000", enterkeyhint: "done" });
    field.value = item.text;
    body.appendChild(field);

    body.appendChild(h("p", { class: "sheet-label", text: "Remind me" }));
    var meta = reminderMeta(item, now);
    if (meta) {
      body.appendChild(h("p", { class: "sheet-status" + (meta.due ? " due" : "") }, [
        h("span", { text: meta.text }),
        h("button", { type: "button", class: "link", "data-sheet": "clear-reminder", text: "Clear" }),
      ]));
    }
    var remindRow = h("div", { class: "chip-row" });
    reminderOptions(now).forEach(function (opt) {
      remindRow.appendChild(sheetChip(opt.label, "remind", { when: opt.when.toISOString() }));
    });
    remindRow.appendChild(sheetChip("Pick a time", "pick-time", null, ui.sheetPickTime));
    body.appendChild(remindRow);
    if (ui.sheetPickTime) {
      var whenInput = h("input", { type: "datetime-local", id: "sheetWhen", "aria-label": "Reminder time", min: localInputValue(now) });
      whenInput.value = localInputValue(item.remindAt && Date.parse(item.remindAt) > now.getTime()
        ? new Date(item.remindAt)
        : new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0));
      body.appendChild(h("div", { class: "inline-form" }, [
        whenInput,
        h("button", { type: "button", class: "btn btn-primary", "data-sheet": "set-time", text: "Set" }),
      ]));
    }

    body.appendChild(h("p", { class: "sheet-label", text: "Start a timer" }));
    var timerRow = h("div", { class: "chip-row" });
    TIMER_PRESETS.forEach(function (m) {
      timerRow.appendChild(sheetChip(L.formatMinutes(m), "timer", { minutes: m }));
    });
    timerRow.appendChild(sheetChip("Other", "other-timer", null, ui.sheetOtherTimer));
    body.appendChild(timerRow);
    if (ui.sheetOtherTimer) {
      body.appendChild(h("div", { class: "inline-form" }, [
        h("input", { type: "number", id: "sheetMinutes", inputmode: "numeric", min: "1", max: "1440", placeholder: "Minutes", "aria-label": "Minutes" }),
        h("button", { type: "button", class: "btn btn-primary", "data-sheet": "start-other", text: "Start" }),
      ]));
    }

    body.appendChild(h("p", { class: "sheet-label", text: "Move to" }));
    var moveRow = h("div", { class: "chip-row" });
    var inboxChip = sheetChip("Inbox", "move", { list: "" }, !item.listId);
    inboxChip.disabled = !item.listId;
    moveRow.appendChild(inboxChip);
    state.lists.forEach(function (list) {
      var chip = sheetChip(list.name, "move", { list: list.id }, item.listId === list.id);
      chip.disabled = item.listId === list.id;
      moveRow.appendChild(chip);
    });
    moveRow.appendChild(sheetChip("Make it a sticky", "to-note"));
    body.appendChild(moveRow);
    if (!state.lists.length) {
      body.appendChild(h("p", { class: "fine", text: "Make a list on the Lists tab and it shows up here." }));
    }

    body.appendChild(h("div", { class: "sheet-foot" }, [
      h("button", { type: "button", class: "btn btn-quiet danger-text", "data-sheet": "delete", text: "Delete" }),
      h("button", { type: "button", class: "btn btn-primary", "data-sheet": "done", text: "Done" }),
    ]));
  }

  function openItemSheet(id) {
    if (!L.findItem(state, id)) return;
    ui.sheetItemId = id;
    ui.sheetPickTime = false;
    ui.sheetOtherTimer = false;
    renderItemSheet();
    showSheet("itemSheet");
  }

  function onItemSheetClick(e) {
    var el = e.target.closest("[data-sheet]");
    if (!el) return;
    var id = ui.sheetItemId;
    saveSheetText();
    var item = L.findItem(state, id);
    if (!item) {
      closeSheets();
      return;
    }
    switch (el.getAttribute("data-sheet")) {
      case "remind":
        setItemReminder(id, el.getAttribute("data-when"));
        break;
      case "pick-time":
        ui.sheetPickTime = !ui.sheetPickTime;
        renderItemSheet();
        break;
      case "set-time":
        setItemReminder(id, $("sheetWhen").value);
        break;
      case "clear-reminder":
        var apple = hasAppleReminder(item);
        commit(L.clearReminder(state, id));
        renderItemSheet();
        toast(apple ? "Cleared here. Delete it in Reminders too." : "Reminder cleared");
        break;
      case "timer":
        closeSheets();
        startTimer(Number(el.getAttribute("data-minutes")), item.text);
        break;
      case "other-timer":
        ui.sheetOtherTimer = !ui.sheetOtherTimer;
        renderItemSheet();
        if (ui.sheetOtherTimer) $("sheetMinutes").focus();
        break;
      case "start-other":
        var minutes = Math.round(Number($("sheetMinutes").value));
        if (!(minutes >= 1) || minutes > 1440) {
          toast("Timers run from 1 minute to 24 hours");
          break;
        }
        closeSheets();
        startTimer(minutes, item.text);
        break;
      case "move":
        var target = el.getAttribute("data-list") || null;
        var list = target ? L.findList(state, target) : null;
        commit(L.moveItem(state, id, target));
        closeSheets();
        toast("Moved to " + (list ? list.name : "Inbox"));
        break;
      case "to-note":
        closeSheets();
        lineToSticky(id);
        break;
      case "delete":
        closeSheets();
        deleteLine(id);
        break;
      case "done":
        closeSheets();
        break;
    }
  }

  // ---- stickies ----

  function bindNoteCapture() {
    var form = $("noteCapture");
    var input = $("noteInput");
    var shiftReturn = false;

    function grow() {
      input.style.height = "auto";
      input.style.height = input.scrollHeight + "px";
    }

    function saveNote() {
      var id = L.uid("n");
      var next = L.addNote(state, { id: id, text: input.value, now: new Date() });
      input.value = "";
      grow();
      if (next !== state) {
        ui.fresh[id] = true;
        commit(next);
      }
      input.focus();
    }

    input.addEventListener("input", grow);
    // Return saves, as in the Inbox. Shift+Return on a keyboard starts a new line in the same sticky.
    input.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" || e.isComposing) return;
      shiftReturn = e.shiftKey;
      if (e.shiftKey) return;
      e.preventDefault();
      saveNote();
    });
    input.addEventListener("beforeinput", function (e) {
      if (e.inputType !== "insertLineBreak") return;
      var keep = shiftReturn;
      shiftReturn = false;
      if (keep) return;
      e.preventDefault();
      saveNote();
    });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      saveNote();
    });
    form.addEventListener("click", function (e) {
      if (!e.target.closest("button")) input.focus();
    });
  }

  function fileNote(noteId, folderId) {
    var note = L.findNote(state, noteId);
    if (!note) return;
    var from = note.folderId;
    var next = L.moveNote(state, noteId, folderId);
    if (next === state) return;
    commit(next);
    var folder = L.findFolder(state, L.findNote(state, noteId).folderId);
    toast(folder ? "Moved to " + folder.name : "Taken out of its folder", {
      action: "Undo",
      onAction: function () {
        commit(L.moveNote(state, noteId, from));
      },
    });
  }

  function deleteNote(noteId) {
    var taken = L.takeNote(state, noteId);
    if (!taken.removed) return;
    commit(taken.state);
    toast("Sticky deleted", {
      action: "Undo",
      onAction: function () {
        commit(L.restoreNote(state, taken.removed));
      },
    });
  }

  function lineToSticky(id) {
    var item = L.findItem(state, id);
    if (!item) return;
    var taken = L.takeItems(state, function (it) { return it.id === id; });
    var noteId = L.uid("n");
    var next = L.addNote(taken.state, { id: noteId, text: item.text, now: new Date() });
    if (next === taken.state) return;
    commit(next);
    var reminder = "";
    if (item.remindAt && !item.done) reminder = hasAppleReminder(item) ? " Its reminder is still in Reminders." : " Its reminder was cleared.";
    toast("Now a sticky on Notes." + reminder, {
      action: "Undo",
      onAction: function () {
        commit(L.restoreItems(L.takeNote(state, noteId).state, taken.removed));
      },
    });
  }

  function openNewFolder() {
    ui.newFolder = true;
    render();
    var input = $("newFolderInput");
    input.focus();
    input.scrollIntoView({ block: "center" });
  }

  function closeNewFolder() {
    ui.newFolder = false;
    ui.pendingNoteId = null;
    $("newFolderInput").value = "";
    render();
  }

  function createFolder() {
    var input = $("newFolderInput");
    var id = L.uid("f");
    var next = L.addFolder(state, { id: id, name: input.value, now: new Date() });
    if (next === state) {
      input.focus();
      return;
    }
    var waiting = ui.pendingNoteId && L.findNote(next, ui.pendingNoteId);
    if (waiting) next = L.moveNote(next, waiting.id, id);
    input.value = "";
    ui.newFolder = false;
    ui.pendingNoteId = null;
    commit(next);
    if (waiting) toast("Made " + L.findFolder(state, id).name + " and moved the sticky in");
  }

  function deleteFolder(folderId) {
    var snapshot = L.removeFolder(state, folderId);
    if (!snapshot.folder) return;
    commit(snapshot.state);
    toast("Deleted “" + snapshot.folder.name + "”." + (snapshot.noteIds.length ? " Its stickies are loose now." : ""), {
      action: "Undo",
      onAction: function () {
        commit(L.restoreFolder(state, snapshot));
      },
    });
  }

  // ---- sticky and folder sheet ----

  function saveNoteSheet() {
    var next = state;
    if (ui.sheetNoteId && $("noteText")) next = L.updateNote(next, ui.sheetNoteId, { text: $("noteText").value }, new Date());
    if (ui.sheetFolderId && $("folderName")) next = L.renameFolder(next, ui.sheetFolderId, $("folderName").value);
    if (next === state) return;
    state = next;
    save();
  }

  function sheetFoot(deleteLabel, deleteAction) {
    return h("div", { class: "sheet-foot" }, [
      h("button", { type: "button", class: "btn btn-quiet danger-text", "data-nsheet": deleteAction, text: deleteLabel }),
      h("button", { type: "button", class: "btn btn-primary", "data-nsheet": "done", text: "Done" }),
    ]);
  }

  function renderNoteSheet() {
    var body = $("noteSheetBody");
    var folder = ui.sheetFolderId ? L.findFolder(state, ui.sheetFolderId) : null;
    var note = ui.sheetNoteId ? L.findNote(state, ui.sheetNoteId) : null;
    if (!folder && !note) {
      closeSheets();
      return;
    }
    clear(body);
    body.appendChild(h("div", { class: "sheet-handle" }));

    if (folder) {
      var held = L.notesIn(state, folder.id).length;
      body.appendChild(h("label", { class: "sheet-label first", for: "folderName", text: "Folder name" }));
      var nameField = h("input", { type: "text", id: "folderName", maxlength: "80", autocomplete: "off", enterkeyhint: "done" });
      nameField.value = folder.name;
      body.appendChild(nameField);
      body.appendChild(h("p", { class: "fine sheet-note", text: held ? "Holds " + plural(held, "sticky") + ". Deleting the folder keeps them, loose." : "Nothing in this folder." }));
      body.appendChild(sheetFoot("Delete folder", "delete-folder"));
      return;
    }

    body.appendChild(h("label", { class: "sr-only", for: "noteText", text: "Edit this sticky" }));
    var field = h("textarea", { id: "noteText", class: "sticky-" + note.color, rows: "6", maxlength: "4000" });
    field.value = note.text;
    body.appendChild(field);

    body.appendChild(h("p", { class: "sheet-label", text: "Color" }));
    var swatches = h("div", { class: "chip-row" });
    L.NOTE_COLORS.forEach(function (color) {
      swatches.appendChild(h("button", {
        type: "button",
        class: "swatch sticky-" + color,
        "data-nsheet": "color",
        "data-color": color,
        "aria-pressed": String(note.color === color),
        "aria-label": COLOR_NAMES[color],
      }));
    });
    body.appendChild(swatches);

    body.appendChild(h("p", { class: "sheet-label", text: "Folder" }));
    var folderRow = h("div", { class: "chip-row" });
    var none = sheetChip("No folder", "folder", { folder: "" }, !note.folderId, "data-nsheet");
    none.disabled = !note.folderId;
    folderRow.appendChild(none);
    state.folders.forEach(function (f) {
      var chip = sheetChip(f.name, "folder", { folder: f.id }, note.folderId === f.id, "data-nsheet");
      chip.disabled = note.folderId === f.id;
      folderRow.appendChild(chip);
    });
    body.appendChild(folderRow);
    if (!state.folders.length) {
      body.appendChild(h("p", { class: "fine sheet-note", text: "Make a folder on the Notes page and it shows up here." }));
    }
    body.appendChild(sheetFoot("Delete", "delete"));
  }

  function openNoteSheet(noteId) {
    if (!L.findNote(state, noteId)) return;
    ui.sheetNoteId = noteId;
    ui.sheetFolderId = null;
    renderNoteSheet();
    showSheet("noteSheet");
  }

  function openFolderSheet(folderId) {
    if (!L.findFolder(state, folderId)) return;
    ui.sheetFolderId = folderId;
    ui.sheetNoteId = null;
    renderNoteSheet();
    showSheet("noteSheet");
  }

  function onNoteSheetClick(e) {
    var el = e.target.closest("[data-nsheet]");
    if (!el) return;
    var noteId = ui.sheetNoteId;
    var folderId = ui.sheetFolderId;
    saveNoteSheet();
    switch (el.getAttribute("data-nsheet")) {
      case "color":
        commit(L.updateNote(state, noteId, { color: el.getAttribute("data-color") }, new Date()));
        renderNoteSheet();
        break;
      case "folder":
        closeSheets();
        fileNote(noteId, el.getAttribute("data-folder") || null);
        break;
      case "delete":
        closeSheets();
        deleteNote(noteId);
        break;
      case "delete-folder":
        closeSheets();
        deleteFolder(folderId);
        break;
      case "done":
        closeSheets();
        break;
    }
  }

  // ---- dragging a sticky onto a folder ----

  function cancelPending() {
    if (!drag.pending) return;
    clearTimeout(drag.pending.timer);
    drag.pending = null;
  }

  function onStickyDown(e) {
    if (drag.active || drag.pending) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    var card = e.target.closest(".sticky");
    if (!card) return;
    var touch = e.pointerType !== "mouse";
    drag.pending = {
      id: card.getAttribute("data-note"),
      card: card,
      pointerId: e.pointerId,
      touch: touch,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      // A finger has to rest on the sticky first, so that a swipe still scrolls the page.
      timer: touch ? setTimeout(beginDrag, HOLD_MS) : null,
    };
  }

  /** The tray opens on the half of the screen the finger is not on, so it never covers the sticky being lifted. */
  function dropTray(note, fingerY) {
    var row = h("div", { class: "drop-row" });
    state.folders.forEach(function (f) {
      if (f.id === note.folderId) return;
      row.appendChild(h("div", { class: "drop-chip", "data-drop": "folder:" + f.id }, [icon("folder"), h("span", { text: f.name })]));
    });
    if (note.folderId) row.appendChild(h("div", { class: "drop-chip", "data-drop": "loose" }, [h("span", { text: "No folder" })]));
    row.appendChild(h("div", { class: "drop-chip drop-new", "data-drop": "new-folder" }, [h("span", { text: "+ New folder" })]));
    return h("div", { class: "drop-tray " + (fingerY > window.innerHeight * 0.55 ? "at-top" : "at-bottom"), id: "dropTray" }, [
      h("p", { class: "drop-title", text: "Drop it on a folder" }),
      row,
    ]);
  }

  function beginDrag() {
    var p = drag.pending;
    drag.pending = null;
    if (!p) return;
    clearTimeout(p.timer);
    var note = L.findNote(state, p.id);
    if (!note || !p.card.isConnected) return;
    var rect = p.card.getBoundingClientRect();
    var ghost = p.card.cloneNode(true);
    ghost.className = p.card.className.replace(/\bfresh\b/, "") + " sticky-ghost";
    ghost.removeAttribute("data-act");
    ghost.style.width = rect.width + "px";
    ghost.style.height = rect.height + "px";
    hideToast();
    document.body.appendChild(ghost);
    document.body.appendChild(dropTray(note, p.y));
    document.body.classList.add("dragging");
    p.card.classList.add("lifted");
    drag.active = true;
    drag.stale = false;
    drag.id = p.id;
    drag.pointerId = p.pointerId;
    drag.card = p.card;
    drag.ghost = ghost;
    drag.offX = p.x - rect.left;
    drag.offY = p.y - rect.top;
    drag.over = null;
    moveDrag(p.x, p.y);
    // The sticky rises to sit just above the finger, so the folder under the finger stays in view.
    ghost.getBoundingClientRect();
    ghost.style.top = -Math.round(rect.height + 6 - drag.offY) + "px";
    if (p.touch && navigator.vibrate) navigator.vibrate(12);
  }

  function moveDrag(x, y) {
    drag.ghost.style.transform = "translate(" + Math.round(x - drag.offX) + "px, " + Math.round(y - drag.offY) + "px) rotate(4deg)";
    var under = document.elementFromPoint(x, y);
    var target = under ? under.closest("[data-drop]") : null;
    if (target === drag.over) return;
    if (drag.over) drag.over.classList.remove("drop-over");
    drag.over = target;
    if (target) target.classList.add("drop-over");
  }

  function endDrag(drop) {
    var target = drop && drag.over ? drag.over.getAttribute("data-drop") : null;
    var noteId = drag.id;
    if (drag.over) drag.over.classList.remove("drop-over");
    if (drag.ghost.parentNode) drag.ghost.parentNode.removeChild(drag.ghost);
    var tray = $("dropTray");
    if (tray) tray.parentNode.removeChild(tray);
    drag.card.classList.remove("lifted");
    document.body.classList.remove("dragging");
    drag.active = false;
    drag.over = null;
    drag.ghost = null;
    drag.card = null;
    drag.quietUntil = Date.now() + 300;
    if (drag.stale) render();
    if (!target) return;
    if (target === "new-folder") {
      ui.pendingNoteId = noteId;
      openNewFolder();
    } else if (target === "loose") {
      fileNote(noteId, null);
    } else {
      fileNote(noteId, target.slice("folder:".length));
    }
  }

  function onPointerMove(e) {
    if (drag.active) {
      if (e.pointerId === drag.pointerId) moveDrag(e.clientX, e.clientY);
      return;
    }
    var p = drag.pending;
    if (!p || e.pointerId !== p.pointerId) return;
    p.x = e.clientX;
    p.y = e.clientY;
    var moved = Math.abs(p.x - p.startX) + Math.abs(p.y - p.startY);
    if (p.touch) {
      if (moved > HOLD_SLOP) cancelPending();
    } else if (moved > MOUSE_SLOP) {
      beginDrag();
    }
  }

  function onPointerUp(e) {
    if (drag.active) {
      if (e.pointerId !== drag.pointerId) return;
      moveDrag(e.clientX, e.clientY);
      endDrag(true);
      return;
    }
    cancelPending();
  }

  function onPointerCancel(e) {
    if (drag.active) {
      if (e.pointerId === drag.pointerId) endDrag(false);
      return;
    }
    cancelPending();
  }

  function bindDrag() {
    var notes = $("viewNotes");
    notes.addEventListener("pointerdown", onStickyDown);
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("pointercancel", onPointerCancel);
    // Once a sticky is lifted the page must hold still under the finger.
    document.addEventListener("touchmove", function (e) {
      if (drag.active && e.cancelable) e.preventDefault();
    }, { passive: false });
    notes.addEventListener("contextmenu", function (e) {
      if (e.target.closest(".sticky")) e.preventDefault();
    });
    window.addEventListener("blur", function () {
      if (drag.active) endDrag(false);
      cancelPending();
    });
  }

  // ---- lists ----

  function createList() {
    var input = $("newListInput");
    var id = L.uid("l");
    var next = L.addList(state, { id: id, name: input.value, now: new Date() });
    if (next === state) {
      input.focus();
      return;
    }
    input.value = "";
    state = next;
    save();
    setView("list", id);
    $("listInput").focus();
  }

  function renameCurrentList() {
    var input = $("listName");
    var list = L.findList(state, ui.listId);
    if (!list) return;
    commit(L.renameList(state, list.id, input.value));
    input.value = L.findList(state, list.id).name;
  }

  function uncheckCurrentList() {
    var result = L.uncheckAll(state, ui.listId);
    if (!result.changed.length) return;
    commit(result.state);
    toast("Unchecked " + plural(result.changed.length, "line"), {
      action: "Undo",
      onAction: function () {
        commit(L.recheck(state, result.changed));
      },
    });
  }

  function duplicateCurrentList() {
    var id = L.uid("l");
    var next = L.duplicateList(state, ui.listId, { id: id, now: new Date() });
    if (next === state) return;
    state = next;
    save();
    setView("list", id);
    toast("Copied with nothing checked");
  }

  function deleteCurrentList() {
    var snapshot = L.removeList(state, ui.listId);
    if (!snapshot.list) return;
    state = snapshot.state;
    save();
    setView("lists");
    toast("Deleted “" + snapshot.list.name + "”", {
      action: "Undo",
      onAction: function () {
        commit(L.restoreList(state, snapshot));
      },
    });
  }

  // ---- settings and backup ----

  function fillSettings() {
    $("timerReady").checked = state.settings.timerReady;
    $("reminderReady").checked = state.settings.reminderReady;
    $("timerShortcut").value = state.settings.timerShortcut;
    $("reminderShortcut").value = state.settings.reminderShortcut;
  }

  function saveSettings() {
    commit(L.updateSettings(state, {
      timerReady: $("timerReady").checked,
      reminderReady: $("reminderReady").checked,
      timerShortcut: $("timerShortcut").value,
      reminderShortcut: $("reminderShortcut").value,
    }));
    fillSettings();
  }

  function openSettings() {
    fillSettings();
    showSheet("settingsSheet");
  }

  function exportJson() {
    var payload = {
      app: APP_ID,
      exportedAt: new Date().toISOString(),
      version: state.version,
      items: state.items,
      lists: state.lists,
      notes: state.notes,
      folders: state.folders,
      settings: state.settings,
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = h("a", { href: url, download: "jot-" + new Date().toISOString().slice(0, 10) + ".json" });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast("Exported " + (countList([[state.items.length, "line"], [state.lists.length, "list"], [state.notes.length, "sticky"], [state.folders.length, "folder"]]) || "an empty backup"));
  }

  function importJson(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onerror = function () {
      toast("Couldn’t read that file");
    };
    reader.onload = function () {
      var slice;
      try {
        slice = JSON.parse(reader.result);
      } catch (e) {
        toast("That file isn’t a Jot backup");
        return;
      }
      if (typeof AppsBackup !== "undefined" && AppsBackup.isUnifiedBackup(slice)) {
        slice = AppsBackup.getAppSlice(slice, APP_ID);
        if (!slice) {
          toast("That backup has nothing for Jot");
          return;
        }
      }
      if (!slice || !Array.isArray(slice.items) || !Array.isArray(slice.lists)) {
        toast("That file isn’t a Jot backup");
        return;
      }
      var next = L.mergeState(state, slice);
      var added = countList([
        [next.items.length - state.items.length, "line"],
        [next.lists.length - state.lists.length, "list"],
        [next.notes.length - state.notes.length, "sticky"],
        [next.folders.length - state.folders.length, "folder"],
      ]);
      commit(next);
      toast(added ? "Added " + added : "Nothing new in that file");
    };
    reader.readAsText(file);
  }

  // ---- wiring ----

  function init() {
    captures.inbox = bindCapture({
      form: $("inboxCapture"),
      input: $("inboxInput"),
      suggest: $("inboxSuggest"),
      listId: function () { return null; },
    });
    captures.list = bindCapture({
      form: $("listCapture"),
      input: $("listInput"),
      suggest: $("listSuggest"),
      listId: function () { return ui.listId; },
    });

    bindNoteCapture();
    bindDrag();
    $("newFolderBtn").addEventListener("click", function () {
      if (ui.newFolder) closeNewFolder();
      else openNewFolder();
    });
    $("newFolderForm").addEventListener("submit", function (e) {
      e.preventDefault();
      createFolder();
    });
    $("noteSheetBody").addEventListener("click", onNoteSheetClick);
    $("noteSheetBody").addEventListener("keydown", function (e) {
      if (e.target.id !== "folderName" || e.key !== "Enter" || e.isComposing) return;
      e.preventDefault();
      closeSheets();
    });

    document.querySelector("main").addEventListener("click", onMainClick);
    $("itemSheetBody").addEventListener("click", onItemSheetClick);
    $("itemSheetBody").addEventListener("keydown", function (e) {
      if (e.target.id !== "sheetText" || e.key !== "Enter" || e.shiftKey || e.isComposing) return;
      e.preventDefault();
      closeSheets();
    });

    Array.prototype.forEach.call(document.querySelectorAll(".nav-btn"), function (btn) {
      btn.addEventListener("click", function () {
        setView(btn.getAttribute("data-view"));
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-close-sheet]"), function (btn) {
      btn.addEventListener("click", closeSheets);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && document.body.classList.contains("sheet-open")) closeSheets();
    });
    // A toast can sit over the last button on a short page, so a tap on it clears it.
    $("toast").addEventListener("click", function (e) {
      if (!e.target.closest(".toast-action")) hideToast();
    });

    $("newListForm").addEventListener("submit", function (e) {
      e.preventDefault();
      createList();
    });
    $("backLists").addEventListener("click", function () { setView("lists"); });
    $("listName").addEventListener("change", renameCurrentList);
    $("listName").addEventListener("keydown", function (e) {
      if (e.key === "Enter") $("listName").blur();
    });
    $("uncheckAllBtn").addEventListener("click", uncheckCurrentList);
    $("duplicateBtn").addEventListener("click", duplicateCurrentList);
    $("deleteListBtn").addEventListener("click", deleteCurrentList);

    $("settingsBtn").addEventListener("click", openSettings);
    ["timerReady", "reminderReady", "timerShortcut", "reminderShortcut"].forEach(function (id) {
      $(id).addEventListener("change", saveSettings);
    });
    $("testTimerBtn").addEventListener("click", function () {
      saveSettings();
      handOff(L.timerShortcutUrl(state.settings, 1));
    });
    $("testReminderBtn").addEventListener("click", function () {
      saveSettings();
      handOff(L.reminderShortcutUrl(state.settings, "Jot test", new Date(Date.now() + 150000)));
    });
    $("exportBtn").addEventListener("click", exportJson);
    $("importFile").addEventListener("change", function () {
      importJson($("importFile").files[0]);
      $("importFile").value = "";
    });

    window.addEventListener("storage", function (e) {
      if (e.key !== L.STORAGE_KEY) return;
      state = load();
      render();
    });
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) render();
    });
    window.addEventListener("pageshow", function () { render(); });

    render();
    setInterval(tick, 1000);
    // iPhone will not raise the keyboard without a tap, so only desktop gets focus on open.
    if (window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches) $("inboxInput").focus();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
