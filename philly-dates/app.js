
(function() {
'use strict';
var STORAGE_KEY = 'philly-dates-v2';
var PHOTO_DB = 'philly-dates-menu-photos-v1';
var PHOTO_STORE = 'menus';
var MAX_TAGS = 24;
var menuPhotoObjectUrl = null;
var menuPhotoUrlCache = {};
var menuPhotoUrlPending = {};
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

function invalidateMenuPhotoCache(name) {
  if (menuPhotoUrlCache[name]) {
    URL.revokeObjectURL(menuPhotoUrlCache[name]);
    delete menuPhotoUrlCache[name];
  }
  delete menuPhotoUrlPending[name];
  if (menuPhotoObjectUrl && currentModalName === name) {
    revokeMenuPhotoUrl();
  }
}

function getMenuPhotoUrl(name) {
  if (menuPhotoUrlCache[name]) return Promise.resolve(menuPhotoUrlCache[name]);
  if (menuPhotoUrlPending[name]) return menuPhotoUrlPending[name];
  menuPhotoUrlPending[name] = getMenuPhotoBlob(name).then(function(blob) {
    delete menuPhotoUrlPending[name];
    if (!blob) {
      setMenuPhotoFlag(name, false);
      invalidateMenuPhotoCache(name);
      return null;
    }
    var url = URL.createObjectURL(blob);
    menuPhotoUrlCache[name] = url;
    return url;
  });
  return menuPhotoUrlPending[name];
}

function reconcileMenuPhotosFromIdb() {
  return openPhotoDb().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx = db.transaction(PHOTO_STORE, 'readonly');
      var req = tx.objectStore(PHOTO_STORE).getAllKeys();
      req.onsuccess = function() {
        var keys = req.result || [];
        var st = loadAppState();
        if (!st.menuPhotos) st.menuPhotos = {};
        var fromIdb = {};
        keys.forEach(function(k) {
          var s = String(k);
          if (s.indexOf('menu:') === 0) {
            var name = s.slice(5);
            fromIdb[name] = true;
            st.menuPhotos[name] = true;
          }
        });
        Object.keys(st.menuPhotos).forEach(function(name) {
          if (!fromIdb[name]) delete st.menuPhotos[name];
        });
        saveAppState(st);
        Object.keys(menuPhotoUrlCache).forEach(function(name) {
          if (!fromIdb[name]) invalidateMenuPhotoCache(name);
        });
        resolve();
      };
      req.onerror = function() { reject(req.error); };
    });
  }).catch(function() {});
}

