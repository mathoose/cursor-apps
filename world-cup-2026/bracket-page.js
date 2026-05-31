(function () {
  "use strict";

  var core = window.WC2026Core;
  var main = document.getElementById("bracket-main");
  var scenarioEl = document.getElementById("scenario-info");
  var clearBtn = document.getElementById("clear-bracket");
  var viewTreeBtn = document.getElementById("view-tree");
  var viewListBtn = document.getElementById("view-list");

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

  var activeMatch = null;
  var cachedBracket = null;
  var viewMode = "tree";

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function shortName(team) {
    if (!team) return "TBD";
    if (team.length <= 10) return team;
    var map = {
      "Korea Republic": "S. Korea",
      "Bosnia and Herzegovina": "Bosnia",
      "Côte d'Ivoire": "Côte d'Ivoire",
      "Cabo Verde": "Cabo Verde",
      "New Zealand": "N. Zealand",
      "Saudi Arabia": "Saudi Arabia",
      "South Africa": "S. Africa",
      "Congo DR": "Congo DR"
    };
    return map[team] || team.split(" ").pop();
  }

  function getWinnerTeam(m) {
    if (!m.home.team || !m.away.team) return null;
    return core.getKnockoutWinner(m.id, m.home.team, m.away.team);
  }

  function sideHtml(side, winnerTeam) {
    var isWinner = winnerTeam && side.team && winnerTeam === side.team;
    var cls = "bracket-team" + (isWinner ? " winner" : "");
    var inner = side.team
      ? escapeHtml(core.flag(side.team)) + " " + escapeHtml(side.team)
      : escapeHtml(side.label);
    var sub = side.role || (side.preview ? side.preview : "");
    return (
      '<div class="' + cls + '">' +
        '<span class="bracket-team-name">' + inner + "</span>" +
        (sub ? '<span class="bracket-team-role">' + escapeHtml(sub) + "</span>" : "") +
      "</div>"
    );
  }

  function scoreCenterHtml(m) {
    var result = core.getKnockoutResult(m.id);
    if (core.isPlayed(result)) {
      return '<span class="bracket-score">' + result.home + "\u2013" + result.away + "</span>";
    }
    if (m.home.team && m.away.team) {
      return '<span class="bracket-vs">tap</span>';
    }
    return '<span class="bracket-vs locked">TBD</span>';
  }

  function matchHtml(m) {
    var winner = getWinnerTeam(m);
    var editable = !!(m.home.team && m.away.team);
    return (
      '<button type="button" class="bracket-match' +
        (m.isFinal ? " final" : "") +
        (m.isBronze ? " bronze" : "") +
        (editable ? " editable" : " locked") +
        (core.isPlayed(core.getKnockoutResult(m.id)) ? " played" : "") +
        '" data-id="' + m.id + '"' +
        (editable ? "" : " disabled") + ">" +
        '<div class="bracket-match-head">' +
          '<span>M' + m.id + " · " + escapeHtml(m.date) + "</span>" +
          (winner ? '<span class="bracket-advanced">' + escapeHtml(core.flag(winner)) + " " + escapeHtml(winner) + "</span>" : "") +
        "</div>" +
        '<div class="bracket-match-teams">' +
          sideHtml(m.home, winner) +
          scoreCenterHtml(m) +
          sideHtml(m.away, winner) +
        "</div>" +
        '<div class="bracket-venue">' + escapeHtml(m.venue) + "</div>" +
      "</button>"
    );
  }

  function treeTeamLine(side, scoreVal, winnerTeam) {
    var isWinner = winnerTeam && side.team && winnerTeam === side.team;
    var isLoser = winnerTeam && side.team && winnerTeam !== side.team;
    var cls = "tree-team" + (isWinner ? " winner" : "") + (isLoser ? " out" : "");
    var flag = side.team ? escapeHtml(core.flag(side.team)) : "\u2753";
    var name = side.team ? escapeHtml(shortName(side.team)) : escapeHtml(side.label);
    var score = scoreVal !== null && scoreVal !== undefined
      ? '<span class="tree-team-score">' + scoreVal + "</span>"
      : "";
    return (
      '<div class="' + cls + '">' +
        '<span class="tree-flag">' + flag + "</span>" +
        '<span class="tree-name">' + name + "</span>" +
        score +
      "</div>"
    );
  }

  function treeNodeHtml(m) {
    var winner = getWinnerTeam(m);
    var editable = !!(m.home.team && m.away.team);
    var result = core.getKnockoutResult(m.id);
    var played = core.isPlayed(result);
    var homeScore = played ? result.home : null;
    var awayScore = played ? result.away : null;

    return (
      '<button type="button" class="tree-node' +
        (m.isFinal ? " final" : "") +
        (m.isBronze ? " bronze" : "") +
        (editable ? " editable" : " locked") +
        (played ? " played" : "") +
        '" data-id="' + m.id + '"' +
        (editable ? "" : " disabled") + ">" +
        treeTeamLine(m.home, homeScore, winner) +
        treeTeamLine(m.away, awayScore, winner) +
      "</button>"
    );
  }

  function renderTreeGrid(bracket) {
    var layout = window.WC2026_TREE;
    var cols = layout.columns;
    var html = '<div class="bracket-tree-wrap"><div class="bracket-tree-scroll">';

    html += '<div class="bracket-tree-header">';
    cols.forEach(function (col) {
      html += '<div class="bracket-tree-col-label">' + escapeHtml(col.label) + "</div>";
    });
    html += "</div>";

    html += '<div class="bracket-tree-grid">';
    cols.forEach(function (col, colIdx) {
      var ids = col.key === "final"
        ? [layout.final]
        : layout[col.key];
      var span = col.span;

      ids.forEach(function (id, i) {
        var m = bracket.matchMap[String(id)];
        if (!m) return;
        var rowStart = i * span + 1;
        html +=
          '<div class="bracket-tree-slot" data-col="' + (colIdx + 1) +
          '" style="grid-column:' + (colIdx + 1) +
          ";grid-row:" + rowStart + "/ span " + span + '">' +
          treeNodeHtml(m) +
          "</div>";
      });
    });
    html += "</div></div>";

    html += '<div class="bracket-tree-extras">';
    html += '<div class="bracket-tree-extra-label">Third place</div>';
    html += treeNodeHtml(bracket.bronze);
    html += "</div>";

    html += '<p class="bracket-hint tree-hint">Scroll sideways for the full bracket · tap a match to enter score</p>';
    html += "</div>";
    return html;
  }

  function roundHtml(title, matches) {
    return (
      '<section class="bracket-round">' +
        "<h2 class=\"bracket-round-title\">" + escapeHtml(title) + "</h2>" +
        '<div class="bracket-round-matches">' +
          matches.map(function (m) { return matchHtml(m); }).join("") +
        "</div>" +
      "</section>"
    );
  }

  function renderListView(bracket) {
    var html = '<p class="bracket-hint">Tap a match to enter score. Winners advance automatically; semi losers fill the third-place match.</p>';
    html += roundHtml("Round of 32", bracket.r32);
    html += roundHtml("Round of 16", bracket.r16);
    html += roundHtml("Quarter-finals", bracket.qf);
    html += roundHtml("Semi-finals", bracket.sf);
    html += roundHtml("Third place", [bracket.bronze]);
    html += roundHtml("Final", [bracket.final]);
    return html;
  }

  function findMatch(matchId) {
    if (!cachedBracket) return null;
    return cachedBracket.matchMap[String(matchId)] || null;
  }

  function openModal(matchId) {
    var m = findMatch(Number(matchId));
    if (!m || !m.home.team || !m.away.team) return;

    activeMatch = m;
    var result = core.getKnockoutResult(m.id);

    modalMeta.textContent = "M" + m.id + " · " + m.date + " · " + m.venue;
    modalHomeName.textContent = m.home.team;
    modalAwayName.textContent = m.away.team;
    modalHome.value = result ? result.home : "";
    modalAway.value = result ? result.away : "";
    modalNote.value = result && result.note ? result.note : "";
    modalClear.hidden = !core.isPlayed(result);

    modal.hidden = false;
    document.body.classList.add("modal-open");
    modalHome.focus();
  }

  function closeModal() {
    modal.hidden = true;
    document.body.classList.remove("modal-open");
    activeMatch = null;
    modalHome.classList.remove("invalid");
    modalAway.classList.remove("invalid");
    render();
  }

  function saveModal() {
    if (!activeMatch) return;

    var homeVal = modalHome.value.trim();
    var awayVal = modalAway.value.trim();

    if (homeVal === "" || awayVal === "") {
      modalHome.classList.add("invalid");
      modalAway.classList.add("invalid");
      return;
    }

    if (Number(homeVal) === Number(awayVal)) {
      modalHome.classList.add("invalid");
      modalAway.classList.add("invalid");
      return;
    }

    core.setKnockoutResult(activeMatch.id, homeVal, awayVal, modalNote.value);
    closeModal();
  }

  function clearModalResult() {
    if (!activeMatch) return;
    if (!confirm("Remove this result?")) return;
    core.removeKnockoutResult(activeMatch.id);
    closeModal();
  }

  function setView(mode) {
    viewMode = mode;
    viewTreeBtn.classList.toggle("on", mode === "tree");
    viewListBtn.classList.toggle("on", mode === "list");
    render();
  }

  function render() {
    var standings = core.computeStandings();
    var third = core.computeThirdPlaceRanking(standings);
    var bracket = window.WC2026Bracket.computeBracket(standings, third, window.WC2026_SCENARIOS);
    cachedBracket = bracket;

    if (!bracket.ready) {
      main.innerHTML = '<div class="empty-state">Could not resolve bracket scenario.</div>';
      scenarioEl.textContent = bracket.error || "Error";
      return;
    }

    scenarioEl.textContent =
      "Annex C scenario · 3rd from " + bracket.thirdQualGroups.join(", ");

    if (activeMatch !== null) {
      return;
    }

    var html = "";

    if (bracket.eliminatedThird.length) {
      html += '<div class="bracket-note">' +
        "<strong>3rd-place out:</strong> " +
        bracket.eliminatedThird.map(function (t) {
          return "Gr " + t.group + " " + t.team + " (" + t.pts + " pts)";
        }).join(" · ") +
        "</div>";
    }

    if (viewMode === "tree") {
      html += renderTreeGrid(bracket);
    } else {
      html += renderListView(bracket);
    }

    main.innerHTML = html;
  }

  main.addEventListener("click", function (e) {
    var card = e.target.closest(".bracket-match.editable, .tree-node.editable");
    if (!card) return;
    openModal(card.getAttribute("data-id"));
  });

  viewTreeBtn.addEventListener("click", function () { setView("tree"); });
  viewListBtn.addEventListener("click", function () { setView("list"); });

  modalSave.addEventListener("click", saveModal);
  modalClear.addEventListener("click", clearModalResult);
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

  clearBtn.addEventListener("click", function () {
    if (confirm("Clear all knockout results?")) {
      core.clearKnockoutWinners();
      render();
    }
  });

  core.onScoresChange(render);
  render();
})();
