
(function() {
'use strict';
var STORAGE_KEY = 'philly-dates-v2';
var PHOTO_DB = 'philly-dates-menu-photos-v1';
var PHOTO_STORE = 'menus';
var menuPhotoObjectUrl = null;
var DEFAULT_MAP_URL = "https://www.google.com/maps/d/u/0/edit?mid=1FhoUT9uIqB7j7KwfxiN5pH7OlS8QENI&ll=39.939886441906246%2C-75.16844806228112&z=14";
var DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
var RESTAURANTS = [];
var NEIGHBORHOODS = ["Bella Vista", "Center City", "East Passyunk", "Fairmount", "Fishtown", "Graduate Hospital", "Logan Square", "Northern Liberties", "Old City", "Passyunk Square", "Penn's Landing", "Rittenhouse", "South Philadelphia", "University City", "Washington Square West"];
var byName = {};
var loadError = document.getElementById('load-error');
var currentModalName = '';
var editMode = false;
var addingNewPlace = false;
var viewMode = 'grid';

function showError(msg) {
  if (!loadError) return;
  if (msg) {
    loadError.textContent = msg;
    loadError.hidden = false;
  } else {
    loadError.hidden = true;
  }
}
function showStatus(msg) {
  var el = document.getElementById('import-status');
  if (!el) return;
  el.textContent = msg || '';
  el.hidden = !msg;
}

function loadAppState() {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) raw = localStorage.getItem('philly-hh-app-v1');
    return JSON.parse(raw || '{}');
  } catch (e) { return {}; }
}
function saveAppState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function revokeMenuPhotoUrl() {
  if (menuPhotoObjectUrl) {
    URL.revokeObjectURL(menuPhotoObjectUrl);
    menuPhotoObjectUrl = null;
  }
}
function photoKeyForName(name) {
  return 'menu:' + name;
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
function putMenuPhoto(name, blob) {
  return openPhotoDb().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx = db.transaction(PHOTO_STORE, 'readwrite');
      tx.objectStore(PHOTO_STORE).put(blob, photoKeyForName(name));
      tx.oncomplete = function() { resolve(); };
      tx.onerror = function() { reject(tx.error); };
    });
  });
}
function getMenuPhotoBlob(name) {
  return openPhotoDb().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx = db.transaction(PHOTO_STORE, 'readonly');
      var req = tx.objectStore(PHOTO_STORE).get(photoKeyForName(name));
      req.onsuccess = function() { resolve(req.result || null); };
      req.onerror = function() { reject(req.error); };
    });
  });
}
function deleteMenuPhotoBlob(name) {
  return openPhotoDb().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx = db.transaction(PHOTO_STORE, 'readwrite');
      tx.objectStore(PHOTO_STORE).delete(photoKeyForName(name));
      tx.oncomplete = function() { resolve(); };
      tx.onerror = function() { reject(tx.error); };
    });
  });
}
function clearAllMenuPhotos() {
  return openPhotoDb().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx = db.transaction(PHOTO_STORE, 'readwrite');
      tx.objectStore(PHOTO_STORE).clear();
      tx.oncomplete = function() { resolve(); };
      tx.onerror = function() { reject(tx.error); };
    });
  });
}
function hasMenuPhoto(name) {
  var st = loadAppState();
  return !!(st.menuPhotos && st.menuPhotos[name]);
}
function setMenuPhotoFlag(name, on) {
  var st = loadAppState();
  if (!st.menuPhotos) st.menuPhotos = {};
  if (on) st.menuPhotos[name] = true;
  else delete st.menuPhotos[name];
  saveAppState(st);
}
function showMenuPhotoInModal(name) {
  revokeMenuPhotoUrl();
  var block = document.getElementById('modal-menu-photo');
  if (!block) return;
  if (!hasMenuPhoto(name)) {
    block.innerHTML = '';
    block.hidden = true;
    return;
  }
  getMenuPhotoBlob(name).then(function(blob) {
    if (!blob) {
      block.innerHTML = '';
      block.hidden = true;
      return;
    }
    menuPhotoObjectUrl = URL.createObjectURL(blob);
    block.innerHTML = '<p><strong>Saved menu</strong></p><img src="' + menuPhotoObjectUrl + '" alt="Menu photo">';
    block.hidden = false;
  }).catch(function() {
    block.innerHTML = '';
    block.hidden = true;
  });
}
function getSearchQuery() {
  var el = document.getElementById('search');
  return el ? el.value.trim().toLowerCase() : '';
}
function filterBySearch(list) {
  var q = getSearchQuery();
  if (!q) return list;
  return list.filter(function(r) { return r.name.toLowerCase().indexOf(q) !== -1; });
}

function getFavorites() {
  var st = loadAppState();
  return Array.isArray(st.favorites) ? st.favorites.slice() : [];
}

function isFavorite(name) {
  return getFavorites().indexOf(name) >= 0;
}

function renameFavorite(oldName, newName) {
  if (!oldName || !newName || oldName === newName) return;
  var st = loadAppState();
  if (!Array.isArray(st.favorites)) return;
  var i = st.favorites.indexOf(oldName);
  if (i >= 0) {
    st.favorites[i] = newName;
    saveAppState(st);
  }
}

