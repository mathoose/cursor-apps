(function () {
  "use strict";

  var STORAGE_KEY = "idea-notes-v1";
  var APP_ID = "idea-notes";
  var EXPORT_FORMAT = "idea-notes-data";
  var SAVE_DELAY = 250;

  var state = loadData();
  var currentView = "home";
  var activeNoteId = state.activeNoteId || null;
  var searchQuery = "";
  var saveTimer = null;
  var toastTimer = null;
  var els = {};

  function nowIso() {
    return new Date().toISOString();
  }

  function uid() {
    return "note-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function normalizeTitle(title) {
    return String(title || "").replace(/\s+/g, " ").trim();
  }

  function titleKey(title) {
    return normalizeTitle(title).toLowerCase();
  }

  function displayTitle(note) {
    var title = normalizeTitle(note && note.title);
    return title || "Untitled idea";
  }

  function normalizeTags(tags, body) {
    var out = [];
    var seen = {};

    function add(tag) {
      tag = String(tag || "").replace(/^#/, "").trim().toLowerCase();
      if (!tag || seen[tag]) return;
      seen[tag] = true;
      out.push(tag);
    }

    if (Array.isArray(tags)) tags.forEach(add);
    String(body || "").replace(/(^|[\s([{])#([A-Za-z0-9_-]{2,40})\b/g, function (_, prefix, tag) {
      add(tag);
      return prefix + tag;
    });
    return out.sort();
  }

  function parseWikiLinks(text) {
    var links = [];
    var seen = {};
    String(text || "").replace(/\[\[([^\]\n]{1,120})\]\]/g, function (_, raw) {
      var target = normalizeTitle(String(raw).split("|")[0]);
      if (!target) return "";
      var key = titleKey(target);
      if (!seen[key]) {
        seen[key] = true;
        links.push(target);
      }
      return "";
    });
    return links;
  }

  function noteSummary(note) {
    return String(note.body || "")
      .replace(/\[\[([^\]\n]+)\]\]/g, "$1")
      .replace(/(^|[\s([{])#([A-Za-z0-9_-]{2,40})\b/g, "$1#$2")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeNote(raw) {
    raw = raw && typeof raw === "object" ? raw : {};
    var createdAt = raw.createdAt || nowIso();
    var updatedAt = raw.updatedAt || createdAt;
    var body = typeof raw.body === "string" ? raw.body : "";
    return {
      id: raw.id || uid(),
      title: normalizeTitle(raw.title).slice(0, 160),
      body: body.slice(0, 200000),
      tags: normalizeTags(raw.tags, body),
      createdAt: createdAt,
      updatedAt: updatedAt,
    };
  }

  function defaultData() {
    return {
      version: 1,
      notes: [],
      activeNoteId: null,
    };
  }

  function normalizeData(raw) {
    var data = raw && typeof raw === "object" ? raw : defaultData();
    var notes = Array.isArray(data.notes) ? data.notes.map(normalizeNote) : [];
    var seen = {};
    notes = notes.filter(function (note) {
      if (!note || !note.id || seen[note.id]) return false;
      seen[note.id] = true;
      return true;
    });
    notes.sort(function (a, b) {
      return new Date(b.updatedAt) - new Date(a.updatedAt);
    });
    return {
      version: 1,
      notes: notes,
      activeNoteId: notes.some(function (note) { return note.id === data.activeNoteId; }) ? data.activeNoteId : null,
    };
  }

  function loadData() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultData();
      return normalizeData(JSON.parse(raw));
    } catch (e) {
      return defaultData();
    }
  }

  function saveData() {
    state.activeNoteId = activeNoteId;
    state = normalizeData(state);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveTimer = null;
      saveData();
      renderAll();
    }, SAVE_DELAY);
  }

  function getNote(id) {
    return state.notes.find(function (note) { return note.id === id; }) || null;
  }

  function findNoteByTitle(title) {
    var key = titleKey(title);
    if (!key) return null;
    return state.notes.find(function (note) { return titleKey(note.title) === key; }) || null;
  }

  function getActiveNote() {
    return getNote(activeNoteId);
  }

  function sortedNotes() {
    return state.notes.slice().sort(function (a, b) {
      return new Date(b.updatedAt) - new Date(a.updatedAt);
    });
  }

  function formatDate(value) {
    var date = new Date(value);
    if (isNaN(date.getTime())) return "";
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function toast(message) {
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      els.toast.classList.remove("show");
    }, 2800);
  }

  function setView(view) {
    currentView = view;
    document.body.className = "view-" + view;
    [els.homeView, els.editorView, els.graphView].forEach(function (viewEl) {
      if (!viewEl) return;
      viewEl.classList.toggle("active", viewEl.dataset.view === view);
    });
    renderAll();
  }

  function createNote(title, body) {
    var stamp = nowIso();
    var note = normalizeNote({
      id: uid(),
      title: title || "Untitled idea",
      body: body || "",
      createdAt: stamp,
      updatedAt: stamp,
    });
    state.notes.unshift(note);
    activeNoteId = note.id;
    saveData();
    setView("editor");
    setTimeout(function () {
      if (els.titleInput) {
        els.titleInput.focus();
        els.titleInput.select();
      }
    }, 60);
    return note;
  }

  function createOrOpenLinkedNote(title) {
    var existing = findNoteByTitle(title);
    if (existing) {
      openNote(existing.id);
      return;
    }
    createNote(title, "");
    toast("Created " + displayTitle(getActiveNote()));
  }

  function openNote(id) {
    var note = getNote(id);
    if (!note) return;
    activeNoteId = note.id;
    saveData();
    setView("editor");
  }

  function deleteActiveNote() {
    var note = getActiveNote();
    if (!note) return;
    if (!confirm("Delete \"" + displayTitle(note) + "\"? This cannot be undone.")) return;
    state.notes = state.notes.filter(function (item) { return item.id !== note.id; });
    activeNoteId = state.notes[0] ? state.notes[0].id : null;
    saveData();
    setView("home");
    toast("Note deleted");
  }

  function updateActiveNoteFromInputs() {
    var note = getActiveNote();
    if (!note) return;
    note.title = normalizeTitle(els.titleInput.value).slice(0, 160);
    note.body = String(els.bodyInput.value || "").slice(0, 200000);
    note.tags = normalizeTags(note.tags, note.body);
    note.updatedAt = nowIso();
    scheduleSave();
  }

  function renderStats() {
    var noteCount = state.notes.length;
    var linkCount = 0;
    var tagSet = {};
    state.notes.forEach(function (note) {
      linkCount += parseWikiLinks(note.body).length;
      note.tags.forEach(function (tag) { tagSet[tag] = true; });
    });
    els.statsRow.innerHTML = [
      '<div class="stat-pill"><strong>' + noteCount + '</strong><span>note' + (noteCount === 1 ? "" : "s") + "</span></div>",
      '<div class="stat-pill"><strong>' + linkCount + '</strong><span>wiki link' + (linkCount === 1 ? "" : "s") + "</span></div>",
      '<div class="stat-pill"><strong>' + Object.keys(tagSet).length + '</strong><span>tag' + (Object.keys(tagSet).length === 1 ? "" : "s") + "</span></div>",
    ].join("");
  }

  function filteredNotes() {
    var q = searchQuery.trim().toLowerCase();
    if (!q) return sortedNotes();
    return sortedNotes().filter(function (note) {
      var haystack = [
        note.title,
        note.body,
        note.tags.join(" "),
        parseWikiLinks(note.body).join(" "),
      ].join(" ").toLowerCase();
      return haystack.indexOf(q) >= 0;
    });
  }

  function renderMiniChips(note) {
    var parts = [];
    note.tags.slice(0, 3).forEach(function (tag) {
      parts.push('<span class="chip chip-tag">#' + escapeHtml(tag) + "</span>");
    });
    parseWikiLinks(note.body).slice(0, 3).forEach(function (link) {
      parts.push('<span class="chip chip-link">[[' + escapeHtml(link) + "]]</span>");
    });
    return parts.length ? '<div class="mini-chip-row">' + parts.join("") + "</div>" : "";
  }

  function renderHome() {
    renderStats();
    var notes = filteredNotes();
    els.noteListLabel.textContent = searchQuery.trim() ? "Search results" : "Recent notes";
    els.emptyState.hidden = notes.length > 0;
    if (!notes.length) {
      els.noteList.innerHTML = "";
      els.emptyState.querySelector("p").innerHTML = state.notes.length
        ? "No notes match that search."
        : "No notes yet.<br />Tap New note to start your web of ideas.";
      return;
    }

    els.noteList.innerHTML = notes.map(function (note) {
      var summary = noteSummary(note) || "No body text yet.";
      return [
        '<button type="button" class="note-card" data-note-id="' + escapeHtml(note.id) + '">',
        '<span class="note-card-title"><span>' + escapeHtml(displayTitle(note)) + '</span><span class="note-card-date">' + escapeHtml(formatDate(note.updatedAt)) + "</span></span>",
        '<span class="note-card-snippet">' + escapeHtml(summary) + "</span>",
        renderMiniChips(note),
        "</button>",
      ].join("");
    }).join("");

    els.noteList.querySelectorAll("[data-note-id]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        openNote(btn.getAttribute("data-note-id"));
      });
    });
  }

  function noteLinksFor(note) {
    return note ? parseWikiLinks(note.body) : [];
  }

  function backlinksFor(note) {
    if (!note) return [];
    var key = titleKey(note.title);
    if (!key) return [];
    return state.notes.filter(function (candidate) {
      if (candidate.id === note.id) return false;
      return parseWikiLinks(candidate.body).some(function (link) {
        return titleKey(link) === key;
      });
    });
  }

  function renderChipButton(label, className, onClick) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "chip " + (className || "");
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  function renderEditorLinks(note) {
    els.outgoingLinks.innerHTML = "";
    var links = noteLinksFor(note);
    if (!links.length) {
      els.outgoingLinks.innerHTML = '<span class="chip">No outgoing links</span>';
    } else {
      links.forEach(function (link) {
        var target = findNoteByTitle(link);
        els.outgoingLinks.appendChild(renderChipButton(
          target ? "[[" + displayTitle(target) + "]]" : "Create [[" + link + "]]",
          target ? "chip-link" : "chip-missing",
          function () { createOrOpenLinkedNote(link); }
        ));
      });
    }

    els.backlinks.innerHTML = "";
    var backlinks = backlinksFor(note);
    if (!backlinks.length) {
      els.backlinks.innerHTML = '<span class="chip">No backlinks yet</span>';
    } else {
      backlinks.forEach(function (source) {
        els.backlinks.appendChild(renderChipButton(displayTitle(source), "chip-link", function () {
          openNote(source.id);
        }));
      });
    }

    els.tagList.innerHTML = "";
    if (!note.tags.length) {
      els.tagList.innerHTML = '<span class="chip">No tags yet</span>';
    } else {
      note.tags.forEach(function (tag) {
        els.tagList.appendChild(renderChipButton("#" + tag, "chip-tag", function () {
          searchQuery = "#" + tag;
          els.searchInput.value = searchQuery;
          setView("home");
        }));
      });
    }
  }

  function renderEditor() {
    var note = getActiveNote();
    if (!note) {
      els.titleInput.value = "";
      els.bodyInput.value = "";
      els.editorMeta.textContent = "Create a note to begin.";
      renderEditorLinks(null);
      return;
    }

    if (document.activeElement !== els.titleInput && els.titleInput.value !== note.title) {
      els.titleInput.value = note.title;
    }
    if (document.activeElement !== els.bodyInput && els.bodyInput.value !== note.body) {
      els.bodyInput.value = note.body;
    }
    var linkCount = noteLinksFor(note).length;
    els.editorMeta.textContent = "Updated " + formatDate(note.updatedAt) + " - " + linkCount + " link" + (linkCount === 1 ? "" : "s");
    renderEditorLinks(note);
  }

  function graphData() {
    var nodes = state.notes.map(function (note) {
      return { id: note.id, title: displayTitle(note), note: note };
    });
    var edges = [];
    state.notes.forEach(function (note) {
      parseWikiLinks(note.body).forEach(function (link) {
        var target = findNoteByTitle(link);
        if (target) edges.push({ from: note.id, to: target.id });
      });
    });
    return { nodes: nodes, edges: edges };
  }

  function renderGraph() {
    var data = graphData();
    els.graphCount.textContent = data.nodes.length + " note" + (data.nodes.length === 1 ? "" : "s");
    renderGraphSvg(data);
    renderGraphList(data);
  }

  function renderGraphSvg(data) {
    var svg = els.graphSvg;
    var width = 720;
    var height = 520;
    var centerX = width / 2;
    var centerY = height / 2;
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    svg.innerHTML = "";

    if (!data.nodes.length) {
      var empty = document.createElementNS("http://www.w3.org/2000/svg", "text");
      empty.setAttribute("x", centerX);
      empty.setAttribute("y", centerY);
      empty.setAttribute("text-anchor", "middle");
      empty.setAttribute("fill", "#a7b0c0");
      empty.textContent = "No notes yet";
      svg.appendChild(empty);
      return;
    }

    var radius = Math.min(220, Math.max(90, 42 + data.nodes.length * 14));
    var positions = {};
    data.nodes.forEach(function (node, index) {
      var angle = data.nodes.length === 1 ? -Math.PI / 2 : (Math.PI * 2 * index) / data.nodes.length - Math.PI / 2;
      positions[node.id] = {
        x: data.nodes.length === 1 ? centerX : centerX + Math.cos(angle) * radius,
        y: data.nodes.length === 1 ? centerY : centerY + Math.sin(angle) * radius,
      };
    });

    data.edges.forEach(function (edge) {
      if (!positions[edge.from] || !positions[edge.to]) return;
      var line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("class", "graph-edge");
      line.setAttribute("x1", positions[edge.from].x);
      line.setAttribute("y1", positions[edge.from].y);
      line.setAttribute("x2", positions[edge.to].x);
      line.setAttribute("y2", positions[edge.to].y);
      svg.appendChild(line);
    });

    data.nodes.forEach(function (node) {
      var pos = positions[node.id];
      var group = document.createElementNS("http://www.w3.org/2000/svg", "g");
      group.setAttribute("class", "graph-node" + (node.id === activeNoteId ? " is-active" : ""));
      group.setAttribute("tabindex", "0");
      group.setAttribute("role", "button");
      group.setAttribute("aria-label", "Open " + node.title);
      group.addEventListener("click", function () { openNote(node.id); });
      group.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openNote(node.id);
        }
      });

      var circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", pos.x);
      circle.setAttribute("cy", pos.y);
      circle.setAttribute("r", node.id === activeNoteId ? 18 : 15);
      group.appendChild(circle);

      var text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", pos.x);
      text.setAttribute("y", pos.y + 34);
      text.setAttribute("text-anchor", "middle");
      text.textContent = node.title.length > 24 ? node.title.slice(0, 21) + "..." : node.title;
      group.appendChild(text);

      svg.appendChild(group);
    });
  }

  function renderGraphList(data) {
    if (!data.nodes.length) {
      els.graphList.innerHTML = '<div class="empty-state"><p>No links to show yet.</p></div>';
      return;
    }
    els.graphList.innerHTML = data.nodes.map(function (node) {
      var links = parseWikiLinks(node.note.body);
      var chips = links.length
        ? links.map(function (link) {
            var target = findNoteByTitle(link);
            return '<button type="button" class="chip ' + (target ? "chip-link" : "chip-missing") + '" data-link-title="' + escapeHtml(link) + '">' + escapeHtml(target ? target.title : "Create " + link) + "</button>";
          }).join("")
        : '<span class="chip">No outgoing links</span>';
      return [
        '<div class="graph-list-item">',
        '<h3><button type="button" class="chip chip-link" data-note-id="' + escapeHtml(node.id) + '">' + escapeHtml(node.title) + "</button></h3>",
        '<div class="chip-list">' + chips + "</div>",
        "</div>",
      ].join("");
    }).join("");

    els.graphList.querySelectorAll("[data-note-id]").forEach(function (btn) {
      btn.addEventListener("click", function () { openNote(btn.getAttribute("data-note-id")); });
    });
    els.graphList.querySelectorAll("[data-link-title]").forEach(function (btn) {
      btn.addEventListener("click", function () { createOrOpenLinkedNote(btn.getAttribute("data-link-title")); });
    });
  }

  function renderAll() {
    if (!els.homeView) return;
    renderHome();
    renderEditor();
    if (currentView === "graph") renderGraph();
  }

  function insertWikiLink() {
    var note = getActiveNote();
    if (!note || !els.bodyInput) return;
    var target = prompt("Link to which idea?");
    target = normalizeTitle(target);
    if (!target) return;
    var insertion = "[[" + target + "]]";
    var start = els.bodyInput.selectionStart || 0;
    var end = els.bodyInput.selectionEnd || start;
    var before = els.bodyInput.value.slice(0, start);
    var after = els.bodyInput.value.slice(end);
    els.bodyInput.value = before + insertion + after;
    els.bodyInput.focus();
    els.bodyInput.setSelectionRange(start + insertion.length, start + insertion.length);
    updateActiveNoteFromInputs();
  }

  function exportJson() {
    saveData();
    var payload = {
      format: EXPORT_FORMAT,
      exportedAt: nowIso(),
      data: normalizeData(state),
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    var stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = "idea-notes-" + stamp + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast("Exported notes");
  }

  function extractImportData(parsed) {
    if (typeof AppsBackup !== "undefined" && AppsBackup.isUnifiedBackup(parsed)) {
      return AppsBackup.getAppSlice(parsed, APP_ID);
    }
    if (parsed && parsed.format === EXPORT_FORMAT && parsed.data) return parsed.data;
    return parsed;
  }

  function importJsonFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onerror = function () { toast("Could not read file"); };
    reader.onload = function () {
      try {
        var parsed = JSON.parse(reader.result);
        var slice = extractImportData(parsed);
        if (!slice) {
          toast("No Idea Notes data in file");
          return;
        }
        var incoming = normalizeData(slice);
        if (!Array.isArray(incoming.notes)) throw new Error("Missing notes");
        state = mergeData(state, incoming);
        activeNoteId = state.activeNoteId || (state.notes[0] && state.notes[0].id) || null;
        saveData();
        setView("home");
        toast("Imported " + incoming.notes.length + " note" + (incoming.notes.length === 1 ? "" : "s"));
      } catch (e) {
        toast("Invalid Idea Notes JSON");
      } finally {
        if (els.importJsonFile) els.importJsonFile.value = "";
      }
    };
    reader.readAsText(file);
  }

  function mergeData(existing, incoming) {
    existing = normalizeData(existing);
    incoming = normalizeData(incoming);
    var notes = existing.notes.slice();
    var ids = {};
    var keys = {};
    notes.forEach(function (note) {
      ids[note.id] = note;
      var key = titleKey(note.title);
      if (key) keys[key] = note;
    });

    incoming.notes.forEach(function (note) {
      var titleMatch = keys[titleKey(note.title)];
      if (ids[note.id]) {
        if (new Date(note.updatedAt) > new Date(ids[note.id].updatedAt)) {
          Object.assign(ids[note.id], note);
        }
        return;
      }
      if (titleMatch) {
        if (new Date(note.updatedAt) > new Date(titleMatch.updatedAt)) {
          titleMatch.body = note.body;
          titleMatch.tags = note.tags;
          titleMatch.updatedAt = note.updatedAt;
        }
        return;
      }
      notes.push(note);
      ids[note.id] = note;
      var key = titleKey(note.title);
      if (key) keys[key] = note;
    });

    return normalizeData({
      version: 1,
      notes: notes,
      activeNoteId: incoming.activeNoteId || existing.activeNoteId,
    });
  }

  function openSettings() {
    els.settingsOverlay.hidden = false;
  }

  function closeSettings() {
    els.settingsOverlay.hidden = true;
  }

  function cacheElements() {
    [
      "homeView",
      "editorView",
      "graphView",
      "newNoteBtn",
      "searchInput",
      "showAllBtn",
      "openGraphBtn",
      "statsRow",
      "noteListLabel",
      "noteList",
      "emptyState",
      "backToHomeBtn",
      "editorGraphBtn",
      "titleInput",
      "bodyInput",
      "editorMeta",
      "insertLinkBtn",
      "deleteNoteBtn",
      "outgoingLinks",
      "backlinks",
      "tagList",
      "graphBackBtn",
      "graphNewBtn",
      "graphCount",
      "graphSvg",
      "graphList",
      "settingsBtn",
      "settingsOverlay",
      "settingsCloseBtn",
      "exportJsonBtn",
      "importJsonFile",
      "toast",
    ].forEach(function (id) {
      els[id] = document.getElementById(id);
    });
  }

  function bindEvents() {
    els.newNoteBtn.addEventListener("click", function () { createNote(); });
    els.graphNewBtn.addEventListener("click", function () { createNote(); });
    els.openGraphBtn.addEventListener("click", function () { setView("graph"); });
    els.editorGraphBtn.addEventListener("click", function () { setView("graph"); });
    els.graphBackBtn.addEventListener("click", function () { setView("home"); });
    els.backToHomeBtn.addEventListener("click", function () { setView("home"); });
    els.showAllBtn.addEventListener("click", function () {
      searchQuery = "";
      els.searchInput.value = "";
      renderHome();
    });
    els.searchInput.addEventListener("input", function () {
      searchQuery = els.searchInput.value;
      renderHome();
    });
    els.titleInput.addEventListener("input", updateActiveNoteFromInputs);
    els.bodyInput.addEventListener("input", updateActiveNoteFromInputs);
    els.insertLinkBtn.addEventListener("click", insertWikiLink);
    els.deleteNoteBtn.addEventListener("click", deleteActiveNote);
    els.settingsBtn.addEventListener("click", openSettings);
    els.settingsCloseBtn.addEventListener("click", closeSettings);
    els.settingsOverlay.addEventListener("click", function (event) {
      if (event.target === els.settingsOverlay) closeSettings();
    });
    els.exportJsonBtn.addEventListener("click", exportJson);
    els.importJsonFile.addEventListener("change", function () {
      importJsonFile(els.importJsonFile.files && els.importJsonFile.files[0]);
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !els.settingsOverlay.hidden) closeSettings();
    });
  }

  function init() {
    cacheElements();
    bindEvents();
    if (!activeNoteId && state.notes[0]) activeNoteId = state.notes[0].id;
    renderAll();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
