"use strict";

var assert = require("assert");
var J = require("./logic.js");

// Wednesday, Nov 25, 2026, 2:00 PM local time.
var now = new Date(2026, 10, 25, 14, 0, 0, 0);

function local(y, mo, d, h, mi) {
  return new Date(y, mo - 1, d, h, mi || 0, 0, 0);
}

function when(text, at) {
  var d = J.parseWhen(text, at || now);
  return d ? [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()].join(" ") : null;
}

function suggest(text, at) {
  var p = J.parseCapture(text, at || now);
  if (!p.suggestion) return { text: p.text, kind: null };
  var out = { text: p.text, kind: p.suggestion.kind, label: p.suggestion.label };
  if (p.suggestion.kind === "timer") out.minutes = p.suggestion.minutes;
  return out;
}

// ---- durations ----
assert.strictEqual(J.parseDuration("10m"), 10);
assert.strictEqual(J.parseDuration("10 min"), 10);
assert.strictEqual(J.parseDuration("45 minutes"), 45);
assert.strictEqual(J.parseDuration("1h"), 60);
assert.strictEqual(J.parseDuration("1.5h"), 90);
assert.strictEqual(J.parseDuration("1h 30m"), 90);
assert.strictEqual(J.parseDuration("1h30"), 90);
assert.strictEqual(J.parseDuration("2 hours and 15 minutes"), 135);
assert.strictEqual(J.parseDuration("in 20 min"), 20);
assert.strictEqual(J.parseDuration("for 5 mins"), 5);
assert.strictEqual(J.parseDuration("timer 10"), 10);
assert.strictEqual(J.parseDuration("10 timer"), 10);
assert.strictEqual(J.parseDuration("set a timer for 25 min"), 25);
assert.strictEqual(J.parseDuration("25 min timer."), 25);
assert.strictEqual(J.parseDuration("10"), null);
assert.strictEqual(J.parseDuration("timer"), null);
assert.strictEqual(J.parseDuration("0m"), null);
assert.strictEqual(J.parseDuration("30h"), null);
assert.strictEqual(J.parseDuration("5 miles"), null);

// ---- times ----
assert.strictEqual(when("3pm"), "2026 11 25 15 0");
assert.strictEqual(when("at 3pm"), "2026 11 25 15 0");
assert.strictEqual(when("3:30pm"), "2026 11 25 15 30");
assert.strictEqual(when("3:30 PM"), "2026 11 25 15 30");
assert.strictEqual(when("9 a.m."), "2026 11 26 9 0");
assert.strictEqual(when("1pm"), "2026 11 26 13 0", "a time that has passed today rolls to tomorrow");
assert.strictEqual(when("12am"), "2026 11 26 0 0");
assert.strictEqual(when("noon"), "2026 11 26 12 0");
assert.strictEqual(when("at 15:30"), "2026 11 25 15 30");
assert.strictEqual(when("at 3"), "2026 11 25 15 0", "bare hour picks the next waking 3 o'clock");
assert.strictEqual(when("at 9"), "2026 11 25 21 0");
assert.strictEqual(when("at 9", local(2026, 11, 25, 22)), "2026 11 26 9 0");
assert.strictEqual(when("at 7", local(2026, 11, 25, 6)), "2026 11 25 7 0");
assert.strictEqual(when("4:15"), "2026 11 25 16 15");
assert.strictEqual(when("3"), null, "a lone number is not a time");
assert.strictEqual(when("15"), null);
assert.strictEqual(when("at 30"), null);
assert.strictEqual(when("13pm"), null);
assert.strictEqual(when("3:75pm"), null);

