(function() {
'use strict';

var STORAGE_KEY = 'restaurant-notes-v1';
var FORMAT_MARKER = 'philly-restaurant-v1';
var DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
var DEFAULT_CATEGORIES = [
  { id: 'want-to-try', label: 'Want to try' },
  { id: 'date-night', label: 'Date night' },
  { id: 'happy-hour', label: 'Happy hour' },
  { id: 'brunch', label: 'Brunch' }
];
var MAX_CATEGORIES = 24;
var currentId = '';
var filterCategoryId = '';
var autosaveTimer = null;

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function defaultPlace() {
  return {
    id: uid(),
    name: '',
    instagram: '',
    neighborhood: '',
    address: '',
    description: '',
    notes: '',
    categoryIds: [],
    schedule: {},
    updatedAt: new Date().toISOString()
  };
}

function slugCatId(label) {
  return String(label || '').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || ('cat-' + uid());
}

function normalizeData(raw) {
  var data = raw && typeof raw === 'object' ? raw : { version: 2, places: [] };
  if (!Array.isArray(data.places)) data.places = [];
  if (!Array.isArray(data.categories) || !data.categories.length) {
    data.categories = DEFAULT_CATEGORIES.slice();
  }
  data.places = data.places.map(function(p) {
    if (!Array.isArray(p.categoryIds)) p.categoryIds = [];
    return p;
  });
  data.version = 2;
  return data;
}

function loadData() {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return normalizeData({ places: [] });
    return normalizeData(JSON.parse(raw));
  } catch (e) {
    return normalizeData({ places: [] });
  }
}

function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeData(data)));
}

function getCategories() {
  return loadData().categories || [];
}

function categoryLabel(id) {
  var cat = getCategories().find(function(c) { return c.id === id; });
  return cat ? cat.label : id;
}

function addCategory(label) {
  var text = (label || '').trim();
  if (!text) return null;
  var data = loadData();
  if (data.categories.length >= MAX_CATEGORIES) {
    toast('Max ' + MAX_CATEGORIES + ' categories');
    return null;
  }
  if (data.categories.some(function(c) { return c.label.toLowerCase() === text.toLowerCase(); })) {
    toast('Category already exists');
    return data.categories.find(function(c) { return c.label.toLowerCase() === text.toLowerCase(); });
  }
  var cat = { id: slugCatId(text), label: text };
  data.categories.push(cat);
  saveData(data);
  renderCategoryFilters();
  renderEditCategoryChips();
  renderManageCatList();
  return cat;
}

