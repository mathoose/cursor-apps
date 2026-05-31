(function () {
  "use strict";

  var core = window.WC2026Core;
  var matches = window.WC2026.MATCHES;
  var matchById = {};
  matches.forEach(function (m) { matchById[m.id] = m; });

  var container = document.getElementById("matches");
  var searchEl = document.getElementById("search");
  var groupEl = document.getElementById("filter-group");
  var matchdayEl = document.getElementById("filter-matchday");
  var progressEl = document.getElementById("progress");
  var clearBtn = document.getElementById("clear-scores");

  var modal = document.getElementById("score-modal");
  var modalMeta = document.getElementById("modal-meta");
  var modalHomeName = document.getElementById("modal-home-name");
  var modalAwayName = document.getElementById("modal-away-name");
  var modalHome = document.getElementById("modal-home");
  var modalAway = document.getElementById("modal-away");
  var modalNote = document.getElementById("modal-note");
  var modalSave = document.getElementById("modal-save");
  var modalClear = document.getElementById("modal-clear");
  var modalClose = document.getElementById("modal-close");

  var activeMatchId = null;

  Object.keys(window.WC2026.GROUPS).sort().forEach(function (g) {
    var opt = document.createElement("option");
    opt.value = g;
    opt.textContent = "Group " + g;
    groupEl.appendChild(opt);
  });

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function updateProgress() {
    progressEl.textContent = core.countPlayed() + " / 72 results entered";
  }

  function scoreLabel(score) {
    if (core.isPlayed(score)) {
      return score.home + " \u2013 " + score.away;
    }
    return "Tap to score";
  }

  function renderMatchRow(m, score) {
    var played = core.isPlayed(score);
    var note = score && score.note ? score.note : "";
    return (
      '<button type="button" class="match-row' + (played ? " played" : "") + '" data-id="' + m.id + '">' +
        '<div class="match-row-top">' +
          '<span class="match-row-time">' + escapeHtml(core.formatDate(m.date)) + " \u00b7 " + escapeHtml(core.formatTime(m.time)) + "</span>" +
          '<span class="group-badge">' + escapeHtml(m.group) + "</span>" +
        "</div>" +
        '<div class="match-row-teams">' +
          '<span class="match-row-team">' + escapeHtml(core.flag(m.home)) + " " + escapeHtml(m.home) + "</span>" +
          '<span class="match-row-score' + (played ? "" : " pending") + '">' + escapeHtml(scoreLabel(score)) + "</span>" +
          '<span class="match-row-team">' + escapeHtml(core.flag(m.away)) + " " + escapeHtml(m.away) + "</span>" +
        "</div>" +
        '<div class="match-row-bottom">' +
          '<span class="match-row-venue">' + escapeHtml(m.venue) + "</span>" +
          (note ? '<span class="match-row-note" title="' + escapeHtml(note) + '">' + escapeHtml(note) + "</span>" : "") +
        "</div>" +
      "</button>"
    );
  }

  function filterMatches() {
    var q = searchEl.value.trim().toLowerCase();
    var group = groupEl.value;
    var matchday = matchdayEl.value;

    return matches.filter(function (m) {
      if (group && m.group !== group) return false;
      if (matchday && String(m.matchday) !== matchday) return false;
      if (q) {
        var hay = (m.home + " " + m.away + " " + m.venue + " " + m.group).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function render() {
    if (activeMatchId !== null) return;

    var filtered = filterMatches();
    var scores = core.readScores();
    var html = "";
    var lastMatchday = null;
    var lastDate = null;

    if (!filtered.length) {
      container.innerHTML = '<div class="empty-state">No matches match your filters.</div>';
      return;
    }

    filtered.forEach(function (m) {
      if (m.matchday !== lastMatchday) {
        html += '<div class="matchday-label">Matchday ' + m.matchday + "</div>";
        lastMatchday = m.matchday;
        lastDate = null;
      }
      if (m.date !== lastDate) {
        html += '<div class="date-label">' + escapeHtml(core.formatDate(m.date)) + "</div>";
        lastDate = m.date;
      }
      html += renderMatchRow(m, scores[String(m.id)]);
    });

    container.innerHTML = html;
  }

  function openModal(matchId) {
    var m = matchById[matchId];
    if (!m) return;

    activeMatchId = matchId;
    var score = core.getScore(matchId);

    modalMeta.textContent =
      core.formatDate(m.date) + " \u00b7 " + core.formatTime(m.time) +
      " \u00b7 Group " + m.group + " \u00b7 " + m.venue;

    modalHomeName.textContent = m.home;
    modalAwayName.textContent = m.away;
    modalHome.value = score ? score.home : "";
    modalAway.value = score ? score.away : "";
    modalNote.value = score && score.note ? score.note : "";

    modalClear.hidden = !core.isPlayed(score);
    modal.hidden = false;
    document.body.classList.add("modal-open");
    modalHome.focus();
  }

  function closeModal() {
    modal.hidden = true;
    document.body.classList.remove("modal-open");
    activeMatchId = null;
    render();
  }

  function saveModal() {
    if (activeMatchId === null) return;

    var homeVal = modalHome.value.trim();
    var awayVal = modalAway.value.trim();

    if (homeVal === "" || awayVal === "") {
      modalHome.focus();
      modalHome.classList.add("invalid");
      modalAway.classList.add("invalid");
      return;
    }

    core.setScore(activeMatchId, homeVal, awayVal, modalNote.value);
    updateProgress();
    closeModal();
  }

  function clearModalScore() {
    if (activeMatchId === null) return;
    if (!confirm("Remove this result?")) return;
    core.removeScore(activeMatchId);
    updateProgress();
    closeModal();
  }

  container.addEventListener("click", function (e) {
    var row = e.target.closest(".match-row");
    if (!row) return;
    openModal(Number(row.getAttribute("data-id")));
  });

  modalSave.addEventListener("click", saveModal);
  modalClear.addEventListener("click", clearModalScore);
  modalClose.addEventListener("click", closeModal);

  modal.addEventListener("click", function (e) {
    if (e.target === modal) closeModal();
  });

  [modalHome, modalAway].forEach(function (input) {
    input.addEventListener("input", function () {
      input.classList.remove("invalid");
    });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        saveModal();
      }
    });
  });

  document.addEventListener("keydown", function (e) {
    if (modal.hidden) return;
    if (e.key === "Escape") closeModal();
  });

  searchEl.addEventListener("input", render);
  groupEl.addEventListener("change", render);
  matchdayEl.addEventListener("change", render);

  clearBtn.addEventListener("click", function () {
    if (confirm("Clear all entered scores?")) {
      core.clearAllScores();
      updateProgress();
      render();
    }
  });

  core.onScoresChange(function () {
    updateProgress();
    render();
  });

  updateProgress();
  render();
})();