function renameMenuPhoto(oldName, newName) {
  if (!oldName || !newName || oldName === newName) return Promise.resolve();
  if (!hasMenuPhoto(oldName)) return Promise.resolve();
  return getMenuPhotoBlob(oldName).then(function(blob) {
    if (!blob) {
      setMenuPhotoFlag(oldName, false);
      return;
    }
    return putMenuPhoto(newName, blob).then(function() {
      setMenuPhotoFlag(newName, true);
      return deleteMenuPhotoBlob(oldName).then(function() {
        setMenuPhotoFlag(oldName, false);
        invalidateMenuPhotoCache(oldName);
        invalidateMenuPhotoCache(newName);
      });
    });
  });
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
  getMenuPhotoUrl(name).then(function(url) {
    if (!url || currentModalName !== name) {
      block.innerHTML = '';
      block.hidden = true;
      return;
    }
    menuPhotoObjectUrl = url;
    block.innerHTML = '<p><strong>Saved menu</strong></p><img src="' + url + '" alt="Menu photo">';
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

function slugTagId(label) {
  var base = String(label || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 28);
  var id = base || 'tag';
  var tags = getTags();
  var n = 0;
  while (tags.some(function(t) { return t.id === id; })) {
    n++;
    id = (base || 'tag') + '_' + n;
  }
  return id;
}

function getTags() {
  var st = loadAppState();
  return Array.isArray(st.tags) ? st.tags.slice() : [];
}

function getTagFilter() {
  var st = loadAppState();
  return st.tagFilter || 'all';
}

function setTagFilter(id) {
  var st = loadAppState();
  st.tagFilter = id || 'all';
  saveAppState(st);
  renderTagFilters();
  refreshFilters();
}

function getPlaceMeta(name) {
  var st = loadAppState();
  var m = st.placeMeta && st.placeMeta[name];
  if (!m) return { visited: false, rating: null, tagIds: [] };
  return {
    visited: !!m.visited,
    rating: typeof m.rating === 'number' && m.rating >= 1 && m.rating <= 10 ? m.rating : null,
    tagIds: Array.isArray(m.tagIds) ? m.tagIds.slice() : []
  };
}

function setPlaceMeta(name, patch) {
  if (!name) return;
  var st = loadAppState();
  if (!st.placeMeta) st.placeMeta = {};
  var cur = getPlaceMeta(name);
  var next = {
    visited: patch.visited !== undefined ? !!patch.visited : cur.visited,
    rating: patch.rating !== undefined ? patch.rating : cur.rating,
    tagIds: patch.tagIds !== undefined ? patch.tagIds.slice() : cur.tagIds
  };
  if (next.rating != null) {
    next.rating = Math.min(10, Math.max(1, parseInt(next.rating, 10) || 0)) || null;
  }
  if (!next.visited && next.rating == null && !next.tagIds.length) {
    delete st.placeMeta[name];
  } else {
    st.placeMeta[name] = next;
  }
  saveAppState(st);
}

function renamePlaceMeta(oldName, newName) {
  if (!oldName || !newName || oldName === newName) return;
  var st = loadAppState();
  if (!st.placeMeta || !st.placeMeta[oldName]) return;
  st.placeMeta[newName] = st.placeMeta[oldName];
  delete st.placeMeta[oldName];
  saveAppState(st);
}

function addTag(label) {
  var text = String(label || '').trim().slice(0, 32);
  if (!text) {
    showStatus('Enter a tag name');
    return false;
  }
  var st = loadAppState();
  if (!st.tags) st.tags = [];
  if (st.tags.length >= MAX_TAGS) {
    showStatus('Maximum ' + MAX_TAGS + ' tags');
    return false;
  }
  if (st.tags.some(function(t) { return t.label.toLowerCase() === text.toLowerCase(); })) {
    showStatus('Tag already exists');
    return false;
  }
  st.tags.push({ id: slugTagId(text), label: text });
  saveAppState(st);
  renderTagFilters();
  return true;
}

function deleteTag(id) {
  if (!id) return;
  var st = loadAppState();
  if (!st.tags) return;
  var tag = st.tags.find(function(t) { return t.id === id; });
  if (!tag) return;
  if (!confirm('Delete tag "' + tag.label + '"? It will be removed from all places.')) return;
  st.tags = st.tags.filter(function(t) { return t.id !== id; });
  if (st.tagFilter === id) st.tagFilter = 'all';
  if (st.placeMeta) {
    Object.keys(st.placeMeta).forEach(function(name) {
      var m = st.placeMeta[name];
      if (m && Array.isArray(m.tagIds)) {
        m.tagIds = m.tagIds.filter(function(tid) { return tid !== id; });
        if (!m.visited && m.rating == null && !m.tagIds.length) delete st.placeMeta[name];
      }
    });
  }
  saveAppState(st);
  renderTagFilters();
  refreshFilters();
  if (currentModalName && modal.classList.contains('open') && !editMode) {
    renderViewMode(byName[currentModalName]);
  }
}

function tagLabel(id) {
  var t = getTags().find(function(x) { return x.id === id; });
  return t ? t.label : id;
}

function countPlacesWithTag(id) {
  var st = loadAppState();
  if (!st.placeMeta) return 0;
  var n = 0;
  Object.keys(st.placeMeta).forEach(function(name) {
    var m = st.placeMeta[name];
    if (m && Array.isArray(m.tagIds) && m.tagIds.indexOf(id) >= 0) n++;
  });
  return n;
}

function filterByTag(list) {
  var filter = getTagFilter();
  if (!filter || filter === 'all') return list;
  return list.filter(function(r) {
    var meta = getPlaceMeta(r.name);
    return meta.tagIds.indexOf(filter) >= 0;
  });
}

function getNeverTriedFilter() {
  var st = loadAppState();
  return !!st.filterNeverTried;
}

function setNeverTriedFilter(on) {
  var st = loadAppState();
  st.filterNeverTried = !!on;
  saveAppState(st);
}

function getHappyHourNowFilter() {
  var st = loadAppState();
  return !!st.filterHappyHourNow;
}

function setHappyHourNowFilter(on) {
  var st = loadAppState();
  st.filterHappyHourNow = !!on;
  saveAppState(st);
}

function isNeverTried(name) {
  return !getPlaceMeta(name).visited;
}

function isHappyHourNow(r) {
  var day = getTodayDayName();
  return !!(r.schedule && r.schedule[day] && isActive(r, day, getNowSlot()));
}

function filterByNeverTried(list) {
  if (!getNeverTriedFilter()) return list;
  return list.filter(function(r) { return isNeverTried(r.name); });
}

function filterByHappyHourNow(list) {
  if (!getHappyHourNowFilter()) return list;
  return list.filter(isHappyHourNow);
}

function applyQuickFilters(list) {
  list = filterByNeverTried(list);
  list = filterByHappyHourNow(list);
  return list;
}

function renderTagFilters() {
  var filtersEl = document.getElementById('tag-filters');
  var manageEl = document.getElementById('tag-manage-list');
  if (!filtersEl) return;
  var tags = getTags();
  var active = getTagFilter();
  var html = '<button type="button" class="tag-chip' + (active === 'all' ? ' on' : '') + '" data-tag-filter="all">All</button>';
  tags.forEach(function(tag) {
    html += '<button type="button" class="tag-chip' + (active === tag.id ? ' on' : '') + '" data-tag-filter="' + escapeHtml(tag.id) + '">' + escapeHtml(tag.label) + '</button>';
  });
  filtersEl.innerHTML = html;
  if (manageEl) {
    if (!tags.length) {
      manageEl.innerHTML = '<p class="hint" style="margin:0">No tags yet — add one above.</p>';
    } else {
      manageEl.innerHTML = tags.map(function(tag) {
        var count = countPlacesWithTag(tag.id);
        return '<div class="tag-manage-row">'
          + '<span class="tag-manage-label">' + escapeHtml(tag.label) + '</span>'
          + '<span class="tag-manage-count">' + count + ' place' + (count === 1 ? '' : 's') + '</span>'
          + '<button type="button" class="tag-del-btn" data-tag-del="' + escapeHtml(tag.id) + '">Delete</button>'
          + '</div>';
      }).join('');
    }
  }
}

function bindTagPanel() {
  var filtersEl = document.getElementById('tag-filters');
  if (filtersEl) {
    filtersEl.addEventListener('click', function(e) {
      var chip = e.target.closest('[data-tag-filter]');
      if (!chip) return;
      setTagFilter(chip.getAttribute('data-tag-filter'));
    });
  }
  var manageEl = document.getElementById('tag-manage-list');
  if (manageEl) {
    manageEl.addEventListener('click', function(e) {
      var btn = e.target.closest('[data-tag-del]');
      if (!btn) return;
      deleteTag(btn.getAttribute('data-tag-del'));
    });
  }
  var addBtn = document.getElementById('add-tag-btn');
  var addInp = document.getElementById('new-tag-name');
  if (addBtn && addInp) {
    addBtn.onclick = function() {
      if (addTag(addInp.value)) {
        addInp.value = '';
        showStatus('Tag added');
      }
    };
    addInp.onkeydown = function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        addBtn.click();
      }
    };
  }
}

function renderPlaceMetaPanelHtml(name) {
  var meta = getPlaceMeta(name);
  var tags = getTags();
  var ratingOpts = '<option value="">—</option>';
  for (var i = 1; i <= 10; i++) {
    ratingOpts += '<option value="' + i + '"' + (meta.rating === i ? ' selected' : '') + '>' + i + '</option>';
  }
  var tagChips = '';
  if (!tags.length) {
    tagChips = '<p class="modal-empty" style="margin:0">Add tags at the bottom of the page.</p>';
  } else {
    tagChips = tags.map(function(tag) {
      var on = meta.tagIds.indexOf(tag.id) >= 0;
      return '<button type="button" class="place-tag-chip' + (on ? ' on' : '') + '" data-place-tag="' + escapeHtml(tag.id) + '">' + escapeHtml(tag.label) + '</button>';
    }).join('');
  }
  return '<div class="place-meta-panel" id="place-meta-panel">'
    + '<label class="visited-toggle"><input type="checkbox" id="modal-visited"' + (meta.visited ? ' checked' : '') + ' /> I\'ve been here</label>'
    + '<div class="rating-row"><label for="modal-rating">Rating</label>'
    + '<select id="modal-rating" aria-label="Rating 1 to 10">' + ratingOpts + '</select>'
    + '<span class="hint" style="margin:0">1–10</span></div>'
    + '<div class="place-tags-block"><label>Tags</label><div class="place-tag-chips">' + tagChips + '</div></div>'
    + '</div>';
}

function wirePlaceMetaPanel(name) {
  var visitedEl = document.getElementById('modal-visited');
  if (visitedEl) {
    visitedEl.onchange = function() {
      setPlaceMeta(name, { visited: visitedEl.checked });
      renderModalMeta(byName[name]);
      refreshFilters();
      if (viewMode === 'list') renderListView();
    };
  }
  var ratingEl = document.getElementById('modal-rating');
  if (ratingEl) {
    ratingEl.onchange = function() {
      var v = ratingEl.value ? parseInt(ratingEl.value, 10) : null;
      setPlaceMeta(name, { rating: v });
      renderModalMeta(byName[name]);
      refreshFilters();
      if (viewMode === 'list') renderListView();
    };
  }
  modalBody.querySelectorAll('[data-place-tag]').forEach(function(btn) {
    btn.onclick = function() {
      var id = btn.getAttribute('data-place-tag');
      var meta = getPlaceMeta(name);
      var tagIds = meta.tagIds.slice();
      var i = tagIds.indexOf(id);
      if (i >= 0) tagIds.splice(i, 1);
      else tagIds.push(id);
      setPlaceMeta(name, { tagIds: tagIds });
      btn.classList.toggle('on', tagIds.indexOf(id) >= 0);
      renderTagFilters();
      refreshFilters();
      if (viewMode === 'list') renderListView();
    };
  });
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
  list = filterByTag(list);
  list = applyQuickFilters(list);
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
    if (o.menu_pdf !== undefined) r.menu_pdf = o.menu_pdf;
    if (o.hh_menuPrevious !== undefined) r.hh_menuPrevious = o.hh_menuPrevious;
    if (o.instagram !== undefined) r.instagram = o.instagram;
    if (o.social !== undefined) r.social = o.social;
    if (o.address !== undefined) r.address = o.address;
    if (o.neighborhood !== undefined) r.neighborhood = o.neighborhood;
    if (o.hours !== undefined) r.hours = o.hours;
    if (o.hoursSource !== undefined) r.hoursSource = o.hoursSource;
    if (o.googlePlaceId !== undefined) r.googlePlaceId = o.googlePlaceId;
    if (o.googleMapsUri !== undefined) r.googleMapsUri = o.googleMapsUri;
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
  renderTagFilters();
}

function startApp() {
  reconcileMenuPhotosFromIdb().finally(function() {
  fetch('places.json?v=4')
    .then(function(res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(function(allPlaces) {
      bootstrapData(allPlaces);
      daySel.value = getTodayDayName();
      if (getHappyHourNowFilter()) syncHappyHourNowControls();
      else buildTimeOptions(daySel.value, pickDefaultTime(daySel.value));
      render();
      var searchEl = document.getElementById('search');
      if (searchEl) searchEl.addEventListener('input', refreshFilters);
      showError('');
    })
    .catch(function() {
      showError('Could not load places.json. Open from GitHub Pages (mathoose.github.io/cursor-apps/philly-dates/).');
    });
  });
}

document.addEventListener('visibilitychange', function() {
  if (document.visibilityState === 'visible') reconcileMenuPhotosFromIdb();
});
window.addEventListener('pageshow', function() {
  reconcileMenuPhotosFromIdb();
});

function parseTime(t) {
  if (!t) return NaN;
  const m = String(t).match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i);
  if (!m) return NaN;
  let h = +m[1], min = m[2] ? +m[2] : 0;
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
  list = filterBySearch(list);
  list = filterByTag(list);
  list = applyQuickFilters(list);
  return list;
}
function isActive(r, day, slot) {
  const s = r.schedule[day];
  if (!s) return false;
  return parseTime(s.start) <= slot && slot < parseTime(s.end);
}
function hasGoogleHours(r) {
  return !!(r && r.hoursSource === 'google' && r.hours && Object.keys(r.hours).length);
}

function isPlaceOpenNow(r) {
  if (!r) return false;
  var day = getTodayDayName();
  var now = getNowSlot();
  var dayHours = r.hours && r.hours[day];
  if (!dayHours || !dayHours.open || !dayHours.close) return false;
  var openMin = parseTime(dayHours.open);
  var closeMin = parseTime(dayHours.close);
  if (isNaN(openMin) || isNaN(closeMin)) return false;
  if (closeMin <= openMin) return now >= openMin || now < closeMin;
  return now >= openMin && now < closeMin;
}
function formatTodayHours(r) {
  if (!hasGoogleHours(r)) return '';
  var dayHours = r.hours[getTodayDayName()];
  if (!dayHours) return 'Closed today';
  return 'Open today ' + dayHours.open + ' – ' + dayHours.close;
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

function googleMapsUrl(r) {
  if (!r) return '';
  var uri = (r.googleMapsUri || '').trim();
  if (uri && /^https:\/\/(www\.)?google\.com\/maps/i.test(uri)) return uri;
  var id = (r.googlePlaceId || '').trim();
  if (id) {
    var label = (r.name || '').trim() || 'place';
    return 'https://www.google.com/maps/search/?api=1&query='
      + encodeURIComponent(label) + '&query_place_id=' + encodeURIComponent(id);
  }
  var q = [r.name, r.address, r.neighborhood, 'Philadelphia, PA'].filter(Boolean).join(', ');
  if (!q) return '';
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
}

function isPdfUrl(url) {
  return /\.pdf(\?|#|$)/i.test(String(url || ''));
}

function getPlaceLinkPairs(r) {
  var pairs = [];
  var seen = {};
  function push(label, url) {
    url = String(url || '').trim();
    if (!url || seen[url]) return;
    seen[url] = true;
    pairs.push([label, url]);
  }
  if (r.hh_menu) {
    push(isPdfUrl(r.hh_menu) ? 'Menu' : 'Website', r.hh_menu);
  }
  if (r.menu_pdf) push('Menu', r.menu_pdf);
  if (r.hh_menuPrevious && isPdfUrl(r.hh_menuPrevious)) push('Menu', r.hh_menuPrevious);
  if (r.social && r.social !== r.instagram) push('Social', r.social);
  return pairs;
}

function renderPlaceLinksHtml(r) {
  var pairs = getPlaceLinkPairs(r);
  if (!pairs.length) return '';
  return '<div class="modal-links">' + pairs.map(function(pair) {
    return '<a href="' + escapeHtml(pair[1]) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(pair[0]) + '</a>';
  }).join('') + '</div>';
}

function renderModalFooter(r) {
  var parts = [];
  var mapsUrl = googleMapsUrl(r);
  if (mapsUrl) {
    parts.push('<a class="maps-btn" href="' + escapeHtml(mapsUrl) + '" target="_blank" rel="noopener noreferrer" aria-label="Open in Google Maps">📍 Maps</a>');
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
  let body = renderPlaceMetaPanelHtml(r.name) + formatDescription(r.description);
  body += renderPlaceLinksHtml(r);
  modalBody.innerHTML = '<div id="modal-menu-photo" class="menu-photo-block" hidden></div>' + body;
  showMenuPhotoInModal(r.name);
  renderModalFooter(r);
  updateModalFavButton();
  wirePlaceMetaPanel(r.name);
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
      invalidateMenuPhotoCache(n);
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
        invalidateMenuPhotoCache(n);
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
  renderModalMeta(null);
  renderEditMode(blank);
  modal.classList.add('open');
  updateBodyModalClass();
}

function formatModalMetaHtml(r) {
  var meta = getPlaceMeta(r.name);
  var bits = [];
  if (r.neighborhood) bits.push(escapeHtml(r.neighborhood));
  if (r.address) {
    var mapsUrl = googleMapsUrl(r);
    if (mapsUrl) {
      bits.push('<a class="modal-meta-link" href="' + escapeHtml(mapsUrl) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(r.address) + '</a>');
    } else {
      bits.push(escapeHtml(r.address));
    }
  }
  if (meta.visited) bits.push('Visited');
  if (meta.rating) bits.push('\u2605 ' + meta.rating + '/10');
  return bits.join(' \u00b7 ');
}

function renderModalMeta(r) {
  if (modalMeta) modalMeta.innerHTML = r ? formatModalMetaHtml(r) : '';
}

function formatModalMeta(r) {
  var parts = [r.neighborhood, r.address].filter(Boolean);
  var meta = getPlaceMeta(r.name);
  if (meta.visited) parts.push('Visited');
  if (meta.rating) parts.push('\u2605 ' + meta.rating + '/10');
  return parts.join(' \u00b7 ');
}

function isModalOpen() {
  var pickerEl = document.getElementById('picker-modal');
  var settingsEl = document.getElementById('settings-modal');
  return modal.classList.contains('open')
    || (settingsEl && settingsEl.classList.contains('open'))
    || (pickerEl && pickerEl.classList.contains('open'));
}

function updateBodyModalClass() {
  if (isModalOpen()) document.body.classList.add('modal-open');
  else document.body.classList.remove('modal-open');
}

function openModal(name) {
  const r = byName[name];
  if (!r) return;
  addingNewPlace = false;
  currentModalName = name;
  modalTitle.textContent = r.name;
  renderModalMeta(r);
  renderViewMode(r);
  modal.classList.add('open');
  updateBodyModalClass();
}
function closeModal() {
  modal.classList.remove('open');
  editMode = false;
  addingNewPlace = false;
  currentModalName = '';
  document.getElementById('modal-edit').style.display = '';
  revokeMenuPhotoUrl();
  updateBodyModalClass();
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
  if (!isNew && originalName !== name) {
    renameFavorite(originalName, name);
    renamePlaceMeta(originalName, name);
    renameMenuPhoto(originalName, name);
  }
  modalTitle.textContent = r.name;
  renderModalMeta(r);
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
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); closeSettings(); closePickerModal(); } });

var settingsModal = document.getElementById('settings-modal');
function openSettings() { settingsModal.classList.add('open'); updateBodyModalClass(); }
function closeSettings() { settingsModal.classList.remove('open'); updateBodyModalClass(); }
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

function exportJsonBackup() {
  var st = loadAppState();
  var blob = new Blob([JSON.stringify(st, null, 2)], { type: 'application/json' });
  var a = document.createElement('a');
  var d = new Date();
  var stamp = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  a.href = URL.createObjectURL(blob);
  a.download = 'philly-dates-backup-' + stamp + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
  showStatus('JSON backup downloaded (favorites & edits, not menu photos).');
}

function importJsonBackup(parsed) {
  var slice = parsed;
  if (typeof AppsBackup !== 'undefined' && AppsBackup.isUnifiedBackup(parsed)) {
    slice = AppsBackup.getAppSlice(parsed, 'philly-dates');
    if (!slice) {
      showStatus('No Philly Dates data in this file');
      return;
    }
  }
  if (!slice || typeof slice !== 'object') {
    showStatus('Invalid JSON backup');
    return;
  }
  var existing = loadAppState();
  if (typeof AppsBackup !== 'undefined' && AppsBackup.APP_REGISTRY['philly-dates'] && AppsBackup.APP_REGISTRY['philly-dates'].mergeSlice) {
    slice = AppsBackup.APP_REGISTRY['philly-dates'].mergeSlice(existing, slice);
  } else {
    var favSet = {};
    (existing.favorites || []).forEach(function (f) { favSet[f] = true; });
    slice.favorites = (existing.favorites || []).slice();
    (parsed.favorites || []).forEach(function (f) {
      if (!favSet[f]) slice.favorites.push(f);
    });
    slice.overrides = Object.assign({}, existing.overrides || {}, slice.overrides || {});
    slice.edits = Object.assign({}, existing.edits || {}, slice.edits || {});
  }
  slice.menuPhotos = Object.assign({}, existing.menuPhotos || {}, slice.menuPhotos || {});
  saveAppState(slice);
  reconcileMenuPhotosFromIdb().then(function() { location.reload(); });
}

document.getElementById('export-json-btn').addEventListener('click', exportJsonBackup);
document.getElementById('import-json-btn').addEventListener('click', function() {
  document.getElementById('import-json-file').click();
});
document.getElementById('import-json-file').addEventListener('change', function(e) {
  var file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(ev) {
    try {
      importJsonBackup(JSON.parse(ev.target.result));
    } catch (err) {
      showStatus('Could not read JSON: ' + err.message);
    }
  };
  reader.readAsText(file);
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
  var tagF = getTagFilter();
  var summary = document.getElementById('summary');
  var parts = ['<strong>' + list.length + '</strong> place' + (list.length === 1 ? '' : 's')];
  if (hood) parts.push(' in <strong>' + escapeHtml(hood) + '</strong>');
  if (tagF && tagF !== 'all') parts.push(' tagged <strong>' + escapeHtml(tagLabel(tagF)) + '</strong>');
  if (getHappyHourNowFilter()) parts.push(' with <strong>happy hour right now</strong>');
  if (getNeverTriedFilter()) parts.push(' <strong>never tried</strong>');
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
    var meta = getPlaceMeta(r.name);
    var hasHH = r.schedule && Object.keys(r.schedule).length;
    var sub = escapeHtml(r.neighborhood || 'No neighborhood');
    if (meta.visited) sub += ' · <span class="list-badge">visited</span>';
    if (meta.rating) sub += ' · <span class="list-rating">★ ' + meta.rating + '/10</span>';
    if (!hasHH) sub += ' · <span class="list-tag">no HH times yet</span>';
    if (meta.tagIds.length) {
      sub += ' · ' + meta.tagIds.map(function(id) {
        return '<span class="list-tag">' + escapeHtml(tagLabel(id)) + '</span>';
      }).join(' ');
    }
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
  filtered = filterByTag(filtered);
  filtered = applyQuickFilters(filtered);
  filtered.sort((a,b) => a.name.localeCompare(b.name));
  var q = getSearchQuery();
  var tagF = getTagFilter();
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
  var summaryParts = [];
  if (getHappyHourNowFilter()) {
    summaryParts.push('<strong>' + activeNow.length + '</strong> place' + (activeNow.length === 1 ? '' : 's') + ' with <strong>happy hour right now</strong>');
  } else {
    summaryParts.push('<strong>' + activeNow.length + '</strong> place(s) with happy hour at <strong>' + fmtMinutes(selectedTime) + '</strong> on <strong>' + day + '</strong>');
  }
  if (nSel.value) summaryParts.push('in <strong>' + escapeHtml(nSel.value) + '</strong>');
  if (tagF && tagF !== 'all') summaryParts.push('tag <strong>' + escapeHtml(tagLabel(tagF)) + '</strong>');
  if (getNeverTriedFilter()) summaryParts.push('<strong>never tried</strong>');
  document.getElementById('summary').innerHTML = summaryParts.join(' · ')
    + (activeNow.length ? ': ' + activeNow.map(r => r.name).join(', ') : '');
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
function syncHappyHourNowControls() {
  var hhNowEl = document.getElementById('filter-hh-now');
  if (!hhNowEl) return;
  if (getHappyHourNowFilter()) {
    daySel.value = getTodayDayName();
    buildTimeOptions(daySel.value, getNowSlot());
  }
}

function bindQuickFilters() {
  var hhNowEl = document.getElementById('filter-hh-now');
  var neverTriedEl = document.getElementById('filter-never-tried');
  if (hhNowEl) {
    hhNowEl.checked = getHappyHourNowFilter();
    hhNowEl.addEventListener('change', function() {
      setHappyHourNowFilter(hhNowEl.checked);
      if (pickerHhNow) pickerHhNow.checked = hhNowEl.checked;
      if (hhNowEl.checked) syncHappyHourNowControls();
      refreshFilters();
    });
  }
  if (neverTriedEl) {
    neverTriedEl.checked = getNeverTriedFilter();
    neverTriedEl.addEventListener('change', function() {
      setNeverTriedFilter(neverTriedEl.checked);
      if (pickerNeverTried) pickerNeverTried.checked = neverTriedEl.checked;
      refreshFilters();
    });
  }
}

function refreshFilters() {
  if (viewMode === 'list') {
    render();
    return;
  }
  if (getHappyHourNowFilter()) {
    syncHappyHourNowControls();
  } else {
    buildTimeOptions(daySel.value, pickDefaultTime(daySel.value));
  }
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
daySel.addEventListener('change', function() {
  if (getHappyHourNowFilter()) {
    setHappyHourNowFilter(false);
    var hhNowEl = document.getElementById('filter-hh-now');
    if (hhNowEl) hhNowEl.checked = false;
  }
  refreshFilters();
});
document.getElementById('time').addEventListener('change', function() {
  if (getHappyHourNowFilter()) {
    setHappyHourNowFilter(false);
    var hhNowEl = document.getElementById('filter-hh-now');
    if (hhNowEl) hhNowEl.checked = false;
  }
  if (viewMode === 'grid') render();
});
bindTagPanel();
bindQuickFilters();

var pickerModal = document.getElementById('picker-modal');
var pickerWheel = document.getElementById('picker-wheel');
var pickerWheelCenter = document.getElementById('picker-wheel-center');
var pickerTagChips = document.getElementById('picker-tag-chips');
var pickerNeighborhood = document.getElementById('picker-neighborhood');
var pickerFavoritesOnly = document.getElementById('picker-favorites-only');
var pickerHhNow = document.getElementById('picker-hh-now');
var pickerNeverTried = document.getElementById('picker-never-tried');
var pickerSpinBtn = document.getElementById('picker-spin-btn');
var pickerSpinAgainBtn = document.getElementById('picker-spin-again');
var pickerResult = document.getElementById('picker-result');
var pickerStage = document.getElementById('picker-stage');
var pickerEmpty = document.getElementById('picker-empty');
var pickerBody = document.querySelector('.picker-body');
var pickerSelectedTags = [];
var pickerPool = [];
var pickerRotation = 0;
var pickerSpinning = false;
var pickerWinnerName = '';
var PICKER_COLORS = ['#43a047', '#1976d2', '#f59e0b', '#e53935', '#8e24aa', '#00897b', '#5c6bc0', '#ef6c00'];

function countGoogleHoursPlaces() {
  return Object.keys(byName).filter(function(n) { return hasGoogleHours(byName[n]); }).length;
}

function getPickerPool() {
  var list = Object.keys(byName).map(function(n) { return byName[n]; });
  list = list.filter(function(r) {
    return !hasGoogleHours(r) || isPlaceOpenNow(r);
  });
  if (pickerNeighborhood && pickerNeighborhood.value) {
    list = list.filter(function(r) { return r.neighborhood === pickerNeighborhood.value; });
  }
  if (pickerFavoritesOnly && pickerFavoritesOnly.checked) {
    var favs = getFavorites();
    list = list.filter(function(r) { return favs.indexOf(r.name) >= 0; });
  }
  if (pickerHhNow && pickerHhNow.checked) {
    list = list.filter(isHappyHourNow);
  }
  if (pickerNeverTried && pickerNeverTried.checked) {
    list = list.filter(function(r) { return isNeverTried(r.name); });
  }
  if (pickerSelectedTags.length) {
    list = list.filter(function(r) {
      var meta = getPlaceMeta(r.name);
      return pickerSelectedTags.some(function(id) { return meta.tagIds.indexOf(id) >= 0; });
    });
  }
  list.sort(function(a, b) { return a.name.localeCompare(b.name); });
  return list;
}

function populatePickerNeighborhoodSelect() {
  if (!pickerNeighborhood) return;
  var current = pickerNeighborhood.value;
  pickerNeighborhood.innerHTML = '<option value="">All neighborhoods</option>';
  NEIGHBORHOODS.forEach(function(n) {
    var opt = document.createElement('option');
    opt.value = n;
    opt.textContent = n;
    pickerNeighborhood.appendChild(opt);
  });
  if (current && NEIGHBORHOODS.indexOf(current) >= 0) pickerNeighborhood.value = current;
}

function pickerSubtitle(n) {
  var googleN = countGoogleHoursPlaces();
  var day = getTodayDayName();
  var time = fmtMinutes(getNowSlot());
  var hints = [];
  if (!n) {
    if (pickerHhNow && pickerHhNow.checked) hints.push('no HH right now (' + day + ' ' + time + ')');
    else if (googleN) hints.push('none open now (' + day + ' ' + time + ')');
    return hints.length ? 'No places match — ' + hints[0] : 'No places match these filters';
  }
  if (pickerHhNow && pickerHhNow.checked) hints.push('HH right now');
  else if (googleN) hints.push('open-now filter active');
  return n + ' in the wheel' + (hints.length ? ' · ' + hints.join(' · ') : '');
}

function renderPickerTagChips() {
  if (!pickerTagChips) return;
  var tags = getTags();
  if (!tags.length) {
    pickerTagChips.innerHTML = '<p class="hint" style="margin:0">No tags yet — add tags at the bottom of the page.</p>';
    return;
  }
  pickerTagChips.innerHTML = tags.map(function(tag) {
    var on = pickerSelectedTags.indexOf(tag.id) >= 0;
    return '<button type="button" class="picker-tag-chip' + (on ? ' on' : '') + '" data-picker-tag="' + escapeHtml(tag.id) + '">' + escapeHtml(tag.label) + '</button>';
  }).join('');
}

function buildPickerWheelGradient(n) {
  if (n <= 0) return 'var(--cell-inactive)';
  var angle = 360 / n;
  var stops = [];
  for (var i = 0; i < n; i++) {
    var c = PICKER_COLORS[i % PICKER_COLORS.length];
    stops.push(c + ' ' + (i * angle) + 'deg ' + ((i + 1) * angle) + 'deg');
  }
  return 'conic-gradient(from -90deg, ' + stops.join(', ') + ')';
}

function refreshPickerWheel() {
  pickerPool = getPickerPool();
  var n = pickerPool.length;
  var sub = document.getElementById('picker-sub');
  if (sub) sub.textContent = pickerSubtitle(n);
  if (pickerWheel) {
    pickerWheel.style.background = buildPickerWheelGradient(n);
    pickerWheel.style.transform = 'rotate(' + pickerRotation + 'deg)';
  }
  if (pickerWheelCenter) {
    pickerWheelCenter.textContent = n ? String(n) + '\nspot' + (n === 1 ? '' : 's') : '—';
  }
  if (pickerEmpty) pickerEmpty.hidden = n > 0;
  if (pickerSpinBtn) pickerSpinBtn.disabled = n === 0 || pickerSpinning;
  if (pickerStage) pickerStage.hidden = false;
}

function resetPickerResult() {
  pickerWinnerName = '';
  if (pickerResult) pickerResult.hidden = true;
  if (pickerSpinAgainBtn) pickerSpinAgainBtn.hidden = true;
  if (pickerBody) pickerBody.classList.remove('picker-done');
  if (pickerStage) pickerStage.hidden = false;
}

function renderPickerResult(name) {
  var r = byName[name];
  if (!r || !pickerResult) return;
  pickerWinnerName = name;
  document.getElementById('picker-result-name').textContent = r.name;
  var metaEl = document.getElementById('picker-result-meta');
  var metaHtml = formatModalMetaHtml(r);
  var hoursText = formatTodayHours(r);
  metaEl.innerHTML = hoursText
    ? metaHtml + ' \u00b7 ' + escapeHtml(hoursText)
    : metaHtml;
  var descEl = document.getElementById('picker-result-desc');
  descEl.innerHTML = formatDescription(r.description);
  var linksEl = document.getElementById('picker-result-links');
  var links = [];
  var mapsUrl = googleMapsUrl(r);
  if (mapsUrl) {
    links.push('<a href="' + escapeHtml(mapsUrl) + '" target="_blank" rel="noopener noreferrer">📍 Maps</a>');
  }
  getPlaceLinkPairs(r).forEach(function(pair) {
    links.push('<a href="' + escapeHtml(pair[1]) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(pair[0]) + '</a>');
  });
  if (r.instagram) {
    links.push('<a href="' + escapeHtml(r.instagram) + '" target="_blank" rel="noopener noreferrer">Instagram</a>');
  }
  linksEl.innerHTML = links.join('');
  pickerResult.hidden = false;
  if (pickerBody) pickerBody.classList.add('picker-done');
  if (pickerSpinAgainBtn) pickerSpinAgainBtn.hidden = false;
}

function spinPickerWheel() {
  if (pickerSpinning) return;
  pickerPool = getPickerPool();
  if (!pickerPool.length) return;
  resetPickerResult();
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
  if (pickerBody) pickerBody.classList.add('picker-spinning');
  if (pickerSpinBtn) pickerSpinBtn.disabled = true;
  if (pickerWheel) {
    pickerWheel.classList.add('spinning');
    pickerWheel.style.transform = 'rotate(' + pickerRotation + 'deg)';
  }
  var winnerName = pickerPool[winnerIndex].name;
  setTimeout(function() {
    pickerSpinning = false;
    if (pickerWheel) pickerWheel.classList.remove('spinning');
    if (pickerBody) pickerBody.classList.remove('picker-spinning');
    if (pickerSpinBtn) pickerSpinBtn.disabled = false;
    renderPickerResult(winnerName);
  }, 4300);
}

function openPickerModal() {
  if (!pickerModal) return;
  pickerSelectedTags = [];
  pickerRotation = 0;
  pickerSpinning = false;
  if (pickerFavoritesOnly) pickerFavoritesOnly.checked = false;
  if (pickerHhNow) pickerHhNow.checked = getHappyHourNowFilter();
  if (pickerNeverTried) pickerNeverTried.checked = getNeverTriedFilter();
  if (pickerNeighborhood) pickerNeighborhood.value = '';
  populatePickerNeighborhoodSelect();
  resetPickerResult();
  renderPickerTagChips();
  refreshPickerWheel();
  pickerModal.classList.add('open');
  updateBodyModalClass();
}

function closePickerModal() {
  if (!pickerModal) return;
  pickerModal.classList.remove('open');
  pickerSpinning = false;
  if (pickerWheel) pickerWheel.classList.remove('spinning');
  if (pickerBody) pickerBody.classList.remove('picker-spinning');
  updateBodyModalClass();
}

if (document.getElementById('picker-btn')) {
  document.getElementById('picker-btn').addEventListener('click', openPickerModal);
}
if (document.getElementById('picker-close')) {
  document.getElementById('picker-close').addEventListener('click', closePickerModal);
}
if (pickerModal) {
  pickerModal.addEventListener('click', function(e) {
    if (e.target === pickerModal) closePickerModal();
  });
}
if (pickerTagChips) {
  pickerTagChips.addEventListener('click', function(e) {
    if (pickerSpinning) return;
    var chip = e.target.closest('[data-picker-tag]');
    if (!chip) return;
    var id = chip.getAttribute('data-picker-tag');
    var i = pickerSelectedTags.indexOf(id);
    if (i >= 0) pickerSelectedTags.splice(i, 1);
    else pickerSelectedTags.push(id);
    chip.classList.toggle('on', pickerSelectedTags.indexOf(id) >= 0);
    resetPickerResult();
    refreshPickerWheel();
  });
}
if (pickerFavoritesOnly) {
  pickerFavoritesOnly.addEventListener('change', function() {
    if (pickerSpinning) return;
    resetPickerResult();
    refreshPickerWheel();
  });
}
if (pickerHhNow) {
  pickerHhNow.addEventListener('change', function() {
    if (pickerSpinning) return;
    setHappyHourNowFilter(pickerHhNow.checked);
    var hhNowEl = document.getElementById('filter-hh-now');
    if (hhNowEl) hhNowEl.checked = pickerHhNow.checked;
    if (pickerHhNow.checked) syncHappyHourNowControls();
    resetPickerResult();
    refreshPickerWheel();
    if (viewMode === 'grid') refreshFilters();
    else if (viewMode === 'list') render();
  });
}
if (pickerNeverTried) {
  pickerNeverTried.addEventListener('change', function() {
    if (pickerSpinning) return;
    setNeverTriedFilter(pickerNeverTried.checked);
    var neverTriedEl = document.getElementById('filter-never-tried');
    if (neverTriedEl) neverTriedEl.checked = pickerNeverTried.checked;
    resetPickerResult();
    refreshPickerWheel();
    refreshFilters();
  });
}
if (pickerNeighborhood) {
  pickerNeighborhood.addEventListener('change', function() {
    if (pickerSpinning) return;
    resetPickerResult();
    refreshPickerWheel();
  });
}
if (pickerSpinBtn) {
  pickerSpinBtn.addEventListener('click', spinPickerWheel);
}
if (pickerSpinAgainBtn) {
  pickerSpinAgainBtn.addEventListener('click', function() {
    resetPickerResult();
    refreshPickerWheel();
    spinPickerWheel();
  });
}
if (document.getElementById('picker-view-details')) {
  document.getElementById('picker-view-details').addEventListener('click', function() {
    if (!pickerWinnerName) return;
    closePickerModal();
    openModal(pickerWinnerName);
  });
}

startApp();
})();