// ---- days ----
assert.strictEqual(when("tonight"), "2026 11 25 20 0");
assert.strictEqual(when("tonight", local(2026, 11, 25, 21)), null, "tonight's default has passed");
assert.strictEqual(when("tonight 9"), "2026 11 25 21 0");
assert.strictEqual(when("tonight at 10:30pm"), "2026 11 25 22 30");
assert.strictEqual(when("tonight 9am"), null);
assert.strictEqual(when("today"), null, "today alone gives nothing to schedule");
assert.strictEqual(when("today 5pm"), "2026 11 25 17 0");
assert.strictEqual(when("today 1pm"), null, "never suggests a time that has passed");
assert.strictEqual(when("today at 4"), "2026 11 25 16 0");
assert.strictEqual(when("tomorrow"), "2026 11 26 9 0");
assert.strictEqual(when("Tomorrow."), "2026 11 26 9 0");
assert.strictEqual(when("tmrw"), "2026 11 26 9 0");
assert.strictEqual(when("tomorrow 9am"), "2026 11 26 9 0");
assert.strictEqual(when("tomorrow at 9"), "2026 11 26 9 0");
assert.strictEqual(when("tomorrow 3"), "2026 11 26 15 0");
assert.strictEqual(when("tomorrow morning"), "2026 11 26 9 0");
assert.strictEqual(when("tomorrow afternoon"), "2026 11 26 14 0");
assert.strictEqual(when("tomorrow evening"), "2026 11 26 18 0");
assert.strictEqual(when("tomorrow night at 9"), "2026 11 26 21 0");
assert.strictEqual(when("tomorrow morning 7"), "2026 11 26 7 0");
assert.strictEqual(when("9am tomorrow"), "2026 11 26 9 0");
assert.strictEqual(when("at 6:30pm on friday"), "2026 11 27 18 30");
assert.strictEqual(when("2 tomorrow"), null, "a count before a day is not a time");
assert.strictEqual(when("friday"), "2026 11 27 9 0");
assert.strictEqual(when("on Friday"), "2026 11 27 9 0");
assert.strictEqual(when("friday 7"), "2026 11 27 19 0");
assert.strictEqual(when("monday 8am"), "2026 11 30 8 0");
assert.strictEqual(when("sunday evening"), "2026 11 29 18 0");
assert.strictEqual(when("wednesday"), "2026 12 2 9 0", "today's weekday means next week");
assert.strictEqual(when("wednesday 5pm"), "2026 11 25 17 0", "unless a later time today is named");
assert.strictEqual(when("wednesday 1pm"), "2026 12 2 13 0");
assert.strictEqual(when("tuesday", local(2026, 12, 30, 10)), "2027 1 5 9 0");
assert.strictEqual(when("someday"), null);
assert.strictEqual(when(""), null);

// ---- capture: reminders ----
assert.deepStrictEqual(suggest("call dentist tomorrow 9am"), {
  text: "call dentist", kind: "remind", label: "Remind tomorrow 9:00 AM",
});
assert.deepStrictEqual(suggest("Call mom at 3"), { text: "Call mom", kind: "remind", label: "Remind today 3:00 PM" });
assert.deepStrictEqual(suggest("dinner with Sam friday 7"), {
  text: "dinner with Sam", kind: "remind", label: "Remind Fri 7:00 PM",
});
assert.deepStrictEqual(suggest("tomorrow call the bank"), {
  text: "call the bank", kind: "remind", label: "Remind tomorrow 9:00 AM",
});
assert.deepStrictEqual(suggest("remind me to take meds tonight"), {
  text: "take meds", kind: "remind", label: "Remind today 8:00 PM",
});
assert.deepStrictEqual(suggest("pay rent, monday"), { text: "pay rent", kind: "remind", label: "Remind Mon 9:00 AM" });
assert.strictEqual(suggest("renew passport tuesday", local(2026, 12, 30, 10)).label, "Remind Tue 9:00 AM");
assert.strictEqual(J.parseCapture("call dentist tomorrow 9am", now).suggestion.at, local(2026, 11, 26, 9).toISOString());

// ---- capture: timers ----
assert.deepStrictEqual(suggest("laundry 40m"), { text: "laundry", kind: "timer", label: "Start 40 min timer", minutes: 40 });
assert.deepStrictEqual(suggest("timer 10"), { text: "", kind: "timer", label: "Start 10 min timer", minutes: 10 });
assert.deepStrictEqual(suggest("check the oven in 20 min"), {
  text: "check the oven", kind: "timer", label: "Start 20 min timer", minutes: 20,
});
assert.deepStrictEqual(suggest("1h 30m focus block"), {
  text: "focus block", kind: "timer", label: "Start 1 hr 30 min timer", minutes: 90,
});
assert.deepStrictEqual(suggest("tea for 4 minutes"), { text: "tea", kind: "timer", label: "Start 4 min timer", minutes: 4 });

// ---- capture: leaves ordinary lines alone ----
[
  "buy milk",
  "pack 3 shirts",
  "buy 2 tomorrow's lunch things",
  "get 15",
  "buy a 2m cable for the printer",
  "read the 5 minute journal intro",
  "tomorrow 9am",
  "tonight",
  "call mom next friday",
  "the monday meeting notes are missing",
  "",
].forEach(function (line) {
  var p = J.parseCapture(line, now);
  assert.strictEqual(p.suggestion, null, "no suggestion for: " + line);
  assert.strictEqual(p.text, line);
});

