(function() {
'use strict';

var STORAGE_KEY = 'meal-menu-v1';
var PHOTO_DB = 'meal-menu-photos-v1';
var PHOTO_STORE = 'photos';
var MAX_TAGS = 24;
var MAX_CUSTOM_CATS = 12;

var BUILTIN_CATEGORIES = [
  { id: 'take-out', label: 'Take Out', icon: '🥡', builtin: true },
  { id: 'eat-out', label: 'Eat Out', icon: '🍽', builtin: true },
  { id: 'cooking', label: 'Cooking', icon: '👩‍🍳', builtin: true },
  { id: 'frozen', label: 'Frozen', icon: '🧊', builtin: true },
  { id: 'drinks', label: 'Drinks', icon: '🍷', builtin: true },
  { id: 'groceries', label: 'Groceries', icon: '🛒', builtin: true }
];

var SEED_ENTRIES = [
  { name: 'Frozen dumplings', category: 'frozen', notes: 'Costco or HMart — quick weeknight', favorite: true },
  { name: 'Sheet-pan salmon', category: 'cooking', notes: 'Broccoli + lemon, 25 min', favorite: false },
  { name: 'Pizza takeout', category: 'take-out', notes: 'Local spot or DoorDash', favorite: false },
  { name: 'Date night out', category: 'eat-out', notes: 'Pick from Philly Dates when ready', favorite: true },
  { name: 'Smoothie night', category: 'drinks', notes: 'Frozen fruit + yogurt', favorite: false },
  { name: 'Weekly grocery run', category: 'groceries', notes: 'Trader Joe\'s / Acme', favorite: false }
];

var activeRootTab = 'spin';
var activeCategory = 'cooking';
var menuView = 'landing';
var currentEntryId = '';
var editMode = false;
var addingNew = false;
var editSelectedTags = [];
var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
var modalPhotoUrl = null;
var listThumbCache = {};
var listThumbPending = {};

var pickerSelectedTags = [];
var ateLogMode = 'menu';
var ateSelectedTags = [];
var ateMenuCategory = 'all';
var pickerPool = [];
var pickerRotation = 0;
var pickerSpinning = false;
var pickerWinnerId = '';
var PICKER_COLORS = ['#8b3a3a', '#6e3a8b', '#3a6e8b', '#3a8b5c', '#8b6e3a', '#8b3a6e', '#5c6e8b', '#8b5c3a'];

var CATEGORY_ICON_SVGS = {
  'take-out': '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M14 22h36l-4 32H18L14 22z"/><path d="M22 22V14a10 10 0 0 1 20 0v8"/><line x1="26" y1="34" x2="26" y2="46"/><line x1="32" y1="34" x2="32" y2="46"/><line x1="38" y1="34" x2="38" y2="46"/></svg>',
  'eat-out': '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M12 48V20c0-4 4-8 8-8h24c4 0 8 4 8 8v28"/><path d="M8 48h48"/><path d="M20 12v8M28 12v8M36 12v8"/><ellipse cx="32" cy="30" rx="14" ry="6"/><path d="M18 30c0 8 6 14 14 14s14-6 14-14"/></svg>',
  'cooking': '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M16 38c0-10 7-18 16-18s16 8 16 18"/><path d="M12 38h40"/><path d="M20 20c2-6 6-10 12-10s10 4 12 10"/><line x1="32" y1="10" x2="32" y2="6"/><line x1="24" y1="12" x2="22" y2="8"/><line x1="40" y1="12" x2="42" y2="8"/></svg>',
  'frozen': '<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="18" y="18" width="28" height="28" rx="4"/><line x1="32" y1="10" x2="32" y2="54"/><line x1="10" y1="32" x2="54" y2="32"/><line x1="16" y1="16" x2="48" y2="48"/><line x1="48" y1="16" x2="16" y2="48"/></svg>',
  'drinks': '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M22 14h20l-6 28H28L22 14z"/><line x1="20" y1="14" x2="44" y2="14"/><path d="M26 42h12v6H26z"/><line x1="24" y1="48" x2="40" y2="48"/></svg>',
  'groceries': '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M12 20h8l4 28h16l4-28h8"/><path d="M24 20V14a8 8 0 0 1 16 0v6"/><circle cx="26" cy="52" r="3"/><circle cx="38" cy="52" r="3"/></svg>',
  'default': '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="20"/><path d="M22 32c0-6 4-10 10-10s10 4 10 10"/><line x1="32" y1="22" x2="32" y2="18"/></svg>'
};

var FOOD_PLACEHOLDER_SVG = '<svg viewBox="0 0 64 64" aria-hidden="true"><ellipse cx="32" cy="38" rx="22" ry="10"/><path d="M14 38c0-12 8-20 18-20s18 8 18 20"/><line x1="24" y1="16" x2="24" y2="10"/><line x1="32" y1="14" x2="32" y2="6"/><line x1="40" y1="16" x2="40" y2="10"/></svg>';

function categoryIconSvg(catId) {
  return CATEGORY_ICON_SVGS[catId] || CATEGORY_ICON_SVGS.default;
}

function truncBlurb(text, max) {
  if (!text) return '';
  var t = String(text).trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1).trim() + '…';
}

function countEntriesInCategory(catId) {
  return getState().entries.filter(function(e) { return e.category === catId; }).length;
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function newId(prefix) {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function loadAppState() {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function defaultState() {
  return {
    version: 2,
    categories: BUILTIN_CATEGORIES.map(function(c) {
      return { id: c.id, label: c.label, builtin: true };
    }),
    tags: [],
    tagFilter: 'all',
    entryPhotos: {},
    entries: [],
    mealLog: []
  };
}

function isRestaurantCategory(catId) {
  return catId === 'take-out' || catId === 'eat-out';
}

function normalizeState(st) {
  if (!st || typeof st !== 'object') st = defaultState();
  if (!Array.isArray(st.categories)) st.categories = defaultState().categories;
  if (!Array.isArray(st.tags)) st.tags = [];
  if (!Array.isArray(st.entries)) st.entries = [];
  if (!Array.isArray(st.mealLog)) st.mealLog = [];
  if (!st.entryPhotos || typeof st.entryPhotos !== 'object') st.entryPhotos = {};
  if (!st.tagFilter) st.tagFilter = 'all';
  st.entries.forEach(function(e) {
    if (e.orderUrl) delete e.orderUrl;
    if (e.menuUrl && !e.restaurantName) e.restaurantName = '';
    if (e.phillyPlaceName && !e.restaurantName) e.restaurantName = e.phillyPlaceName;
    if (!('restaurantName' in e)) e.restaurantName = '';
    delete e.menuUrl;
    delete e.phillyPlaceName;
  });
  st.mealLog.forEach(function(log) {
    if (!log.id) log.id = newId('log');
    if (!log.date) log.date = '';
    if (!log.source) log.source = 'menu';
    if (!log.description) log.description = '';
    if (!log.restaurantName) log.restaurantName = '';
    if (!log.createdAt) log.createdAt = Date.now();
  });
  st.version = 2;
  BUILTIN_CATEGORIES.forEach(function(b) {
    if (!st.categories.some(function(c) { return c.id === b.id; })) {
      st.categories.unshift({ id: b.id, label: b.label, builtin: true });
    }
  });
  return st;
}

function saveAppState(st) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeState(st)));
}

function initState() {
  var st = loadAppState();
  if (!st) {
    st = defaultState();
    SEED_ENTRIES.forEach(function(s) {
      st.entries.push({
        id: newId('entry'),
        name: s.name,
        category: s.category,
        notes: s.notes || '',
        restaurantName: '',
        tagIds: [],
        favorite: !!s.favorite,
        lastHad: '',
        createdAt: Date.now()
      });
    });
    saveAppState(st);
  }
  return normalizeState(st);
}

function getState() {
  return normalizeState(loadAppState() || defaultState());
}

function todayIso() {
  var d = new Date();
  var m = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + m + '-' + day;
}

function getPastRestaurantNames() {
  var names = {};
  getState().entries.forEach(function(e) {
    if (isRestaurantCategory(e.category) && e.restaurantName) names[e.restaurantName.trim()] = true;
  });
  (getState().mealLog || []).forEach(function(log) {
    if ((log.source === 'take-out' || log.source === 'eat-out') && log.restaurantName) {
      names[log.restaurantName.trim()] = true;
    }
  });
  return Object.keys(names).sort(function(a, b) { return a.localeCompare(b); });
}

function getAllCategories() {
  return getState().categories;
}

function categoryLabel(id) {
  var c = getAllCategories().find(function(x) { return x.id === id; });
  return c ? c.label : id;
}

function hasPhoto(entryId) {
  var st = getState();
  return !!(st.entryPhotos && st.entryPhotos[entryId]);
}

function setPhotoFlag(entryId, on) {
  var st = getState();
  if (!st.entryPhotos) st.entryPhotos = {};
  if (on) st.entryPhotos[entryId] = true;
  else delete st.entryPhotos[entryId];
  saveAppState(st);
}

function photoDbKey(entryId) {
  return 'entry:' + entryId;
}

function openPhotoDb() {
  return new Promise(function(resolve, reject) {
    var req = indexedDB.open(PHOTO_DB, 1);
    req.onerror = function() { reject(req.error); };
    req.onsuccess = function() { resolve(req.result); };
    req.onupgradeneeded = function(e) {
      var db = e.target.result;
      if (!db.objectStoreNames.contains(PHOTO_STORE)) {
        db.createObjectStore(PHOTO_STORE);
      }
    };
  });
}

function putEntryPhoto(entryId, blob) {
  return openPhotoDb().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx = db.transaction(PHOTO_STORE, 'readwrite');
      tx.objectStore(PHOTO_STORE).put(blob, photoDbKey(entryId));
      tx.oncomplete = function() { resolve(); };
      tx.onerror = function() { reject(tx.error); };
    });
  });
}

