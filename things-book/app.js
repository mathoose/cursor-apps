(function () {
  'use strict';

  var APP_ID = 'things-book';
  var STORAGE_KEY = 'things-book-v1';
  var PHOTO_DB = 'things-book-photos-v1';
  var PHOTO_STORE = 'photos';
  var MAX_TAGS = 32;
  var MAX_ORIGINAL_BYTES = 8 * 1024 * 1024;
  var UNCATEGORIZED_ID = '__uncategorized__';
  var UNCATEGORIZED_COLOR = '#64748b';

  var LIST_COLORS = [
    '#2563eb', '#7c3aed', '#db2777', '#dc2626',
    '#ea580c', '#ca8a04', '#16a34a', '#0891b2'
  ];

  var ui = {
    view: 'home',
    activeListId: null,
    swipeIndex: 0,
    detailItemId: null,
    editingItemId: null,
    pendingPhotoBlob: null,
    pendingPreviewUrl: null,
    selectedColor: LIST_COLORS[0],
    itemSelectedTags: [],
    listSheetEditingId: null,
    filingListId: null
  };

  var thumbCache = {};
  var thumbPending = {};
  var toastTimer = null;

  var touchStartX = 0;
  var touchStartY = 0;
  var touchActive = false;

  function newId(prefix) {
    return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function showToast(msg) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.remove('show');
    }, 2800);
  }

  function defaultState() {
    return {
      version: 1,
      lists: [],
      tags: [],
      items: [],
      tagFilters: {}
    };
  }

  function normalizeState(raw) {
    var st = raw && typeof raw === 'object' ? raw : defaultState();
    if (!Array.isArray(st.lists)) st.lists = [];
    if (!Array.isArray(st.tags)) st.tags = [];
    if (!Array.isArray(st.items)) st.items = [];
    if (!st.tagFilters || typeof st.tagFilters !== 'object') st.tagFilters = {};
    st.version = 1;

    st.lists = st.lists.filter(function (l) {
      return l && l.id && l.title;
    }).map(function (l, i) {
      return {
        id: l.id,
        title: String(l.title).trim(),
        color: l.color || LIST_COLORS[i % LIST_COLORS.length],
        order: typeof l.order === 'number' ? l.order : i,
        createdAt: l.createdAt || new Date().toISOString()
      };
    });

    st.tags = st.tags.filter(function (t) {
      return t && t.id && t.listId && t.label;
    }).map(function (t) {
      return {
        id: t.id,
        listId: t.listId,
        label: String(t.label).trim()
      };
    });

    st.items = st.items.filter(function (it) {
      return it && it.id && it.title;
    }).map(function (it) {
      var listId = it.listId;
      if (!listId || listId === UNCATEGORIZED_ID) listId = UNCATEGORIZED_ID;
      else if (!st.lists.some(function (l) { return l.id === listId; })) listId = UNCATEGORIZED_ID;
      return {
        id: it.id,
        listId: listId,
        title: String(it.title).trim(),
        notes: it.notes ? String(it.notes) : '',
        tagIds: Array.isArray(it.tagIds) ? it.tagIds.slice() : [],
        createdAt: it.createdAt || new Date().toISOString()
      };
    });

    st.lists.sort(function (a, b) { return a.order - b.order; });
    st.items.sort(function (a, b) {
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    return st;
  }

  function getState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      return normalizeState(JSON.parse(raw));
    } catch (e) {
      return defaultState();
    }
  }

  function saveState(st) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeState(st)));
  }

  function isUncategorized(listId) {
    return !listId || listId === UNCATEGORIZED_ID;
  }

  function getUncategorizedList() {
    return {
      id: UNCATEGORIZED_ID,
      title: 'Uncategorized',
      color: UNCATEGORIZED_COLOR,
      order: -1,
      createdAt: ''
    };
  }

  function getList(listId) {
    if (isUncategorized(listId)) return getUncategorizedList();
    return getState().lists.find(function (l) { return l.id === listId; }) || null;
  }

  function getItem(itemId) {
    return getState().items.find(function (it) { return it.id === itemId; }) || null;
  }

  function getTagsForList(listId) {
    return getState().tags.filter(function (t) { return t.listId === listId; });
  }

  function getTagLabel(tagId) {
    var tag = getState().tags.find(function (t) { return t.id === tagId; });
    return tag ? tag.label : '';
  }

  function getItemsForList(listId, tagFilter) {
    var id = isUncategorized(listId) ? UNCATEGORIZED_ID : listId;
    var items = getState().items.filter(function (it) {
      return isUncategorized(it.listId) ? id === UNCATEGORIZED_ID : it.listId === id;
    });
    if (isUncategorized(id) || !tagFilter || tagFilter === 'all') return items;
    return items.filter(function (it) {
      return it.tagIds.indexOf(tagFilter) >= 0;
    });
  }

  function countUncategorized() {
    return getItemsForList(UNCATEGORIZED_ID).length;
  }

  function getTagFilter(listId) {
    var st = getState();
    return st.tagFilters[listId] || 'all';
  }

  function setTagFilter(listId, filter) {
    var st = getState();
    st.tagFilters[listId] = filter;
    saveState(st);
  }

  /* ——— IndexedDB ——— */

  function photoDbKey(itemId) {
    return 'item:' + itemId;
  }

  function openPhotoDb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(PHOTO_DB, 1);
      req.onerror = function () { reject(req.error); };
      req.onsuccess = function () { resolve(req.result); };
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(PHOTO_STORE)) {
          db.createObjectStore(PHOTO_STORE);
        }
      };
    });
  }

  function putPhoto(itemId, blob) {
    return openPhotoDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(PHOTO_STORE, 'readwrite');
        tx.objectStore(PHOTO_STORE).put(blob, photoDbKey(itemId));
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function getPhotoBlob(itemId) {
    return openPhotoDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(PHOTO_STORE, 'readonly');
        var req = tx.objectStore(PHOTO_STORE).get(photoDbKey(itemId));
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function deletePhoto(itemId) {
    return openPhotoDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(PHOTO_STORE, 'readwrite');
        tx.objectStore(PHOTO_STORE).delete(photoDbKey(itemId));
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function revokeThumb(itemId) {
    if (thumbCache[itemId]) {
      URL.revokeObjectURL(thumbCache[itemId]);
      delete thumbCache[itemId];
    }
  }

  function loadThumb(itemId) {
    if (thumbCache[itemId]) {
      return Promise.resolve(thumbCache[itemId]);
    }
    if (thumbPending[itemId]) return thumbPending[itemId];
    thumbPending[itemId] = getPhotoBlob(itemId).then(function (blob) {
      delete thumbPending[itemId];
      if (!blob) return null;
      var url = URL.createObjectURL(blob);
      thumbCache[itemId] = url;
      return url;
    }).catch(function () {
      delete thumbPending[itemId];
      return null;
    });
    return thumbPending[itemId];
  }

  /* ——— Image compression ——— */

  function isValidImageFile(file) {
    if (!file) return false;
    var type = (file.type || '').toLowerCase();
    if (type.indexOf('image/') === 0) return true;
    if (!type) {
      var name = (file.name || '').toLowerCase();
      return /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(name);
    }
    return false;
  }

  function readExifOrientation(file) {
    return new Promise(function (resolve) {
      var reader = new FileReader();
      reader.onerror = function () { resolve(1); };
      reader.onload = function () {
        var view = new DataView(reader.result);
        if (view.getUint16(0, false) !== 0xffd8) { resolve(1); return; }
        var offset = 2;
        while (offset < view.byteLength) {
          var marker = view.getUint16(offset, false);
          offset += 2;
          if (marker === 0xffe1) {
            if (view.getUint32(offset + 2, false) !== 0x45786966) { resolve(1); return; }
            var little = view.getUint16(offset + 6, false) === 0x4949;
            offset += 10;
            var tags = view.getUint16(offset, little);
            offset += 2;
            for (var i = 0; i < tags; i++) {
              if (view.getUint16(offset + i * 12, little) === 0x0112) {
                resolve(view.getUint16(offset + i * 12 + 8, little) || 1);
                return;
              }
            }
          } else if ((marker & 0xff00) !== 0xff00) {
            break;
          } else {
            offset += view.getUint16(offset, false);
          }
        }
        resolve(1);
      };
      reader.readAsArrayBuffer(file.slice(0, 128 * 1024));
    });
  }

  function loadImageFromFile(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('Invalid image'));
      };
      img.src = url;
    });
  }

  function canvasToJpeg(canvas, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (blob) resolve(blob);
        else reject(new Error('Could not compress image'));
      }, 'image/jpeg', quality);
    });
  }

  function drawOrientedImage(ctx, img, orientation, width, height) {
    switch (orientation) {
      case 2: ctx.transform(-1, 0, 0, 1, width, 0); break;
      case 3: ctx.transform(-1, 0, 0, -1, width, height); break;
      case 4: ctx.transform(1, 0, 0, -1, 0, height); break;
      case 5: ctx.transform(0, 1, 1, 0, 0, 0); break;
      case 6: ctx.transform(0, 1, -1, 0, height, 0); break;
      case 7: ctx.transform(0, -1, -1, 0, height, width); break;
      case 8: ctx.transform(0, -1, 1, 0, 0, width); break;
      default: break;
    }
    ctx.drawImage(img, 0, 0, width, height);
  }

  function compressImageWithOrientation(file, maxEdge, orientation) {
    return loadImageFromFile(file).then(function (img) {
      var w = img.naturalWidth;
      var h = img.naturalHeight;
      if (!w || !h) throw new Error('Invalid image dimensions');
      if (w > maxEdge || h > maxEdge) {
        if (w >= h) {
          h = Math.round(h * (maxEdge / w));
          w = maxEdge;
        } else {
          w = Math.round(w * (maxEdge / h));
          h = maxEdge;
        }
      }
      var rot = orientation >= 5 && orientation <= 8;
      var canvas = document.createElement('canvas');
      canvas.width = rot ? h : w;
      canvas.height = rot ? w : h;
      var ctx = canvas.getContext('2d');
      drawOrientedImage(ctx, img, orientation, w, h);
      return canvasToJpeg(canvas, 0.82);
    });
  }

  function compressImage(file) {
    return readExifOrientation(file).then(function (orientation) {
      return compressImageWithOrientation(file, 1200, orientation).catch(function () {
        return compressImageWithOrientation(file, 800, orientation);
      });
    });
  }

  function preparePhotoBlob(file) {
    return compressImage(file).catch(function () {
      if (file.size <= MAX_ORIGINAL_BYTES && isValidImageFile(file)) {
        return file;
      }
      throw new Error('Could not process image');
    });
  }

  function clearPendingPhoto() {
    if (ui.pendingPreviewUrl) {
      URL.revokeObjectURL(ui.pendingPreviewUrl);
      ui.pendingPreviewUrl = null;
    }
    ui.pendingPhotoBlob = null;
  }

  function formatDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  /* ——— Views ——— */

  function setView(view, listId) {
    ui.view = view;
    ui.activeListId = listId || null;
    if (view === 'home') {
      ui.swipeIndex = 0;
    }

    document.body.className = 'view-' + view;
    document.getElementById('viewHome').classList.toggle('active', view === 'home');
    document.getElementById('viewList').hidden = view !== 'list';
    document.getElementById('viewList').classList.toggle('active', view === 'list');

    document.getElementById('backBtn').hidden = view !== 'list';
    document.getElementById('createListBtn').hidden = view !== 'home';
    document.getElementById('importPhotosBtn').hidden = view !== 'home';
    document.getElementById('addItemBtn').hidden = view !== 'list' || isUncategorized(listId);
    document.getElementById('tagFiltersWrap').hidden = view !== 'list' || isUncategorized(listId);

    if (view === 'home') {
      document.getElementById('headerTitle').textContent = 'Things Book';
      var uncatN = countUncategorized();
      document.getElementById('headerSubtitle').textContent = uncatN
        ? (uncatN + ' uncategorized · your collections')
        : 'Your collections';
      renderHome();
    } else if (view === 'list' && listId) {
      var list = getList(listId);
      document.getElementById('headerTitle').textContent = list ? list.title : 'List';
      var n = getItemsForList(listId).length;
      document.getElementById('headerSubtitle').textContent = isUncategorized(listId)
        ? (n + ' to file into lists')
        : (n + ' things');
      if (!isUncategorized(listId)) renderTagFilters();
      else document.getElementById('tagFilters').innerHTML = '';
      renderSwipeView();
    }
  }

  function renderHome() {
    var st = getState();
    var feed = document.getElementById('listFeed');
    var empty = document.getElementById('homeEmpty');
    feed.innerHTML = '';

    var uncatItems = getItemsForList(UNCATEGORIZED_ID);
    if (uncatItems.length) {
      feed.appendChild(buildListRow(getUncategorizedList(), uncatItems));
    }

    st.lists.forEach(function (list) {
      feed.appendChild(buildListRow(list, getItemsForList(list.id)));
    });

    if (!st.lists.length && !uncatItems.length) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
  }

  function buildListRow(list, items) {
    var row = document.createElement('button');
    row.type = 'button';
    row.className = 'list-row' + (list.id === UNCATEGORIZED_ID ? ' list-row-uncat' : '');
    row.setAttribute('data-list-id', list.id);

    var countLabel = items.length ? ('+' + items.length) : '0';
    row.innerHTML =
      '<div class="list-row-bar" style="background:' + escapeHtml(list.color) + '">' +
        '<span>' + escapeHtml(list.title) + '</span>' +
        '<span class="list-row-count">' + countLabel + '</span>' +
      '</div>' +
      '<div class="list-row-stack" data-stack-for="' + escapeHtml(list.id) + '"></div>';

    row.addEventListener('click', function () {
      ui.swipeIndex = 0;
      setView('list', list.id);
    });

    renderStackPreview(list.id, row.querySelector('[data-stack-for]'), items);
    return row;
  }

  function renderStackPreview(listId, container, items) {
    container.innerHTML = '';
    if (!items.length) {
      var ph = document.createElement('div');
      ph.className = 'stack-card layer-0 placeholder';
      ph.textContent = 'No photos yet';
      container.appendChild(ph);
      return;
    }

    var preview = items.slice(0, 3);
    preview.forEach(function (item, i) {
      var card = document.createElement('div');
      card.className = 'stack-card layer-' + i;
      card.setAttribute('data-item-id', item.id);
      container.appendChild(card);
      loadThumb(item.id).then(function (url) {
        if (!url) {
          card.classList.add('placeholder');
          card.textContent = item.title;
          return;
        }
        var img = document.createElement('img');
        img.alt = item.title;
        img.src = url;
        card.appendChild(img);
      });
    });
  }

  function renderTagFilters() {
    var wrap = document.getElementById('tagFilters');
    var listId = ui.activeListId;
    if (!listId) return;

    var filter = getTagFilter(listId);
    var tags = getTagsForList(listId);
    wrap.innerHTML = '';

    var allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = 'tag-chip' + (filter === 'all' ? ' on' : '');
    allBtn.textContent = 'All';
    allBtn.addEventListener('click', function () {
      setTagFilter(listId, 'all');
      ui.swipeIndex = 0;
      renderTagFilters();
      renderSwipeView();
    });
    wrap.appendChild(allBtn);

    tags.forEach(function (tag) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tag-chip' + (filter === tag.id ? ' on' : '');
      btn.textContent = tag.label;
      btn.addEventListener('click', function () {
        setTagFilter(listId, tag.id);
        ui.swipeIndex = 0;
        renderTagFilters();
        renderSwipeView();
      });
      wrap.appendChild(btn);
    });
  }

  function renderSwipeView() {
    var listId = ui.activeListId;
    if (!listId) return;

    var items = getItemsForList(listId, getTagFilter(listId));
    var wrap = document.getElementById('swipeCardWrap');
    var counter = document.getElementById('swipeCounter');
    var swipeArea = document.getElementById('swipeArea');
    var listEmpty = document.getElementById('listEmpty');

    if (!items.length) {
      swipeArea.hidden = true;
      listEmpty.hidden = false;
      counter.textContent = '0 of 0';
      return;
    }

    swipeArea.hidden = false;
    listEmpty.hidden = true;

    var isUncat = isUncategorized(listId);
    var emptyText = document.getElementById('listEmptyText');
    var emptyAdd = document.getElementById('listEmptyAddBtn');
    var emptyImport = document.getElementById('listEmptyImportBtn');
    if (emptyText) {
      emptyText.textContent = isUncat ? 'Nothing to file yet.' : 'No items match this filter.';
    }
    if (emptyAdd) emptyAdd.hidden = isUncat;
    if (emptyImport) emptyImport.hidden = !isUncat;

    if (ui.swipeIndex >= items.length) ui.swipeIndex = items.length - 1;
    if (ui.swipeIndex < 0) ui.swipeIndex = 0;

    wrap.innerHTML = '';
    items.forEach(function (item, i) {
      var card = document.createElement('div');
      card.className = 'swipe-card' + (i === ui.swipeIndex ? ' active' : '');
      card.setAttribute('data-item-id', item.id);

      var tagHtml = item.tagIds.map(function (tid) {
        var label = getTagLabel(tid);
        return label ? '<span class="swipe-card-tag">' + escapeHtml(label) + '</span>' : '';
      }).join('');

      card.innerHTML =
        '<div class="swipe-card-loading swipe-empty">Loading…</div>' +
        '<div class="swipe-card-info">' +
          '<p class="swipe-card-title">' + escapeHtml(item.title) + '</p>' +
          (tagHtml ? '<div class="swipe-card-tags">' + tagHtml + '</div>' : '') +
        '</div>';

      card.addEventListener('click', function () {
        if (i === ui.swipeIndex) openDetail(item.id);
      });

      wrap.appendChild(card);

      loadThumb(item.id).then(function (url) {
        var loading = card.querySelector('.swipe-card-loading');
        if (loading) loading.remove();
        if (url) {
          var img = document.createElement('img');
          img.alt = item.title;
          img.src = url;
          card.insertBefore(img, card.firstChild);
        } else {
          var empty = document.createElement('div');
          empty.className = 'swipe-empty';
          empty.textContent = 'No photo';
          card.insertBefore(empty, card.firstChild);
        }
      });
    });

    counter.textContent = (ui.swipeIndex + 1) + ' of ' + items.length;
    document.getElementById('headerSubtitle').textContent = items.length + ' things';
  }

  function swipePrev() {
    if (ui.swipeIndex > 0) {
      ui.swipeIndex--;
      renderSwipeView();
    }
  }

  function swipeNext() {
    var items = getItemsForList(ui.activeListId, getTagFilter(ui.activeListId));
    if (ui.swipeIndex < items.length - 1) {
      ui.swipeIndex++;
      renderSwipeView();
    }
  }

  function setupSwipeGestures() {
    var wrap = document.getElementById('swipeCardWrap');
    wrap.addEventListener('touchstart', function (e) {
      if (!e.touches.length) return;
      touchActive = true;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }, { passive: true });

    wrap.addEventListener('touchend', function (e) {
      if (!touchActive) return;
      touchActive = false;
      if (!e.changedTouches.length) return;
      var dx = e.changedTouches[0].clientX - touchStartX;
      var dy = e.changedTouches[0].clientY - touchStartY;
      if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;
      if (dx < 0) swipeNext();
      else swipePrev();
    }, { passive: true });
  }

  /* ——— List sheet ——— */

  function openListSheet(editId) {
    ui.listSheetEditingId = editId || null;
    var overlay = document.getElementById('listSheetOverlay');
    var titleInput = document.getElementById('listTitleInput');
    var saveBtn = document.getElementById('listSheetSave');

    if (editId) {
      var list = getList(editId);
      document.getElementById('listSheetTitle').textContent = 'Edit list';
      titleInput.value = list ? list.title : '';
      ui.selectedColor = list ? list.color : LIST_COLORS[0];
    } else {
      document.getElementById('listSheetTitle').textContent = 'New list';
      titleInput.value = '';
      ui.selectedColor = LIST_COLORS[getState().lists.length % LIST_COLORS.length];
    }

    renderColorPicks();
    saveBtn.disabled = !titleInput.value.trim();
    overlay.hidden = false;
    titleInput.focus();
  }

  function closeListSheet() {
    document.getElementById('listSheetOverlay').hidden = true;
    ui.listSheetEditingId = null;
  }

  function renderColorPicks() {
    var container = document.getElementById('colorPicks');
    container.innerHTML = '';
    LIST_COLORS.forEach(function (color) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'color-pick' + (ui.selectedColor === color ? ' on' : '');
      btn.style.background = color;
      btn.setAttribute('aria-label', 'Color ' + color);
      btn.addEventListener('click', function () {
        ui.selectedColor = color;
        renderColorPicks();
      });
      container.appendChild(btn);
    });
  }

  function saveList() {
    var title = document.getElementById('listTitleInput').value.trim();
    if (!title) return;

    var st = getState();
    if (ui.listSheetEditingId) {
      var list = st.lists.find(function (l) { return l.id === ui.listSheetEditingId; });
      if (list) {
        list.title = title;
        list.color = ui.selectedColor;
      }
    } else {
      st.lists.push({
        id: newId('list'),
        title: title,
        color: ui.selectedColor,
        order: st.lists.length,
        createdAt: new Date().toISOString()
      });
    }
    saveState(st);
    closeListSheet();
    showToast(ui.listSheetEditingId ? 'List updated' : 'List created');
    if (ui.view === 'home') renderHome();
    else if (ui.activeListId) setView('list', ui.activeListId);
  }

  function deleteList(listId) {
    if (!confirm('Delete this list and all its items? Photos will be removed too.')) return;

    var st = getState();
    var itemIds = st.items.filter(function (it) { return it.listId === listId; }).map(function (it) { return it.id; });
    st.lists = st.lists.filter(function (l) { return l.id !== listId; });
    st.tags = st.tags.filter(function (t) { return t.listId !== listId; });
    st.items = st.items.filter(function (it) { return it.listId !== listId; });
    delete st.tagFilters[listId];
    saveState(st);

    itemIds.forEach(function (id) {
      revokeThumb(id);
      deletePhoto(id);
    });

    if (ui.activeListId === listId) setView('home');
    else renderHome();
    renderManageLists();
    showToast('List deleted');
  }

  /* ——— Item sheet ——— */

  function openItemSheet(editId) {
    ui.editingItemId = editId || null;
    ui.itemSelectedTags = [];
    ui.filingListId = null;
    clearPendingPhoto();

    var overlay = document.getElementById('itemSheetOverlay');
    var titleEl = document.getElementById('itemSheetTitle');
    var titleInput = document.getElementById('itemTitleInput');
    var notesInput = document.getElementById('itemNotesInput');
    var preview = document.getElementById('itemPhotoPreview');
    var placeholder = document.getElementById('photoPickPlaceholder');
    var saveBtn = document.getElementById('itemSheetSave');
    var fileListField = document.getElementById('fileListField');
    var tagsField = document.getElementById('itemTagsField');

    if (editId) {
      var item = getItem(editId);
      var uncategorized = item && isUncategorized(item.listId);
      titleEl.textContent = uncategorized ? 'File into list' : 'Edit thing';
      titleInput.value = item ? item.title : '';
      notesInput.value = item ? item.notes : '';
      ui.itemSelectedTags = item ? item.tagIds.slice() : [];
      ui.filingListId = uncategorized ? '' : (item ? item.listId : '');
      preview.hidden = true;
      placeholder.hidden = false;
      if (item) {
        loadThumb(item.id).then(function (url) {
          if (url) {
            preview.src = url;
            preview.hidden = false;
            placeholder.hidden = true;
          }
        });
      }
      fileListField.hidden = !uncategorized;
      tagsField.hidden = uncategorized && !ui.filingListId;
      if (uncategorized) renderListSelect('');
      else renderListSelect(item ? item.listId : '');
      saveBtn.disabled = uncategorized ? true : !titleInput.value.trim();
    } else {
      titleEl.textContent = 'Add thing';
      titleInput.value = '';
      notesInput.value = '';
      preview.hidden = true;
      placeholder.hidden = false;
      fileListField.hidden = true;
      tagsField.hidden = false;
      saveBtn.disabled = true;
    }

    document.getElementById('newTagInput').value = '';
    document.getElementById('photoPickHint').hidden = !!editId;
    renderItemTagChips();
    overlay.hidden = false;
    titleInput.focus();
  }

  function renderListSelect(selectedId) {
    var select = document.getElementById('itemListSelect');
    if (!select) return;
    var st = getState();
    select.innerHTML = '<option value="">Choose a list…</option>';
    st.lists.forEach(function (list) {
      var opt = document.createElement('option');
      opt.value = list.id;
      opt.textContent = list.title;
      if (list.id === selectedId) opt.selected = true;
      select.appendChild(opt);
    });
    ui.filingListId = selectedId || '';
  }

  function closeItemSheet() {
    document.getElementById('itemSheetOverlay').hidden = true;
    ui.editingItemId = null;
    clearPendingPhoto();
    var preview = document.getElementById('itemPhotoPreview');
    preview.hidden = true;
    preview.removeAttribute('src');
    document.getElementById('photoPickPlaceholder').hidden = false;
  }

  function renderItemTagChips() {
    var container = document.getElementById('itemTagChips');
    var listId = ui.filingListId || ui.activeListId;
    if (!listId || isUncategorized(listId)) {
      container.innerHTML = '<span style="font-size:0.8125rem;color:var(--text-muted)">Choose a list first to add tags</span>';
      return;
    }

    var tags = getTagsForList(listId);
    container.innerHTML = '';

    if (!tags.length) {
      container.innerHTML = '<span style="font-size:0.8125rem;color:var(--text-muted)">Add tags below to organize things</span>';
      return;
    }

    tags.forEach(function (tag) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tag-chip' + (ui.itemSelectedTags.indexOf(tag.id) >= 0 ? ' on' : '');
      btn.textContent = tag.label;
      btn.addEventListener('click', function () {
        var idx = ui.itemSelectedTags.indexOf(tag.id);
        if (idx >= 0) ui.itemSelectedTags.splice(idx, 1);
        else ui.itemSelectedTags.push(tag.id);
        renderItemTagChips();
      });
      container.appendChild(btn);
    });
  }

  function addTagFromInput() {
    var listId = ui.filingListId || ui.activeListId;
    if (!listId || isUncategorized(listId)) {
      showToast('Choose a list first');
      return;
    }

    var input = document.getElementById('newTagInput');
    var label = input.value.trim();
    if (!label) return;

    var st = getState();
    var existing = st.tags.find(function (t) {
      return t.listId === listId && t.label.toLowerCase() === label.toLowerCase();
    });
    if (existing) {
      if (ui.itemSelectedTags.indexOf(existing.id) < 0) {
        ui.itemSelectedTags.push(existing.id);
      }
      input.value = '';
      renderItemTagChips();
      return;
    }

    var listTags = st.tags.filter(function (t) { return t.listId === listId; });
    if (listTags.length >= MAX_TAGS) {
      showToast('Max ' + MAX_TAGS + ' tags per list');
      return;
    }

    var tag = { id: newId('tag'), listId: listId, label: label };
    st.tags.push(tag);
    saveState(st);
    ui.itemSelectedTags.push(tag.id);
    input.value = '';
    renderItemTagChips();
    if (ui.view === 'list') renderTagFilters();
  }

  function updateItemSaveBtn() {
    var title = document.getElementById('itemTitleInput').value.trim();
    var item = ui.editingItemId ? getItem(ui.editingItemId) : null;
    var filing = item && isUncategorized(item.listId);
    if (ui.editingItemId) {
      if (filing) {
        document.getElementById('itemSheetSave').disabled = !title || !ui.filingListId;
      } else {
        document.getElementById('itemSheetSave').disabled = !title;
      }
    } else {
      document.getElementById('itemSheetSave').disabled = !title || !ui.pendingPhotoBlob;
    }
  }

  function saveItem() {
    var listId = ui.filingListId || ui.activeListId;
    if (!listId && !ui.editingItemId) return;

    var title = document.getElementById('itemTitleInput').value.trim();
    var notes = document.getElementById('itemNotesInput').value.trim();
    if (!title) return;

    var st = getState();
    var itemId;
    var wasUncategorized = false;

    if (ui.editingItemId) {
      itemId = ui.editingItemId;
      var editItem = st.items.find(function (it) { return it.id === itemId; });
      if (!editItem) return;
      wasUncategorized = isUncategorized(editItem.listId);
      editItem.title = title;
      editItem.notes = notes;
      if (ui.filingListId && wasUncategorized) {
        editItem.listId = ui.filingListId;
        editItem.tagIds = ui.itemSelectedTags.filter(function (tid) {
          var tag = st.tags.find(function (t) { return t.id === tid; });
          return tag && tag.listId === ui.filingListId;
        });
      } else {
        editItem.tagIds = ui.itemSelectedTags.slice();
        if (ui.filingListId && !isUncategorized(ui.filingListId)) {
          editItem.listId = ui.filingListId;
        }
      }
    } else {
      if (!ui.pendingPhotoBlob) {
        showToast('Add a photo first');
        return;
      }
      if (isUncategorized(listId)) {
        showToast('Choose a list to add things');
        return;
      }
      itemId = newId('item');
      st.items.unshift({
        id: itemId,
        listId: listId,
        title: title,
        notes: notes,
        tagIds: ui.itemSelectedTags.slice(),
        createdAt: new Date().toISOString()
      });
    }

    saveState(st);

    var toastMsg = 'Thing added';
    if (ui.editingItemId) {
      var saved = st.items.find(function (it) { return it.id === itemId; });
      toastMsg = wasUncategorized && saved && !isUncategorized(saved.listId)
        ? 'Filed into list'
        : 'Thing updated';
    }

    var photoPromise = ui.pendingPhotoBlob
      ? putPhoto(itemId, ui.pendingPhotoBlob).then(function () {
          revokeThumb(itemId);
        })
      : Promise.resolve();

    photoPromise.then(function () {
      closeItemSheet();
      showToast(toastMsg);
      ui.swipeIndex = 0;
      if (ui.view === 'list') {
        if (!isUncategorized(ui.activeListId)) renderTagFilters();
        renderSwipeView();
      }
      renderHome();
    }).catch(function () {
      showToast('Could not save photo');
    });
  }

  function titleFromFilename(name) {
    if (!name) return 'Untitled';
    var base = String(name).replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
    return base || 'Untitled';
  }

  function handlePhotoFiles(files) {
    if (!files || !files.length) return;

    if (!ui.editingItemId && files.length > 1) {
      importPhotosToUncategorized(files);
      return;
    }

    var file = files[0];
    if (!file || !isValidImageFile(file)) {
      showToast('Please choose an image');
      return;
    }
    preparePhotoBlob(file).then(function (blob) {
      clearPendingPhoto();
      ui.pendingPhotoBlob = blob;
      ui.pendingPreviewUrl = URL.createObjectURL(blob);
      var preview = document.getElementById('itemPhotoPreview');
      preview.src = ui.pendingPreviewUrl;
      preview.hidden = false;
      document.getElementById('photoPickPlaceholder').hidden = true;
      updateItemSaveBtn();
    }).catch(function () {
      showToast('Could not process image');
    });
  }

  function importPhotosToUncategorized(files) {
    var st = getState();
    var itemIds = [];
    files.forEach(function (file) {
      if (!isValidImageFile(file)) return;
      var itemId = newId('item');
      itemIds.push({ id: itemId, file: file });
      st.items.unshift({
        id: itemId,
        listId: UNCATEGORIZED_ID,
        title: titleFromFilename(file.name),
        notes: '',
        tagIds: [],
        createdAt: new Date().toISOString()
      });
    });

    if (!itemIds.length) {
      showToast('No valid images selected');
      return;
    }

    saveState(st);
    closeItemSheet();

    Promise.all(itemIds.map(function (row) {
      return preparePhotoBlob(row.file).then(function (blob) {
        return putPhoto(row.id, blob);
      });
    })).then(function () {
      showToast('Imported ' + itemIds.length + ' photo' + (itemIds.length === 1 ? '' : 's') + ' — file when ready');
      ui.swipeIndex = 0;
      if (ui.view === 'list' && isUncategorized(ui.activeListId)) {
        renderSwipeView();
      } else if (ui.view === 'home') {
        renderHome();
      } else {
        renderHome();
        if (ui.view === 'list') renderSwipeView();
      }
    }).catch(function () {
      showToast('Could not save some photos');
      renderHome();
      if (ui.view === 'list') renderSwipeView();
    });
  }

  function promptImportPhotos() {
    if (typeof AppsPhotoPicker === 'undefined') return;
    AppsPhotoPicker.prompt({
      title: 'Import photos',
      multiple: true,
      libraryLabel: 'Choose from Photos',
      cameraLabel: 'Take Photo',
      onFiles: importPhotosToUncategorized,
      onInvalid: function () { showToast('Please choose images'); }
    });
  }

  /* ——— Detail ——— */

  function openDetail(itemId) {
    var item = getItem(itemId);
    if (!item) return;

    ui.detailItemId = itemId;
    var overlay = document.getElementById('detailOverlay');
    document.getElementById('detailTitle').textContent = item.title;
    document.getElementById('detailNotes').textContent = item.notes || '';
    document.getElementById('detailDate').textContent = formatDate(item.createdAt);

    var tagsEl = document.getElementById('detailTags');
    tagsEl.innerHTML = item.tagIds.map(function (tid) {
      var label = getTagLabel(tid);
      return label ? '<span class="detail-tag">' + escapeHtml(label) + '</span>' : '';
    }).join('');

    var wrap = document.getElementById('detailPhotoWrap');
    wrap.innerHTML = '<span class="detail-photo-loading">Loading photo…</span>';

    loadThumb(itemId).then(function (url) {
      wrap.innerHTML = '';
      if (url) {
        var img = document.createElement('img');
        img.alt = item.title;
        img.src = url;
        wrap.appendChild(img);
      } else {
        wrap.innerHTML = '<span class="detail-photo-loading">No photo</span>';
      }
    });

    overlay.hidden = false;

    var fileBtn = document.getElementById('detailFileBtn');
    var editBtn = document.getElementById('detailEditBtn');
    if (fileBtn) fileBtn.hidden = !isUncategorized(item.listId);
    if (editBtn) editBtn.hidden = isUncategorized(item.listId);
  }

  function closeDetail() {
    document.getElementById('detailOverlay').hidden = true;
    ui.detailItemId = null;
  }

  function deleteItem(itemId) {
    if (!confirm('Delete this thing?')) return;

    var st = getState();
    st.items = st.items.filter(function (it) { return it.id !== itemId; });
    saveState(st);
    revokeThumb(itemId);
    deletePhoto(itemId);
    closeDetail();

    var items = getItemsForList(ui.activeListId, getTagFilter(ui.activeListId));
    if (ui.swipeIndex >= items.length) ui.swipeIndex = Math.max(0, items.length - 1);

    renderSwipeView();
    renderHome();
    showToast('Thing deleted');
  }

  /* ——— ZIP photo backup (photos + metadata, date folders) ——— */

  function sanitizeZipSegment(s) {
    return String(s || 'item').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 60);
  }

  function dateFolderFromIso(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return 'unknown-date';
    return d.toISOString().slice(0, 10);
  }

  function blobExtension(blob) {
    var t = (blob && blob.type) || '';
    if (t.indexOf('png') >= 0) return 'png';
    if (t.indexOf('webp') >= 0) return 'webp';
    if (t.indexOf('gif') >= 0) return 'gif';
    return 'jpg';
  }

  function blobToUint8Array(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(new Uint8Array(r.result)); };
      r.onerror = reject;
      r.readAsArrayBuffer(blob);
    });
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
    entries.forEach(function (entry) {
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
    var centralSize = central.reduce(function (sum, part) { return sum + part.length; }, 0);
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
    var btn = document.getElementById('exportPhotosBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Zipping…'; }
    var st = getState();
    if (!st.items.length) {
      showToast('No things to export');
      if (btn) { btn.disabled = false; btn.textContent = 'Export photos (ZIP)'; }
      return;
    }
    var usedNames = {};
    var manifestPhotos = [];
    var tasks = st.items.map(function (item) {
      return getPhotoBlob(item.id).then(function (blob) {
        if (!blob) return null;
        var ext = blobExtension(blob);
        var day = dateFolderFromIso(item.createdAt);
        var base = 'photos/' + day + '/' + sanitizeZipSegment(item.id) + '-' + sanitizeZipSegment(item.title);
        var fileName = base + '.' + ext;
        if (usedNames[fileName]) {
          usedNames[fileName] += 1;
          fileName = base + '-' + usedNames[fileName] + '.' + ext;
        } else {
          usedNames[fileName] = 1;
        }
        manifestPhotos.push({
          itemId: item.id,
          path: fileName,
          title: item.title,
          listId: item.listId,
          notes: item.notes,
          tagIds: item.tagIds,
          createdAt: item.createdAt
        });
        return blobToUint8Array(blob).then(function (bytes) {
          return { name: fileName, data: bytes };
        });
      });
    });
    Promise.all(tasks).then(function (results) {
      var zipEntries = results.filter(Boolean);
      if (!zipEntries.length) {
        showToast('No photos on this device');
        return null;
      }
      zipEntries.unshift({
        name: 'manifest.json',
        data: new TextEncoder().encode(JSON.stringify({
          format: 'things-book-photos',
          version: 1,
          exportedAt: new Date().toISOString(),
          photoCount: manifestPhotos.length,
          state: st,
          photos: manifestPhotos
        }, null, 2))
      });
      return buildStoreZip(zipEntries);
    }).then(function (zipBlob) {
      if (!zipBlob) return;
      downloadBlob(zipBlob, 'things-book-photos-' + new Date().toISOString().slice(0, 10) + '.zip');
      showToast('Photo backup downloaded');
    }).catch(function () {
      showToast('Could not export photos');
    }).finally(function () {
      if (btn) { btn.disabled = false; btn.textContent = 'Export photos (ZIP)'; }
    });
  }

  function importPhotosZip(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var zipEntries = parseStoreZip(reader.result);
        var byName = {};
        zipEntries.forEach(function (z) { byName[z.name] = z; });
        var manifestEntry = zipEntries.find(function (z) { return z.name === 'manifest.json'; });
        if (!manifestEntry) {
          showToast('Invalid backup — manifest.json missing');
          return;
        }
        var manifest = JSON.parse(new TextDecoder().decode(manifestEntry.data));
        if (manifest.format !== 'things-book-photos') {
          showToast('Not a Things Book photo backup');
          return;
        }
        if (manifest.state) {
          saveState(normalizeState(manifest.state));
        }
        var photos = Array.isArray(manifest.photos) ? manifest.photos : [];
        if (!photos.length) {
          showToast('No photos in file');
          return;
        }
        var imported = 0;
        var chain = Promise.resolve();
        photos.forEach(function (photo) {
          chain = chain.then(function () {
            var ze = byName[photo.path];
            if (!ze) return;
            var blob = new Blob([ze.data], { type: mimeFromPath(photo.path) });
            return putPhoto(photo.itemId, blob).then(function () {
              revokeThumb(photo.itemId);
              imported++;
            });
          });
        });
        chain.then(function () {
          showToast('Restored ' + imported + ' photo' + (imported === 1 ? '' : 's'));
          closeSettings();
          setView('home');
        }).catch(function () {
          showToast('Import failed');
        });
      } catch (e) {
        showToast('Could not read ZIP');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  /* ——— Settings ——— */

  function openSettings() {
    renderManageLists();
    document.getElementById('settingsOverlay').hidden = false;
  }

  function closeSettings() {
    document.getElementById('settingsOverlay').hidden = true;
  }

  function renderManageLists() {
    var container = document.getElementById('manageLists');
    var st = getState();
    container.innerHTML = '';

    if (!st.lists.length) {
      container.innerHTML = '<p style="font-size:0.875rem;color:var(--text-muted)">No lists yet</p>';
      return;
    }

    st.lists.forEach(function (list) {
      var row = document.createElement('div');
      row.className = 'manage-list-row';
      row.innerHTML =
        '<span class="manage-list-dot" style="background:' + escapeHtml(list.color) + '"></span>' +
        '<span class="manage-list-name">' + escapeHtml(list.title) + '</span>' +
        '<button type="button" class="manage-list-del" data-del="' + escapeHtml(list.id) + '">Delete</button>';
      container.appendChild(row);
    });

    container.querySelectorAll('.manage-list-del').forEach(function (btn) {
      btn.addEventListener('click', function () {
        deleteList(btn.getAttribute('data-del'));
      });
    });
  }

  function exportJson() {
    var st = getState();
    var blob = new Blob([JSON.stringify(st, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'things-book-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('Exported JSON');
  }

  function importJson(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = JSON.parse(reader.result);
        var slice = parsed;
        if (typeof AppsBackup !== 'undefined' && AppsBackup.isUnifiedBackup(parsed)) {
          slice = AppsBackup.getAppSlice(parsed, APP_ID);
          if (!slice) {
            showToast('No Things Book data in that file');
            return;
          }
        }
        if (!slice || !Array.isArray(slice.lists)) {
          showToast('Invalid backup file');
          return;
        }
        saveState(slice);
        showToast('Imported successfully');
        closeSettings();
        setView('home');
      } catch (e) {
        showToast('Could not read file');
      }
    };
    reader.readAsText(file);
  }

  /* ——— Init ——— */

  function bindEvents() {
    document.getElementById('createListBtn').addEventListener('click', function () {
      openListSheet();
    });

    document.getElementById('importPhotosBtn').addEventListener('click', promptImportPhotos);

    document.getElementById('addItemBtn').addEventListener('click', function () {
      openItemSheet();
    });

    document.getElementById('listEmptyAddBtn').addEventListener('click', function () {
      openItemSheet();
    });

    document.getElementById('listEmptyImportBtn').addEventListener('click', promptImportPhotos);

    document.getElementById('itemListSelect').addEventListener('change', function () {
      ui.filingListId = this.value;
      document.getElementById('itemTagsField').hidden = !ui.filingListId;
      ui.itemSelectedTags = [];
      renderItemTagChips();
      updateItemSaveBtn();
    });

    document.getElementById('backBtn').addEventListener('click', function () {
      setView('home');
    });

    document.getElementById('swipePrev').addEventListener('click', swipePrev);
    document.getElementById('swipeNext').addEventListener('click', swipeNext);

    document.getElementById('listSheetCancel').addEventListener('click', closeListSheet);
    document.getElementById('listSheetSave').addEventListener('click', saveList);
    document.getElementById('listTitleInput').addEventListener('input', function () {
      document.getElementById('listSheetSave').disabled = !this.value.trim();
    });

    document.getElementById('itemSheetCancel').addEventListener('click', closeItemSheet);
    document.getElementById('itemSheetSave').addEventListener('click', saveItem);
    document.getElementById('itemTitleInput').addEventListener('input', updateItemSaveBtn);
    document.getElementById('addTagBtn').addEventListener('click', addTagFromInput);
    document.getElementById('newTagInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') addTagFromInput();
    });

    document.getElementById('photoPickBtn').addEventListener('click', function () {
      if (typeof AppsPhotoPicker === 'undefined') return;
      AppsPhotoPicker.prompt({
        title: ui.editingItemId ? 'Replace photo' : 'Add photo',
        multiple: !ui.editingItemId,
        onFiles: handlePhotoFiles,
        onInvalid: function () { showToast('Please choose an image'); }
      });
    });

    document.getElementById('detailCloseBtn').addEventListener('click', closeDetail);
    document.getElementById('detailEditBtn').addEventListener('click', function () {
      var id = ui.detailItemId;
      closeDetail();
      if (id) openItemSheet(id);
    });
    document.getElementById('detailFileBtn').addEventListener('click', function () {
      var id = ui.detailItemId;
      closeDetail();
      if (id) openItemSheet(id);
    });
    document.getElementById('detailDeleteBtn').addEventListener('click', function () {
      if (ui.detailItemId) deleteItem(ui.detailItemId);
    });

    document.getElementById('settingsBtn').addEventListener('click', openSettings);
    document.getElementById('settingsCloseBtn').addEventListener('click', closeSettings);
    document.getElementById('exportJsonBtn').addEventListener('click', exportJson);
    document.getElementById('importJsonFile').addEventListener('change', function () {
      if (this.files && this.files[0]) importJson(this.files[0]);
      this.value = '';
    });
    document.getElementById('exportPhotosBtn').addEventListener('click', exportPhotosZip);
    document.getElementById('importPhotosFile').addEventListener('change', function () {
      if (this.files && this.files[0]) importPhotosZip(this.files[0]);
      this.value = '';
    });

    document.querySelectorAll('.overlay').forEach(function (overlay) {
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) {
          if (overlay.id === 'listSheetOverlay') closeListSheet();
          else if (overlay.id === 'itemSheetOverlay') closeItemSheet();
          else if (overlay.id === 'settingsOverlay') closeSettings();
        }
      });
    });

    var header = document.getElementById('appHeader');
    window.addEventListener('scroll', function () {
      header.classList.toggle('scrolled', window.scrollY > 4);
    }, { passive: true });

    setupSwipeGestures();
  }

  function init() {
    bindEvents();
    setView('home');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
