"use strict";

var assert = require("assert");
var L = require("./logic.js");

// The dice name every square exactly once between them.
var faces = {};
L.DICE.forEach(function (die, index) {
  assert.strictEqual(die.length, 6);
  die.forEach(function (label) {
    assert.ok(L.parseLabel(label), label);
    assert.ok(faces[label] === undefined || faces[label] === index, label + " is on two dice");
    faces[label] = index;
  });
});
assert.strictEqual(Object.keys(faces).length, 36);

// Nine pieces cover the 29 squares seven dice leave open.
assert.strictEqual(L.PIECES.length, 9);
assert.strictEqual(L.PIECES.reduce(function (sum, piece) { return sum + piece.cells.length; }, 0), 29);

// Labels.
assert.strictEqual(L.cellLabel(0, 0), "A1");
assert.strictEqual(L.cellLabel(5, 5), "F6");
assert.deepStrictEqual(L.parseLabel("B3"), { r: 1, c: 2 });
assert.strictEqual(L.parseLabel("G1"), null);
assert.strictEqual(L.parseLabel("A7"), null);
assert.strictEqual(L.parseLabel("A"), null);

// Turning and flipping.
assert.deepStrictEqual(L.orient("line3", null), [[0, 0], [1, 0], [2, 0]]);
assert.deepStrictEqual(L.orient("line3", { rot: 1, flip: false }), [[0, 0], [0, 1], [0, 2]]);
assert.deepStrictEqual(L.orient("ell", { rot: 0, flip: false }), [[0, 0], [0, 1], [1, 0], [2, 0]]);
assert.deepStrictEqual(L.orient("ell", { rot: 1, flip: false }), [[0, 0], [0, 1], [0, 2], [1, 2]]);
assert.deepStrictEqual(L.orient("ell", { rot: 0, flip: true }), [[0, 0], [0, 1], [1, 1], [2, 1]]);
assert.deepStrictEqual(L.orient("ell", { rot: 4, flip: false }), L.orient("ell", null));
assert.deepStrictEqual(L.orient("nope", null), []);
var counts = {};
L.PIECES.forEach(function (piece) {
  counts[piece.id] = L.orientations(piece.id).length;
});
assert.deepStrictEqual(counts, { line4: 2, tee: 4, ell: 8, corner: 4, zig: 4, line3: 2, square: 1, duo: 2, mono: 1 });
assert.strictEqual(L.reach("line4"), 4);
assert.strictEqual(L.reach("corner"), 2);
assert.strictEqual(L.reach("mono"), 1);

// Rolling takes one face from each die.
var lowRoll = L.rollDice(function () { return 0; });
assert.deepStrictEqual(lowRoll, ["A1", "A2", "C3", "E1", "A4", "E4", "F1"]);
assert.deepStrictEqual(L.rollDice(function () { return 0.9999; }), ["F3", "B3", "D4", "A5", "F6", "E6", "A6"]);
assert.ok(L.validBlockers(L.rollDice()));
assert.ok(!L.validBlockers(["A1", "A2", "C3", "E1", "A4", "E4"]));
assert.ok(!L.validBlockers(["A2", "A1", "C3", "E1", "A4", "E4", "F1"]));

// The roll in the photo: B3 C3 D2 E4 F2 F6 F1.
var photo = ["D2", "B3", "C3", "F2", "F6", "E4", "F1"];
assert.ok(L.validBlockers(photo));
var game = L.newGame(photo, 1000, "g1");
assert.strictEqual(L.boardMap(game).filter(function (v) { return v === "die"; }).length, 7);

// Placing: bounds, dice, and other pieces all block.
assert.ok(L.canPlace(game, "line4", 0, 0));
assert.ok(!L.canPlace(game, "line4", 3, 0), "runs off the bottom");
assert.ok(!L.canPlace(game, "line4", 2, 0), "F1 is blocked");
assert.ok(!L.canPlace(game, "line4", 0, 2), "B3 is blocked");
assert.ok(!L.canPlace(game, "line4", -1, 0));
assert.ok(!L.canPlace(game, "line4", 0.5, 0));
assert.ok(L.place(game, "line4", 0, 0, 2000));
assert.strictEqual(game.moves, 1);
assert.strictEqual(game.updatedAt, 2000);
assert.ok(!L.canPlace(game, "line3", 0, 0), "the grey bar is there");
assert.ok(L.place(game, "line3", 0, 1, 3000));
assert.ok(L.canPlace(game, "line4", 1, 0), "a placed piece may slide over itself");
assert.ok(!L.turn(game, "line3"), "a placed piece does not turn");
assert.ok(!L.flip(game, "line3"));