function getEntryPhotoBlob(entryId) {
  return openPhotoDb().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx = db.transaction(PHOTO_STORE, 'readonly');
      var req = tx.objectStore(PHOTO_STORE).get(photoDbKey(entryId));
      req.onsuccess = function() { resolve(req.result || null); };
      req.onerror = function() { reject(req.error); };
    });
  });
}

function deleteEntryPhotoBlob(entryId) {
  return openPhotoDb().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx = db.transaction(PHOTO_STORE, 'readwrite');
      tx.objectStore(PHOTO_STORE).delete(photoDbKey(entryId));
      tx.oncomplete = function() { resolve(); };
      tx.onerror = function() { reject(tx.error); };
    });
  });
}

function clearAllEntryPhotosFromDb() {
  return openPhotoDb().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx = db.transaction(PHOTO_STORE, 'readwrite');
      tx.objectStore(PHOTO_STORE).clear();
      tx.oncomplete = function() { resolve(); };
      tx.onerror = function() { reject(tx.error); };
    });
  });
}

var CLEAR_PHOTOS_CONFIRM = 'Clear all meal photos from this device?\n\nExport a ZIP first if you want to keep them. Meals, tags, and categories stay — only images are removed.';

function clearPhotosFromDevice() {
  if (!confirm(CLEAR_PHOTOS_CONFIRM)) return;
  var btn = document.getElementById('clear-photos-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Clearing…'; }
  clearAllEntryPhotosFromDb().then(function() {
    var st = getState();
    st.entryPhotos = {};
    saveAppState(st);
    Object.keys(listThumbCache).forEach(function(id) { invalidateListThumb(id); });
    revokeModalPhotoUrl();
    closeModal();
    renderManage();
    renderAllLists();
    renderCategoryTabs();
    if (activeRootTab === 'spin') {
      resetPickResult();
      refreshPicker();
    }
    if (activeRootTab === 'ate') renderAtePanel();
    showStatus('Photos cleared — meals unchanged');
  }).catch(function() {
    showStatus('Could not clear photos');
  }).finally(function() {
    if (btn) { btn.disabled = false; btn.textContent = 'Clear photos'; }
  });
}

function idbGetAllPhotoKeys() {
  return openPhotoDb().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx = db.transaction(PHOTO_STORE, 'readonly');
      var req = tx.objectStore(PHOTO_STORE).getAllKeys();
      req.onsuccess = function() { resolve(req.result || []); };
      req.onerror = function() { reject(req.error); };
    });
  });
}

function invalidateListThumb(entryId) {
  if (listThumbCache[entryId]) {
    URL.revokeObjectURL(listThumbCache[entryId]);
    delete listThumbCache[entryId];
  }
  delete listThumbPending[entryId];
}

function revokeModalPhotoUrl() {
  if (modalPhotoUrl) {
    URL.revokeObjectURL(modalPhotoUrl);
    modalPhotoUrl = null;
  }
}

function getListThumbUrl(entryId) {
  if (!hasPhoto(entryId)) return Promise.resolve(null);
  if (listThumbCache[entryId]) return Promise.resolve(listThumbCache[entryId]);
  if (listThumbPending[entryId]) return listThumbPending[entryId];
  listThumbPending[entryId] = getEntryPhotoBlob(entryId).then(function(blob) {
    delete listThumbPending[entryId];
    if (!blob) {
      setPhotoFlag(entryId, false);
      invalidateListThumb(entryId);
      return null;
    }
    var url = URL.createObjectURL(blob);
    listThumbCache[entryId] = url;
    return url;
  });
  return listThumbPending[entryId];
}

function reconcileEntryPhotosFromIdb() {
  return idbGetAllPhotoKeys().then(function(keys) {
    var st = getState();
    if (!st.entryPhotos) st.entryPhotos = {};
    var fromIdb = {};
    keys.forEach(function(k) {
      var s = String(k);
      if (s.indexOf('entry:') === 0) {
        var id = s.slice(6);
        fromIdb[id] = true;
        st.entryPhotos[id] = true;
      }
    });
    Object.keys(st.entryPhotos).forEach(function(id) {
      if (!fromIdb[id]) delete st.entryPhotos[id];
    });
    saveAppState(st);
    Object.keys(listThumbCache).forEach(function(id) {
      if (!fromIdb[id]) invalidateListThumb(id);
    });
  }).catch(function() {});
}

function getTags() {
  return getState().tags || [];
}

function getTagFilter() {
  return getState().tagFilter || 'all';
}

function setTagFilter(id) {
  var st = getState();
  st.tagFilter = id;
  saveAppState(st);
  renderTagFilters();
  renderAllLists();
}

function addTag(label) {
  var name = (label || '').trim();
  if (!name) return false;
  var st = getState();
  if (st.tags.length >= MAX_TAGS) {
    showStatus('Max ' + MAX_TAGS + ' tags');
    return false;
  }
  if (st.tags.some(function(t) { return t.label.toLowerCase() === name.toLowerCase(); })) {
    showStatus('Tag already exists');
    return false;
  }
  st.tags.push({ id: newId('tag'), label: name });
  saveAppState(st);
  renderTagFilters();
  renderManage();
  return true;
}

function deleteTag(id) {
  if (!id) return;
  var st = getState();
  var tag = st.tags.find(function(t) { return t.id === id; });
  if (!tag) return;
  if (!confirm('Delete tag "' + tag.label + '"? It will be removed from all meals.')) return;
  st.tags = st.tags.filter(function(t) { return t.id !== id; });
  if (st.tagFilter === id) st.tagFilter = 'all';
  st.entries.forEach(function(e) {
    if (Array.isArray(e.tagIds)) e.tagIds = e.tagIds.filter(function(tid) { return tid !== id; });
  });
  saveAppState(st);
  renderTagFilters();
  renderAllLists();
  renderManage();
  renderPickTags();
}

function tagLabel(id) {
  var t = getTags().find(function(x) { return x.id === id; });
  return t ? t.label : '';
}

function countEntriesWithTag(id) {
  return getState().entries.filter(function(e) {
    return Array.isArray(e.tagIds) && e.tagIds.indexOf(id) >= 0;
  }).length;
}

function getEntryById(id) {
  return getState().entries.find(function(e) { return e.id === id; }) || null;
}

