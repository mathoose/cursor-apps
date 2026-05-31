(function () {
  "use strict";

  var STORAGE_KEY = "manga-shelf-v1";
  var ANILIST_URL = "https://graphql.anilist.co";

  var state = { volumes: [], seriesMeta: {} };
  var lookupCache = {};

  var $ = function (id) { return document.getElementById(id); };

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.volumes)) {
        state.volumes = parsed.volumes;
        state.seriesMeta = parsed.seriesMeta || {};
      }
    } catch (e) { /* ignore */ }
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: 1,
      volumes: state.volumes,
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

  function scoreMatch(querySeries, volSeries) {
    var q = normalize(querySeries);
    var v = normalize(volSeries);
    if (!q) return 1;
    if (v === q) return 100;
    if (v.indexOf(q) >= 0 || q.indexOf(v) >= 0) return 80;
    var qWords = q.split(" ");
    var hits = 0;
    qWords.forEach(function (w) {
      if (w.length > 1 && v.indexOf(w) >= 0) hits++;
    });
    return hits > 0 ? 40 + hits * 10 : 0;
  }

  function findVolumes(query, volFilter) {
    var parsed = typeof query === "string" ? parseSearchQuery(query) : query;
    var results = state.volumes.map(function (vol) {
      var s = scoreMatch(parsed.series, vol.series);
      if (s < 20) return null;
      if (parsed.volume != null && vol.volume !== parsed.volume) return null;
      if (volFilter && vol.status !== volFilter) return null;
      return { vol: vol, score: s + (parsed.volume != null && vol.volume === parsed.volume ? 50 : 0) };
    }).filter(Boolean);

    results.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.vol.series.localeCompare(b.vol.series) || a.vol.volume - b.vol.volume;
    });
    return results.map(function (r) { return r.vol; });
  }

  function groupBySeries(volumes) {
    var map = {};
    volumes.forEach(function (v) {
      var key = v.series;
      if (!map[key]) map[key] = [];
      map[key].push(v);
    });
    Object.keys(map).forEach(function (k) {
      map[k].sort(function (a, b) { return a.volume - b.volume; });
    });
    return map;
  }

  function formatLabel(vol) {
    return vol.series + " · Vol " + vol.volume;
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

  function setView(name) {
    document.querySelectorAll(".view").forEach(function (v) {
      v.classList.toggle("active", v.dataset.view === name);
    });
    document.querySelectorAll(".nav-btn").forEach(function (b) {
      b.classList.toggle("active", b.dataset.nav === name);
    });
    if (name === "library") renderLibrary();
    if (name === "lookup") { /* user-driven */ }
  }

  function statusBadge(status) {
    var labels = { have: "Have", wishlist: "Want", reading: "Reading" };
    return '<span class="badge badge-' + status + '">' + (labels[status] || status) + "</span>";
  }

  function formatBadge(fmt) {
    if (!fmt) return "";
    return '<span class="badge badge-format">' + fmt.toUpperCase() + "</span>";
  }

  function renderVolumeCard(vol, opts) {
    opts = opts || {};
    var hints = deviceSearchHints(vol);
    var html =
      '<article class="vol-card" data-id="' + vol.id + '">' +
        '<div class="vol-card-top">' +
          '<div class="vol-card-title">' +
            '<strong>' + escapeHtml(vol.series) + "</strong>" +
            '<span class="vol-num">Vol ' + vol.volume + "</span>" +
          "</div>" +
          '<div class="vol-badges">' + statusBadge(vol.status) + formatBadge(vol.format) + "</div>" +
        "</div>";

    if (vol.filename) {
      html += '<p class="vol-filename">' + escapeHtml(vol.filename) + "</p>";
    }
    if (vol.notes) {
      html += '<p class="vol-notes">' + escapeHtml(vol.notes) + "</p>";
    }
    if (vol.path) {
      html += '<p class="vol-path">' + escapeHtml(vol.path) + "</p>";
    }

    if (opts.showHints) {
      html += '<div class="hints-block"><p class="hints-label">Search on your e-reader:</p><ul class="hints-list">';
      hints.forEach(function (h) {
        html += '<li><button type="button" class="hint-chip" data-copy="' + escapeAttr(h) + '">' + escapeHtml(h) + "</button></li>";
      });
      html += "</ul></div>";
    }

    html +=
      '<div class="vol-actions">' +
        (opts.showHints ? "" : '<button type="button" class="btn btn-ghost btn-sm" data-action="hints">Find on device</button>') +
        '<button type="button" class="btn btn-ghost btn-sm" data-action="edit">Edit</button>' +
        '<button type="button" class="btn btn-ghost btn-sm danger" data-action="delete">Delete</button>' +
      "</div></article>";
    return html;
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function escapeAttr(s) {
    return escapeHtml(s);
  }

  function renderSearch() {
    var q = $("search-input").value;
    var statusFilter = $("search-status").value;
    var parsed = parseSearchQuery(q);
    var results = findVolumes(parsed, statusFilter || null);

    var parsedEl = $("search-parsed");
    if (q.trim()) {
      var parts = [];
      if (parsed.series) parts.push("Series: <strong>" + escapeHtml(parsed.series) + "</strong>");
      if (parsed.volume != null) parts.push("Volume: <strong>" + parsed.volume + "</strong>");
      parsedEl.innerHTML = parts.length ? parts.join(" · ") : "Showing all matches";
      parsedEl.hidden = false;
    } else {
      parsedEl.hidden = true;
    }

    var list = $("search-results");
    if (!results.length) {
      list.innerHTML =
        '<div class="empty-state">' +
          '<p>No volumes match.</p>' +
          (q.trim()
            ? '<p class="hint">Try a different spelling, or add this volume to your library.</p>' +
              '<button type="button" class="btn btn-primary" id="search-add-btn">Add from search</button>'
            : '<p class="hint">Search like <em>One Piece 45</em> or <em>Chainsaw Man vol 3</em></p>') +
        "</div>";
      var addBtn = $("search-add-btn");
      if (addBtn) {
        addBtn.addEventListener("click", function () {
          openAddForm({ series: parsed.series, volume: parsed.volume });
        });
      }
      return;
    }

    list.innerHTML = results.map(function (v) {
      return renderVolumeCard(v, { showHints: true });
    }).join("");
    bindVolumeCards(list);
  }

  function renderLibrary() {
    var q = normalize($("library-filter").value);
    var statusFilter = $("library-status").value;
    var volumes = state.volumes.slice();
    if (statusFilter) volumes = volumes.filter(function (v) { return v.status === statusFilter; });
    if (q) {
      volumes = volumes.filter(function (v) {
        return normalize(v.series).indexOf(q) >= 0 ||
          normalize(v.filename || "").indexOf(q) >= 0 ||
          String(v.volume).indexOf(q) >= 0;
      });
    }

    var grouped = groupBySeries(volumes);
    var keys = Object.keys(grouped).sort(function (a, b) { return a.localeCompare(b); });
    var container = $("library-list");

    $("library-count").textContent = volumes.length + " volume" + (volumes.length === 1 ? "" : "s");

    if (!keys.length) {
      container.innerHTML = '<div class="empty-state"><p>Your library is empty.</p><p class="hint">Add volumes or bulk-import filenames from your e-reader.</p></div>';
      return;
    }

    container.innerHTML = keys.map(function (series) {
      var vols = grouped[series];
      var meta = state.seriesMeta[series];
      var metaLine = meta && meta.totalVolumes ? ' <span class="series-meta">' + vols.length + "/" + meta.totalVolumes + " vols</span>" : "";
      return (
        '<section class="series-group">' +
          '<h3 class="series-name">' + escapeHtml(series) + metaLine + "</h3>" +
          '<div class="series-vols">' +
            vols.map(function (v) {
              return (
                '<button type="button" class="vol-pill" data-id="' + v.id + '">' +
                  '<span class="pill-vol">' + v.volume + "</span>" +
                  '<span class="pill-fmt">' + (v.format || "?").toUpperCase() + "</span>" +
                  (v.status === "wishlist" ? '<span class="pill-want">want</span>' : "") +
                "</button>"
              );
            }).join("") +
          "</div></section>"
      );
    }).join("");

    container.querySelectorAll(".vol-pill").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var vol = state.volumes.find(function (v) { return v.id === btn.dataset.id; });
        if (vol) showVolumeDetail(vol);
      });
    });
  }

  function showVolumeDetail(vol) {
    $("detail-overlay").hidden = false;
    $("detail-content").innerHTML = renderVolumeCard(vol, { showHints: true });
    bindVolumeCards($("detail-content"));
  }

  function bindVolumeCards(root) {
    root.querySelectorAll(".vol-card").forEach(function (card) {
      var id = card.dataset.id;
      card.querySelectorAll("[data-action]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var vol = state.volumes.find(function (v) { return v.id === id; });
          if (!vol) return;
          if (btn.dataset.action === "edit") openEditForm(vol);
          if (btn.dataset.action === "delete") deleteVolume(vol);
          if (btn.dataset.action === "hints") showVolumeDetail(vol);
        });
      });
    });
    root.querySelectorAll(".hint-chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        copyText(chip.dataset.copy);
      });
    });
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast("Copied: " + text); });
    } else {
      var ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        toast("Copied: " + text);
      } catch (e) { toast("Copy failed"); }
      document.body.removeChild(ta);
    }
  }

  function openAddForm(prefill) {
    prefill = prefill || {};
    $("form-title").textContent = "Add volume";
    $("form-id").value = "";
    $("form-series").value = prefill.series || "";
    $("form-volume").value = prefill.volume != null ? prefill.volume : "";
    $("form-filename").value = prefill.filename || "";
    $("form-format").value = prefill.format || "pdf";
    $("form-status").value = prefill.status || "have";
    $("form-path").value = "";
    $("form-notes").value = "";
    $("form-overlay").hidden = false;
    $("form-series").focus();
  }

  function openEditForm(vol) {
    $("form-title").textContent = "Edit volume";
    $("form-id").value = vol.id;
    $("form-series").value = vol.series;
    $("form-volume").value = vol.volume;
    $("form-filename").value = vol.filename || "";
    $("form-format").value = vol.format || "pdf";
    $("form-status").value = vol.status || "have";
    $("form-path").value = vol.path || "";
    $("form-notes").value = vol.notes || "";
    $("form-overlay").hidden = false;
  }

  function closeForm() {
    $("form-overlay").hidden = true;
  }

  function saveVolumeFromForm(e) {
    e.preventDefault();
    var series = $("form-series").value.trim();
    var volume = parseInt($("form-volume").value, 10);
    if (!series || isNaN(volume) || volume < 1) {
      toast("Series name and volume number required");
      return;
    }

    var data = {
      series: series,
      volume: volume,
      filename: $("form-filename").value.trim(),
      format: $("form-format").value,
      status: $("form-status").value,
      path: $("form-path").value.trim(),
      notes: $("form-notes").value.trim(),
    };

    var id = $("form-id").value;
    if (id) {
      var idx = state.volumes.findIndex(function (v) { return v.id === id; });
      if (idx >= 0) Object.assign(state.volumes[idx], data);
    } else {
      var dupe = state.volumes.find(function (v) {
        return normalize(v.series) === normalize(series) && v.volume === volume;
      });
      if (dupe) {
        Object.assign(dupe, data);
      } else {
        state.volumes.push(Object.assign({ id: uid() }, data));
      }
    }

    save();
    closeForm();
    toast("Saved");
    renderSearch();
    if (document.querySelector('.view[data-view="library"]').classList.contains("active")) renderLibrary();
  }

  function deleteVolume(vol) {
    if (!confirm("Remove " + formatLabel(vol) + "?")) return;
    state.volumes = state.volumes.filter(function (v) { return v.id !== vol.id; });
    save();
    $("detail-overlay").hidden = true;
    toast("Removed");
    renderSearch();
    renderLibrary();
  }

  function bulkImport() {
    var text = $("bulk-input").value.trim();
    if (!text) { toast("Paste filenames first"); return; }

    var lines = text.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    var added = 0;
    var skipped = 0;

    lines.forEach(function (line) {
      var parsed = parseFilename(line);
      if (!parsed || !parsed.series) { skipped++; return; }
      if (parsed.volume == null) { skipped++; return; }

      var ext = (line.match(/\.(pdf|epub|cbz|cbr|mobi|azw3)$/i) || [])[1];
      var dupe = state.volumes.find(function (v) {
        return normalize(v.series) === normalize(parsed.series) && v.volume === parsed.volume;
      });

      if (dupe) {
        if (!dupe.filename) dupe.filename = line;
        if (ext && !dupe.format) dupe.format = ext.toLowerCase();
        skipped++;
      } else {
        state.volumes.push({
          id: uid(),
          series: parsed.series,
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
    $("bulk-result").textContent = "Added " + added + ", skipped " + skipped + " (duplicates or unparseable)";
    renderLibrary();
    toast("Import done");
  }

  function anilistQuery(search) {
    return fetch(ANILIST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        query: "query ($search: String) { Page(page: 1, perPage: 8) { media(search: $search, type: MANGA, sort: SEARCH_MATCH) { id title { romaji english native } volumes chapters status coverImage { medium } startDate { year } } } }",
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
            (m.title.romaji && m.title.english && m.title.romaji !== m.title.english
              ? '<span class="lookup-alt">' + escapeHtml(m.title.romaji) + "</span>" : "") +
            '<span class="lookup-meta">' + escapeHtml(volInfo) + " · " + escapeHtml(m.status || "") + "</span>" +
            '<div class="lookup-actions">' +
              '<button type="button" class="btn btn-primary btn-sm" data-action="save-meta" data-title="' + escapeAttr(title) + '" data-volumes="' + (m.volumes || "") + '">Save series info</button>' +
              '<button type="button" class="btn btn-ghost btn-sm" data-action="add-vol" data-title="' + escapeAttr(title) + '">Add volume</button>' +
              '<a class="btn btn-ghost btn-sm" href="https://www.amazon.com/s?k=' + encodeURIComponent(title + " manga volume") + '" target="_blank" rel="noopener">Shop</a>' +
            "</div></div></article>"
      );
    }).join("");

    container.querySelectorAll("[data-action]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var title = btn.dataset.title;
        if (btn.dataset.action === "save-meta") {
          state.seriesMeta[title] = {
            totalVolumes: btn.dataset.volumes ? parseInt(btn.dataset.volumes, 10) : null,
            anilistId: btn.closest(".lookup-card").dataset.id,
          };
          save();
          toast("Saved info for " + title);
        }
        if (btn.dataset.action === "add-vol") {
          openAddForm({ series: title });
          setView("search");
        }
      });
    });
  }

  function runLookup() {
    var q = $("lookup-input").value.trim();
    if (!q) return;
    if (lookupCache[q]) {
      renderLookupResults(lookupCache[q]);
      return;
    }

    $("lookup-results").innerHTML = '<p class="loading">Searching AniList…</p>';
    anilistQuery(q).then(function (data) {
      var media = (data.data && data.data.Page && data.data.Page.media) || [];
      lookupCache[q] = media;
      renderLookupResults(media);
    }).catch(function () {
      $("lookup-results").innerHTML = '<div class="empty-state"><p>Lookup failed — check connection.</p></div>';
    });
  }

  function exportData() {
    var blob = new Blob([JSON.stringify({ format: "manga-shelf", version: 1, volumes: state.volumes, seriesMeta: state.seriesMeta }, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "manga-shelf-backup.json";
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
        if (!slice || !Array.isArray(slice.volumes)) {
          toast("Invalid backup file");
          return;
        }
        state.volumes = slice.volumes;
        state.seriesMeta = slice.seriesMeta || {};
        save();
        toast("Imported " + state.volumes.length + " volumes");
        renderSearch();
        renderLibrary();
      } catch (e) {
        toast("Import failed");
      }
    };
    reader.readAsText(file);
  }

  function findMissingVolumes() {
    var groups = groupBySeries(state.volumes.filter(function (v) { return v.status === "have"; }));
    var missing = [];
    Object.keys(groups).forEach(function (series) {
      var meta = state.seriesMeta[series];
      if (!meta || !meta.totalVolumes) return;
      var have = {};
      groups[series].forEach(function (v) { have[v.volume] = true; });
      for (var i = 1; i <= meta.totalVolumes; i++) {
        if (!have[i]) missing.push({ series: series, volume: i });
      }
    });
    return missing;
  }

  function renderMissing() {
    var missing = findMissingVolumes();
    var el = $("missing-section");
    if (!missing.length) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    $("missing-list").innerHTML = missing.slice(0, 24).map(function (m) {
      return (
        '<button type="button" class="missing-chip" data-series="' + escapeAttr(m.series) + '" data-vol="' + m.volume + '">' +
          escapeHtml(m.series) + " " + m.volume +
        "</button>"
      );
    }).join("");
    if (missing.length > 24) {
      $("missing-more").textContent = "+" + (missing.length - 24) + " more";
      $("missing-more").hidden = false;
    } else {
      $("missing-more").hidden = true;
    }
    $("missing-list").querySelectorAll(".missing-chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        openAddForm({ series: chip.dataset.series, volume: parseInt(chip.dataset.vol, 10), status: "wishlist" });
      });
    });
  }

  function init() {
    load();

    document.querySelectorAll(".nav-btn").forEach(function (btn) {
      btn.addEventListener("click", function () { setView(btn.dataset.nav); });
    });

    $("search-input").addEventListener("input", function () {
      renderSearch();
      renderMissing();
    });
    $("search-status").addEventListener("change", renderSearch);

    $("library-filter").addEventListener("input", renderLibrary);
    $("library-status").addEventListener("change", renderLibrary);

    $("fab-add").addEventListener("click", function () { openAddForm(); });
    $("header-add").addEventListener("click", function () { openAddForm(); });

    $("volume-form").addEventListener("submit", saveVolumeFromForm);
    $("form-cancel").addEventListener("click", closeForm);
    $("form-overlay").addEventListener("click", function (e) {
      if (e.target === $("form-overlay")) closeForm();
    });

    $("detail-close").addEventListener("click", function () { $("detail-overlay").hidden = true; });
    $("detail-overlay").addEventListener("click", function (e) {
      if (e.target === $("detail-overlay")) $("detail-overlay").hidden = true;
    });

    $("bulk-import-btn").addEventListener("click", bulkImport);

    $("lookup-btn").addEventListener("click", runLookup);
    $("lookup-input").addEventListener("keydown", function (e) {
      if (e.key === "Enter") runLookup();
    });

    $("export-btn").addEventListener("click", exportData);
    $("import-file").addEventListener("change", function () {
      if (this.files[0]) importData(this.files[0]);
      this.value = "";
    });

    renderSearch();
    renderLibrary();
    renderMissing();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