function toggleFavorite(name) {
  if (!name) return;
  var st = loadAppState();
  if (!st.favorites) st.favorites = [];
  var i = st.favorites.indexOf(name);
  var removing = i >= 0;
  if (removing) st.favorites.splice(i, 1);
  else st.favorites.push(name);
  saveAppState(st);
  updateModalFavButton();
  if (viewMode === 'list') render();
  else showStatus(removing ? 'Removed from favorites' : 'Added to favorites');
}

function updateModalFavButton() {
  var btn = document.getElementById('modal-fav');
  if (!btn) return;
  if (!currentModalName || addingNewPlace) {
    btn.hidden = true;
    return;
  }
  btn.hidden = false;
  var on = isFavorite(currentModalName);
  btn.textContent = on ? '\u2605' : '\u2606';
  btn.classList.toggle('on', on);
}

function getListPlaces() {
  var list = Object.keys(byName).map(function(n) { return byName[n]; });
  if (nSel && nSel.value) {
    list = list.filter(function(r) { return r.neighborhood === nSel.value; });
  }
  list = filterBySearch(list);
  var sortMode = document.getElementById('list-sort');
  var favoritesFirst = !sortMode || sortMode.value !== 'alpha';
  var favs = getFavorites();
  list.sort(function(a, b) {
    if (favoritesFirst) {
      var af = favs.indexOf(a.name) >= 0 ? 0 : 1;
      var bf = favs.indexOf(b.name) >= 0 ? 0 : 1;
      if (af !== bf) return af - bf;
    }
    return a.name.localeCompare(b.name);
  });
  return list;
}

function setViewMode(mode) {
  viewMode = mode;
  var gridBtn = document.getElementById('view-grid');
  var listBtn = document.getElementById('view-list');
  if (gridBtn) gridBtn.classList.toggle('on', mode === 'grid');
  if (listBtn) listBtn.classList.toggle('on', mode === 'list');
  document.querySelectorAll('.filter-grid-only').forEach(function(el) {
    el.hidden = mode !== 'grid';
  });
  document.querySelectorAll('.filter-list-only').forEach(function(el) {
    el.hidden = mode !== 'list';
  });
  var gw = document.getElementById('grid-wrap');
  var lw = document.getElementById('list-wrap');
  var leg = document.getElementById('legend-grid');
  if (gw) gw.hidden = mode !== 'grid';
  if (lw) lw.hidden = mode !== 'list';
  if (leg) leg.hidden = mode === 'list';
  if (mode === 'grid') refreshFilters();
  else render();
}

function applySettings(settings) {
  settings = settings || {};
  var dark = !!settings.darkMode;
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#1b5e20' : '#43a047');
  var mapUrl = settings.mapUrl || DEFAULT_MAP_URL;
  var mapBtn = document.getElementById('map-btn');
  if (mapBtn) mapBtn.href = mapUrl;
  var mapInput = document.getElementById('map-url-input');
  if (mapInput) mapInput.value = mapUrl;
  var darkToggle = document.getElementById('dark-mode-toggle');
  if (darkToggle) darkToggle.checked = dark;
}

function mergeOverrides(overrides) {
  if (!overrides) return;
  Object.keys(overrides).forEach(function(name) {
    var o = overrides[name];
    var r = byName[name];
    if (!r) {
      r = {
        name: name,
        neighborhood: o.neighborhood || '',
        address: o.address || '',
        description: o.description || '',
        hh_menu: o.hh_menu || '',
        social: o.social || '',
        instagram: o.instagram || '',
        schedule: o.schedule || {}
      };
      byName[name] = r;
      if (r.neighborhood && NEIGHBORHOODS.indexOf(r.neighborhood) === -1) {
        NEIGHBORHOODS.push(r.neighborhood);
        NEIGHBORHOODS.sort();
      }
      if (o.schedule && Object.keys(o.schedule).length) {
        RESTAURANTS.push(r);
      }
      return;
    }
    if (o.description !== undefined) r.description = o.description;
    if (o.hh_menu !== undefined) r.hh_menu = o.hh_menu;
    if (o.instagram !== undefined) r.instagram = o.instagram;
    if (o.social !== undefined) r.social = o.social;
    if (o.address !== undefined) r.address = o.address;
    if (o.neighborhood !== undefined) r.neighborhood = o.neighborhood;
    if (o.schedule !== undefined) {
      r.schedule = o.schedule;
      var idx = RESTAURANTS.indexOf(r);
      if (Object.keys(o.schedule).length) {
        if (idx === -1) RESTAURANTS.push(r);
      } else if (idx >= 0) {
        RESTAURANTS.splice(idx, 1);
      }
    }
  });
}

function rebuildRestaurantLists(allPlaces) {
  RESTAURANTS = allPlaces.filter(function(r) {
    return r.schedule && Object.keys(r.schedule).length;
  });
  byName = {};
  allPlaces.forEach(function(r) {
    byName[r.name] = r;
    if (r.neighborhood && NEIGHBORHOODS.indexOf(r.neighborhood) === -1) {
      NEIGHBORHOODS.push(r.neighborhood);
      NEIGHBORHOODS.sort();
    }
  });
}

