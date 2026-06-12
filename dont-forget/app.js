(function () {
  'use strict';

  var STORAGE_KEY = 'dont-forget-v1';
  var PHOTO_DB = 'dont-forget-photos-v1';
  var PHOTO_STORE = 'photos';
  var MAX_ORIGINAL_BYTES = 8 * 1024 * 1024;
  var RECENT_LIMIT = 5;

  var currentView = 'store';
  var pendingPhotoBlob = null;
  var pendingPreviewUrl = null;
  var detailItemId = null;
  var detailPhotoUrl = null;
  var thumbCache = {};
  var thumbPending = {};

  /* ——— State ——— */

  function newId() {
    return 'item-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function defaultState() {
    return { version: 1, items: [] };
  }

  function normalizeState(raw) {
    var st = raw && typeof raw === 'object' ? raw : defaultState();
    if (!Array.isArray(st.items)) st.items = [];
    st.version = 1;
    st.items = st.items.filter(function (it) {
      return it && it.id && it.name && it.location && it.recordedAt;
    });
    st.items.sort(function (a, b) {
      return new Date(b.recordedAt) - new Date(a.recordedAt);
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

  function hasPhoto(itemId) {
    var st = getState();
    return st.items.some(function (it) { return it.id === itemId; });
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

  function idbGetAllPhotoKeys() {
    return openPhotoDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(PHOTO_STORE, 'readonly');
        var req = tx.objectStore(PHOTO_STORE).getAllKeys();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function invalidateThumb(itemId) {
    if (thumbCache[itemId]) {
      URL.revokeObjectURL(thumbCache[itemId]);
      delete thumbCache[itemId];
    }
    delete thumbPending[itemId];
  }

  function getThumbUrl(itemId) {
    if (thumbCache[itemId]) return Promise.resolve(thumbCache[itemId]);
    if (thumbPending[itemId]) return thumbPending[itemId];
    thumbPending[itemId] = getPhotoBlob(itemId).then(function (blob) {
      delete thumbPending[itemId];
      if (!blob) return null;
      var url = URL.createObjectURL(blob);
      thumbCache[itemId] = url;
      return url;
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

  /* ——— Formatting ——— */

  function formatRelativeTime(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var now = new Date();
    var diffMs = now - d;
    var diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return diffMins + 'm ago';
    var diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return diffHours + 'h ago';
    var diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return diffDays + 'd ago';
    return formatFriendlyDate(iso);
  }

  function formatFriendlyDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var now = new Date();
    var isToday = d.toDateString() === now.toDateString();
    var yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    var isYesterday = d.toDateString() === yesterday.toDateString();
    var timeStr = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (isToday) return 'Today, ' + timeStr;
    if (isYesterday) return 'Yesterday, ' + timeStr;
    var dateStr = d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    return dateStr + ', ' + timeStr;
  }

  function uniqueValues(items, field) {
    var seen = {};
    var out = [];
    items.forEach(function (it) {
      var v = (it[field] || '').trim();
      if (!v) return;
      var key = v.toLowerCase();
      if (!seen[key]) {
        seen[key] = true;
        out.push(v);
      }
    });
    return out;
  }

  /* ——— UI helpers ——— */

  function toast(msg) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove('show'); }, 2200);
  }

  function openOverlay(id) {
    var el = document.getElementById(id);
    if (el) el.classList.add('open');
  }

  function closeOverlay(id) {
    var el = document.getElementById(id);
    if (el) el.classList.remove('open');
  }

  function setView(view) {
    currentView = view;
    document.body.className = 'view-' + view;
    document.querySelectorAll('.nav-btn').forEach(function (btn) {
      var on = btn.getAttribute('data-view') === view;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('main .view').forEach(function (el) {
      el.classList.toggle('active', el.getAttribute('data-view') === view);
    });
    var title = document.getElementById('headerTitle');
    var subtitle = document.getElementById('headerSubtitle');
    if (view === 'store') {
      if (title) title.textContent = "Don't Forget";
      if (subtitle) subtitle.textContent = 'Snap where you left it';
    } else {
      if (title) title.textContent = 'Find it';
      if (subtitle) subtitle.textContent = 'Search what you left behind';
      var search = document.getElementById('findSearch');
      if (search) setTimeout(function () { search.focus(); }, 100);
    }
    render();
  }

  function renderItemRow(item) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'item-row';
    btn.setAttribute('data-id', item.id);

    var thumb = document.createElement('div');
    thumb.className = 'item-row-thumb placeholder';
    thumb.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>';
    btn.appendChild(thumb);

    var body = document.createElement('div');
    body.className = 'item-row-body';
    var name = document.createElement('div');
    name.className = 'item-row-name';
    name.textContent = item.name;
    var meta = document.createElement('div');
    meta.className = 'item-row-meta';
    meta.textContent = item.location + ' · ' + formatRelativeTime(item.recordedAt);
    body.appendChild(name);
    body.appendChild(meta);
    btn.appendChild(body);

    getThumbUrl(item.id).then(function (url) {
      if (!url || !btn.isConnected) return;
      var img = document.createElement('img');
      img.className = 'item-row-thumb';
      img.src = url;
      img.alt = '';
      btn.replaceChild(img, thumb);
    });

    btn.addEventListener('click', function () {
      openDetail(item.id);
    });

    return btn;
  }

  function renderList(containerId, items, emptyId) {
    var container = document.getElementById(containerId);
    var empty = document.getElementById(emptyId);
    if (!container) return;
    container.innerHTML = '';
    if (!items.length) {
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    items.forEach(function (item) {
      container.appendChild(renderItemRow(item));
    });
  }

  function render() {
    var st = getState();
    var recent = st.items.slice(0, RECENT_LIMIT);
    renderList('storeRecentList', recent, 'storeEmpty');

    var query = (document.getElementById('findSearch') || {}).value || '';
    query = query.trim().toLowerCase();
    var findItems;
    var findLabel = document.getElementById('findListLabel');
    var findEmptyText = document.getElementById('findEmptyText');

    if (query) {
      findItems = st.items.filter(function (it) {
        return it.name.toLowerCase().indexOf(query) >= 0;
      });
      if (findLabel) findLabel.textContent = findItems.length ? 'Results' : 'No matches';
      if (findEmptyText) findEmptyText.textContent = 'Nothing matches "' + query + '"';
    } else {
      findItems = st.items;
      if (findLabel) findLabel.textContent = 'Recent';
      if (findEmptyText) findEmptyText.textContent = 'No items yet. Switch to Store to log something.';
    }
    renderList('findList', findItems, 'findEmpty');

    updateDatalists(st);
  }

  function updateDatalists(st) {
    var names = document.getElementById('nameSuggestions');
    var locs = document.getElementById('locationSuggestions');
    if (names) {
      names.innerHTML = '';
      uniqueValues(st.items, 'name').forEach(function (n) {
        var opt = document.createElement('option');
        opt.value = n;
        names.appendChild(opt);
      });
    }
    if (locs) {
      locs.innerHTML = '';
      uniqueValues(st.items, 'location').forEach(function (l) {
        var opt = document.createElement('option');
        opt.value = l;
        locs.appendChild(opt);
      });
    }
  }

  /* ——— Save flow ——— */

  function clearPendingPhoto() {
    pendingPhotoBlob = null;
    if (pendingPreviewUrl) {
      URL.revokeObjectURL(pendingPreviewUrl);
      pendingPreviewUrl = null;
    }
    var preview = document.getElementById('savePhotoPreview');
    if (preview) {
      preview.hidden = true;
      preview.removeAttribute('src');
    }
  }

  function openSaveSheet(blob) {
    pendingPhotoBlob = blob;
    pendingPreviewUrl = URL.createObjectURL(blob);
    var preview = document.getElementById('savePhotoPreview');
    if (preview) {
      preview.src = pendingPreviewUrl;
      preview.hidden = false;
    }
    var what = document.getElementById('saveWhat');
    var where = document.getElementById('saveWhere');
    var saveBtn = document.getElementById('saveBtn');
    if (what) { what.value = ''; }
    if (where) { where.value = ''; }
    if (saveBtn) saveBtn.disabled = true;
    openOverlay('saveOverlay');
    setTimeout(function () { if (what) what.focus(); }, 200);
  }

  function closeSaveSheet() {
    closeOverlay('saveOverlay');
    clearPendingPhoto();
  }

  function updateSaveBtn() {
    var what = (document.getElementById('saveWhat') || {}).value || '';
    var where = (document.getElementById('saveWhere') || {}).value || '';
    var saveBtn = document.getElementById('saveBtn');
    if (saveBtn) saveBtn.disabled = !(what.trim() && where.trim());
  }

  function saveItem() {
    if (!pendingPhotoBlob) return;
    var what = (document.getElementById('saveWhat') || {}).value || '';
    var where = (document.getElementById('saveWhere') || {}).value || '';
    what = what.trim();
    where = where.trim();
    if (!what || !where) return;

    var id = newId();
    var item = {
      id: id,
      name: what,
      location: where,
      recordedAt: new Date().toISOString()
    };

    var blob = pendingPhotoBlob;
    putPhoto(id, blob).then(function () {
      var st = getState();
      st.items.unshift(item);
      saveState(st);
      invalidateThumb(id);
      closeSaveSheet();
      toast('Saved!');
      render();
    }).catch(function () {
      toast('Could not save photo');
    });
  }

  /* ——— Detail ——— */

  function revokeDetailPhoto() {
    if (detailPhotoUrl) {
      URL.revokeObjectURL(detailPhotoUrl);
      detailPhotoUrl = null;
    }
  }

  function openDetail(itemId) {
    var st = getState();
    var item = st.items.find(function (it) { return it.id === itemId; });
    if (!item) return;

    detailItemId = itemId;
    var overlay = document.getElementById('detailOverlay');
    var title = document.getElementById('detailTitle');
    var badges = document.getElementById('detailBadges');
    var photoWrap = document.getElementById('detailPhotoWrap');

    if (title) title.textContent = item.name;
    if (badges) {
      badges.innerHTML =
        '<span class="badge">' +
          '<svg viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>' +
          escapeHtml(item.location) +
        '</span>' +
        '<span class="badge date">' +
          '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>' +
          escapeHtml(formatFriendlyDate(item.recordedAt)) +
        '</span>';
    }
    if (photoWrap) {
      photoWrap.innerHTML = '<span class="detail-photo-loading">Loading photo…</span>';
    }

    if (overlay) {
      overlay.hidden = false;
      overlay.classList.add('open');
    }

    revokeDetailPhoto();
    getPhotoBlob(itemId).then(function (blob) {
      if (detailItemId !== itemId || !photoWrap) return;
      if (!blob) {
        photoWrap.innerHTML = '<span class="detail-photo-loading">No photo found</span>';
        return;
      }
      detailPhotoUrl = URL.createObjectURL(blob);
      photoWrap.innerHTML = '';
      var img = document.createElement('img');
      img.className = 'detail-photo';
      img.src = detailPhotoUrl;
      img.alt = item.name;
      photoWrap.appendChild(img);
    });
  }

  function closeDetail() {
    var overlay = document.getElementById('detailOverlay');
    if (overlay) {
      overlay.classList.remove('open');
      overlay.hidden = true;
    }
    detailItemId = null;
    revokeDetailPhoto();
  }

  function deleteDetailItem() {
    if (!detailItemId) return;
    var st = getState();
    var item = st.items.find(function (it) { return it.id === detailItemId; });
    if (!item) return;
    if (!confirm('Delete "' + item.name + '"?')) return;

    var id = detailItemId;
    deletePhoto(id).then(function () {
      var state = getState();
      state.items = state.items.filter(function (it) { return it.id !== id; });
      saveState(state);
      invalidateThumb(id);
      closeDetail();
      toast('Deleted');
      render();
    }).catch(function () {
      toast('Could not delete');
    });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ——— ZIP backup ——— */

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
      toast('No items to export');
      if (btn) { btn.disabled = false; btn.textContent = 'Export photos (ZIP)'; }
      return;
    }
    var usedNames = {};
    var manifestPhotos = [];
    var tasks = st.items.map(function (item) {
      return getPhotoBlob(item.id).then(function (blob) {
        if (!blob) return null;
        var ext = blobExtension(blob);
        var basePath = 'items/' + sanitizeZipSegment(item.id);
        var fileName = basePath + '.' + ext;
        if (usedNames[fileName]) {
          usedNames[fileName] += 1;
          fileName = basePath + '-' + usedNames[fileName] + '.' + ext;
        } else {
          usedNames[fileName] = 1;
        }
        manifestPhotos.push({
          itemId: item.id,
          name: item.name,
          location: item.location,
          recordedAt: item.recordedAt,
          path: fileName
        });
        return blobToUint8Array(blob).then(function (bytes) {
          return { name: fileName, data: bytes };
        });
      });
    });
    Promise.all(tasks).then(function (results) {
      var zipEntries = results.filter(Boolean);
      if (!zipEntries.length) {
        toast('No photos on this device');
        return null;
      }
      var snapshot = JSON.parse(JSON.stringify(st));
      zipEntries.unshift({
        name: 'manifest.json',
        data: new TextEncoder().encode(JSON.stringify({
          format: 'dont-forget-photos',
          version: 1,
          exportedAt: new Date().toISOString(),
          photoCount: manifestPhotos.length,
          items: snapshot,
          photos: manifestPhotos
        }, null, 2))
      });
      return buildStoreZip(zipEntries);
    }).then(function (zipBlob) {
      if (!zipBlob) return;
      var stamp = new Date().toISOString().slice(0, 10);
      downloadBlob(zipBlob, 'dont-forget-photos-' + stamp + '.zip');
      toast('Photo backup downloaded');
    }).catch(function () {
      toast('Could not export photos');
    }).finally(function () {
      if (btn) { btn.disabled = false; btn.textContent = 'Export photos (ZIP)'; }
    });
  }

  function mergeItemFromPhotoMeta(photo) {
    var st = getState();
    var item = st.items.find(function (it) { return it.id === photo.itemId; });
    if (!item) {
      item = {
        id: photo.itemId || newId(),
        name: photo.name || 'Imported item',
        location: photo.location || 'Unknown',
        recordedAt: photo.recordedAt || new Date().toISOString()
      };
      st.items.unshift(item);
    } else {
      if (photo.name) item.name = photo.name;
      if (photo.location) item.location = photo.location;
      if (photo.recordedAt) item.recordedAt = photo.recordedAt;
    }
    saveState(st);
    return item.id;
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
          toast('Invalid backup — manifest.json missing');
          return;
        }
        var manifest = JSON.parse(new TextDecoder().decode(manifestEntry.data));
        if (manifest.format !== 'dont-forget-photos') {
          toast('Not a Don\'t Forget photo backup');
          return;
        }
        if (manifest.items && Array.isArray(manifest.items.items)) {
          saveState(normalizeState(manifest.items));
        }
        var photos = Array.isArray(manifest.photos) ? manifest.photos : [];
        if (!photos.length) {
          toast('No photos in file');
          return;
        }
        var imported = 0;
        var chain = Promise.resolve();
        photos.forEach(function (photo) {
          chain = chain.then(function () {
            var ze = byName[photo.path];
            if (!ze) return;
            var itemId = mergeItemFromPhotoMeta(photo);
            var blob = new Blob([ze.data], { type: mimeFromPath(photo.path) });
            return putPhoto(itemId, blob).then(function () {
              invalidateThumb(itemId);
              imported++;
            });
          });
        });
        chain.then(function () {
          toast('Imported ' + imported + ' photo' + (imported === 1 ? '' : 's'));
          render();
        }).catch(function () {
          toast('Import failed');
        });
      } catch (e) {
        toast('Could not read ZIP');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function exportJson() {
    var st = getState();
    downloadBlob(
      new Blob([JSON.stringify(st, null, 2)], { type: 'application/json' }),
      'dont-forget-backup-' + new Date().toISOString().slice(0, 10) + '.json'
    );
    toast('Exported');
  }

  function importJson(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = JSON.parse(reader.result);
        var slice = parsed;
        if (typeof AppsBackup !== 'undefined' && AppsBackup.isUnifiedBackup(parsed)) {
          slice = AppsBackup.getAppSlice(parsed, 'dont-forget');
          if (!slice) { toast('No Don\'t Forget data in this file'); return; }
        }
        if (!slice || !Array.isArray(slice.items)) {
          toast('Invalid backup file');
          return;
        }
        var existing = getState();
        var itemIds = {};
        existing.items.forEach(function (it) { itemIds[it.id] = true; });
        var added = 0;
        slice.items.forEach(function (it) {
          if (!itemIds[it.id]) {
            existing.items.push(it);
            itemIds[it.id] = true;
            added++;
          }
        });
        saveState(normalizeState(existing));
        toast(added ? ('Added ' + added + ' item' + (added === 1 ? '' : 's')) : 'No new items to add');
        render();
      } catch (e) {
        toast('Could not read file');
      }
    };
    reader.readAsText(file);
  }

  /* ——— Wire events ——— */

  function wireEvents() {
    document.getElementById('snapBtn').addEventListener('click', function () {
      document.getElementById('cameraInput').click();
    });

    document.getElementById('cameraInput').addEventListener('change', function () {
      var file = this.files && this.files[0];
      this.value = '';
      if (!file || !isValidImageFile(file)) {
        toast('Please choose an image');
        return;
      }
      preparePhotoBlob(file).then(function (blob) {
        openSaveSheet(blob);
      }).catch(function () {
        toast('Could not process photo');
      });
    });

    document.getElementById('saveWhat').addEventListener('input', updateSaveBtn);
    document.getElementById('saveWhere').addEventListener('input', updateSaveBtn);
    document.getElementById('saveWhere').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (!document.getElementById('saveBtn').disabled) saveItem();
      }
    });
    document.getElementById('saveBtn').addEventListener('click', saveItem);
    document.getElementById('saveCancelBtn').addEventListener('click', closeSaveSheet);

    document.getElementById('saveOverlay').addEventListener('click', function (e) {
      if (e.target === this) closeSaveSheet();
    });

    document.querySelectorAll('.nav-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setView(btn.getAttribute('data-view'));
      });
    });

    document.getElementById('findSearch').addEventListener('input', render);

    document.getElementById('detailCloseBtn').addEventListener('click', closeDetail);
    document.getElementById('detailCloseBtn2').addEventListener('click', closeDetail);
    document.getElementById('detailDeleteBtn').addEventListener('click', deleteDetailItem);
    document.getElementById('detailOverlay').addEventListener('click', function (e) {
      if (e.target === this) closeDetail();
    });

    document.getElementById('settingsBtn').addEventListener('click', function () {
      openOverlay('settingsOverlay');
    });
    document.getElementById('settingsCloseBtn').addEventListener('click', function () {
      closeOverlay('settingsOverlay');
    });
    document.getElementById('settingsOverlay').addEventListener('click', function (e) {
      if (e.target === this) closeOverlay('settingsOverlay');
    });

    document.getElementById('exportJsonBtn').addEventListener('click', exportJson);
    document.getElementById('importJsonFile').addEventListener('change', function () {
      var f = this.files && this.files[0];
      this.value = '';
      importJson(f);
    });
    document.getElementById('exportPhotosBtn').addEventListener('click', exportPhotosZip);
    document.getElementById('importPhotosFile').addEventListener('change', function () {
      var f = this.files && this.files[0];
      this.value = '';
      importPhotosZip(f);
    });

    var header = document.getElementById('appHeader');
    window.addEventListener('scroll', function () {
      if (header) header.classList.toggle('scrolled', window.scrollY > 4);
    }, { passive: true });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        closeSaveSheet();
        closeDetail();
        closeOverlay('settingsOverlay');
      }
    });
  }

  /* ——— Init ——— */

  wireEvents();
  render();
})();