// ---- formatting ----
assert.strictEqual(J.formatClock(local(2026, 11, 25, 0, 5)), "12:05 AM");
assert.strictEqual(J.formatClock(local(2026, 11, 25, 12, 0)), "12:00 PM");
assert.strictEqual(J.formatWhen(local(2026, 11, 24, 8), now), "yesterday 8:00 AM");
assert.strictEqual(J.formatWhen(local(2026, 12, 1, 9), now), "Tue 9:00 AM");
assert.strictEqual(J.formatWhen(local(2026, 12, 4, 9), now), "Dec 4, 9:00 AM");
assert.strictEqual(J.formatWhen(local(2026, 11, 20, 9), now), "Nov 20, 9:00 AM");
assert.strictEqual(J.formatWhen(local(2027, 1, 15, 9), now), "Jan 15, 2027, 9:00 AM");
assert.strictEqual(J.formatMinutes(5), "5 min");
assert.strictEqual(J.formatMinutes(60), "1 hr");
assert.strictEqual(J.formatMinutes(135), "2 hr 15 min");
assert.strictEqual(J.formatCountdown(40 * 60000), "40:00");
assert.strictEqual(J.formatCountdown(59400), "1:00");
assert.strictEqual(J.formatCountdown(3723000), "1:02:03");
assert.strictEqual(J.formatCountdown(-5000), "0:00");

// ---- Shortcuts links ----
assert.strictEqual(J.shortcutDate(local(2026, 11, 26, 9)), "November 26, 2026 at 9:00 AM");
assert.strictEqual(
  J.timerShortcutUrl(J.DEFAULT_SETTINGS, 40),
  "shortcuts://run-shortcut?name=Jot%20Timer&input=text&text=40"
);
assert.strictEqual(
  J.reminderShortcutUrl(J.DEFAULT_SETTINGS, "Call dentist & pay", local(2026, 11, 26, 9)),
  "shortcuts://run-shortcut?name=Jot%20Reminder&input=text&text=Call%20dentist%20%26%20pay%0ANovember%2026%2C%202026%20at%209%3A00%20AM"
);
assert.strictEqual(
  J.timerShortcutUrl({ timerShortcut: "Kitchen Timer" }, 5),
  "shortcuts://run-shortcut?name=Kitchen%20Timer&input=text&text=5"
);

// ---- lines ----
assert.deepStrictEqual(J.splitLines("socks\n- charger\n\n• passport \r\n[ ] sun  hat"), ["socks", "charger", "passport", "sun hat"]);
assert.deepStrictEqual(J.splitLines("   "), []);

// ---- state ----
var t0 = "2026-11-25T19:00:00.000Z";
var t1 = "2026-11-25T19:05:00.000Z";
var s = J.emptyState();
assert.strictEqual(J.addItem(s, { text: "   " }), s, "blank lines are not saved");
s = J.addItem(s, { id: "a", text: "  buy   milk ", now: t0 });
s = J.addItem(s, { id: "b", text: "call dentist", now: t0, remindAt: "2026-11-26T14:00:00.000Z", handedOff: true });
assert.deepStrictEqual(J.visibleItems(s, null).open.map(function (it) { return it.id; }), ["b", "a"], "newest first");
assert.strictEqual(J.findItem(s, "a").text, "buy milk");
assert.strictEqual(J.findItem(s, "a").listId, null);
assert.strictEqual(J.findItem(s, "b").handedOff, true);
assert.strictEqual(J.findItem(J.addItem(s, { id: "c", text: "x", handedOff: true }), "c").handedOff, false);

var frozen = JSON.stringify(s);
var toggled = J.toggleItem(s, "a", t1);
assert.strictEqual(JSON.stringify(s), frozen, "state is never changed in place");
assert.strictEqual(J.findItem(toggled, "a").done, true);
assert.strictEqual(J.findItem(toggled, "a").doneAt, t1);
assert.deepStrictEqual(J.visibleItems(toggled, null).done.map(function (it) { return it.id; }), ["a"]);
assert.strictEqual(J.findItem(J.toggleItem(toggled, "a", t1), "a").doneAt, null);
assert.strictEqual(J.toggleItem(s, "nope", t1), s);

assert.strictEqual(J.findItem(J.updateItemText(s, "a", "buy oat milk"), "a").text, "buy oat milk");
assert.strictEqual(J.updateItemText(s, "a", "  "), s, "a line cannot be edited to nothing");