function bootstrapData(allPlaces) {
  rebuildRestaurantLists(allPlaces);
  var appState = loadAppState();
  applySettings(appState.settings);
  mergeOverrides(appState.restaurants);
  populateEditAnySelect();
  rebuildNeighborhoodSelect();
}

function startApp() {
  fetch('places.json')
    .then(function(res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(function(allPlaces) {
      bootstrapData(allPlaces);
      daySel.value = getTodayDayName();
      buildTimeOptions(daySel.value, pickDefaultTime(daySel.value));
      render();
      var searchEl = document.getElementById('search');
      if (searchEl) searchEl.addEventListener('input', refreshFilters);
      showError('');
    })
    .catch(function() {
      showError('Could not load places.json. Open from GitHub Pages (mathoose.github.io/cursor-apps/philly-dates/).');
    });
}

function parseTime(t) {
  if (!t) return NaN;
  const m = String(t).match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return NaN;
  let h = +m[1], min = +m[2];
  if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12;
  if (m[3].toUpperCase() === 'AM' && h === 12) h = 0;
  return h * 60 + min;
}
function fmtMinutes(m) {
  const h = Math.floor(m / 60), min = m % 60;
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return h12 + ':' + String(min).padStart(2,'0') + ' ' + ap;
}
function getTodayDayName() { return DAY_NAMES[new Date().getDay()]; }
function roundToSlot(m) { return Math.floor(m / 30) * 30; }
function getNowSlot() {
  var d = new Date();
  return roundToSlot(d.getHours() * 60 + d.getMinutes());
}
function restaurantsForDay(day) {
  var list = RESTAURANTS.filter(function(r) { return r.schedule && r.schedule[day]; });
  if (nSel && nSel.value) list = list.filter(function(r) { return r.neighborhood === nSel.value; });
  return filterBySearch(list);
}
function isActive(r, day, slot) {
  const s = r.schedule[day];
  if (!s) return false;
  return parseTime(s.start) <= slot && slot < parseTime(s.end);
}
function pickDefaultTime(day) {
  var now = getNowSlot();
  var filtered = restaurantsForDay(day);
  if (!filtered.length) return now;
  var starts = filtered.map(function(r) { return parseTime(r.schedule[day].start); });
  var earliest = Math.min.apply(null, starts);
  if (day !== getTodayDayName()) return roundToSlot(earliest);
  for (var i = 0; i < filtered.length; i++) {
    if (isActive(filtered[i], day, now)) return now;
  }
  for (var j = 0; j < filtered.length; j++) {
    if (parseTime(filtered[j].schedule[day].start) === now) return now;
  }
  return roundToSlot(earliest);
}
function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function formatDescription(text) {
  if (!text || !text.trim()) return '<p class="modal-empty">No description yet.</p>';
  let t = text.replace(/\\/g, '').replace(/\*/g, ' * ');
  const escaped = escapeHtml(t);
  const linked = escaped.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
  const parts = linked.split(/\s+\*\s+/).map(p => p.trim()).filter(Boolean);
  if (parts.length <= 1) return '<div class="modal-desc"><p>' + parts[0] + '</p></div>';
  return '<ul class="modal-desc">' + parts.map(p => '<li>' + p + '</li>').join('') + '</ul>';
}

const modal = document.getElementById('modal');
const modalTitle = document.getElementById('modal-title');
const modalMeta = document.getElementById('modal-meta');
const modalBody = document.getElementById('modal-body');
const modalFooter = document.getElementById('modal-footer');
const IG_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect><circle cx="12" cy="12" r="4"></circle><circle cx="17.5" cy="6.5" r="1" fill="#fff" stroke="none"></circle></svg>';

function appleMapsUrl(r) {
  var q = [r.name, r.address, r.neighborhood, 'Philadelphia, PA'].filter(Boolean).join(', ');
  if (!q) return '';
  return 'https://maps.apple.com/?q=' + encodeURIComponent(q);
}

function renderModalFooter(r) {
  var parts = [];
  var mapsUrl = appleMapsUrl(r);
  if (mapsUrl) {
    parts.push('<a class="maps-btn" href="' + escapeHtml(mapsUrl) + '" target="_blank" rel="noopener noreferrer" aria-label="Open in Apple Maps">📍 Maps</a>');
  }
  if (r.instagram) {
    parts.push('<a class="ig-btn" href="' + escapeHtml(r.instagram)
      + '" target="_blank" rel="noopener noreferrer" aria-label="Open Instagram">' + IG_SVG + '</a>');
  }
  if (parts.length) {
    modalFooter.innerHTML = '<div class="modal-footer-actions">' + parts.join('') + '</div>';
    modalFooter.style.display = 'flex';
  } else {
    modalFooter.innerHTML = '';
    modalFooter.style.display = 'none';
  }
}

function renderViewMode(r) {
  editMode = false;
  addingNewPlace = false;
  document.getElementById('modal-edit').style.display = '';
  let body = formatDescription(r.description);
  const links = [];
  if (r.hh_menu) links.push(['Website / Menu', r.hh_menu]);
  if (r.social && r.social !== r.instagram) links.push(['Social', r.social]);
  if (links.length) {
    body += '<div class="modal-links">' + links.map(function(pair) {
      return '<a href="' + escapeHtml(pair[1]) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(pair[0]) + '</a>';
    }).join('') + '</div>';
  }
  modalBody.innerHTML = '<div id="modal-menu-photo" class="menu-photo-block" hidden></div>' + body;
  showMenuPhotoInModal(r.name);
  renderModalFooter(r);
  updateModalFavButton();
}

function wireCopyPrevious() {
  var tbody = modalBody.querySelector('.hh-grid tbody');
  if (!tbody) return;
  var trs = tbody.querySelectorAll('tr');
  trs.forEach(function(tr, idx) {
    var btn = tr.querySelector('.copy-prev-btn');
    if (!btn) return;
    btn.onclick = function() {
      var prevIdx = idx === 0 ? 6 : idx - 1;
      var prevTr = trs[prevIdx];
      var prevStart = prevTr.querySelector('input[data-field="start"]').value;
      var prevEnd = prevTr.querySelector('input[data-field="end"]').value;
      tr.querySelector('input[data-field="start"]').value = prevStart;
      tr.querySelector('input[data-field="end"]').value = prevEnd;
    };
  });
}

function renderEditMode(r) {
  editMode = true;
  var isNew = addingNewPlace;
  document.getElementById('modal-edit').style.display = isNew ? 'none' : '';
  var rows = DAY_NAMES.map(function(day, idx) {
    var s = (r.schedule && r.schedule[day]) || {};
    var copyLabel = day === 'Sunday' ? 'Copy Sat' : '←';
    return '<tr><td>' + day + '</td>'
      + '<td><input type="text" data-day="' + day + '" data-field="start" placeholder="5:00 PM" value="' + escapeHtml(s.start || '') + '"></td>'
      + '<td><input type="text" data-day="' + day + '" data-field="end" placeholder="7:00 PM" value="' + escapeHtml(s.end || '') + '"></td>'
      + '<td><button type="button" class="copy-prev-btn btn-secondary" title="Copy previous day">' + copyLabel + '</button></td></tr>';
  }).join('');
  var nameFields = isNew
    ? '<label for="edit-name">Name</label>'
      + '<input type="text" id="edit-name" placeholder="Restaurant name" value="">'
    : '';
  modalBody.innerHTML = '<div class="edit-form">'
    + nameFields
    + '<label for="edit-address">Address</label>'
    + '<input type="text" id="edit-address" value="' + escapeHtml(r.address || '') + '">'
    + '<label for="edit-neighborhood">Neighborhood</label>'
    + '<input type="text" id="edit-neighborhood" value="' + escapeHtml(r.neighborhood || '') + '">'
    + '<label for="edit-description">Description</label>'
    + '<textarea id="edit-description">' + escapeHtml(r.description || '') + '</textarea>'
    + '<label for="edit-hh-menu">Website / Menu URL</label>'
    + '<input type="url" id="edit-hh-menu" value="' + escapeHtml(r.hh_menu || '') + '">'
    + '<label for="edit-instagram">Instagram URL</label>'
    + '<input type="url" id="edit-instagram" value="' + escapeHtml(r.instagram || '') + '">'
    + '<div class="menu-photo-edit"><label>Menu photo</label>'
    + '<div id="edit-menu-photo-preview"></div>'
    + '<div class="menu-photo-actions">'
    + '<button type="button" class="btn-secondary" id="menu-photo-pick">Add menu photo</button>'
    + '<button type="button" class="btn-secondary" id="menu-photo-remove" hidden>Remove photo</button>'
    + '</div>'
    + '<input type="file" id="menu-photo-file" accept="image/*" capture="environment" hidden>'
    + '<p class="menu-photo-hint">Saved on this device only — snap the HH menu when you have it.</p></div>'
    + '<label>Happy hour times (leave blank if none that day)</label>'
    + '<table class="hh-grid"><thead><tr><th>Day</th><th>Start</th><th>End</th><th>Copy prev</th></tr></thead><tbody>' + rows + '</tbody></table>'
    + '<div class="edit-actions">'
    + '<button type="button" class="btn-secondary" id="edit-cancel">Cancel</button>'
    + '<button type="button" class="btn-primary" id="edit-save">Save</button>'
    + '</div></div>';
  modalFooter.innerHTML = '';
  modalFooter.style.display = 'none';
  wireCopyPrevious();
  wireMenuPhotoEdit(r.name || '');
  document.getElementById('edit-cancel').onclick = function() {
    if (isNew) closeModal();
    else renderViewMode(r);
  };
  document.getElementById('edit-save').onclick = function() { saveEdit(r.name || ''); };
}

function wireMenuPhotoEdit(name) {
  var fileInp = document.getElementById('menu-photo-file');
  var pickBtn = document.getElementById('menu-photo-pick');
  var removeBtn = document.getElementById('menu-photo-remove');
  if (!fileInp || !pickBtn) return;
  function currentName() {
    if (addingNewPlace) {
      var el = document.getElementById('edit-name');
      return el ? el.value.trim() : '';
    }
    return name;
  }
  function refreshPreview() {
    var n = currentName();
    var prev = document.getElementById('edit-menu-photo-preview');
    if (!prev) return;
    if (!n || !hasMenuPhoto(n)) {
      prev.innerHTML = '<p class="modal-empty">No menu photo yet.</p>';
      if (removeBtn) removeBtn.hidden = true;
      return;
    }
    getMenuPhotoBlob(n).then(function(blob) {
      if (!blob) {
        prev.innerHTML = '<p class="modal-empty">No menu photo yet.</p>';
        if (removeBtn) removeBtn.hidden = true;
        return;
      }
      var url = URL.createObjectURL(blob);
      prev.innerHTML = '<img src="' + url + '" alt="Menu preview">';
      if (removeBtn) removeBtn.hidden = false;
    });
  }
  pickBtn.onclick = function() { fileInp.click(); };
  fileInp.onchange = function() {
    var f = fileInp.files && fileInp.files[0];
    fileInp.value = '';
    var n = currentName();
    if (!f) return;
    if (!n) { alert('Enter the place name first.'); return; }
    putMenuPhoto(n, f).then(function() {
      setMenuPhotoFlag(n, true);
      refreshPreview();
      showStatus('Menu photo saved.');
    }).catch(function() {
      showError('Could not save menu photo.');
    });
  };
  if (removeBtn) {
    removeBtn.onclick = function() {
      var n = currentName();
      if (!n || !confirm('Remove saved menu photo?')) return;
      deleteMenuPhotoBlob(n).then(function() {
        setMenuPhotoFlag(n, false);
        refreshPreview();
        showStatus('Menu photo removed.');
      });
    };
  }
  if (addingNewPlace) {
    var nameInp = document.getElementById('edit-name');
    if (nameInp) nameInp.addEventListener('input', refreshPreview);
  }
  refreshPreview();
}

function defaultQuickSchedule() {
  var s = {};
  ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].forEach(function(day) {
    s[day] = { start: '5:00 PM', end: '7:00 PM' };
  });
  return s;
}

function openAddPlace() {
  addingNewPlace = true;
  currentModalName = '';
  editMode = true;
  var blank = {
    name: '',
    neighborhood: '',
    address: '',
    description: '',
    hh_menu: '',
    instagram: '',
    social: '',
    schedule: defaultQuickSchedule()
  };
  modalTitle.textContent = 'Add place';
  modalMeta.textContent = '';
  renderEditMode(blank);
  modal.classList.add('open');
  document.body.classList.add('modal-open');
}

function openModal(name) {
  const r = byName[name];
  if (!r) return;
  addingNewPlace = false;
  currentModalName = name;
  modalTitle.textContent = r.name;
  modalMeta.textContent = [r.neighborhood, r.address].filter(Boolean).join(' · ');
  renderViewMode(r);
  modal.classList.add('open');
  document.body.classList.add('modal-open');
}
function closeModal() {
  modal.classList.remove('open');
  document.body.classList.remove('modal-open');
  editMode = false;
  addingNewPlace = false;
  currentModalName = '';
  document.getElementById('modal-edit').style.display = '';
  revokeMenuPhotoUrl();
}
function saveEdit(originalName) {
  var isNew = addingNewPlace;
  var name = isNew ? document.getElementById('edit-name').value.trim() : originalName;
  if (!name) { alert('Name is required.'); return; }
  if (isNew && byName[name]) { alert('A place with this name already exists.'); return; }
  var address = document.getElementById('edit-address').value.trim();
  var neighborhood = document.getElementById('edit-neighborhood').value.trim();
  var description = document.getElementById('edit-description').value.trim();
  var hh_menu = document.getElementById('edit-hh-menu').value.trim();
  var instagram = document.getElementById('edit-instagram').value.trim();
  var schedule = {};
  modalBody.querySelectorAll('input[data-day]').forEach(function(inp) {
    var day = inp.getAttribute('data-day');
    var field = inp.getAttribute('data-field');
    var val = inp.value.trim();
    if (!schedule[day]) schedule[day] = { start: '', end: '' };
    schedule[day][field] = val;
  });
  DAY_NAMES.forEach(function(day) {
    var s = schedule[day];
    if (!s || !s.start || !s.end) delete schedule[day];
  });
  var r = isNew ? null : byName[originalName];
  if (isNew) {
    r = {
      name: name,
      neighborhood: neighborhood,
      address: address,
      description: description,
      hh_menu: hh_menu,
      instagram: instagram,
      social: '',
      schedule: schedule
    };
    byName[name] = r;
    addingNewPlace = false;
    currentModalName = name;
  } else {
    if (!r) return;
    r.description = description;
    r.hh_menu = hh_menu;
    r.instagram = instagram;
    r.address = address;
    r.neighborhood = neighborhood;
    r.schedule = schedule;
  }
  if (neighborhood && NEIGHBORHOODS.indexOf(neighborhood) === -1) {
    NEIGHBORHOODS.push(neighborhood);
    NEIGHBORHOODS.sort();
  }
  var state = loadAppState();
  if (!state.restaurants) state.restaurants = {};
  state.restaurants[name] = {
    description: description,
    hh_menu: hh_menu,
    instagram: instagram,
    neighborhood: neighborhood,
    address: address,
    schedule: schedule
  };
  saveAppState(state);
  if (!isNew && originalName !== name) renameFavorite(originalName, name);
  modalTitle.textContent = r.name;
  modalMeta.textContent = [r.neighborhood, r.address].filter(Boolean).join(' · ');
  populateEditAnySelect();
  if (!Object.keys(schedule).length) {
    var idx = RESTAURANTS.indexOf(r);
    if (idx >= 0) RESTAURANTS.splice(idx, 1);
    renderViewMode(r);
    rebuildNeighborhoodSelect();
    refreshFilters();
    showStatus('Saved ' + name + '. Not on happy hour grid (no times set).');
    return;
  }
  if (RESTAURANTS.indexOf(r) === -1) RESTAURANTS.push(r);
  renderViewMode(r);
  rebuildNeighborhoodSelect();
  refreshFilters();
  showStatus(isNew ? 'Added ' + name + ' on this device.' : 'Saved changes for ' + name + ' on this device.');
}

document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal-edit').addEventListener('click', function() {
  if (!currentModalName) return;
  var r = byName[currentModalName];
  if (!r) return;
  if (editMode) renderViewMode(r);
  else renderEditMode(r);
});
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); closeSettings(); } });