function deleteCategory(id) {
  var data = loadData();
  data.categories = data.categories.filter(function(c) { return c.id !== id; });
  data.places.forEach(function(p) {
    if (Array.isArray(p.categoryIds)) {
      p.categoryIds = p.categoryIds.filter(function(cid) { return cid !== id; });
    }
  });
  if (filterCategoryId === id) filterCategoryId = '';
  saveData(data);
  renderCategoryFilters();
  renderEditCategoryChips();
  renderManageCatList();
  renderList();
}

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function normalizeInstagram(url) {
  var u = (url || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u;
}

function toast(msg) {
  var el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(function() { el.classList.remove('show'); }, 2800);
}

function setEditStatus(msg, saved) {
  var el = document.getElementById('edit-status');
  if (!el) return;
  el.textContent = msg || '';
  el.classList.toggle('saved', !!saved);
}

function getPlace(id) {
  var data = loadData();
  for (var i = 0; i < data.places.length; i++) {
    if (data.places[i].id === id) return data.places[i];
  }
  return null;
}

function upsertPlace(place) {
  var data = loadData();
  place.updatedAt = new Date().toISOString();
  var found = false;
  for (var i = 0; i < data.places.length; i++) {
    if (data.places[i].id === place.id) {
      data.places[i] = place;
      found = true;
      break;
    }
  }
  if (!found) data.places.unshift(place);
  data.places.sort(function(a, b) {
    return (b.updatedAt || '').localeCompare(a.updatedAt || '');
  });
  saveData(data);
}

function deletePlace(id) {
  var data = loadData();
  data.places = data.places.filter(function(p) { return p.id !== id; });
  saveData(data);
}

function truncate(s, n) {
  s = (s || '').trim();
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

function renderCategoryFilters() {
  var el = document.getElementById('category-filters');
  if (!el) return;
  var cats = getCategories();
  var chips = '<button type="button" class="cat-chip' + (!filterCategoryId ? ' on' : '') + '" data-cat="">All</button>';
  chips += cats.map(function(c) {
    return '<button type="button" class="cat-chip' + (filterCategoryId === c.id ? ' on' : '') + '" data-cat="' + escapeHtml(c.id) + '">' + escapeHtml(c.label) + '</button>';
  }).join('');
  el.innerHTML = chips;
}

function renderEditCategoryChips() {
  var el = document.getElementById('edit-category-chips');
  if (!el) return;
  var place = currentId ? getPlace(currentId) : null;
  var selected = place && Array.isArray(place.categoryIds) ? place.categoryIds : [];
  var cats = getCategories();
  if (!cats.length) {
    el.innerHTML = '<p class="hint" style="margin:0">Add a category below.</p>';
    return;
  }
  el.innerHTML = cats.map(function(c) {
    var on = selected.indexOf(c.id) >= 0;
    return '<button type="button" class="cat-chip' + (on ? ' on' : '') + '" data-cat-id="' + escapeHtml(c.id) + '">' + escapeHtml(c.label) + '</button>';
  }).join('');
}

function renderManageCatList() {
  var el = document.getElementById('manage-cat-list');
  if (!el) return;
  var cats = getCategories();
  if (!cats.length) {
    el.innerHTML = '<li class="hint">No categories yet.</li>';
    return;
  }
  el.innerHTML = cats.map(function(c) {
  var count = loadData().places.filter(function(p) {
    return p.categoryIds && p.categoryIds.indexOf(c.id) >= 0;
  }).length;
    return '<li class="manage-cat-row"><span>' + escapeHtml(c.label)
      + ' <span class="hint">(' + count + ')</span></span>'
      + '<button type="button" data-del-cat="' + escapeHtml(c.id) + '">Delete</button></li>';
  }).join('');
}

function togglePlaceCategory(catId) {
  if (!currentId) return;
  var place = getPlace(currentId);
  if (!place) return;
  if (!Array.isArray(place.categoryIds)) place.categoryIds = [];
  var i = place.categoryIds.indexOf(catId);
  if (i >= 0) place.categoryIds.splice(i, 1);
  else place.categoryIds.push(catId);
  upsertPlace(place);
  renderEditCategoryChips();
  renderList();
  setEditStatus('Saved', true);
}

function scheduleSummary(schedule) {
  if (!schedule) return 'no HH times';
  var days = DAY_NAMES.filter(function(d) {
    var s = schedule[d];
    return s && s.start && s.end;
  });
  if (!days.length) return 'no HH times';
  if (days.length === 7) return 'HH every day';
  return 'HH ' + days.length + ' day' + (days.length === 1 ? '' : 's');
}

function renderList() {
  var data = loadData();
  var places = data.places;
  if (filterCategoryId) {
    places = places.filter(function(p) {
      return p.categoryIds && p.categoryIds.indexOf(filterCategoryId) >= 0;
    });
  }
  var list = document.getElementById('note-list');
  var empty = document.getElementById('list-empty');
  if (!list) return;
  if (!places.length) {
    list.innerHTML = '';
    if (empty) {
      empty.hidden = false;
      empty.textContent = filterCategoryId
        ? 'No restaurants in this category.'
        : 'No notes yet. Tap + Add or open from an Instagram link.';
    }
    return;
  }
  if (empty) empty.hidden = true;
  list.innerHTML = places.map(function(p) {
    var title = p.name ? escapeHtml(p.name) : 'Untitled';
    var descHtml = p.description
      ? '<span class="note-desc">' + escapeHtml(truncate(p.description, 100)) + '</span>'
      : '';
    var sub = [];
    if (p.neighborhood) sub.push(escapeHtml(p.neighborhood));
    if (p.instagram) sub.push(escapeHtml(p.instagram.replace(/^https?:\/\/(www\.)?/, '')));
    sub.push(scheduleSummary(p.schedule));
    var catsHtml = '';
    if (p.categoryIds && p.categoryIds.length) {
      catsHtml = '<span class="note-cats">' + p.categoryIds.map(function(id) {
        return '<span class="cat-badge">' + escapeHtml(categoryLabel(id)) + '</span>';
      }).join('') + '</span>';
    }
    return '<li><button type="button" class="note-item" data-id="' + escapeHtml(p.id) + '">'
      + '<span class="note-title">' + title + '</span>'
      + descHtml
      + '<span class="note-sub">' + sub.join(' · ') + '</span>'
      + catsHtml
      + '</button></li>';
  }).join('');
}

function buildHhRows(schedule) {
  var tbody = document.getElementById('hh-body');
  if (!tbody) return;
  tbody.innerHTML = DAY_NAMES.map(function(day, idx) {
    var s = (schedule && schedule[day]) || {};
    var copyLabel = idx === 0 ? '—' : '← prev';
    var disabled = idx === 0 ? ' disabled' : '';
    return '<tr data-day="' + day + '"><td>' + day.slice(0, 3) + '</td>'
      + '<td><input type="text" data-field="start" placeholder="5:00 PM" value="' + escapeHtml(s.start || '') + '"></td>'
      + '<td><input type="text" data-field="end" placeholder="7:00 PM" value="' + escapeHtml(s.end || '') + '"></td>'
      + '<td><button type="button" class="copy-prev-btn"' + disabled + '>' + copyLabel + '</button></td></tr>';
  }).join('');
  tbody.querySelectorAll('.copy-prev-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var tr = btn.closest('tr');
      var prev = tr && tr.previousElementSibling;
      if (!prev) return;
      var start = prev.querySelector('input[data-field="start"]').value;
      var end = prev.querySelector('input[data-field="end"]').value;
      tr.querySelector('input[data-field="start"]').value = start;
      tr.querySelector('input[data-field="end"]').value = end;
      saveCurrentForm();
    });
  });
}