// reminders and due
assert.deepStrictEqual(J.dueItems(s, "2026-11-26T13:59:00.000Z"), []);
assert.deepStrictEqual(J.dueItems(s, "2026-11-26T14:00:00.000Z").map(function (it) { return it.id; }), ["b"]);
assert.deepStrictEqual(J.dueItems(J.toggleItem(s, "b", t1), "2026-11-27T00:00:00.000Z"), [], "done lines are never due");
var cleared = J.clearReminder(s, "b");
assert.strictEqual(J.findItem(cleared, "b").remindAt, null);
assert.strictEqual(J.findItem(cleared, "b").handedOff, false);
assert.strictEqual(J.findItem(J.setReminder(s, "a", "2026-11-27T14:00:00.000Z", false), "a").remindAt, "2026-11-27T14:00:00.000Z");

// lists
s = J.addList(s, { id: "beach", name: " Beach  trip ", now: t0 });
assert.strictEqual(J.addList(s, { name: "  " }), s);
assert.strictEqual(J.findList(s, "beach").name, "Beach trip");
s = J.addItem(s, { id: "p1", text: "sunscreen", listId: "beach", now: t0 });
s = J.addItem(s, { id: "p2", text: "towel", listId: "beach", now: t0 });
s = J.addItem(s, { id: "p3", text: "book", listId: "missing-list", now: t0 });
assert.strictEqual(J.findItem(s, "p3").listId, null, "an unknown list falls back to the Inbox");
s = J.moveItem(s, "p3", "beach");
assert.deepStrictEqual(J.visibleItems(s, "beach").open.map(function (it) { return it.id; }), ["p3", "p2", "p1"]);
assert.deepStrictEqual(J.visibleItems(s, null).open.map(function (it) { return it.id; }), ["b", "a"]);
assert.strictEqual(J.moveItem(s, "p3", "beach"), s);
assert.strictEqual(J.findItem(J.moveItem(s, "p3", null), "p3").listId, null);

s = J.toggleItem(s, "p1", t0);
s = J.toggleItem(s, "p2", t1);
assert.deepStrictEqual(J.listProgress(s, "beach"), { done: 2, total: 3 });
assert.deepStrictEqual(J.visibleItems(s, "beach").done.map(function (it) { return it.id; }), ["p2", "p1"], "latest checked first");
assert.strictEqual(J.findList(J.renameList(s, "beach", "Beach week"), "beach").name, "Beach week");
assert.strictEqual(J.renameList(s, "beach", ""), s);

// uncheck all and undo
var unchecked = J.uncheckAll(s, "beach");
assert.deepStrictEqual(J.listProgress(unchecked.state, "beach"), { done: 0, total: 3 });
assert.strictEqual(unchecked.changed.length, 2);
var rechecked = J.recheck(unchecked.state, unchecked.changed);
assert.deepStrictEqual(J.listProgress(rechecked, "beach"), { done: 2, total: 3 });
assert.strictEqual(J.findItem(rechecked, "p1").doneAt, t0);
assert.strictEqual(J.uncheckAll(unchecked.state, "beach").state, unchecked.state);

// duplicate
var dup = J.duplicateList(s, "beach", { id: "beach2", now: t1, itemId: function (it) { return it.id + "-copy"; } });
assert.strictEqual(J.findList(dup, "beach2").name, "Beach trip copy");
assert.strictEqual(dup.lists[0].id, "beach2");
assert.deepStrictEqual(J.visibleItems(dup, "beach2").open.map(function (it) { return it.text; }), ["book", "towel", "sunscreen"]);
assert.deepStrictEqual(J.listProgress(dup, "beach2"), { done: 0, total: 3 });
assert.deepStrictEqual(J.listProgress(dup, "beach"), { done: 2, total: 3 }, "the original keeps its checks");
assert.strictEqual(J.duplicateList(s, "nope"), s);

// delete a line, then undo
var taken = J.takeItems(s, function (it) { return it.id === "a"; });
assert.strictEqual(J.findItem(taken.state, "a"), null);
var between = J.addItem(taken.state, { id: "z", text: "typed before undo", now: t1 });
var restored = J.restoreItems(between, taken.removed);
assert.ok(J.findItem(restored, "a"));
assert.ok(J.findItem(restored, "z"), "undo keeps lines added in the meantime");
assert.strictEqual(J.restoreItems(restored, taken.removed).items.length, restored.items.length, "undo twice adds nothing");
assert.deepStrictEqual(J.restoreItems(taken.state, taken.removed).items, s.items, "undo puts the line back where it was");

