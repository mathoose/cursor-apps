(function () {
  'use strict';

  var APP_ID = 'things-book';
  var STORAGE_KEY = 'things-book-v1';
  var PHOTO_DB = 'things-book-photos-v1';
  var PHOTO_STORE = 'photos';
  var MAX_TAGS = 32;
  var MAX_ORIGINAL_BYTES = 8 * 1024 * 1024;

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
    listSheetEditingId: null
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
      return it && it.id && it.listId && it.title;
    }).map(function (it) {
      return {
        id: it.id,
        listId: it.listId,
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

  function getList(listId) {
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
    var items = getState().items.filter(function (it) { return it.listId === listId; });
    if (!tagFilter || tagFilter === 'all') return items;
    return items.filter(function (it) {
      return it.tagIds.indexOf(tagFilter) >= 0;
    });
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
    document.getElementById('addItemBtn').hidden = view !== 'list';
    document.getElementById('tagFiltersWrap').hidden = view !== 'list';

    if (view === 'home') {
      document.getElementById('headerTitle').textContent = 'Things Book';
      document.getElementById('headerSubtitle').textContent = 'Your collections';
      renderHome();
    } else if (view === 'list' && listId) {
      var list = getList(listId);
      document.getElementById('headerTitle').textContent = list ? list.title : 'List';
      document.getElementById('headerSubtitle').textContent = getItemsForList(listId).length + ' things';
      renderTagFilters();
      renderSwipeView();
    }
  }

  function renderHome() {
    var st = getState();
    var feed = document.getElementById('listFeed');
    var empty = document.getElementById('homeEmpty');
    feed.innerHTML = '';

    if (!st.lists.length) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    st.lists.forEach(function (list) {
      var items = getItemsForList(list.id);
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'list-row';
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

      feed.appendChild(row);
      renderStackPreview(list.id, row.querySelector('[data-stack-for]'), items);
    });
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
    clearPendingPhoto();

    var overlay = document.getElementById('itemSheetOverlay');
    var titleEl = document.getElementById('itemSheetTitle');
    var titleInput = document.getElementById('itemTitleInput');
    var notesInput = document.getElementById('itemNotesInput');
    var preview = document.getElementById('itemPhotoPreview');
    var placeholder = document.getElementById('photoPickPlaceholder');
    var saveBtn = document.getElementById('itemSheetSave');

    if (editId) {
      var item = getItem(editId);
      titleEl.textContent = 'Edit thing';
      titleInput.value = item ? item.title : '';
      notesInput.value = item ? item.notes : '';
      ui.itemSelectedTags = item ? item.tagIds.slice() : [];
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
      saveBtn.disabled = !titleInput.value.trim();
    } else {
      titleEl.textContent = 'Add thing';
      titleInput.value = '';
      notesInput.value = '';
      preview.hidden = true;
      placeholder.hidden = false;
      saveBtn.disabled = true;
    }

    document.getElementById('newTagInput').value = '';
    renderItemTagChips();
    overlay.hidden = false;
    titleInput.focus();
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
    var listId = ui.activeListId;
    if (!listId) return;

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
    var listId = ui.activeListId;
    if (!listId) return;

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
    if (ui.editingItemId) {
      document.getElementById('itemSheetSave').disabled = !title;
    } else {
      document.getElementById('itemSheetSave').disabled = !title || !ui.pendingPhotoBlob;
    }
  }

  function saveItem() {
    var listId = ui.activeListId;
    if (!listId) return;

    var title = document.getElementById('itemTitleInput').value.trim();
    var notes = document.getElementById('itemNotesInput').value.trim();
    if (!title) return;

    var st = getState();
    var itemId;

    if (ui.editingItemId) {
      itemId = ui.editingItemId;
      var item = st.items.find(function (it) { return it.id === itemId; });
      if (!item) return;
      item.title = title;
      item.notes = notes;
      item.tagIds = ui.itemSelectedTags.slice();
    } else {
      if (!ui.pendingPhotoBlob) {
        showToast('Add a photo first');
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

    var photoPromise = ui.pendingPhotoBlob
      ? putPhoto(itemId, ui.pendingPhotoBlob).then(function () {
          revokeThumb(itemId);
        })
      : Promise.resolve();

    photoPromise.then(function () {
      closeItemSheet();
      showToast(ui.editingItemId ? 'Thing updated' : 'Thing added');
      ui.swipeIndex = 0;
      if (ui.view === 'list') {
        renderTagFilters();
        renderSwipeView();
      }
      renderHome();
    }).catch(function () {
      showToast('Could not save photo');
    });
  }

  function handlePhotoInput(file) {
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

    document.getElementById('addItemBtn').addEventListener('click', function () {
      openItemSheet();
    });

    document.getElementById('listEmptyAddBtn').addEventListener('click', function () {
      openItemSheet();
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
      document.getElementById('photoInput').click();
    });

    document.getElementById('photoInput').addEventListener('change', function () {
      if (this.files && this.files[0]) handlePhotoInput(this.files[0]);
      this.value = '';
    });

    document.getElementById('detailCloseBtn').addEventListener('click', closeDetail);
    document.getElementById('detailEditBtn').addEventListener('click', function () {
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