function filterEntries(list) {
  var searchEl = document.getElementById('search');
  var q = searchEl ? (searchEl.value || '').trim().toLowerCase() : '';
  var tagFilter = getTagFilter();
  if (tagFilter && tagFilter !== 'all') {
    list = list.filter(function(e) {
      return Array.isArray(e.tagIds) && e.tagIds.indexOf(tagFilter) >= 0;
    });
  }
  if (q) {
    list = list.filter(function(e) {
      var hay = (e.name + ' ' + (e.notes || '')).toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  list.sort(function(a, b) {
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return list;
}

function entriesForCategory(catId) {
  return filterEntries(getState().entries.filter(function(e) { return e.category === catId; }));
}

function showStatus(msg) {
  var el = document.getElementById('status');
  if (!el) return;
  el.textContent = msg || '';
  el.hidden = !msg;
  if (msg) setTimeout(function() { el.hidden = true; }, 3200);
}

function renderTagFilters() {
  var el = document.getElementById('tag-filters');
  if (!el) return;
  var tags = getTags();
  var active = getTagFilter();
  var html = '<button type="button" class="tag-chip' + (active === 'all' ? ' on' : '') + '" data-tag-filter="all">All</button>';
  tags.forEach(function(tag) {
    html += '<button type="button" class="tag-chip' + (active === tag.id ? ' on' : '') + '" data-tag-filter="' + escapeHtml(tag.id) + '">' + escapeHtml(tag.label) + '</button>';
  });
  el.innerHTML = html;
}

function renderListForCategory(catId) {
  var panel = document.getElementById('cat-panel-' + catId);
  if (!panel) return;
  var list = entriesForCategory(catId);
  var ul = panel.querySelector('.menu-cards');
  if (!ul) return;
  if (!list.length) {
    ul.innerHTML = '<li class="empty-state">Nothing here yet — tap + Add to save a go-to</li>';
    return;
  }
  ul.innerHTML = list.map(function(e) {
    var blurb = truncBlurb(e.notes, 72);
    var rest = (isRestaurantCategory(e.category) && e.restaurantName)
      ? '<p class="menu-card-restaurant">' + escapeHtml(e.restaurantName) + '</p>' : '';
    var imgBlock = hasPhoto(e.id)
      ? '<img class="menu-card-img" data-thumb-id="' + escapeHtml(e.id) + '" alt="" hidden>'
      : '<span class="menu-card-placeholder">' + FOOD_PLACEHOLDER_SVG + '</span>';
    return '<li class="menu-card" data-entry-id="' + escapeHtml(e.id) + '" role="button" tabindex="0">'
      + '<div class="menu-card-img-wrap">'
      + imgBlock
      + '<span class="menu-card-fav' + (e.favorite ? ' on' : '') + '" aria-hidden="true">' + (e.favorite ? '★' : '☆') + '</span>'
      + '</div>'
      + '<div class="menu-card-body">'
      + '<h3 class="menu-card-name">' + escapeHtml(e.name) + '</h3>'
      + (blurb ? '<p class="menu-card-blurb">' + escapeHtml(blurb) + '</p>' : '')
      + rest
      + '</div></li>';
  }).join('');

  list.forEach(function(e) {
    if (!hasPhoto(e.id)) return;
    getListThumbUrl(e.id).then(function(url) {
      if (!url) return;
      var img = ul.querySelector('[data-thumb-id="' + e.id + '"]');
      if (!img) return;
      img.src = url;
      img.hidden = false;
      var placeholder = img.parentElement.querySelector('.menu-card-placeholder');
      if (placeholder) placeholder.remove();
    });
  });
}

function renderAllLists() {
  getAllCategories().forEach(function(c) {
    renderListForCategory(c.id);
  });
  renderCategoryGrid();
  refreshPicker();
}

function ensureCategoryPanels() {
  var wrap = document.getElementById('category-panels');
  if (!wrap) return;
  getAllCategories().forEach(function(c) {
    if (document.getElementById('cat-panel-' + c.id)) return;
    var sec = document.createElement('div');
    sec.className = 'cat-panel';
    sec.id = 'cat-panel-' + c.id;
    sec.setAttribute('data-category', c.id);
    sec.innerHTML = '<ul class="menu-cards" role="list"></ul>';
    wrap.appendChild(sec);
  });
}

function renderCategoryGrid() {
  var grid = document.getElementById('category-grid');
  if (!grid) return;
  grid.innerHTML = getAllCategories().map(function(c) {
    var count = countEntriesInCategory(c.id);
    var countLabel = count === 0 ? 'Empty' : count + ' item' + (count === 1 ? '' : 's');
    return '<button type="button" class="category-tile" data-cat-nav="' + escapeHtml(c.id) + '" role="listitem">'
      + '<span class="category-tile-art">' + categoryIconSvg(c.id) + '</span>'
      + '<span class="category-tile-label">' + escapeHtml(c.label) + '</span>'
      + '<span class="category-tile-count">' + countLabel + '</span>'
      + '</button>';
  }).join('');
}

function updateMenuView() {
  var landing = document.getElementById('menu-landing');
  var detail = document.getElementById('menu-category-view');
  var backBtn = document.getElementById('menu-back-btn');
  var isLanding = menuView === 'landing';
  if (landing) landing.hidden = !isLanding;
  if (detail) detail.hidden = isLanding;
  if (backBtn) backBtn.hidden = !(activeRootTab === 'menu' && !isLanding);
}

function showMenuLanding() {
  menuView = 'landing';
  document.querySelectorAll('.cat-panel').forEach(function(p) {
    p.classList.remove('on');
    p.hidden = true;
  });
  updateMenuView();
  renderCategoryGrid();
  updateHeaderForTab();
}

function enterMenuCategory(catId) {
  if (!catId) return;
  menuView = 'category';
  activeCategory = catId;
  document.querySelectorAll('.cat-panel').forEach(function(p) {
    var on = p.getAttribute('data-category') === catId;
    p.classList.toggle('on', on);
    p.hidden = !on;
  });
  renderCategoryTabs();
  renderListForCategory(catId);
  updateMenuView();
  updateHeaderForTab();
}

function renderCategoryTabs() {
  var bar = document.getElementById('category-tabs');
  if (!bar) return;
  bar.innerHTML = getAllCategories().map(function(c) {
    return '<button type="button" class="cat-tab' + (activeCategory === c.id ? ' on' : '') + '" data-category="' + escapeHtml(c.id) + '">'
      + escapeHtml(c.label) + '</button>';
  }).join('');
}

function updateRootTabs() {
  document.querySelectorAll('#tabbar .tab').forEach(function(t) {
    var on = t.getAttribute('data-tab') === activeRootTab;
    t.classList.toggle('on', on);
    t.setAttribute('aria-selected', on ? 'true' : 'false');
  });
}

function switchCategory(catId) {
  if (!catId) return;
  enterMenuCategory(catId);
  populatePickCategorySelect();
}

function updateHeaderForTab() {
  var sub = document.getElementById('section-sub');
  var searchRow = document.getElementById('search-row');
  var tagWrap = document.getElementById('tag-filters-wrap');
  var addBtn = document.getElementById('add-btn');
  var isMenu = activeRootTab === 'menu';
  var isMenuDetail = isMenu && menuView === 'category';
  if (searchRow) searchRow.hidden = !isMenuDetail;
  if (tagWrap) tagWrap.hidden = !isMenuDetail;
  if (addBtn) addBtn.hidden = !isMenu;
  if (sub) {
    if (activeRootTab === 'spin') sub.textContent = 'Spin to decide';
    else if (activeRootTab === 'manage') sub.textContent = 'Tags, categories & backup';
    else if (activeRootTab === 'ate') sub.textContent = 'Log what you ate';
    else if (menuView === 'landing') sub.textContent = 'Pick a section or add something new';
    else sub.textContent = categoryLabel(activeCategory) + ' · tap a card for details';
  }
}

function switchRootTab(tabId) {
  if (tabId === activeRootTab) return;
  var prevPanel = document.querySelector('.panel.on');
  var nextPanel = document.getElementById('panel-' + tabId);
  if (!nextPanel) return;

  activeRootTab = tabId;

  if (prevPanel && prevPanel !== nextPanel && !reducedMotion) {
    prevPanel.classList.add('panel-leave');
    prevPanel.classList.remove('on');
    setTimeout(function() {
      prevPanel.classList.remove('panel-leave');
      prevPanel.hidden = true;
    }, 220);
  }

  document.querySelectorAll('.panel').forEach(function(p) {
    if (p === nextPanel) return;
    if (p !== prevPanel || reducedMotion) {
      p.classList.remove('on', 'panel-leave', 'panel-enter');
      p.hidden = true;
    }
  });

  nextPanel.hidden = false;
  nextPanel.classList.add('on');
  if (!reducedMotion) {
    nextPanel.classList.add('panel-enter');
    requestAnimationFrame(function() {
      requestAnimationFrame(function() { nextPanel.classList.remove('panel-enter'); });
    });
  }

  if (tabId === 'menu') {
    ensureCategoryPanels();
    if (menuView === 'landing') {
      showMenuLanding();
    } else {
      enterMenuCategory(activeCategory);
    }
    renderAllLists();
  }
  if (tabId === 'spin') {
    resetPickResult();
    populatePickCategorySelect();
    refreshPicker();
  }
  if (tabId === 'ate') renderAtePanel();
  updateHeaderForTab();
  updateRootTabs();
}

function openModal() {
  document.getElementById('modal').classList.add('open');
  document.body.classList.add('modal-open');
}

function closeModal() {
  document.getElementById('modal').classList.remove('open');
  document.body.classList.remove('modal-open');
  editMode = false;
  addingNew = false;
  currentEntryId = '';
  revokeModalPhotoUrl();
}

function toggleFavorite(entry) {
  entry.favorite = !entry.favorite;
  var st = getState();
  var idx = st.entries.findIndex(function(e) { return e.id === entry.id; });
  if (idx >= 0) st.entries[idx] = entry;
  saveAppState(st);
  renderAllLists();
  updateModalFav();
}

function updateModalFav() {
  var btn = document.getElementById('modal-fav');
  var e = getEntryById(currentEntryId);
  if (!btn || !e) return;
  btn.textContent = e.favorite ? '★' : '☆';
  btn.classList.toggle('on', e.favorite);
}

function showPhotoInModal(entryId, containerId) {
  var block = document.getElementById(containerId);
  if (!block) return;
  revokeModalPhotoUrl();
  if (!hasPhoto(entryId)) {
    block.hidden = true;
    block.innerHTML = '';
    return;
  }
  getListThumbUrl(entryId).then(function(url) {
    if (!url || currentEntryId !== entryId) return;
    modalPhotoUrl = url;
    block.innerHTML = '<img src="' + url + '" alt="Meal photo">';
    block.hidden = false;
  });
}

function renderViewMode(entry) {
  editMode = false;
  addingNew = false;
  document.getElementById('modal-edit').style.display = '';
  document.getElementById('modal-title').textContent = entry.name;
  var meta = '<span class="badge">' + escapeHtml(categoryLabel(entry.category)) + '</span>';
  if (isRestaurantCategory(entry.category) && entry.restaurantName) {
    meta += ' · ' + escapeHtml(entry.restaurantName);
  }
  if (entry.lastHad) meta += ' · Last had ' + escapeHtml(entry.lastHad);
  document.getElementById('modal-meta').innerHTML = meta;

  var tags = getTags();
  var tagHtml = tags.length
    ? '<div class="detail-tags" id="detail-tags">' + tags.map(function(t) {
        var on = entry.tagIds && entry.tagIds.indexOf(t.id) >= 0;
        return '<button type="button" class="detail-tag-chip' + (on ? ' on' : '') + '" data-detail-tag="' + escapeHtml(t.id) + '">' + escapeHtml(t.label) + '</button>';
      }).join('') + '</div>'
    : '<p class="hint">Add tags in Manage to label meals.</p>';

  var body = '<div id="modal-entry-photo" class="entry-photo-block" hidden></div>';
  if (entry.notes) body += '<p class="modal-desc">' + escapeHtml(entry.notes) + '</p>';
  else body += '<p class="modal-empty">No notes yet.</p>';
  body += tagHtml;
  body += '<label class="pick-label" style="margin-top:12px">Last had</label>';
  body += '<input type="date" id="view-last-had" value="' + escapeHtml(entry.lastHad || '') + '">';

  document.getElementById('modal-body').innerHTML = body;
  showPhotoInModal(entry.id, 'modal-entry-photo');

  document.getElementById('modal-footer').innerHTML = '';
  document.getElementById('modal-footer').style.display = 'none';

  updateModalFav();

  document.getElementById('view-last-had').onchange = function() {
    entry.lastHad = this.value;
    var st = getState();
    var i = st.entries.findIndex(function(x) { return x.id === entry.id; });
    if (i >= 0) { st.entries[i] = entry; saveAppState(st); }
    var metaHtml = '<span class="badge">' + escapeHtml(categoryLabel(entry.category)) + '</span>';
    if (isRestaurantCategory(entry.category) && entry.restaurantName) {
      metaHtml += ' · ' + escapeHtml(entry.restaurantName);
    }
    if (entry.lastHad) metaHtml += ' · Last had ' + escapeHtml(entry.lastHad);
    document.getElementById('modal-meta').innerHTML = metaHtml;
  };

  var detailTags = document.getElementById('detail-tags');
  if (detailTags) {
    detailTags.onclick = function(ev) {
      var chip = ev.target.closest('[data-detail-tag]');
      if (!chip) return;
      var tid = chip.getAttribute('data-detail-tag');
      if (!entry.tagIds) entry.tagIds = [];
      var ix = entry.tagIds.indexOf(tid);
      if (ix >= 0) entry.tagIds.splice(ix, 1);
      else entry.tagIds.push(tid);
      var st = getState();
      var i = st.entries.findIndex(function(x) { return x.id === entry.id; });
      if (i >= 0) { st.entries[i] = entry; saveAppState(st); }
      renderViewMode(entry);
      renderAllLists();
    };
  }
}

function wirePhotoEdit(entryId) {
  var fileInp = document.getElementById('entry-photo-file');
  var cameraInp = document.getElementById('entry-photo-camera-file');
  var libraryBtn = document.getElementById('entry-photo-library');
  var cameraBtn = document.getElementById('entry-photo-camera');
  var removeBtn = document.getElementById('entry-photo-remove');
  if (!fileInp || !libraryBtn) return;

  function currentId() {
    return entryId || currentEntryId;
  }

  function refreshPreview() {
    var id = currentId() || entryId;
    var prev = document.getElementById('entry-photo-preview');
    if (!prev || !id) {
      if (prev) prev.innerHTML = '<p class="modal-empty">No photo yet.</p>';
      if (removeBtn) removeBtn.hidden = true;
      return;
    }
    if (!hasPhoto(id)) {
      prev.innerHTML = '<p class="modal-empty">No photo yet.</p>';
      if (removeBtn) removeBtn.hidden = true;
      return;
    }
    getListThumbUrl(id).then(function(url) {
      if (!url) {
        prev.innerHTML = '<p class="modal-empty">No photo yet.</p>';
        if (removeBtn) removeBtn.hidden = true;
        return;
      }
      prev.innerHTML = '<img src="' + url + '" alt="Preview">';
      if (removeBtn) removeBtn.hidden = false;
    });
  }

  function handlePhotoFile(f) {
    var id = currentId() || entryId;
    if (!f || !id) return;
    var type = (f.type || '').toLowerCase();
    var name = (f.name || '').toLowerCase();
    var ok = type.indexOf('image/') === 0 || /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(name);
    if (!ok) {
      alert('Please choose an image.');
      return;
    }
    putEntryPhoto(id, f).then(function() {
      invalidateListThumb(id);
      setPhotoFlag(id, true);
      refreshPreview();
      renderAllLists();
      showStatus('Photo saved');
    }).catch(function() {
      showStatus('Could not save photo');
    });
  }

  libraryBtn.onclick = function() { fileInp.click(); };
  if (cameraBtn && cameraInp) {
    cameraBtn.onclick = function() { cameraInp.click(); };
    cameraInp.onchange = function() {
      var f = cameraInp.files && cameraInp.files[0];
      cameraInp.value = '';
      handlePhotoFile(f);
    };
  }
  fileInp.onchange = function() {
    var f = fileInp.files && fileInp.files[0];
    fileInp.value = '';
    handlePhotoFile(f);
  };
  if (removeBtn) {
    removeBtn.onclick = function() {
      var id = currentId() || entryId;
      if (!id) return;
      deleteEntryPhotoBlob(id).then(function() {
        invalidateListThumb(id);
        setPhotoFlag(id, false);
        refreshPreview();
        renderAllLists();
        showStatus('Photo removed');
      });
    };
  }
  refreshPreview();
}

function renderEditMode(entry) {
  editMode = true;
  var isNew = addingNew;
  var eid = entry.id || currentEntryId;
  document.getElementById('modal-edit').style.display = isNew ? 'none' : '';
  document.getElementById('modal-title').textContent = isNew ? 'Add to menu' : 'Edit';
  document.getElementById('modal-meta').textContent = '';

  var catOpts = getAllCategories().map(function(c) {
    return '<option value="' + escapeHtml(c.id) + '"' + (entry.category === c.id ? ' selected' : '') + '>' + escapeHtml(c.label) + '</option>';
  }).join('');

  var tagChips = getTags().map(function(t) {
    var on = editSelectedTags.indexOf(t.id) >= 0;
    return '<button type="button" class="detail-tag-chip edit-tag-pick' + (on ? ' on' : '') + '" data-edit-tag="' + escapeHtml(t.id) + '">' + escapeHtml(t.label) + '</button>';
  }).join('') || '<p class="hint">No tags — add in Manage</p>';

  var restaurantNames = getPastRestaurantNames().map(function(n) {
    return '<option value="' + escapeHtml(n) + '">';
  }).join('');
  var showRestaurant = isRestaurantCategory(entry.category);

  document.getElementById('modal-body').innerHTML = '<div class="edit-form">'
    + '<label for="edit-name">Name</label><input type="text" id="edit-name" placeholder="Meal or place name" value="' + escapeHtml(entry.name || '') + '">'
    + '<label for="edit-category">Category</label><select id="edit-category">' + catOpts + '</select>'
    + '<div id="edit-restaurant-wrap"' + (showRestaurant ? '' : ' hidden') + '>'
    + '<label for="edit-restaurant">Restaurant</label>'
    + '<input type="text" id="edit-restaurant" list="edit-restaurant-list" placeholder="Pick or type a name" value="' + escapeHtml(entry.restaurantName || '') + '">'
    + '<datalist id="edit-restaurant-list">' + restaurantNames + '</datalist>'
    + '</div>'
    + '<label for="edit-notes">Notes</label><textarea id="edit-notes">' + escapeHtml(entry.notes || '') + '</textarea>'
    + '<div class="entry-photo-edit"><label>Photo</label>'
    + '<div class="entry-photo-preview" id="entry-photo-preview"></div>'
    + '<div class="entry-photo-actions">'
    + '<button type="button" class="btn btn-secondary" id="entry-photo-library">Choose from Photos</button>'
    + '<button type="button" class="btn btn-secondary" id="entry-photo-camera">Take Photo</button>'
    + '<button type="button" class="btn btn-secondary" id="entry-photo-remove" hidden>Remove photo</button>'
    + '</div>'
    + '<input type="file" id="entry-photo-file" accept="image/*,.heic,.heif" hidden>'
    + '<input type="file" id="entry-photo-camera-file" accept="image/*" capture="environment" hidden>'
    + '<p class="entry-photo-hint">Saved on this device only — included in Export photos (ZIP).</p></div>'
    + '<label>Tags</label><div class="edit-tag-chips" id="edit-tag-chips">' + tagChips + '</div>'
    + '<label class="pick-fav"><input type="checkbox" id="edit-favorite"' + (entry.favorite ? ' checked' : '') + '> Favorite</label>'
    + '<div class="edit-actions">'
    + '<button type="button" class="btn btn-secondary" id="edit-cancel">Cancel</button>'
    + '<button type="button" class="btn btn-primary" id="edit-save">Save</button>'
    + '</div>'
    + (isNew ? '' : '<button type="button" class="btn btn-danger" id="edit-delete">Delete entry</button>')
    + '</div>';

  document.getElementById('modal-footer').innerHTML = '';
  document.getElementById('modal-footer').style.display = 'none';

  document.getElementById('edit-cancel').onclick = function() {
    if (isNew) closeModal();
    else renderViewMode(entry);
  };
  document.getElementById('edit-save').onclick = function() { saveEdit(entry); };
  if (!isNew) {
    document.getElementById('edit-delete').onclick = function() {
      if (!confirm('Delete “' + entry.name + '”?')) return;
      invalidateListThumb(entry.id);
      deleteEntryPhotoBlob(entry.id).finally(function() {
        var st = getState();
        st.entries = st.entries.filter(function(e) { return e.id !== entry.id; });
        if (st.entryPhotos) delete st.entryPhotos[entry.id];
        saveAppState(st);
        closeModal();
        renderAllLists();
        renderManage();
        showStatus('Deleted');
      });
    };
  }

  document.getElementById('edit-tag-chips').onclick = function(ev) {
    var chip = ev.target.closest('[data-edit-tag]');
    if (!chip) return;
    var tid = chip.getAttribute('data-edit-tag');
    var ix = editSelectedTags.indexOf(tid);
    if (ix >= 0) editSelectedTags.splice(ix, 1);
    else editSelectedTags.push(tid);
    chip.classList.toggle('on', editSelectedTags.indexOf(tid) >= 0);
  };

  document.getElementById('edit-category').onchange = function() {
    var wrap = document.getElementById('edit-restaurant-wrap');
    if (wrap) wrap.hidden = !isRestaurantCategory(this.value);
  };

  wirePhotoEdit(eid);
}

function saveEdit(original) {
  var isNew = addingNew;
  var name = document.getElementById('edit-name').value.trim();
  if (!name) { alert('Name is required.'); return; }

  var st = getState();
  var entry;
  if (isNew) {
    var tempPhotoId = original.id;
    var cat = document.getElementById('edit-category').value;
    entry = {
      id: newId('entry'),
      name: name,
      category: cat,
      notes: document.getElementById('edit-notes').value.trim(),
      restaurantName: isRestaurantCategory(cat) ? (document.getElementById('edit-restaurant').value || '').trim() : '',
      tagIds: editSelectedTags.slice(),
      favorite: document.getElementById('edit-favorite').checked,
      lastHad: '',
      createdAt: Date.now()
    };
    st.entries.push(entry);
    if (tempPhotoId && hasPhoto(tempPhotoId)) {
      getEntryPhotoBlob(tempPhotoId).then(function(blob) {
        if (!blob) return;
        return putEntryPhoto(entry.id, blob).then(function() {
          invalidateListThumb(entry.id);
          invalidateListThumb(tempPhotoId);
          setPhotoFlag(entry.id, true);
          return deleteEntryPhotoBlob(tempPhotoId);
        }).then(function() {
          var s = getState();
          if (s.entryPhotos) delete s.entryPhotos[tempPhotoId];
          saveAppState(s);
        });
      });
    }
  } else {
    entry = st.entries.find(function(e) { return e.id === original.id; });
    if (!entry) return;
    var cat = document.getElementById('edit-category').value;
    entry.name = name;
    entry.category = cat;
    entry.notes = document.getElementById('edit-notes').value.trim();
    entry.restaurantName = isRestaurantCategory(cat) ? (document.getElementById('edit-restaurant').value || '').trim() : '';
    entry.tagIds = editSelectedTags.slice();
    entry.favorite = document.getElementById('edit-favorite').checked;
    saveAppState(st);
  }
  saveAppState(st);
  addingNew = false;
  currentEntryId = entry.id;
  renderAllLists();
  renderManage();
  renderViewMode(entry);
  showStatus(isNew ? 'Added ' + name : 'Saved');
}

function openEntry(id) {
  var entry = getEntryById(id);
  if (!entry) return;
  currentEntryId = id;
  renderViewMode(entry);
  openModal();
}

function openAddEntry() {
  var cat = activeRootTab === 'menu' && menuView === 'category' ? activeCategory : 'cooking';
  addingNew = true;
  editMode = true;
  editSelectedTags = [];
  var tempId = newId('entry');
  currentEntryId = tempId;
  renderEditMode({
    id: tempId,
    name: '',
    category: cat,
    notes: '',
    restaurantName: '',
    tagIds: [],
    favorite: false,
    lastHad: ''
  });
  openModal();
}

function renderManage() {
  var manageList = document.getElementById('tag-manage-list');
  var tags = getTags();
  if (manageList) {
    manageList.innerHTML = !tags.length
      ? '<p class="hint" style="margin:0">No tags yet.</p>'
      : tags.map(function(tag) {
          var count = countEntriesWithTag(tag.id);
          return '<div class="tag-manage-row"><span class="tag-manage-label">' + escapeHtml(tag.label) + '</span>'
            + '<span class="tag-manage-count">' + count + ' meal' + (count === 1 ? '' : 's') + '</span>'
            + '<button type="button" class="tag-del-btn" data-tag-del="' + escapeHtml(tag.id) + '">Delete</button></div>';
        }).join('');
  }

  var cats = getState().categories;
  var builtinList = document.getElementById('builtin-cat-list');
  var customList = document.getElementById('custom-cat-list');
  if (builtinList) {
    builtinList.innerHTML = cats.filter(function(c) { return c.builtin; }).map(function(c) {
      return '<li class="builtin">' + escapeHtml(c.label) + '</li>';
    }).join('');
  }
  if (customList) {
    var custom = cats.filter(function(c) { return !c.builtin; });
    customList.innerHTML = !custom.length
      ? '<li class="hint" style="border:none">No custom categories</li>'
      : custom.map(function(c) {
          var count = getState().entries.filter(function(e) { return e.category === c.id; }).length;
          return '<li><span>' + escapeHtml(c.label) + ' <span class="hint">(' + count + ')</span></span>'
            + '<button type="button" class="cat-del-btn" data-cat-del="' + escapeHtml(c.id) + '">Delete</button></li>';
        }).join('');
  }
}

function addCustomCategory(label) {
  var name = (label || '').trim();
  if (!name) return;
  var st = getState();
  if (st.categories.filter(function(c) { return !c.builtin; }).length >= MAX_CUSTOM_CATS) {
    showStatus('Max ' + MAX_CUSTOM_CATS + ' custom categories');
    return;
  }
  var id = 'cat-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!id || id === 'cat-') id = newId('cat');
  if (st.categories.some(function(c) { return c.id === id; })) id = newId('cat');
  st.categories.push({ id: id, label: name, builtin: false });
  saveAppState(st);
  ensureCategoryPanels();
  renderCategoryGrid();
  renderCategoryTabs();
  renderManage();
  showStatus('Category added');
}

function deleteCustomCategory(id) {
  var st = getState();
  var c = st.categories.find(function(x) { return x.id === id && !x.builtin; });
  if (!c) return;
  var n = st.entries.filter(function(e) { return e.category === id; }).length;
  if (n && !confirm('Delete category “' + c.label + '”? ' + n + ' meal(s) will move to Cooking.')) return;
  st.entries.forEach(function(e) { if (e.category === id) e.category = 'cooking'; });
  st.categories = st.categories.filter(function(x) { return x.id !== id; });
  saveAppState(st);
  if (activeCategory === id) switchCategory('cooking');
  var oldPanel = document.getElementById('cat-panel-' + id);
  if (oldPanel) oldPanel.remove();
  renderCategoryTabs();
  renderAllLists();
  renderManage();
}

/* ——— Picker ——— */
function populatePickCategorySelect() {
  var sel = document.getElementById('pick-category');
  if (!sel) return;
  var cur = sel.value;
  sel.innerHTML = '<option value="">All categories</option>';
  getAllCategories().forEach(function(c) {
    var opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.label;
    sel.appendChild(opt);
  });
  if (cur) sel.value = cur;
  else if (activeRootTab === 'menu') sel.value = activeCategory;
}

function getPickerPool() {
  var list = getState().entries.slice();
  var catSel = document.getElementById('pick-category');
  if (catSel && catSel.value) list = list.filter(function(e) { return e.category === catSel.value; });
  if (document.getElementById('pick-favorites-only').checked) {
    list = list.filter(function(e) { return e.favorite; });
  }
  if (pickerSelectedTags.length) {
    list = list.filter(function(e) {
      return pickerSelectedTags.some(function(id) {
        return Array.isArray(e.tagIds) && e.tagIds.indexOf(id) >= 0;
      });
    });
  }
  return list.sort(function(a, b) { return a.name.localeCompare(b.name); });
}

function buildPickerWheelGradient(n) {
  if (n <= 0) return 'var(--paper-line)';
  var angle = 360 / n;
  var stops = [];
  for (var i = 0; i < n; i++) {
    var c = PICKER_COLORS[i % PICKER_COLORS.length];
    stops.push(c + ' ' + (i * angle) + 'deg ' + ((i + 1) * angle) + 'deg');
  }
  return 'conic-gradient(from -90deg, ' + stops.join(', ') + ')';
}

function renderPickTags() {
  var el = document.getElementById('pick-tag-chips');
  if (!el) return;
  var tags = getTags();
  el.innerHTML = !tags.length
    ? '<p class="hint" style="margin:0">No tags yet</p>'
    : tags.map(function(tag) {
        var on = pickerSelectedTags.indexOf(tag.id) >= 0;
        return '<button type="button" class="picker-tag-chip' + (on ? ' on' : '') + '" data-picker-tag="' + escapeHtml(tag.id) + '">' + escapeHtml(tag.label) + '</button>';
      }).join('');
}

function refreshPicker() {
  pickerPool = getPickerPool();
  var n = pickerPool.length;
  var wheel = document.getElementById('picker-wheel');
  var center = document.getElementById('picker-wheel-center');
  var empty = document.getElementById('picker-empty');
  var spinBtn = document.getElementById('picker-spin-btn');
  if (wheel) {
    wheel.style.background = buildPickerWheelGradient(n);
    wheel.style.transform = 'rotate(' + pickerRotation + 'deg)';
  }
  if (center) center.textContent = n ? String(n) + '\nmeal' + (n === 1 ? '' : 's') : '—';
  if (empty) empty.hidden = n > 0;
  if (spinBtn) spinBtn.disabled = n === 0 || pickerSpinning;
}

function resetPickResult() {
  pickerWinnerId = '';
  var result = document.getElementById('pick-result');
  var panel = document.getElementById('panel-spin');
  if (result) result.hidden = true;
  if (panel) panel.classList.remove('pick-showing-result');
}

function showPickResult(id) {
  var entry = getEntryById(id);
  if (!entry) return;
  pickerWinnerId = id;
  document.getElementById('pick-result-name').textContent = entry.name;
  var notes = entry.notes || categoryLabel(entry.category);
  if (isRestaurantCategory(entry.category) && entry.restaurantName) {
    notes = entry.restaurantName + (notes ? ' — ' + notes : '');
  }
  document.getElementById('pick-result-notes').textContent = notes;
  document.getElementById('pick-result-links').innerHTML = '';
  var photoEl = document.getElementById('pick-result-photo');
  if (photoEl) {
    photoEl.innerHTML = '';
    photoEl.hidden = true;
    if (hasPhoto(entry.id)) {
      getListThumbUrl(entry.id).then(function(url) {
        if (!url) return;
        photoEl.innerHTML = '<img src="' + url + '" alt="">';
        photoEl.hidden = false;
      });
    }
  }
  document.getElementById('pick-result').hidden = false;
  document.getElementById('panel-spin').classList.add('pick-showing-result');
}

function spinPicker() {
  if (pickerSpinning) return;
  pickerPool = getPickerPool();
  if (!pickerPool.length) return;
  resetPickResult();
  var n = pickerPool.length;
  var winnerIndex = Math.floor(Math.random() * n);
  var segmentAngle = 360 / n;
  var spinTurns = 5 + Math.floor(Math.random() * 4);
  var currentMod = ((pickerRotation % 360) + 360) % 360;
  var targetOffset = 360 - (winnerIndex * segmentAngle + segmentAngle / 2);
  var delta = spinTurns * 360 + targetOffset - currentMod;
  if (delta < spinTurns * 360) delta += 360;
  pickerRotation += delta;
  pickerSpinning = true;
  var wheel = document.getElementById('picker-wheel');
  var spinBtn = document.getElementById('picker-spin-btn');
  if (spinBtn) spinBtn.disabled = true;
  if (wheel) {
    wheel.classList.add('spinning');
    wheel.style.transform = 'rotate(' + pickerRotation + 'deg)';
  }
  var winnerId = pickerPool[winnerIndex].id;
  setTimeout(function() {
    pickerSpinning = false;
    if (wheel) wheel.classList.remove('spinning');
    if (spinBtn) spinBtn.disabled = false;
    showPickResult(winnerId);
  }, 4300);
}

/* ——— Ate tab / meal log ——— */
function sourceLabel(source) {
  if (source === 'take-out') return 'Take out';
  if (source === 'eat-out') return 'Eat out';
  return 'Menu';
}

function filterEntriesForLog() {
  var list = getState().entries.slice();
  if (ateMenuCategory && ateMenuCategory !== 'all') {
    list = list.filter(function(e) { return e.category === ateMenuCategory; });
  }
  if (ateSelectedTags.length) {
    list = list.filter(function(e) {
      if (!e.tagIds || !e.tagIds.length) return false;
      return ateSelectedTags.every(function(tid) { return e.tagIds.indexOf(tid) >= 0; });
    });
  }
  var favOnly = document.getElementById('ate-favorites-only');
  if (favOnly && favOnly.checked) list = list.filter(function(e) { return e.favorite; });
  list.sort(function(a, b) { return a.name.localeCompare(b.name); });
  return list;
}

function populateAteCategorySelect() {
  var sel = document.getElementById('ate-menu-category');
  if (!sel) return;
  var html = '<option value="all">All categories</option>';
  getAllCategories().forEach(function(c) {
    html += '<option value="' + escapeHtml(c.id) + '"' + (ateMenuCategory === c.id ? ' selected' : '') + '>'
      + escapeHtml(c.label) + '</option>';
  });
  sel.innerHTML = html;
}

function renderAteTags() {
  var el = document.getElementById('ate-tag-chips');
  if (!el) return;
  var tags = getTags();
  if (!tags.length) {
    el.innerHTML = '<p class="hint" style="margin:0">No tags yet.</p>';
    return;
  }
  el.innerHTML = tags.map(function(t) {
    var on = ateSelectedTags.indexOf(t.id) >= 0;
    return '<button type="button" class="picker-tag-chip' + (on ? ' on' : '') + '" data-ate-tag="' + escapeHtml(t.id) + '">'
      + escapeHtml(t.label) + '</button>';
  }).join('');
}

function populateAteMealSelect() {
  var sel = document.getElementById('ate-meal-select');
  if (!sel) return;
  var list = filterEntriesForLog();
  if (!list.length) {
    sel.innerHTML = '<option value="">No meals match filters</option>';
    return;
  }
  sel.innerHTML = list.map(function(e) {
    var label = e.name;
    if (isRestaurantCategory(e.category) && e.restaurantName) label += ' (' + e.restaurantName + ')';
    return '<option value="' + escapeHtml(e.id) + '">' + escapeHtml(label) + '</option>';
  }).join('');
}

function populateAteRestaurantList() {
  var dl = document.getElementById('ate-restaurant-list');
  if (!dl) return;
  dl.innerHTML = getPastRestaurantNames().map(function(n) {
    return '<option value="' + escapeHtml(n) + '">';
  }).join('');
}

function setAteLogMode(mode) {
  ateLogMode = mode;
  document.querySelectorAll('#ate-segments .ate-seg').forEach(function(btn) {
    btn.classList.toggle('on', btn.getAttribute('data-ate-mode') === mode);
  });
  var menuForm = document.getElementById('ate-form-menu');
  var restForm = document.getElementById('ate-form-restaurant');
  if (menuForm) menuForm.hidden = mode !== 'menu';
  if (restForm) restForm.hidden = mode === 'menu';
}

function mealLogDisplayText(log) {
  if (log.source === 'menu') {
    var entry = getEntryById(log.entryId);
    var name = entry ? entry.name : 'Unknown meal';
    if (log.description) return name + ' — ' + log.description;
    return name;
  }
  var rest = log.restaurantName || 'Unknown place';
  return rest + ' — ' + (log.description || '');
}

function renderMealLogList() {
  var el = document.getElementById('meal-log-list');
  if (!el) return;
  var logs = (getState().mealLog || []).slice().sort(function(a, b) {
    var da = a.date || '';
    var db = b.date || '';
    if (da !== db) return db.localeCompare(da);
    return (b.createdAt || 0) - (a.createdAt || 0);
  });
  if (!logs.length) {
    el.innerHTML = '<p class="hint empty-state" style="margin:0">Nothing logged yet.</p>';
    return;
  }
  el.innerHTML = logs.map(function(log) {
    return '<div class="meal-log-row">'
      + '<div class="meal-log-main">'
      + '<span class="meal-log-date">' + escapeHtml(log.date || '') + '</span>'
      + '<span class="meal-log-badge">' + escapeHtml(sourceLabel(log.source)) + '</span>'
      + '<p class="meal-log-text">' + escapeHtml(mealLogDisplayText(log)) + '</p>'
      + '</div>'
      + '<button type="button" class="meal-log-del" data-log-del="' + escapeHtml(log.id) + '" aria-label="Delete log entry">&times;</button>'
      + '</div>';
  }).join('');
}

function renderAtePanel() {
  var dateInp = document.getElementById('ate-date');
  if (dateInp && !dateInp.value) dateInp.value = todayIso();
  setAteLogMode(ateLogMode);
  populateAteCategorySelect();
  renderAteTags();
  populateAteMealSelect();
  populateAteRestaurantList();
  renderMealLogList();
}

function appendMealLog(record) {
  var st = getState();
  var log = {
    id: newId('log'),
    date: record.date || todayIso(),
    source: record.source,
    entryId: record.entryId || '',
    restaurantName: record.restaurantName || '',
    description: record.description || '',
    createdAt: Date.now()
  };
  st.mealLog.push(log);
  if (record.source === 'menu' && record.entryId) {
    var entry = st.entries.find(function(e) { return e.id === record.entryId; });
    if (entry) entry.lastHad = log.date;
  }
  saveAppState(st);
  renderMealLogList();
  renderAllLists();
  return log;
}

function submitAteLog() {
  var date = (document.getElementById('ate-date').value || '').trim() || todayIso();
  if (ateLogMode === 'menu') {
    var entryId = document.getElementById('ate-meal-select').value;
    if (!entryId) { alert('Pick a meal to log.'); return; }
    var notes = (document.getElementById('ate-menu-notes').value || '').trim();
    appendMealLog({ date: date, source: 'menu', entryId: entryId, description: notes });
    document.getElementById('ate-menu-notes').value = '';
    showStatus('Logged');
    return;
  }
  var restaurant = (document.getElementById('ate-restaurant').value || '').trim();
  var order = (document.getElementById('ate-order').value || '').trim();
  if (!restaurant) { alert('Pick or enter a restaurant.'); return; }
  if (!order) { alert('What did you order?'); return; }
  var restNotes = (document.getElementById('ate-rest-notes').value || '').trim();
  var desc = restNotes ? order + ' — ' + restNotes : order;
  appendMealLog({
    date: date,
    source: ateLogMode,
    restaurantName: restaurant,
    description: desc
  });
  document.getElementById('ate-order').value = '';
  document.getElementById('ate-rest-notes').value = '';
  populateAteRestaurantList();
  showStatus('Logged');
}

function deleteMealLog(id) {
  if (!confirm('Delete this log entry?')) return;
  var st = getState();
  st.mealLog = (st.mealLog || []).filter(function(l) { return l.id !== id; });
  saveAppState(st);
  renderMealLogList();
  showStatus('Log entry removed');
}

/* ——— ZIP photo export (Aruba-style) ——— */
function sanitizeZipSegment(s) {
  return String(s || 'item').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80);
}

function blobExtension(blob) {
  var t = (blob && blob.type) || '';
  if (t.indexOf('png') >= 0) return 'png';
  if (t.indexOf('webp') >= 0) return 'webp';
  if (t.indexOf('gif') >= 0) return 'gif';
  return 'jpg';
}

function blobToUint8Array(blob) {
  return new Promise(function(resolve, reject) {
    var r = new FileReader();
    r.onload = function() { resolve(new Uint8Array(r.result)); };
    r.onerror = reject;
    r.readAsArrayBuffer(blob);
  });
}

function entryExportMeta(entry) {
  var tagIds = Array.isArray(entry.tagIds) ? entry.tagIds.slice() : [];
  return {
    entryId: entry.id,
    name: entry.name,
    category: entry.category,
    categoryLabel: categoryLabel(entry.category),
    notes: entry.notes || '',
    restaurantName: entry.restaurantName || '',
    tagIds: tagIds,
    tagLabels: tagIds.map(function(id) { return tagLabel(id); }).filter(Boolean),
    favorite: !!entry.favorite,
    lastHad: entry.lastHad || ''
  };
}

function crc32(bytes) {
  var crc = 0xffffffff;
  for (var i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (var j = 0; j < 8; j++) {
      var mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildStoreZip(entries) {
  var chunks = [];
  var central = [];
  var offset = 0;
  entries.forEach(function(entry) {
    var nameBytes = new TextEncoder().encode(entry.name);
    var data = entry.data;
    var size = data.length;
    var checksum = crc32(data);
    var local = new Uint8Array(30 + nameBytes.length);
    var lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint32(14, checksum, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    chunks.push(local, data);
    var centralHeader = new Uint8Array(46 + nameBytes.length);
    var cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint32(16, checksum, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);
    central.push(centralHeader);
    offset += local.length + data.length;
  });
  var centralSize = central.reduce(function(sum, part) { return sum + part.length; }, 0);
  var end = new Uint8Array(22);
  var ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  return new Blob(chunks.concat(central, [end]), { type: 'application/zip' });
}

function findZipEocd(bytes) {
  for (var i = bytes.length - 22; i >= 0; i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) return i;
  }
  return -1;
}

function parseStoreZip(buffer) {
  var bytes = new Uint8Array(buffer);
  var eocd = findZipEocd(bytes);
  if (eocd < 0) throw new Error('Invalid zip');
  var view = new DataView(buffer);
  var centralOffset = view.getUint32(eocd + 16, true);
  var totalEntries = view.getUint16(eocd + 10, true);
  var entries = [];
  var offset = centralOffset;
  for (var i = 0; i < totalEntries; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    var compMethod = view.getUint16(offset + 10, true);
    var uncompSize = view.getUint32(offset + 24, true);
    var nameLen = view.getUint16(offset + 28, true);
    var extraLen = view.getUint16(offset + 30, true);
    var commentLen = view.getUint16(offset + 32, true);
    var localOffset = view.getUint32(offset + 42, true);
    var name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLen)).replace(/\\/g, '/');
    offset += 46 + nameLen + extraLen + commentLen;
    if (compMethod !== 0) continue;
    var localNameLen = view.getUint16(localOffset + 26, true);
    var localExtraLen = view.getUint16(localOffset + 28, true);
    var dataStart = localOffset + 30 + localNameLen + localExtraLen;
    entries.push({ name: name, data: bytes.subarray(dataStart, dataStart + uncompSize) });
  }
  return entries;
}

function mimeFromPath(path) {
  var lower = String(path || '').toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}

function downloadBlob(blob, filename) {
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportPhotosZip() {
  var btn = document.getElementById('export-photos-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Zipping…'; }
  var st = getState();
  var photoEntries = (st.entries || []).filter(function(e) { return hasPhoto(e.id); });
  if (!photoEntries.length) {
    showStatus('No photos on this device');
    if (btn) { btn.disabled = false; btn.textContent = 'Export photos (ZIP)'; }
    return Promise.resolve();
  }
  var usedNames = {};
  var manifestPhotos = [];
  var tasks = photoEntries.map(function(entry) {
    return getEntryPhotoBlob(entry.id).then(function(blob) {
      if (!blob) return null;
      var ext = blobExtension(blob);
      var basePath = 'entries/' + sanitizeZipSegment(entry.id);
      var fileName = basePath + '.' + ext;
      if (usedNames[fileName]) {
        usedNames[fileName] += 1;
        fileName = basePath + '-' + usedNames[fileName] + '.' + ext;
      } else {
        usedNames[fileName] = 1;
      }
      manifestPhotos.push(Object.assign({ path: fileName }, entryExportMeta(entry)));
      return blobToUint8Array(blob).then(function(bytes) {
        return { name: fileName, data: bytes };
      });
    });
  });
  return Promise.all(tasks).then(function(results) {
    var zipEntries = results.filter(Boolean);
    if (!zipEntries.length) {
      showStatus('No photos to export');
      return null;
    }
    var menuSnapshot = normalizeState(JSON.parse(JSON.stringify(st)));
    zipEntries.unshift({
      name: 'manifest.json',
      data: new TextEncoder().encode(JSON.stringify({
        format: 'meal-menu-photos',
        version: 1,
        exportedAt: new Date().toISOString(),
        photoCount: manifestPhotos.length,
        menu: {
          version: menuSnapshot.version,
          categories: menuSnapshot.categories,
          tags: menuSnapshot.tags,
          entries: menuSnapshot.entries
        },
        photos: manifestPhotos
      }, null, 2))
    });
    return buildStoreZip(zipEntries);
  }).then(function(zipBlob) {
    if (!zipBlob) return;
    var stamp = new Date().toISOString().slice(0, 10);
    downloadBlob(zipBlob, 'meal-menu-photos-' + stamp + '.zip');
    showStatus('Photo backup downloaded');
  }).catch(function() {
    showStatus('Could not export photos');
  }).finally(function() {
    if (btn) { btn.disabled = false; btn.textContent = 'Export photos (ZIP)'; }
  });
}

function ensureTagByLabel(label) {
  if (!label) return null;
  var st = getState();
  var found = st.tags.find(function(t) { return t.label.toLowerCase() === String(label).toLowerCase(); });
  if (found) return found.id;
  if (st.tags.length >= MAX_TAGS) return null;
  var id = newId('tag');
  st.tags.push({ id: id, label: String(label).trim() });
  saveAppState(st);
  return id;
}

function mergeEntryFromPhotoMeta(photo) {
  var st = getState();
  var entry = st.entries.find(function(e) { return e.id === photo.entryId; });
  if (!entry) {
    entry = {
      id: photo.entryId || newId('entry'),
      name: photo.name || 'Imported meal',
      category: photo.category || 'cooking',
      notes: photo.notes || '',
      restaurantName: photo.restaurantName || photo.phillyPlaceName || '',
      tagIds: [],
      favorite: !!photo.favorite,
      lastHad: photo.lastHad || '',
      createdAt: Date.now()
    };
    st.entries.push(entry);
  } else {
    if (photo.name) entry.name = photo.name;
    if (photo.category) entry.category = photo.category;
    if (photo.notes != null) entry.notes = photo.notes;
    if (photo.restaurantName != null) entry.restaurantName = photo.restaurantName;
    else if (photo.phillyPlaceName != null) entry.restaurantName = photo.phillyPlaceName;
    if (photo.favorite != null) entry.favorite = !!photo.favorite;
    if (photo.lastHad != null) entry.lastHad = photo.lastHad;
  }
  var tagIds = [];
  if (Array.isArray(photo.tagIds)) {
    photo.tagIds.forEach(function(tid) {
      if (st.tags.some(function(t) { return t.id === tid; })) tagIds.push(tid);
    });
  }
  if (Array.isArray(photo.tagLabels)) {
    photo.tagLabels.forEach(function(lbl) {
      var id = ensureTagByLabel(lbl);
      if (id && tagIds.indexOf(id) < 0) tagIds.push(id);
    });
  }
  if (tagIds.length) entry.tagIds = tagIds;
  saveAppState(st);
  return entry.id;
}

function importPhotosZip(file) {
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function() {
    try {
      var zipEntries = parseStoreZip(reader.result);
      var byName = {};
      zipEntries.forEach(function(z) { byName[z.name] = z; });
      var manifestEntry = zipEntries.find(function(z) { return z.name === 'manifest.json'; });
      if (!manifestEntry) {
        showStatus('Invalid backup — manifest.json missing');
        return;
      }
      var manifest = JSON.parse(new TextDecoder().decode(manifestEntry.data));
      if (manifest.format !== 'meal-menu-photos') {
        showStatus('Not a Meal Menu photo backup');
        return;
      }
      if (manifest.menu && manifest.menu.entries) {
        var st = normalizeState(manifest.menu);
        var existing = getState();
        st.entryPhotos = existing.entryPhotos || {};
        saveAppState(st);
      }
      var photos = Array.isArray(manifest.photos) ? manifest.photos : [];
      if (!photos.length) {
        showStatus('No photos in file');
        return;
      }
      var imported = 0;
      var chain = Promise.resolve();
      photos.forEach(function(photo) {
        chain = chain.then(function() {
          var ze = byName[photo.path];
          if (!ze) return;
          var entryId = mergeEntryFromPhotoMeta(photo);
          var blob = new Blob([ze.data], { type: mimeFromPath(photo.path) });
          return putEntryPhoto(entryId, blob).then(function() {
            invalidateListThumb(entryId);
            setPhotoFlag(entryId, true);
            imported++;
          });
        });
      });
      chain.then(function() {
        ensureCategoryPanels();
        renderCategoryTabs();
        renderTagFilters();
        renderAllLists();
        renderManage();
        renderPickTags();
        showStatus('Imported ' + imported + ' photo' + (imported === 1 ? '' : 's'));
      }).catch(function() {
        showStatus('Import failed');
      });
    } catch (e) {
      showStatus('Could not read ZIP');
    }
  };
  reader.readAsArrayBuffer(file);
}

function exportData() {
  var st = getState();
  var blob = new Blob([JSON.stringify(st, null, 2)], { type: 'application/json' });
  downloadBlob(blob, 'meal-menu-backup-' + new Date().toISOString().slice(0, 10) + '.json');
  showStatus('Exported');
}

function importData(file) {
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function() {
    try {
      var parsed = JSON.parse(reader.result);
      var slice = parsed;
      if (typeof AppsBackup !== 'undefined' && AppsBackup.isUnifiedBackup(parsed)) {
        slice = AppsBackup.getAppSlice(parsed, 'meal-menu');
        if (!slice) { showStatus('No Meal Menu data in this file'); return; }
      }
      if (!slice || !Array.isArray(slice.entries)) { showStatus('Invalid backup file'); return; }
      var existing = normalizeState(getState());
      var entryIds = {};
      existing.entries.forEach(function (e) { entryIds[e.id] = true; });
      var added = 0;
      slice.entries.forEach(function (e) {
        if (e && e.id && !entryIds[e.id]) {
          existing.entries.push(e);
          entryIds[e.id] = true;
          added++;
        }
      });
      (slice.tags || []).forEach(function (t) {
        if (t && t.id && !existing.tags.some(function (x) { return x.id === t.id; })) existing.tags.push(t);
      });
      existing.entryPhotos = Object.assign({}, existing.entryPhotos || {}, slice.entryPhotos || {});
      saveAppState(existing);
      ensureCategoryPanels();
      renderCategoryTabs();
      renderTagFilters();
      renderAllLists();
      renderManage();
      populatePickCategorySelect();
      renderPickTags();
      renderAtePanel();
      showStatus('Added ' + added + ' meal' + (added === 1 ? '' : 's'));
    } catch (e) {
      showStatus('Could not read file');
    }
  };
  reader.readAsText(file);
}

function bindEvents() {
  document.getElementById('tag-filters').addEventListener('click', function(e) {
    var chip = e.target.closest('[data-tag-filter]');
    if (chip) setTagFilter(chip.getAttribute('data-tag-filter'));
  });
  document.getElementById('search').addEventListener('input', renderAllLists);
  document.getElementById('add-btn').addEventListener('click', openAddEntry);
  var landingAdd = document.getElementById('landing-add-btn');
  if (landingAdd) landingAdd.addEventListener('click', openAddEntry);
  var menuBack = document.getElementById('menu-back-btn');
  if (menuBack) menuBack.addEventListener('click', showMenuLanding);

  document.getElementById('tabbar').addEventListener('click', function(e) {
    var tab = e.target.closest('[data-tab]');
    if (tab) switchRootTab(tab.getAttribute('data-tab'));
  });

  document.getElementById('category-tabs').addEventListener('click', function(e) {
    var tab = e.target.closest('[data-category]');
    if (tab) enterMenuCategory(tab.getAttribute('data-category'));
  });

  var categoryGrid = document.getElementById('category-grid');
  if (categoryGrid) {
    categoryGrid.addEventListener('click', function(e) {
      var tile = e.target.closest('[data-cat-nav]');
      if (tile) enterMenuCategory(tile.getAttribute('data-cat-nav'));
    });
  }

  document.getElementById('category-panels').addEventListener('click', function(e) {
    var item = e.target.closest('[data-entry-id]');
    if (item) openEntry(item.getAttribute('data-entry-id'));
  });

  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal').addEventListener('click', function(e) {
    if (e.target.id === 'modal') closeModal();
  });
  document.getElementById('modal-edit').addEventListener('click', function() {
    var entry = getEntryById(currentEntryId);
    if (!entry) return;
    if (editMode) renderViewMode(entry);
    else {
      editSelectedTags = (entry.tagIds || []).slice();
      renderEditMode(entry);
    }
  });
  document.getElementById('modal-fav').addEventListener('click', function() {
    var entry = getEntryById(currentEntryId);
    if (entry) toggleFavorite(entry);
  });

  document.getElementById('add-tag-btn').addEventListener('click', function() {
    var inp = document.getElementById('new-tag-name');
    if (addTag(inp.value)) inp.value = '';
  });
  document.getElementById('new-tag-name').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') document.getElementById('add-tag-btn').click();
  });
  document.getElementById('tag-manage-list').addEventListener('click', function(e) {
    var btn = e.target.closest('[data-tag-del]');
    if (btn) deleteTag(btn.getAttribute('data-tag-del'));
  });
  document.getElementById('add-cat-btn').addEventListener('click', function() {
    addCustomCategory(document.getElementById('new-cat-name').value);
    document.getElementById('new-cat-name').value = '';
  });
  document.getElementById('custom-cat-list').addEventListener('click', function(e) {
    var btn = e.target.closest('[data-cat-del]');
    if (btn) deleteCustomCategory(btn.getAttribute('data-cat-del'));
  });

  document.getElementById('export-btn').addEventListener('click', exportData);
  document.getElementById('import-file').addEventListener('change', function() {
    var f = this.files && this.files[0];
    this.value = '';
    importData(f);
  });
  document.getElementById('export-photos-btn').addEventListener('click', exportPhotosZip);
  document.getElementById('import-photos-file').addEventListener('change', function() {
    var f = this.files && this.files[0];
    this.value = '';
    importPhotosZip(f);
  });
  document.getElementById('clear-photos-btn').addEventListener('click', clearPhotosFromDevice);

  document.getElementById('pick-category').addEventListener('change', function() {
    if (!pickerSpinning) { resetPickResult(); refreshPicker(); }
  });
  document.getElementById('pick-favorites-only').addEventListener('change', function() {
    if (!pickerSpinning) { resetPickResult(); refreshPicker(); }
  });
  document.getElementById('pick-tag-chips').addEventListener('click', function(e) {
    if (pickerSpinning) return;
    var chip = e.target.closest('[data-picker-tag]');
    if (!chip) return;
    var id = chip.getAttribute('data-picker-tag');
    var i = pickerSelectedTags.indexOf(id);
    if (i >= 0) pickerSelectedTags.splice(i, 1);
    else pickerSelectedTags.push(id);
    chip.classList.toggle('on', pickerSelectedTags.indexOf(id) >= 0);
    resetPickResult();
    refreshPicker();
  });
  document.getElementById('picker-spin-btn').addEventListener('click', spinPicker);
  document.getElementById('picker-spin-again').addEventListener('click', function() {
    resetPickResult();
    refreshPicker();
    spinPicker();
  });
  document.getElementById('pick-view-details').addEventListener('click', function() {
    if (pickerWinnerId) openEntry(pickerWinnerId);
  });

  document.getElementById('ate-segments').addEventListener('click', function(e) {
    var btn = e.target.closest('[data-ate-mode]');
    if (!btn) return;
    setAteLogMode(btn.getAttribute('data-ate-mode'));
  });
  document.getElementById('ate-log-btn').addEventListener('click', submitAteLog);
  document.getElementById('ate-menu-category').addEventListener('change', function() {
    ateMenuCategory = this.value;
    populateAteMealSelect();
  });
  document.getElementById('ate-favorites-only').addEventListener('change', populateAteMealSelect);
  document.getElementById('ate-tag-chips').addEventListener('click', function(e) {
    var chip = e.target.closest('[data-ate-tag]');
    if (!chip) return;
    var id = chip.getAttribute('data-ate-tag');
    var i = ateSelectedTags.indexOf(id);
    if (i >= 0) ateSelectedTags.splice(i, 1);
    else ateSelectedTags.push(id);
    chip.classList.toggle('on', ateSelectedTags.indexOf(id) >= 0);
    populateAteMealSelect();
  });
  document.getElementById('meal-log-list').addEventListener('click', function(e) {
    var btn = e.target.closest('[data-log-del]');
    if (btn) deleteMealLog(btn.getAttribute('data-log-del'));
  });
}

function boot() {
  initState();
  reconcileEntryPhotosFromIdb().finally(function() {
  ensureCategoryPanels();
  renderCategoryGrid();
  renderCategoryTabs();
  renderTagFilters();
  renderAllLists();
  renderManage();
  populatePickCategorySelect();
  renderPickTags();
  refreshPicker();
  bindEvents();
  updateMenuView();

  document.querySelectorAll('.panel').forEach(function(p) {
    p.hidden = true;
    p.classList.remove('on');
  });
  document.querySelectorAll('.cat-panel').forEach(function(p) {
    p.hidden = true;
    p.classList.remove('on');
  });

  activeRootTab = '';
  switchRootTab('spin');
  });
}

document.addEventListener('visibilitychange', function() {
  if (document.visibilityState === 'visible') reconcileEntryPhotosFromIdb().then(renderAllLists);
});
window.addEventListener('pageshow', function() {
  reconcileEntryPhotosFromIdb().then(renderAllLists);
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

})();