// clear done
var clearedDone = J.takeItems(s, function (it) { return it.listId === "beach" && it.done; });
assert.deepStrictEqual(J.listProgress(clearedDone.state, "beach"), { done: 0, total: 1 });
assert.deepStrictEqual(J.restoreItems(clearedDone.state, clearedDone.removed).items, s.items);

// delete a list, then undo
var gone = J.removeList(s, "beach");
assert.strictEqual(J.findList(gone.state, "beach"), null);
assert.strictEqual(gone.removed.length, 3);
assert.strictEqual(gone.state.items.length, 2, "Inbox lines survive");
var back = J.restoreList(gone.state, gone);
assert.deepStrictEqual(back.lists, s.lists);
assert.deepStrictEqual(back.items, s.items);
assert.strictEqual(J.restoreList(back, gone), back);

// timers
s = J.addTimer(s, { id: "t1", label: "Laundry", minutes: 40, now: t0, handedOff: true });
assert.strictEqual(s.timers[0].endsAt, "2026-11-25T19:40:00.000Z");
assert.strictEqual(J.timerLeftMs(s.timers[0], t1), 35 * 60000);
assert.strictEqual(J.addTimer(s, { minutes: 0 }), s);
assert.strictEqual(J.addTimer(s, { minutes: 5000 }), s);
s = J.addTimer(s, { id: "t2", label: "", minutes: 5, now: t0 });
assert.deepStrictEqual(J.sortedTimers(s).map(function (t) { return t.id; }), ["t2", "t1"]);
assert.strictEqual(J.removeTimer(s, "t2").timers.length, 1);
assert.strictEqual(J.removeTimer(s, "nope"), s);

// settings
var set = J.updateSettings(s, { timerReady: true, timerShortcut: "  Kitchen  Timer " });
assert.strictEqual(set.settings.timerReady, true);
assert.strictEqual(set.settings.reminderReady, false);
assert.strictEqual(set.settings.timerShortcut, "Kitchen Timer");
assert.strictEqual(J.updateSettings(s, { reminderShortcut: "" }).settings.reminderShortcut, "Jot Reminder");

// normalising what is read from storage or an import
assert.deepStrictEqual(J.normalizeState(null), J.emptyState());
assert.deepStrictEqual(J.normalizeState("garbage"), J.emptyState());
assert.deepStrictEqual(J.normalizeState(JSON.parse(JSON.stringify(s))), s, "a saved state reads back unchanged");
var messy = J.normalizeState({
  items: [
    null,
    { id: "ok", text: " keep me ", done: true, listId: "ghost", remindAt: "not a date", handedOff: true },
    { id: "ok", text: "duplicate id" },
    { id: "blank", text: "   " },
    { text: "no id" },
  ],
  lists: [{ id: "l1", name: "" }, { id: "l1", name: "again" }, { name: "no id" }],
  timers: [{ id: "bad", minutes: 5, endsAt: "nope" }, { id: "good", minutes: 5, endsAt: t1, label: 7 }],
  settings: { timerReady: "yes", reminderReady: true },
});
assert.strictEqual(messy.items.length, 1);
assert.strictEqual(messy.items[0].text, "keep me");
assert.strictEqual(messy.items[0].listId, null);
assert.strictEqual(messy.items[0].remindAt, null);
assert.strictEqual(messy.items[0].handedOff, false);
assert.ok(messy.items[0].doneAt);
assert.deepStrictEqual(messy.lists.map(function (l) { return l.name; }), ["Untitled list"]);
assert.deepStrictEqual(messy.timers.map(function (t) { return t.id + ":" + t.label; }), ["good:7"]);
assert.deepStrictEqual(messy.settings, {
  timerShortcut: "Jot Timer", reminderShortcut: "Jot Reminder", timerReady: false, reminderReady: true, matrixFilter: "all",
});

// merging an import
var other = J.addItem(J.addList(J.emptyState(), { id: "work", name: "Work", now: t0 }), { id: "w1", text: "email Pat", listId: "work", now: t0 });
other = J.addItem(other, { id: "a", text: "a different version of a", now: t0 });
other = J.updateSettings(other, { timerReady: true });
other = J.addTimer(other, { id: "old-timer", minutes: 5, now: t0 });
var merged = J.mergeState(s, other);
assert.deepStrictEqual(merged.timers, s.timers, "timers in a backup are not brought back");
assert.strictEqual(merged.items.length, s.items.length + 1);
assert.strictEqual(J.findItem(merged, "a").text, "buy milk", "what is already on the phone wins");
assert.strictEqual(J.findItem(merged, "w1").listId, "work");
assert.strictEqual(merged.lists.length, 2);
assert.strictEqual(merged.settings.timerReady, false);
assert.deepStrictEqual(J.mergeState(s, null), s);

