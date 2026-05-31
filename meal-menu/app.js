(function() {
'use strict';

var STORAGE_KEY = 'meal-menu-v1';
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

var TAB_META = {
  pick: { label: 'Pick', icon: '🎲', sub: 'Spin to decide' },
  manage: { label: 'Manage', icon: '⚙️', sub: 'Tags & backup' }
};

var TAB_ICONS = {
  'take-out': '🥡',
  'eat-out': '🍽',
  cooking: '👩‍🍳',
  frozen: '🧊',
  drinks: '🍷',
  groceries: '🛒'
};

var SEED_ENTRIES = [
  { name: 'Frozen dumplings', category: 'frozen', notes: 'Costco or HMart — quick weeknight', favorite: true },
  { name: 'Sheet-pan salmon', category: 'cooking', notes: 'Broccoli + lemon, 25 min', favorite: false },
  { name: 'Pizza takeout', category: 'take-out', notes: 'Local spot or DoorDash', favorite: false },
  { name: 'Date night out', category: 'eat-out', notes: 'Pick from Philly Dates when ready', favorite: true },
  { name: 'Smoothie night', category: 'drinks', notes: 'Frozen fruit + yogurt', favorite: false },
  { name: 'Weekly grocery run', category: 'groceries', notes: 'Trader Joe\'s / Acme', favorite: false }
];

var activeTab = 'cooking';
var currentEntryId = '';
var editMode = false;
var addingNew = false;
var editSelectedTags = [];
var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

var pickerSelectedTags = [];
var pickerPool = [];
var pickerRotation = 0;
var pickerSpinning = false;
var pickerWinnerId = '';
var PICKER_COLORS = ['#8b3a3a', '#6e3a8b', '#3a6e8b', '#3a8b5c', '#8b6e3a', '#8b3a6e', '#5c6e8b', '#8b5c3a'];

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
    version: 1,
    categories: BUILTIN_CATEGORIES.map(function(c) {
      return { id: c.id, label: c.label, builtin: true };
    }),
    tags: [],
    tagFilter: 'all',
    entries: []
  };
}

function normalizeState(st) {
  if (!st || typeof st !== 'object') st = defaultState();
  if (!Array.isArray(st.categories)) st.categories = defaultState().categories;
  if (!Array.isArray(st.tags)) st.tags = [];
  if (!Array.isArray(st.entries)) st.entries = [];
  if (!st.tagFilter) st.tagFilter = 'all';
  st.version = 1;
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
        menuUrl: '',
        orderUrl: '',
        tagIds: [],
        favorite: !!s.favorite,
        lastHad: '',
        createdAt: Date.now(),
        phillyPlaceName: null
      });
    });
    saveAppState(st);
  }
  return normalizeState(st);
}

function getState() {
  return normalizeState(loadAppState() || defaultState());
}

function getAllCategories() {
  var st = getState();
  return st.categories.filter(function(c) { return c.id !== 'pick' && c.id !== 'manage'; });
}

function categoryLabel(id) {
  var c = getAllCategories().find(function(x) { return x.id === id; });
  return c ? c.label : id;
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
  var q = (document.getElementById('search').value || '').trim().toLowerCase();
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
  var panel = document.getElementById('panel-' + catId);
  if (!panel) return;
  var list = entriesForCategory(catId);
  var ul = panel.querySelector('.menu-list');
  if (!ul) return;
  if (!list.length) {
    ul.innerHTML = '<li class="empty-state">Nothing on this page yet — tap + Add</li>';
    return;
  }
  ul.innerHTML = list.map(function(e) {
    var tagsHtml = '';
    if (e.tagIds && e.tagIds.length) {
      var first = e.tagIds[0];
      tagsHtml = '<span class="menu-item-tag">' + escapeHtml(tagLabel(first)) + '</span>';
      if (e.tagIds.length > 1) tagsHtml += '<span class="menu-item-tag">+' + (e.tagIds.length - 1) + '</span>';
    }
    return '<li class="menu-item" data-entry-id="' + escapeHtml(e.id) + '" role="button" tabindex="0">'
      + '<span class="menu-item-name">' + escapeHtml(e.name) + '</span>'
      + '<span class="menu-item-leader" aria-hidden="true"></span>'
      + '<span class="menu-item-meta">'
      + tagsHtml
      + (e.favorite ? '<span class="fav" aria-label="Favorite">★</span>' : '')
      + '</span></li>';
  }).join('');
}

