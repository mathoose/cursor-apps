(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.JotLogic = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var STORAGE_KEY = "jot-v1";
  var VERSION = 1;
  var MAX_TEXT = 2000;
  var MAX_NAME = 80;
  var MAX_NOTE = 4000;
  var NOTE_COLORS = ["yellow", "pink", "blue", "green", "orange", "purple"];
  var MAX_TIMER_MINUTES = 24 * 60;
  var DEFAULT_SETTINGS = {
    timerShortcut: "Jot Timer",
    reminderShortcut: "Jot Reminder",
    timerReady: false,
    reminderReady: false,
  };

  var WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  var WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var PART_HOUR = { morning: 9, afternoon: 14, evening: 18, night: 20 };
  var DEFAULT_HOUR = 9;
  var TONIGHT_HOUR = 20;

  // ---- small helpers ----

  function assign(target) {
    for (var i = 1; i < arguments.length; i++) {
      var src = arguments[i];
      if (!src) continue;
      Object.keys(src).forEach(function (k) { target[k] = src[k]; });
    }
    return target;
  }

  function toDate(value) {
    if (value instanceof Date) return new Date(value.getTime());
    if (value == null || value === "") return new Date();
    return new Date(value);
  }

  function toIso(value) {
    return toDate(value).toISOString();
  }

  function isoOrNull(value) {
    if (value == null || value === "") return null;
    var d = new Date(value);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  function cleanText(value, max) {
    return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max || MAX_TEXT);
  }

  function uid(prefix) {
    return (prefix || "j") + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  /** A sticky keeps its line breaks, unlike a jotted line. */
  function cleanNote(value) {
    return String(value == null ? "" : value)
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]+$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, MAX_NOTE);
  }

  /** Pasted text can hold several lines; each becomes its own line in Jot. */
  function splitLines(text) {
    return String(text == null ? "" : text)
      .split(/\r?\n/)
      .map(function (line) { return cleanText(line.replace(/^\s*(?:[-*•]|\[\s?\])\s+/, "")); })
      .filter(Boolean);
  }

  // ---- state ----

  function emptyState() {
    return { version: VERSION, items: [], lists: [], notes: [], folders: [], timers: [], settings: assign({}, DEFAULT_SETTINGS) };
  }

  function normalizeSettings(raw) {
    var src = raw && typeof raw === "object" ? raw : {};
    return {
      timerShortcut: cleanText(src.timerShortcut, 60) || DEFAULT_SETTINGS.timerShortcut,
      reminderShortcut: cleanText(src.reminderShortcut, 60) || DEFAULT_SETTINGS.reminderShortcut,
      timerReady: src.timerReady === true,
      reminderReady: src.reminderReady === true,
    };
  }

  function normalizeState(raw) {
    var src = raw && typeof raw === "object" ? raw : {};
    var lists = [];
    var listIds = {};
    (Array.isArray(src.lists) ? src.lists : []).forEach(function (l) {
      if (!l || typeof l.id !== "string" || !l.id || listIds[l.id]) return;
      listIds[l.id] = true;
      lists.push({
        id: l.id,
        name: cleanText(l.name, MAX_NAME) || "Untitled list",
        createdAt: isoOrNull(l.createdAt) || toIso(),
        expanded: l.expanded === true,
      });
    });

    var folders = [];
    var folderIds = {};
    (Array.isArray(src.folders) ? src.folders : []).forEach(function (f) {
      if (!f || typeof f.id !== "string" || !f.id || folderIds[f.id]) return;
      folderIds[f.id] = true;
      folders.push({
        id: f.id,
        name: cleanText(f.name, MAX_NAME) || "Untitled folder",
        createdAt: isoOrNull(f.createdAt) || toIso(),
        collapsed: f.collapsed === true,
      });
    });

    var notes = [];
    var noteIds = {};
    (Array.isArray(src.notes) ? src.notes : []).forEach(function (n) {
      if (!n || typeof n.id !== "string" || !n.id || noteIds[n.id]) return;
      var text = cleanNote(n.text);
      if (!text) return;
      noteIds[n.id] = true;
      var createdAt = isoOrNull(n.createdAt) || toIso();
      notes.push({
        id: n.id,
        text: text,
        color: NOTE_COLORS.indexOf(n.color) >= 0 ? n.color : NOTE_COLORS[0],
        folderId: typeof n.folderId === "string" && folderIds[n.folderId] ? n.folderId : null,
        createdAt: createdAt,
        updatedAt: isoOrNull(n.updatedAt) || createdAt,
      });
    });

    var items = [];
    var itemIds = {};
    (Array.isArray(src.items) ? src.items : []).forEach(function (it) {
      if (!it || typeof it.id !== "string" || !it.id || itemIds[it.id]) return;
      var text = cleanText(it.text);
      if (!text) return;
      itemIds[it.id] = true;
      var done = it.done === true;
      var remindAt = isoOrNull(it.remindAt);
      items.push({
        id: it.id,
        text: text,
        done: done,
        createdAt: isoOrNull(it.createdAt) || toIso(),
        doneAt: done ? isoOrNull(it.doneAt) || toIso() : null,
        listId: typeof it.listId === "string" && listIds[it.listId] ? it.listId : null,
        remindAt: remindAt,
        handedOff: !!remindAt && it.handedOff === true,
      });
    });

    var timers = [];
    var timerIds = {};
    (Array.isArray(src.timers) ? src.timers : []).forEach(function (t) {
      if (!t || typeof t.id !== "string" || !t.id || timerIds[t.id]) return;
      var endsAt = isoOrNull(t.endsAt);
      var minutes = Math.round(Number(t.minutes));
      if (!endsAt || !(minutes >= 1) || minutes > MAX_TIMER_MINUTES) return;
      timerIds[t.id] = true;
      timers.push({
        id: t.id,
        label: cleanText(t.label, 200),
        minutes: minutes,
        endsAt: endsAt,
        handedOff: t.handedOff === true,
      });
    });

    return {
      version: VERSION,
      items: items,
      lists: lists,
      notes: notes,
      folders: folders,
      timers: timers,
      settings: normalizeSettings(src.settings),
    };
  }

  function findItem(state, id) {
    for (var i = 0; i < state.items.length; i++) if (state.items[i].id === id) return state.items[i];
    return null;
  }

  function findList(state, id) {
    for (var i = 0; i < state.lists.length; i++) if (state.lists[i].id === id) return state.lists[i];
    return null;
  }

  function validListId(state, listId) {
    return listId && findList(state, listId) ? listId : null;
  }

  function mapItem(state, id, fn) {
    var changed = false;
    var items = state.items.map(function (it) {
      if (it.id !== id) return it;
      var next = fn(it);
      if (next !== it) changed = true;
      return next;
    });
    return changed ? assign({}, state, { items: items }) : state;
  }

  /** New lines go on top, so the thing just typed shows up right under the box. */
  function addItem(state, opts) {
    opts = opts || {};
    var text = cleanText(opts.text);
    if (!text) return state;
    var remindAt = isoOrNull(opts.remindAt);
    var item = {
      id: opts.id || uid("i"),
      text: text,
      done: false,
      createdAt: toIso(opts.now),
      doneAt: null,
      listId: validListId(state, opts.listId),
      remindAt: remindAt,
      handedOff: !!remindAt && opts.handedOff === true,
    };
    return assign({}, state, { items: [item].concat(state.items) });
  }

  function updateItemText(state, id, text) {
    var clean = cleanText(text);
    if (!clean) return state;
    return mapItem(state, id, function (it) {
      return it.text === clean ? it : assign({}, it, { text: clean });
    });
  }

  function toggleItem(state, id, now) {
    return mapItem(state, id, function (it) {
      return assign({}, it, { done: !it.done, doneAt: it.done ? null : toIso(now) });
    });
  }

  function setReminder(state, id, when, handedOff) {
    var iso = isoOrNull(when);
    return mapItem(state, id, function (it) {
      return assign({}, it, { remindAt: iso, handedOff: !!iso && handedOff === true });
    });
  }

  function clearReminder(state, id) {
    return setReminder(state, id, null, false);
  }

  function moveItem(state, id, listId) {
    var item = findItem(state, id);
    if (!item) return state;
    var target = validListId(state, listId);
    if (item.listId === target) return state;
    var moved = assign({}, item, { listId: target });
    var rest = state.items.filter(function (it) { return it.id !== id; });
    return assign({}, state, { items: [moved].concat(rest) });
  }

  /** Removes matching lines and reports where they were, so an Undo can put them back. */
  function takeItems(state, predicate) {
    var removed = [];
    var items = [];
    state.items.forEach(function (it, index) {
      if (predicate(it)) removed.push({ item: it, index: index });
      else items.push(it);
    });
    if (!removed.length) return { state: state, removed: removed };
    return { state: assign({}, state, { items: items }), removed: removed };
  }

  function restoreItems(state, removed) {
    var items = state.items.slice();
    var have = {};
    items.forEach(function (it) { have[it.id] = true; });
    (removed || []).slice().sort(function (a, b) { return a.index - b.index; }).forEach(function (entry) {
      if (!entry || !entry.item || have[entry.item.id]) return;
      have[entry.item.id] = true;
      var item = assign({}, entry.item, { listId: validListId(state, entry.item.listId) });
      items.splice(Math.min(Math.max(entry.index, 0), items.length), 0, item);
    });
    return assign({}, state, { items: items });
  }

  function inScope(item, listId) {
    return (item.listId || null) === (listId || null);
  }

  function visibleItems(state, listId) {
    var open = [];
    var done = [];
    state.items.forEach(function (it) {
      if (!inScope(it, listId)) return;
      (it.done ? done : open).push(it);
    });
    done.sort(function (a, b) { return Date.parse(b.doneAt) - Date.parse(a.doneAt); });
    return { open: open, done: done };
  }

  function listProgress(state, listId) {
    var total = 0;
    var done = 0;
    state.items.forEach(function (it) {
      if (!inScope(it, listId)) return;
      total += 1;
      if (it.done) done += 1;
    });
    return { done: done, total: total };
  }

  function addList(state, opts) {
    opts = opts || {};
    var name = cleanText(opts.name, MAX_NAME);
    if (!name) return state;
    var list = { id: opts.id || uid("l"), name: name, createdAt: toIso(opts.now), expanded: false };
    return assign({}, state, { lists: [list].concat(state.lists) });
  }

  function renameList(state, id, name) {
    var clean = cleanText(name, MAX_NAME);
    if (!clean) return state;
    var changed = false;
    var lists = state.lists.map(function (l) {
      if (l.id !== id || l.name === clean) return l;
      changed = true;
      return assign({}, l, { name: clean });
    });
    return changed ? assign({}, state, { lists: lists }) : state;
  }

  function removeList(state, id) {
    var index = -1;
    state.lists.forEach(function (l, i) { if (l.id === id) index = i; });
    if (index < 0) return { state: state, list: null, index: -1, removed: [] };
    var taken = takeItems(state, function (it) { return it.listId === id; });
    var lists = state.lists.filter(function (l) { return l.id !== id; });
    return {
      state: assign({}, taken.state, { lists: lists }),
      list: state.lists[index],
      index: index,
      removed: taken.removed,
    };
  }

  function restoreList(state, snapshot) {
    if (!snapshot || !snapshot.list || findList(state, snapshot.list.id)) return state;
    var lists = state.lists.slice();
    lists.splice(Math.min(Math.max(snapshot.index, 0), lists.length), 0, snapshot.list);
    return restoreItems(assign({}, state, { lists: lists }), snapshot.removed);
  }

  /** Copies a list as a fresh one: same lines, nothing checked, no reminders. */
  function duplicateList(state, id, opts) {
    opts = opts || {};
    var source = findList(state, id);
    if (!source) return state;
    var now = toIso(opts.now);
    var copy = {
      id: opts.id || uid("l"),
      name: cleanText(source.name + " copy", MAX_NAME),
      createdAt: now,
      expanded: false,
    };
    var n = 0;
    var copies = state.items
      .filter(function (it) { return it.listId === id; })
      .map(function (it) {
        n += 1;
        return {
          id: opts.itemId ? opts.itemId(it, n) : uid("i"),
          text: it.text,
          done: false,
          createdAt: now,
          doneAt: null,
          listId: copy.id,
          remindAt: null,
          handedOff: false,
        };
      });
    return assign({}, state, { lists: [copy].concat(state.lists), items: copies.concat(state.items) });
  }

  function uncheckAll(state, listId) {
    var changed = [];
    var items = state.items.map(function (it) {
      if (!inScope(it, listId) || !it.done) return it;
      changed.push({ id: it.id, doneAt: it.doneAt });
      return assign({}, it, { done: false, doneAt: null });
    });
    if (!changed.length) return { state: state, changed: changed };
    return { state: assign({}, state, { items: items }), changed: changed };
  }

  function recheck(state, changed) {
    var byId = {};
    (changed || []).forEach(function (c) { byId[c.id] = c; });
    var items = state.items.map(function (it) {
      var c = byId[it.id];
      if (!c || it.done) return it;
      return assign({}, it, { done: true, doneAt: c.doneAt || toIso() });
    });
    return assign({}, state, { items: items });
  }

  /** Whether a list shows its lines on the Lists tab without being opened. */
  function setListExpanded(state, id, expanded) {
    var want = expanded === true;
    var changed = false;
    var lists = state.lists.map(function (l) {
      if (l.id !== id || l.expanded === want) return l;
      changed = true;
      return assign({}, l, { expanded: want });
    });
    return changed ? assign({}, state, { lists: lists }) : state;
  }

  function setAllListsExpanded(state, expanded) {
    var want = expanded === true;
    var changed = false;
    var lists = state.lists.map(function (l) {
      if (l.expanded === want) return l;
      changed = true;
      return assign({}, l, { expanded: want });
    });
    return changed ? assign({}, state, { lists: lists }) : state;
  }

  // ---- stickies and folders ----

  function findNote(state, id) {
    for (var i = 0; i < state.notes.length; i++) if (state.notes[i].id === id) return state.notes[i];
    return null;
  }

  function findFolder(state, id) {
    for (var i = 0; i < state.folders.length; i++) if (state.folders[i].id === id) return state.folders[i];
    return null;
  }

  function validFolderId(state, folderId) {
    return folderId && findFolder(state, folderId) ? folderId : null;
  }

  /** The next sticky takes the color after the newest one, so neighbours differ. */
  function nextNoteColor(state) {
    if (!state.notes.length) return NOTE_COLORS[0];
    return NOTE_COLORS[(NOTE_COLORS.indexOf(state.notes[0].color) + 1) % NOTE_COLORS.length];
  }

  function addNote(state, opts) {
    opts = opts || {};
    var text = cleanNote(opts.text);
    if (!text) return state;
    var now = toIso(opts.now);
    var note = {
      id: opts.id || uid("n"),
      text: text,
      color: NOTE_COLORS.indexOf(opts.color) >= 0 ? opts.color : nextNoteColor(state),
      folderId: validFolderId(state, opts.folderId),
      createdAt: now,
      updatedAt: now,
    };
    return assign({}, state, { notes: [note].concat(state.notes) });
  }

  function updateNote(state, id, patch, now) {
    patch = patch || {};
    var changed = false;
    var notes = state.notes.map(function (n) {
      if (n.id !== id) return n;
      var text = "text" in patch ? cleanNote(patch.text) || n.text : n.text;
      var color = NOTE_COLORS.indexOf(patch.color) >= 0 ? patch.color : n.color;
      if (text === n.text && color === n.color) return n;
      changed = true;
      return assign({}, n, { text: text, color: color, updatedAt: toIso(now) });
    });
    return changed ? assign({}, state, { notes: notes }) : state;
  }

  /** Files a sticky in a folder, or takes it out when folderId is empty. It lands first in its new place. */
  function moveNote(state, id, folderId) {
    var note = findNote(state, id);
    if (!note) return state;
    var target = validFolderId(state, folderId);
    if (note.folderId === target) return state;
    var moved = assign({}, note, { folderId: target });
    var rest = state.notes.filter(function (n) { return n.id !== id; });
    return assign({}, state, { notes: [moved].concat(rest) });
  }

  function takeNote(state, id) {
    var index = -1;
    state.notes.forEach(function (n, i) { if (n.id === id) index = i; });
    if (index < 0) return { state: state, removed: null };
    var notes = state.notes.filter(function (n) { return n.id !== id; });
    return { state: assign({}, state, { notes: notes }), removed: { note: state.notes[index], index: index } };
  }

  function restoreNote(state, removed) {
    if (!removed || !removed.note || findNote(state, removed.note.id)) return state;
    var notes = state.notes.slice();
    var note = assign({}, removed.note, { folderId: validFolderId(state, removed.note.folderId) });
    notes.splice(Math.min(Math.max(removed.index, 0), notes.length), 0, note);
    return assign({}, state, { notes: notes });
  }

  function notesIn(state, folderId) {
    var target = folderId || null;
    return state.notes.filter(function (n) { return (n.folderId || null) === target; });
  }

  function addFolder(state, opts) {
    opts = opts || {};
    var name = cleanText(opts.name, MAX_NAME);
    if (!name) return state;
    var folder = { id: opts.id || uid("f"), name: name, createdAt: toIso(opts.now), collapsed: false };
    return assign({}, state, { folders: [folder].concat(state.folders) });
  }

  function mapFolder(state, id, fn) {
    var changed = false;
    var folders = state.folders.map(function (f) {
      if (f.id !== id) return f;
      var next = fn(f);
      if (next !== f) changed = true;
      return next;
    });
    return changed ? assign({}, state, { folders: folders }) : state;
  }

  function renameFolder(state, id, name) {
    var clean = cleanText(name, MAX_NAME);
    if (!clean) return state;
    return mapFolder(state, id, function (f) {
      return f.name === clean ? f : assign({}, f, { name: clean });
    });
  }

  function setFolderCollapsed(state, id, collapsed) {
    var want = collapsed === true;
    return mapFolder(state, id, function (f) {
      return f.collapsed === want ? f : assign({}, f, { collapsed: want });
    });
  }

  /** Deleting a folder never deletes stickies: they go back to the loose pile. */
  function removeFolder(state, id) {
    var index = -1;
    state.folders.forEach(function (f, i) { if (f.id === id) index = i; });
    if (index < 0) return { state: state, folder: null, index: -1, noteIds: [] };
    var noteIds = [];
    var notes = state.notes.map(function (n) {
      if (n.folderId !== id) return n;
      noteIds.push(n.id);
      return assign({}, n, { folderId: null });
    });
    var folders = state.folders.filter(function (f) { return f.id !== id; });
    return {
      state: assign({}, state, { folders: folders, notes: notes }),
      folder: state.folders[index],
      index: index,
      noteIds: noteIds,
    };
  }

  /** Puts a deleted folder back, with the stickies it held that have not been filed elsewhere since. */
  function restoreFolder(state, snapshot) {
    if (!snapshot || !snapshot.folder || findFolder(state, snapshot.folder.id)) return state;
    var folders = state.folders.slice();
    folders.splice(Math.min(Math.max(snapshot.index, 0), folders.length), 0, snapshot.folder);
    var back = {};
    (snapshot.noteIds || []).forEach(function (noteId) { back[noteId] = true; });
    var notes = state.notes.map(function (n) {
      return back[n.id] && !n.folderId ? assign({}, n, { folderId: snapshot.folder.id }) : n;
    });
    return assign({}, state, { folders: folders, notes: notes });
  }

  function addTimer(state, opts) {
    opts = opts || {};
    var minutes = Math.round(Number(opts.minutes));
    if (!(minutes >= 1) || minutes > MAX_TIMER_MINUTES) return state;
    var timer = {
      id: opts.id || uid("t"),
      label: cleanText(opts.label, 200),
      minutes: minutes,
      endsAt: new Date(toDate(opts.now).getTime() + minutes * 60000).toISOString(),
      handedOff: opts.handedOff === true,
    };
    return assign({}, state, { timers: [timer].concat(state.timers) });
  }

  function removeTimer(state, id) {
    var timers = state.timers.filter(function (t) { return t.id !== id; });
    return timers.length === state.timers.length ? state : assign({}, state, { timers: timers });
  }

  function timerLeftMs(timer, now) {
    return Date.parse(timer.endsAt) - toDate(now).getTime();
  }

  function sortedTimers(state) {
    return state.timers.slice().sort(function (a, b) { return Date.parse(a.endsAt) - Date.parse(b.endsAt); });
  }

  function dueItems(state, now) {
    var t = toDate(now).getTime();
    return state.items
      .filter(function (it) { return !it.done && it.remindAt && Date.parse(it.remindAt) <= t; })
      .sort(function (a, b) { return Date.parse(a.remindAt) - Date.parse(b.remindAt); });
  }

  function updateSettings(state, patch) {
    return assign({}, state, { settings: normalizeSettings(assign({}, state.settings, patch)) });
  }

  /**
   * Adds whatever the incoming copy has that this phone does not. Nothing here is overwritten.
   * Timers are left out: one from a backup has long since finished.
   */
  function mergeState(existing, incoming) {
    var a = normalizeState(existing);
    var b = normalizeState(incoming);
    function union(mine, theirs) {
      var have = {};
      mine.forEach(function (x) { have[x.id] = true; });
      return mine.concat(theirs.filter(function (x) { return !have[x.id]; }));
    }
    return normalizeState({
      version: VERSION,
      lists: union(a.lists, b.lists),
      items: union(a.items, b.items),
      folders: union(a.folders, b.folders),
      notes: union(a.notes, b.notes),
      timers: a.timers,
      settings: a.settings,
    });
  }

  // ---- formatting ----

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function formatClock(date) {
    var d = toDate(date);
    var h = d.getHours();
    return (h % 12 || 12) + ":" + pad2(d.getMinutes()) + " " + (h < 12 ? "AM" : "PM");
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function dayDiff(date, now) {
    return Math.round((startOfDay(date).getTime() - startOfDay(now).getTime()) / 86400000);
  }

  /** "today 3:00 PM", "tomorrow 9:00 AM", "Fri 9:00 AM", "Dec 4, 9:00 AM". */
  function formatWhen(date, now) {
    var d = toDate(date);
    var n = toDate(now);
    var diff = dayDiff(d, n);
    var clock = formatClock(d);
    if (diff === 0) return "today " + clock;
    if (diff === 1) return "tomorrow " + clock;
    if (diff === -1) return "yesterday " + clock;
    if (diff > 1 && diff < 7) return WEEKDAYS_SHORT[d.getDay()] + " " + clock;
    var day = MONTHS[d.getMonth()].slice(0, 3) + " " + d.getDate();
    if (d.getFullYear() !== n.getFullYear()) day += ", " + d.getFullYear();
    return day + ", " + clock;
  }

  function formatMinutes(minutes) {
    var m = Math.round(Number(minutes)) || 0;
    if (m < 60) return m + " min";
    var h = Math.floor(m / 60);
    var rest = m % 60;
    return h + " hr" + (rest ? " " + rest + " min" : "");
  }

  function formatCountdown(ms) {
    var total = Math.max(0, Math.ceil(ms / 1000));
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    return h ? h + ":" + pad2(m) + ":" + pad2(s) : m + ":" + pad2(s);
  }

  // ---- Shortcuts hand-off ----

  /** Written the way Shortcuts reads a date out of plain text. */
  function shortcutDate(date) {
    var d = toDate(date);
    return MONTHS[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear() + " at " + formatClock(d);
  }

  function shortcutUrl(name, text) {
    return "shortcuts://run-shortcut?name=" + encodeURIComponent(name) + "&input=text&text=" + encodeURIComponent(text);
  }

  function timerShortcutUrl(settings, minutes) {
    return shortcutUrl(normalizeSettings(settings).timerShortcut, String(Math.round(Number(minutes))));
  }

  function reminderShortcutUrl(settings, title, date) {
    var text = (cleanText(title) || "Reminder") + "\n" + shortcutDate(date);
    return shortcutUrl(normalizeSettings(settings).reminderShortcut, text);
  }

  // ---- capture parsing ----

  var HOUR_UNIT = "(?:h|hr|hrs|hour|hours)";
  var MIN_UNIT = "(?:m|min|mins|minute|minutes)";
  var RE_DUR_HM = new RegExp("^(\\d+(?:\\.\\d+)?) ?" + HOUR_UNIT + "(?: ?(?:and )?(\\d{1,2})(?: ?" + MIN_UNIT + ")?)?$");
  var RE_DUR_M = new RegExp("^(\\d+) ?" + MIN_UNIT + "$");
  var RE_TIMER_LEAD = /^(?:(?:set |start )?(?:a )?timer(?: for)? )/;
  var RE_TIMER_TAIL = / timer$/;

  var TIME_SRC = "(?:(\\d{1,2})(?::(\\d{2}))? ?(am|pm|a\\.m\\.?|p\\.m\\.?)?|(noon))";
  var DAY_SRC = "(today|tonight|tomorrow|tmrw|" + WEEKDAYS.join("|") + ")";
  var PART_SRC = "(morning|afternoon|evening|night)";
  var RE_DAY_FIRST = new RegExp("^(?:on )?" + DAY_SRC + "(?: " + PART_SRC + ")?(?: (?:at )?" + TIME_SRC + ")?$");
  var RE_TIME_FIRST = new RegExp("^(at )?" + TIME_SRC + " (?:on )?" + DAY_SRC + "(?: " + PART_SRC + ")?$");
  var RE_TIME_ONLY = new RegExp("^(at )?" + TIME_SRC + "$");

  function normalizePhrase(str) {
    return String(str || "").toLowerCase().replace(/\s+/g, " ").replace(/[.,!?;:]+$/, "").trim();
  }

  /** Minutes for a phrase that is nothing but a duration ("40m", "in 20 min", "timer 10"), else null. */
  function parseDuration(str) {
    var s = normalizePhrase(str);
    if (!s) return null;
    var timerWord = false;
    if (RE_TIMER_LEAD.test(s)) {
      timerWord = true;
      s = s.replace(RE_TIMER_LEAD, "");
    }
    if (RE_TIMER_TAIL.test(s)) {
      timerWord = true;
      s = s.replace(RE_TIMER_TAIL, "");
    }
    s = s.replace(/^(?:in|for) /, "");
    var minutes = null;
    var m = RE_DUR_HM.exec(s);
    if (m) {
      minutes = parseFloat(m[1]) * 60 + (m[2] ? parseInt(m[2], 10) : 0);
    } else if ((m = RE_DUR_M.exec(s))) {
      minutes = parseInt(m[1], 10);
    } else if (timerWord && /^\d+$/.test(s)) {
      minutes = parseInt(s, 10);
    }
    if (minutes == null) return null;
    minutes = Math.round(minutes);
    return minutes >= 1 && minutes <= MAX_TIMER_MINUTES ? minutes : null;
  }

  function readTime(hourText, minuteText, ampmText, noon) {
    if (noon) return { hour: 12, minute: 0, fixed: true };
    if (hourText == null) return null;
    var hour = parseInt(hourText, 10);
    var minute = minuteText != null ? parseInt(minuteText, 10) : 0;
    if (minute > 59) return null;
    if (ampmText) {
      if (hour < 1 || hour > 12) return null;
      var pm = ampmText.charAt(0) === "p";
      return { hour: (hour % 12) + (pm ? 12 : 0), minute: minute, fixed: true };
    }
    if (hour > 23) return null;
    if (hour === 0 || hour >= 13) return { hour: hour, minute: minute, fixed: true };
    return { hour: hour, minute: minute, fixed: false };
  }

  function at(day, hour, minute) {
    return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute, 0, 0);
  }

  function addDays(day, n) {
    return new Date(day.getFullYear(), day.getMonth(), day.getDate() + n);
  }

  /** For "at 3" with no AM/PM: the next 3 o'clock that falls in waking hours. */
  function nextWakingTime(time, now, days) {
    var best = null;
    for (var d = 0; d < days; d++) {
      var day = addDays(now, d);
      [time.hour % 12, (time.hour % 12) + 12].forEach(function (h) {
        if (h < 7) return;
        var candidate = at(day, h, time.minute);
        if (candidate.getTime() <= now.getTime()) return;
        if (!best || candidate.getTime() < best.getTime()) best = candidate;
      });
      if (best) return best;
    }
    return best;
  }

  function guessHour(time, part) {
    if (time.fixed) return time.hour;
    if (part === "morning") return time.hour % 12;
    if (part) return (time.hour % 12) + 12;
    if (time.hour === 12) return 12;
    return time.hour <= 7 ? time.hour + 12 : time.hour;
  }

  /** "buy 2 tomorrow" and "pack 15" are counts, not times: a lone number needs "at", a colon or AM/PM. */
  function isBareNumber(m) {
    return !m[1] && m[2] != null && m[3] == null && !m[4];
  }

  /** A date for a phrase that is nothing but a day and/or time, else null. Never returns a time that has passed. */
  function parseWhen(str, now) {
    var s = normalizePhrase(str);
    if (!s) return null;
    var n = toDate(now);
    var day = null;
    var part = null;
    var time = null;
    var m = RE_DAY_FIRST.exec(s);
    if (m) {
      day = m[1];
      part = m[2] || null;
      time = readTime(m[3], m[4], m[5], m[6]);
      if ((m[3] != null || m[6]) && !time) return null;
    } else if ((m = RE_TIME_FIRST.exec(s))) {
      time = readTime(m[2], m[3], m[4], m[5]);
      if (!time || isBareNumber(m)) return null;
      day = m[6];
      part = m[7] || null;
    } else if ((m = RE_TIME_ONLY.exec(s))) {
      time = readTime(m[2], m[3], m[4], m[5]);
      if (!time || isBareNumber(m)) return null;
    } else {
      return null;
    }

    var result;
    if (!day) {
      if (!time.fixed) return nextWakingTime(time, n, 2);
      result = at(n, time.hour, time.minute);
      if (result.getTime() <= n.getTime()) result = at(addDays(n, 1), time.hour, time.minute);
      return result;
    }

    if (day === "today" || day === "tonight") {
      if (part) return null;
      if (day === "today") {
        if (!time) return null;
        if (!time.fixed) {
          result = nextWakingTime(time, n, 1);
          return result;
        }
        result = at(n, time.hour, time.minute);
      } else if (!time) {
        result = at(n, TONIGHT_HOUR, 0);
      } else {
        if (time.fixed && time.hour < 12) return null;
        result = at(n, time.fixed ? time.hour : (time.hour % 12) + 12, time.minute);
      }
      return result.getTime() > n.getTime() ? result : null;
    }

    var hour = time ? guessHour(time, part) : part ? PART_HOUR[part] : DEFAULT_HOUR;
    var minute = time ? time.minute : 0;
    if (day === "tomorrow" || day === "tmrw") return at(addDays(n, 1), hour, minute);

    var delta = (WEEKDAYS.indexOf(day) - n.getDay() + 7) % 7;
    if (delta === 0) {
      result = at(n, hour, minute);
      if (time && result.getTime() > n.getTime()) return result;
      delta = 7;
    }
    return at(addDays(n, delta), hour, minute);
  }

  function tidyRest(words) {
    var text = words.join(" ");
    text = text.replace(/^remind me (?:to |about )?/i, "");
    text = text.replace(/[\s,;:–-]+$/, "");
    return cleanText(text);
  }

  /**
   * Looks for a time or a duration at the very end or very start of a line.
   * It only suggests: the caller decides whether to use `suggestion`.
   */
  function parseCapture(text, now) {
    var original = cleanText(text);
    var none = { text: original, suggestion: null };
    if (!original) return none;
    var n = toDate(now);
    var words = original.split(" ");
    var maxSpan = Math.min(6, words.length);

    function tryEdge(fromEnd, parser) {
      for (var size = maxSpan; size >= 1; size--) {
        var phrase = fromEnd ? words.slice(-size) : words.slice(0, size);
        var value = parser(phrase.join(" "));
        if (value == null) continue;
        var rest = fromEnd ? words.slice(0, words.length - size) : words.slice(size);
        return { value: value, rest: tidyRest(rest), before: fromEnd && rest.length ? rest[rest.length - 1].toLowerCase() : "" };
      }
      return null;
    }

    function whenParser(phrase) { return parseWhen(phrase, n); }

    var attempts = [
      { kind: "remind", fromEnd: true, parser: whenParser },
      { kind: "timer", fromEnd: true, parser: parseDuration },
      { kind: "remind", fromEnd: false, parser: whenParser },
      { kind: "timer", fromEnd: false, parser: parseDuration },
    ];

    for (var i = 0; i < attempts.length; i++) {
      var hit = tryEdge(attempts[i].fromEnd, attempts[i].parser);
      if (!hit) continue;
      if (attempts[i].kind === "timer") {
        return {
          text: hit.rest,
          suggestion: { kind: "timer", minutes: hit.value, label: "Start " + formatMinutes(hit.value) + " timer" },
        };
      }
      // A reminder with nothing to be reminded of is no use, and "next friday" means different days to different people.
      if (!hit.rest || hit.before === "next") continue;
      return {
        text: hit.rest,
        suggestion: { kind: "remind", at: hit.value.toISOString(), label: "Remind " + formatWhen(hit.value, n) },
      };
    }
    return none;
  }

  return {
    STORAGE_KEY: STORAGE_KEY,
    VERSION: VERSION,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    NOTE_COLORS: NOTE_COLORS,
    uid: uid,
    cleanText: cleanText,
    cleanNote: cleanNote,
    splitLines: splitLines,
    emptyState: emptyState,
    normalizeState: normalizeState,
    findItem: findItem,
    findList: findList,
    addItem: addItem,
    updateItemText: updateItemText,
    toggleItem: toggleItem,
    setReminder: setReminder,
    clearReminder: clearReminder,
    moveItem: moveItem,
    takeItems: takeItems,
    restoreItems: restoreItems,
    visibleItems: visibleItems,
    listProgress: listProgress,
    addList: addList,
    renameList: renameList,
    removeList: removeList,
    restoreList: restoreList,
    duplicateList: duplicateList,
    uncheckAll: uncheckAll,
    recheck: recheck,
    setListExpanded: setListExpanded,
    setAllListsExpanded: setAllListsExpanded,
    findNote: findNote,
    findFolder: findFolder,
    addNote: addNote,
    updateNote: updateNote,
    moveNote: moveNote,
    takeNote: takeNote,
    restoreNote: restoreNote,
    notesIn: notesIn,
    addFolder: addFolder,
    renameFolder: renameFolder,
    setFolderCollapsed: setFolderCollapsed,
    removeFolder: removeFolder,
    restoreFolder: restoreFolder,
    addTimer: addTimer,
    removeTimer: removeTimer,
    timerLeftMs: timerLeftMs,
    sortedTimers: sortedTimers,
    dueItems: dueItems,
    updateSettings: updateSettings,
    mergeState: mergeState,
    formatClock: formatClock,
    formatWhen: formatWhen,
    formatMinutes: formatMinutes,
    formatCountdown: formatCountdown,
    shortcutDate: shortcutDate,
    shortcutUrl: shortcutUrl,
    timerShortcutUrl: timerShortcutUrl,
    reminderShortcutUrl: reminderShortcutUrl,
    parseDuration: parseDuration,
    parseWhen: parseWhen,
    parseCapture: parseCapture,
  };
});
