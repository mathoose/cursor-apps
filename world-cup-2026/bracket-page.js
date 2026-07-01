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
  var modalDrawOptions = document.getElementById("modal-draw-options");
  var modalAetToggle = document.getElementById("modal-aet-toggle");
  var modalPenToggle = document.getElementById("modal-pen-toggle");
  var modalAetBlock = document.getElementById("modal-aet-block");
  var modalPenBlock = document.getElementById("modal-pen-block");
  var modalAetHomeName = document.getElementById("modal-aet-home-name");
  var modalAetAwayName = document.getElementById("modal-aet-away-name");
  var modalPenHomeName = document.getElementById("modal-pen-home-name");
  var modalPenAwayName = document.getElementById("modal-pen-away-name");
  var modalAetHome = document.getElementById("modal-aet-home");
  var modalAetAway = document.getElementById("modal-aet-away");
  var modalPenHome = document.getElementById("modal-pen-home");
  var modalPenAway = document.getElementById("modal-pen-away");
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
    if (core.isKnockoutResolved(result)) {
      return '<span class="bracket-score">' + escapeHtml(core.formatKnockoutScore(result)) + "</span>";
    }
    if (core.isPlayed(result)) {
      return '<span class="bracket-vs">needs ET/pens</span>';
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
        (core.isKnockoutResolved(core.getKnockoutResult(m.id)) ? " played" : "") +
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
    var played = core.isKnockoutResolved(result);
    var homeScore = core.isPlayed(result) ? result.home : null;
    var awayScore = core.isPlayed(result) ? result.away : null;
    var extra = played && (core.hasAet(result) || core.hasPens(result))
      ? '<span class="tree-extra-mark">' + escapeHtml(core.formatKnockoutScore(result).replace(/^\d+[\u2013-]\d+\s*/, "")) + "</span>"
      : "";

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
        extra +
      "</button>"
    );
  }

  function columnMatchIds(layout, col) {
    if (col.key === "final") return [layout.final];
    return layout[col.side][col.key];
  }

  function renderTreeGrid(bracket) {
    var layout = window.WC2026_TREE;
    var cols = layout.columns;
    var html = '<div class="bracket-tree-wrap">';

    html += '<div class="bracket-tree-nav">';
    html +=
      '<button type="button" class="bracket-scroll-btn bracket-scroll-left" aria-label="Jump to left side">' +
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg>' +
      "</button>";
    html +=
      '<button type="button" class="bracket-scroll-btn bracket-scroll-right" aria-label="Jump to right side">' +
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M9 18l6-6-6-6"/></svg>' +
      "</button>";
    html += "</div>";

    html += '<div class="bracket-tree-scroll" id="bracket-tree-scroll">';
    html += '<div class="bracket-tree-canvas">';
    html += '<div class="bracket-tree-board">';

    cols.forEach(function (col, colIdx) {
      var ids = columnMatchIds(layout, col);
      var sideAttr = col.side ? ' data-side="' + col.side + '"' : "";
      var colKey = col.key === "final" ? "final" : col.key;
      var colClass = "bracket-tree-col" + (col.key === "final" ? " is-final" : "");

      html +=
        '<div class="' + colClass + '" data-col="' + colKey + '"' + sideAttr +
        ' data-idx="' + colIdx + '">';
      html += '<div class="bracket-tree-col-label">' + escapeHtml(col.label) + "</div>";
      html += '<div class="bracket-tree-col-body count-' + ids.length + '">';

      ids.forEach(function (id) {
        var m = bracket.matchMap[String(id)];
        if (!m) return;
        html += '<div class="bracket-tree-slot">' + treeNodeHtml(m) + "</div>";
      });

      html += "</div></div>";
    });

    html += "</div></div></div>";

    html += '<div class="bracket-tree-extras">';
    html += '<div class="bracket-tree-extra-label">Third place</div>';
    html += treeNodeHtml(bracket.bronze);
    html += "</div>";

    html += '<p class="bracket-hint tree-hint">Swipe sideways for the full bracket · arrows jump to each side · tap a match to enter score</p>';
    html += "</div>";
    return html;
  }

  function scrollTreeTo(side) {
    var scroll = document.getElementById("bracket-tree-scroll");
    if (!scroll) return;

    var selector = side === "left"
      ? '.bracket-tree-col[data-side="left"][data-col="r32"]'
      : '.bracket-tree-col[data-side="right"][data-col="r32"]';
    var col = scroll.querySelector(selector);

    if (!col) {
      scroll.scrollTo({
        left: side === "left" ? 0 : scroll.scrollWidth - scroll.clientWidth,
        behavior: "smooth"
      });
      return;
    }

    var scrollRect = scroll.getBoundingClientRect();
    var colRect = col.getBoundingClientRect();
    var target = scroll.scrollLeft + (colRect.left - scrollRect.left) - 12;

    scroll.scrollTo({
      left: Math.max(0, Math.min(target, scroll.scrollWidth - scroll.clientWidth)),
      behavior: "smooth"
    });
  }

  function setupTreeScroll() {
    var scroll = document.getElementById("bracket-tree-scroll");
    if (!scroll) return;

    var leftBtn = document.querySelector(".bracket-scroll-left");
    var rightBtn = document.querySelector(".bracket-scroll-right");
    if (!leftBtn || !rightBtn) return;

    function needsScroll() {
      return scroll.scrollWidth > scroll.clientWidth + 2;
    }

    function updateButtons() {
      var show = needsScroll();
      leftBtn.hidden = !show;
      rightBtn.hidden = !show;
    }

    function scrollToCenter() {
      if (!needsScroll()) return;
      var finalCol = scroll.querySelector(".bracket-tree-col.is-final");
      if (!finalCol) {
        scroll.scrollLeft = (scroll.scrollWidth - scroll.clientWidth) / 2;
        return;
      }
      var scrollRect = scroll.getBoundingClientRect();
      var colRect = finalCol.getBoundingClientRect();
      var target = scroll.scrollLeft + (colRect.left - scrollRect.left);
      target -= (scroll.clientWidth - colRect.width) / 2;
      scroll.scrollLeft = Math.max(0, Math.min(target, scroll.scrollWidth - scroll.clientWidth));
    }

    if (!scroll.dataset.navReady) {
      scroll.dataset.navReady = "1";
      window.addEventListener("resize", updateButtons);
    }

    updateButtons();
    requestAnimationFrame(scrollToCenter);
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
    var html = '<p class="bracket-hint">Tap a match to enter score. Draws need extra time and/or penalties. Winners advance automatically.</p>';
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

  function clearModalInvalid() {
    [modalHome, modalAway, modalAetHome, modalAetAway, modalPenHome, modalPenAway].forEach(function (el) {
      el.classList.remove("invalid");
    });
  }

  function updateDrawOptions() {
    var homeVal = modalHome.value.trim();
    var awayVal = modalAway.value.trim();
    var isDraw = homeVal !== "" && awayVal !== "" && Number(homeVal) === Number(awayVal);

    modalDrawOptions.hidden = !isDraw;

    if (!isDraw) {
      modalAetToggle.checked = false;
      modalPenToggle.checked = false;
      modalAetBlock.hidden = true;
      modalPenBlock.hidden = true;
      modalAetHome.value = "";
      modalAetAway.value = "";
      modalPenHome.value = "";
      modalPenAway.value = "";
      return;
    }

    modalAetBlock.hidden = !modalAetToggle.checked;
    modalPenBlock.hidden = !modalPenToggle.checked;

    if (modalAetToggle.checked) {
      var aetHome = modalAetHome.value.trim();
      var aetAway = modalAetAway.value.trim();
      if (aetHome !== "" && aetAway !== "" && Number(aetHome) === Number(aetAway)) {
        modalPenToggle.checked = true;
        modalPenBlock.hidden = false;
      }
    }
  }

  function openModal(matchId) {
    var m = findMatch(Number(matchId));
    if (!m || !m.home.team || !m.away.team) return;

    activeMatch = m;
    var result = core.getKnockoutResult(m.id);

    modalMeta.textContent = "M" + m.id + " · " + m.date + " · " + m.venue;
    modalHomeName.textContent = m.home.team;
    modalAwayName.textContent = m.away.team;
    modalAetHomeName.textContent = m.home.team;
    modalAetAwayName.textContent = m.away.team;
    modalPenHomeName.textContent = m.home.team;
    modalPenAwayName.textContent = m.away.team;
    modalHome.value = result ? result.home : "";
    modalAway.value = result ? result.away : "";
    modalAetHome.value = result && core.hasAet(result) ? result.aetHome : "";
    modalAetAway.value = result && core.hasAet(result) ? result.aetAway : "";
    modalPenHome.value = result && core.hasPens(result) ? result.penHome : "";
    modalPenAway.value = result && core.hasPens(result) ? result.penAway : "";
    modalAetToggle.checked = !!(result && core.hasAet(result));
    modalPenToggle.checked = !!(result && core.hasPens(result));
    modalNote.value = result && result.note ? result.note : "";
    modalClear.hidden = !core.isPlayed(result);
    clearModalInvalid();
    updateDrawOptions();

    modal.hidden = false;
    document.body.classList.add("modal-open");
    modalHome.focus();
  }

  function closeModal() {
    modal.hidden = true;
    document.body.classList.remove("modal-open");
    activeMatch = null;
    clearModalInvalid();
    render();
  }

  function saveModal() {
    if (!activeMatch) return;

    clearModalInvalid();

    var homeVal = modalHome.value.trim();
    var awayVal = modalAway.value.trim();

    if (homeVal === "" || awayVal === "") {
      modalHome.classList.add("invalid");
      modalAway.classList.add("invalid");
      return;
    }

    var opts = { note: modalNote.value };
    var isDraw = Number(homeVal) === Number(awayVal);

    if (isDraw) {
      if (!modalAetToggle.checked && !modalPenToggle.checked) {
        modalAetToggle.focus();
        modalDrawOptions.classList.add("shake");
        setTimeout(function () { modalDrawOptions.classList.remove("shake"); }, 400);
        return;
      }

      if (modalAetToggle.checked) {
        var aetHomeVal = modalAetHome.value.trim();
        var aetAwayVal = modalAetAway.value.trim();
        if (aetHomeVal === "" || aetAwayVal === "") {
          modalAetHome.classList.add("invalid");
          modalAetAway.classList.add("invalid");
          return;
        }
        opts.aetHome = aetHomeVal;
        opts.aetAway = aetAwayVal;

        if (Number(aetHomeVal) !== Number(aetAwayVal)) {
          core.setKnockoutResult(activeMatch.id, homeVal, awayVal, opts);
          closeModal();
          return;
        }
      }

      if (modalPenToggle.checked) {
        var penHomeVal = modalPenHome.value.trim();
        var penAwayVal = modalPenAway.value.trim();
        if (penHomeVal === "" || penAwayVal === "") {
          modalPenHome.classList.add("invalid");
          modalPenAway.classList.add("invalid");
          return;
        }
        if (Number(penHomeVal) === Number(penAwayVal)) {
          modalPenHome.classList.add("invalid");
          modalPenAway.classList.add("invalid");
          return;
        }
        opts.penHome = penHomeVal;
        opts.penAway = penAwayVal;
        core.setKnockoutResult(activeMatch.id, homeVal, awayVal, opts);
        closeModal();
        return;
      }

      if (modalAetToggle.checked) {
        modalPenToggle.checked = true;
        modalPenBlock.hidden = false;
        modalPenHome.classList.add("invalid");
        modalPenAway.classList.add("invalid");
        return;
      }
    }

    core.setKnockoutResult(activeMatch.id, homeVal, awayVal, opts);
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

    if (viewMode === "tree") {
      setupTreeScroll();
    }
  }

  main.addEventListener("click", function (e) {
    var card = e.target.closest(".bracket-match.editable, .tree-node.editable");
    if (card) {
      openModal(card.getAttribute("data-id"));
      return;
    }

    var scroll = document.getElementById("bracket-tree-scroll");
    if (!scroll) return;

    if (e.target.closest(".bracket-scroll-left")) {
      scrollTreeTo("left");
      return;
    }

    if (e.target.closest(".bracket-scroll-right")) {
      scrollTreeTo("right");
      return;
    }
  });

  viewTreeBtn.addEventListener("click", function () { setView("tree"); });
  viewListBtn.addEventListener("click", function () { setView("list"); });

  modalSave.addEventListener("click", saveModal);
  modalClear.addEventListener("click", clearModalResult);
  modalClose.addEventListener("click", closeModal);

  modal.addEventListener("click", function (e) {
    if (e.target === modal) closeModal();
  });

  [modalHome, modalAway, modalAetHome, modalAetAway, modalPenHome, modalPenAway].forEach(function (input) {
    input.addEventListener("input", function () {
      input.classList.remove("invalid");
      updateDrawOptions();
    });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        saveModal();
      }
    });
  });

  modalAetToggle.addEventListener("change", updateDrawOptions);
  modalPenToggle.addEventListener("change", updateDrawOptions);

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