function renderAllLists() {
  getAllCategories().forEach(function(c) {
    if (!c.builtin === false && c.builtin !== true) { /* ok */ }
    renderListForCategory(c.id);
  });
  refreshPicker();
}

function ensureCategoryPanels() {
  var panels = document.getElementById('panels');
  var pick = document.getElementById('panel-pick');
  var manage = document.getElementById('panel-manage');
  getAllCategories().forEach(function(c) {
    if (document.getElementById('panel-' + c.id)) return;
    var sec = document.createElement('section');
    sec.className = 'panel';
    sec.id = 'panel-' + c.id;
    sec.setAttribute('data-panel', c.id);
    sec.innerHTML = '<ul class="menu-list" role="list"></ul>';
    panels.insertBefore(sec, pick);
  });
}

function renderTabbar() {
  var bar = document.getElementById('tabbar');
  if (!bar) return;
  var html = '';
  getAllCategories().forEach(function(c) {
    var icon = TAB_ICONS[c.id] || (c.builtin ? c.label.charAt(0) : '📋');
    if (!c.builtin && c.icon) icon = c.icon;
    html += '<button type="button" class="tab' + (activeTab === c.id ? ' on' : '') + '" data-tab="' + escapeHtml(c.id) + '" aria-selected="' + (activeTab === c.id) + '">'
      + '<span class="tab-icon">' + escapeHtml(icon) + '</span>'
      + '<span class="tab-label">' + escapeHtml(c.label) + '</span></button>';
  });
  html += '<button type="button" class="tab' + (activeTab === 'pick' ? ' on' : '') + '" data-tab="pick"><span class="tab-icon">🎲</span><span class="tab-label">Pick</span></button>';
  html += '<button type="button" class="tab' + (activeTab === 'manage' ? ' on' : '') + '" data-tab="manage"><span class="tab-icon">⚙️</span><span class="tab-label">Manage</span></button>';
  bar.innerHTML = html;
}

function updateHeaderForTab() {
  var sub = document.getElementById('section-sub');
  var searchRow = document.getElementById('search-row');
  var tagWrap = document.getElementById('tag-filters-wrap');
  var addBtn = document.getElementById('add-btn');
  var isBrowse = activeTab !== 'pick' && activeTab !== 'manage';
  if (searchRow) searchRow.hidden = !isBrowse;
  if (tagWrap) tagWrap.hidden = !isBrowse;
  if (addBtn) addBtn.hidden = !isBrowse;
  if (sub) {
    if (activeTab === 'pick') sub.textContent = TAB_META.pick.sub;
    else if (activeTab === 'manage') sub.textContent = TAB_META.manage.sub;
    else sub.textContent = categoryLabel(activeTab) + ' · tap a line for details';
  }
}

function switchTab(tabId) {
  if (tabId === activeTab) return;
  ensureCategoryPanels();
  var prevPanel = document.querySelector('.panel.on');
  var nextPanel = document.getElementById('panel-' + tabId);
  if (!nextPanel) return;

  activeTab = tabId;

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

  if (tabId === 'pick') {
    resetPickResult();
    populatePickCategorySelect();
    refreshPicker();
  }
  updateHeaderForTab();
  renderTabbar();
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
  btn.setAttribute('aria-label', e.favorite ? 'Unfavorite' : 'Favorite');
}