var settingsModal = document.getElementById('settings-modal');
function openSettings() { settingsModal.classList.add('open'); document.body.classList.add('modal-open'); }
function closeSettings() { settingsModal.classList.remove('open'); if (!modal.classList.contains('open')) document.body.classList.remove('modal-open'); }
document.getElementById('settings-btn').addEventListener('click', openSettings);
document.getElementById('settings-close').addEventListener('click', closeSettings);
settingsModal.addEventListener('click', e => { if (e.target === settingsModal) closeSettings(); });

function populateEditAnySelect() {
  var sel = document.getElementById('edit-any-select');
  if (!sel) return;
  var names = Object.keys(byName).sort(function(a, b) { return a.localeCompare(b); });
  sel.innerHTML = '<option value="">Choose a restaurant…</option>';
  names.forEach(function(n) {
    var opt = document.createElement('option');
    opt.value = n;
    opt.textContent = n;
    sel.appendChild(opt);
  });
}
document.getElementById('edit-any-select').addEventListener('change', function() {
  var name = this.value;
  this.value = '';
  if (!name) return;
  closeSettings();
  openModal(name);
  renderEditMode(byName[name]);
});

document.getElementById('dark-mode-toggle').addEventListener('change', function() {
  var state = loadAppState();
  if (!state.settings) state.settings = {};
  state.settings.darkMode = this.checked;
  saveAppState(state);
  applySettings(state.settings);
});
document.getElementById('save-map-url').addEventListener('click', function() {
  var url = document.getElementById('map-url-input').value.trim() || DEFAULT_MAP_URL;
  var state = loadAppState();
  if (!state.settings) state.settings = {};
  state.settings.mapUrl = url;
  saveAppState(state);
  applySettings(state.settings);
  showStatus('Map link saved.');
});
document.getElementById('clear-edits-btn').addEventListener('click', function() {
  if (!confirm('Clear all saved edits, menu photos, and imported Excel changes on this device?')) return;
  clearAllMenuPhotos().finally(function() {
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  });
});