// stickies
assert.strictEqual(J.cleanNote("  one  \r\ntwo\n\n\n\nthree \n"), "one\ntwo\n\nthree");
assert.strictEqual(J.cleanNote(" \n \t "), "");
var n = J.emptyState();
assert.strictEqual(J.addNote(n, { text: "   " }), n, "a blank sticky is not saved");
n = J.addNote(n, { id: "n1", text: "shelf for filament\nmaybe pegboard", now: t0 });
n = J.addNote(n, { id: "n2", text: "gift ideas", now: t0 });
n = J.addNote(n, { id: "n3", text: "blue one", color: "blue", now: t0 });
assert.deepStrictEqual(n.notes.map(function (x) { return x.id; }), ["n3", "n2", "n1"], "newest sticky first");
assert.strictEqual(J.findNote(n, "n1").text, "shelf for filament\nmaybe pegboard", "a sticky keeps its line breaks");
assert.deepStrictEqual(n.notes.map(function (x) { return x.color; }), ["blue", "pink", "yellow"]);
assert.strictEqual(J.addNote(n, { id: "n4", text: "x", color: "tartan" }).notes[0].color, "green", "an unknown color falls back to the next one");
assert.strictEqual(J.findNote(n, "n1").folderId, null);

var later = new Date(Date.parse(t0) + 60000);
var edited = J.updateNote(n, "n2", { text: " gift ideas for mom " }, later);
assert.strictEqual(J.findNote(edited, "n2").text, "gift ideas for mom");
assert.strictEqual(J.findNote(edited, "n2").updatedAt, later.toISOString());
assert.strictEqual(J.findNote(edited, "n2").createdAt, t0);
assert.strictEqual(J.updateNote(n, "n2", { text: "gift ideas" }), n, "no change, same state");
assert.strictEqual(J.updateNote(n, "n2", { text: "  " }), n, "a sticky cannot be edited down to nothing");
assert.strictEqual(J.findNote(J.updateNote(n, "n2", { color: "purple" }), "n2").color, "purple");
assert.strictEqual(J.updateNote(n, "n2", { color: "tartan" }), n);
assert.strictEqual(J.updateNote(n, "missing", { text: "x" }), n);

// folders
assert.strictEqual(J.addFolder(n, { name: "  " }), n);
n = J.addFolder(n, { id: "f1", name: " 3D  prints ", now: t0 });
n = J.addFolder(n, { id: "f2", name: "House", now: t0 });
assert.deepStrictEqual(n.folders.map(function (f) { return f.name; }), ["House", "3D prints"]);
assert.strictEqual(J.findFolder(n, "f1").collapsed, false);
var filed = J.moveNote(n, "n1", "f1");
assert.strictEqual(J.findNote(filed, "n1").folderId, "f1");
assert.strictEqual(filed.notes[0].id, "n1", "a moved sticky lands first");
assert.strictEqual(J.moveNote(filed, "n1", "f1"), filed, "already there, same state");
assert.strictEqual(J.moveNote(n, "n1", "no-such-folder"), n, "an unknown folder is the loose pile");
assert.strictEqual(J.moveNote(n, "missing", "f1"), n);
assert.strictEqual(J.findNote(J.moveNote(filed, "n1", null), "n1").folderId, null);
filed = J.moveNote(filed, "n2", "f1");
assert.deepStrictEqual(J.notesIn(filed, "f1").map(function (x) { return x.id; }), ["n2", "n1"]);
assert.deepStrictEqual(J.notesIn(filed, null).map(function (x) { return x.id; }), ["n3"]);
assert.strictEqual(J.addNote(filed, { id: "n9", text: "straight in", folderId: "f2" }).notes[0].folderId, "f2");

assert.strictEqual(J.findFolder(J.renameFolder(filed, "f1", " Printer "), "f1").name, "Printer");
assert.strictEqual(J.renameFolder(filed, "f1", ""), filed);
assert.strictEqual(J.renameFolder(filed, "f1", "3D prints"), filed);
var folded = J.setFolderCollapsed(filed, "f1", true);
assert.strictEqual(J.findFolder(folded, "f1").collapsed, true);
assert.strictEqual(J.setFolderCollapsed(folded, "f1", true), folded);
assert.strictEqual(J.findFolder(J.setFolderCollapsed(folded, "f1", false), "f1").collapsed, false);

