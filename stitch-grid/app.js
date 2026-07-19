(function () {
  "use strict";

  var STORAGE_KEY = "stitch-grid-v1";
  var APP_ID = "stitch-grid";
  var EXPORT_FORMAT = "stitch-grid-data";
  var MAX_DIM = 80;
  var MIN_DIM = 1;
  var DEFAULTS = {
    width: 28,
    height: 40,
    cellSize: 2.25,
    stitchWidth: 0.82,
    stitchHeight: 0.9,
    baseThickness: 0.6,
    includeBase: true,
    showGridLines: true,
  };

  var COLORS = [
    { id: "red", name: "Red", hex: "#b11f35" },
    { id: "yellow", name: "Yellow", hex: "#f3cf35" },
    { id: "green", name: "Green", hex: "#42d64b" },
    { id: "white", name: "White", hex: "#f8f0df" },
    { id: "black", name: "Black", hex: "#2d2a24" },
    { id: "blue", name: "Blue", hex: "#2876d7" },
  ];

  var state = loadData();
  var selectedTool = "red";
  var drawMode = "paint";
  var selection = null;
  var selectionStart = null;
  var copiedSelection = null;
  var pasteMode = false;
  var lastSnapshot = null;
  var pointerDown = false;
  var activePointerId = null;
  var lastPaintKey = "";
  var toastTimer = null;
  var els = {};

  function defaultData() {
    return {
      version: 1,
      name: "stitch-grid",
      settings: Object.assign({}, DEFAULTS),
      cells: {},
      savedDesigns: [],
      updatedAt: new Date().toISOString(),
    };
  }

  function clampNumber(value, min, max, fallback) {
    var n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function roundTo(value, places) {
    var factor = Math.pow(10, places || 2);
    return Math.round(value * factor) / factor;
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function normalizeName(value) {
    return String(value || "stitch-grid").trim().replace(/\s+/g, "-").slice(0, 80) || "stitch-grid";
  }

  function normalizeSettings(raw) {
    raw = raw && typeof raw === "object" ? raw : {};
    var width = Math.round(clampNumber(raw.width, MIN_DIM, MAX_DIM, DEFAULTS.width));
    var height = Math.round(clampNumber(raw.height, MIN_DIM, MAX_DIM, DEFAULTS.height));
    var cellSize = roundTo(clampNumber(raw.cellSize, 1, 12, DEFAULTS.cellSize), 2);
    var stitchWidth = roundTo(clampNumber(raw.stitchWidth, 0.4, Math.min(6, cellSize), DEFAULTS.stitchWidth), 2);
    var stitchHeight = roundTo(clampNumber(raw.stitchHeight, 0.2, 5, DEFAULTS.stitchHeight), 2);
    var baseThickness = roundTo(clampNumber(raw.baseThickness, 0, 5, DEFAULTS.baseThickness), 2);
    return {
      width: width,
      height: height,
      cellSize: cellSize,
      stitchWidth: stitchWidth,
      stitchHeight: stitchHeight,
      baseThickness: baseThickness,
      includeBase: raw.includeBase !== false,
      showGridLines: raw.showGridLines !== false,
    };
  }

  function colorById(id) {
    for (var i = 0; i < COLORS.length; i++) {
      if (COLORS[i].id === id) return COLORS[i];
    }
    return null;
  }

  function normalizeCells(raw, settings) {
    var out = {};
    if (!raw || typeof raw !== "object") return out;
    Object.keys(raw).forEach(function (key) {
      var parts = key.split(",");
      if (parts.length !== 2) return;
      var x = Math.floor(Number(parts[0]));
      var y = Math.floor(Number(parts[1]));
      var color = String(raw[key] || "");
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      if (x < 0 || y < 0 || x >= settings.width || y >= settings.height) return;
      if (!colorById(color)) return;
      out[x + "," + y] = color;
    });
    return out;
  }

  function normalizeData(raw) {
    var settings = normalizeSettings(raw && raw.settings);
    return {
      version: 1,
      name: normalizeName(raw && raw.name),
      settings: settings,
      cells: normalizeCells(raw && raw.cells, settings),
      savedDesigns: normalizeSavedDesigns(raw && raw.savedDesigns),
      updatedAt: raw && raw.updatedAt ? String(raw.updatedAt) : new Date().toISOString(),
    };
  }

  function normalizeSavedDesigns(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, 50).map(function (design) {
      var settings = normalizeSettings(design && design.settings);
      return {
        id: design && design.id ? String(design.id) : uid(),
        name: normalizeName(design && design.name),
        settings: settings,
        cells: normalizeCells(design && design.cells, settings),
        updatedAt: design && design.updatedAt ? String(design.updatedAt) : new Date().toISOString(),
      };
    });
  }

  function loadData() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultData();
      return normalizeData(JSON.parse(raw));
    } catch (e) {
      return defaultData();
    }
  }

  function saveData() {
    state.updatedAt = new Date().toISOString();
    state = normalizeData(state);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function slug(value) {
    return String(value || "stitch-grid")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "stitch-grid";
  }

  function exportBaseName() {
    var value = els.exportName && els.exportName.value ? els.exportName.value : state.name;
    return slug(value || "stitch-grid");
  }

  function cloneCurrentDesign(id) {
    return {
      id: id || uid(),
      name: normalizeName(state.name),
      settings: Object.assign({}, state.settings),
      cells: Object.assign({}, state.cells),
      updatedAt: new Date().toISOString(),
    };
  }

  function setCell(x, y, colorId) {
    if (x < 0 || y < 0 || x >= state.settings.width || y >= state.settings.height) return false;
    var key = x + "," + y;
    if (colorId === "erase" || !colorId) {
      if (!state.cells[key]) return false;
      delete state.cells[key];
      return true;
    }
    if (!colorById(colorId) || state.cells[key] === colorId) return false;
    state.cells[key] = colorId;
    return true;
  }

  function currentPaintValue() {
    return selectedTool === "erase" ? null : selectedTool;
  }

  function sortedSavedDesigns() {
    return state.savedDesigns.slice().sort(function (a, b) {
      return new Date(b.updatedAt) - new Date(a.updatedAt);
    });
  }

  function toast(message) {
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      els.toast.classList.remove("show");
    }, 2800);
  }

  function downloadBlob(blob, filename) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
    }, 600);
  }

  function snapshotCells() {
    lastSnapshot = Object.assign({}, state.cells);
    if (els.undoBtn) els.undoBtn.disabled = false;
  }

  function updateInputs() {
    var s = state.settings;
    els.designName.value = state.name;
    els.exportName.value = state.name;
    els.gridWidth.value = s.width;
    els.gridHeight.value = s.height;
    els.cellSize.value = s.cellSize;
    els.stitchWidth.value = s.stitchWidth;
    els.stitchHeight.value = s.stitchHeight;
    els.baseThickness.value = s.baseThickness;
    els.includeBase.checked = !!s.includeBase;
    els.showGridLines.checked = !!s.showGridLines;
  }

  function renderSavedDesigns() {
    if (!els.savedDesigns) return;
    var designs = sortedSavedDesigns();
    if (!designs.length) {
      els.savedDesigns.innerHTML = '<option value="">No saved patterns yet</option>';
      els.loadDesignBtn.disabled = true;
      els.deleteDesignBtn.disabled = true;
      return;
    }
    els.savedDesigns.innerHTML = designs.map(function (design) {
      var count = Object.keys(design.cells || {}).length;
      return '<option value="' + escapeHtml(design.id) + '">' +
        escapeHtml(design.name) + " - " + count + " stitches</option>";
    }).join("");
    els.loadDesignBtn.disabled = false;
    els.deleteDesignBtn.disabled = false;
  }

  function renderPalette() {
    var html = COLORS.map(function (color) {
      return '<button type="button" class="swatch" data-tool="' + escapeHtml(color.id) + '">' +
        '<span class="swatch-dot" style="background:' + escapeHtml(color.hex) + '"></span>' +
        '<span>' + escapeHtml(color.name) + "</span>" +
      "</button>";
    }).join("");
    html += '<button type="button" class="swatch" data-tool="erase">' +
      '<span class="swatch-dot eraser"></span><span>Erase</span>' +
    "</button>";
    els.palette.innerHTML = html;
    renderSelectedTool();
  }

  function renderSelectedTool() {
    if (!els.palette) return;
    els.palette.querySelectorAll(".swatch").forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.tool === selectedTool);
    });
  }

  function renderDrawMode() {
    document.querySelectorAll("[data-mode]").forEach(function (btn) {
      var active = btn.dataset.mode === drawMode;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-checked", active ? "true" : "false");
    });
    els.circleOptions.hidden = drawMode !== "circle";
    els.pasteSelectionBtn.classList.toggle("active", pasteMode);
    renderSelectionMeta();
  }

  function renderSelectionMeta() {
    if (!els.selectionMeta) return;
    if (pasteMode && copiedSelection) {
      els.selectionMeta.textContent = "Paste mode: tap a cell to place the copied " + copiedSelection.width + " x " + copiedSelection.height + " pattern.";
    } else if (selection) {
      els.selectionMeta.textContent = "Selected " + selection.width + " x " + selection.height + " cells. Copy it, then tap Paste copy.";
    } else if (copiedSelection) {
      els.selectionMeta.textContent = "Copied " + copiedSelection.width + " x " + copiedSelection.height + " cells. Tap Paste copy, then tap the grid.";
    } else {
      els.selectionMeta.textContent = "Select a rectangle to copy and stamp it somewhere else.";
    }
    els.copySelectionBtn.disabled = !selection;
    els.pasteSelectionBtn.disabled = !copiedSelection;
  }

  function isInSelection(x, y) {
    return selection && x >= selection.x && y >= selection.y &&
      x < selection.x + selection.width && y < selection.y + selection.height;
  }

  function renderGrid() {
    var s = state.settings;
    var viewportWidth = Math.max(320, Math.min(window.innerWidth || 390, 980));
    var targetCell = Math.floor((viewportWidth - 56) / Math.min(s.width, 16));
    var cssCell = Math.max(16, Math.min(34, targetCell));
    var html = "";

    els.stitchGrid.style.setProperty("--cols", String(s.width));
    els.stitchGrid.style.setProperty("--rows", String(s.height));
    els.stitchGrid.style.setProperty("--cell", cssCell + "px");
    els.stitchGrid.classList.toggle("no-lines", !s.showGridLines);

    for (var y = 0; y < s.height; y++) {
      for (var x = 0; x < s.width; x++) {
        var key = x + "," + y;
        var color = colorById(state.cells[key]);
        html += '<button type="button" class="cell' + (color ? " filled" : "") + (isInSelection(x, y) ? " selected" : "") + '"' +
          ' data-x="' + x + '" data-y="' + y + '"' +
          (color ? ' style="--stitch-color:' + escapeHtml(color.hex) + '"' : "") +
          ' aria-label="Cell ' + (x + 1) + ", " + (y + 1) + (color ? ", " + escapeHtml(color.name) : ", empty") + '">' +
          "</button>";
      }
    }
    els.stitchGrid.innerHTML = html;
    renderMeta();
  }

  function renderMeta() {
    var count = Object.keys(state.cells).length;
    var s = state.settings;
    var widthMm = roundTo(s.width * s.cellSize, 1);
    var heightMm = roundTo(s.height * s.cellSize, 1);
    els.patternMeta.textContent = count + " stitch" + (count === 1 ? "" : "es") +
      " - " + widthMm + " x " + heightMm + " mm";
    els.exportCombinedBtn.disabled = count === 0 && !(s.includeBase && s.baseThickness > 0);
    els.exportColorBtn.disabled = count === 0;
  }

  function renderAll() {
    updateInputs();
    renderSavedDesigns();
    renderGrid();
    renderSelectedTool();
    renderDrawMode();
  }

  function applySettingsFromInputs() {
    var previousCells = Object.assign({}, state.cells);
    state.name = normalizeName(els.designName.value);
    state.settings = normalizeSettings({
      width: els.gridWidth.value,
      height: els.gridHeight.value,
      cellSize: els.cellSize.value,
      stitchWidth: els.stitchWidth.value,
      stitchHeight: els.stitchHeight.value,
      baseThickness: els.baseThickness.value,
      includeBase: els.includeBase.checked,
      showGridLines: els.showGridLines.checked,
    });
    state.cells = normalizeCells(previousCells, state.settings);
    selection = null;
    pasteMode = false;
    saveData();
    renderAll();
  }

  function paintCell(cell) {
    if (!cell || !cell.classList || !cell.classList.contains("cell")) return;
    var x = Number(cell.dataset.x);
    var y = Number(cell.dataset.y);
    var key = x + "," + y;
    if (key === lastPaintKey) return;
    lastPaintKey = key;

    setCell(x, y, selectedTool);
    saveData();

    var color = colorById(state.cells[key]);
    cell.classList.toggle("filled", !!color);
    if (color) {
      cell.style.setProperty("--stitch-color", color.hex);
      cell.setAttribute("aria-label", "Cell " + (x + 1) + ", " + (y + 1) + ", " + color.name);
    } else {
      cell.style.removeProperty("--stitch-color");
      cell.setAttribute("aria-label", "Cell " + (x + 1) + ", " + (y + 1) + ", empty");
    }
    renderMeta();
  }

  function floodFillFrom(x, y) {
    var targetKey = x + "," + y;
    var target = state.cells[targetKey] || null;
    var replacement = currentPaintValue();
    if (target === replacement) return 0;
    var stack = [[x, y]];
    var seen = {};
    var changed = 0;
    while (stack.length) {
      var pos = stack.pop();
      var px = pos[0];
      var py = pos[1];
      var key = px + "," + py;
      if (seen[key] || px < 0 || py < 0 || px >= state.settings.width || py >= state.settings.height) continue;
      seen[key] = true;
      if ((state.cells[key] || null) !== target) continue;
      if (setCell(px, py, replacement || "erase")) changed++;
      stack.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]);
    }
    return changed;
  }

  function drawCircleAt(cx, cy) {
    var radius = Math.round(clampNumber(els.circleRadius.value, 1, 40, 4));
    var filled = !!els.circleFilled.checked;
    var replacement = currentPaintValue();
    var changed = 0;
    for (var y = cy - radius; y <= cy + radius; y++) {
      for (var x = cx - radius; x <= cx + radius; x++) {
        var dx = x - cx;
        var dy = y - cy;
        var dist = Math.sqrt(dx * dx + dy * dy);
        var inShape = filled ? dist <= radius + 0.28 : Math.abs(dist - radius) <= 0.55;
        if (inShape && setCell(x, y, replacement || "erase")) changed++;
      }
    }
    return changed;
  }

  function selectionFromPoints(a, b) {
    var x0 = Math.max(0, Math.min(a.x, b.x));
    var y0 = Math.max(0, Math.min(a.y, b.y));
    var x1 = Math.min(state.settings.width - 1, Math.max(a.x, b.x));
    var y1 = Math.min(state.settings.height - 1, Math.max(a.y, b.y));
    return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
  }

  function copySelection() {
    if (!selection) {
      toast("Select an area first.");
      return;
    }
    var cells = {};
    Object.keys(state.cells).forEach(function (key) {
      var parts = key.split(",");
      var x = Number(parts[0]);
      var y = Number(parts[1]);
      if (!isInSelection(x, y)) return;
      cells[(x - selection.x) + "," + (y - selection.y)] = state.cells[key];
    });
    copiedSelection = {
      width: selection.width,
      height: selection.height,
      cells: cells,
    };
    pasteMode = true;
    drawMode = "select";
    renderDrawMode();
    toast("Selection copied. Tap the grid to paste.");
  }

  function pasteSelectionAt(x, y) {
    if (!copiedSelection) {
      toast("Copy a selection first.");
      return;
    }
    var changed = 0;
    snapshotCells();
    Object.keys(copiedSelection.cells).forEach(function (key) {
      var parts = key.split(",");
      var px = x + Number(parts[0]);
      var py = y + Number(parts[1]);
      if (setCell(px, py, copiedSelection.cells[key])) changed++;
    });
    if (!changed) {
      lastSnapshot = null;
      els.undoBtn.disabled = true;
      toast("Nothing pasted inside the grid.");
      return;
    }
    selection = { x: x, y: y, width: copiedSelection.width, height: copiedSelection.height };
    pasteMode = false;
    saveData();
    renderGrid();
    renderDrawMode();
    toast("Pattern pasted.");
  }

  function saveCurrentDesign() {
    state.name = normalizeName(els.designName.value || els.exportName.value || state.name);
    var existing = state.savedDesigns.filter(function (design) {
      return design.name.toLowerCase() === state.name.toLowerCase();
    })[0];
    var design = cloneCurrentDesign(existing && existing.id);
    state.savedDesigns = state.savedDesigns.filter(function (item) {
      return item.id !== design.id;
    });
    state.savedDesigns.unshift(design);
    saveData();
    renderSavedDesigns();
    updateInputs();
    toast("Saved " + design.name + ".");
  }

  function selectedSavedDesign() {
    var id = els.savedDesigns.value;
    return state.savedDesigns.filter(function (design) { return design.id === id; })[0] || null;
  }

  function loadSavedDesign() {
    var design = selectedSavedDesign();
    if (!design) {
      toast("Choose a saved pattern first.");
      return;
    }
    snapshotCells();
    state.name = normalizeName(design.name);
    state.settings = normalizeSettings(design.settings);
    state.cells = normalizeCells(design.cells, state.settings);
    selection = null;
    pasteMode = false;
    saveData();
    renderAll();
    toast("Loaded " + state.name + ".");
  }

  function deleteSavedDesign() {
    var design = selectedSavedDesign();
    if (!design) {
      toast("Choose a saved pattern first.");
      return;
    }
    if (!window.confirm("Delete saved pattern \"" + design.name + "\"?")) return;
    state.savedDesigns = state.savedDesigns.filter(function (item) {
      return item.id !== design.id;
    });
    saveData();
    renderSavedDesigns();
    toast("Deleted saved pattern.");
  }

  function cellFromPoint(clientX, clientY) {
    var node = document.elementFromPoint(clientX, clientY);
    return node && node.closest ? node.closest(".cell") : null;
  }

  function clearGrid() {
    if (!Object.keys(state.cells).length) {
      toast("Grid is already empty.");
      return;
    }
    if (!window.confirm("Clear all stitches from this grid?")) return;
    snapshotCells();
    state.cells = {};
    saveData();
    renderGrid();
    toast("Grid cleared.");
  }

  function loadSample() {
    snapshotCells();
    var w = Math.max(12, state.settings.width);
    var h = Math.max(16, state.settings.height);
    state.settings.width = Math.min(MAX_DIM, w);
    state.settings.height = Math.min(MAX_DIM, h);
    var cx = Math.floor(state.settings.width / 2);
    var cy = Math.floor(state.settings.height / 2);
    var cells = {};

    function put(x, y, color) {
      if (x >= 0 && y >= 0 && x < state.settings.width && y < state.settings.height) {
        cells[x + "," + y] = color;
      }
    }

    for (var i = -7; i <= 7; i++) {
      put(cx, cy + i, "green");
      if (i > -4 && i < 5) put(cx + Math.round(i / 2), cy + i, "green");
    }
    for (var j = 0; j < 8; j++) {
      put(cx - 1 - j, cy + 5 - Math.floor(j / 2), "green");
      put(cx + 1 + j, cy + 1 + Math.floor(j / 2), "green");
    }
    [
      [cx - 4, cy - 5], [cx - 3, cy - 6], [cx - 2, cy - 6], [cx - 1, cy - 5],
      [cx - 5, cy - 4], [cx - 4, cy - 4], [cx - 3, cy - 4], [cx - 2, cy - 4],
      [cx - 1, cy - 4], [cx - 3, cy - 3], [cx - 2, cy - 3],
    ].forEach(function (p) { put(p[0], p[1], "red"); });
    [
      [cx - 3, cy - 5], [cx - 2, cy - 5], [cx - 3, cy - 4], [cx - 2, cy - 4],
    ].forEach(function (p) { put(p[0], p[1], "yellow"); });
    [
      [cx + 5, cy + 4], [cx + 6, cy + 3], [cx + 7, cy + 3], [cx + 8, cy + 4],
      [cx + 4, cy + 5], [cx + 5, cy + 5], [cx + 6, cy + 5], [cx + 7, cy + 5],
      [cx + 8, cy + 5], [cx + 6, cy + 6], [cx + 7, cy + 6],
    ].forEach(function (p) { put(p[0], p[1], "yellow"); });
    put(cx + 6, cy + 5, "red");
    state.cells = normalizeCells(cells, state.settings);
    saveData();
    renderAll();
    toast("Sample flower added.");
  }

  function undo() {
    if (!lastSnapshot) return;
    state.cells = normalizeCells(lastSnapshot, state.settings);
    lastSnapshot = null;
    els.undoBtn.disabled = true;
    saveData();
    renderGrid();
    toast("Undone.");
  }

  function addFacet(parts, a, b, c) {
    var ux = b[0] - a[0];
    var uy = b[1] - a[1];
    var uz = b[2] - a[2];
    var vx = c[0] - a[0];
    var vy = c[1] - a[1];
    var vz = c[2] - a[2];
    var nx = uy * vz - uz * vy;
    var ny = uz * vx - ux * vz;
    var nz = ux * vy - uy * vx;
    var len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    parts.push("facet normal " + nx.toFixed(6) + " " + ny.toFixed(6) + " " + nz.toFixed(6));
    parts.push(" outer loop");
    parts.push("  vertex " + a[0].toFixed(4) + " " + a[1].toFixed(4) + " " + a[2].toFixed(4));
    parts.push("  vertex " + b[0].toFixed(4) + " " + b[1].toFixed(4) + " " + b[2].toFixed(4));
    parts.push("  vertex " + c[0].toFixed(4) + " " + c[1].toFixed(4) + " " + c[2].toFixed(4));
    parts.push(" endloop");
    parts.push("endfacet");
  }

  function addPrism(parts, pts, z0, z1) {
    var b0 = [pts[0][0], pts[0][1], z0];
    var b1 = [pts[1][0], pts[1][1], z0];
    var b2 = [pts[2][0], pts[2][1], z0];
    var b3 = [pts[3][0], pts[3][1], z0];
    var t0 = [pts[0][0], pts[0][1], z1];
    var t1 = [pts[1][0], pts[1][1], z1];
    var t2 = [pts[2][0], pts[2][1], z1];
    var t3 = [pts[3][0], pts[3][1], z1];

    addFacet(parts, t0, t1, t2);
    addFacet(parts, t0, t2, t3);
    addFacet(parts, b2, b1, b0);
    addFacet(parts, b3, b2, b0);
    addFacet(parts, b0, b1, t1);
    addFacet(parts, b0, t1, t0);
    addFacet(parts, b1, b2, t2);
    addFacet(parts, b1, t2, t1);
    addFacet(parts, b2, b3, t3);
    addFacet(parts, b2, t3, t2);
    addFacet(parts, b3, b0, t0);
    addFacet(parts, b3, t0, t3);
  }

  function addAxisBox(parts, x0, y0, z0, x1, y1, z1) {
    addPrism(parts, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], z0, z1);
  }

  function addBar(parts, cx, cy, length, width, angle, z0, z1) {
    var ux = Math.cos(angle);
    var uy = Math.sin(angle);
    var vx = -uy;
    var vy = ux;
    var hl = length / 2;
    var hw = width / 2;
    addPrism(parts, [
      [cx - ux * hl - vx * hw, cy - uy * hl - vy * hw],
      [cx + ux * hl - vx * hw, cy + uy * hl - vy * hw],
      [cx + ux * hl + vx * hw, cy + uy * hl + vy * hw],
      [cx - ux * hl + vx * hw, cy - uy * hl + vy * hw],
    ], z0, z1);
  }

  function addStitch(parts, x, y, settings, z0, z1) {
    var cell = settings.cellSize;
    var cx = x * cell + cell / 2;
    var cy = (settings.height - y - 1) * cell + cell / 2;
    var margin = Math.max(0.08, cell * 0.14);
    var length = Math.sqrt(2) * Math.max(0.5, cell - margin * 2);
    var width = Math.min(settings.stitchWidth, cell * 0.72);
    addBar(parts, cx, cy, length, width, Math.PI / 4, z0, z1);
    addBar(parts, cx, cy, length, width, -Math.PI / 4, z0, z1);
  }

  function buildStl(name, filterColor, includeBase) {
    var s = state.settings;
    var parts = ["solid " + slug(name)];
    var baseTop = includeBase && s.includeBase && s.baseThickness > 0 ? s.baseThickness : 0;

    if (baseTop > 0) {
      addAxisBox(parts, 0, 0, 0, s.width * s.cellSize, s.height * s.cellSize, baseTop);
    }

    Object.keys(state.cells).forEach(function (key) {
      var colorId = state.cells[key];
      if (filterColor && colorId !== filterColor) return;
      var pieces = key.split(",");
      addStitch(parts, Number(pieces[0]), Number(pieces[1]), s, baseTop, baseTop + s.stitchHeight);
    });

    parts.push("endsolid " + slug(name));
    return parts.join("\n");
  }

  function exportCombinedStl() {
    state.name = normalizeName(els.exportName.value || els.designName.value || state.name);
    saveData();
    var base = exportBaseName();
    var stl = buildStl(base + "-combined", null, true);
    downloadBlob(new Blob([stl], { type: "model/stl" }), base + "-combined.stl");
    toast("Combined STL exported.");
  }

  function exportColorStls() {
    var used = {};
    Object.keys(state.cells).forEach(function (key) {
      used[state.cells[key]] = true;
    });
    var colorIds = Object.keys(used);
    if (!colorIds.length) {
      toast("Add stitches before exporting colors.");
      return;
    }
    state.name = normalizeName(els.exportName.value || els.designName.value || state.name);
    saveData();
    var base = exportBaseName();
    if (state.settings.includeBase && state.settings.baseThickness > 0) {
      var baseOnly = buildStl(base + "-base", "__none__", true);
      downloadBlob(new Blob([baseOnly], { type: "model/stl" }), base + "-base.stl");
    }
    colorIds.forEach(function (id, index) {
      var color = colorById(id);
      setTimeout(function () {
        var stl = buildStl(base + "-" + id, id, false);
        downloadBlob(new Blob([stl], { type: "model/stl" }), base + "-" + slug(color ? color.name : id) + ".stl");
      }, 180 * (index + 1));
    });
    toast("Color STLs exported.");
  }

  function exportJson() {
    state.name = normalizeName(els.exportName.value || els.designName.value || state.name);
    saveData();
    var base = exportBaseName();
    var payload = Object.assign({ format: EXPORT_FORMAT, appId: APP_ID }, state);
    downloadBlob(
      new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
      base + ".json"
    );
    toast("JSON exported.");
  }

  function importJson(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = JSON.parse(String(reader.result || ""));
        var slice = parsed;
        if (typeof AppsBackup !== "undefined" && AppsBackup.isUnifiedBackup(parsed)) {
          slice = AppsBackup.getAppSlice(parsed, APP_ID);
          if (!slice) {
            toast("No Stitch Grid data in that backup.");
            return;
          }
        }
        snapshotCells();
        state = normalizeData(slice);
        saveData();
        renderAll();
        toast("Imported stitch grid.");
      } catch (e) {
        toast("Could not import that JSON.");
      } finally {
        els.importJsonFile.value = "";
      }
    };
    reader.readAsText(file);
  }

  function bindEvents() {
    var settingInputs = [
      els.gridWidth,
      els.gridHeight,
      els.cellSize,
      els.stitchWidth,
      els.stitchHeight,
      els.baseThickness,
      els.includeBase,
      els.showGridLines,
    ];
    settingInputs.forEach(function (input) {
      input.addEventListener("change", applySettingsFromInputs);
    });
    els.designName.addEventListener("change", function () {
      state.name = normalizeName(els.designName.value);
      els.exportName.value = state.name;
      saveData();
      updateInputs();
    });
    els.exportName.addEventListener("change", function () {
      state.name = normalizeName(els.exportName.value);
      els.designName.value = state.name;
      saveData();
      updateInputs();
    });

    els.palette.addEventListener("click", function (event) {
      var btn = event.target.closest("[data-tool]");
      if (!btn) return;
      selectedTool = btn.dataset.tool;
      renderSelectedTool();
    });

    document.querySelectorAll("[data-mode]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        drawMode = btn.dataset.mode;
        pasteMode = false;
        renderDrawMode();
      });
    });

    els.stitchGrid.addEventListener("pointerdown", function (event) {
      var cell = event.target.closest(".cell");
      if (!cell) return;
      event.preventDefault();
      pointerDown = true;
      activePointerId = event.pointerId;
      lastPaintKey = "";
      els.stitchGrid.setPointerCapture(event.pointerId);
      var x = Number(cell.dataset.x);
      var y = Number(cell.dataset.y);

      if (pasteMode && copiedSelection) {
        pointerDown = false;
        activePointerId = null;
        try {
          els.stitchGrid.releasePointerCapture(event.pointerId);
        } catch (e) {
          // Some browsers may release capture automatically.
        }
        pasteSelectionAt(x, y);
        return;
      }

      if (drawMode === "select") {
        selectionStart = { x: x, y: y };
        selection = selectionFromPoints(selectionStart, selectionStart);
        renderGrid();
        renderDrawMode();
        return;
      }

      snapshotCells();
      if (drawMode === "fill") {
        var filled = floodFillFrom(x, y);
        saveData();
        renderGrid();
        toast(filled ? "Area filled." : "Nothing to fill.");
      } else if (drawMode === "circle") {
        var circled = drawCircleAt(x, y);
        saveData();
        renderGrid();
        toast(circled ? "Circle added." : "Circle is outside the grid.");
      } else {
        paintCell(cell);
      }
    });

    els.stitchGrid.addEventListener("pointermove", function (event) {
      if (!pointerDown || event.pointerId !== activePointerId) return;
      event.preventDefault();
      var cell = cellFromPoint(event.clientX, event.clientY);
      if (!cell) return;
      if (drawMode === "select" && selectionStart) {
        selection = selectionFromPoints(selectionStart, {
          x: Number(cell.dataset.x),
          y: Number(cell.dataset.y),
        });
        renderGrid();
        renderDrawMode();
        return;
      }
      if (drawMode === "paint") paintCell(cell);
    });

    function endPointer(event) {
      if (event.pointerId !== activePointerId) return;
      pointerDown = false;
      activePointerId = null;
      lastPaintKey = "";
      selectionStart = null;
      try {
        els.stitchGrid.releasePointerCapture(event.pointerId);
      } catch (e) {
        return;
      }
    }

    els.stitchGrid.addEventListener("pointerup", endPointer);
    els.stitchGrid.addEventListener("pointercancel", endPointer);
    els.saveDesignBtn.addEventListener("click", saveCurrentDesign);
    els.loadDesignBtn.addEventListener("click", loadSavedDesign);
    els.deleteDesignBtn.addEventListener("click", deleteSavedDesign);
    els.copySelectionBtn.addEventListener("click", copySelection);
    els.pasteSelectionBtn.addEventListener("click", function () {
      if (!copiedSelection) {
        toast("Copy a selection first.");
        return;
      }
      pasteMode = true;
      drawMode = "select";
      renderDrawMode();
      toast("Tap the grid to paste.");
    });
    els.clearBtn.addEventListener("click", clearGrid);
    els.sampleBtn.addEventListener("click", loadSample);
    els.undoBtn.addEventListener("click", undo);
    els.exportCombinedBtn.addEventListener("click", exportCombinedStl);
    els.exportColorBtn.addEventListener("click", exportColorStls);
    els.exportJsonBtn.addEventListener("click", exportJson);
    els.importJsonFile.addEventListener("change", function () {
      importJson(els.importJsonFile.files && els.importJsonFile.files[0]);
    });
    window.addEventListener("resize", renderGrid);
  }

  document.addEventListener("DOMContentLoaded", function () {
    els = {
      designName: document.getElementById("designName"),
      gridWidth: document.getElementById("gridWidth"),
      gridHeight: document.getElementById("gridHeight"),
      cellSize: document.getElementById("cellSize"),
      stitchWidth: document.getElementById("stitchWidth"),
      stitchHeight: document.getElementById("stitchHeight"),
      baseThickness: document.getElementById("baseThickness"),
      includeBase: document.getElementById("includeBase"),
      showGridLines: document.getElementById("showGridLines"),
      saveDesignBtn: document.getElementById("saveDesignBtn"),
      savedDesigns: document.getElementById("savedDesigns"),
      loadDesignBtn: document.getElementById("loadDesignBtn"),
      deleteDesignBtn: document.getElementById("deleteDesignBtn"),
      palette: document.getElementById("palette"),
      circleOptions: document.getElementById("circleOptions"),
      circleRadius: document.getElementById("circleRadius"),
      circleFilled: document.getElementById("circleFilled"),
      selectionMeta: document.getElementById("selectionMeta"),
      copySelectionBtn: document.getElementById("copySelectionBtn"),
      pasteSelectionBtn: document.getElementById("pasteSelectionBtn"),
      patternMeta: document.getElementById("patternMeta"),
      stitchGrid: document.getElementById("stitchGrid"),
      clearBtn: document.getElementById("clearBtn"),
      sampleBtn: document.getElementById("sampleBtn"),
      undoBtn: document.getElementById("undoBtn"),
      exportCombinedBtn: document.getElementById("exportCombinedBtn"),
      exportColorBtn: document.getElementById("exportColorBtn"),
      exportName: document.getElementById("exportName"),
      exportJsonBtn: document.getElementById("exportJsonBtn"),
      importJsonFile: document.getElementById("importJsonFile"),
      toast: document.getElementById("toast"),
    };
    els.undoBtn.disabled = true;
    els.circleRadius.value = 4;
    els.circleFilled.checked = false;
    renderPalette();
    renderAll();
    bindEvents();
  });
})();
