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
  };

  var state = load();
  var ui = {
    view: "inbox",
    listId: null,
    showDone: {},
    fresh: {},
    sheetItemId: null,
    sheetPickTime: false,
    sheetOtherTimer: false,
    alertKey: "",
  };
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
    return n + " " + word + (n === 1 ? "" : "s");
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
    toastTimer = setTimeout(hideToast, opts && opts.action ? 6000 : 2800);
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

  function renderItems(container, listId) {
    var now = new Date();
    var v = L.visibleItems(state, listId);
    clear(container);
    if (!v.open.length && !v.done.length) {
      container.appendChild(h("div", { class: "empty" }, [
        h("strong", { text: listId ? "Nothing on this list yet" : "Nothing here yet" }),
        h("span", { text: listId ? "Type above and hit return. Paste a few lines to add them all at once." : "Type a thought above and hit return. Sort it later, or never." }),
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
    state.lists.forEach(function (list) {
      var p = L.listProgress(state, list.id);
      var meter = null;
      if (p.total) {
        meter = h("span", { class: "meter" }, [h("i")]);
        meter.firstChild.style.width = Math.round((p.done / p.total) * 100) + "%";
      }
      box.appendChild(h("button", { type: "button", class: "list-card", "data-act": "open-list", "data-list": list.id }, [
        h("strong", { text: list.name }),
        h("span", { text: progressText(p) }),
        meter,
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
    if (ui.view === "list" && !L.findList(state, ui.listId)) {
      ui.view = "lists";
      ui.listId = null;
    }
    renderNow();
    $("viewInbox").hidden = ui.view !== "inbox";
    $("viewLists").hidden = ui.view !== "lists";
    $("viewList").hidden = ui.view !== "list";
    $("headerSub").textContent = ui.view === "inbox" ? "Get it out of your head" : "Packing, shopping, anything";
    Array.prototype.forEach.call(document.querySelectorAll(".nav-btn"), function (btn) {
      var on = btn.getAttribute("data-view") === (ui.view === "inbox" ? "inbox" : "lists");
      btn.classList.toggle("active", on);
      if (on) btn.setAttribute("aria-current", "page");
      else btn.removeAttribute("aria-current");
    });
    if (ui.view === "inbox") renderItems($("inboxItems"), null);
    else if (ui.view === "lists") renderListCards();
    else renderListDetail();
    ui.fresh = {};
    ui.alertKey = alertKey(new Date());
  }

  function setView(view, listId) {
    ui.view = view;
    ui.listId = view === "list" ? listId : null;
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
    var actEl = e.target.closest("[data-act]");
    if (!actEl) return;
    var row = actEl.closest("[data-id]");
    var id = row ? row.getAttribute("data-id") : null;
    var listId = ui.view === "list" ? ui.listId : null;
    switch (actEl.getAttribute("data-act")) {
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
    $("itemSheet").hidden = true;
    $("settingsSheet").hidden = true;
    document.body.classList.remove("sheet-open");
    ui.sheetItemId = null;
    ui.sheetPickTime = false;
    ui.sheetOtherTimer = false;
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

  function sheetChip(label, action, data, pressed) {
    var attrs = { type: "button", class: "chip quiet", "data-sheet": action, text: label };
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
      case "delete":
        closeSheets();
        deleteLine(id);
        break;
      case "done":
        closeSheets();
        break;
    }
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
      settings: state.settings,
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = h("a", { href: url, download: "jot-" + new Date().toISOString().slice(0, 10) + ".json" });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast("Exported " + plural(state.items.length, "line"));
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
      var lines = next.items.length - state.items.length;
      var lists = next.lists.length - state.lists.length;
      commit(next);
      toast(lines || lists ? "Added " + plural(lines, "line") + " and " + plural(lists, "list") : "Nothing new in that file");
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