document.getElementById('import-btn').addEventListener('click', function() {
  document.getElementById('import-file').click();
});

document.getElementById('add-btn').addEventListener('click', openAddPlace);

function exportWorkbook() {
  if (typeof XLSX === 'undefined') {
    showError('Excel library failed to load. Connect to the internet and reload.');
    return;
  }
  var names = Object.keys(byName).sort(function(a, b) { return a.localeCompare(b); });
  var descData = [['Name', 'Address', 'Neighborhood', 'Description', 'Social media links', 'Website / Menu']];
  var timeHeaders = ['Restaurant', 'Neighborhood', 'Address'];
  DAY_NAMES.forEach(function(day) {
    timeHeaders.push(day + ' start', day + ' end');
  });
  var timeData = [timeHeaders];
  names.forEach(function(name) {
    var r = byName[name];
    descData.push([
      r.name || name,
      r.address || '',
      r.neighborhood || '',
      r.description || '',
      r.social || '',
      r.hh_menu || ''
    ]);
    if (r.schedule && Object.keys(r.schedule).length) {
      var row = [r.name || name, r.neighborhood || '', r.address || ''];
      DAY_NAMES.forEach(function(day) {
        var s = r.schedule[day];
        if (s && s.start && s.end) row.push(s.start, s.end);
        else row.push('', '');
      });
      timeData.push(row);
    }
  });
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(descData), 'Descriptions');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(timeData), 'Happy Hour Times');
  var d = new Date();
  var stamp = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  XLSX.writeFile(wb, 'dates-around-philly-' + stamp + '.xlsx');
  showStatus('Exported ' + names.length + ' places.');
}

