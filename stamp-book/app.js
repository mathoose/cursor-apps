(function () {
  "use strict";

  var L = window.StampBookLogic;
  var APP_ID = "stamp-book";
  var STORAGE_KEY = "stamp-book-v1";
  var EXPORT_FORMAT = "stamp-book-export";

  var MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  var MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  // Year grid geometry, in viewBox units. One day box is CELL × CELL.
  // The month letters, the day boxes, and the tallies are three stacked drawings that share
  // one width, so the letters and tallies can stay on screen while the days scroll.
  var CELL = 100;
  var YEAR_LEFT = 100;
  var YEAR_EDGE = 6;
  var YEAR_W = YEAR_LEFT + 12 * CELL + YEAR_EDGE;
  var YEAR_BODY_H = 31 * CELL + YEAR_EDGE * 2;
  var YEAR_HEAD_H = 84;
  var YEAR_FOOT_H = 96;

  var PLUS_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
  var CHECK_SVG = '<svg class="page-row-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

  var state;
  var els = {};
  var view = "today";
  var monthCursor;
  var yearCursor;
  var sheetDate = null;
  var todayEditor;
  var dayEditor;
  var toastTimer = null;
  var askResolve = null;
  var askNeedsText = false;
  var justStamped = null;

  function esc(text) {
    return String(text == null ? "" : text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function num(value) {
    return Math.round(value * 1000) / 1000;
  }

  function plural(count, word) {
    return count + " " + word + (count === 1 ? "" : "s");
  }

  function todayISO() {
    var d = new Date();
    return L.iso(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function weekdayOf(parts) {
    return new Date(parts.year, parts.month, parts.day).getDay();
  }

  function activePage() {
    for (var i = 0; i < state.pages.length; i++) {
      if (state.pages[i].id === state.activePageId) return state.pages[i];
    }
    return state.pages[0];
  }

  function load() {
    try {
      return L.sanitize(JSON.parse(localStorage.getItem(STORAGE_KEY)));
    } catch (e) {
      return L.emptyState();
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      toast("Could not save on this phone");
    }
  }

  function toast(message) {
    // A modal sheet covers the page, so the toast moves into whichever sheet is on top.
    var open = document.querySelectorAll("dialog[open]");
    var host = open.length ? open[open.length - 1] : document.body;
    if (els.toast.parentNode !== host) host.appendChild(els.toast);
    els.toast.hidden = false;
    els.toast.textContent = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      els.toast.hidden = true;
    }, 2400);
  }

  /* ---------- Drawing ---------- */

  // `width` is how wide the stamp is in the units of the drawing it goes into.
  function stampPath(shapeId, color, cx, cy, width) {
    var shape = L.shapeById(shapeId) || L.SHAPES[0];
    var outline = L.isLightColor(color)
      ? ' stroke="#8f887a" stroke-width="1" vector-effect="non-scaling-stroke"'
      : "";
    return '<path d="' + shape.d + '" fill-rule="evenodd" fill="' + color + '"' + outline +
      ' transform="translate(' + num(cx) + " " + num(cy) + ") scale(" + num(width / L.SHAPE_BOX) + ')"/>';
  }

  function iconSvg(shapeId, color) {
    return '<svg class="stamp-icon" viewBox="-62 -62 124 124" aria-hidden="true">' +
      stampPath(shapeId, color, 0, 0, L.SHAPE_BOX) + "</svg>";
  }

  function cellStamps(stamps, originX, originY, popIndex) {
    var size = state.stampSize;
    var out = "";
    for (var i = 0; i < stamps.length; i++) {
      var path = stampPath(
        stamps[i].s,
        stamps[i].c,
        originX + L.clampCenter(stamps[i].x, size) * CELL,
        originY + L.clampCenter(stamps[i].y, size) * CELL,
        size * CELL
      );
      out += i === popIndex ? '<g class="pop">' + path + "</g>" : path;
    }
    return out;
  }

  function stampName(shapeId, color) {
    var shape = L.shapeById(shapeId);
    return L.colorName(color) + " " + (shape ? shape.name.toLowerCase() : "stamp");
  }

  function keyChips(page, counts, selectable) {
    if (!page.legend.length) return "";
    var html = "<h3>Key</h3><div class=\"key-chips\">";
    page.legend.forEach(function (entry) {
      var count = counts[L.comboKey(entry.shape, entry.color)] || 0;
      var active = selectable && page.sel.shape === entry.shape && page.sel.color === entry.color;
      var inner = iconSvg(entry.shape, entry.color) +
        '<span class="label' + (entry.label ? "" : " blank") + '">' + esc(entry.label || "No description") + "</span>" +
        (count ? '<span class="count">' + count + "</span>" : "");
      if (selectable) {
        html += '<button type="button" class="key-chip' + (active ? " active" : "") + '" data-key-shape="' + entry.shape +
          '" data-key-color="' + entry.color + '" aria-label="' + esc("Use " + (entry.label || stampName(entry.shape, entry.color))) +
          '">' + inner + "</button>";
      } else {
        html += '<span class="key-chip">' + inner + "</span>";
      }
    });
    return html + "</div>";
  }

  /* ---------- Asking for a name or a yes ---------- */

  function ask(options) {
    return new Promise(function (resolve) {
      askResolve = resolve;
      askNeedsText = !options.confirmOnly;
      els.askPreview.hidden = !options.preview;
      els.askPreview.innerHTML = options.preview || "";
      els.askTitle.textContent = options.title;
      els.askBody.hidden = !options.body;
      els.askBody.textContent = options.body || "";
      els.askInput.hidden = !askNeedsText;
      els.askInput.value = options.value || "";
      els.askInput.placeholder = options.placeholder || "";
      els.askInput.maxLength = options.maxLength || L.MAX_LABEL;
      els.askInput.setAttribute("aria-label", options.inputLabel || options.title);
      els.askOk.textContent = options.okLabel || "Save";
      els.askOk.classList.toggle("danger", !!options.danger);
      els.askDialog.showModal();
      if (askNeedsText) els.askInput.focus();
      else els.askOk.focus();
    });
  }

  function finishAsk(value) {
    var resolve = askResolve;
    askResolve = null;
    if (els.askDialog.open) els.askDialog.close();
    if (resolve) resolve(value);
  }

  /* ---------- Stamping ---------- */

  function stampAt(date, x, y) {
    var page = activePage();
    var shape = page.sel.shape;
    var color = page.sel.color;

    function place() {
      if (!L.addStamp(page, date, shape, color, x, y, state.stampSize)) return;
      justStamped = { pageId: page.id, date: date, index: page.days[date].length - 1 };
      save();
      refresh();
      justStamped = null;
    }

    if (L.findLegend(page, shape, color)) {
      place();
      return;
    }

    ask({
      preview: iconSvg(shape, color),
      title: "Name this stamp",
      body: "What does it mean on " + page.name + "? You can change this later in settings.",
      placeholder: "Description",
      inputLabel: "Description for the " + stampName(shape, color).toLowerCase(),
      okLabel: "Stamp it",
      maxLength: L.MAX_LABEL,
    }).then(function (label) {
      if (label === null) return;
      if (!L.findLegend(page, shape, color)) {
        page.legend.push({ shape: shape, color: color, label: L.cleanLabel(label) });
      }
      place();
    });
  }

  function eraseAt(date, x, y) {
    var page = activePage();
    var index = L.hitTest(L.dayStamps(page, date), x, y, state.stampSize);
    if (index < 0) return;
    L.removeStamp(page, date, index);
    save();
    refresh();
  }

  function undoLast(date) {
    var page = activePage();
    var stamps = L.dayStamps(page, date);
    if (!stamps.length) return;
    L.removeStamp(page, date, stamps.length - 1);
    save();
    refresh();
  }

  function selectStamp(shape, color) {
    var page = activePage();
    if (shape && L.shapeById(shape)) page.sel.shape = shape;
    if (color && L.normalizeColor(color)) page.sel.color = L.normalizeColor(color);
    todayEditor.erase = false;
    dayEditor.erase = false;
    save();
    refresh();
  }

  function addColor(value) {
    var color = L.normalizeColor(value);
    if (!color) return;
    var page = activePage();
    if (page.colors.indexOf(color) < 0) page.colors.push(color);
    page.sel.color = color;
    save();
    refresh();
    if (els.settingsDialog.open) renderSettings();
  }

  /* ---------- Day editor (used on Today and in the date sheet) ---------- */

  function createEditor(root, showHead) {
    root.innerHTML =
      '<div class="editor">' +
        (showHead ? '<div class="editor-head"><h2 data-role="date"></h2><p data-role="weekday"></p></div>' : "") +
        '<div class="pad-wrap" data-role="pad"></div>' +
        '<div class="pad-actions">' +
          '<p class="pad-count" data-role="count"></p>' +
          '<button type="button" class="chip-btn" data-role="undo">Undo</button>' +
          '<button type="button" class="chip-btn" data-role="erase" aria-pressed="false">Erase</button>' +
        "</div>" +
        '<div class="tray">' +
          '<div class="tray-row shapes" data-role="shapes" role="radiogroup" aria-label="Shape"></div>' +
          '<div class="tray-row colors" data-role="colors" role="radiogroup" aria-label="Color"></div>' +
          '<p class="combo-line" data-role="combo"></p>' +
        "</div>" +
        '<div class="key-block" data-role="key"></div>' +
      "</div>";

    var part = {};
    root.querySelectorAll("[data-role]").forEach(function (node) {
      part[node.getAttribute("data-role")] = node;
    });

    var editor = { date: todayISO(), erase: false };

    editor.render = function () {
      var page = activePage();
      var parts = L.parseISO(editor.date);
      var stamps = L.dayStamps(page, editor.date);
      var pop = justStamped && justStamped.pageId === page.id && justStamped.date === editor.date
        ? justStamped.index
        : -1;

      if (part.date) {
        part.date.textContent = MONTHS[parts.month] + " " + parts.day;
        part.weekday.textContent = WEEKDAYS[weekdayOf(parts)];
      }

      part.pad.classList.toggle("erasing", editor.erase);
      part.pad.innerHTML =
        '<svg class="pad" viewBox="0 0 ' + CELL + " " + CELL + '" role="img" aria-label="' +
        esc(MONTHS[parts.month] + " " + parts.day + ", " + plural(stamps.length, "stamp") +
          (editor.erase ? ". Tap a stamp to erase it." : ". Tap to stamp.")) + '">' +
        '<text class="pad-date" x="50" y="50" dy="0.35em" text-anchor="middle">' + parts.day + "</text>" +
        cellStamps(stamps, 0, 0, pop) +
        "</svg>";

      part.count.textContent = editor.erase ? "Tap a stamp to erase it" : plural(stamps.length, "stamp");
      part.undo.disabled = !stamps.length;
      part.erase.disabled = !stamps.length && !editor.erase;
      part.erase.setAttribute("aria-pressed", editor.erase ? "true" : "false");
      part.erase.textContent = editor.erase ? "Done erasing" : "Erase";

      part.shapes.innerHTML = page.shapes.map(function (shapeId) {
        var shape = L.shapeById(shapeId);
        return '<button type="button" class="shape-btn" role="radio" data-shape="' + shapeId + '" aria-checked="' +
          (page.sel.shape === shapeId ? "true" : "false") + '" aria-label="' + shape.name + '">' +
          iconSvg(shapeId, page.sel.color) + "</button>";
      }).join("");

      part.colors.innerHTML = page.colors.map(function (color) {
        return '<button type="button" class="swatch' + (L.isLightColor(color) ? " light" : "") + '" role="radio" data-color="' +
          color + '" style="--c:' + color + '" aria-checked="' + (page.sel.color === color ? "true" : "false") +
          '" aria-label="' + L.colorName(color) + '"></button>';
      }).join("") +
        '<label class="swatch add">' + PLUS_SVG +
        '<input type="color" data-add-color value="#ff8a00" aria-label="Add a color" /></label>';

      var entry = L.findLegend(page, page.sel.shape, page.sel.color);
      part.combo.innerHTML = iconSvg(page.sel.shape, page.sel.color) + (entry
        ? "<span>" + esc(entry.label || "No description") + "</span>"
        : '<span class="new">New stamp, named on the first tap</span>');

      part.key.innerHTML = keyChips(page, L.comboCounts(page, editor.date), true);
    };

    part.pad.addEventListener("click", function (event) {
      var svg = part.pad.querySelector("svg");
      if (!svg) return;
      var rect = svg.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      var x = (event.clientX - rect.left) / rect.width;
      var y = (event.clientY - rect.top) / rect.height;
      if (x < 0 || x > 1 || y < 0 || y > 1) return;
      if (editor.erase) eraseAt(editor.date, x, y);
      else stampAt(editor.date, x, y);
    });

    part.undo.addEventListener("click", function () {
      undoLast(editor.date);
    });

    part.erase.addEventListener("click", function () {
      editor.erase = !editor.erase;
      editor.render();
    });

    root.addEventListener("click", function (event) {
      var shapeBtn = event.target.closest("[data-shape]");
      if (shapeBtn) {
        selectStamp(shapeBtn.getAttribute("data-shape"), null);
        return;
      }
      var colorBtn = event.target.closest("[data-color]");
      if (colorBtn) {
        selectStamp(null, colorBtn.getAttribute("data-color"));
        return;
      }
      var chip = event.target.closest("[data-key-shape]");
      if (chip) selectStamp(chip.getAttribute("data-key-shape"), chip.getAttribute("data-key-color"));
    });

    // "change" fires once the phone's picker closes; re-rendering on "input" would close it mid-drag.
    root.addEventListener("change", function (event) {
      if (event.target.hasAttribute("data-add-color")) addColor(event.target.value);
    });

    return editor;
  }

  /* ---------- Views ---------- */

  function renderHeader() {
    els.pageName.textContent = activePage().name;
    els.pageSwitch.setAttribute("aria-label", "Page: " + activePage().name + ". Switch page");
  }

  function renderMonth() {
    var page = activePage();
    var year = monthCursor.year;
    var month = monthCursor.month;
    var today = todayISO();
    var now = L.parseISO(today);

    els.monthTitle.textContent = MONTHS[month] + " " + year;
    els.monthTotal.textContent = plural(L.monthTally(page, year, month), "stamp");

    var html = "";
    var lead = new Date(year, month, 1).getDay();
    for (var i = 0; i < lead; i++) html += '<span class="mcell blank"></span>';
    var last = L.daysInMonth(year, month);
    for (var day = 1; day <= last; day++) {
      var date = L.iso(year, month, day);
      var stamps = L.dayStamps(page, date);
      html += '<button type="button" class="mcell' + (date === today ? " today" : "") + '" data-date="' + date +
        '" aria-label="' + MONTHS[month] + " " + day + ", " + plural(stamps.length, "stamp") + '">' +
        '<svg viewBox="0 0 ' + CELL + " " + CELL + '" aria-hidden="true">' +
        '<text class="cell-date" x="50" y="50" dy="0.35em" text-anchor="middle">' + day + "</text>" +
        cellStamps(stamps, 0, 0, -1) + "</svg></button>";
    }
    els.monthGrid.innerHTML = html;
    els.monthJump.hidden = year === now.year && month === now.month;
    els.monthKey.innerHTML = keyChips(page, L.comboCounts(page, L.iso(year, month, 1).slice(0, 8)), false);
  }

  function renderYear() {
    var page = activePage();
    var year = yearCursor;
    var now = L.parseISO(todayISO());
    var tallies = L.yearTallies(page, year);
    var top = YEAR_EDGE;
    var month;
    var day;

    els.yearTitle.textContent = String(year);
    els.yearTotal.textContent = plural(L.sum(tallies), "stamp");

    var cells = "";
    var stamps = "";
    for (month = 0; month < 12; month++) {
      var last = L.daysInMonth(year, month);
      var x = YEAR_LEFT + month * CELL;
      for (day = 1; day <= 31; day++) {
        var y = top + (day - 1) * CELL;
        if (day > last) {
          cells += '<rect class="yr-void" x="' + x + '" y="' + y + '" width="' + CELL + '" height="' + CELL + '"/>';
          continue;
        }
        if (year === now.year && month === now.month && day === now.day) {
          cells += '<rect class="yr-today" x="' + x + '" y="' + y + '" width="' + CELL + '" height="' + CELL + '"/>';
        }
        stamps += cellStamps(L.dayStamps(page, L.iso(year, month, day)), x, y, -1);
      }
    }

    var lines = "";
    for (month = 1; month < 12; month++) {
      lines += "M" + (YEAR_LEFT + month * CELL) + " " + top + "v" + 31 * CELL;
    }
    for (day = 1; day < 31; day++) {
      lines += "M" + YEAR_LEFT + " " + (top + day * CELL) + "h" + 12 * CELL;
    }

    var letters = "";
    var totals = "";
    var days = "";
    for (month = 0; month < 12; month++) {
      var cx = YEAR_LEFT + month * CELL + CELL / 2;
      letters += '<text class="yr-month" x="' + cx + '" y="62">' + MONTHS[month][0] + "</text>";
      totals += '<text class="yr-tally' + (tallies[month] ? "" : " zero") + '" x="' + cx + '" y="60">' +
        tallies[month] + "</text>";
    }
    for (day = 1; day <= 31; day++) {
      days += '<text class="yr-day" x="' + (YEAR_LEFT - 20) + '" y="' + (top + (day - 1) * CELL + CELL / 2) +
        '" dy="0.35em">' + day + "</text>";
    }

    var summary = year + " on " + page.name + ". Stamps by month: " + MONTH_SHORT.map(function (name, index) {
      return name + " " + tallies[index];
    }).join(", ") + ".";

    els.yearGrid.innerHTML =
      '<div class="year-head" data-year-part="head"><svg viewBox="0 0 ' + YEAR_W + " " + YEAR_HEAD_H +
      '" aria-hidden="true">' + letters + "</svg></div>" +
      '<svg class="year-body" data-year-part="body" viewBox="0 0 ' + YEAR_W + " " + YEAR_BODY_H +
      '" role="img" aria-label="' + esc(summary) + '">' +
      '<rect class="yr-paper" x="' + YEAR_LEFT + '" y="' + top + '" width="' + 12 * CELL + '" height="' + 31 * CELL + '"/>' +
      cells + stamps +
      '<path class="yr-lines" vector-effect="non-scaling-stroke" d="' + lines + '"/>' +
      '<rect class="yr-frame" vector-effect="non-scaling-stroke" x="' + YEAR_LEFT + '" y="' + top + '" width="' +
      12 * CELL + '" height="' + 31 * CELL + '"/>' +
      days + "</svg>" +
      '<div class="year-foot" data-year-part="foot"><svg viewBox="0 0 ' + YEAR_W + " " + YEAR_FOOT_H +
      '" aria-hidden="true"><text class="yr-sum" x="' + (YEAR_LEFT - 20) + '" y="60">=</text>' + totals + "</svg></div>";

    els.yearJump.hidden = year === now.year;
    els.yearKey.innerHTML = keyChips(page, L.comboCounts(page, String(year)), false);
  }

  function renderDayTitle() {
    var parts = L.parseISO(sheetDate);
    els.dayTitle.textContent = WEEKDAY_SHORT[weekdayOf(parts)] + ", " + MONTH_SHORT[parts.month] + " " + parts.day +
      ", " + parts.year;
  }

  function refresh() {
    renderHeader();
    if (view === "today") {
      todayEditor.date = todayISO();
      todayEditor.render();
    } else if (view === "month") {
      renderMonth();
    } else {
      renderYear();
    }
    if (els.dayDialog.open && sheetDate) {
      dayEditor.date = sheetDate;
      dayEditor.render();
      renderDayTitle();
    }
  }

  // The year view pins its month letters just under the app header.
  function syncHeaderHeight() {
    document.documentElement.style.setProperty("--header-h", els.appHeader.offsetHeight + "px");
  }

  function setView(next) {
    view = next;
    todayEditor.erase = false;
    els.viewTabs.querySelectorAll("[data-view]").forEach(function (tab) {
      tab.setAttribute("aria-selected", tab.getAttribute("data-view") === view ? "true" : "false");
    });
    els.viewToday.hidden = view !== "today";
    els.viewMonth.hidden = view !== "month";
    els.viewYear.hidden = view !== "year";
    refresh();
    window.scrollTo(0, 0);
  }

  function resetCursors() {
    var now = L.parseISO(todayISO());
    monthCursor = { year: now.year, month: now.month };
    yearCursor = now.year;
  }

  function shiftMonth(delta) {
    var d = new Date(monthCursor.year, monthCursor.month + delta, 1);
    monthCursor = { year: d.getFullYear(), month: d.getMonth() };
    renderMonth();
  }

  function openDay(date) {
    if (!L.parseISO(date)) return;
    sheetDate = date;
    dayEditor.erase = false;
    dayEditor.date = date;
    dayEditor.render();
    renderDayTitle();
    if (!els.dayDialog.open) els.dayDialog.showModal();
    els.dayDialog.scrollTop = 0;
  }

  function shiftDay(delta) {
    if (!sheetDate) return;
    sheetDate = L.shiftISO(sheetDate, delta);
    dayEditor.erase = false;
    refresh();
  }

  /* ---------- Pages ---------- */

  function pageGlyphs(page) {
    var glyphs = page.legend.slice(0, 3).map(function (entry) {
      return iconSvg(entry.shape, entry.color);
    });
    for (var i = 0; glyphs.length < 3 && i < page.shapes.length; i++) {
      glyphs.push(iconSvg(page.shapes[i], page.colors[glyphs.length % page.colors.length]));
    }
    return glyphs.join("");
  }

  function renderPages() {
    els.pageList.innerHTML = state.pages.map(function (page) {
      var active = page.id === state.activePageId;
      return '<button type="button" class="page-row' + (active ? " active" : "") + '" data-page="' + esc(page.id) + '"' +
        (active ? ' aria-current="true"' : "") + ">" +
        '<span class="page-row-glyphs">' + pageGlyphs(page) + "</span>" +
        '<span class="page-row-text"><span class="page-row-name">' + esc(page.name) + "</span>" +
        '<span class="page-row-sub">' + plural(L.pageTotal(page), "stamp") + "</span></span>" +
        (active ? CHECK_SVG : "") + "</button>";
    }).join("");
  }

  function switchPage(id) {
    state.activePageId = id;
    todayEditor.erase = false;
    save();
    refresh();
  }

  function createPage() {
    ask({
      title: "New page",
      body: "Each page keeps its own stamps, shapes, colors, and descriptions.",
      placeholder: "Page name",
      inputLabel: "Page name",
      okLabel: "Create",
      maxLength: L.MAX_NAME,
    }).then(function (name) {
      if (name === null) return;
      var page = L.newPage(L.cleanName(name, "Page " + (state.pages.length + 1)));
      state.pages.push(page);
      if (els.pagesDialog.open) els.pagesDialog.close();
      switchPage(page.id);
      toast("Created " + page.name);
    });
  }

  /* ---------- Settings ---------- */

  function renderSizePreview() {
    var page = activePage();
    var spots = [[0.3, 0.3], [0.7, 0.44], [0.42, 0.72]];
    var size = state.stampSize;
    els.sizeValue.textContent = Math.round(size * 100) + "%";
    els.sizePreview.innerHTML = '<svg viewBox="0 0 ' + CELL + " " + CELL + '">' + spots.map(function (spot, index) {
      return stampPath(
        page.shapes[index % page.shapes.length],
        page.colors[index % page.colors.length],
        L.clampCenter(spot[0], size) * CELL,
        L.clampCenter(spot[1], size) * CELL,
        size * CELL
      );
    }).join("") + "</svg>";
  }

  function renderSettings() {
    var page = activePage();
    var counts = L.comboCounts(page);

    els.pageNameInput.value = page.name;

    els.shapeToggles.innerHTML = L.SHAPES.map(function (shape) {
      var on = page.shapes.indexOf(shape.id) >= 0;
      return '<button type="button" class="shape-toggle" data-toggle-shape="' + shape.id + '" aria-pressed="' +
        (on ? "true" : "false") + '">' + iconSvg(shape.id, "#1f1c17") + "<span>" + shape.name + "</span></button>";
    }).join("");

    var missingDefault = L.DEFAULT_COLORS.some(function (color) {
      return page.colors.indexOf(color) < 0;
    });
    els.colorEdit.innerHTML = page.colors.map(function (color) {
      var removable = page.colors.length > 1;
      return '<button type="button" class="swatch' + (L.isLightColor(color) ? " light" : "") +
        (removable ? " removable" : "") + '" style="--c:' + color + '"' +
        (removable ? ' data-remove-color="' + color + '" aria-label="Remove ' + L.colorName(color) + '"'
          : ' disabled aria-label="' + L.colorName(color) + '"') + "></button>";
    }).join("") +
      '<label class="swatch add">' + PLUS_SVG +
      '<input type="color" data-add-color value="#ff8a00" aria-label="Add a color" /></label>' +
      (missingDefault
        ? '<div class="color-restore"><button type="button" class="link-btn" data-restore-colors>Bring back the starting colors</button></div>'
        : "");

    els.legendEdit.innerHTML = page.legend.length
      ? page.legend.map(function (entry, index) {
        var count = counts[L.comboKey(entry.shape, entry.color)] || 0;
        return '<div class="legend-row">' + iconSvg(entry.shape, entry.color) +
          '<input type="text" data-legend="' + index + '" value="' + esc(entry.label) + '" maxlength="' + L.MAX_LABEL +
          '" placeholder="Description" autocomplete="off" enterkeyhint="done" aria-label="Description for the ' +
          esc(stampName(entry.shape, entry.color).toLowerCase()) + '" />' +
          (count
            ? '<span class="legend-count" aria-label="' + plural(count, "stamp") + '">×' + count + "</span>"
            : '<button type="button" class="legend-remove" data-legend-remove="' + index +
              '" aria-label="Remove the unused ' + esc(stampName(entry.shape, entry.color).toLowerCase()) + '">×</button>') +
          "</div>";
      }).join("")
      : '<p class="hint">Nothing here yet. The first time you stamp a new shape and color, you are asked what it means, and it shows up here to edit.</p>';

    els.sizeInput.value = String(Math.round(state.stampSize * 100));
    renderSizePreview();
  }

  function openSettings() {
    renderSettings();
    els.settingsDialog.showModal();
    els.settingsDialog.scrollTop = 0;
  }

  function toggleShape(shapeId) {
    var page = activePage();
    var at = page.shapes.indexOf(shapeId);
    if (at >= 0) {
      if (page.shapes.length === 1) {
        toast("Keep at least one shape");
        return;
      }
      page.shapes.splice(at, 1);
      if (page.sel.shape === shapeId) page.sel.shape = page.shapes[0];
    } else {
      // Keep the library order so the tray never reshuffles.
      page.shapes = L.SHAPES.map(function (shape) { return shape.id; }).filter(function (id) {
        return id === shapeId || page.shapes.indexOf(id) >= 0;
      });
    }
    save();
    renderSettings();
    refresh();
  }

  function removeColor(color) {
    var page = activePage();
    var at = page.colors.indexOf(color);
    if (at < 0 || page.colors.length === 1) return;
    ask({
      confirmOnly: true,
      preview: iconSvg("circle", color),
      title: "Remove this color?",
      body: "It leaves this page's color choices. Stamps already made with it stay.",
      okLabel: "Remove",
      danger: true,
    }).then(function (yes) {
      if (!yes) return;
      at = page.colors.indexOf(color);
      if (at < 0 || page.colors.length === 1) return;
      page.colors.splice(at, 1);
      if (page.sel.color === color) page.sel.color = page.colors[0];
      save();
      renderSettings();
      refresh();
    });
  }

  function restoreColors() {
    var page = activePage();
    var extras = page.colors.filter(function (color) {
      return L.DEFAULT_COLORS.indexOf(color) < 0;
    });
    page.colors = L.DEFAULT_COLORS.concat(extras);
    save();
    renderSettings();
    refresh();
  }

  function deletePage() {
    var page = activePage();
    var total = L.pageTotal(page);
    ask({
      confirmOnly: true,
      title: "Delete " + page.name + "?",
      body: total
        ? "Its " + plural(total, "stamp") + " and descriptions are removed from this phone."
        : "This page has no stamps yet.",
      okLabel: "Delete",
      danger: true,
    }).then(function (yes) {
      if (!yes) return;
      state.pages = state.pages.filter(function (entry) { return entry.id !== page.id; });
      if (!state.pages.length) state.pages.push(L.newPage("Page 1"));
      if (els.settingsDialog.open) els.settingsDialog.close();
      switchPage(state.pages[0].id);
      toast("Deleted " + page.name);
    });
  }

  function exportJson() {
    var payload = { format: EXPORT_FORMAT, exportedAt: new Date().toISOString(), data: state };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "stamp-book-" + todayISO() + ".json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast("Exported " + plural(state.pages.length, "page"));
  }

  function importJson(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onerror = function () { toast("Could not read that file"); };
    reader.onload = function () {
      try {
        var parsed = JSON.parse(reader.result);
        var slice = parsed;
        if (typeof AppsBackup !== "undefined" && AppsBackup.isUnifiedBackup(parsed)) {
          slice = AppsBackup.getAppSlice(parsed, APP_ID);
          if (!slice) {
            toast("No Stamp Book data in that file");
            return;
          }
        } else if (parsed && parsed.format === EXPORT_FORMAT && parsed.data) {
          slice = parsed.data;
        }
        if (!slice || !Array.isArray(slice.pages) || !slice.pages.length) throw new Error("not a stamp book");
        state = L.sanitize(slice);
        save();
        renderSettings();
        refresh();
        toast("Imported " + plural(state.pages.length, "page"));
      } catch (e) {
        toast("That file is not a Stamp Book backup");
      } finally {
        els.importFile.value = "";
      }
    };
    reader.readAsText(file);
  }

  /* ---------- Wiring ---------- */

  function cacheEls() {
    [
      "appHeader", "pageSwitch", "pageName", "settingsBtn", "viewTabs", "viewToday", "viewMonth", "viewYear",
      "todayEditor", "prevMonth", "nextMonth", "monthTitle", "monthTotal", "monthGrid", "monthJump", "monthKey",
      "prevYear", "nextYear", "yearTitle", "yearTotal", "yearGrid", "yearJump", "yearKey",
      "dayDialog", "dayPrev", "dayNext", "dayTitle", "dayDone", "dayEditor",
      "pagesDialog", "pagesDone", "pageList", "newPageBtn",
      "settingsDialog", "settingsDone", "pageNameInput", "shapeToggles", "colorEdit", "legendEdit",
      "sizeInput", "sizeValue", "sizePreview", "exportBtn", "importFile", "deletePageBtn",
      "askDialog", "askForm", "askPreview", "askTitle", "askBody", "askInput", "askCancel", "askOk", "toast",
    ].forEach(function (id) {
      els[id] = document.getElementById(id);
    });
  }

  function closeOnBackdrop(dialog) {
    dialog.addEventListener("click", function (event) {
      if (event.target === dialog) dialog.close();
    });
  }

  function wire() {
    els.viewTabs.addEventListener("click", function (event) {
      var tab = event.target.closest("[data-view]");
      if (!tab) return;
      var next = tab.getAttribute("data-view");
      // Opening Month or Year from another tab starts on the current one.
      if (next !== view) resetCursors();
      setView(next);
    });

    els.prevMonth.addEventListener("click", function () { shiftMonth(-1); });
    els.nextMonth.addEventListener("click", function () { shiftMonth(1); });
    els.monthJump.addEventListener("click", function () {
      resetCursors();
      renderMonth();
    });
    els.monthGrid.addEventListener("click", function (event) {
      var cell = event.target.closest("[data-date]");
      if (cell) openDay(cell.getAttribute("data-date"));
    });

    els.prevYear.addEventListener("click", function () {
      yearCursor -= 1;
      renderYear();
    });
    els.nextYear.addEventListener("click", function () {
      yearCursor += 1;
      renderYear();
    });
    els.yearJump.addEventListener("click", function () {
      resetCursors();
      renderYear();
    });
    els.yearGrid.addEventListener("click", function (event) {
      var part = event.target.closest("[data-year-part]");
      if (!part) return;
      var kind = part.getAttribute("data-year-part");
      var rect = part.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      var month = Math.floor((((event.clientX - rect.left) / rect.width) * YEAR_W - YEAR_LEFT) / CELL);
      if (month < 0 || month > 11) return;
      if (kind !== "body") {
        // A month letter or its tally opens that month.
        monthCursor = { year: yearCursor, month: month };
        setView("month");
        return;
      }
      var day = Math.floor((((event.clientY - rect.top) / rect.height) * YEAR_BODY_H - YEAR_EDGE) / CELL) + 1;
      if (day < 1 || day > L.daysInMonth(yearCursor, month)) return;
      openDay(L.iso(yearCursor, month, day));
    });

    els.dayPrev.addEventListener("click", function () { shiftDay(-1); });
    els.dayNext.addEventListener("click", function () { shiftDay(1); });
    els.dayDone.addEventListener("click", function () { els.dayDialog.close(); });
    els.dayDialog.addEventListener("close", function () {
      sheetDate = null;
      refresh();
    });

    els.pageSwitch.addEventListener("click", function () {
      renderPages();
      els.pagesDialog.showModal();
    });
    els.pagesDone.addEventListener("click", function () { els.pagesDialog.close(); });
    els.pageList.addEventListener("click", function (event) {
      var row = event.target.closest("[data-page]");
      if (!row) return;
      els.pagesDialog.close();
      switchPage(row.getAttribute("data-page"));
    });
    els.newPageBtn.addEventListener("click", createPage);

    els.settingsBtn.addEventListener("click", openSettings);
    els.settingsDone.addEventListener("click", function () { els.settingsDialog.close(); });
    els.settingsDialog.addEventListener("close", function () {
      // An emptied name box falls back to the name the page already has.
      els.pageNameInput.value = activePage().name;
      refresh();
    });
    els.pageNameInput.addEventListener("input", function () {
      var name = L.cleanName(els.pageNameInput.value, "");
      if (!name) return;
      activePage().name = name;
      save();
      renderHeader();
    });
    els.pageNameInput.addEventListener("change", function () {
      els.pageNameInput.value = activePage().name;
    });
    els.settingsDialog.addEventListener("click", function (event) {
      var shapeBtn = event.target.closest("[data-toggle-shape]");
      if (shapeBtn) {
        toggleShape(shapeBtn.getAttribute("data-toggle-shape"));
        return;
      }
      var colorBtn = event.target.closest("[data-remove-color]");
      if (colorBtn) {
        removeColor(colorBtn.getAttribute("data-remove-color"));
        return;
      }
      if (event.target.closest("[data-restore-colors]")) {
        restoreColors();
        return;
      }
      var removeBtn = event.target.closest("[data-legend-remove]");
      if (removeBtn) {
        activePage().legend.splice(Number(removeBtn.getAttribute("data-legend-remove")), 1);
        save();
        renderSettings();
        refresh();
      }
    });
    els.settingsDialog.addEventListener("input", function (event) {
      if (!event.target.hasAttribute("data-legend")) return;
      var entry = activePage().legend[Number(event.target.getAttribute("data-legend"))];
      if (!entry) return;
      entry.label = L.cleanLabel(event.target.value);
      save();
      refresh();
    });
    els.settingsDialog.addEventListener("change", function (event) {
      if (event.target.hasAttribute("data-add-color")) addColor(event.target.value);
    });
    els.settingsDialog.addEventListener("keydown", function (event) {
      if (event.key === "Enter" && event.target.matches("input[type='text']")) event.target.blur();
    });
    els.sizeInput.addEventListener("input", function () {
      state.stampSize = L.clampSize(Number(els.sizeInput.value) / 100);
      save();
      renderSizePreview();
      refresh();
    });
    els.exportBtn.addEventListener("click", exportJson);
    els.importFile.addEventListener("change", function () {
      importJson(els.importFile.files && els.importFile.files[0]);
    });
    els.deletePageBtn.addEventListener("click", deletePage);

    els.askForm.addEventListener("submit", function (event) {
      event.preventDefault();
      finishAsk(askNeedsText ? els.askInput.value : true);
    });
    els.askCancel.addEventListener("click", function () { finishAsk(null); });
    els.askDialog.addEventListener("close", function () {
      // "close" arrives late, so skip it when a newer question has already opened.
      if (!els.askDialog.open) finishAsk(null);
    });
    els.askDialog.addEventListener("click", function (event) {
      if (event.target === els.askDialog) finishAsk(null);
    });

    [els.dayDialog, els.pagesDialog, els.settingsDialog].forEach(closeOnBackdrop);

    window.addEventListener("resize", syncHeaderHeight);
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(syncHeaderHeight).observe(els.appHeader);

    // The app can sit open past midnight; coming back to it moves Today to the new date.
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) refresh();
    });
  }

  function init() {
    state = load();
    cacheEls();
    resetCursors();
    todayEditor = createEditor(els.todayEditor, true);
    dayEditor = createEditor(els.dayEditor, false);
    wire();
    syncHeaderHeight();
    refresh();
  }

  init();
})();