function collectForm() {
  var schedule = {};
  document.querySelectorAll('#hh-body tr[data-day]').forEach(function(tr) {
    var day = tr.getAttribute('data-day');
    var start = tr.querySelector('input[data-field="start"]').value.trim();
    var end = tr.querySelector('input[data-field="end"]').value.trim();
    if (start && end) schedule[day] = { start: start, end: end };
  });
  return {
    id: currentId,
    name: document.getElementById('f-name').value.trim(),
    instagram: normalizeInstagram(document.getElementById('f-instagram').value),
    neighborhood: document.getElementById('f-neighborhood').value.trim(),
    address: document.getElementById('f-address').value.trim(),
    description: document.getElementById('f-description').value.trim(),
    notes: document.getElementById('f-notes').value.trim(),
    categoryIds: (getPlace(currentId) && getPlace(currentId).categoryIds) ? getPlace(currentId).categoryIds.slice() : [],
    schedule: schedule
  };
}

function saveCurrentForm() {
  if (!currentId) return;
  var place = collectForm();
  place.id = currentId;
  upsertPlace(place);
  setEditStatus('Saved', true);
  renderList();
}

function debouncedSave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(saveCurrentForm, 400);
}

function openEditor(id, prefill) {
  var place = id ? getPlace(id) : null;
  if (!place) {
    place = defaultPlace();
    if (prefill) {
      if (prefill.name) place.name = prefill.name;
      if (prefill.instagram) place.instagram = normalizeInstagram(prefill.instagram);
    }
    upsertPlace(place);
  }
  currentId = place.id;
  document.getElementById('f-name').value = place.name || '';
  document.getElementById('f-instagram').value = place.instagram || '';
  document.getElementById('f-neighborhood').value = place.neighborhood || '';
  document.getElementById('f-address').value = place.address || '';
  document.getElementById('f-description').value = place.description || '';
  document.getElementById('f-notes').value = place.notes || '';
  document.getElementById('edit-title').textContent = place.name || 'New restaurant';
  buildHhRows(place.schedule);
  renderEditCategoryChips();
  setEditStatus(place.name || place.instagram ? 'Draft restored' : '', !!(place.name || place.instagram));
  document.getElementById('edit-modal').classList.add('open');
  document.body.classList.add('modal-open');
}

function closeEditor() {
  saveCurrentForm();
  document.getElementById('edit-modal').classList.remove('open');
  document.body.classList.remove('modal-open');
  currentId = '';
  setEditStatus('');
  renderList();
}

/* ——— Text export format (shared with Philly Dates import) ——— */