document.getElementById('export-btn').addEventListener('click', exportWorkbook);

function sheetRows(wb, name) {
  if (!wb.Sheets[name]) return [];
  return XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '' });
}
function parseScheduleFromTimesRow(row) {
  var schedule = {};
  DAY_NAMES.forEach(function(day) {
    var start = (row[day + ' start'] || row[day + ' Start'] || '').toString().trim();
    var end = (row[day + ' end'] || row[day + ' End'] || '').toString().trim();
    if (start && end) schedule[day] = { start: start, end: end };
  });
  return schedule;
}
function importWorkbook(wb) {
  var state = loadAppState();
  if (!state.restaurants) state.restaurants = {};
  var descRows = sheetRows(wb, 'Descriptions');
  descRows.forEach(function(row) {
    var name = (row.Name || row.Restaurant || '').toString().trim();
    if (!name) return;
    if (!state.restaurants[name]) state.restaurants[name] = {};
    var o = state.restaurants[name];
    if (row.Description) o.description = String(row.Description).trim();
    if (row['Website / Menu'] || row['Happy hour menu']) o.hh_menu = String(row['Website / Menu'] || row['Happy hour menu']).trim();
    if (row['Social media links']) o.social = String(row['Social media links']).trim();
    if (row.Address) o.address = String(row.Address).trim();
    if (row.Neighborhood) o.neighborhood = String(row.Neighborhood).trim();
  });
  var timeRows = sheetRows(wb, 'Happy Hour Times');
  timeRows.forEach(function(row) {
    var name = (row.Restaurant || row.Name || '').toString().trim();
    if (!name) return;
    if (!state.restaurants[name]) state.restaurants[name] = {};
    var o = state.restaurants[name];
    var sched = parseScheduleFromTimesRow(row);
    if (Object.keys(sched).length) o.schedule = sched;
    if (row.Neighborhood) o.neighborhood = String(row.Neighborhood).trim();
    if (row.Address) o.address = String(row.Address).trim();
  });
  saveAppState(state);
  location.reload();
}