// Turning in the tray changes what fits.
assert.ok(L.canPlace(game, "duo", 4, 0), "lying flat, the pair fits E1 E2");
assert.ok(!L.canPlace(game, "duo", 4, 2), "E3 E4 has a die on it");
assert.ok(L.turn(game, "duo"));
assert.deepStrictEqual(L.turnOf(game, "duo"), { rot: 1, flip: false });
assert.ok(!L.canPlace(game, "duo", 4, 0), "standing up, it would cover F1");
assert.ok(L.canPlace(game, "duo", 4, 2), "standing up, it fits E3 F3");
assert.ok(L.flip(game, "ell"));
assert.deepStrictEqual(L.turnOf(game, "ell"), { rot: 0, flip: true });

// Lifting and clearing.
assert.ok(L.lift(game, "line3", 4000));
assert.ok(!L.lift(game, "line3", 4000));
assert.strictEqual(L.placedCount(game), 1);
assert.ok(L.clearBoard(game, 5000));
assert.ok(!L.clearBoard(game, 5000));
assert.strictEqual(L.placedCount(game), 0);

// A search for these checks: squares are bits (A1 lowest), split in two 18-bit halves.
var HALF = (1 << 18) - 1;
var FITS = [];
(function () {
  var shapes = [];
  L.PIECES.forEach(function (piece, index) {
    var seen = {};
    [false, true].forEach(function (flip) {
      for (var rot = 0; rot < 4; rot++) {
        var cells = L.orient(piece.id, { rot: rot, flip: flip });
        var key = JSON.stringify(cells);
        if (seen[key]) continue;
        seen[key] = true;
        shapes.push({ bit: 1 << index, id: piece.id, turn: { rot: rot, flip: flip }, cells: cells });
      }
    });
  });
  shapes.sort(function (a, b) { return b.cells.length - a.cells.length; });
  // A shape that covers the first open square has that square as its first cell, so the
  // fits are listed by where that first cell lands.
  for (var square = 0; square < 36; square++) {
    var list = [];
    shapes.forEach(function (shape) {
      var r = Math.floor(square / 6);
      var c = (square % 6) - shape.cells[0][1];
      var lo = 0;
      var hi = 0;
      var inside = shape.cells.every(function (cell) {
        var rr = r + cell[0];
        var cc = c + cell[1];
        if (rr > 5 || cc < 0 || cc > 5) return false;
        var at = rr * 6 + cc;
        if (at < 18) lo |= 1 << at;
        else hi |= 1 << (at - 18);
        return true;
      });
      if (inside) list.push({ bit: shape.bit, id: shape.id, turn: shape.turn, r: r, c: c, lo: lo, hi: hi });
    });
    FITS.push(list);
  }
})();

function solve(blockers) {
  var lo = 0;
  var hi = 0;
  blockers.forEach(function (label) {
    var at = L.parseLabel(label);
    var square = at.r * 6 + at.c;
    if (square < 18) lo |= 1 << square;
    else hi |= 1 << (square - 18);
  });
  var answer = [];

  function step(lo, hi, used) {
    var open = ~lo & HALF;
    var square;
    if (open) square = 31 - Math.clz32(open & -open);
    else {
      open = ~hi & HALF;
      if (!open) return true;
      square = 49 - Math.clz32(open & -open);
    }
    var list = FITS[square];
    for (var i = 0; i < list.length; i++) {
      var fit = list[i];
      if (used & fit.bit || lo & fit.lo || hi & fit.hi) continue;
      answer.push(fit);
      if (step(lo | fit.lo, hi | fit.hi, used | fit.bit)) return true;
      answer.pop();
    }
    return false;
  }

  return step(lo, hi, 0) ? answer : null;
}

// A full solution of the photo's roll replays through place().
var answer = solve(photo);
assert.ok(answer, "the photo's roll has a solution");
var solved = L.newGame(photo, 1000, "g2");
answer.forEach(function (move) {
  solved.turns[move.id] = move.turn;
  assert.ok(L.place(solved, move.id, move.r, move.c, 2000), move.id);
});
assert.ok(L.isComplete(solved));
assert.strictEqual(L.boardMap(solved).indexOf(null), -1);

// Every roll the dice can make has a solution.
var rolls = 0;
(function eachRoll(die, picked) {
  if (die === L.DICE.length) {
    rolls += 1;
    assert.ok(solve(picked), "no solution for " + picked.join(" "));
    return;
  }
  var tried = {};
  L.DICE[die].forEach(function (label) {
    if (tried[label]) return;
    tried[label] = true;
    eachRoll(die + 1, picked.concat(label));
  });
})(0, []);
assert.strictEqual(rolls, 62208);