// deleting a sticky and putting it back
var takenNote = J.takeNote(filed, "n1");
assert.strictEqual(J.findNote(takenNote.state, "n1"), null);
assert.strictEqual(takenNote.removed.index, 1);
assert.deepStrictEqual(J.restoreNote(takenNote.state, takenNote.removed), filed);
assert.strictEqual(J.restoreNote(filed, takenNote.removed), filed, "restoring twice adds nothing");
assert.strictEqual(J.takeNote(filed, "missing").removed, null);

// deleting a folder keeps its stickies, and Undo files them again
var goneFolder = J.removeFolder(filed, "f1");
assert.strictEqual(J.findFolder(goneFolder.state, "f1"), null);
assert.strictEqual(goneFolder.state.notes.length, 3, "no sticky is deleted with its folder");
assert.deepStrictEqual(J.notesIn(goneFolder.state, null).map(function (x) { return x.id; }), ["n2", "n1", "n3"]);
assert.deepStrictEqual(goneFolder.noteIds, ["n2", "n1"]);
assert.deepStrictEqual(J.restoreFolder(goneFolder.state, goneFolder), filed);
var refiled = J.moveNote(goneFolder.state, "n1", "f2");
var backFolder = J.restoreFolder(refiled, goneFolder);
assert.strictEqual(J.findNote(backFolder, "n1").folderId, "f2", "a sticky filed elsewhere since stays there");
assert.strictEqual(J.findNote(backFolder, "n2").folderId, "f1");
assert.strictEqual(J.removeFolder(filed, "missing").folder, null);
var restoredInto = J.restoreNote(goneFolder.state, takenNote.removed);
assert.strictEqual(restoredInto, goneFolder.state, "n1 is still there, so nothing is added");
assert.strictEqual(J.restoreNote(J.takeNote(goneFolder.state, "n1").state, takenNote.removed).notes[1].folderId, null, "a sticky restored after its folder is gone comes back loose");

// lists fold open and shut on the Lists tab
var ex = J.addList(J.addList(J.emptyState(), { id: "la", name: "A", now: t0 }), { id: "lb", name: "B", now: t0 });
assert.strictEqual(J.findList(ex, "la").expanded, false);
var exA = J.setListExpanded(ex, "la", true);
assert.strictEqual(J.findList(exA, "la").expanded, true);
assert.strictEqual(J.findList(exA, "lb").expanded, false);
assert.strictEqual(J.setListExpanded(exA, "la", true), exA);
assert.strictEqual(J.setListExpanded(ex, "missing", true), ex);
var exAll = J.setAllListsExpanded(exA, true);
assert.deepStrictEqual(exAll.lists.map(function (l) { return l.expanded; }), [true, true]);
assert.strictEqual(J.setAllListsExpanded(exAll, true), exAll);
assert.deepStrictEqual(J.setAllListsExpanded(exAll, false).lists.map(function (l) { return l.expanded; }), [false, false]);
assert.strictEqual(J.duplicateList(exAll, "la", { id: "lc", now: t0 }).lists[0].expanded, false);

// stickies and folders through storage and a merge
assert.deepStrictEqual(J.normalizeState(JSON.parse(JSON.stringify(folded))), folded, "stickies and folders read back unchanged");
var old = J.normalizeState({ version: 1, items: [], lists: [{ id: "l1", name: "Old list" }], settings: {} });
assert.deepStrictEqual(old.notes, [], "data saved before stickies existed still loads");
assert.deepStrictEqual(old.folders, []);
assert.strictEqual(old.lists[0].expanded, false);
var messyNotes = J.normalizeState({
  folders: [{ id: "f1", name: "" }, { id: "f1", name: "dupe" }, { name: "no id" }],
  notes: [
    { id: "a", text: "kept", folderId: "f1", color: "pink" },
    { id: "b", text: "lost folder", folderId: "nope", color: "tartan" },
    { id: "a", text: "dupe" },
    { id: "c", text: "  " },
  ],
});
assert.deepStrictEqual(messyNotes.folders.map(function (f) { return f.name; }), ["Untitled folder"]);
assert.deepStrictEqual(messyNotes.notes.map(function (x) { return [x.id, x.folderId, x.color]; }), [["a", "f1", "pink"], ["b", null, "yellow"]]);
var theirs = J.addNote(J.addFolder(J.emptyState(), { id: "f9", name: "Trips", now: t0 }), { id: "n9", text: "Lisbon", folderId: "f9", now: t0 });
theirs = J.addNote(theirs, { id: "n1", text: "their version of n1", now: t0 });
var both = J.mergeState(filed, theirs);
assert.strictEqual(both.notes.length, filed.notes.length + 1);
assert.strictEqual(J.findNote(both, "n1").text, "shelf for filament\nmaybe pegboard", "the sticky already on the phone wins");
assert.strictEqual(J.findNote(both, "n9").folderId, "f9", "an imported sticky keeps its folder");
assert.strictEqual(both.folders.length, 3);