document.getElementById('import-file').addEventListener('change', function(e) {
  var file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (typeof XLSX === 'undefined') {
    showError('Excel library failed to load. Connect to the internet and reload.');
    return;
  }
  var reader = new FileReader();
  reader.onload = function(ev) {
    try {
      var wb = XLSX.read(ev.target.result, { type: 'array' });
      importWorkbook(wb);
    } catch (err) {
      showError('Could not read Excel file: ' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
});

var nSel = document.getElementById('neighborhood');
function rebuildNeighborhoodSelect() {
  var current = nSel.value;
  nSel.innerHTML = '<option value="">All neighborhoods</option>';
  NEIGHBORHOODS.forEach(function(n) {
    var opt = document.createElement('option');
    opt.value = n;
    opt.textContent = n;
    nSel.appendChild(opt);
  });
  if (current && NEIGHBORHOODS.indexOf(current) !== -1) nSel.value = current;
}
var daySel = document.getElementById('day');
function buildTimeOptions(day, selectTime) {
  var tSel = document.getElementById('time');
  tSel.innerHTML = '';
  var filtered = restaurantsForDay(day);
  var minT = Infinity, maxT = -Infinity;
  filtered.forEach(function(r) {
    var s = r.schedule[day];
    minT = Math.min(minT, parseTime(s.start));
    maxT = Math.max(maxT, parseTime(s.end));
  });
  if (!isFinite(minT)) { minT = 12*60; maxT = 20*60; }
  minT = Math.floor(minT / 30) * 30;
  maxT = Math.ceil(maxT / 30) * 30;
  for (var t = minT; t <= maxT; t += 30) {
    var o = document.createElement('option');
    o.value = t;
    o.textContent = fmtMinutes(t);
    tSel.appendChild(o);
  }
  if (selectTime == null) selectTime = pickDefaultTime(day);
  var want = String(selectTime);
  if (tSel.querySelector('option[value="' + want + '"]')) tSel.value = want;
  else if (tSel.options.length) tSel.selectedIndex = 0;
}
function renderListView() {
  var list = getListPlaces();
  var q = getSearchQuery();
  var hood = nSel && nSel.value ? nSel.value : '';
  var summary = document.getElementById('summary');
  var parts = ['<strong>' + list.length + '</strong> place' + (list.length === 1 ? '' : 's')];
  if (hood) parts.push(' in <strong>' + escapeHtml(hood) + '</strong>');
  if (q) parts.push(' matching search');
  summary.innerHTML = parts.join('') + '. Tap a name for details. Star your favorites.';
  var container = document.getElementById('place-list');
  if (!container) return;
  if (!list.length) {
    container.innerHTML = '<p class="list-empty" style="padding:16px;color:var(--muted)">No places match these filters.</p>';
    return;
  }
  container.innerHTML = list.map(function(r) {
    var fav = isFavorite(r.name);
    var hasHH = r.schedule && Object.keys(r.schedule).length;
    var sub = escapeHtml(r.neighborhood || 'No neighborhood');
    if (!hasHH) sub += ' · <span class="list-tag">no HH times yet</span>';
    return '<div class="list-row">'
      + '<button type="button" class="fav-toggle' + (fav ? ' on' : '') + '" data-fav="' + escapeHtml(r.name) + '" aria-label="' + (fav ? 'Unfavorite' : 'Favorite') + '">' + (fav ? '\u2605' : '\u2606') + '</button>'
      + '<button type="button" class="list-link" data-name="' + escapeHtml(r.name) + '">'
      + '<span class="list-title">' + escapeHtml(r.name) + '</span>'
      + '<span class="list-sub">' + sub + '</span>'
      + '</button></div>';
  }).join('');
}

function render() {
  if (viewMode === 'list') {
    renderListView();
    return;
  }
  renderGridView();
}

function renderGridView() {
  const day = daySel.value;
  const selectedTime = +document.getElementById('time').value;
  let filtered = RESTAURANTS.filter(r => r.schedule && r.schedule[day]);
  if (nSel.value) filtered = filtered.filter(r => r.neighborhood === nSel.value);
  filtered = filterBySearch(filtered);
  filtered.sort((a,b) => a.name.localeCompare(b.name));
  var q = getSearchQuery();
  let minT = Infinity, maxT = -Infinity;
  filtered.forEach(r => {
    const s = r.schedule[day];
    minT = Math.min(minT, parseTime(s.start));
    maxT = Math.max(maxT, parseTime(s.end));
  });
  if (!filtered.length) {
    var emptyMsg = q
      ? 'No places matching your search on this day.'
      : 'No happy hour on this day for these filters.';
    document.querySelector('#grid thead').innerHTML = '';
    document.querySelector('#grid tbody').innerHTML = '<tr><td colspan="20">' + emptyMsg + '</td></tr>';
    document.getElementById('summary').textContent = emptyMsg;
    return;
  }
  minT = Math.floor(minT / 30) * 30;
  maxT = Math.ceil(maxT / 30) * 30;
  const slots = [];
  for (let t = minT; t < maxT; t += 30) slots.push(t);
  const activeNow = filtered.filter(r => isActive(r, day, selectedTime));
  document.getElementById('summary').innerHTML = `<strong>${activeNow.length}</strong> place(s) with happy hour at <strong>${fmtMinutes(selectedTime)}</strong> on <strong>${day}</strong>` +
    (nSel.value ? ` in <strong>${nSel.value}</strong>` : '') +
    (activeNow.length ? ': ' + activeNow.map(r => r.name).join(', ') : '');
  const thead = document.querySelector('#grid thead');
  thead.innerHTML = '<tr><th class="rest">Restaurant</th><th class="neigh">Neighborhood</th>' +
    slots.map(t => `<th class="time-header">${fmtMinutes(t)}</th>`).join('') + '</tr>';
  const tbody = document.querySelector('#grid tbody');
  tbody.innerHTML = filtered.map(r => {
    const cells = slots.map(t => {
      const active = isActive(r, day, t);
      const cls = active ? (t === selectedTime ? 'active-now' : 'active') : 'inactive';
      return `<td class="slot ${cls}"></td>`;
    }).join('');
    return `<tr><td class="rest"><button type="button" class="rest-link" data-name="${escapeHtml(r.name)}">${escapeHtml(r.name)}</button></td><td class="neigh">${escapeHtml(r.neighborhood)}</td>${cells}</tr>`;
  }).join('');
}
document.querySelector('#grid tbody').addEventListener('click', e => {
  const btn = e.target.closest('.rest-link');
  if (btn) openModal(btn.dataset.name);
});
function refreshFilters() {
  if (viewMode === 'list') {
    render();
    return;
  }
  buildTimeOptions(daySel.value, pickDefaultTime(daySel.value));
  render();
}

var placeListEl = document.getElementById('place-list');
if (placeListEl) {
  placeListEl.addEventListener('click', function(e) {
    var favBtn = e.target.closest('.fav-toggle');
    if (favBtn) {
      e.preventDefault();
      e.stopPropagation();
      toggleFavorite(favBtn.getAttribute('data-fav'));
      return;
    }
    var link = e.target.closest('.list-link');
    if (link) openModal(link.getAttribute('data-name'));
  });
}

var modalFavBtn = document.getElementById('modal-fav');
if (modalFavBtn) {
  modalFavBtn.addEventListener('click', function() {
    if (currentModalName) toggleFavorite(currentModalName);
  });
}

var viewGridBtn = document.getElementById('view-grid');
var viewListBtn = document.getElementById('view-list');
if (viewGridBtn) viewGridBtn.addEventListener('click', function() { setViewMode('grid'); });
if (viewListBtn) viewListBtn.addEventListener('click', function() { setViewMode('list'); });

var listSortEl = document.getElementById('list-sort');
if (listSortEl) listSortEl.addEventListener('change', function() { if (viewMode === 'list') render(); });

nSel.addEventListener('change', refreshFilters);
daySel.addEventListener('change', refreshFilters);
document.getElementById('time').addEventListener('change', function() {
  if (viewMode === 'grid') render();
});
startApp();
})();
