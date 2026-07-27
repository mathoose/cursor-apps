(function () {
  "use strict";
  var APP_ID = "photo-calendar";
  var STORAGE_KEY = "photo-calendar-v1";
  var PHOTO_DB = "photo-calendar-photos-v1";
  var PHOTO_STORE = "photos";
  var photoUrls = {};
  var pendingPhotos = [];
  var editorPhotoIds = [];
  var editorMood = "";
  var selectedDate = localDateKey(new Date());
  var visibleDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  var toastTimer;

  function localDateKey(date) {
    return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
  }
  function dateFromKey(key) { var p = key.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function newId() { return "photo-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8); }
  function cleanText(value, max) { return String(value || "").trim().slice(0, max); }
  function validDateKey(key) { return /^\d{4}-\d{2}-\d{2}$/.test(key) && !isNaN(dateFromKey(key).getTime()); }
  function defaultState() { return { version: 1, days: {} }; }
  function normalizeDay(day) {
    if (!day || typeof day !== "object") return null;
    var photoIds = Array.isArray(day.photoIds) ? day.photoIds.map(function (id) { return cleanText(id, 80); }).filter(Boolean).slice(0, 24) : [];
    var mood = ["sunny", "happy", "calm", "cloudy", "rainy"].indexOf(day.mood) >= 0 ? day.mood : "";
    return { caption: cleanText(day.caption, 90), note: cleanText(day.note, 4000), mood: mood, photoIds: photoIds, updatedAt: cleanText(day.updatedAt, 40) || new Date().toISOString() };
  }
  function normalizeState(raw) {
    var output = defaultState(), days = raw && raw.days && typeof raw.days === "object" ? raw.days : {};
    Object.keys(days).forEach(function (key) { var day = normalizeDay(days[key]); if (validDateKey(key) && day && (day.caption || day.note || day.mood || day.photoIds.length)) output.days[key] = day; });
    return output;
  }
  function getState() {
    try { return normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null")); } catch (e) { return defaultState(); }
  }
  function saveState(state) { localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeState(state))); }
  function showToast(message) {
    var toast = document.getElementById("toast"); toast.textContent = message; toast.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { toast.classList.remove("show"); }, 2600);
  }
  function openPhotoDb() {
    return new Promise(function (resolve, reject) {
      var request = indexedDB.open(PHOTO_DB, 1);
      request.onerror = function () { reject(request.error); };
      request.onupgradeneeded = function (event) { if (!event.target.result.objectStoreNames.contains(PHOTO_STORE)) event.target.result.createObjectStore(PHOTO_STORE); };
      request.onsuccess = function () { resolve(request.result); };
    });
  }
  function photoKey(id) { return "photo:" + id; }
  function photoTransaction(mode, callback) {
    return openPhotoDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(PHOTO_STORE, mode), result = callback(tx.objectStore(PHOTO_STORE));
        tx.oncomplete = function () { db.close(); resolve(result); }; tx.onerror = function () { db.close(); reject(tx.error); };
      });
    });
  }
  function putPhoto(id, blob) { return photoTransaction("readwrite", function (store) { store.put(blob, photoKey(id)); }); }
  function getPhoto(id) {
    return openPhotoDb().then(function (db) { return new Promise(function (resolve, reject) {
      var tx = db.transaction(PHOTO_STORE, "readonly"), request = tx.objectStore(PHOTO_STORE).get(photoKey(id));
      request.onsuccess = function () { resolve(request.result || null); db.close(); }; request.onerror = function () { reject(request.error); db.close(); };
    }); });
  }
  function deletePhoto(id) {
    if (photoUrls[id]) { URL.revokeObjectURL(photoUrls[id]); delete photoUrls[id]; }
    return photoTransaction("readwrite", function (store) { store.delete(photoKey(id)); });
  }
  function photoUrl(id) {
    if (photoUrls[id]) return Promise.resolve(photoUrls[id]);
    return getPhoto(id).then(function (blob) { if (!blob) return ""; photoUrls[id] = URL.createObjectURL(blob); return photoUrls[id]; }).catch(function () { return ""; });
  }
  function compressFile(file) {
    if (!file || !(file.type || "").match(/^image\//i)) return Promise.reject(new Error("Please choose an image"));
    return new Promise(function (resolve, reject) {
      var sourceUrl = URL.createObjectURL(file), image = new Image();
      image.onload = function () {
        var max = 1500, width = image.naturalWidth, height = image.naturalHeight, scale = Math.min(1, max / Math.max(width, height));
        var canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
        canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height); URL.revokeObjectURL(sourceUrl);
        canvas.toBlob(function (blob) { blob ? resolve(blob) : reject(new Error("Could not prepare image")); }, "image/jpeg", .84);
      };
      image.onerror = function () { URL.revokeObjectURL(sourceUrl); reject(new Error("Could not read image")); };
      image.src = sourceUrl;
    });
  }
  function displayDate(key, format) { return dateFromKey(key).toLocaleDateString(undefined, format || { weekday: "long", month: "long", day: "numeric", year: "numeric" }); }
  var moods = { sunny: "☀︎", happy: "☺", calm: "◌", cloudy: "☁", rainy: "☂" };
  function escapeHtml(value) { return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

  function renderCalendar() {
    var state = getState(), grid = document.getElementById("calendarGrid"), year = visibleDate.getFullYear(), month = visibleDate.getMonth();
    document.getElementById("monthYear").textContent = visibleDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    var start = new Date(year, month, 1), first = start.getDay(), count = new Date(year, month + 1, 0).getDate(), html = "";
    for (var blank = 0; blank < first; blank++) html += '<div class="calendar-day empty" aria-hidden="true"></div>';
    for (var day = 1; day <= count; day++) {
      var key = localDateKey(new Date(year, month, day)), entry = state.days[key], classes = "calendar-day";
      if (entry) classes += " has-entry" + (entry.photoIds.length ? " has-photo" : "");
      if (key === selectedDate) classes += " selected";
      if (key === localDateKey(new Date())) classes += " today";
      html += '<button class="' + classes + '" type="button" data-date="' + key + '" aria-label="' + displayDate(key) + (entry ? ", has journal entry" : "") + '"><span class="day-number">' + day + "</span></button>";
    }
    grid.innerHTML = html;
    grid.querySelectorAll("[data-date]").forEach(function (button) { button.addEventListener("click", function () { selectedDate = button.dataset.date; render(); }); });
    Object.keys(state.days).forEach(function (key) {
      var day = state.days[key]; if (!day.photoIds.length) return;
      var element = grid.querySelector('[data-date="' + key + '"]'); if (!element) return;
      photoUrl(day.photoIds[0]).then(function (url) { if (url && element.isConnected) element.style.backgroundImage = "url('" + url.replace(/'/g, "%27") + "')"; });
    });
  }
  function renderDay() {
    var state = getState(), entry = state.days[selectedDate], title = document.getElementById("dayTitle"), content = document.getElementById("dayContent");
    document.getElementById("dayLabel").textContent = displayDate(selectedDate, { weekday: "long", month: "short", day: "numeric" });
    document.getElementById("editDayButton").hidden = !entry;
    if (!entry) { title.textContent = selectedDate === localDateKey(new Date()) ? "A small moment for you" : "Nothing saved here yet"; content.innerHTML = '<div class="empty-day"><strong>Leave a little trace.</strong><br>Add a photo, a thought, or how this day felt.</div>'; return; }
    title.textContent = entry.caption || "A day worth keeping";
    var detail = '<div class="day-detail">' + (entry.mood ? '<span class="mood-display" aria-label="' + entry.mood + '">' + moods[entry.mood] + "</span>" : "") + (entry.note ? '<p class="note">' + escapeHtml(entry.note) + "</p>" : "") + (entry.photoIds.length ? '<div class="photo-strip" id="photoStrip"></div>' : "") + "</div>";
    content.innerHTML = detail;
    var strip = document.getElementById("photoStrip");
    if (strip) entry.photoIds.slice(0, 9).forEach(function (id, index) {
      var button = document.createElement("button"); button.type = "button"; button.setAttribute("aria-label", "View photo " + (index + 1)); strip.appendChild(button);
      photoUrl(id).then(function (url) { if (url && button.isConnected) button.innerHTML = '<img src="' + url + '" alt="" />'; });
    });
  }
  function render() { renderCalendar(); renderDay(); document.getElementById("addDayButton").innerHTML = getState().days[selectedDate] ? "<span>+</span> Add more to this day" : "<span>+</span> Add to this day"; }

  function renderEditorPhotos() {
    var holder = document.getElementById("editorPhotos"); holder.innerHTML = "";
    editorPhotoIds.forEach(function (id) {
      var box = document.createElement("div"); box.className = "editor-photo"; box.dataset.id = id; box.innerHTML = '<button type="button" aria-label="Remove photo">×</button>'; holder.appendChild(box);
      box.querySelector("button").addEventListener("click", function () { editorPhotoIds = editorPhotoIds.filter(function (value) { return value !== id; }); renderEditorPhotos(); });
      photoUrl(id).then(function (url) { if (url && box.isConnected) box.insertAdjacentHTML("afterbegin", '<img src="' + url + '" alt="" />'); });
    });
    pendingPhotos.forEach(function (item) {
      var box = document.createElement("div"); box.className = "editor-photo"; box.dataset.pending = item.id; box.innerHTML = '<img src="' + item.url + '" alt="" /><button type="button" aria-label="Remove photo">×</button>'; holder.appendChild(box);
      box.querySelector("button").addEventListener("click", function () { URL.revokeObjectURL(item.url); pendingPhotos = pendingPhotos.filter(function (value) { return value.id !== item.id; }); renderEditorPhotos(); });
    });
  }
  function openEditor() {
    var entry = getState().days[selectedDate] || { caption: "", note: "", mood: "", photoIds: [] };
    pendingPhotos.forEach(function (item) { URL.revokeObjectURL(item.url); }); pendingPhotos = []; editorPhotoIds = entry.photoIds.slice(); editorMood = entry.mood;
    document.getElementById("editorHeading").textContent = entry.photoIds.length || entry.note || entry.caption ? "Edit your day" : "Keep this day";
    document.getElementById("editorDate").textContent = displayDate(selectedDate);
    document.getElementById("captionInput").value = entry.caption; document.getElementById("noteInput").value = entry.note; document.getElementById("deleteDayButton").hidden = !getState().days[selectedDate];
    document.querySelectorAll("[data-mood]").forEach(function (button) { button.classList.toggle("active", button.dataset.mood === editorMood); });
    renderEditorPhotos(); document.getElementById("editorModal").hidden = false;
  }
  function closeModal(id) { document.getElementById(id).hidden = true; }
  function saveEditor() {
    var caption = cleanText(document.getElementById("captionInput").value, 90), note = cleanText(document.getElementById("noteInput").value, 4000);
    var newIds = pendingPhotos.map(function (item) { return item.id; }), photoIds = editorPhotoIds.concat(newIds);
    if (!caption && !note && !editorMood && !photoIds.length) { showToast("Add a thought, feeling, or photo first"); return; }
    Promise.all(pendingPhotos.map(function (item) { return putPhoto(item.id, item.blob); })).then(function () {
      var state = getState(), old = state.days[selectedDate] || { photoIds: [] }, kept = {};
      photoIds.forEach(function (id) { kept[id] = true; });
      state.days[selectedDate] = { caption: caption, note: note, mood: editorMood, photoIds: photoIds, updatedAt: new Date().toISOString() }; saveState(state);
      Promise.all(old.photoIds.filter(function (id) { return !kept[id]; }).map(deletePhoto)).catch(function () {});
      pendingPhotos.forEach(function (item) { URL.revokeObjectURL(item.url); }); pendingPhotos = []; closeModal("editorModal"); render(); showToast("Day saved");
    }).catch(function () { showToast("Could not save a photo on this device"); });
  }
  function deleteDay() {
    if (!confirm("Delete this journal day and its photos? This cannot be undone.")) return;
    var state = getState(), entry = state.days[selectedDate]; if (!entry) return;
    delete state.days[selectedDate]; saveState(state); Promise.all(entry.photoIds.map(deletePhoto)).catch(function () {});
    closeModal("editorModal"); render(); showToast("Day deleted");
  }

  function downloadBlob(blob, name) { var link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = name; link.click(); setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000); }
  function exportJson() { downloadBlob(new Blob([JSON.stringify(getState(), null, 2)], { type: "application/json" }), "photo-calendar-journal-" + localDateKey(new Date()) + ".json"); showToast("Journal exported"); }
  function importJson(file) {
    if (!file) return;
    file.text().then(function (text) {
      var parsed = JSON.parse(text), slice = parsed;
      if (window.AppsBackup && AppsBackup.isUnifiedBackup(parsed)) slice = AppsBackup.getAppSlice(parsed, APP_ID);
      if (!slice || !slice.days) throw new Error("No Photo Calendar journal found");
      if (!confirm("Replace this journal's text entries? Photos are not included in imports and current photos will remain on this device.")) return;
      saveState(slice); render(); closeModal("settingsModal"); showToast("Journal imported");
    }).catch(function (error) { showToast(error.message || "Could not import this file"); }).finally(function () { document.getElementById("importJsonInput").value = ""; });
  }
  function crc32(bytes) {
    var table = crc32.table || (crc32.table = (function () { var table = []; for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; } return table; })()), crc = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) crc = table[(crc ^ bytes[i]) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0;
  }
  function u16(value) { return [value & 255, value >>> 8 & 255]; } function u32(value) { return [value & 255, value >>> 8 & 255, value >>> 16 & 255, value >>> 24 & 255]; }
  function zip(entries) {
    var encoder = new TextEncoder(), fileParts = [], directoryParts = [], offset = 0;
    entries.forEach(function (entry) {
      var name = encoder.encode(entry.name), data = entry.data, crc = crc32(data), local = new Uint8Array([80,75,3,4,20,0,0,0,0,0,0,0,0,0].concat(u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0)));
      fileParts.push(local, name, data);
      var directory = new Uint8Array([80,75,1,2,20,0,20,0,0,0,0,0,0,0].concat(u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0),u16(0),u16(0),u16(0),u32(0),u32(offset)));
      directoryParts.push(directory, name); offset += local.length + name.length + data.length;
    });
    var directoryLength = directoryParts.reduce(function (total, part) { return total + part.length; }, 0), footer = new Uint8Array([80,75,5,6,0,0,0,0].concat(u16(entries.length),u16(entries.length),u32(directoryLength),u32(offset),u16(0)));
    return new Blob(fileParts.concat(directoryParts, [footer]), { type: "application/zip" });
  }
  function extension(blob) { return blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg"; }
  function exportPhotos() {
    var button = document.getElementById("exportPhotosButton"), state = getState(), pairs = [];
    Object.keys(state.days).forEach(function (date) { state.days[date].photoIds.forEach(function (id, index) { pairs.push({ date: date, id: id, index: index }); }); });
    if (!pairs.length) { showToast("No photos to export"); return; }
    button.disabled = true; button.querySelector("span").textContent = "Building photo archive…";
    Promise.all(pairs.map(function (pair) { return getPhoto(pair.id).then(function (blob) { return blob ? { pair: pair, blob: blob } : null; }); })).then(function (items) {
      var manifest = { format: "photo-calendar-photos", version: 1, exportedAt: new Date().toISOString(), journal: state, photos: [] }, entries = [{ name: "journal.json", data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) }];
      items.filter(Boolean).forEach(function (item) { var path = "photos/" + item.pair.date + "/" + String(item.pair.index + 1).padStart(2, "0") + "-" + item.pair.id + "." + extension(item.blob); manifest.photos.push({ id: item.pair.id, date: item.pair.date, path: path }); });
      entries[0] = { name: "journal.json", data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) };
      return Promise.all(items.filter(Boolean).map(function (item) { return item.blob.arrayBuffer().then(function (buffer) { var path = "photos/" + item.pair.date + "/" + String(item.pair.index + 1).padStart(2, "0") + "-" + item.pair.id + "." + extension(item.blob); return { name: path, data: new Uint8Array(buffer) }; }); })).then(function (photoEntries) { return zip(entries.concat(photoEntries)); });
    }).then(function (archive) { downloadBlob(archive, "photo-calendar-photos-" + localDateKey(new Date()) + ".zip"); showToast("Photo archive downloaded"); }).catch(function () { showToast("Could not export photos"); }).finally(function () { button.disabled = false; button.querySelector("span").textContent = "Export photos"; });
  }

  document.getElementById("previousMonth").addEventListener("click", function () { visibleDate.setMonth(visibleDate.getMonth() - 1); renderCalendar(); });
  document.getElementById("nextMonth").addEventListener("click", function () { visibleDate.setMonth(visibleDate.getMonth() + 1); renderCalendar(); });
  document.getElementById("todayButton").addEventListener("click", function () { selectedDate = localDateKey(new Date()); visibleDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1); render(); });
  document.getElementById("addDayButton").addEventListener("click", openEditor); document.getElementById("editDayButton").addEventListener("click", openEditor);
  document.getElementById("settingsButton").addEventListener("click", function () { document.getElementById("settingsModal").hidden = false; });
  document.querySelectorAll("[data-close]").forEach(function (button) { button.addEventListener("click", function () { closeModal(button.dataset.close); }); });
  document.querySelectorAll(".modal").forEach(function (modal) { modal.addEventListener("click", function (event) { if (event.target === modal) closeModal(modal.id); }); });
  document.querySelectorAll("[data-mood]").forEach(function (button) { button.addEventListener("click", function () { editorMood = editorMood === button.dataset.mood ? "" : button.dataset.mood; document.querySelectorAll("[data-mood]").forEach(function (item) { item.classList.toggle("active", item.dataset.mood === editorMood); }); }); });
  document.getElementById("addPhotosButton").addEventListener("click", function () {
    AppsPhotoPicker.prompt({ title: "Add photos", multiple: true, onFiles: function (files) {
      Promise.all(files.map(function (file) { return compressFile(file).then(function (blob) { return { id: newId(), blob: blob, url: URL.createObjectURL(blob) }; }); })).then(function (items) { pendingPhotos = pendingPhotos.concat(items); renderEditorPhotos(); }).catch(function (error) { showToast(error.message || "Could not add photo"); });
    }, onInvalid: function () { showToast("Please choose an image"); } });
  });
  document.getElementById("saveDayButton").addEventListener("click", saveEditor); document.getElementById("deleteDayButton").addEventListener("click", deleteDay);
  document.getElementById("exportJsonButton").addEventListener("click", exportJson); document.getElementById("importJsonInput").addEventListener("change", function () { importJson(this.files[0]); }); document.getElementById("exportPhotosButton").addEventListener("click", exportPhotos);
  render();
})();
