(function () {
  "use strict";

  var L = window.DiceSquareLogic;
  var STORAGE_KEY = "dice-square-v1";

  var TRAY_ROWS = [
    ["line4", "tee", "ell", "corner"],
    ["zig", "line3", "square", "duo", "mono"],
  ];
  var TRAY_UNITS = TRAY_ROWS.map(function (row) {
    return row.reduce(function (sum, id) {
      return sum + L.reach(id);
    }, 0);
  });

  // Layout numbers that styles.css shares: the page's side padding, the tray's slot padding
  // and gap, and the board frame's padding plus its label gutter.
  var MAX_WIDTH = 480;
  var SIDE_PAD = 16;
  var SLOT_PAD = 4;
  var SLOT_GAP = 4;
  var FRAME_EXTRA = 42;
  var MIN_CELL = 30;
  var MAX_CELL = 64;
  // A tray block's side as a share of a board square's.
  var TRAY_SCALE = 0.5;
  // Height kept free for the version line the shared shell adds once versions.json loads.
  var FOOTER_ROOM = 26;

  // A press that moves less than this is a tap. A finger wobbles more than a mouse.
  var MOUSE_SLOP = 5;
  var TOUCH_SLOP = 9;
  var TOUCH_LIFT = 18;
  var SAVE_EVERY_MS = 5000;
  var TICK_MS = 250;
  // A gap this long between ticks means the phone slept, so it is not counted as play.
  var MAX_TICK_GAP_MS = 3000;

  var state;
  var els = {};
  var cell = 48;
  var trayCell = 24;
  var selectedId = null;
  var drag = null;
  var rollTimer = null;
  var popId = null;
  var cheer = false;
  var lastTick = Date.now();
  var lastSave = Date.now();
  var toastTimer = null;
  var lastPointerUp = 0;
  var armedDelete = null;
  var armedTimer = null;

  function game() {
    return L.currentGame(state);
  }

  function plural(count, word) {
    return count + " " + word + (count === 1 ? "" : "s");
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function load() {
    try {
      return L.sanitize(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"));
    } catch (e) {
      return L.emptyState();
    }
  }

  function save() {
    lastSave = Date.now();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      toast("Could not save on this phone");
      return false;
    }
  }

  function toast(message) {
    // An open sheet covers the page, so the toast moves into it.
    var host = els.savesDialog.open ? els.savesDialog : document.body;
    if (els.toast.parentNode !== host) host.appendChild(els.toast);
    els.toast.hidden = false;
    els.toast.textContent = message;
    placeToast();
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 2600);
  }

  function hideToast() {
    els.toast.hidden = true;
    els.status.classList.remove("covered");
  }

  // On the page the toast sits on the status line, which already holds a message. Inside the
  // saves sheet it sits along the bottom.
  function placeToast() {
    if (els.toast.hidden) return;
    var inSheet = els.savesDialog.open;
    els.status.classList.toggle("covered", !inSheet);
    if (inSheet) {
      els.toast.style.top = "auto";
      els.toast.style.bottom = "calc(14px + env(safe-area-inset-bottom, 0px))";
      return;
    }
    var rect = els.status.getBoundingClientRect();
    els.toast.style.bottom = "auto";
    els.toast.style.top = rect.top + rect.height / 2 + "px";
  }

  /* Clock */

  function clockRuns() {
    var g = game();
    return !!g && !g.solvedAt && rollTimer === null && !document.hidden && !els.savesDialog.open;
  }

  function tick() {
    var now = Date.now();
    var gap = now - lastTick;
    lastTick = now;
    var g = game();
    if (g && clockRuns() && gap > 0 && gap < MAX_TICK_GAP_MS) {
      g.elapsedMs += gap;
      if (now - lastSave > SAVE_EVERY_MS) save();
    }
    paintClock();
  }

  // Stores the game and its clock, for when the app is about to go away.
  function bank() {
    tick();
    if (game()) save();
  }

  function paintClock() {
    var g = game();
    els.clock.textContent = L.formatTime(g ? g.elapsedMs : 0);
    els.clock.classList.toggle("done", !!(g && g.solvedAt));
  }

  /* Sizes */

  function setSizes(boardCell, width) {
    cell = Math.floor(clamp(boardCell, MIN_CELL, MAX_CELL));
    var room = TRAY_ROWS.map(function (row, i) {
      return (width - row.length * SLOT_PAD * 2 - (row.length - 1) * SLOT_GAP) / TRAY_UNITS[i];
    });
    trayCell = Math.floor(Math.min(cell * TRAY_SCALE, room[0], room[1]));
    document.documentElement.style.setProperty("--cell", cell + "px");
    document.documentElement.style.setProperty("--tcell", trayCell + "px");
  }

  // The board is as wide as the screen allows, then shrinks until the board, the tray and
  // the buttons all fit on one screen, since a page that scrolls fights with dragging.
  function layout() {
    // A drag measures the board once, when it starts, so it cannot outlive a resize.
    cancelDrag();
    var width = Math.min(els.app.clientWidth, MAX_WIDTH) - SIDE_PAD * 2;
    var byWidth = (width - FRAME_EXTRA) / L.SIZE;
    setSizes(byWidth, width);
    var footer = document.querySelector(".app-version-footer");
    var used = els.header.offsetHeight + els.main.offsetHeight + (footer ? footer.offsetHeight : FOOTER_ROOM);
    if (used > window.innerHeight) {
      var trayRows = L.reach(TRAY_ROWS[0][0]) + L.reach(TRAY_ROWS[1][0]);
      var fixed = used - L.SIZE * cell - trayRows * trayCell;
      setSizes((window.innerHeight - fixed) / (L.SIZE + trayRows * TRAY_SCALE), width);
    }
    placeToast();
  }

  /* Drawing */

  function pieceEl(id) {
    var piece = L.pieceById(id);
    var cells = L.cellsOf(game(), id);
    var size = L.extent(cells);
    var has = {};
    cells.forEach(function (c) {
      has[c[0] + "," + c[1]] = true;
    });
    var el = document.createElement("span");
    el.className = "piece";
    el.style.setProperty("--pc", piece.color);
    el.style.setProperty("--w", size.cols);
    el.style.setProperty("--h", size.rows);
    cells.forEach(function (c) {
      var block = document.createElement("span");
      // n* marks a side that touches another block of the same piece, so it draws joined.
      block.className =
        "blk" +
        (has[c[0] - 1 + "," + c[1]] ? " nt" : "") +
        (has[c[0] + "," + (c[1] + 1)] ? " nr" : "") +
        (has[c[0] + 1 + "," + c[1]] ? " nb" : "") +
        (has[c[0] + "," + (c[1] - 1)] ? " nl" : "");
      block.style.setProperty("--br", c[0]);
      block.style.setProperty("--bc", c[1]);
      el.appendChild(block);
    });
    return el;
  }

  function buildBoard() {
    var wells = document.createElement("div");
    wells.className = "wells";
    for (var i = 0; i < L.SIZE * L.SIZE; i++) {
      wells.appendChild(document.createElement("span"));
    }
    els.board.appendChild(wells);

    els.ghost = document.createElement("div");
    els.ghost.className = "ghost";
    els.ghost.hidden = true;
    for (var j = 0; j < 4; j++) els.ghost.appendChild(document.createElement("span"));
    els.board.appendChild(els.ghost);

    els.dice = document.createElement("div");
    els.dice.className = "layer";
    els.board.appendChild(els.dice);

    els.pieces = document.createElement("div");
    els.pieces.className = "layer";
    els.board.appendChild(els.pieces);
  }

  function setDie(die, label) {
    var at = L.parseLabel(label);
    die.textContent = label;
    die.style.setProperty("--r", at.r);
    die.style.setProperty("--c", at.c);
  }

  function renderBoard() {
    var g = game();
    els.dice.textContent = "";
    els.pieces.textContent = "";
    els.ghost.hidden = true;
    els.frame.classList.toggle("solved", !!(g && g.solvedAt));
    els.frame.classList.toggle("empty", !g);
    if (!g) {
      els.board.setAttribute("aria-label", "Board, no dice rolled yet");
      return;
    }
    g.blockers.forEach(function (label) {
      var die = document.createElement("span");
      die.className = "die";
      setDie(die, label);
      els.dice.appendChild(die);
    });
    var order = 0;
    L.PIECES.forEach(function (piece) {
      var at = g.placed[piece.id];
      if (!at) return;
      var el = pieceEl(piece.id);
      el.dataset.piece = piece.id;
      el.style.setProperty("--r", at.r);
      el.style.setProperty("--c", at.c);
      if (piece.id === popId) el.classList.add("pop");
      if (cheer) {
        el.classList.add("cheer");
        el.style.setProperty("--i", order);
      }
      order += 1;
      els.pieces.appendChild(el);
    });
    els.board.setAttribute(
      "aria-label",
      "Board. Dice on " + g.blockers.slice().sort().join(", ") + ". " + plural(L.placedCount(g), "piece") + " placed."
    );
  }

  function renderTray() {
    var g = game();
    els.tray.textContent = "";
    TRAY_ROWS.forEach(function (row) {
      var rowEl = document.createElement("div");
      rowEl.className = "tray-row";
      row.forEach(function (id) {
        var away = !!(g && g.placed[id]);
        var slot = document.createElement("button");
        slot.type = "button";
        slot.className = "slot" + (away ? " away" : "") + (!away && id === selectedId ? " selected" : "");
        slot.dataset.piece = id;
        slot.style.setProperty("--n", L.reach(id));
        slot.setAttribute("aria-label", L.pieceById(id).name + (away ? ", on the board" : ", tap to turn"));
        slot.appendChild(pieceEl(id));
        rowEl.appendChild(slot);
      });
      els.tray.appendChild(rowEl);
    });
  }

  function bestNote(g) {
    var best = state.stats.bestMs;
    if (best === null || g.elapsedMs <= best) return "your best time";
    return "best " + L.formatTime(best);
  }

  function renderStatus() {
    var g = game();
    var placed = L.placedCount(g);
    var text;
    if (!g) text = "Roll the dice to block seven squares, then fill the rest.";
    else if (g.solvedAt) text = "Solved in " + L.formatTime(g.elapsedMs) + " · " + bestNote(g);
    else if (!placed) text = "Drag pieces onto the board. Tap one to turn it.";
    else text = placed + " of " + L.PIECES.length + " placed. Tap a placed piece to take it off.";
    els.status.textContent = text;
    els.status.classList.toggle("win", !!(g && g.solvedAt));

    var playing = !!g && !g.solvedAt;
    els.flipBtn.disabled = !(playing && selectedId && !g.placed[selectedId]);
    els.clearBtn.textContent = g && g.solvedAt ? "Replay" : "Clear board";
    els.clearBtn.disabled = !g || (!g.solvedAt && !placed);
    els.rollBtn.textContent = g ? "New roll" : "Roll dice";
  }

  function render() {
    renderBoard();
    renderTray();
    renderStatus();
    paintClock();
    popId = null;
    cheer = false;
  }

  /* Rolling */

  function stopRoll() {
    if (rollTimer === null) return;
    clearInterval(rollTimer);
    rollTimer = null;
    els.frame.classList.remove("rolling");
  }

  // The dice hop between their own faces, then land one after another.
  function tumble(blockers) {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var dice = Array.prototype.slice.call(els.dice.children);
    var started = Date.now();
    var landed = 0;
    els.frame.classList.add("rolling");
    rollTimer = setInterval(function () {
      var since = Date.now() - started;
      dice.forEach(function (die, i) {
        if (i < landed) return;
        if (since >= 380 + i * 90) {
          setDie(die, blockers[i]);
          die.classList.add("landed");
          landed = i + 1;
          return;
        }
        var faces = L.DICE[i];
        setDie(die, faces[Math.floor(Math.random() * faces.length)]);
      });
      if (landed === dice.length) {
        stopRoll();
        lastTick = Date.now();
      }
    }, 70);
  }

  function roll() {
    cancelDrag();
    stopRoll();
    tick();
    var before = game();
    var keeps = !!before && !before.solvedAt && before.moves > 0;
    var blockers = L.rollDice();
    L.startGame(state, blockers, Date.now());
    selectedId = null;
    save();
    render();
    tumble(blockers);
    if (keeps) toast("Your last roll is in Saves");
  }

  /* Moves */

  function afterMove() {
    var g = game();
    if (g && !g.solvedAt && L.isComplete(g)) {
      tick();
      var isBest = L.recordSolve(state, g, Date.now());
      cheer = true;
      selectedId = null;
      save();
      render();
      if (isBest && state.stats.solved > 1) toast("New best time");
      return;
    }
    save();
    render();
  }

  function tapPiece(id) {
    var g = game();
    if (!g || g.solvedAt) return;
    if (g.placed[id]) L.lift(g, id, Date.now());
    else L.turn(g, id);
    selectedId = id;
    afterMove();
  }

  function flipSelected() {
    var g = game();
    if (!g || !selectedId || !L.flip(g, selectedId)) return;
    afterMove();
  }

  function clearOrReplay() {
    var g = game();
    if (!g) return;
    cancelDrag();
    stopRoll();
    tick();
    if (g.solvedAt) L.restart(g, Date.now());
    else if (!L.clearBoard(g, Date.now())) return;
    selectedId = null;
    lastTick = Date.now();
    afterMove();
  }

  /* Dragging */

  function onDown(e) {
    if (drag || rollTimer !== null || e.button > 0) return;
    var g = game();
    if (!g || g.solvedAt) return;
    var holder = e.target.closest("[data-piece]");
    if (!holder) return;
    var id = holder.dataset.piece;
    var onBoard = !!g.placed[id];
    // A tray slot whose piece is on the board has nothing to pick up.
    if (onBoard && holder.classList.contains("slot")) return;
    var node = holder.classList.contains("piece") ? holder : holder.querySelector(".piece");
    drag = {
      id: id,
      pointerId: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      onBoard: onBoard,
      touch: e.pointerType !== "mouse",
      holder: holder,
      node: node,
      active: false,
      float: null,
      target: null,
      overBoard: false,
    };
    if (e.pointerType === "mouse") e.preventDefault();
  }

  function beginDrag() {
    var g = game();
    var rect = drag.node.getBoundingClientRect();
    var scale = drag.onBoard ? 1 : cell / trayCell;
    drag.cells = L.cellsOf(g, drag.id);
    var size = L.extent(drag.cells);
    drag.w = size.cols * cell;
    drag.h = size.rows * cell;
    drag.gx = clamp((drag.x0 - rect.left) * scale, 0, drag.w);
    drag.gy = clamp((drag.y0 - rect.top) * scale, 0, drag.h);
    drag.board = els.board.getBoundingClientRect();
    drag.float = pieceEl(drag.id);
    drag.float.classList.add("float");
    document.body.appendChild(drag.float);
    drag.holder.classList.add("lifted");
    document.body.classList.add("dragging");
    Array.prototype.forEach.call(els.ghost.children, function (span, i) {
      span.hidden = i >= drag.cells.length;
    });
    els.ghost.style.setProperty("--pc", L.pieceById(drag.id).color);
    drag.active = true;
  }

  function moveDrag(e) {
    var left = e.clientX - drag.gx;
    // Under a finger the piece would be hidden, so it rides just above the touch.
    var top = drag.touch ? e.clientY - drag.h - TOUCH_LIFT : e.clientY - drag.gy;
    drag.float.style.transform = "translate(" + left + "px," + top + "px)";
    var at = L.snap(left - drag.board.left, top - drag.board.top, cell);
    var centerX = left + drag.w / 2;
    var centerY = top + drag.h / 2;
    drag.overBoard =
      centerX >= drag.board.left && centerX <= drag.board.right && centerY >= drag.board.top && centerY <= drag.board.bottom;
    drag.target = L.canPlace(game(), drag.id, at.r, at.c) ? at : null;
    els.ghost.hidden = !drag.target;
    if (!drag.target) return;
    drag.cells.forEach(function (c, i) {
      var span = els.ghost.children[i];
      span.style.setProperty("--r", at.r + c[0]);
      span.style.setProperty("--c", at.c + c[1]);
    });
  }

  function onMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (!drag.active) {
      var slop = drag.touch ? TOUCH_SLOP : MOUSE_SLOP;
      if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < slop) return;
      beginDrag();
    }
    moveDrag(e);
  }

  function endDrag() {
    var done = drag;
    drag = null;
    if (!done || !done.active) return done;
    if (done.float.parentNode) done.float.parentNode.removeChild(done.float);
    done.holder.classList.remove("lifted");
    document.body.classList.remove("dragging");
    els.ghost.hidden = true;
    return done;
  }

  function cancelDrag() {
    endDrag();
  }

  function onUp(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    lastPointerUp = Date.now();
    var done = endDrag();
    if (!done.active) {
      tapPiece(done.id);
      return;
    }
    var g = game();
    if (done.target) {
      L.place(g, done.id, done.target.r, done.target.c, Date.now());
      popId = done.id;
      if (selectedId === done.id) selectedId = null;
    } else if (done.onBoard && !done.overBoard) {
      // Dropped off the board: back to the tray. Dropped on a spot that does not fit: it stays put.
      L.lift(g, done.id, Date.now());
      selectedId = done.id;
    } else {
      return;
    }
    afterMove();
  }

  function onCancel(e) {
    if (drag && e.pointerId === drag.pointerId) cancelDrag();
  }

  /* Saves */

  function thumbEl(g) {
    var map = L.boardMap(g);
    var thumb = document.createElement("span");
    thumb.className = "thumb";
    thumb.setAttribute("aria-hidden", "true");
    map.forEach(function (value) {
      var dot = document.createElement("i");
      if (value === "die") dot.className = "d";
      else if (value) dot.style.background = L.pieceById(value).color;
      thumb.appendChild(dot);
    });
    return thumb;
  }

  function saveLine(g) {
    var clock = L.formatTime(g.elapsedMs);
    if (g.solvedAt) return "Solved in " + clock;
    var progress = L.placedCount(g) + " of " + L.PIECES.length + " placed · " + clock;
    return g.id === state.currentId ? "Playing now · " + progress : progress;
  }

  function whenText(ms) {
    try {
      return new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    } catch (e) {
      return "";
    }
  }

  function span(className, text) {
    var el = document.createElement("span");
    el.className = className;
    el.textContent = text;
    return el;
  }

  function renderSaves() {
    var games = L.sortedGames(state);
    var stats = state.stats;
    els.savesStats.textContent = stats.solved
      ? stats.solved + " solved · best " + L.formatTime(stats.bestMs)
      : "Nothing solved yet";
    els.saveList.textContent = "";
    games.forEach(function (g) {
      var item = document.createElement("li");
      item.className = "save" + (g.id === state.currentId ? " current" : "") + (g.solvedAt ? " solved" : "");

      var open = document.createElement("button");
      open.type = "button";
      open.className = "save-open";
      open.dataset.open = g.id;
      open.appendChild(thumbEl(g));
      var text = document.createElement("span");
      text.className = "save-text";
      text.appendChild(span("save-roll", g.blockers.slice().sort().join(" ")));
      text.appendChild(span("save-line", saveLine(g)));
      text.appendChild(span("save-when", whenText(g.updatedAt)));
      open.appendChild(text);
      item.appendChild(open);

      var armed = armedDelete === g.id;
      var del = document.createElement("button");
      del.type = "button";
      del.className = "save-del" + (armed ? " armed" : "");
      del.dataset.del = g.id;
      del.textContent = armed ? "Delete?" : "Delete";
      del.setAttribute("aria-label", armed ? "Confirm deleting this save" : "Delete this save");
      item.appendChild(del);

      els.saveList.appendChild(item);
    });
    els.savesNote.textContent = games.length
      ? "Your roll saves as you play. The last " + L.MAX_GAMES + " rolls are kept."
      : "No saved rolls yet. Roll the dice and it saves as you play.";
  }

  function disarmDelete() {
    clearTimeout(armedTimer);
    armedDelete = null;
  }

  function openSaves() {
    cancelDrag();
    tick();
    save();
    disarmDelete();
    hideToast();
    renderSaves();
    els.savesDialog.showModal();
  }

  function closeSaves() {
    if (els.savesDialog.open) els.savesDialog.close();
  }

  function onSavesClick(e) {
    var open = e.target.closest("[data-open]");
    if (open) {
      stopRoll();
      if (L.openGame(state, open.dataset.open)) {
        selectedId = null;
        save();
        render();
      }
      closeSaves();
      return;
    }
    var del = e.target.closest("[data-del]");
    if (!del) return;
    var id = del.dataset.del;
    if (armedDelete !== id) {
      // The first tap asks; the second, within a few seconds, deletes.
      disarmDelete();
      armedDelete = id;
      armedTimer = setTimeout(function () {
        armedDelete = null;
        if (els.savesDialog.open) renderSaves();
      }, 4000);
      renderSaves();
      return;
    }
    disarmDelete();
    if (id === state.currentId) stopRoll();
    L.removeGame(state, id);
    selectedId = null;
    save();
    render();
    renderSaves();
    toast("Deleted");
  }

  /* Start */

  function init() {
    els.app = document.querySelector(".app");
    els.header = document.querySelector(".app-header");
    els.main = document.querySelector(".main-panel");
    els.clock = document.getElementById("clock");
    els.savesBtn = document.getElementById("savesBtn");
    els.frame = document.getElementById("boardFrame");
    els.board = document.getElementById("board");
    els.status = document.getElementById("status");
    els.tray = document.getElementById("tray");
    els.flipBtn = document.getElementById("flipBtn");
    els.clearBtn = document.getElementById("clearBtn");
    els.rollBtn = document.getElementById("rollBtn");
    els.savesDialog = document.getElementById("savesDialog");
    els.savesStats = document.getElementById("savesStats");
    els.saveList = document.getElementById("saveList");
    els.savesNote = document.getElementById("savesNote");
    els.savesClose = document.getElementById("savesClose");
    els.toast = document.getElementById("toast");

    state = load();
    buildBoard();
    layout();
    render();

    els.rollBtn.addEventListener("click", roll);
    els.flipBtn.addEventListener("click", flipSelected);
    els.clearBtn.addEventListener("click", clearOrReplay);
    els.savesBtn.addEventListener("click", openSaves);
    els.savesClose.addEventListener("click", closeSaves);
    els.saveList.addEventListener("click", onSavesClick);
    els.savesDialog.addEventListener("click", function (e) {
      if (e.target === els.savesDialog) closeSaves();
    });
    els.savesDialog.addEventListener("close", function () {
      disarmDelete();
      lastTick = Date.now();
    });

    els.tray.addEventListener("pointerdown", onDown);
    els.board.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    // A keyboard press on a tray piece arrives as a click with no pointer behind it. A click
    // that follows a touch or mouse press was already handled as a tap.
    els.tray.addEventListener("click", function (e) {
      if (e.detail !== 0 || Date.now() - lastPointerUp < 700) return;
      var slot = e.target.closest(".slot");
      if (slot && !slot.classList.contains("away")) tapPiece(slot.dataset.piece);
    });

    window.addEventListener("resize", layout);
    new MutationObserver(layout).observe(els.app, { childList: true });
    window.addEventListener("orientationchange", layout);
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) bank();
      else lastTick = Date.now();
    });
    window.addEventListener("pagehide", bank);
    setInterval(tick, TICK_MS);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
