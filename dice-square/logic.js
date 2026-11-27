(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.DiceSquareLogic = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var SIZE = 6;
  var ROWS = "ABCDEF";
  var MAX_GAMES = 40;

  // Between them the seven dice name every square exactly once, so two dice can never block
  // the same square. Every roll leaves 29 open squares, which is what the nine pieces cover.
  var DICE = [
    ["A1", "C1", "D1", "D2", "E2", "F3"],
    ["A2", "B2", "C2", "A3", "B1", "B3"],
    ["C3", "D3", "E3", "B4", "C4", "D4"],
    ["E1", "F2", "F2", "B6", "A5", "A5"],
    ["A4", "B5", "C6", "C5", "D6", "F6"],
    ["E4", "F4", "E5", "F5", "D5", "E6"],
    ["F1", "F1", "F1", "A6", "A6", "A6"],
  ];

  // Cells are [row, column]. The order here is the order of the tray.
  var PIECES = [
    { id: "line4", name: "Grey bar", color: "#8d877e", cells: [[0, 0], [1, 0], [2, 0], [3, 0]] },
    { id: "tee", name: "Yellow T", color: "#f2cc1f", cells: [[0, 1], [1, 0], [1, 1], [1, 2]] },
    { id: "ell", name: "Light blue L", color: "#31b4e4", cells: [[0, 0], [0, 1], [1, 0], [2, 0]] },
    { id: "corner", name: "Purple corner", color: "#a92ba2", cells: [[0, 0], [0, 1], [1, 1]] },
    { id: "zig", name: "Red zigzag", color: "#dc2a2a", cells: [[0, 1], [1, 0], [1, 1], [2, 0]] },
    { id: "line3", name: "Orange bar", color: "#f28a1c", cells: [[0, 0], [1, 0], [2, 0]] },
    { id: "square", name: "Green square", color: "#3cab47", cells: [[0, 0], [0, 1], [1, 0], [1, 1]] },
    { id: "duo", name: "Brown pair", color: "#8b5a3a", cells: [[0, 0], [0, 1]] },
    { id: "mono", name: "Blue single", color: "#2454b8", cells: [[0, 0]] },
  ];

  var PIECE_BY_ID = {};
  PIECES.forEach(function (piece) {
    PIECE_BY_ID[piece.id] = piece;
  });

  function pieceById(id) {
    return Object.prototype.hasOwnProperty.call(PIECE_BY_ID, id) ? PIECE_BY_ID[id] : null;
  }

  function cellLabel(r, c) {
    return ROWS.charAt(r) + (c + 1);
  }

  function parseLabel(label) {
    if (typeof label !== "string" || label.length !== 2) return null;
    var r = ROWS.indexOf(label.charAt(0));
    var c = "123456".indexOf(label.charAt(1));
    return r < 0 || c < 0 ? null : { r: r, c: c };
  }

  function normalize(cells) {
    var minR = Infinity;
    var minC = Infinity;
    cells.forEach(function (cell) {
      minR = Math.min(minR, cell[0]);
      minC = Math.min(minC, cell[1]);
    });
    return cells
      .map(function (cell) {
        return [cell[0] - minR, cell[1] - minC];
      })
      .sort(function (a, b) {
        return a[0] - b[0] || a[1] - b[1];
      });
  }

  function cleanTurn(turn) {
    var rot = turn && Number.isInteger(turn.rot) ? ((turn.rot % 4) + 4) % 4 : 0;
    return { rot: rot, flip: !!(turn && turn.flip) };
  }

  // The piece's cells after mirroring (when flipped) and then `rot` quarter turns clockwise,
  // shifted so the top row and left column are 0.
  function orient(pieceId, turn) {
    var piece = pieceById(pieceId);
    if (!piece) return [];
    var t = cleanTurn(turn);
    var cells = piece.cells.map(function (cell) {
      return [cell[0], t.flip ? -cell[1] : cell[1]];
    });
    for (var i = 0; i < t.rot; i++) {
      cells = cells.map(function (cell) {
        return [cell[1], -cell[0]];
      });
    }
    return normalize(cells);
  }

  function extent(cells) {
    var rows = 0;
    var cols = 0;
    cells.forEach(function (cell) {
      rows = Math.max(rows, cell[0] + 1);
      cols = Math.max(cols, cell[1] + 1);
    });
    return { rows: rows, cols: cols };
  }

  // Side of the smallest square that holds the piece however it is turned.
  function reach(pieceId) {
    var size = extent(orient(pieceId, null));
    return Math.max(size.rows, size.cols);
  }

  // Every distinct way a piece can lie, as lists of cells.
  function orientations(pieceId) {
    var seen = {};
    var out = [];
    [false, true].forEach(function (flip) {
      for (var rot = 0; rot < 4; rot++) {
        var cells = orient(pieceId, { rot: rot, flip: flip });
        var key = JSON.stringify(cells);
        if (seen[key]) continue;
        seen[key] = true;
        out.push(cells);
      }
    });
    return out;
  }

  function rollDice(random) {
    var rnd = typeof random === "function" ? random : Math.random;
    return DICE.map(function (faces) {
      return faces[Math.min(faces.length - 1, Math.floor(rnd() * faces.length))];
    });
  }

  function validBlockers(blockers) {
    if (!Array.isArray(blockers) || blockers.length !== DICE.length) return false;
    return blockers.every(function (label, i) {
      return DICE[i].indexOf(label) >= 0;
    });
  }

  function makeId(now) {
    return "g" + Number(now || 0).toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function newGame(blockers, now, id) {
    var when = Number(now) || 0;
    return {
      id: id || makeId(when),
      blockers: blockers.slice(),
      placed: {},
      turns: {},
      elapsedMs: 0,
      moves: 0,
      createdAt: when,
      updatedAt: when,
      solvedAt: null,
    };
  }

  function turnOf(game, pieceId) {
    return cleanTurn(game && game.turns ? game.turns[pieceId] : null);
  }

  function cellsOf(game, pieceId) {
    return orient(pieceId, turnOf(game, pieceId));
  }

  // 36 entries, row by row: null for an open square, "die" for a blocked one, or the id of
  // the piece lying there. `skipId` leaves one piece out, for moving it.
  function boardMap(game, skipId) {
    var map = [];
    for (var i = 0; i < SIZE * SIZE; i++) map.push(null);
    if (!game) return map;
    game.blockers.forEach(function (label) {
      var at = parseLabel(label);
      if (at) map[at.r * SIZE + at.c] = "die";
    });
    Object.keys(game.placed || {}).forEach(function (pieceId) {
      if (pieceId === skipId) return;
      var at = game.placed[pieceId];
      cellsOf(game, pieceId).forEach(function (cell) {
        map[(at.r + cell[0]) * SIZE + at.c + cell[1]] = pieceId;
      });
    });
    return map;
  }

  // Whether the piece, turned the way the game has it, fits with its top-left at r, c.
  // The piece's own squares count as open, so a placed piece can shift over itself.
  function canPlace(game, pieceId, r, c) {
    if (!game || !pieceById(pieceId)) return false;
    if (!Number.isInteger(r) || !Number.isInteger(c)) return false;
    var map = boardMap(game, pieceId);
    return cellsOf(game, pieceId).every(function (cell) {
      var rr = r + cell[0];
      var cc = c + cell[1];
      return rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && map[rr * SIZE + cc] === null;
    });
  }

  function placedCount(game) {
    return game ? Object.keys(game.placed || {}).length : 0;
  }

  // Seven blocked squares and the nine pieces come to exactly 36, so a board with every
  // piece on it has no open square left.
  function isComplete(game) {
    return placedCount(game) === PIECES.length;
  }

  function place(game, pieceId, r, c, now) {
    if (!canPlace(game, pieceId, r, c)) return false;
    game.placed[pieceId] = { r: r, c: c };
    game.moves += 1;
    game.updatedAt = Number(now) || game.updatedAt;
    return true;
  }

  function lift(game, pieceId, now) {
    if (!game || !game.placed[pieceId]) return false;
    delete game.placed[pieceId];
    game.moves += 1;
    game.updatedAt = Number(now) || game.updatedAt;
    return true;
  }

  // Turning or flipping only applies to a piece in the tray.
  function turn(game, pieceId) {
    if (!game || !pieceById(pieceId) || game.placed[pieceId]) return false;
    var t = turnOf(game, pieceId);
    game.turns[pieceId] = { rot: (t.rot + 1) % 4, flip: t.flip };
    return true;
  }

  function flip(game, pieceId) {
    if (!game || !pieceById(pieceId) || game.placed[pieceId]) return false;
    var t = turnOf(game, pieceId);
    game.turns[pieceId] = { rot: t.rot, flip: !t.flip };
    return true;
  }

  function clearBoard(game, now) {
    if (!game || !placedCount(game)) return false;
    game.placed = {};
    game.moves += 1;
    game.updatedAt = Number(now) || game.updatedAt;
    return true;
  }

  // Same roll again from nothing: empty board, clock at zero.
  function restart(game, now) {
    game.placed = {};
    game.elapsedMs = 0;
    game.solvedAt = null;
    game.moves += 1;
    game.updatedAt = Number(now) || game.updatedAt;
  }

  function emptyState() {
    return { version: 1, currentId: null, games: [], stats: { solved: 0, bestMs: null } };
  }

  function findGame(state, id) {
    for (var i = 0; i < state.games.length; i++) {
      if (state.games[i].id === id) return state.games[i];
    }
    return null;
  }

  function currentGame(state) {
    return state.currentId ? findGame(state, state.currentId) : null;
  }

  function time(value) {
    return typeof value === "number" && isFinite(value) && value >= 0 ? Math.floor(value) : 0;
  }

  function sanitizeGame(raw) {
    if (!raw || typeof raw !== "object" || typeof raw.id !== "string" || !raw.id) return null;
    if (!validBlockers(raw.blockers)) return null;
    var game = newGame(raw.blockers, time(raw.createdAt), raw.id);
    game.elapsedMs = time(raw.elapsedMs);
    game.moves = time(raw.moves);
    game.updatedAt = Math.max(game.createdAt, time(raw.updatedAt));
    PIECES.forEach(function (piece) {
      var rawTurn = raw.turns && typeof raw.turns === "object" ? raw.turns[piece.id] : null;
      var t = cleanTurn(rawTurn);
      if (t.rot || t.flip) game.turns[piece.id] = t;
    });
    // Pieces go back on one at a time, so a stored overlap drops the later piece.
    PIECES.forEach(function (piece) {
      var at = raw.placed && typeof raw.placed === "object" ? raw.placed[piece.id] : null;
      if (!at || !canPlace(game, piece.id, at.r, at.c)) return;
      game.placed[piece.id] = { r: at.r, c: at.c };
    });
    if (isComplete(game)) game.solvedAt = time(raw.solvedAt) || game.updatedAt;
    return game;
  }

  function sanitize(raw) {
    var state = emptyState();
    if (!raw || typeof raw !== "object") return state;
    var seen = {};
    (Array.isArray(raw.games) ? raw.games : []).forEach(function (item) {
      var game = sanitizeGame(item);
      if (!game || seen[game.id]) return;
      seen[game.id] = true;
      state.games.push(game);
    });
    if (typeof raw.currentId === "string" && seen[raw.currentId]) state.currentId = raw.currentId;
    var stats = raw.stats && typeof raw.stats === "object" ? raw.stats : {};
    var solvedHere = 0;
    var bestHere = null;
    state.games.forEach(function (game) {
      if (!game.solvedAt) return;
      solvedHere += 1;
      if (bestHere === null || game.elapsedMs < bestHere) bestHere = game.elapsedMs;
    });
    state.stats.solved = Math.max(time(stats.solved), solvedHere);
    var storedBest = typeof stats.bestMs === "number" && stats.bestMs > 0 ? Math.floor(stats.bestMs) : null;
    state.stats.bestMs = storedBest === null ? bestHere : bestHere === null ? storedBest : Math.min(storedBest, bestHere);
    prune(state);
    return state;
  }

  // Marks the game solved and folds its time into the totals. Returns whether it is a new best.
  function recordSolve(state, game, now) {
    game.solvedAt = Number(now) || game.updatedAt || 1;
    game.updatedAt = game.solvedAt;
    state.stats.solved += 1;
    var best = state.stats.bestMs;
    var isBest = best === null || game.elapsedMs < best;
    if (isBest) state.stats.bestMs = game.elapsedMs;
    return isBest;
  }

  // Newest first by last change; the game being played always leads.
  function sortedGames(state) {
    return state.games.slice().sort(function (a, b) {
      if (a.id === state.currentId) return -1;
      if (b.id === state.currentId) return 1;
      return b.updatedAt - a.updatedAt;
    });
  }

  function prune(state) {
    if (state.games.length <= MAX_GAMES) return;
    var keep = {};
    sortedGames(state).slice(0, MAX_GAMES).forEach(function (game) {
      keep[game.id] = true;
    });
    state.games = state.games.filter(function (game) {
      return keep[game.id];
    });
  }

  // A roll nobody touched is not worth a save slot once it is left behind.
  function dropIfUntouched(state, id) {
    var game = findGame(state, id);
    if (!game || game.moves > 0 || game.solvedAt) return false;
    removeGame(state, id);
    return true;
  }

  function removeGame(state, id) {
    state.games = state.games.filter(function (game) {
      return game.id !== id;
    });
    if (state.currentId === id) state.currentId = null;
  }

  function startGame(state, blockers, now) {
    if (state.currentId) dropIfUntouched(state, state.currentId);
    var game = newGame(blockers, now);
    state.games.push(game);
    state.currentId = game.id;
    prune(state);
    return game;
  }

  function openGame(state, id) {
    if (!findGame(state, id)) return null;
    if (state.currentId && state.currentId !== id) dropIfUntouched(state, state.currentId);
    state.currentId = id;
    return findGame(state, id);
  }

  function formatTime(ms) {
    var total = Math.floor(time(ms) / 1000);
    var hours = Math.floor(total / 3600);
    var minutes = Math.floor((total % 3600) / 60);
    var seconds = total % 60;
    var ss = (seconds < 10 ? "0" : "") + seconds;
    if (!hours) return minutes + ":" + ss;
    return hours + ":" + (minutes < 10 ? "0" : "") + minutes + ":" + ss;
  }

  // Where a dragged piece lands: the square nearest its top-left corner.
  function snap(left, top, cell) {
    return { r: Math.round(top / cell), c: Math.round(left / cell) };
  }

  return {
    SIZE: SIZE,
    ROWS: ROWS,
    DICE: DICE,
    PIECES: PIECES,
    MAX_GAMES: MAX_GAMES,
    pieceById: pieceById,
    cellLabel: cellLabel,
    parseLabel: parseLabel,
    orient: orient,
    extent: extent,
    reach: reach,
    orientations: orientations,
    rollDice: rollDice,
    validBlockers: validBlockers,
    newGame: newGame,
    turnOf: turnOf,
    cellsOf: cellsOf,
    boardMap: boardMap,
    canPlace: canPlace,
    placedCount: placedCount,
    isComplete: isComplete,
    place: place,
    lift: lift,
    turn: turn,
    flip: flip,
    clearBoard: clearBoard,
    restart: restart,
    emptyState: emptyState,
    findGame: findGame,
    currentGame: currentGame,
    sanitizeGame: sanitizeGame,
    sanitize: sanitize,
    recordSolve: recordSolve,
    sortedGames: sortedGames,
    prune: prune,
    removeGame: removeGame,
    startGame: startGame,
    openGame: openGame,
    formatTime: formatTime,
    snap: snap,
  };
});
