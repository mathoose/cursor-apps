(function() {
'use strict';

var STORAGE_KEY = 'restaurant-notes-v1';
var FORMAT_MARKER = 'philly-restaurant-v1';
var DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
var currentId = '';
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
    schedule: {},
    updatedAt: new Date().toISOString()
  };
}

function loadData() {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: 1, places: [] };
    var data = JSON.parse(raw);
    if (!data.places) data.places = [];
    return data;
  } catch (e) {
    return { version: 1, places: [] };
  }
}

function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
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
  var list = document.getElementById('note-list');
  var empty = document.getElementById('list-empty');
  if (!list) return;
  if (!data.places.length) {
    list.innerHTML = '';
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;
  list.innerHTML = data.places.map(function(p) {
    var title = p.name ? escapeHtml(p.name) : 'Untitled';
    var sub = [];
    if (p.instagram) sub.push(escapeHtml(p.instagram.replace(/^https?:\/\/(www\.)?/, '')));
    sub.push(scheduleSummary(p.schedule));
    return '<li><button type="button" class="note-item" data-id="' + escapeHtml(p.id) + '">'
      + '<span class="note-title">' + title + '</span>'
      + '<span class="note-sub">' + sub.join(' · ') + '</span>'
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

function wireEvents() {
  document.getElementById('add-btn').addEventListener('click', function() { openEditor(null); });
  document.getElementById('export-all-btn').addEventListener('click', function() {
    var data = loadData();
    if (!data.places.length) { toast('No notes to export'); return; }
    copyText(serializeAll(data.places));
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
    if (e.key === 'Escape' && document.getElementById('edit-modal').classList.contains('open')) {
      closeEditor();
    }
  });
}

wireEvents();
renderList();
handleUrlParams();

})();