// importance and the matrix
var m = J.addList(J.emptyState(), { id: "trip", name: "Trip", now: t0 });
m = J.addItem(m, { id: "m1", text: "renew passport", now: t0 });
m = J.addItem(m, { id: "m2", text: "book the kennel", listId: "trip", now: t0 });
m = J.addItem(m, { id: "m3", text: "buy sunscreen", listId: "trip", priority: 2, now: t0 });
m = J.addItem(m, { id: "m4", text: "sort photos", priority: "urgent", now: t0 });
assert.deepStrictEqual(m.items.map(function (it) { return it.priority; }), [0, 2, 0, 0], "a new line has no importance unless one is given");
var ranked = J.setPriority(m, "m1", 3);
assert.strictEqual(J.findItem(ranked, "m1").priority, 3);
assert.strictEqual(J.setPriority(ranked, "m1", 3), ranked, "no change, same state");
assert.strictEqual(J.setPriority(m, "missing", 3), m);
assert.strictEqual(J.findItem(J.setPriority(ranked, "m1", 7), "m1").priority, 0, "an unknown importance clears it");
ranked = J.setPriority(ranked, "m2", 1);
var groups = J.matrixItems(ranked, "all");
assert.deepStrictEqual(J.PRIORITIES, [3, 2, 1, 0]);
assert.deepStrictEqual(J.PRIORITIES.map(function (p) { return groups[p].map(function (it) { return it.id; }); }), [["m1"], ["m3"], ["m2"], ["m4"]]);
assert.strictEqual(J.openCount(ranked, "all"), 4);
var inboxOnly = J.matrixItems(ranked, "inbox");
assert.deepStrictEqual([inboxOnly[3].length, inboxOnly[2].length, inboxOnly[1].length, inboxOnly[0].length], [1, 0, 0, 1]);
assert.strictEqual(J.openCount(ranked, "inbox"), 2);
var tripOnly = J.matrixItems(ranked, "trip");
assert.deepStrictEqual([tripOnly[3].length, tripOnly[2].length, tripOnly[1].length, tripOnly[0].length], [0, 1, 1, 0]);
assert.strictEqual(J.matrixFilter(ranked, "trip"), "trip");
assert.strictEqual(J.matrixFilter(ranked, "inbox"), "inbox");
assert.strictEqual(J.matrixFilter(ranked, "deleted-list"), "all", "a filter on a list that is gone shows everything");
assert.strictEqual(J.openCount(ranked, "deleted-list"), 4);
var checked = J.toggleItem(ranked, "m1", t0);
assert.deepStrictEqual(J.matrixItems(checked, "all")[3], [], "a checked line leaves the matrix");
assert.strictEqual(J.findItem(J.toggleItem(checked, "m1", t0), "m1").priority, 3, "and keeps its importance when unchecked");
assert.strictEqual(J.findItem(J.moveItem(ranked, "m1", "trip"), "m1").priority, 3, "moving a line keeps its importance");
var tripCopy = J.duplicateList(ranked, "trip", { id: "trip2", now: t0 });
assert.deepStrictEqual(tripCopy.items.filter(function (it) { return it.listId === "trip2"; }).map(function (it) { return it.priority; }), [2, 1], "a copied list keeps importance");
assert.deepStrictEqual(J.normalizeState(JSON.parse(JSON.stringify(ranked))), ranked, "importance reads back unchanged");
assert.deepStrictEqual(J.normalizeState({ items: [{ id: "x", text: "old line" }, { id: "y", text: "odd", priority: "3" }] }).items.map(function (it) { return it.priority; }), [0, 0], "lines saved before importance existed have none");
assert.strictEqual(J.updateSettings(ranked, { matrixFilter: "trip" }).settings.matrixFilter, "trip");
assert.strictEqual(J.updateSettings(ranked, { matrixFilter: "" }).settings.matrixFilter, "all");
assert.strictEqual(J.updateSettings(ranked, { matrixFilter: 7 }).settings.matrixFilter, "all");

console.log("jot logic ok");
