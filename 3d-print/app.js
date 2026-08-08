(function () {
  'use strict';

  var STORAGE_KEY = '3d-print-v1';
  var SCHEMA_VERSION = 1;
  var FILAMENT_SORT_INTERVAL_MS = 24 * 60 * 60 * 1000;
  var DEFAULT_FILAMENT_HEXES = [
    '#8B4513', '#D4A574', '#9C27B0', '#1A237E', '#1B5E20', '#C62828', '#F57C00', '#F9D71C',
    '#E91E8C', '#00ACC1', '#FFFFFF', '#212121', '#78909C', '#5D4037', '#7E57C2', '#3949AB',
    '#00897B', '#AED581', '#FF7043', '#FFD54F', '#4FC3F7', '#F06292', '#8BC34A', '#FFEB3B'
  ];
  var STATUS_LABELS = {
    queued: 'To print',
    waitlisted: 'Waitlisted',
    ready: 'Ready',
    done: 'Done'
  };

  var state = {
    version: SCHEMA_VERSION,
    items: [],
    printers: [],
    timers: [],
    history: [],
    categories: [],
    filamentColors: [],
    filamentColorSortAt: 0,
    statusFilter: 'all',
    categoryFilter: 'all'
  };

  var currentView = 'queue';
  var doneExpanded = false;
  var toastTimer = null;
  var tickTimer = null;
  var pendingImport = null;
  var editingItemId = null;
  var editingDraft = null;
  var editingPrinterId = null;
  var sendTargetItemId = null;
  var fcpUiBound = false;
  var filamentPickerState = { h: 30, s: 1, v: 1, confirmLabel: 'Add color', onConfirm: null };

  var quickUi = {
    priority: 0,
    categories: new Set(),
    filament: new Set(),
    categoryAdding: false,
    plateCount: 1
  };
  var editorCategoryAdding = false;
  var bulkPlateCategorySelected = new Set();
  var bulkPlateCategoryAdding = false;

  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.startsWith('on') && typeof attrs[k] === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        } else if (k === 'dataset') Object.assign(node.dataset, attrs[k]);
        else if (attrs[k] === false || attrs[k] == null) return;
        else node.setAttribute(k, attrs[k]);
      });
    }
    if (children) {
      (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (c == null || c === false) return;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return node;
  }

  function showToast(msg, opts) {
    opts = opts || {};
    var toast = document.getElementById('toast');
    var msgEl = document.getElementById('toastMsg');
    if (!toast || !msgEl) return;
    msgEl.textContent = msg;
    toast.classList.toggle('error', !!opts.error);
    toast.classList.add('open');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.classList.remove('open'); }, opts.duration || 2200);
  }

  function openModal(id) {
    var m = document.getElementById(id);
    if (m) m.classList.add('open');
  }

  function closeModal(id) {
    var m = document.getElementById(id);
    if (m) m.classList.remove('open');
  }

  function normalizeFilamentHex(hex) {
    var s = (hex || '').trim().toUpperCase();
    if (/^#[0-9A-F]{6}$/.test(s)) return s;
    if (/^#[0-9A-F]{3}$/.test(s)) {
      return '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
    }
    return '#888888';
  }

  function filamentTipColor(hex) {
    var h = normalizeFilamentHex(hex).slice(1);
    var r = parseInt(h.slice(0, 2), 16);
    var g = parseInt(h.slice(2, 4), 16);
    var b = parseInt(h.slice(4, 6), 16);
    var factor = 0.78;
    return '#' + [r, g, b].map(function (n) {
      return Math.max(0, Math.min(255, Math.round(n * factor))).toString(16).padStart(2, '0');
    }).join('').toUpperCase();
  }

  function isLightFilament(hex) {
    var h = normalizeFilamentHex(hex).slice(1);
    var r = parseInt(h.slice(0, 2), 16);
    var g = parseInt(h.slice(2, 4), 16);
    var b = parseInt(h.slice(4, 6), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 > 200;
  }

  function normalizeLink(url) {
    var s = (url || '').trim();
    if (!s) return '';
    if (/^https?:\/\//i.test(s)) return s;
    return 'https://' + s;
  }

  function isValidLink(url) {
    if (!url) return true;
    try {
      var u = new URL(url);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch (e) {
      return false;
    }
  }

  function linkLabel(url) {
    try {
      var u = new URL(url);
      if (/instagram\.com/i.test(u.hostname)) return 'Instagram';
      return u.hostname.replace(/^www\./, '');
    } catch (e) {
      return 'Open link';
    }
  }

  function normalizeCategoryIds(ids) {
    if (!Array.isArray(ids)) return [];
    return ids.filter(function (id) { return typeof id === 'string' && id; });
  }

  function normalizeFilamentColorIds(ids, legacyId) {
    var out = normalizeCategoryIds(ids);
    if (!out.length && legacyId) out = [legacyId];
    return out;
  }

  function normalizePlate(p) {
    return {
      id: p.id || uid('pl'),
      name: (p.name || '').trim() || 'Plate',
      done: !!p.done,
      categoryIds: normalizeCategoryIds(p.categoryIds),
      filamentColorIds: normalizeFilamentColorIds(p.filamentColorIds)
    };
  }

  function normalizeItem(t) {
    var status = t.status;
    if (!STATUS_LABELS[status]) {
      status = t.completed || t.done ? 'done' : 'queued';
    }
    var plateCount = Math.max(1, parseInt(t.plateCount, 10) || 1);
    var plates = Array.isArray(t.plates) ? t.plates.map(normalizePlate) : [];
    return {
      id: t.id || uid('item'),
      title: t.title || '',
      notes: t.notes || '',
      link: normalizeLink(t.link),
      priority: typeof t.priority === 'number' ? t.priority : 0,
      status: status,
      waitlistReason: t.waitlistReason || '',
      paid: !!t.paid,
      ams: !!t.ams,
      filamentColorIds: normalizeFilamentColorIds(t.filamentColorIds, t.filamentColorId),
      categoryIds: normalizeCategoryIds(t.categoryIds),
      plateCount: plateCount,
      plates: plates,
      printerId: t.printerId || null,
      estimatedMinutes: t.estimatedMinutes != null ? Math.max(0, parseInt(t.estimatedMinutes, 10) || 0) : null,
      sortOrder: typeof t.sortOrder === 'number' ? t.sortOrder : null,
      createdAt: t.createdAt || new Date().toISOString(),
      updatedAt: t.updatedAt || new Date().toISOString()
    };
  }

  function normalizePrinter(p) {
    return {
      id: p.id || uid('pr'),
      name: (p.name || '').trim() || 'Printer',
      model: (p.model || '').trim(),
      notes: p.notes || '',
      createdAt: p.createdAt || new Date().toISOString()
    };
  }

  function normalizeTimer(t) {
    return {
      id: t.id || uid('tm'),
      printerId: t.printerId || null,
      itemId: t.itemId || null,
      itemTitle: t.itemTitle || '',
      durationMinutes: Math.max(1, parseInt(t.durationMinutes, 10) || 60),
      startedAt: t.startedAt || new Date().toISOString(),
      endsAt: t.endsAt || new Date(Date.now() + 60 * 60000).toISOString(),
      status: t.status === 'finished' || t.status === 'cancelled' ? t.status : 'running'
    };
  }

  function normalizeHistory(h) {
    return {
      id: h.id || uid('hx'),
      printerId: h.printerId || null,
      itemId: h.itemId || null,
      itemTitle: h.itemTitle || 'Print',
      startedAt: h.startedAt || null,
      finishedAt: h.finishedAt || new Date().toISOString(),
      durationMinutes: h.durationMinutes != null ? Math.max(0, parseInt(h.durationMinutes, 10) || 0) : null
    };
  }

  function normalizeCategory(c) {
    return {
      id: c.id || uid('cat'),
      name: (c.name || '').trim(),
      createdAt: c.createdAt || new Date().toISOString()
    };
  }

  function normalizeFilamentColorDef(c) {
    return {
      id: c.id || uid('fc'),
      hex: normalizeFilamentHex(c.hex),
      name: (c.name || '').trim(),
      useCount: typeof c.useCount === 'number' ? c.useCount : 0,
      createdAt: c.createdAt || new Date().toISOString()
    };
  }

  function ensureFilamentColors() {
    if (!Array.isArray(state.filamentColors)) state.filamentColors = [];
    if (!state.filamentColors.length) {
      state.filamentColors = DEFAULT_FILAMENT_HEXES.map(function (hex, i) {
        return normalizeFilamentColorDef({
          hex: hex,
          createdAt: new Date(Date.now() - i).toISOString()
        });
      });
      state.filamentColorSortAt = Date.now();
    }
  }

  function getFilamentColor(id) {
    return state.filamentColors.find(function (c) { return c.id === id; }) || null;
  }

  function getCategory(id) {
    return state.categories.find(function (c) { return c.id === id; }) || null;
  }

  function getPrinter(id) {
    return state.printers.find(function (p) { return p.id === id; }) || null;
  }

  function getItem(id) {
    return state.items.find(function (t) { return t.id === id; }) || null;
  }

  function maybeReorderFilamentColors() {
    ensureFilamentColors();
    var now = Date.now();
    var lastSort = state.filamentColorSortAt || 0;
    if (now - lastSort < FILAMENT_SORT_INTERVAL_MS) return;
    state.filamentColors.sort(function (a, b) {
      var diff = (b.useCount || 0) - (a.useCount || 0);
      if (diff !== 0) return diff;
      return (a.createdAt || '') < (b.createdAt || '') ? -1 : 1;
    });
    state.filamentColors.forEach(function (c) { c.useCount = 0; });
    state.filamentColorSortAt = now;
    saveState();
  }

  function recordFilamentColorUse(colorId) {
    if (!colorId) return;
    maybeReorderFilamentColors();
    var color = getFilamentColor(colorId);
    if (!color) return;
    color.useCount = (color.useCount || 0) + 1;
  }

  function addFilamentColor(hex, opts) {
    opts = opts || {};
    var normalized = normalizeFilamentHex(hex);
    var existing = state.filamentColors.find(function (c) { return c.hex === normalized; });
    if (existing) return existing.id;
    var id = uid('fc');
    state.filamentColors.push(normalizeFilamentColorDef({
      id: id,
      hex: normalized,
      name: opts.name || '',
      useCount: 0
    }));
    saveState();
    return id;
  }

  function updateFilamentColor(id, patch) {
    var color = getFilamentColor(id);
    if (!color) return;
    if (patch.hex) color.hex = normalizeFilamentHex(patch.hex);
    if (patch.name !== undefined) color.name = (patch.name || '').trim();
    saveState();
  }

  function deleteFilamentColor(id) {
    state.filamentColors = state.filamentColors.filter(function (c) { return c.id !== id; });
    state.items.forEach(function (t) {
      if (Array.isArray(t.filamentColorIds)) {
        t.filamentColorIds = t.filamentColorIds.filter(function (fid) { return fid !== id; });
      }
      (t.plates || []).forEach(function (p) {
        p.filamentColorIds = (p.filamentColorIds || []).filter(function (fid) { return fid !== id; });
      });
    });
    quickUi.filament.delete(id);
    if (editingDraft && Array.isArray(editingDraft.filamentColorIds)) {
      editingDraft.filamentColorIds = editingDraft.filamentColorIds.filter(function (fid) { return fid !== id; });
    }
    saveState();
  }

  function compareItemOrder(a, b) {
    var ao = typeof a.sortOrder === 'number' ? a.sortOrder : Number.MAX_SAFE_INTEGER;
    var bo = typeof b.sortOrder === 'number' ? b.sortOrder : Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    var aDone = a.status === 'done';
    var bDone = b.status === 'done';
    if (aDone !== bDone) return aDone ? 1 : -1;
    var prio = b.priority - a.priority;
    if (prio) return prio;
    return a.createdAt < b.createdAt ? -1 : 1;
  }

  function ensureItemSortOrders() {
    var open = [];
    var done = [];
    state.items.forEach(function (t) {
      if (t.status === 'done') done.push(t);
      else open.push(t);
    });
    [open, done].forEach(function (group) {
      if (group.every(function (t) { return typeof t.sortOrder === 'number'; })) return;
      group.sort(compareItemOrder);
      group.forEach(function (t, i) { t.sortOrder = i; });
    });
  }

  function sortItems(items) {
    ensureItemSortOrders();
    return items.slice().sort(compareItemOrder);
  }

  function repositionItemByPriority(item) {
    var siblings = sortItems(state.items.filter(function (t) {
      return (t.status === 'done') === (item.status === 'done') && t.id !== item.id;
    }));
    var insertIdx = siblings.length;
    if (item.priority > 0) {
      for (var i = 0; i < siblings.length; i++) {
        if (siblings[i].priority < item.priority) {
          insertIdx = i;
          break;
        }
      }
    }
    siblings.splice(insertIdx, 0, item);
    siblings.forEach(function (t, i) { t.sortOrder = i; });
  }

  function moveItemToTop(item) {
    var siblings = sortItems(state.items.filter(function (t) {
      return (t.status === 'done') === (item.status === 'done') && t.id !== item.id;
    }));
    siblings.unshift(item);
    siblings.forEach(function (t, i) { t.sortOrder = i; });
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: SCHEMA_VERSION,
        items: state.items,
        printers: state.printers,
        timers: state.timers,
        history: state.history,
        categories: state.categories,
        filamentColors: state.filamentColors,
        filamentColorSortAt: state.filamentColorSortAt,
        statusFilter: state.statusFilter,
        categoryFilter: state.categoryFilter
      }));
    } catch (e) {
      console.error(e);
      showToast('Could not save', { error: true });
    }
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        ensureFilamentColors();
        return;
      }
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return;
      if (Array.isArray(parsed.items)) state.items = parsed.items.map(normalizeItem);
      if (Array.isArray(parsed.printers)) state.printers = parsed.printers.map(normalizePrinter);
      if (Array.isArray(parsed.timers)) state.timers = parsed.timers.map(normalizeTimer);
      if (Array.isArray(parsed.history)) state.history = parsed.history.map(normalizeHistory);
      if (Array.isArray(parsed.categories)) state.categories = parsed.categories.map(normalizeCategory);
      if (Array.isArray(parsed.filamentColors)) {
        state.filamentColors = parsed.filamentColors.map(normalizeFilamentColorDef);
      }
      if (typeof parsed.filamentColorSortAt === 'number') state.filamentColorSortAt = parsed.filamentColorSortAt;
      if (typeof parsed.statusFilter === 'string') state.statusFilter = parsed.statusFilter;
      if (typeof parsed.categoryFilter === 'string') state.categoryFilter = parsed.categoryFilter;
      ensureItemSortOrders();
      ensureFilamentColors();
      maybeReorderFilamentColors();
    } catch (e) {
      console.error(e);
      showToast('Could not load saved data', { error: true });
      ensureFilamentColors();
    }
  }

  function addCategory(name, opts) {
    opts = opts || {};
    var trimmed = (name || '').trim();
    if (!trimmed) return null;
    var existing = state.categories.find(function (c) {
      return c.name.toLowerCase() === trimmed.toLowerCase();
    });
    if (existing) {
      if (!opts.silent) showToast('Category already exists', { error: true });
      return existing.id;
    }
    var id = uid('cat');
    state.categories.push(normalizeCategory({ id: id, name: trimmed }));
    if (!opts.deferSave) saveState();
    if (!opts.silent) showToast('Added category: ' + trimmed);
    return id;
  }

  function deleteCategory(id) {
    state.categories = state.categories.filter(function (c) { return c.id !== id; });
    state.items.forEach(function (t) {
      t.categoryIds = (t.categoryIds || []).filter(function (cid) { return cid !== id; });
      (t.plates || []).forEach(function (p) {
        p.categoryIds = (p.categoryIds || []).filter(function (cid) { return cid !== id; });
      });
    });
    quickUi.categories.delete(id);
    saveState();
  }

  function moveCategory(index, delta) {
    var next = index + delta;
    if (next < 0 || next >= state.categories.length) return;
    var arr = state.categories;
    var tmp = arr[index];
    arr[index] = arr[next];
    arr[next] = tmp;
    saveState();
  }

  function addBulkCategories(text) {
    var names = String(text || '')
      .split(/[\n,]+/)
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
    var added = 0;
    names.forEach(function (name) {
      var before = state.categories.length;
      addCategory(name, { silent: true, deferSave: true });
      if (state.categories.length > before) added++;
    });
    saveState();
    if (!added) showToast('All names already exist', { error: true });
    else showToast('Added ' + added + ' categor' + (added === 1 ? 'y' : 'ies'));
    return added;
  }

  function makePlates(count, categoryIds) {
    var n = Math.max(1, parseInt(count, 10) || 1);
    var cats = normalizeCategoryIds(categoryIds);
    var plates = [];
    for (var i = 1; i <= n; i++) {
      plates.push(normalizePlate({
        name: 'Plate ' + i,
        categoryIds: cats.slice()
      }));
    }
    return plates;
  }

  function syncPlateCountFromPlates(draft) {
    if (!draft) return;
    if (draft.plates && draft.plates.length) {
      draft.plateCount = Math.max(draft.plateCount || 1, draft.plates.length);
    }
  }

  function addItem(partial) {
    var plateCount = Math.max(1, parseInt(partial.plateCount, 10) || 1);
    var plates = Array.isArray(partial.plates) ? partial.plates.map(normalizePlate) : makePlates(plateCount, partial.categoryIds);
    var item = normalizeItem({
      title: partial.title,
      notes: partial.notes || '',
      link: partial.link || '',
      priority: partial.priority || 0,
      status: partial.status || 'queued',
      waitlistReason: partial.waitlistReason || '',
      paid: !!partial.paid,
      ams: !!partial.ams,
      filamentColorIds: partial.filamentColorIds || [],
      categoryIds: partial.categoryIds || [],
      plateCount: plateCount,
      plates: plates,
      printerId: partial.printerId || null,
      estimatedMinutes: partial.estimatedMinutes
    });
    state.items.push(item);
    repositionItemByPriority(item);
    saveState();
    return item;
  }

  function updateItemFromDraft() {
    if (!editingDraft || !editingItemId) return false;
    var item = getItem(editingItemId);
    if (!item) return false;
    var title = (editingDraft.title || '').trim();
    if (!title) {
      showToast('Enter a title', { error: true });
      return false;
    }
    var link = normalizeLink(editingDraft.link);
    if (link && !isValidLink(link)) {
      showToast('Link must be a valid http(s) URL', { error: true });
      return false;
    }
    var prevPriority = item.priority;
    var prevStatus = item.status;
    item.title = title;
    item.notes = editingDraft.notes || '';
    item.link = link;
    item.priority = editingDraft.priority || 0;
    item.status = editingDraft.status || 'queued';
    item.waitlistReason = item.status === 'waitlisted' ? (editingDraft.waitlistReason || '') : '';
    item.paid = !!editingDraft.paid;
    item.ams = !!editingDraft.ams;
    item.filamentColorIds = normalizeFilamentColorIds(editingDraft.filamentColorIds);
    item.categoryIds = normalizeCategoryIds(editingDraft.categoryIds);
    item.plateCount = Math.max(1, parseInt(editingDraft.plateCount, 10) || 1);
    item.plates = (editingDraft.plates || []).map(normalizePlate);
    item.printerId = editingDraft.printerId || null;
    item.estimatedMinutes = editingDraft.estimatedMinutes;
    item.updatedAt = new Date().toISOString();
    if (item.priority !== prevPriority || (item.status === 'done') !== (prevStatus === 'done')) {
      repositionItemByPriority(item);
    }
    item.filamentColorIds.forEach(recordFilamentColorUse);
    saveState();
    return true;
  }

  function deleteItem(id) {
    state.items = state.items.filter(function (t) { return t.id !== id; });
    saveState();
  }

  function toggleItemDone(id) {
    var item = getItem(id);
    if (!item) return;
    if (item.status === 'done') {
      item.status = 'queued';
    } else {
      item.status = 'done';
      item.waitlistReason = '';
    }
    item.updatedAt = new Date().toISOString();
    repositionItemByPriority(item);
    saveState();
  }

  function startTimer(opts) {
    opts = opts || {};
    var minutes = Math.max(1, parseInt(opts.durationMinutes, 10) || 60);
    var started = new Date();
    var ends = new Date(started.getTime() + minutes * 60000);
    var timer = normalizeTimer({
      printerId: opts.printerId || null,
      itemId: opts.itemId || null,
      itemTitle: opts.itemTitle || '',
      durationMinutes: minutes,
      startedAt: started.toISOString(),
      endsAt: ends.toISOString(),
      status: 'running'
    });
    state.timers.unshift(timer);
    if (opts.itemId) {
      var item = getItem(opts.itemId);
      if (item) {
        item.status = 'ready';
        item.printerId = opts.printerId || item.printerId;
        item.estimatedMinutes = minutes;
        item.updatedAt = new Date().toISOString();
      }
    }
    saveState();
    return timer;
  }

  function finishTimer(timerId, cancelled) {
    var timer = state.timers.find(function (t) { return t.id === timerId; });
    if (!timer) return;
    timer.status = cancelled ? 'cancelled' : 'finished';
    if (!cancelled) {
      state.history.unshift(normalizeHistory({
        printerId: timer.printerId,
        itemId: timer.itemId,
        itemTitle: timer.itemTitle || (getItem(timer.itemId) || {}).title || 'Print',
        startedAt: timer.startedAt,
        finishedAt: new Date().toISOString(),
        durationMinutes: timer.durationMinutes
      }));
      if (timer.itemId) {
        var item = getItem(timer.itemId);
        if (item) {
          item.status = 'done';
          item.updatedAt = new Date().toISOString();
          repositionItemByPriority(item);
        }
      }
    }
    state.timers = state.timers.filter(function (t) { return t.id !== timerId; });
    saveState();
  }

  function markReadyAndMaybeTimer(opts) {
    var item = getItem(opts.itemId);
    if (!item) return;
    item.status = 'ready';
    item.waitlistReason = '';
    item.printerId = opts.printerId || null;
    item.estimatedMinutes = opts.durationMinutes || null;
    item.updatedAt = new Date().toISOString();
    if (opts.startTimer && opts.durationMinutes) {
      startTimer({
        printerId: opts.printerId,
        itemId: item.id,
        itemTitle: item.title,
        durationMinutes: opts.durationMinutes
      });
    } else {
      saveState();
    }
  }

  // ---- Filament color picker (HSV) ----
  function parseFilamentRgb(hex) {
    var h = normalizeFilamentHex(hex).slice(1);
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16)
    };
  }

  function rgbToFilamentHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b);
    var min = Math.min(r, g, b);
    var d = max - min;
    var h = 0;
    var v = max;
    var s = max === 0 ? 0 : d / max;
    if (d !== 0) {
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      else if (max === g) h = ((b - r) / d + 2) / 6;
      else h = ((r - g) / d + 4) / 6;
    }
    return { h: h * 360, s: s, v: v };
  }

  function filamentHsvToRgb(h, s, v) {
    h = ((h % 360) + 360) % 360;
    var c = v * s;
    var x = c * (1 - Math.abs((h / 60) % 2 - 1));
    var m = v - c;
    var r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    return {
      r: Math.round((r + m) * 255),
      g: Math.round((g + m) * 255),
      b: Math.round((b + m) * 255)
    };
  }

  function filamentRgbToHex(r, g, b) {
    return '#' + [r, g, b].map(function (n) {
      return n.toString(16).padStart(2, '0');
    }).join('').toUpperCase();
  }

  function filamentHsvToHex(h, s, v) {
    var rgb = filamentHsvToRgb(h, s, v);
    return filamentRgbToHex(rgb.r, rgb.g, rgb.b);
  }

  function filamentHexToHsv(hex) {
    var rgb = parseFilamentRgb(hex);
    return rgbToFilamentHsv(rgb.r, rgb.g, rgb.b);
  }

  function syncFilamentColorPickerUI() {
    var h = filamentPickerState.h;
    var s = filamentPickerState.s;
    var v = filamentPickerState.v;
    var hex = filamentHsvToHex(h, s, v);
    var sv = document.getElementById('fcpSv');
    var svThumb = document.getElementById('fcpSvThumb');
    var hueThumb = document.getElementById('fcpHueThumb');
    var brightThumb = document.getElementById('fcpBrightnessThumb');
    var bright = document.getElementById('fcpBrightness');
    var preview = document.getElementById('fcpPreview');
    var hexEl = document.getElementById('fcpHex');
    if (sv) sv.style.backgroundColor = filamentHsvToHex(h, 1, 1);
    if (svThumb) {
      svThumb.style.left = (s * 100) + '%';
      svThumb.style.top = ((1 - v) * 100) + '%';
      svThumb.style.background = hex;
    }
    if (hueThumb) hueThumb.style.left = (h / 360 * 100) + '%';
    if (brightThumb) brightThumb.style.left = (v * 100) + '%';
    if (bright) {
      bright.style.background = 'linear-gradient(to right, ' +
        filamentHsvToHex(h, s, 0) + ', ' + filamentHsvToHex(h, s, 1) + ')';
    }
    if (preview) preview.style.background = hex;
    if (hexEl) hexEl.textContent = hex;
  }

  function bindFilamentColorPickerUI() {
    if (fcpUiBound) return;
    fcpUiBound = true;

    function bindDrag(elId, onPos) {
      var node = document.getElementById(elId);
      if (!node) return;
      var dragging = false;
      function handle(e) {
        var rect = node.getBoundingClientRect();
        var pt = e.touches ? e.touches[0] : e;
        onPos((pt.clientX - rect.left) / rect.width, (pt.clientY - rect.top) / rect.height);
        syncFilamentColorPickerUI();
      }
      node.addEventListener('pointerdown', function (e) {
        dragging = true;
        node.setPointerCapture(e.pointerId);
        handle(e);
      });
      node.addEventListener('pointermove', function (e) {
        if (!dragging) return;
        handle(e);
      });
      node.addEventListener('pointerup', function () { dragging = false; });
      node.addEventListener('pointercancel', function () { dragging = false; });
    }

    bindDrag('fcpSv', function (x, y) {
      filamentPickerState.s = Math.max(0, Math.min(1, x));
      filamentPickerState.v = Math.max(0, Math.min(1, 1 - y));
    });
    bindDrag('fcpHue', function (x) {
      filamentPickerState.h = Math.max(0, Math.min(360, x * 360));
    });
    bindDrag('fcpBrightness', function (x) {
      filamentPickerState.v = Math.max(0, Math.min(1, x));
    });

    document.getElementById('fcpClose').addEventListener('click', function () {
      closeModal('filamentColorPickerModal');
    });
    document.getElementById('fcpCancel').addEventListener('click', function () {
      closeModal('filamentColorPickerModal');
    });
    document.getElementById('fcpConfirm').addEventListener('click', function () {
      var hex = filamentHsvToHex(filamentPickerState.h, filamentPickerState.s, filamentPickerState.v);
      var cb = filamentPickerState.onConfirm;
      closeModal('filamentColorPickerModal');
      if (cb) cb(hex);
    });
  }

  function openFilamentColorPicker(opts) {
    opts = opts || {};
    bindFilamentColorPickerUI();
    var hsv = filamentHexToHsv(opts.defaultHex || '#EA580C');
    filamentPickerState.h = hsv.h;
    filamentPickerState.s = hsv.s;
    filamentPickerState.v = hsv.v;
    filamentPickerState.onConfirm = opts.onConfirm || null;
    filamentPickerState.confirmLabel = opts.confirmLabel || 'Add color';
    var title = document.getElementById('fcpTitle');
    var confirm = document.getElementById('fcpConfirm');
    if (title) title.textContent = opts.title || 'Pick color';
    if (confirm) confirm.textContent = filamentPickerState.confirmLabel;
    syncFilamentColorPickerUI();
    openModal('filamentColorPickerModal');
  }

  function filamentPencilButton(color, selected, onClick, heightPx) {
    var hex = normalizeFilamentHex(color.hex);
    var tip = filamentTipColor(hex);
    var light = isLightFilament(hex);
    var h = heightPx || 54;
    var bodyH = h - 20;
    var btn = el('button', {
      type: 'button',
      class: 'filament-pencil' + (selected ? ' selected' : ''),
      title: color.name || hex,
      'aria-label': color.name || ('Filament ' + hex),
      'aria-pressed': selected ? 'true' : 'false',
      onClick: onClick
    });
    var svgNS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 20 ' + h);
    svg.setAttribute('class', 'filament-pencil-svg');
    svg.setAttribute('aria-hidden', 'true');

    var tipEl = document.createElementNS(svgNS, 'polygon');
    tipEl.setAttribute('points', '10,1 3.5,12 16.5,12');
    tipEl.setAttribute('fill', tip);
    svg.appendChild(tipEl);

    var wood = document.createElementNS(svgNS, 'rect');
    wood.setAttribute('x', '4');
    wood.setAttribute('y', '12');
    wood.setAttribute('width', '12');
    wood.setAttribute('height', '6.5');
    wood.setAttribute('fill', '#e8d4b0');
    svg.appendChild(wood);

    var ferrule = document.createElementNS(svgNS, 'rect');
    ferrule.setAttribute('x', '3.5');
    ferrule.setAttribute('y', '18.5');
    ferrule.setAttribute('width', '13');
    ferrule.setAttribute('height', '1.5');
    ferrule.setAttribute('rx', '0.3');
    ferrule.setAttribute('fill', '#a8a8a8');
    svg.appendChild(ferrule);

    var body = document.createElementNS(svgNS, 'rect');
    body.setAttribute('x', '4');
    body.setAttribute('y', '20');
    body.setAttribute('width', '12');
    body.setAttribute('height', String(bodyH));
    body.setAttribute('rx', '1.2');
    body.setAttribute('fill', hex);
    if (light) {
      body.setAttribute('stroke', '#b0b0b0');
      body.setAttribute('stroke-width', '0.5');
    }
    svg.appendChild(body);

    var shine = document.createElementNS(svgNS, 'rect');
    shine.setAttribute('x', '5');
    shine.setAttribute('y', '22');
    shine.setAttribute('width', '1.8');
    shine.setAttribute('height', String(Math.max(bodyH - 4, 4)));
    shine.setAttribute('rx', '0.4');
    shine.setAttribute('fill', '#fff');
    shine.setAttribute('opacity', light ? '0.35' : '0.18');
    svg.appendChild(shine);

    btn.appendChild(svg);
    return btn;
  }

  function renderFilamentColorRow(container, getSelectedSet, onChanged) {
    if (!container) return;
    container.innerHTML = '';
    ensureFilamentColors();
    maybeReorderFilamentColors();

    var stagger = el('div', { class: 'filament-color-stagger' });
    var topRow = el('div', { class: 'filament-color-row filament-color-row-top' });
    var bottomRow = el('div', { class: 'filament-color-row filament-color-row-bottom' });
    var selected = getSelectedSet();

    state.filamentColors.forEach(function (color, i) {
      var isSelected = selected.has(color.id);
      var heightPx = i % 4 < 2 ? 56 : 50;
      var btn = filamentPencilButton(color, isSelected, function () {
        if (selected.has(color.id)) selected.delete(color.id);
        else selected.add(color.id);
        if (onChanged) onChanged(Array.from(selected));
        renderFilamentColorRow(container, getSelectedSet, onChanged);
      }, heightPx);
      if (i % 2 === 0) topRow.appendChild(btn);
      else bottomRow.appendChild(btn);
    });

    bottomRow.appendChild(el('button', {
      type: 'button',
      class: 'filament-pencil-manage',
      'aria-label': 'Edit filament colors',
      html: '<svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
      onClick: function () { openFilamentManager(); }
    }));

    bottomRow.appendChild(el('button', {
      type: 'button',
      class: 'filament-pencil-add',
      text: '+',
      'aria-label': 'Add filament color',
      onClick: function () {
        openFilamentColorPicker({
          title: 'Add color',
          confirmLabel: 'Add color',
          onConfirm: function (hex) {
            var id = addFilamentColor(hex);
            selected.add(id);
            if (onChanged) onChanged(Array.from(selected));
            renderFilamentColorRow(container, getSelectedSet, onChanged);
            showToast('Added filament color');
          }
        });
      }
    }));

    stagger.appendChild(topRow);
    stagger.appendChild(bottomRow);
    container.appendChild(stagger);
  }

  function renderCategoryChipRow(container, getSelection, isAdding, setAdding, onUpdate) {
    if (!container) return;
    container.innerHTML = '';
    var label = el('span', { class: 'quick-add-categories-label', text: 'Categories' });
    var scroll = el('div', { class: 'category-chip-scroll' });
    var selection = getSelection();

    state.categories.forEach(function (cat) {
      var selected = selection.has(cat.id);
      scroll.appendChild(el('button', {
        type: 'button',
        class: 'category-chip' + (selected ? ' selected' : ''),
        text: cat.name,
        'aria-pressed': selected ? 'true' : 'false',
        onClick: function () {
          if (selection.has(cat.id)) selection.delete(cat.id);
          else selection.add(cat.id);
          if (onUpdate) onUpdate();
          renderCategoryChipRow(container, getSelection, isAdding, setAdding, onUpdate);
        }
      }));
    });

    if (isAdding()) {
      var input = el('input', {
        type: 'text',
        class: 'category-chip-new-input',
        placeholder: 'New…',
        autocomplete: 'off',
        'aria-label': 'New category name'
      });
      var finishAdd = function () {
        var name = input.value.trim();
        setAdding(false);
        if (name) {
          var id = addCategory(name, { silent: true });
          if (id) {
            selection.add(id);
            if (onUpdate) onUpdate();
            showToast('Added category: ' + name);
          }
        }
        renderCategoryChipRow(container, getSelection, isAdding, setAdding, onUpdate);
        renderCategoryFilter();
      };
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') finishAdd();
        if (e.key === 'Escape') {
          setAdding(false);
          renderCategoryChipRow(container, getSelection, isAdding, setAdding, onUpdate);
        }
      });
      input.addEventListener('blur', finishAdd);
      scroll.appendChild(input);
      setTimeout(function () { input.focus(); }, 30);
    } else {
      scroll.appendChild(el('button', {
        type: 'button',
        class: 'category-chip category-chip-add',
        text: '+',
        'aria-label': 'Add category',
        onClick: function () {
          setAdding(true);
          renderCategoryChipRow(container, getSelection, isAdding, setAdding, onUpdate);
        }
      }));
    }

    container.appendChild(label);
    container.appendChild(scroll);
  }

  function renderQuickAddControls() {
    renderCategoryChipRow(
      document.getElementById('quickCategories'),
      function () { return quickUi.categories; },
      function () { return quickUi.categoryAdding; },
      function (v) { quickUi.categoryAdding = v; },
      function () {}
    );
    renderFilamentColorRow(
      document.getElementById('quickFilamentColors'),
      function () { return quickUi.filament; },
      function () {}
    );
    var plateInput = document.getElementById('quickPlateCount');
    if (plateInput) plateInput.value = String(quickUi.plateCount);
  }

  function appendItemMarks(parent, item) {
    var hasColors = Array.isArray(item.filamentColorIds) && item.filamentColorIds.length;
    if (!item.paid && !item.ams && !hasColors) return;
    var marks = el('span', { class: 'item-row-marks' });
    if (item.paid) {
      marks.appendChild(el('span', { class: 'item-paid-mark', text: '$', title: 'Paid model' }));
    }
    if (item.ams || hasColors) {
      var printer = el('span', { class: 'item-printer-mark' });
      if (item.ams) {
        var badge = el('span', { class: 'ams-badge inline-badge' });
        badge.appendChild(el('span', { class: 'ams-badge-text', text: 'AMS' }));
        printer.appendChild(badge);
      }
      if (hasColors) {
        var quads = el('span', { class: 'item-filament-quads', 'aria-label': 'Filament colors' });
        item.filamentColorIds.forEach(function (id) {
          var color = getFilamentColor(id);
          if (!color) return;
          var quad = el('span', { class: 'item-filament-quad', title: color.name || color.hex });
          quad.style.background = color.hex;
          quads.appendChild(quad);
        });
        if (quads.childNodes.length) printer.appendChild(quads);
      }
      if (printer.childNodes.length) marks.appendChild(printer);
    }
    if (marks.childNodes.length) parent.appendChild(marks);
  }

  function priorityClass(p) {
    return p === 3 ? 'p3' : p === 2 ? 'p2' : p === 1 ? 'p1' : 'p0';
  }

  function itemRowPriorityClass(priority) {
    if (priority === 3) return ' prio-3';
    if (priority === 2) return ' prio-2';
    if (priority === 1) return ' prio-1';
    return '';
  }

  function plateProgressText(item) {
    var total = Math.max(item.plateCount || 1, (item.plates || []).length || 1);
    var done = (item.plates || []).filter(function (p) { return p.done; }).length;
    if (!(item.plates || []).length) return total + ' plate' + (total === 1 ? '' : 's');
    return done + '/' + total + ' plates';
  }

  function checkmarkSvg() {
    var svgNS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    var path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', 'M5 12l5 5L20 7');
    svg.appendChild(path);
    return svg;
  }

  function renderItemRow(item) {
    var row = el('div', {
      class: 'item' +
        (item.status === 'done' ? ' done' : '') +
        itemRowPriorityClass(item.priority) +
        (item.status === 'ready' ? ' status-ready' : '') +
        (item.status === 'waitlisted' ? ' status-waitlisted' : ''),
      dataset: { id: item.id }
    });

    var check = el('div', {
      class: 'item-check ' + priorityClass(item.priority) + (item.status === 'done' ? ' checked' : ''),
      onClick: function (e) {
        e.stopPropagation();
        toggleItemDone(item.id);
        render();
      }
    });
    check.appendChild(checkmarkSvg());
    row.appendChild(check);

    var body = el('div', {
      class: 'item-body',
      onClick: function () { openItemEditor(item.id); }
    });
    var titleRow = el('div', { class: 'item-title-row' });
    titleRow.appendChild(el('div', { class: 'item-title', text: item.title }));
    appendItemMarks(titleRow, item);
    body.appendChild(titleRow);

    var meta = el('div', { class: 'item-meta' });
    meta.appendChild(el('span', {
      class: 'pill status-' + item.status,
      text: STATUS_LABELS[item.status] || item.status
    }));
    meta.appendChild(el('span', { class: 'pill', text: plateProgressText(item) }));
    if (item.printerId) {
      var pr = getPrinter(item.printerId);
      if (pr) meta.appendChild(el('span', { class: 'pill', text: pr.name }));
    }
    (item.categoryIds || []).forEach(function (id) {
      var cat = getCategory(id);
      if (cat) meta.appendChild(el('span', { class: 'pill category', text: cat.name }));
    });
    if (item.link && isValidLink(item.link)) {
      meta.appendChild(el('a', {
        class: 'pill link',
        text: '🔗 ' + linkLabel(item.link),
        href: item.link,
        target: '_blank',
        rel: 'noopener noreferrer',
        onClick: function (e) { e.stopPropagation(); }
      }));
    }
    body.appendChild(meta);

    if (item.status === 'waitlisted' && item.waitlistReason) {
      body.appendChild(el('div', { class: 'item-wait-reason', text: item.waitlistReason }));
    }

    if (item.status !== 'done' && item.status !== 'ready') {
      var actions = el('div', { class: 'item-actions' });
      actions.appendChild(el('button', {
        type: 'button',
        class: 'item-action-btn primary',
        text: 'Sliced & sent',
        onClick: function (e) {
          e.stopPropagation();
          openSendModal(item.id);
        }
      }));
      if (item.status !== 'waitlisted') {
        actions.appendChild(el('button', {
          type: 'button',
          class: 'item-action-btn',
          text: 'Waitlist',
          onClick: function (e) {
            e.stopPropagation();
            openItemEditor(item.id, { focusWaitlist: true });
          }
        }));
      }
      body.appendChild(actions);
    } else if (item.status === 'ready') {
      var readyActions = el('div', { class: 'item-actions' });
      readyActions.appendChild(el('button', {
        type: 'button',
        class: 'item-action-btn primary',
        text: 'Start timer',
        onClick: function (e) {
          e.stopPropagation();
          openSendModal(item.id, { timerOnly: true });
        }
      }));
      body.appendChild(readyActions);
    }

    row.appendChild(body);
    row.appendChild(el('button', {
      type: 'button',
      class: 'item-edit-btn',
      'aria-label': 'Edit',
      html: '<svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
      onClick: function (e) {
        e.stopPropagation();
        openItemEditor(item.id);
      }
    }));
    return row;
  }

  function itemMatchesFilters(item) {
    if (state.statusFilter === 'all') {
      if (item.status === 'done') return false;
    } else if (item.status !== state.statusFilter) {
      return false;
    }
    if (state.categoryFilter !== 'all') {
      if (!(item.categoryIds || []).includes(state.categoryFilter)) return false;
    }
    return true;
  }

  function renderCategoryFilter() {
    var row = document.getElementById('categoryFilterRow');
    var select = document.getElementById('categoryFilter');
    if (!row || !select) return;
    row.hidden = !state.categories.length;
    if (!state.categories.length) {
      state.categoryFilter = 'all';
      return;
    }
    select.innerHTML = '';
    var all = el('option', { value: 'all', text: 'All categories' });
    if (state.categoryFilter === 'all') all.selected = true;
    select.appendChild(all);
    state.categories.forEach(function (cat) {
      var opt = el('option', { value: cat.id, text: cat.name });
      if (state.categoryFilter === cat.id) opt.selected = true;
      select.appendChild(opt);
    });
  }

  function renderQueue() {
    var container = document.getElementById('queueList');
    if (!container) return;
    container.innerHTML = '';
    renderCategoryFilter();
    var statusFilter = document.getElementById('statusFilter');
    if (statusFilter) statusFilter.value = state.statusFilter;

    var filtered = state.items.filter(itemMatchesFilters);
    var open = sortItems(filtered.filter(function (t) { return t.status !== 'done'; }));
    var done = state.statusFilter === 'done'
      ? sortItems(state.items.filter(function (t) {
        return t.status === 'done' && (state.categoryFilter === 'all' || (t.categoryIds || []).includes(state.categoryFilter));
      }))
      : sortItems(state.items.filter(function (t) { return t.status === 'done'; }));

    if (!open.length && state.statusFilter !== 'done') {
      container.appendChild(el('div', {
        class: 'empty-state',
        html: '<p>Nothing in the queue yet.<br />Add a model above — high priority jumps to the top.</p>'
      }));
    } else if (open.length) {
      var list = el('div', { class: 'item-list' });
      open.forEach(function (t) { list.appendChild(renderItemRow(t)); });
      container.appendChild(list);
    }

    if (state.statusFilter === 'all' && done.length) {
      var summary = el('button', {
        class: 'completed-summary',
        type: 'button',
        onClick: function () {
          doneExpanded = !doneExpanded;
          renderQueue();
        }
      });
      summary.appendChild(el('span', { text: 'Done' }));
      summary.appendChild(el('span', { class: 'count', text: String(done.length) }));
      container.appendChild(summary);
      if (doneExpanded) {
        var doneList = el('div', { class: 'item-list' });
        done.forEach(function (t) { doneList.appendChild(renderItemRow(t)); });
        container.appendChild(doneList);
      }
    } else if (state.statusFilter === 'done') {
      if (!done.length) {
        container.appendChild(el('div', {
          class: 'empty-state',
          html: '<p>No completed prints yet.</p>'
        }));
      } else {
        var onlyDone = el('div', { class: 'item-list' });
        done.forEach(function (t) { onlyDone.appendChild(renderItemRow(t)); });
        container.appendChild(onlyDone);
      }
    }
  }

  function formatDuration(ms) {
    var totalSec = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(totalSec / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    var s = totalSec % 60;
    if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    return m + ':' + String(s).padStart(2, '0');
  }

  function formatWhen(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString(undefined, {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
      });
    } catch (e) {
      return iso;
    }
  }

  function renderPrinters() {
    var list = document.getElementById('printerList');
    var empty = document.getElementById('printerEmpty');
    if (!list) return;
    list.innerHTML = '';
    if (!state.printers.length) {
      if (empty) empty.hidden = false;
    } else {
      if (empty) empty.hidden = true;
      state.printers.forEach(function (printer) {
        var row = el('div', { class: 'printer-row' });
        row.appendChild(el('div', {
          class: 'printer-icon',
          html: '<svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="4" rx="1"/><path d="M6 7v12M18 7v12M8 19h8M10 11h4"/></svg>'
        }));
        var info = el('div', { class: 'printer-info' });
        info.appendChild(el('div', { class: 'printer-name', text: printer.name }));
        var metaBits = [];
        if (printer.model) metaBits.push(printer.model);
        var active = state.timers.filter(function (t) {
          return t.status === 'running' && t.printerId === printer.id;
        }).length;
        if (active) metaBits.push(active + ' timer' + (active === 1 ? '' : 's'));
        var printed = state.history.filter(function (h) { return h.printerId === printer.id; }).length;
        if (printed) metaBits.push(printed + ' finished');
        if (printer.notes) metaBits.push(printer.notes);
        info.appendChild(el('div', {
          class: 'printer-meta',
          text: metaBits.join(' · ') || 'Tap to edit'
        }));
        row.appendChild(info);
        var actions = el('div', { class: 'printer-actions' });
        actions.appendChild(el('button', {
          type: 'button',
          class: 'btn',
          style: 'padding:6px 10px;min-height:32px;font-size:0.78rem',
          text: 'Edit',
          onClick: function () { openPrinterEditor(printer.id); }
        }));
        actions.appendChild(el('button', {
          type: 'button',
          class: 'btn btn-primary',
          style: 'padding:6px 10px;min-height:32px;font-size:0.78rem',
          text: 'Timer',
          onClick: function () { openPrinterEditor(printer.id, { focusTimer: true }); }
        }));
        row.appendChild(actions);
        list.appendChild(row);
      });
    }

    var timerList = document.getElementById('timerList');
    var timerEmpty = document.getElementById('timerEmpty');
    if (timerList) {
      timerList.innerHTML = '';
      var running = state.timers.filter(function (t) { return t.status === 'running'; });
      if (!running.length) {
        if (timerEmpty) timerEmpty.hidden = false;
      } else {
        if (timerEmpty) timerEmpty.hidden = true;
        running.forEach(function (timer) {
          var ends = new Date(timer.endsAt).getTime();
          var starts = new Date(timer.startedAt).getTime();
          var now = Date.now();
          var remaining = ends - now;
          var total = Math.max(ends - starts, 1);
          var progress = Math.max(0, Math.min(1, 1 - remaining / total));
          var printer = getPrinter(timer.printerId);
          var row = el('div', { class: 'timer-row' });
          var info = el('div', { class: 'printer-info' });
          info.appendChild(el('div', {
            class: 'printer-name',
            text: timer.itemTitle || 'Manual timer'
          }));
          info.appendChild(el('div', {
            class: 'printer-meta',
            text: (printer ? printer.name : 'No printer') + ' · ' + timer.durationMinutes + ' min'
          }));
          var bar = el('div', { class: 'timer-bar' });
          bar.appendChild(el('span', { style: 'width:' + (progress * 100) + '%' }));
          info.appendChild(bar);
          row.appendChild(info);
          var side = el('div', { style: 'text-align:right;flex-shrink:0' });
          side.appendChild(el('div', {
            class: 'timer-countdown' + (remaining < 0 ? ' overdue' : ''),
            text: remaining < 0 ? '+' + formatDuration(-remaining) : formatDuration(remaining)
          }));
          side.appendChild(el('button', {
            type: 'button',
            class: 'btn',
            style: 'padding:4px 8px;min-height:28px;font-size:0.72rem;margin-top:6px',
            text: 'Done',
            onClick: function () {
              finishTimer(timer.id, false);
              render();
              showToast('Print logged');
            }
          }));
          side.appendChild(el('button', {
            type: 'button',
            class: 'btn',
            style: 'padding:4px 8px;min-height:28px;font-size:0.72rem;margin-top:4px',
            text: 'Cancel',
            onClick: function () {
              finishTimer(timer.id, true);
              render();
            }
          }));
          row.appendChild(side);
          timerList.appendChild(row);
        });
      }
    }

    var historyList = document.getElementById('historyList');
    var historyEmpty = document.getElementById('historyEmpty');
    if (historyList) {
      historyList.innerHTML = '';
      if (!state.history.length) {
        if (historyEmpty) historyEmpty.hidden = false;
      } else {
        if (historyEmpty) historyEmpty.hidden = true;
        state.history.slice(0, 40).forEach(function (h) {
          var printer = getPrinter(h.printerId);
          var row = el('div', { class: 'history-row' });
          var info = el('div', { class: 'printer-info' });
          info.appendChild(el('div', { class: 'printer-name', text: h.itemTitle || 'Print' }));
          info.appendChild(el('div', {
            class: 'printer-meta',
            text: [
              printer ? printer.name : 'Unknown printer',
              h.durationMinutes != null ? h.durationMinutes + ' min' : null,
              formatWhen(h.finishedAt)
            ].filter(Boolean).join(' · ')
          }));
          row.appendChild(info);
          historyList.appendChild(row);
        });
      }
    }
  }

  function setView(view) {
    currentView = view;
    document.querySelectorAll('.view').forEach(function (v) {
      v.classList.toggle('active', v.getAttribute('data-view') === view);
    });
    document.querySelectorAll('.nav-btn').forEach(function (b) {
      var on = b.getAttribute('data-view') === view;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    var title = document.getElementById('headerTitle');
    var sub = document.getElementById('headerSubtitle');
    if (view === 'printers') {
      if (title) title.textContent = 'Printers';
      if (sub) sub.textContent = 'Timers & print history';
    } else {
      if (title) title.textContent = 'To Print';
      if (sub) sub.textContent = 'Queue, plates & filament';
    }
    render();
  }

  function render() {
    if (currentView === 'printers') renderPrinters();
    else {
      renderQuickAddControls();
      renderQueue();
    }
  }

  function openItemEditor(id, opts) {
    opts = opts || {};
    var item = getItem(id);
    if (!item) return;
    editingItemId = id;
    editingDraft = JSON.parse(JSON.stringify(item));
    editorCategoryAdding = false;
    document.getElementById('itemModalTitle').textContent = 'Edit item';
    document.getElementById('itemTitle').value = editingDraft.title || '';
    document.getElementById('itemLink').value = editingDraft.link || '';
    document.getElementById('itemNotes').value = editingDraft.notes || '';
    document.getElementById('itemWaitlistReason').value = editingDraft.waitlistReason || '';
    document.getElementById('itemPaid').checked = !!editingDraft.paid;
    document.getElementById('itemAms').checked = !!editingDraft.ams;
    document.getElementById('itemPlateCount').value = String(editingDraft.plateCount || 1);
    syncItemEditorPrio();
    syncItemEditorStatus();
    syncWaitlistField();
    renderEditorFilament();
    renderEditorCategories();
    renderEditorPlates();
    openModal('itemModal');
    if (opts.focusWaitlist) {
      editingDraft.status = 'waitlisted';
      syncItemEditorStatus();
      syncWaitlistField();
      setTimeout(function () {
        document.getElementById('itemWaitlistReason').focus();
      }, 50);
    }
  }

  function syncItemEditorPrio() {
    document.querySelectorAll('#itemPrioPicker .prio-btn').forEach(function (btn) {
      var on = parseInt(btn.dataset.prio, 10) === (editingDraft.priority || 0);
      btn.classList.toggle('selected', on);
    });
  }

  function syncItemEditorStatus() {
    document.querySelectorAll('#itemStatusPicker .status-btn').forEach(function (btn) {
      btn.classList.toggle('selected', btn.dataset.status === editingDraft.status);
    });
  }

  function syncWaitlistField() {
    var field = document.getElementById('waitlistReasonField');
    if (field) field.hidden = editingDraft.status !== 'waitlisted';
  }

  function renderEditorFilament() {
    if (!editingDraft.filamentColorIds) editingDraft.filamentColorIds = [];
    var selected = new Set(editingDraft.filamentColorIds);
    renderFilamentColorRow(
      document.getElementById('itemFilamentColors'),
      function () { return selected; },
      function (ids) { editingDraft.filamentColorIds = ids; }
    );
  }

  function renderEditorCategories() {
    if (!editingDraft.categoryIds) editingDraft.categoryIds = [];
    var selection = new Set(editingDraft.categoryIds);
    renderCategoryChipRow(
      document.getElementById('itemCategories'),
      function () { return selection; },
      function () { return editorCategoryAdding; },
      function (v) { editorCategoryAdding = v; },
      function () { editingDraft.categoryIds = Array.from(selection); }
    );
  }

  function renderEditorPlates() {
    var container = document.getElementById('itemPlatesList');
    if (!container || !editingDraft) return;
    container.innerHTML = '';
    (editingDraft.plates || []).forEach(function (plate, idx) {
      var row = el('div', { class: 'plate-row' });
      var top = el('div', { class: 'plate-row-top' });
      var doneBtn = el('button', {
        type: 'button',
        class: 'plate-done-check' + (plate.done ? ' on' : ''),
        'aria-label': 'Toggle plate done',
        onClick: function () {
          plate.done = !plate.done;
          renderEditorPlates();
        }
      });
      doneBtn.appendChild(checkmarkSvg());
      top.appendChild(doneBtn);
      var nameInput = el('input', {
        type: 'text',
        value: plate.name,
        placeholder: 'Plate name'
      });
      nameInput.addEventListener('input', function () {
        plate.name = nameInput.value;
      });
      top.appendChild(nameInput);
      top.appendChild(el('button', {
        type: 'button',
        class: 'plate-del',
        'aria-label': 'Remove plate',
        html: '<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>',
        onClick: function () {
          editingDraft.plates.splice(idx, 1);
          syncPlateCountFromPlates(editingDraft);
          document.getElementById('itemPlateCount').value = String(editingDraft.plateCount);
          renderEditorPlates();
        }
      }));
      row.appendChild(top);

      var cats = el('div', { class: 'plate-cats' });
      state.categories.forEach(function (cat) {
        var on = (plate.categoryIds || []).includes(cat.id);
        cats.appendChild(el('button', {
          type: 'button',
          class: 'category-chip' + (on ? ' selected' : ''),
          text: cat.name,
          style: 'font-size:0.72rem;padding:3px 8px',
          onClick: function () {
            plate.categoryIds = plate.categoryIds || [];
            if (on) plate.categoryIds = plate.categoryIds.filter(function (id) { return id !== cat.id; });
            else plate.categoryIds.push(cat.id);
            renderEditorPlates();
          }
        }));
      });
      row.appendChild(cats);
      container.appendChild(row);
    });
  }

  function openSendModal(itemId, opts) {
    opts = opts || {};
    sendTargetItemId = itemId;
    var item = getItem(itemId);
    if (!item) return;
    if (!state.printers.length) {
      showToast('Add a printer first', { error: true });
      setView('printers');
      openPrinterEditor(null);
      return;
    }
    var select = document.getElementById('sendPrinterSelect');
    select.innerHTML = '';
    state.printers.forEach(function (p) {
      var opt = el('option', { value: p.id, text: p.name + (p.model ? ' (' + p.model + ')' : '') });
      if (item.printerId === p.id) opt.selected = true;
      select.appendChild(opt);
    });
    document.getElementById('sendDuration').value = item.estimatedMinutes || '';
    document.getElementById('sendStartTimer').checked = !!opts.timerOnly || true;
    document.getElementById('sendModalLead').textContent = opts.timerOnly
      ? 'Start a timer for “‘ + item.title + ’”.'
      : 'Mark “‘ + item.title + ’” as sliced & sent to a printer.';
    document.getElementById('sendConfirm').textContent = opts.timerOnly ? 'Start timer' : 'Mark ready';
    openModal('sendModal');
  }

  function openPrinterEditor(id, opts) {
    opts = opts || {};
    editingPrinterId = id;
    var printer = id ? getPrinter(id) : null;
    document.getElementById('printerModalTitle').textContent = printer ? 'Edit printer' : 'Add printer';
    document.getElementById('printerName').value = printer ? printer.name : '';
    document.getElementById('printerModel').value = printer ? printer.model : '';
    document.getElementById('printerNotes').value = printer ? printer.notes : '';
    document.getElementById('printerTimerMinutes').value = '';
    document.getElementById('printerDeleteBtn').hidden = !printer;
    document.getElementById('printerTimerField').hidden = !printer;
    openModal('printerModal');
    if (opts.focusTimer) {
      setTimeout(function () {
        document.getElementById('printerTimerMinutes').focus();
      }, 50);
    }
  }

  function openFilamentManager() {
    renderFilamentManager();
    openModal('filamentModal');
  }

  function renderFilamentManager() {
    var container = document.getElementById('filamentManagerList');
    if (!container) return;
    container.innerHTML = '';
    ensureFilamentColors();
    state.filamentColors.forEach(function (color) {
      var row = el('div', { class: 'filament-manage-row' });
      var colorBtn = el('button', {
        type: 'button',
        class: 'filament-manage-color-btn',
        'aria-label': 'Change color ' + color.hex,
        onClick: function () {
          openFilamentColorPicker({
            defaultHex: color.hex,
            title: 'Edit color',
            confirmLabel: 'Save',
            onConfirm: function (hex) {
              updateFilamentColor(color.id, { hex: hex });
              renderFilamentManager();
              render();
              showToast('Color updated');
            }
          });
        }
      });
      var dot = el('span', { class: 'filament-manage-color-dot' });
      dot.style.background = color.hex;
      colorBtn.appendChild(dot);
      colorBtn.appendChild(el('span', { class: 'filament-manage-hex', text: color.hex }));
      row.appendChild(colorBtn);
      row.appendChild(el('button', {
        class: 'btn btn-danger filament-manage-delete',
        text: 'Delete',
        onClick: function () {
          if (!confirm('Delete filament color ' + color.hex + '?')) return;
          deleteFilamentColor(color.id);
          renderFilamentManager();
          render();
          showToast('Filament color deleted');
        }
      }));
      container.appendChild(row);
    });
  }

  function renderCategoriesManager() {
    var container = document.getElementById('categoriesManagerList');
    if (!container) return;
    container.innerHTML = '';
    if (!state.categories.length) {
      container.appendChild(el('p', {
        class: 'field-hint',
        text: 'No categories yet. Add some below or from the quick-add row.'
      }));
      return;
    }
    state.categories.forEach(function (cat, index) {
      var row = el('div', { class: 'list-manage-row' });
      row.appendChild(el('div', { class: 'settings-label', text: cat.name }));
      var actions = el('div', { style: 'display:flex;align-items:center;gap:8px' });
      var reorder = el('div', { class: 'list-reorder' });
      var upBtn = el('button', {
        type: 'button',
        class: 'list-reorder-btn',
        text: '▲',
        'aria-label': 'Move up',
        onClick: function () {
          moveCategory(index, -1);
          renderCategoriesManager();
          render();
        }
      });
      if (index === 0) upBtn.disabled = true;
      reorder.appendChild(upBtn);
      var downBtn = el('button', {
        type: 'button',
        class: 'list-reorder-btn',
        text: '▼',
        'aria-label': 'Move down',
        onClick: function () {
          moveCategory(index, 1);
          renderCategoriesManager();
          render();
        }
      });
      if (index >= state.categories.length - 1) downBtn.disabled = true;
      reorder.appendChild(downBtn);
      actions.appendChild(reorder);
      actions.appendChild(el('button', {
        class: 'btn btn-danger',
        style: 'padding:6px 10px;min-height:32px;font-size:0.8rem',
        text: 'Delete',
        onClick: function () {
          if (!confirm('Delete category "' + cat.name + '"?')) return;
          deleteCategory(cat.id);
          renderCategoriesManager();
          render();
        }
      }));
      row.appendChild(actions);
      container.appendChild(row);
    });
  }

  function exportBackup() {
    var payload = {
      version: SCHEMA_VERSION,
      items: state.items,
      printers: state.printers,
      timers: state.timers,
      history: state.history,
      categories: state.categories,
      filamentColors: state.filamentColors,
      filamentColorSortAt: state.filamentColorSortAt
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '3d-print-backup.json';
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('Exported');
  }

  function applyImportSlice(slice, mode) {
    if (!slice || !Array.isArray(slice.items)) {
      showToast('Invalid backup', { error: true });
      return;
    }
    if (mode === 'replace') {
      state.items = slice.items.map(normalizeItem);
      state.printers = Array.isArray(slice.printers) ? slice.printers.map(normalizePrinter) : [];
      state.timers = Array.isArray(slice.timers) ? slice.timers.map(normalizeTimer) : [];
      state.history = Array.isArray(slice.history) ? slice.history.map(normalizeHistory) : [];
      state.categories = Array.isArray(slice.categories) ? slice.categories.map(normalizeCategory) : [];
      state.filamentColors = Array.isArray(slice.filamentColors)
        ? slice.filamentColors.map(normalizeFilamentColorDef)
        : [];
    } else {
      var catMap = {};
      (slice.categories || []).forEach(function (c) {
        var existing = state.categories.find(function (x) {
          return x.name.toLowerCase() === (c.name || '').toLowerCase();
        });
        if (existing) catMap[c.id] = existing.id;
        else {
          var nid = addCategory(c.name, { silent: true, deferSave: true });
          catMap[c.id] = nid;
        }
      });
      var colorMap = {};
      (slice.filamentColors || []).forEach(function (c) {
        colorMap[c.id] = addFilamentColor(c.hex, { name: c.name });
      });
      var printerMap = {};
      (slice.printers || []).forEach(function (p) {
        var existing = state.printers.find(function (x) {
          return x.name.toLowerCase() === (p.name || '').toLowerCase();
        });
        if (existing) printerMap[p.id] = existing.id;
        else {
          var np = normalizePrinter(p);
          np.id = uid('pr');
          state.printers.push(np);
          printerMap[p.id] = np.id;
        }
      });
      (slice.items || []).forEach(function (raw) {
        if (state.items.some(function (t) { return t.id === raw.id; })) return;
        var item = normalizeItem(raw);
        item.id = uid('item');
        item.categoryIds = (item.categoryIds || []).map(function (id) { return catMap[id] || id; });
        item.filamentColorIds = (item.filamentColorIds || []).map(function (id) { return colorMap[id] || id; });
        item.printerId = item.printerId ? (printerMap[item.printerId] || null) : null;
        item.plates = (item.plates || []).map(function (p) {
          return normalizePlate({
            name: p.name,
            done: p.done,
            categoryIds: (p.categoryIds || []).map(function (id) { return catMap[id] || id; }),
            filamentColorIds: (p.filamentColorIds || []).map(function (id) { return colorMap[id] || id; })
          });
        });
        state.items.push(item);
        repositionItemByPriority(item);
      });
    }
    ensureFilamentColors();
    ensureItemSortOrders();
    saveState();
    render();
    showToast(mode === 'replace' ? 'Replaced from backup' : 'Merged backup');
  }

  function handleImportFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = JSON.parse(reader.result);
        var slice = parsed;
        if (typeof AppsBackup !== 'undefined' && AppsBackup.isUnifiedBackup(parsed)) {
          slice = AppsBackup.getAppSlice(parsed, '3d-print');
          if (!slice) {
            showToast('No 3D Print data in this backup', { error: true });
            return;
          }
        }
        if (!slice || !Array.isArray(slice.items)) {
          showToast('Invalid backup file', { error: true });
          return;
        }
        pendingImport = slice;
        document.getElementById('importSummary').textContent =
          (slice.items.length || 0) + ' items, ' +
          ((slice.printers || []).length) + ' printers, ' +
          ((slice.history || []).length) + ' history entries';
        openModal('importModal');
      } catch (e) {
        showToast('Could not read file', { error: true });
      }
    };
    reader.readAsText(file);
  }

  function isPrinterListName(name) {
    var n = (name || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!n) return false;
    if (n === '3d printer' || n.includes('3d printer')) return true;
    if (n.includes('3d print')) return true;
    if (n === 'printer' || n.includes('printer')) return true;
    if (n.includes('filament') || n.includes('bambu')) return true;
    return false;
  }

  function importFromFocus() {
    try {
      var raw = localStorage.getItem('adhd-tracker-v1');
      if (!raw) {
        showToast('No Focus data found on this device', { error: true });
        return;
      }
      var parsed = JSON.parse(raw);
      var lists = Array.isArray(parsed.lists) ? parsed.lists : [];
      var printerLists = lists.filter(function (l) {
        return l.printer || isPrinterListName(l.name);
      });
      if (!printerLists.length) {
        showToast('No 3D printer list found in Focus', { error: true });
        return;
      }
      var listIds = {};
      printerLists.forEach(function (l) { listIds[l.id] = true; });
      var tasks = (parsed.tasks || []).filter(function (t) { return listIds[t.listId]; });
      if (!tasks.length) {
        showToast('Printer list is empty in Focus', { error: true });
        return;
      }
      var colorMap = {};
      (parsed.filamentColors || []).forEach(function (c) {
        colorMap[c.id] = addFilamentColor(c.hex, { name: c.name });
      });
      var catMap = {};
      (parsed.categories || []).forEach(function (c) {
        var existing = state.categories.find(function (x) {
          return x.name.toLowerCase() === (c.name || '').toLowerCase();
        });
        if (existing) catMap[c.id] = existing.id;
        else catMap[c.id] = addCategory(c.name, { silent: true, deferSave: true });
      });
      var added = 0;
      tasks.forEach(function (t) {
        if (t.completed) return;
        var title = (t.title || '').trim();
        if (!title) return;
        if (state.items.some(function (x) {
          return x.title.toLowerCase() === title.toLowerCase() && x.status !== 'done';
        })) return;
        addItem({
          title: title,
          notes: t.notes || '',
          link: t.link || '',
          priority: t.priority || 0,
          paid: !!t.paid,
          ams: !!t.ams,
          filamentColorIds: (t.filamentColorIds || []).map(function (id) { return colorMap[id] || id; }),
          categoryIds: (t.categoryIds || []).map(function (id) { return catMap[id] || id; }),
          plateCount: 1
        });
        added++;
      });
      saveState();
      render();
      showToast(added ? ('Imported ' + added + ' item' + (added === 1 ? '' : 's')) : 'Nothing new to import');
    } catch (e) {
      console.error(e);
      showToast('Focus import failed', { error: true });
    }
  }

  function wireQuickAdd() {
    var selectedPrio = 0;
    var prioBtns = document.querySelectorAll('#quickPriority .quick-prio-btn');
    prioBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var p = parseInt(btn.dataset.prio, 10);
        if (btn.classList.contains('selected')) {
          selectedPrio = 0;
          quickUi.priority = 0;
          prioBtns.forEach(function (b) {
            b.classList.remove('selected');
            b.setAttribute('aria-pressed', 'false');
          });
          return;
        }
        selectedPrio = p;
        quickUi.priority = p;
        prioBtns.forEach(function (b) {
          var on = b === btn;
          b.classList.toggle('selected', on);
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
      });
    });

    function bumpPlates(delta) {
      quickUi.plateCount = Math.max(1, Math.min(99, (quickUi.plateCount || 1) + delta));
      document.getElementById('quickPlateCount').value = String(quickUi.plateCount);
    }
    document.getElementById('quickPlateMinus').addEventListener('click', function () { bumpPlates(-1); });
    document.getElementById('quickPlatePlus').addEventListener('click', function () { bumpPlates(1); });
    document.getElementById('quickPlateCount').addEventListener('change', function () {
      quickUi.plateCount = Math.max(1, Math.min(99, parseInt(this.value, 10) || 1));
      this.value = String(quickUi.plateCount);
    });

    function submit() {
      var titleInput = document.getElementById('quickTitle');
      var linkInput = document.getElementById('quickLink');
      var title = titleInput.value.trim();
      if (!title) return;
      var link = normalizeLink(linkInput.value.trim());
      if (link && !isValidLink(link)) {
        showToast('Link must be a valid http(s) URL', { error: true });
        return;
      }
      var filamentColorIds = Array.from(quickUi.filament);
      var categoryIds = Array.from(quickUi.categories);
      var plateCount = quickUi.plateCount || 1;
      var prio = selectedPrio;
      addItem({
        title: title,
        link: link,
        priority: prio,
        paid: document.getElementById('quickPaid').checked,
        ams: document.getElementById('quickAms').checked,
        filamentColorIds: filamentColorIds,
        categoryIds: categoryIds,
        plateCount: plateCount,
        plates: makePlates(plateCount, categoryIds)
      });
      filamentColorIds.forEach(recordFilamentColorUse);
      titleInput.value = '';
      linkInput.value = '';
      selectedPrio = 0;
      quickUi.priority = 0;
      prioBtns.forEach(function (b) {
        b.classList.remove('selected');
        b.setAttribute('aria-pressed', 'false');
      });
      document.getElementById('quickPaid').checked = false;
      document.getElementById('quickAms').checked = false;
      quickUi.categories.clear();
      quickUi.filament.clear();
      quickUi.plateCount = 1;
      saveState();
      render();
      showToast(prio >= 2 ? 'Added near the top' : 'Added');
    }

    document.getElementById('quickAddBtn').addEventListener('click', submit);
    document.getElementById('quickTitle').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') submit();
    });
    document.getElementById('quickLink').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') submit();
    });
  }

  function wireUi() {
    document.querySelectorAll('.nav-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setView(btn.getAttribute('data-view'));
      });
    });

    document.getElementById('statusFilter').addEventListener('change', function () {
      state.statusFilter = this.value;
      saveState();
      renderQueue();
    });
    document.getElementById('categoryFilter').addEventListener('change', function () {
      state.categoryFilter = this.value;
      saveState();
      renderQueue();
    });

    document.getElementById('settingsBtn').addEventListener('click', function () {
      openModal('settingsModal');
    });
    document.getElementById('settingsModalClose').addEventListener('click', function () {
      closeModal('settingsModal');
    });
    document.getElementById('settingsModal').addEventListener('click', function (e) {
      if (e.target.id === 'settingsModal') closeModal('settingsModal');
    });

    document.getElementById('exportBtn').addEventListener('click', exportBackup);
    document.getElementById('importBtn').addEventListener('click', function () {
      document.getElementById('importFile').click();
    });
    document.getElementById('importFile').addEventListener('change', function () {
      var file = this.files && this.files[0];
      this.value = '';
      if (file) handleImportFile(file);
    });
    document.getElementById('importFocusBtn').addEventListener('click', function () {
      importFromFocus();
      closeModal('settingsModal');
    });
    document.getElementById('manageCategoriesBtn').addEventListener('click', function () {
      renderCategoriesManager();
      openModal('categoriesModal');
    });
    document.getElementById('manageFilamentBtn').addEventListener('click', function () {
      openFilamentManager();
    });
    document.getElementById('clearDoneBtn').addEventListener('click', function () {
      if (!confirm('Remove all done items?')) return;
      state.items = state.items.filter(function (t) { return t.status !== 'done'; });
      saveState();
      render();
      showToast('Cleared done items');
    });
    document.getElementById('resetBtn').addEventListener('click', function () {
      if (!confirm('Delete all 3D Print data on this device?')) return;
      state = {
        version: SCHEMA_VERSION,
        items: [],
        printers: [],
        timers: [],
        history: [],
        categories: [],
        filamentColors: [],
        filamentColorSortAt: 0,
        statusFilter: 'all',
        categoryFilter: 'all'
      };
      ensureFilamentColors();
      saveState();
      closeModal('settingsModal');
      render();
      showToast('Reset complete');
    });

    document.getElementById('importModalClose').addEventListener('click', function () {
      closeModal('importModal');
      pendingImport = null;
    });
    document.getElementById('importMergeBtn').addEventListener('click', function () {
      applyImportSlice(pendingImport, 'merge');
      pendingImport = null;
      closeModal('importModal');
      closeModal('settingsModal');
    });
    document.getElementById('importReplaceBtn').addEventListener('click', function () {
      applyImportSlice(pendingImport, 'replace');
      pendingImport = null;
      closeModal('importModal');
      closeModal('settingsModal');
    });

    document.getElementById('categoriesModalClose').addEventListener('click', function () {
      closeModal('categoriesModal');
    });
    document.getElementById('bulkAddCategoriesBtn').addEventListener('click', function () {
      var input = document.getElementById('bulkAddCategoriesInput');
      addBulkCategories(input.value);
      input.value = '';
      renderCategoriesManager();
      render();
    });

    document.getElementById('filamentModalClose').addEventListener('click', function () {
      closeModal('filamentModal');
    });
    document.getElementById('filamentAddColorBtn').addEventListener('click', function () {
      openFilamentColorPicker({
        title: 'Add color',
        confirmLabel: 'Add color',
        onConfirm: function (hex) {
          addFilamentColor(hex);
          renderFilamentManager();
          render();
          showToast('Added filament color');
        }
      });
    });

    // Item editor
    document.getElementById('itemModalClose').addEventListener('click', function () {
      closeModal('itemModal');
    });
    document.getElementById('itemModal').addEventListener('click', function (e) {
      if (e.target.id === 'itemModal') closeModal('itemModal');
    });
    document.querySelectorAll('#itemPrioPicker .prio-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!editingDraft) return;
        editingDraft.priority = parseInt(btn.dataset.prio, 10);
        syncItemEditorPrio();
      });
    });
    document.querySelectorAll('#itemStatusPicker .status-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!editingDraft) return;
        editingDraft.status = btn.dataset.status;
        syncItemEditorStatus();
        syncWaitlistField();
      });
    });
    document.getElementById('itemMoveTopBtn').addEventListener('click', function () {
      if (!editingDraft || !editingItemId) return;
      var item = getItem(editingItemId);
      if (!item) return;
      moveItemToTop(item);
      saveState();
      showToast('Moved to top');
      render();
    });
    document.getElementById('itemPlateMinus').addEventListener('click', function () {
      if (!editingDraft) return;
      editingDraft.plateCount = Math.max(1, (editingDraft.plateCount || 1) - 1);
      document.getElementById('itemPlateCount').value = String(editingDraft.plateCount);
    });
    document.getElementById('itemPlatePlus').addEventListener('click', function () {
      if (!editingDraft) return;
      editingDraft.plateCount = Math.min(99, (editingDraft.plateCount || 1) + 1);
      document.getElementById('itemPlateCount').value = String(editingDraft.plateCount);
    });
    document.getElementById('itemPlateCount').addEventListener('change', function () {
      if (!editingDraft) return;
      editingDraft.plateCount = Math.max(1, Math.min(99, parseInt(this.value, 10) || 1));
      this.value = String(editingDraft.plateCount);
    });
    document.getElementById('generatePlatesBtn').addEventListener('click', function () {
      if (!editingDraft) return;
      var n = Math.max(1, parseInt(editingDraft.plateCount, 10) || 1);
      editingDraft.plates = makePlates(n, editingDraft.categoryIds);
      renderEditorPlates();
      showToast('Generated ' + n + ' plate' + (n === 1 ? '' : 's'));
    });
    document.getElementById('bulkPlatesBtn').addEventListener('click', function () {
      bulkPlateCategorySelected = new Set(editingDraft ? editingDraft.categoryIds || [] : []);
      bulkPlateCategoryAdding = false;
      document.getElementById('bulkPlatesInput').value = '';
      renderCategoryChipRow(
        document.getElementById('bulkPlateCategories'),
        function () { return bulkPlateCategorySelected; },
        function () { return bulkPlateCategoryAdding; },
        function (v) { bulkPlateCategoryAdding = v; },
        function () {}
      );
      openModal('bulkPlatesModal');
    });
    document.getElementById('bulkPlatesClose').addEventListener('click', function () {
      closeModal('bulkPlatesModal');
    });
    document.getElementById('bulkPlatesCancel').addEventListener('click', function () {
      closeModal('bulkPlatesModal');
    });
    document.getElementById('bulkPlatesApply').addEventListener('click', function () {
      if (!editingDraft) return;
      var names = document.getElementById('bulkPlatesInput').value
        .split('\n')
        .map(function (s) { return s.trim(); })
        .filter(Boolean);
      if (!names.length) {
        showToast('Enter at least one plate name', { error: true });
        return;
      }
      var cats = Array.from(bulkPlateCategorySelected);
      if (!editingDraft.plates) editingDraft.plates = [];
      names.forEach(function (name) {
        editingDraft.plates.push(normalizePlate({ name: name, categoryIds: cats }));
      });
      syncPlateCountFromPlates(editingDraft);
      document.getElementById('itemPlateCount').value = String(editingDraft.plateCount);
      closeModal('bulkPlatesModal');
      renderEditorPlates();
      showToast('Added ' + names.length + ' plate' + (names.length === 1 ? '' : 's'));
    });
    document.getElementById('markReadyBtn').addEventListener('click', function () {
      if (!editingItemId) return;
      // Persist draft fields into draft object first
      editingDraft.title = document.getElementById('itemTitle').value;
      editingDraft.link = document.getElementById('itemLink').value;
      editingDraft.notes = document.getElementById('itemNotes').value;
      editingDraft.waitlistReason = document.getElementById('itemWaitlistReason').value;
      editingDraft.paid = document.getElementById('itemPaid').checked;
      editingDraft.ams = document.getElementById('itemAms').checked;
      if (!updateItemFromDraft()) return;
      closeModal('itemModal');
      openSendModal(editingItemId);
    });
    document.getElementById('itemSaveBtn').addEventListener('click', function () {
      editingDraft.title = document.getElementById('itemTitle').value;
      editingDraft.link = document.getElementById('itemLink').value;
      editingDraft.notes = document.getElementById('itemNotes').value;
      editingDraft.waitlistReason = document.getElementById('itemWaitlistReason').value;
      editingDraft.paid = document.getElementById('itemPaid').checked;
      editingDraft.ams = document.getElementById('itemAms').checked;
      editingDraft.plateCount = Math.max(1, parseInt(document.getElementById('itemPlateCount').value, 10) || 1);
      if (!updateItemFromDraft()) return;
      closeModal('itemModal');
      render();
      showToast('Saved');
    });
    document.getElementById('itemDeleteBtn').addEventListener('click', function () {
      if (!editingItemId) return;
      if (!confirm('Delete this item?')) return;
      deleteItem(editingItemId);
      closeModal('itemModal');
      render();
      showToast('Deleted');
    });

    // Send modal
    document.getElementById('sendModalClose').addEventListener('click', function () {
      closeModal('sendModal');
    });
    document.getElementById('sendCancel').addEventListener('click', function () {
      closeModal('sendModal');
    });
    document.getElementById('sendConfirm').addEventListener('click', function () {
      var printerId = document.getElementById('sendPrinterSelect').value;
      var minutes = parseInt(document.getElementById('sendDuration').value, 10);
      var start = document.getElementById('sendStartTimer').checked;
      if (!printerId) {
        showToast('Pick a printer', { error: true });
        return;
      }
      if (start && (!minutes || minutes < 1)) {
        showToast('Enter print time in minutes', { error: true });
        return;
      }
      markReadyAndMaybeTimer({
        itemId: sendTargetItemId,
        printerId: printerId,
        durationMinutes: minutes || null,
        startTimer: start && minutes > 0
      });
      closeModal('sendModal');
      render();
      showToast(start ? 'Ready — timer started' : 'Marked ready');
    });

    // Printer modal
    document.getElementById('addPrinterBtn').addEventListener('click', function () {
      openPrinterEditor(null);
    });
    document.getElementById('printerModalClose').addEventListener('click', function () {
      closeModal('printerModal');
    });
    document.getElementById('printerSaveBtn').addEventListener('click', function () {
      var name = document.getElementById('printerName').value.trim();
      if (!name) {
        showToast('Enter a printer name', { error: true });
        return;
      }
      if (editingPrinterId) {
        var p = getPrinter(editingPrinterId);
        if (p) {
          p.name = name;
          p.model = document.getElementById('printerModel').value.trim();
          p.notes = document.getElementById('printerNotes').value.trim();
        }
      } else {
        state.printers.push(normalizePrinter({
          name: name,
          model: document.getElementById('printerModel').value.trim(),
          notes: document.getElementById('printerNotes').value.trim()
        }));
      }
      saveState();
      closeModal('printerModal');
      render();
      showToast('Printer saved');
    });
    document.getElementById('printerDeleteBtn').addEventListener('click', function () {
      if (!editingPrinterId) return;
      if (!confirm('Delete this printer? History stays.')) return;
      state.printers = state.printers.filter(function (p) { return p.id !== editingPrinterId; });
      saveState();
      closeModal('printerModal');
      render();
      showToast('Printer deleted');
    });
    document.getElementById('printerStartTimerBtn').addEventListener('click', function () {
      if (!editingPrinterId) return;
      var minutes = parseInt(document.getElementById('printerTimerMinutes').value, 10);
      if (!minutes || minutes < 1) {
        showToast('Enter minutes', { error: true });
        return;
      }
      startTimer({
        printerId: editingPrinterId,
        itemTitle: 'Manual timer',
        durationMinutes: minutes
      });
      closeModal('printerModal');
      render();
      showToast('Timer started');
    });

    document.getElementById('clearHistoryBtn').addEventListener('click', function () {
      if (!state.history.length) return;
      if (!confirm('Clear print history?')) return;
      state.history = [];
      saveState();
      render();
      showToast('History cleared');
    });

    window.addEventListener('scroll', function () {
      document.querySelector('.app-header').classList.toggle('scrolled', window.scrollY > 4);
    }, { passive: true });

    wireQuickAdd();
  }

  function startTicker() {
    clearInterval(tickTimer);
    tickTimer = setInterval(function () {
      if (currentView === 'printers' && state.timers.some(function (t) { return t.status === 'running'; })) {
        renderPrinters();
      }
    }, 1000);
  }

  loadState();
  wireUi();
  render();
  startTicker();
})();