function renderViewMode(entry) {
  editMode = false;
  addingNew = false;
  document.getElementById('modal-edit').style.display = '';
  document.getElementById('modal-title').textContent = entry.name;
  document.getElementById('modal-meta').innerHTML = '<span class="badge">' + escapeHtml(categoryLabel(entry.category)) + '</span>'
    + (entry.lastHad ? ' · Last had ' + escapeHtml(entry.lastHad) : '');

  var tags = getTags();
  var tagHtml = tags.length
    ? '<div class="detail-tags" id="detail-tags">' + tags.map(function(t) {
        var on = entry.tagIds && entry.tagIds.indexOf(t.id) >= 0;
        return '<button type="button" class="detail-tag-chip' + (on ? ' on' : '') + '" data-detail-tag="' + escapeHtml(t.id) + '">' + escapeHtml(t.label) + '</button>';
      }).join('') + '</div>'
    : '<p class="hint">Add tags in Manage to label meals.</p>';

  var body = '';
  if (entry.notes) body += '<p class="modal-desc">' + escapeHtml(entry.notes) + '</p>';
  else body += '<p class="modal-empty">No notes yet.</p>';
  body += tagHtml;
  body += '<label class="pick-label" style="margin-top:12px">Last had</label>';
  body += '<input type="date" id="view-last-had" value="' + escapeHtml(entry.lastHad || '') + '">';

  document.getElementById('modal-body').innerHTML = body;

  var footer = document.getElementById('modal-footer');
  var links = [];
  if (entry.menuUrl) links.push('<a href="' + escapeHtml(entry.menuUrl) + '" target="_blank" rel="noopener">Menu</a>');
  if (entry.orderUrl) links.push('<a href="' + escapeHtml(entry.orderUrl) + '" target="_blank" rel="noopener">Order</a>');
  footer.innerHTML = links.length ? links.join('') : '';
  footer.style.display = links.length ? 'block' : 'none';

  updateModalFav();

  document.getElementById('view-last-had').onchange = function() {
    entry.lastHad = this.value;
    var st = getState();
    var i = st.entries.findIndex(function(x) { return x.id === entry.id; });
    if (i >= 0) { st.entries[i] = entry; saveAppState(st); }
    document.getElementById('modal-meta').innerHTML = '<span class="badge">' + escapeHtml(categoryLabel(entry.category)) + '</span>'
      + (entry.lastHad ? ' · Last had ' + escapeHtml(entry.lastHad) : '');
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

function renderEditMode(entry) {
  editMode = true;
  var isNew = addingNew;
  document.getElementById('modal-edit').style.display = isNew ? 'none' : '';
  document.getElementById('modal-title').textContent = isNew ? 'Add to menu' : 'Edit';
  document.getElementById('modal-meta').textContent = '';

  var cats = getAllCategories();
  var catOpts = cats.map(function(c) {
    return '<option value="' + escapeHtml(c.id) + '"' + (entry.category === c.id ? ' selected' : '') + '>' + escapeHtml(c.label) + '</option>';
  }).join('');

  var tagChips = getTags().map(function(t) {
    var on = editSelectedTags.indexOf(t.id) >= 0;
    return '<button type="button" class="detail-tag-chip edit-tag-pick' + (on ? ' on' : '') + '" data-edit-tag="' + escapeHtml(t.id) + '">' + escapeHtml(t.label) + '</button>';
  }).join('') || '<p class="hint">No tags — add in Manage</p>';

  document.getElementById('modal-body').innerHTML = '<div class="edit-form">'
    + (isNew ? '<label for="edit-name">Name</label><input type="text" id="edit-name" placeholder="Meal or place name" value="">' : '')
    + '<label for="edit-category">Category</label><select id="edit-category">' + catOpts + '</select>'
    + '<label for="edit-notes">Notes</label><textarea id="edit-notes">' + escapeHtml(entry.notes || '') + '</textarea>'
    + '<label for="edit-menu-url">Menu URL</label><input type="url" id="edit-menu-url" value="' + escapeHtml(entry.menuUrl || '') + '">'
    + '<label for="edit-order-url">Order URL</label><input type="url" id="edit-order-url" value="' + escapeHtml(entry.orderUrl || '') + '">'
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
      var st = getState();
      st.entries = st.entries.filter(function(e) { return e.id !== entry.id; });
      saveAppState(st);
      closeModal();
      renderAllLists();
      renderManage();
      showStatus('Deleted');
    };
  }

  var chipsEl = document.getElementById('edit-tag-chips');
  if (chipsEl) {
    chipsEl.onclick = function(ev) {
      var chip = ev.target.closest('[data-edit-tag]');
      if (!chip) return;
      var tid = chip.getAttribute('data-edit-tag');
      var ix = editSelectedTags.indexOf(tid);
      if (ix >= 0) editSelectedTags.splice(ix, 1);
      else editSelectedTags.push(tid);
      chip.classList.toggle('on', editSelectedTags.indexOf(tid) >= 0);
    };
  }
}