// State: starting, leaving, and reopening games.
var state = L.emptyState();
assert.strictEqual(L.currentGame(state), null);
var first = L.startGame(state, photo, 1000);
assert.strictEqual(L.currentGame(state), first);
var second = L.startGame(state, lowRoll, 2000);
assert.strictEqual(state.games.length, 1, "an untouched roll is not kept");
assert.ok(L.place(second, "mono", 0, 2, 2500));
var third = L.startGame(state, photo, 3000);
assert.strictEqual(state.games.length, 2, "a roll with moves on it is kept");
assert.strictEqual(L.openGame(state, second.id), second);
assert.strictEqual(state.games.length, 1, "leaving the untouched third roll drops it");
assert.strictEqual(L.openGame(state, third.id), null);
assert.strictEqual(state.currentId, second.id);

// Solving records the time and the best.
second.elapsedMs = 83000;
assert.strictEqual(L.recordSolve(state, second, 9000), true);
assert.strictEqual(second.solvedAt, 9000);
assert.deepStrictEqual(state.stats, { solved: 1, bestMs: 83000 });
var slower = L.startGame(state, photo, 10000);
slower.elapsedMs = 90000;
assert.strictEqual(L.recordSolve(state, slower, 11000), false);
assert.deepStrictEqual(state.stats, { solved: 2, bestMs: 83000 });
L.restart(slower, 12000);
assert.strictEqual(slower.solvedAt, null);
assert.strictEqual(slower.elapsedMs, 0);

// Order and the cap on saves.
assert.strictEqual(L.sortedGames(state)[0].id, state.currentId);
var crowded = L.emptyState();
for (var n = 0; n < L.MAX_GAMES + 5; n++) {
  var g = L.startGame(crowded, photo, 1000 + n);
  g.moves = 1;
}
assert.strictEqual(crowded.games.length, L.MAX_GAMES);
assert.ok(L.currentGame(crowded), "the game being played survives the cap");
assert.strictEqual(crowded.games[0].createdAt, 1005, "the oldest saves go first");
L.removeGame(crowded, crowded.currentId);
assert.strictEqual(crowded.currentId, null);
assert.strictEqual(crowded.games.length, L.MAX_GAMES - 1);

// Stored data is checked on the way back in.
assert.deepStrictEqual(L.sanitize(null), L.emptyState());
assert.deepStrictEqual(L.sanitize("junk"), L.emptyState());
var round = L.sanitize(JSON.parse(JSON.stringify({ version: 1, currentId: "g2", games: [solved], stats: { solved: 0, bestMs: null } })));
assert.strictEqual(round.currentId, "g2");
assert.strictEqual(L.placedCount(round.games[0]), 9);
assert.ok(round.games[0].solvedAt, "a full board reads as solved");
assert.strictEqual(round.stats.solved, 1);
var messy = L.sanitize({
  currentId: "missing",
  games: [
    { id: "a", blockers: photo, placed: { line4: { r: 0, c: 0 }, line3: { r: 0, c: 0 }, mono: { r: 9, c: 9 }, duo: "x" }, turns: { ell: { rot: 7, flip: 1 } }, elapsedMs: -5, solvedAt: 99 },
    { id: "a", blockers: photo },
    { id: "b", blockers: ["A1", "A1", "A1", "A1", "A1", "A1", "A1"] },
    { blockers: photo },
    null,
  ],
  stats: { solved: 4, bestMs: 61000 },
});
assert.strictEqual(messy.currentId, null);
assert.strictEqual(messy.games.length, 1);
assert.deepStrictEqual(messy.games[0].placed, { line4: { r: 0, c: 0 } });
assert.deepStrictEqual(messy.games[0].turns, { ell: { rot: 3, flip: true } });
assert.strictEqual(messy.games[0].elapsedMs, 0);
assert.strictEqual(messy.games[0].solvedAt, null, "a part-filled board is not solved");
assert.deepStrictEqual(messy.stats, { solved: 4, bestMs: 61000 });

// Clock text.
assert.strictEqual(L.formatTime(0), "0:00");
assert.strictEqual(L.formatTime(59999), "0:59");
assert.strictEqual(L.formatTime(83000), "1:23");
assert.strictEqual(L.formatTime(3600000 + 5 * 60000 + 7000), "1:05:07");
assert.strictEqual(L.formatTime(-1), "0:00");

// Snapping a dragged piece to the nearest square.
assert.deepStrictEqual(L.snap(0, 0, 50), { r: 0, c: 0 });
assert.deepStrictEqual(L.snap(124, 76, 50), { r: 2, c: 2 });
assert.deepStrictEqual(L.snap(-30, 260, 50), { r: 5, c: -1 });

console.log("dice-square logic: all checks passed (" + rolls + " rolls solvable)");