function serializePlace(p) {
  var lines = ['--- ' + FORMAT_MARKER + ' ---'];
  lines.push('name: ' + (p.name || ''));
  lines.push('instagram: ' + (p.instagram || ''));
  lines.push('neighborhood: ' + (p.neighborhood || ''));
  lines.push('address: ' + (p.address || ''));
  lines.push('description: ' + (p.description || ''));
  lines.push('notes: ' + (p.notes || ''));
  if (p.categoryIds && p.categoryIds.length) {
    lines.push('categories: ' + p.categoryIds.map(categoryLabel).join(', '));
  }
  lines.push('schedule:');
  DAY_NAMES.forEach(function(day) {
    var s = p.schedule && p.schedule[day];
    if (s && s.start && s.end) lines.push('  ' + day + ': ' + s.start + ' - ' + s.end);
    else lines.push('  ' + day + ':');
  });
  lines.push('--- end ---');
  return lines.join('\n');
}

function serializeAll(places) {
  if (!places.length) return '';
  var header = [
    'Philly Dates — restaurant import',
    'Paste this into Philly Dates → Settings → Import from text',
    ''
  ];
  return header.concat(places.map(serializePlace)).join('\n\n');
}

function copyText(text) {
  if (!text) {
    toast('Nothing to copy');
    return false;
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).then(function() {
      toast('Copied — paste in Philly Dates');
      return true;
    }).catch(fallbackCopy);
  }
  return Promise.resolve(fallbackCopy(text));
}

function fallbackCopy(text) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    toast('Copied — paste in Philly Dates');
    document.body.removeChild(ta);
    return true;
  } catch (e) {
    document.body.removeChild(ta);
    toast('Could not copy');
    return false;
  }
}

function handleUrlParams() {
  var params = new URLSearchParams(window.location.search);
  var ig = params.get('instagram');
  var name = params.get('name');
  var quick = params.get('quickAdd');
  if (!quick && !ig && !name) return;
  openEditor(null, { name: name || '', instagram: ig || '' });
  if (window.history.replaceState) {
    window.history.replaceState({}, '', window.location.pathname);
  }
}

function pasteInstagramLink() {
  var el = document.getElementById('f-instagram');
  if (!el) return;
  if (navigator.clipboard && navigator.clipboard.readText) {
    navigator.clipboard.readText().then(function(text) {
      var t = (text || '').trim();
      if (!t) { toast('Clipboard is empty'); return; }
      if (t.indexOf('instagram.com') === -1 && t.indexOf('instagr.am') === -1) {
        toast('Copy an Instagram link first');
        return;
      }
      el.value = normalizeInstagram(t);
      debouncedSave();
      toast('Link pasted');
    }).catch(function() {
      toast('Tap Instagram field and paste manually');
    });
    return;
  }
  el.focus();
  toast('Tap the field, then Paste');
}

function openHelpModal() {
  document.getElementById('help-modal').classList.add('open');
  document.body.classList.add('modal-open');
}

function closeHelpModal() {
  document.getElementById('help-modal').classList.remove('open');
  if (!document.getElementById('edit-modal').classList.contains('open')
      && !document.getElementById('cats-modal').classList.contains('open')) {
    document.body.classList.remove('modal-open');
  }
}

function openCatsModal() {
  renderManageCatList();
  document.getElementById('cats-modal').classList.add('open');
  document.body.classList.add('modal-open');
}

function closeCatsModal() {
  document.getElementById('cats-modal').classList.remove('open');
  if (!document.getElementById('edit-modal').classList.contains('open')) {
    document.body.classList.remove('modal-open');
  }
}