function saveEdit(original) {
  var isNew = addingNew;
  var nameEl = document.getElementById('edit-name');
  var name = isNew ? (nameEl && nameEl.value.trim()) : original.name;
  if (!name) { alert('Name is required.'); return; }

  var st = getState();
  var entry;
  if (isNew) {
    entry = {
      id: newId('entry'),
      name: name,
      category: document.getElementById('edit-category').value,
      notes: document.getElementById('edit-notes').value.trim(),
      menuUrl: document.getElementById('edit-menu-url').value.trim(),
      orderUrl: document.getElementById('edit-order-url').value.trim(),
      tagIds: editSelectedTags.slice(),
      favorite: document.getElementById('edit-favorite').checked,
      lastHad: '',
      createdAt: Date.now(),
      phillyPlaceName: null
    };
    st.entries.push(entry);
  } else {
    entry = st.entries.find(function(e) { return e.id === original.id; });
    if (!entry) return;
    entry.category = document.getElementById('edit-category').value;
    entry.notes = document.getElementById('edit-notes').value.trim();
    entry.menuUrl = document.getElementById('edit-menu-url').value.trim();
    entry.orderUrl = document.getElementById('edit-order-url').value.trim();
    entry.tagIds = editSelectedTags.slice();
    entry.favorite = document.getElementById('edit-favorite').checked;
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
  var cat = activeTab;
  if (cat === 'pick' || cat === 'manage') cat = 'cooking';
  addingNew = true;
  editMode = true;
  editSelectedTags = [];
  currentEntryId = '';
  var blank = {
    id: '',
    name: '',
    category: cat,
    notes: '',
    menuUrl: '',
    orderUrl: '',
    tagIds: [],
    favorite: false,
    lastHad: '',
    phillyPlaceName: null
  };
  document.getElementById('modal-title').textContent = 'Add to menu';
  renderEditMode(blank);
  openModal();
}

/* ——— Manage ——— */
function renderManage() {
  var manageList = document.getElementById('tag-manage-list');
  var tags = getTags();
  if (manageList) {
    if (!tags.length) {
      manageList.innerHTML = '<p class="hint" style="margin:0">No tags yet.</p>';
    } else {
      manageList.innerHTML = tags.map(function(tag) {
        var count = countEntriesWithTag(tag.id);
        return '<div class="tag-manage-row"><span class="tag-manage-label">' + escapeHtml(tag.label) + '</span>'
          + '<span class="tag-manage-count">' + count + ' meal' + (count === 1 ? '' : 's') + '</span>'
          + '<button type="button" class="tag-del-btn" data-tag-del="' + escapeHtml(tag.id) + '">Delete</button></div>';
      }).join('');
    }
  }

  var builtinList = document.getElementById('builtin-cat-list');
  var customList = document.getElementById('custom-cat-list');
  var cats = getState().categories;
  if (builtinList) {
    builtinList.innerHTML = cats.filter(function(c) { return c.builtin; }).map(function(c) {
      return '<li class="builtin">' + escapeHtml(c.label) + '</li>';
    }).join('');
  }
  if (customList) {
    var custom = cats.filter(function(c) { return !c.builtin; });
    if (!custom.length) {
      customList.innerHTML = '<li class="hint" style="border:none">No custom categories</li>';
    } else {
      customList.innerHTML = custom.map(function(c) {
        var count = getState().entries.filter(function(e) { return e.category === c.id; }).length;
        return '<li><span>' + escapeHtml(c.label) + ' <span class="hint">(' + count + ')</span></span>'
          + '<button type="button" class="cat-del-btn" data-cat-del="' + escapeHtml(c.id) + '">Delete</button></li>';
      }).join('');
    }
  }
}

function addCustomCategory(label) {
  var name = (label || '').trim();
  if (!name) return;
  var st = getState();
  var custom = st.categories.filter(function(c) { return !c.builtin; });
  if (custom.length >= MAX_CUSTOM_CATS) {
    showStatus('Max ' + MAX_CUSTOM_CATS + ' custom categories');
    return;
  }
  var id = 'cat-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!id || id === 'cat-') id = newId('cat');
  if (st.categories.some(function(c) { return c.id === id; })) id = newId('cat');
  st.categories.push({ id: id, label: name, builtin: false, icon: '📋' });
  saveAppState(st);
  ensureCategoryPanels();
  renderTabbar();
  renderManage();
  showStatus('Category added');
}

function deleteCustomCategory(id) {
  var st = getState();
  var c = st.categories.find(function(x) { return x.id === id && !x.builtin; });
  if (!c) return;
  var n = st.entries.filter(function(e) { return e.category === id; }).length;
  if (n && !confirm('Delete category “' + c.label + '”? ' + n + ' meal(s) will move to Cooking.')) return;
  st.entries.forEach(function(e) {
    if (e.category === id) e.category = 'cooking';
  });
  st.categories = st.categories.filter(function(x) { return x.id !== id; });
  saveAppState(st);
  if (activeTab === id) switchTab('cooking');
  ensureCategoryPanels();
  var oldPanel = document.getElementById('panel-' + id);
  if (oldPanel) oldPanel.remove();
  renderTabbar();
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
  else if (activeTab !== 'pick' && activeTab !== 'manage') sel.value = activeTab;
}

function getPickerPool() {
  var st = getState();
  var list = st.entries.slice();
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
  list.sort(function(a, b) { return a.name.localeCompare(b.name); });
  return list;
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
  if (!tags.length) {
    el.innerHTML = '<p class="hint" style="margin:0">No tags yet</p>';
    return;
  }
  el.innerHTML = tags.map(function(tag) {
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
  var panel = document.getElementById('panel-pick');
  if (result) result.hidden = true;
  if (panel) panel.classList.remove('pick-showing-result');
}

function showPickResult(id) {
  var entry = getEntryById(id);
  if (!entry) return;
  pickerWinnerId = id;
  document.getElementById('pick-result-name').textContent = entry.name;
  document.getElementById('pick-result-notes').textContent = entry.notes || categoryLabel(entry.category);
  var links = [];
  if (entry.menuUrl) links.push('<a href="' + escapeHtml(entry.menuUrl) + '" target="_blank" rel="noopener">Menu</a>');
  if (entry.orderUrl) links.push('<a href="' + escapeHtml(entry.orderUrl) + '" target="_blank" rel="noopener">Order</a>');
  document.getElementById('pick-result-links').innerHTML = links.join('');
  document.getElementById('pick-result').hidden = false;
  document.getElementById('panel-pick').classList.add('pick-showing-result');
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

/* ——— Backup ——— */
function exportData() {
  var st = getState();
  var blob = new Blob([JSON.stringify(st, null, 2)], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'meal-menu-backup-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
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
        if (!slice) {
          showStatus('No Meal Menu data in this file');
          return;
        }
      }
      if (!slice || !Array.isArray(slice.entries)) {
        showStatus('Invalid backup file');
        return;
      }
      saveAppState(normalizeState(slice));
      ensureCategoryPanels();
      renderTabbar();
      renderTagFilters();
      renderAllLists();
      renderManage();
      populatePickCategorySelect();
      renderPickTags();
      showStatus('Import complete');
    } catch (e) {
      showStatus('Could not read file');
    }
  };
  reader.readAsText(file);
}

/* ——— Init ——— */
function bindEvents() {
  document.getElementById('tag-filters').addEventListener('click', function(e) {
    var chip = e.target.closest('[data-tag-filter]');
    if (!chip) return;
    setTagFilter(chip.getAttribute('data-tag-filter'));
  });

  document.getElementById('search').addEventListener('input', renderAllLists);

  document.getElementById('add-btn').addEventListener('click', openAddEntry);

  document.getElementById('tabbar').addEventListener('click', function(e) {
    var tab = e.target.closest('[data-tab]');
    if (!tab) return;
    switchTab(tab.getAttribute('data-tab'));
  });

  document.getElementById('panels').addEventListener('click', function(e) {
    var item = e.target.closest('[data-entry-id]');
    if (!item) return;
    openEntry(item.getAttribute('data-entry-id'));
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
    var inp = document.getElementById('new-cat-name');
    addCustomCategory(inp.value);
    inp.value = '';
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

  document.getElementById('pick-category').addEventListener('change', function() {
    if (pickerSpinning) return;
    resetPickResult();
    refreshPicker();
  });
  document.getElementById('pick-favorites-only').addEventListener('change', function() {
    if (pickerSpinning) return;
    resetPickResult();
    refreshPicker();
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
}

function boot() {
  initState();
  ensureCategoryPanels();
  renderTabbar();
  renderTagFilters();
  renderAllLists();
  renderManage();
  populatePickCategorySelect();
  renderPickTags();
  refreshPicker();
  bindEvents();

  var firstCat = getAllCategories()[0];
  if (firstCat) {
    document.querySelectorAll('.panel').forEach(function(p) {
      p.hidden = true;
      p.classList.remove('on');
    });
    var panel = document.getElementById('panel-' + firstCat.id);
    if (panel) {
      panel.hidden = false;
      panel.classList.add('on');
      activeTab = firstCat.id;
    }
  }
  updateHeaderForTab();
  renderTabbar();
}

// Future: import visited restaurants from philly-dates-v2 placeMeta → phillyPlaceName + link

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

})();
