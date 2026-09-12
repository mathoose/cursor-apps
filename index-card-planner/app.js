(function () {
  "use strict";

  var STORAGE_KEY = "index-card-planner-v1";
  var APP_ID = "index-card-planner";
  var toastTimer = null;
  var now = new Date();

  var CARD_COLORS = [
    { id: "cream", label: "Cream", bg: "#fbf6ea", ink: "#3d3428" },
    { id: "butter", label: "Butter", bg: "#f8e89a", ink: "#4a3d12" },
    { id: "blush", label: "Blush", bg: "#f6cdd3", ink: "#5a2c36" },
    { id: "sage", label: "Sage", bg: "#cfe0c4", ink: "#2f3d28" },
    { id: "sky", label: "Sky", bg: "#c5ddf0", ink: "#1e3348" },
    { id: "lilac", label: "Lilac", bg: "#ddd0f0", ink: "#3a2d52" },
    { id: "peach", label: "Peach", bg: "#f3c9a8", ink: "#5a3220" },
  ];

  var WEEKDAY_IDS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

  var DEFAULT_TABS = [
    { id: "inbox", name: "Inbox", color: "#c4b8a8", hint: "Unfiled cards land here until you slide them behind a day." },
    { id: "daily", name: "Daily", color: "#e07a5f", hint: "Routines you pull every morning." },
    { id: "today", name: "Today", color: "#f2cc8f", hint: "This day’s one-offs. Leftovers can move to tomorrow." },
    { id: "mon", name: "Mon", color: "#81b29a", weekday: 1, hint: "Cards you do on Mondays." },
    { id: "tue", name: "Tue", color: "#e07a9a", weekday: 2, hint: "Cards you do on Tuesdays." },
    { id: "wed", name: "Wed", color: "#7eb8da", weekday: 3, hint: "Cards you do on Wednesdays." },
    { id: "thu", name: "Thu", color: "#e9c46a", weekday: 4, hint: "Cards you do on Thursdays." },
    { id: "fri", name: "Fri", color: "#9b8ec4", weekday: 5, hint: "Cards you do on Fridays." },
    { id: "sat", name: "Sat", color: "#f4a261", weekday: 6, hint: "Cards you do on Saturdays." },
    { id: "sun", name: "Sun", color: "#e76f51", weekday: 0, hint: "Cards you do on Sundays." },
    { id: "next", name: "Next", color: "#5c9ead", hint: "Park it here for next week. Monday morning it moves to Inbox." },
    { id: "later", name: "Later", color: "#b088c9", hint: "Someday / not this week." },
    { id: "done", name: "Done", color: "#8a9a8a", hint: "Finished one-off cards. Clear them in Settings." },
  ];

  var REPEAT_LABEL = { none: "Once", daily: "Daily", weekly: "Weekly", monthly: "Monthly" };

  var ui = {
    view: "today",
    pullIndex: 0,
    flipped: false,
    selectedTab: "today",
    editingId: null,
    draft: null,
    filingId: null,
  };

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function pad(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function dateKey(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function parseDateKey(key) {
    if (!key || typeof key !== "string") return null;
    var p = key.split("-");
    if (p.length !== 3) return null;
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return isNaN(d.getTime()) ? null : d;
  }

  function startOfWeek(d) {
    var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var day = x.getDay();
    var diff = day === 0 ? -6 : 1 - day;
    x.setDate(x.getDate() + diff);
    return x;
  }

  function sameWeek(a, b) {
    return dateKey(startOfWeek(a)) === dateKey(startOfWeek(b));
  }

  function sameMonth(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
  }

  function weekdayTabId(d) {
    return WEEKDAY_IDS[d.getDay()];
  }

  function tomorrowDate(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  }

  function colorById(id) {
    var i;
    for (i = 0; i < CARD_COLORS.length; i++) {
      if (CARD_COLORS[i].id === id) return CARD_COLORS[i];
    }
    return CARD_COLORS[0];
  }

  function tabById(data, id) {
    var i;
    for (i = 0; i < data.tabs.length; i++) {
      if (data.tabs[i].id === id) return data.tabs[i];
    }
    return data.tabs[0];
  }

  function defaultData() {
    return {
      version: 1,
      lastOpenDate: dateKey(now),
      tabs: DEFAULT_TABS.map(function (t) {
        return {
          id: t.id,
          name: t.name,
          color: t.color,
          weekday: typeof t.weekday === "number" ? t.weekday : undefined,
          hint: t.hint,
        };
      }),
      cards: [],
    };
  }

  function normalizeCard(raw, idx) {
    var c = raw && typeof raw === "object" ? raw : {};
    var repeat = c.repeat === "daily" || c.repeat === "weekly" || c.repeat === "monthly" ? c.repeat : "none";
    var color = colorById(c.color).id;
    return {
      id: typeof c.id === "string" && c.id ? c.id : uid(),
      title: String(c.title || "").trim().slice(0, 140),
      notes: String(c.notes || "").trim().slice(0, 500),
      color: color,
      tabId: typeof c.tabId === "string" && c.tabId ? c.tabId : "inbox",
      done: !!c.done,
      repeat: repeat,
      createdAt: typeof c.createdAt === "string" ? c.createdAt : new Date().toISOString(),
      completedOn: typeof c.completedOn === "string" ? c.completedOn : null,
      order: typeof c.order === "number" ? c.order : idx || 0,
    };
  }

  function normalizeData(raw) {
    var data = raw && typeof raw === "object" ? raw : defaultData();
    var tabs = Array.isArray(data.tabs) && data.tabs.length ? data.tabs : defaultData().tabs;
    var known = {};
    DEFAULT_TABS.forEach(function (t) { known[t.id] = t; });
    data.tabs = tabs.map(function (t) {
      var base = known[t.id] || {};
      return {
        id: t.id || uid(),
        name: String(t.name || base.name || "Tab").slice(0, 24),
        color: t.color || base.color || "#c4b8a8",
        weekday: typeof t.weekday === "number" ? t.weekday : base.weekday,
        hint: t.hint || base.hint || "",
      };
    });
    DEFAULT_TABS.forEach(function (need) {
      var found = data.tabs.some(function (t) { return t.id === need.id; });
      if (!found) {
        data.tabs.push({
          id: need.id,
          name: need.name,
          color: need.color,
          weekday: need.weekday,
          hint: need.hint,
        });
      }
    });
    data.cards = (Array.isArray(data.cards) ? data.cards : [])
      .map(normalizeCard)
      .filter(function (c) { return c.title; });
    data.version = 1;
    data.lastOpenDate = typeof data.lastOpenDate === "string" ? data.lastOpenDate : dateKey(now);
    return data;
  }

  function applyTime(data, when) {
    var today = dateKey(when);
    var rolledNext = false;
    if (data.lastOpenDate && data.lastOpenDate !== today) {
      var prev = parseDateKey(data.lastOpenDate);
      if (prev && !sameWeek(prev, when)) {
        data.cards.forEach(function (c) {
          if (c.tabId === "next" && !c.done) {
            c.tabId = "inbox";
            rolledNext = true;
          }
        });
      }
    }
    data.cards.forEach(function (c) {
      if (c.repeat === "none" || !c.done || !c.completedOn) return;
      var doneAt = parseDateKey(c.completedOn);
      if (!doneAt) {
        c.done = false;
        return;
      }
      if (c.repeat === "daily" && c.completedOn !== today) c.done = false;
      if (c.repeat === "weekly" && !sameWeek(doneAt, when)) c.done = false;
      if (c.repeat === "monthly" && !sameMonth(doneAt, when)) c.done = false;
    });
    data.lastOpenDate = today;
    data._rolledNext = rolledNext;
    return data;
  }

  function loadData() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      var data = raw ? normalizeData(JSON.parse(raw)) : defaultData();
      return applyTime(data, now);
    } catch (e) {
      return defaultData();
    }
  }

  function saveData(data) {
    var clean = normalizeData(data);
    delete clean._rolledNext;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
  }

  var state = loadData();

  function cardsInTab(tabId) {
    return state.cards
      .filter(function (c) { return c.tabId === tabId; })
      .sort(function (a, b) {
        if (a.done !== b.done) return a.done ? 1 : -1;
        return a.order - b.order;
      });
  }

  function todayPull() {
    var dayId = weekdayTabId(now);
    return state.cards
      .filter(function (c) {
        return c.tabId === "daily" || c.tabId === "today" || c.tabId === dayId;
      })
      .sort(function (a, b) {
        if (a.done !== b.done) return a.done ? 1 : -1;
        if (a.tabId !== b.tabId) {
          var rank = { daily: 0, today: 1 };
          var ar = rank[a.tabId] != null ? rank[a.tabId] : 2;
          var br = rank[b.tabId] != null ? rank[b.tabId] : 2;
          if (ar !== br) return ar - br;
        }
        return a.order - b.order;
      });
  }

  function nextOrder() {
    var max = 0;
    state.cards.forEach(function (c) {
      if (c.order > max) max = c.order;
    });
    return max + 1;
  }

  function findCard(id) {
    var i;
    for (i = 0; i < state.cards.length; i++) {
      if (state.cards[i].id === id) return state.cards[i];
    }
    return null;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function toast(msg) {
    var el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 2200);
  }

  function applyCardColor(el, colorId) {
    var c = colorById(colorId);
    el.style.setProperty("--card-bg", c.bg);
    el.style.setProperty("--card-ink", c.ink);
    el.setAttribute("data-color", c.id);
  }

  function weekdayLong(d) {
    return d.toLocaleDateString(undefined, { weekday: "long" });
  }

  function monthDay(d) {
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function setView(name) {
    ui.view = name;
    document.body.classList.toggle("view-today", name === "today");
    document.body.classList.toggle("view-box", name === "box");
    document.getElementById("headerSub").textContent = name === "today" ? "Today’s pull" : "The card file";
    document.querySelectorAll(".view").forEach(function (el) {
      el.classList.toggle("active", el.dataset.view === name);
    });
    document.querySelectorAll(".nav-btn").forEach(function (btn) {
      var on = btn.dataset.view === name;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    render();
  }

  function renderToday() {
    var pull = todayPull();
    var empty = document.getElementById("todayEmpty");
    var hasCards = pull.length > 0;
    document.body.classList.toggle("hide-stage", !hasCards);
    empty.hidden = hasCards;

    document.getElementById("todayEyebrow").textContent = weekdayLong(now);
    document.getElementById("todayTitle").textContent = monthDay(now);
    document.getElementById("pullLine").textContent =
      "Daily · Today · " + tabById(state, weekdayTabId(now)).name;

    if (!hasCards) return;

    if (ui.pullIndex >= pull.length) ui.pullIndex = pull.length - 1;
    if (ui.pullIndex < 0) ui.pullIndex = 0;

    var card = pull[ui.pullIndex];
    var hero = document.getElementById("heroCard");
    applyCardColor(hero, card.color);
    document.getElementById("heroRuleLeft").textContent = tabById(state, card.tabId).name;
    document.getElementById("heroRuleRight").textContent = (ui.pullIndex + 1) + " / " + pull.length;
    document.getElementById("heroTitle").textContent = card.title;
    document.getElementById("heroTitle").classList.toggle("done", card.done);
    document.getElementById("heroMeta").textContent =
      (REPEAT_LABEL[card.repeat] || "Once") + (card.notes ? " · notes on back" : "");
    document.getElementById("heroNotes").textContent = card.notes || "No notes on the back.";
    document.getElementById("heroCheck").classList.toggle("on", card.done);
    document.getElementById("heroFlip").classList.toggle("flipped", ui.flipped);
    document.getElementById("heroCard").dataset.id = card.id;

    document.getElementById("prevCardBtn").disabled = pull.length < 2;
    document.getElementById("nextCardBtn").disabled = pull.length < 2;

    var dots = document.getElementById("cardDots");
    dots.innerHTML = pull.map(function (c, i) {
      return '<span class="dot' + (i === ui.pullIndex ? " on" : "") + (c.done ? " done" : "") + '"></span>';
    }).join("");

    var left = pull.filter(function (c) { return !c.done; }).length;
    document.getElementById("todayProgress").textContent =
      left === 0 ? "Stack is clear" : left + " left in today’s pull";
    document.getElementById("fileLeftoversBtn").hidden = left === 0;
  }

  function renderBox() {
    var strip = document.getElementById("tabStrip");
    var dayId = weekdayTabId(now);
    strip.innerHTML = state.tabs.map(function (t) {
      var n = cardsInTab(t.id).length;
      var cls = "tab-chip";
      if (t.id === ui.selectedTab) cls += " on";
      if (t.id === dayId || t.id === "today" || t.id === "daily") cls += " today-tab";
      return (
        '<button type="button" class="' + cls + '" data-tab="' + escapeHtml(t.id) + '" style="background:' + t.color + '">' +
          escapeHtml(t.name) +
          '<span class="count">' + n + "</span>" +
        "</button>"
      );
    }).join("");
    var selectedChip = strip.querySelector(".tab-chip.on");
    if (selectedChip && selectedChip.scrollIntoView) {
      selectedChip.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
    }

    var tab = tabById(state, ui.selectedTab);
    var list = cardsInTab(tab.id);
    document.getElementById("pocketEyebrow").textContent = "Divider";
    document.getElementById("pocketTitle").textContent = tab.name;
    document.getElementById("pocketCount").textContent = String(list.length);
    document.getElementById("pocketHint").textContent = tab.hint || "";

    var pocketList = document.getElementById("pocketList");
    var pocketEmpty = document.getElementById("pocketEmpty");
    pocketEmpty.hidden = list.length > 0;
    pocketList.innerHTML = list.map(function (c) {
      var col = colorById(c.color);
      return (
        '<article class="mini-card" data-id="' + escapeHtml(c.id) + '" style="--card-bg:' + col.bg + ";--card-ink:" + col.ink + '">' +
          '<button type="button" class="check' + (c.done ? " on" : "") + '" data-check="' + escapeHtml(c.id) + '" aria-label="Mark done">' +
            '<svg viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg>' +
          "</button>" +
          '<button type="button" class="body" data-edit="' + escapeHtml(c.id) + '">' +
            '<div class="title' + (c.done ? " done" : "") + '">' + escapeHtml(c.title) + "</div>" +
            '<div class="meta">' + escapeHtml(REPEAT_LABEL[c.repeat] || "Once") + (c.notes ? " · notes" : "") + "</div>" +
          "</button>" +
        "</article>"
      );
    }).join("");
  }

  function render() {
    if (ui.view === "today") renderToday();
    else renderBox();
  }

  function persist() {
    saveData(state);
    render();
  }

  function currentPullCard() {
    var pull = todayPull();
    return pull[ui.pullIndex] || null;
  }

  function toggleDone(id) {
    var card = findCard(id);
    if (!card) return;
    card.done = !card.done;
    card.completedOn = card.done ? dateKey(now) : null;
    if (card.done && card.repeat === "none") {
      card.tabId = "done";
      toast("Filed to Done");
    }
    persist();
  }

  function fileCard(id, tabId) {
    var card = findCard(id);
    if (!card) return;
    card.tabId = tabId;
    if (tabId !== "done" && card.repeat === "none") {
      card.done = false;
      card.completedOn = null;
    }
    if (tabId === "done") {
      card.done = true;
      card.completedOn = dateKey(now);
    }
    persist();
    toast("Filed behind " + tabById(state, tabId).name);
  }

  function fileLeftovers() {
    var dest = weekdayTabId(tomorrowDate(now));
    var moved = 0;
    todayPull().forEach(function (c) {
      if (c.done) return;
      if (c.tabId === "daily") return;
      if (c.repeat === "weekly" || c.repeat === "monthly") return;
      c.tabId = dest;
      moved += 1;
    });
    persist();
    toast(moved ? ("Moved " + moved + " to " + tabById(state, dest).name) : "Nothing to file");
  }

  function deleteCard(id) {
    state.cards = state.cards.filter(function (c) { return c.id !== id; });
    persist();
    toast("Card tossed");
  }

  function openEditor(card) {
    ui.editingId = card ? card.id : null;
    ui.draft = card
      ? {
          id: card.id,
          title: card.title,
          notes: card.notes,
          color: card.color,
          tabId: card.tabId,
          repeat: card.repeat,
        }
      : {
          id: uid(),
          title: "",
          notes: "",
          color: "cream",
          tabId: ui.view === "box" ? ui.selectedTab : "today",
          repeat: ui.view === "box" && ui.selectedTab === "daily" ? "daily" : "none",
        };
    if (!card && ui.draft.tabId === "done") ui.draft.tabId = "today";
    document.getElementById("editorTitle").textContent = card ? "Edit card" : "New card";
    document.getElementById("cardTitleInput").value = ui.draft.title;
    document.getElementById("cardNotesInput").value = ui.draft.notes;
    document.getElementById("deleteCardBtn").hidden = !card;
    renderColorChips();
    renderRepeatSeg();
    renderFileChips();
    document.getElementById("editorOverlay").hidden = false;
    setTimeout(function () { document.getElementById("cardTitleInput").focus(); }, 50);
  }

  function closeEditor() {
    document.getElementById("editorOverlay").hidden = true;
    ui.editingId = null;
    ui.draft = null;
  }

  function renderColorChips() {
    var wrap = document.getElementById("colorChips");
    wrap.innerHTML = CARD_COLORS.map(function (c) {
      return (
        '<button type="button" class="color-chip' + (ui.draft.color === c.id ? " on" : "") +
        '" data-color="' + c.id + '" style="background:' + c.bg + '" aria-label="' + c.label + '"></button>'
      );
    }).join("");
  }

  function renderRepeatSeg() {
    document.querySelectorAll("#repeatSeg button").forEach(function (btn) {
      btn.classList.toggle("on", btn.dataset.repeat === ui.draft.repeat);
    });
  }

  function renderFileChips() {
    var wrap = document.getElementById("fileChips");
    wrap.innerHTML = state.tabs.map(function (t) {
      return (
        '<button type="button" class="tab-file-chip' + (ui.draft.tabId === t.id ? " on" : "") +
        '" data-tab="' + escapeHtml(t.id) + '" style="background:' + t.color + '">' +
        escapeHtml(t.name) + "</button>"
      );
    }).join("");
  }

  function saveEditor() {
    if (!ui.draft) return;
    var title = document.getElementById("cardTitleInput").value.trim();
    if (!title) {
      toast("Write a task first");
      return;
    }
    ui.draft.title = title;
    ui.draft.notes = document.getElementById("cardNotesInput").value.trim();
    var existing = findCard(ui.draft.id);
    if (existing) {
      existing.title = ui.draft.title;
      existing.notes = ui.draft.notes;
      existing.color = ui.draft.color;
      existing.tabId = ui.draft.tabId;
      existing.repeat = ui.draft.repeat;
    } else {
      state.cards.push(normalizeCard({
        id: ui.draft.id,
        title: ui.draft.title,
        notes: ui.draft.notes,
        color: ui.draft.color,
        tabId: ui.draft.tabId,
        repeat: ui.draft.repeat,
        order: nextOrder(),
        createdAt: new Date().toISOString(),
      }));
    }
    persist();
    closeEditor();
    toast("Card saved");
  }

  function openFileSheet(id) {
    ui.filingId = id;
    var list = document.getElementById("fileList");
    list.innerHTML = state.tabs.map(function (t) {
      var n = cardsInTab(t.id).length;
      return (
        '<button type="button" class="file-row" data-tab="' + escapeHtml(t.id) + '" style="background:' + t.color + '">' +
          "<span>" + escapeHtml(t.name) + "</span><span class=\"n\">" + n + "</span>" +
        "</button>"
      );
    }).join("");
    document.getElementById("fileOverlay").hidden = false;
  }

  function closeFileSheet() {
    document.getElementById("fileOverlay").hidden = true;
    ui.filingId = null;
  }

  function openSettings() {
    document.getElementById("settingsOverlay").hidden = false;
  }

  function closeSettings() {
    document.getElementById("settingsOverlay").hidden = true;
  }

  function fillSample() {
    var samples = [
      { title: "Make the bed", color: "sage", tabId: "daily", repeat: "daily" },
      { title: "Write one task per card", color: "butter", tabId: "today", repeat: "none", notes: "That’s the whole system. File extras behind a weekday." },
      { title: "Flip through today’s pull", color: "peach", tabId: weekdayTabId(now), repeat: "weekly" },
      { title: "Something I haven’t filed yet", color: "cream", tabId: "inbox", repeat: "none" },
      { title: "Plan next week on Sunday", color: "lilac", tabId: "next", repeat: "weekly" },
      { title: "A someday project", color: "sky", tabId: "later", repeat: "none", notes: "Park it here until it earns a day." },
    ];
    var added = 0;
    samples.forEach(function (s) {
      var exists = state.cards.some(function (c) { return c.title === s.title; });
      if (exists) return;
      state.cards.push(normalizeCard({
        id: uid(),
        title: s.title,
        notes: s.notes || "",
        color: s.color,
        tabId: s.tabId,
        repeat: s.repeat,
        order: nextOrder() + added,
        createdAt: new Date().toISOString(),
      }));
      added += 1;
    });
    persist();
    toast(added ? "Sample cards added" : "Sample cards already in the box");
  }

  function clearDone() {
    var before = state.cards.length;
    state.cards = state.cards.filter(function (c) { return c.tabId !== "done"; });
    persist();
    toast("Cleared " + (before - state.cards.length) + " finished cards");
  }

  function downloadBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function exportJson() {
    var payload = normalizeData(state);
    downloadBlob(
      new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
      "card-box-" + dateKey(now) + ".json"
    );
    toast("Exported");
  }

  function mergeData(existing, incoming) {
    existing = normalizeData(existing);
    incoming = normalizeData(incoming);
    var ids = {};
    existing.cards.forEach(function (c) { ids[c.id] = true; });
    incoming.cards.forEach(function (c) {
      if (!c || !c.title || ids[c.id]) return;
      existing.cards.push(c);
      ids[c.id] = true;
    });
    return existing;
  }

  function importJson(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onerror = function () { toast("Could not read file"); };
    reader.onload = function () {
      try {
        var parsed = JSON.parse(reader.result);
        var slice = parsed;
        if (typeof AppsBackup !== "undefined" && AppsBackup.isUnifiedBackup(parsed)) {
          slice = AppsBackup.getAppSlice(parsed, APP_ID);
          if (!slice) {
            toast("No Card Box data in this file");
            return;
          }
        }
        if (slice && slice.data && Array.isArray(slice.data.cards)) slice = slice.data;
        if (!slice || !Array.isArray(slice.cards)) {
          toast("Invalid backup file");
          return;
        }
        state = mergeData(state, slice);
        state = applyTime(state, now);
        persist();
        toast("Imported cards");
      } catch (e) {
        toast("Could not read file");
      }
    };
    reader.readAsText(file);
  }

  function stepCard(dir) {
    var pull = todayPull();
    if (pull.length < 2) return;
    ui.flipped = false;
    ui.pullIndex = (ui.pullIndex + dir + pull.length) % pull.length;
    renderToday();
  }

  function wireSwipe() {
    var stage = document.getElementById("todayStage");
    var startX = 0;
    var startY = 0;
    var tracking = false;
    stage.addEventListener("touchstart", function (e) {
      if (!e.changedTouches || !e.changedTouches[0]) return;
      startX = e.changedTouches[0].clientX;
      startY = e.changedTouches[0].clientY;
      tracking = true;
    }, { passive: true });
    stage.addEventListener("touchend", function (e) {
      if (!tracking || !e.changedTouches || !e.changedTouches[0]) return;
      tracking = false;
      var dx = e.changedTouches[0].clientX - startX;
      var dy = e.changedTouches[0].clientY - startY;
      if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy)) return;
      stepCard(dx < 0 ? 1 : -1);
    }, { passive: true });
  }

  function closeOverlay(id) {
    document.getElementById(id).hidden = true;
  }

  function wireEvents() {
    document.querySelectorAll(".nav-btn").forEach(function (btn) {
      btn.addEventListener("click", function () { setView(btn.dataset.view); });
    });

    document.getElementById("settingsBtn").addEventListener("click", openSettings);
    document.getElementById("settingsCloseBtn").addEventListener("click", closeSettings);
    document.getElementById("settingsOverlay").addEventListener("click", function (e) {
      if (e.target === e.currentTarget) closeSettings();
    });

    document.getElementById("addCardBtn").addEventListener("click", function () { openEditor(null); });
    document.getElementById("emptyAddBtn").addEventListener("click", function () { openEditor(null); });
    document.getElementById("emptySampleBtn").addEventListener("click", fillSample);
    document.getElementById("sampleBtn").addEventListener("click", function () {
      fillSample();
      closeSettings();
    });

    document.getElementById("prevCardBtn").addEventListener("click", function () { stepCard(-1); });
    document.getElementById("nextCardBtn").addEventListener("click", function () { stepCard(1); });
    document.getElementById("flipCardBtn").addEventListener("click", function () {
      ui.flipped = !ui.flipped;
      renderToday();
    });
    document.getElementById("heroCheck").addEventListener("click", function (e) {
      e.stopPropagation();
      var card = currentPullCard();
      if (card) toggleDone(card.id);
    });
    document.getElementById("editCardBtn").addEventListener("click", function () {
      var card = currentPullCard();
      if (card) openEditor(card);
    });
    document.getElementById("fileCardBtn").addEventListener("click", function () {
      var card = currentPullCard();
      if (card) openFileSheet(card.id);
    });
    document.getElementById("fileLeftoversBtn").addEventListener("click", fileLeftovers);

    document.getElementById("tabStrip").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-tab]");
      if (!btn) return;
      ui.selectedTab = btn.dataset.tab;
      renderBox();
    });

    document.getElementById("pocketList").addEventListener("click", function (e) {
      var check = e.target.closest("[data-check]");
      if (check) {
        toggleDone(check.dataset.check);
        return;
      }
      var edit = e.target.closest("[data-edit]");
      if (edit) openEditor(findCard(edit.dataset.edit));
    });

    document.getElementById("colorChips").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-color]");
      if (!btn || !ui.draft) return;
      ui.draft.color = btn.dataset.color;
      renderColorChips();
    });
    document.getElementById("repeatSeg").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-repeat]");
      if (!btn || !ui.draft) return;
      ui.draft.repeat = btn.dataset.repeat;
      if (ui.draft.repeat === "daily" && ui.draft.tabId === "today") ui.draft.tabId = "daily";
      renderRepeatSeg();
      renderFileChips();
    });
    document.getElementById("fileChips").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-tab]");
      if (!btn || !ui.draft) return;
      ui.draft.tabId = btn.dataset.tab;
      renderFileChips();
    });
    document.getElementById("saveCardBtn").addEventListener("click", saveEditor);
    document.getElementById("deleteCardBtn").addEventListener("click", function () {
      if (!ui.draft || !findCard(ui.draft.id)) {
        closeEditor();
        return;
      }
      deleteCard(ui.draft.id);
      closeEditor();
    });
    document.getElementById("editorOverlay").addEventListener("click", function (e) {
      if (e.target === e.currentTarget) closeEditor();
    });

    document.getElementById("fileList").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-tab]");
      if (!btn || !ui.filingId) return;
      fileCard(ui.filingId, btn.dataset.tab);
      closeFileSheet();
    });
    document.getElementById("fileCloseBtn").addEventListener("click", closeFileSheet);
    document.getElementById("fileOverlay").addEventListener("click", function (e) {
      if (e.target === e.currentTarget) closeFileSheet();
    });

    document.getElementById("clearDoneBtn").addEventListener("click", function () {
      clearDone();
      closeSettings();
    });
    document.getElementById("exportJsonBtn").addEventListener("click", exportJson);
    document.getElementById("importJsonFile").addEventListener("change", function () {
      var f = this.files && this.files[0];
      this.value = "";
      importJson(f);
    });

    document.getElementById("heroCard").addEventListener("click", function (e) {
      if (e.target.closest("#heroCheck")) return;
      var card = currentPullCard();
      if (card) openEditor(card);
    });

    wireSwipe();
  }

  wireEvents();
  if (state._rolledNext) toast("Next-week cards moved to Inbox");
  persist();
})();