function wireEvents() {
  document.getElementById('add-btn').addEventListener('click', function() { openEditor(null); });
  document.getElementById('export-all-btn').addEventListener('click', function() {
    var data = loadData();
    var places = filterCategoryId
      ? data.places.filter(function(p) { return p.categoryIds && p.categoryIds.indexOf(filterCategoryId) >= 0; })
      : data.places;
    if (!places.length) { toast('No notes to export'); return; }
    copyText(serializeAll(places));
  });
  document.getElementById('category-filters').addEventListener('click', function(e) {
    var chip = e.target.closest('.cat-chip');
    if (!chip) return;
    filterCategoryId = chip.getAttribute('data-cat') || '';
    renderCategoryFilters();
    renderList();
  });
  document.getElementById('edit-category-chips').addEventListener('click', function(e) {
    var chip = e.target.closest('[data-cat-id]');
    if (!chip) return;
    togglePlaceCategory(chip.getAttribute('data-cat-id'));
  });
  document.getElementById('add-category-btn').addEventListener('click', function() {
    var inp = document.getElementById('new-category-input');
    var cat = addCategory(inp.value);
    if (cat && currentId) {
      var place = getPlace(currentId);
      if (place) {
        if (!Array.isArray(place.categoryIds)) place.categoryIds = [];
        if (place.categoryIds.indexOf(cat.id) < 0) {
          place.categoryIds.push(cat.id);
          upsertPlace(place);
          renderEditCategoryChips();
          renderList();
          setEditStatus('Saved', true);
        }
      }
    }
    if (inp) inp.value = '';
  });
  document.getElementById('new-category-input').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') document.getElementById('add-category-btn').click();
  });
  document.getElementById('manage-cats-btn').addEventListener('click', openCatsModal);
  document.getElementById('help-btn').addEventListener('click', openHelpModal);
  document.getElementById('help-close').addEventListener('click', closeHelpModal);
  document.getElementById('help-modal').addEventListener('click', function(e) {
    if (e.target.id === 'help-modal') closeHelpModal();
  });
  document.getElementById('paste-ig-btn').addEventListener('click', pasteInstagramLink);
  document.getElementById('cats-close').addEventListener('click', closeCatsModal);
  document.getElementById('cats-modal').addEventListener('click', function(e) {
    if (e.target.id === 'cats-modal') closeCatsModal();
  });
  document.getElementById('manage-add-cat-btn').addEventListener('click', function() {
    var inp = document.getElementById('manage-new-cat');
    if (addCategory(inp.value)) {
      inp.value = '';
      toast('Category added');
    }
  });
  document.getElementById('manage-new-cat').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') document.getElementById('manage-add-cat-btn').click();
  });
  document.getElementById('manage-cat-list').addEventListener('click', function(e) {
    var btn = e.target.closest('[data-del-cat]');
    if (!btn) return;
    var id = btn.getAttribute('data-del-cat');
    var label = categoryLabel(id);
    if (!confirm('Delete category “' + label + '”?')) return;
    deleteCategory(id);
    toast('Category deleted');
  });
  document.getElementById('note-list').addEventListener('click', function(e) {
    var btn = e.target.closest('.note-item');
    if (btn) openEditor(btn.getAttribute('data-id'));
  });
  document.getElementById('edit-close').addEventListener('click', closeEditor);
  document.getElementById('done-btn').addEventListener('click', closeEditor);
  document.getElementById('delete-btn').addEventListener('click', function() {
    if (!currentId || !confirm('Delete this note?')) return;
    deletePlace(currentId);
    currentId = '';
    document.getElementById('edit-modal').classList.remove('open');
    document.body.classList.remove('modal-open');
    renderList();
    toast('Deleted');
  });
  document.getElementById('copy-one-btn').addEventListener('click', function() {
    saveCurrentForm();
    var p = getPlace(currentId);
    if (!p) return;
    copyText(serializePlace(p));
  });
  document.getElementById('edit-modal').addEventListener('click', function(e) {
    if (e.target.id === 'edit-modal') closeEditor();
  });
  ['f-name', 'f-instagram', 'f-neighborhood', 'f-address', 'f-description', 'f-notes'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('input', debouncedSave);
  });
  document.getElementById('hh-body').addEventListener('input', debouncedSave);
  document.getElementById('f-name').addEventListener('input', function() {
    document.getElementById('edit-title').textContent = document.getElementById('f-name').value.trim() || 'New restaurant';
  });
  document.getElementById('f-instagram').addEventListener('blur', function() {
    var el = document.getElementById('f-instagram');
    var norm = normalizeInstagram(el.value);
    if (norm && norm !== el.value.trim()) {
      el.value = norm;
      debouncedSave();
    }
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      if (document.getElementById('help-modal').classList.contains('open')) closeHelpModal();
      else if (document.getElementById('cats-modal').classList.contains('open')) closeCatsModal();
      else if (document.getElementById('edit-modal').classList.contains('open')) closeEditor();
    }
  });
}

wireEvents();
renderCategoryFilters();
renderList();
handleUrlParams();

})();
