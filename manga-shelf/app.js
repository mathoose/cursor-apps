(function () {
  "use strict";

  var STORAGE_KEY = "manga-shelf-v1";
  var ANILIST_URL = "https://graphql.anilist.co";

  var state = { items: [], seriesMeta: {} };
  var lookupCache = {};
  var currentView = "track";

  var $ = function (id) { return document.getElementById(id); };

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function migrateFromV1(parsed) {
    if (Array.isArray(parsed.items)) {
      state.items = parsed.items;
      state.seriesMeta = parsed.seriesMeta || {};
      return;
    }
    if (!Array.isArray(parsed.volumes)) return;
    var bySeries = {};
    parsed.volumes.forEach(function (vol) {
      var key = vol.series;
      if (!bySeries[key]) {
        bySeries[key] = {
          id: uid(),
          kind: "manga",
          title: key,
          volumes: [],
          logs: [],
        };
      }
      bySeries[key].volumes.push({
        id: vol.id || uid(),
        volume: vol.volume,
        filename: vol.filename || "",
        format: vol.format || "pdf",
        status: vol.status || "have",
        path: vol.path || "",
        notes: vol.notes || "",
      });
    });
    state.items = Object.keys(bySeries).map(function (k) { return bySeries[k]; });
    state.seriesMeta = parsed.seriesMeta || {};
    save();
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      migrateFromV1(parsed);
    } catch (e) { /* ignore */ }
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: 2,
      items: state.items,
      seriesMeta: state.seriesMeta,
    }));
  }

  function normalize(s) {
    return (s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  }

  function parseSearchQuery(q) {
    q = (q || "").trim();
    if (!q) return { series: "", volume: null, raw: q };

    var volPatterns = [
      /\b(?:vol(?:ume)?\.?\s*#?\s*)(\d+)\b/i,
      /\b(?:v\.?\s*#?\s*)(\d+)\b/i,
      /\b#\s*(\d+)\b/,
      /\b(\d+)\s*$/,
    ];

    var volume = null;
    var series = q;

    for (var i = 0; i < volPatterns.length; i++) {
      var m = q.match(volPatterns[i]);
      if (m) {
        volume = parseInt(m[1], 10);
        series = q.slice(0, m.index).replace(/[\s\-–—,:]+$/, "").trim();
        break;
      }
    }

    return { series: series, volume: volume, raw: q };
  }

  function parseFilename(name) {
    name = (name || "").replace(/\.(pdf|epub|cbz|cbr|mobi|azw3|zip)$/i, "").trim();
    if (!name) return null;

    var patterns = [
      /^(.+?)\s*[-–—]\s*(?:vol(?:ume)?\.?\s*)(\d+)\s*$/i,
      /^(.+?)\s*[-–—]\s*v\.?\s*(\d+)\s*$/i,
      /^(.+?)[_\s]+v(?:ol)?\.?\s*(\d+)\s*$/i,
      /^(.+?)\s+(?:vol(?:ume)?\.?\s*)(\d+)\s*$/i,
      /^(.+?)\s+#(\d+)\s*$/,
      /^(.+?)\s+(\d{1,4})\s*$/,
    ];

    for (var i = 0; i < patterns.length; i++) {
      var m = name.match(patterns[i]);
      if (m) {
        return {
          series: m[1].replace(/[_\.]+/g, " ").replace(/\s+/g, " ").trim(),
          volume: parseInt(m[2], 10),
          filename: name,
        };
      }
    }
    return { series: name.replace(/[_\.]+/g, " ").trim(), volume: null, filename: name };
  }

  function getMangaItems() {
    return state.items.filter(function (it) { return it.kind === "manga"; });
  }

  function allVolumes() {
    var vols = [];
    getMangaItems().forEach(function (it) {
      (it.volumes || []).forEach(function (v) {
        vols.push(Object.assign({ series: it.title, itemId: it.id }, v));
      });
    });
    return vols;
  }

  function lastLogAt(item) {
    if (!item.logs || !item.logs.length) return null;
    var sorted = item.logs.slice().sort(function (a, b) {
      return new Date(b.at) - new Date(a.at);
    });
    return sorted[0].at;
  }

  function formatRelativeTime(iso) {
    if (!iso) return "Never";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "Unknown";
    var now = Date.now();
    var diff = now - d.getTime();
    var mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return mins + "m ago";
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + "h ago";
    var days = Math.floor(hrs / 24);
    if (days < 7) return days + "d ago";
    if (days < 30) return Math.floor(days / 7) + "w ago";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined });
  }

  function formatTimestamp(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function toLocalDatetimeValue(iso) {
    var d = iso ? new Date(iso) : new Date();
    if (isNaN(d.getTime())) d = new Date();
    var pad = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
      "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function scoreMatch(querySeries, target) {
    var q = normalize(querySeries);
    var v = normalize(target);
    if (!q) return 0;
    if (v === q) return 100;
    if (v.indexOf(q) >= 0 || q.indexOf(v) >= 0) return 80;
    var qWords = q.split(" ");
    var hits = 0;
    qWords.forEach(function (w) {
      if (w.length > 1 && v.indexOf(w) >= 0) hits++;
    });
    return hits > 0 ? 40 + hits * 10 : 0;
  }

  function findVolumes(parsed, volFilter) {
    if (!parsed.series && parsed.volume == null) return [];
    return allVolumes().map(function (vol) {
      var s = scoreMatch(parsed.series, vol.series);
      if (s < 20) return null;
      if (parsed.volume != null && vol.volume !== parsed.volume) return null;
      if (volFilter && vol.status !== volFilter) return null;
      return { vol: vol, score: s + (parsed.volume != null && vol.volume === parsed.volume ? 50 : 0) };
    }).filter(Boolean).sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.vol.series.localeCompare(b.vol.series) || a.vol.volume - b.vol.volume;
    }).map(function (r) { return r.vol; });
  }

  function searchItems(query) {
    var q = normalize(query);
    if (!q) return [];
    return state.items.filter(function (it) {
      if (normalize(it.title).indexOf(q) >= 0) return true;
      if ((it.logs || []).some(function (log) { return normalize(log.text).indexOf(q) >= 0; })) return true;
      if (it.kind === "manga" && (it.volumes || []).some(function (v) {
        return normalize(v.filename).indexOf(q) >= 0 || String(v.volume).indexOf(q) >= 0;
      })) return true;
      return false;
    });
  }

  function deviceSearchHints(vol) {
    var s = vol.series;
    var n = vol.volume;
    var pad = n < 10 ? "0" + n : String(n);
    return [
      s + " " + n,
      s + " vol " + n,
      s + " volume " + n,
      s + " v" + n,
      s + " " + pad,
      vol.filename || (s + " - Vol " + n),
    ].filter(function (v, i, a) { return a.indexOf(v) === i; });
  }

  function toast(msg) {
    var el = $("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove("show"); }, 2400);
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function escapeAttr(s) {
    return escapeHtml(s);
  }

  function kindBadge(kind) {
    return '<span class="badge badge-' + kind + '">' + (kind === "show" ? "Show" : "Manga") + "</span>";
  }

  function statusBadge(status) {
    var labels = { have: "Have", wishlist: "Want", reading: "Reading" };
    return '<span class="badge badge-' + status + '">' + (labels[status] || status) + "</span>";
  }

  function formatBadge(fmt) {
    if (!fmt) return "";
    return '<span class="badge badge-format">' + fmt.toUpperCase() + "</span>";
  }

  function updateHeader() {
    var titles = {
      track: { h: "Track", sub: "Shows & manga — when you last watched or read" },
      search: { h: "Search", sub: "Find volumes, shows, and past notes" },
      more: { h: "More", sub: "Import, backup, and lookup" },
    };
    var t = titles[currentView] || titles.track;
    $("header-title-text").textContent = t.h;
    $("header-subtitle").textContent = t.sub;
    $("fab-add").hidden = currentView === "search";
    $("header-add").hidden = currentView === "search";
  }

  function setView(name) {
    currentView = name;
    document.querySelectorAll(".view").forEach(function (v) {
      v.classList.toggle("active", v.dataset.view === name);
    });
    document.querySelectorAll(".nav-btn").forEach(function (b) {
      b.classList.toggle("active", b.dataset.nav === name);
    });
    updateHeader();
    if (name === "track") renderTrack();
    if (name === "search") renderSearch();
  }

  function renderTrack() {
    var kindFilter = $("track-kind").value;
    var q = normalize($("track-filter").value);
    var items = state.items.slice();

    if (kindFilter) items = items.filter(function (it) { return it.kind === kindFilter; });
    if (q) items = items.filter(function (it) { return normalize(it.title).indexOf(q) >= 0; });

    items.sort(function (a, b) {
      var ta = lastLogAt(a);
      var tb = lastLogAt(b);
      if (!ta && !tb) return a.title.localeCompare(b.title);
      if (!ta) return 1;
      if (!tb) return -1;
      return new Date(tb) - new Date(ta);
    });

    var container = $("track-list");
    $("track-count").textContent = items.length + " title" + (items.length === 1 ? "" : "s");

    if (!items.length) {
      container.innerHTML =
        '<div class="empty-state">' +
          '<p>Nothing here yet.</p>' +
          '<p class="hint">Tap + to add a show or manga series, then log what you watched or read.</p>' +
        "</div>";
      return;
    }

    container.innerHTML = items.map(function (it) {
      var last = lastLogAt(it);
      var latestLog = (it.logs || []).slice().sort(function (a, b) { return new Date(b.at) - new Date(a.at); })[0];
      var preview = latestLog ? latestLog.text : "No entries yet";
      if (preview.length > 80) preview = preview.slice(0, 80) + "…";
      var extra = "";
      if (it.kind === "manga" && it.volumes && it.volumes.length) {
        extra = '<span class="track-extra">' + it.volumes.length + " vol" + (it.volumes.length === 1 ? "" : "s") + "</span>";
      }
      return (
        '<button type="button" class="track-card" data-id="' + it.id + '">' +
          '<div class="track-card-top">' +
            '<strong>' + escapeHtml(it.title) + "</strong>" +
            '<div class="track-badges">' + kindBadge(it.kind) + extra + "</div>" +
          "</div>" +
          '<p class="track-when">' + (it.kind === "show" ? "Last watched" : "Last read") + ": " +
            '<time>' + escapeHtml(formatRelativeTime(last)) + "</time></p>" +
          '<p class="track-preview">' + escapeHtml(preview) + "</p>" +
        "</button>"
      );
    }).join("");

    container.querySelectorAll(".track-card").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var item = state.items.find(function (it) { return it.id === btn.dataset.id; });
        if (item) showItemDetail(item);
      });
    });
  }

  function renderLogList(item) {
    var logs = (item.logs || []).slice().sort(function (a, b) {
      return new Date(b.at) - new Date(a.at);
    });
    if (!logs.length) {
      return '<p class="hint log-empty">No entries yet. Add what you watched or read below.</p>';
    }
    return (
      '<ul class="log-list">' +
        logs.map(function (log) {
          return (
            '<li class="log-entry" data-log-id="' + log.id + '">' +
              '<time class="log-time">' + escapeHtml(formatTimestamp(log.at)) + "</time>" +
              '<p class="log-text">' + escapeHtml(log.text) + "</p>" +
              '<button type="button" class="btn btn-ghost btn-sm log-delete" data-log-id="' + log.id + '">Delete</button>' +
            "</li>"
          );
        }).join("") +
      "</ul>"
    );
  }

  function renderMangaVolumes(item) {
    if (!item.volumes || !item.volumes.length) {
      return '<p class="hint">No volumes cataloged. Add volumes from the item menu or Import tab.</p>';
    }
    var vols = item.volumes.slice().sort(function (a, b) { return a.volume - b.volume; });
    return (
      '<div class="vol-pills-wrap">' +
        vols.map(function (v) {
          return (
            '<button type="button" class="vol-pill" data-vol-id="' + v.id + '">' +
              '<span class="pill-vol">' + v.volume + "</span>" +
              '<span class="pill-fmt">' + (v.format || "?").toUpperCase() + "</span>" +
              (v.status === "wishlist" ? '<span class="pill-want">want</span>' : "") +
            "</button>"
          );
        }).join("") +
      "</div>"
    );
  }

  function renderVolumeCard(vol, opts) {
    opts = opts || {};
    var hints = deviceSearchHints(vol);
    var html =
      '<article class="vol-card" data-vol-id="' + vol.id + '">' +
        '<div class="vol-card-top">' +
          '<div class="vol-card-title">' +
            '<strong>' + escapeHtml(vol.series) + "</strong>" +
            '<span class="vol-num">Vol ' + vol.volume + "</span>" +
          "</div>" +
          '<div class="vol-badges">' + statusBadge(vol.status) + formatBadge(vol.format) + "</div>" +
        "</div>";
    if (vol.filename) html += '<p class="vol-filename">' + escapeHtml(vol.filename) + "</p>";
    if (vol.notes) html += '<p class="vol-notes">' + escapeHtml(vol.notes) + "</p>";
    if (opts.showHints) {
      html += '<div class="hints-block"><p class="hints-label">Search on your e-reader:</p><ul class="hints-list">';
      hints.forEach(function (h) {
        html += '<li><button type="button" class="hint-chip" data-copy="' + escapeAttr(h) + '">' + escapeHtml(h) + "</button></li>";
      });
      html += "</ul></div>";
    }
    html += '<div class="vol-actions">' +
      '<button type="button" class="btn btn-ghost btn-sm" data-action="edit-vol">Edit</button>' +
      '<button type="button" class="btn btn-ghost btn-sm danger" data-action="delete-vol">Delete</button>' +
    "</div></article>";
    return html;
  }

  function showItemDetail(item) {
    $("detail-overlay").hidden = false;
    $("detail-title").textContent = item.title;
    var last = lastLogAt(item);
    var html =
      '<div class="detail-meta">' + kindBadge(item.kind) +
        '<span class="detail-last">' + (item.kind === "show" ? "Last watched" : "Last read") + ": " +
        escapeHtml(formatRelativeTime(last)) + "</span></div>" +
      '<section class="detail-section"><h3>History</h3>' + renderLogList(item) + "</section>" +
      '<section class="detail-section log-add-section">' +
        '<h3>Log entry</h3>' +
        '<form id="log-form" class="log-form">' +
          '<label>When<input type="datetime-local" id="log-at" value="' + escapeAttr(toLocalDatetimeValue()) + '" /></label>' +
          '<label>What did you ' + (item.kind === "show" ? "watch" : "read") + '?' +
            '<textarea id="log-text" rows="3" placeholder="Episode 5 — fought the villain…" required></textarea></label>' +
          '<button type="submit" class="btn btn-primary">Save entry</button>' +
        "</form></section>";

    if (item.kind === "manga") {
      html +=
        '<section class="detail-section">' +
          '<h3>Volumes <button type="button" class="btn btn-ghost btn-sm" id="detail-add-vol">+ Volume</button></h3>' +
          renderMangaVolumes(item) +
          '<div id="detail-vol-panel" hidden></div>' +
        "</section>";
    }

    html +=
      '<div class="detail-actions">' +
        '<button type="button" class="btn btn-secondary btn-sm" id="detail-edit-item">Edit title</button>' +
        '<button type="button" class="btn btn-ghost btn-sm danger" id="detail-delete-item">Delete</button>' +
      "</div>";

    $("detail-content").innerHTML = html;

    $("log-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var text = $("log-text").value.trim();
      var atVal = $("log-at").value;
      if (!text) { toast("Write what you watched or read"); return; }
      var at = atVal ? new Date(atVal).toISOString() : new Date().toISOString();
      if (!item.logs) item.logs = [];
      item.logs.push({ id: uid(), at: at, text: text });
      save();
      toast("Logged");
      showItemDetail(item);
      renderTrack();
    });

    $("detail-content").querySelectorAll(".log-delete").forEach(function (btn) {
      btn.addEventListener("click", function () {
        item.logs = (item.logs || []).filter(function (l) { return l.id !== btn.dataset.logId; });
        save();
        showItemDetail(item);
        renderTrack();
      });
    });

    var addVolBtn = $("detail-add-vol");
    if (addVolBtn) {
      addVolBtn.addEventListener("click", function () {
        openVolumeForm(item);
      });
    }

    $("detail-content").querySelectorAll(".vol-pill").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var vol = (item.volumes || []).find(function (v) { return v.id === btn.dataset.volId; });
        if (!vol) return;
        var panel = $("detail-vol-panel");
        panel.hidden = false;
        panel.innerHTML = renderVolumeCard(Object.assign({ series: item.title }, vol), { showHints: true });
        bindVolumePanel(panel, item, vol);
      });
    });

    $("detail-edit-item").addEventListener("click", function () { openItemForm(item); });
    $("detail-delete-item").addEventListener("click", function () { deleteItem(item); });
  }

  function bindVolumePanel(panel, item, vol) {
    panel.querySelectorAll(".hint-chip").forEach(function (chip) {
      chip.addEventListener("click", function () { copyText(chip.dataset.copy); });
    });
    panel.querySelectorAll("[data-action]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (btn.dataset.action === "edit-vol") openVolumeForm(item, vol);
        if (btn.dataset.action === "delete-vol") {
          item.volumes = (item.volumes || []).filter(function (v) { return v.id !== vol.id; });
          save();
          showItemDetail(item);
          toast("Volume removed");
        }
      });
    });
  }

  function showVolumeDetailFromSearch(vol) {
    $("detail-overlay").hidden = false;
    $("detail-title").textContent = vol.series + " · Vol " + vol.volume;
    $("detail-content").innerHTML = renderVolumeCard(vol, { showHints: true });
    $("detail-content").querySelectorAll(".hint-chip").forEach(function (chip) {
      chip.addEventListener("click", function () { copyText(chip.dataset.copy); });
    });
  }

  function renderSearch() {
    var q = $("search-input").value.trim();
    var statusFilter = $("search-status").value;
    var list = $("search-results");
    var parsedEl = $("search-parsed");

    if (!q) {
      parsedEl.hidden = true;
      list.innerHTML =
        '<div class="empty-state">' +
          '<p>Search your library</p>' +
          '<p class="hint">Try <em>One Piece 45</em>, a show name, or words from a past log.</p>' +
        "</div>";
      return;
    }

    var parsed = parseSearchQuery(q);
    var volResults = findVolumes(parsed, statusFilter || null);
    var itemResults = searchItems(q);

    var parts = [];
    if (parsed.series) parts.push("Series: <strong>" + escapeHtml(parsed.series) + "</strong>");
    if (parsed.volume != null) parts.push("Volume: <strong>" + parsed.volume + "</strong>");
    parsedEl.innerHTML = parts.length ? parts.join(" · ") : "Searching…";
    parsedEl.hidden = false;

    var html = "";

    if (itemResults.length) {
      html += '<h3 class="search-section-title">Shows &amp; series</h3>';
      html += itemResults.map(function (it) {
        var last = lastLogAt(it);
        return (
          '<button type="button" class="track-card search-hit" data-item-id="' + it.id + '">' +
            '<div class="track-card-top"><strong>' + escapeHtml(it.title) + "</strong>" + kindBadge(it.kind) + "</div>" +
            '<p class="track-when">Last: ' + escapeHtml(formatRelativeTime(last)) + "</p>" +
          "</button>"
        );
      }).join("");
    }

    if (volResults.length) {
      html += '<h3 class="search-section-title">Manga volumes</h3>';
      html += volResults.map(function (v) {
        return (
          '<button type="button" class="track-card search-hit" data-vol-item="' + escapeAttr(v.itemId) + '" data-vol-num="' + v.volume + '">' +
            '<strong>' + escapeHtml(v.series) + "</strong> · Vol " + v.volume +
            (v.filename ? '<p class="vol-filename">' + escapeHtml(v.filename) + "</p>" : "") +
          "</button>"
        );
      }).join("");
    }

    if (!html) {
      list.innerHTML =
        '<div class="empty-state">' +
          '<p>No matches.</p>' +
          '<p class="hint">Add a new title from Track, or refine your search.</p>' +
          '<button type="button" class="btn btn-primary" id="search-add-btn">Add title</button>' +
        "</div>";
      var addBtn = $("search-add-btn");
      if (addBtn) {
        addBtn.addEventListener("click", function () {
          openItemForm(null, { title: parsed.series || q, kind: parsed.volume != null ? "manga" : "show" });
        });
      }
      return;
    }

    list.innerHTML = html;
    list.querySelectorAll("[data-item-id]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var item = state.items.find(function (it) { return it.id === btn.dataset.itemId; });
        if (item) showItemDetail(item);
      });
    });
    list.querySelectorAll("[data-vol-item]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var item = state.items.find(function (it) { return it.id === btn.dataset.volItem; });
        var volNum = parseInt(btn.dataset.volNum, 10);
        if (!item) return;
        var vol = (item.volumes || []).find(function (v) { return v.volume === volNum; });
        if (vol) showVolumeDetailFromSearch(Object.assign({ series: item.title, itemId: item.id }, vol));
      });
    });
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast("Copied"); });
    } else {
      var ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); toast("Copied"); } catch (e) { toast("Copy failed"); }
      document.body.removeChild(ta);
    }
  }

  function openItemForm(item, prefill) {
    prefill = prefill || {};
    $("item-form-title").textContent = item ? "Edit title" : "Add show or manga";
    $("item-form-id").value = item ? item.id : "";
    $("item-form-title-input").value = item ? item.title : (prefill.title || "");
    $("item-form-kind").value = item ? item.kind : (prefill.kind || "show");
    $("item-form-overlay").hidden = false;
    $("item-form-title-input").focus();
  }

  function openVolumeForm(item, vol) {
    $("form-title").textContent = vol ? "Edit volume" : "Add volume";
    $("form-item-id").value = item.id;
    $("form-vol-id").value = vol ? vol.id : "";
    $("form-volume").value = vol ? vol.volume : "";
    $("form-filename").value = vol ? (vol.filename || "") : "";
    $("form-format").value = vol ? (vol.format || "pdf") : "pdf";
    $("form-status").value = vol ? (vol.status || "have") : "have";
    $("form-path").value = vol ? (vol.path || "") : "";
    $("form-notes").value = vol ? (vol.notes || "") : "";
    $("form-overlay").hidden = false;
  }

  function openAddMenu() {
    $("add-menu-overlay").hidden = false;
  }

  function saveItemFromForm(e) {
    e.preventDefault();
    var title = $("item-form-title-input").value.trim();
    var kind = $("item-form-kind").value;
    if (!title) { toast("Title required"); return; }

    var id = $("item-form-id").value;
    if (id) {
      var item = state.items.find(function (it) { return it.id === id; });
      if (item) {
        item.title = title;
        item.kind = kind;
        if (kind === "show") item.volumes = [];
        if (kind === "manga" && !item.volumes) item.volumes = [];
      }
    } else {
      state.items.push({
        id: uid(),
        kind: kind,
        title: title,
        volumes: kind === "manga" ? [] : undefined,
        logs: [],
      });
    }
    save();
    $("item-form-overlay").hidden = true;
    toast("Saved");
    renderTrack();
  }

  function saveVolumeFromForm(e) {
    e.preventDefault();
    var itemId = $("form-item-id").value;
    var item = state.items.find(function (it) { return it.id === itemId; });
    if (!item || item.kind !== "manga") return;

    var volume = parseInt($("form-volume").value, 10);
    if (isNaN(volume) || volume < 1) { toast("Volume number required"); return; }

    var data = {
      id: $("form-vol-id").value || uid(),
      volume: volume,
      filename: $("form-filename").value.trim(),
      format: $("form-format").value,
      status: $("form-status").value,
      path: $("form-path").value.trim(),
      notes: $("form-notes").value.trim(),
    };

    if (!item.volumes) item.volumes = [];
    var idx = item.volumes.findIndex(function (v) { return v.id === data.id; });
    var dupe = item.volumes.find(function (v) {
      return v.id !== data.id && v.volume === volume;
    });
    if (dupe) Object.assign(dupe, data);
    else if (idx >= 0) Object.assign(item.volumes[idx], data);
    else item.volumes.push(data);

    save();
    $("form-overlay").hidden = true;
    toast("Volume saved");
    if (!$("detail-overlay").hidden) showItemDetail(item);
    renderTrack();
    if (currentView === "search") renderSearch();
  }

  function deleteItem(item) {
    if (!confirm("Delete " + item.title + " and all its history?")) return;
    state.items = state.items.filter(function (it) { return it.id !== item.id; });
    save();
    $("detail-overlay").hidden = true;
    toast("Deleted");
    renderTrack();
  }

  function bulkImport() {
    var text = $("bulk-input").value.trim();
    if (!text) { toast("Paste filenames first"); return; }

    var lines = text.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    var added = 0;
    var skipped = 0;

    lines.forEach(function (line) {
      var parsed = parseFilename(line);
      if (!parsed || !parsed.series || parsed.volume == null) { skipped++; return; }

      var item = state.items.find(function (it) {
        return it.kind === "manga" && normalize(it.title) === normalize(parsed.series);
      });
      if (!item) {
        item = { id: uid(), kind: "manga", title: parsed.series, volumes: [], logs: [] };
        state.items.push(item);
      }
      if (!item.volumes) item.volumes = [];

      var ext = (line.match(/\.(pdf|epub|cbz|cbr|mobi|azw3)$/i) || [])[1];
      var dupe = item.volumes.find(function (v) { return v.volume === parsed.volume; });
      if (dupe) {
        if (!dupe.filename) dupe.filename = line;
        if (ext && !dupe.format) dupe.format = ext.toLowerCase();
        skipped++;
      } else {
        item.volumes.push({
          id: uid(),
          volume: parsed.volume,
          filename: line,
          format: ext ? ext.toLowerCase() : "pdf",
          status: "have",
          path: "",
          notes: "",
        });
        added++;
      }
    });

    save();
    $("bulk-input").value = "";
    $("bulk-result").textContent = "Added " + added + ", skipped " + skipped;
    renderTrack();
    toast("Import done");
  }

  function anilistQuery(search) {
    return fetch(ANILIST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        query: "query ($search: String) { Page(page: 1, perPage: 8) { media(search: $search, type: MANGA, sort: SEARCH_MATCH) { id title { romaji english native } volumes chapters status coverImage { medium } } } }",
        variables: { search: search },
      }),
    }).then(function (r) { return r.json(); });
  }

  function renderLookupResults(media) {
    var container = $("lookup-results");
    if (!media.length) {
      container.innerHTML = '<div class="empty-state"><p>No results from AniList.</p></div>';
      return;
    }
    container.innerHTML = media.map(function (m) {
      var title = m.title.english || m.title.romaji || m.title.native;
      var volInfo = m.volumes ? m.volumes + " volumes" : (m.chapters ? m.chapters + " chapters" : "Unknown length");
      return (
        '<article class="lookup-card" data-id="' + m.id + '">' +
          (m.coverImage && m.coverImage.medium
            ? '<img class="lookup-cover" src="' + m.coverImage.medium + '" alt="" loading="lazy" />'
            : '<div class="lookup-cover placeholder"></div>') +
          '<div class="lookup-info">' +
            '<strong>' + escapeHtml(title) + "</strong>" +
            '<span class="lookup-meta">' + escapeHtml(volInfo) + "</span>" +
            '<div class="lookup-actions">' +
              '<button type="button" class="btn btn-primary btn-sm" data-action="add-manga" data-title="' + escapeAttr(title) + '">Add manga</button>' +
            "</div></div></article>"
      );
    }).join("");

    container.querySelectorAll("[data-action]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var title = btn.dataset.title;
        var exists = state.items.find(function (it) { return normalize(it.title) === normalize(title); });
        if (exists) { showItemDetail(exists); return; }
        var item = { id: uid(), kind: "manga", title: title, volumes: [], logs: [] };
        state.items.push(item);
        save();
        toast("Added " + title);
        setView("track");
        showItemDetail(item);
      });
    });
  }

  function runLookup() {
    var q = $("lookup-input").value.trim();
    if (!q) return;
    if (lookupCache[q]) { renderLookupResults(lookupCache[q]); return; }
    $("lookup-results").innerHTML = '<p class="loading">Searching…</p>';
    anilistQuery(q).then(function (data) {
      lookupCache[q] = (data.data && data.data.Page && data.data.Page.media) || [];
      renderLookupResults(lookupCache[q]);
    }).catch(function () {
      $("lookup-results").innerHTML = '<div class="empty-state"><p>Lookup failed.</p></div>';
    });
  }

  function exportData() {
    var blob = new Blob([JSON.stringify({
      format: "manga-shelf",
      version: 2,
      items: state.items,
      seriesMeta: state.seriesMeta,
    }, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "media-shelf-backup.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function importData(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = JSON.parse(reader.result);
        var slice = parsed;
        if (typeof AppsBackup !== "undefined" && AppsBackup.isUnifiedBackup(parsed)) {
          slice = AppsBackup.getAppSlice(parsed, "manga-shelf");
        }
        if (!slice) { toast("Invalid backup"); return; }
        migrateFromV1(slice);
        save();
        toast("Imported " + state.items.length + " titles");
        renderTrack();
        renderSearch();
      } catch (e) {
        toast("Import failed");
      }
    };
    reader.readAsText(file);
  }

  function init() {
    load();

    document.querySelectorAll(".nav-btn").forEach(function (btn) {
      btn.addEventListener("click", function () { setView(btn.dataset.nav); });
    });

    $("track-filter").addEventListener("input", renderTrack);
    $("track-kind").addEventListener("change", renderTrack);

    $("search-input").addEventListener("input", renderSearch);
    $("search-status").addEventListener("change", renderSearch);

    $("fab-add").addEventListener("click", openAddMenu);
    $("header-add").addEventListener("click", openAddMenu);
    $("add-show-btn").addEventListener("click", function () {
      $("add-menu-overlay").hidden = true;
      openItemForm(null, { kind: "show" });
    });
    $("add-manga-btn").addEventListener("click", function () {
      $("add-menu-overlay").hidden = true;
      openItemForm(null, { kind: "manga" });
    });
    $("add-menu-cancel").addEventListener("click", function () { $("add-menu-overlay").hidden = true; });
    $("add-menu-overlay").addEventListener("click", function (e) {
      if (e.target === $("add-menu-overlay")) $("add-menu-overlay").hidden = true;
    });

    $("item-form").addEventListener("submit", saveItemFromForm);
    $("item-form-cancel").addEventListener("click", function () { $("item-form-overlay").hidden = true; });
    $("item-form-overlay").addEventListener("click", function (e) {
      if (e.target === $("item-form-overlay")) $("item-form-overlay").hidden = true;
    });

    $("volume-form").addEventListener("submit", saveVolumeFromForm);
    $("form-cancel").addEventListener("click", function () { $("form-overlay").hidden = true; });
    $("form-overlay").addEventListener("click", function (e) {
      if (e.target === $("form-overlay")) $("form-overlay").hidden = true;
    });

    $("detail-close").addEventListener("click", function () { $("detail-overlay").hidden = true; });
    $("detail-overlay").addEventListener("click", function (e) {
      if (e.target === $("detail-overlay")) $("detail-overlay").hidden = true;
    });

    $("bulk-import-btn").addEventListener("click", bulkImport);
    $("lookup-btn").addEventListener("click", runLookup);
    $("lookup-input").addEventListener("keydown", function (e) { if (e.key === "Enter") runLookup(); });
    $("export-btn").addEventListener("click", exportData);
    $("import-file").addEventListener("change", function () {
      if (this.files[0]) importData(this.files[0]);
      this.value = "";
    });

    setView("track");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
