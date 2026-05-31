(function () {
  "use strict";

  var core = window.WC2026Core;
  var matches = window.WC2026.MATCHES;
  var container = document.getElementById("matches");
  var searchEl = document.getElementById("search");
  var groupEl = document.getElementById("filter-group");
  var matchdayEl = document.getElementById("filter-matchday");
  var progressEl = document.getElementById("progress");
  var clearBtn = document.getElementById("clear-scores");

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

  function saveScore(matchId, homeInput, awayInput) {
    var homeVal = homeInput.value.trim();
    var awayVal = awayInput.value.trim();
    if (homeVal === "" && awayVal === "") {
      core.setScore(matchId, "", "");
    } else if (homeVal !== "" && awayVal !== "") {
      core.setScore(matchId, homeVal, awayVal);
    }
    updateProgress();
    render();
  }

  function renderMatchCard(m, score) {
    var played = core.isPlayed(score);
    var cardClass = "match-card" + (played ? " played" : "");
    return (
      '<article class="' + cardClass + '" data-id="' + m.id + '">' +
        '<div class="match-meta">' +
          '<span>' + escapeHtml(core.formatDate(m.date)) + " · " + escapeHtml(core.formatTime(m.time)) + "</span>" +
          '<span class="group-badge">Group ' + escapeHtml(m.group) + "</span>" +
        "</div>" +
        '<div class="match-body">' +
          '<div class="team home">' +
            '<span class="team-flag">' + escapeHtml(core.flag(m.home)) + "</span>" +
            '<span class="team-name">' + escapeHtml(m.home) + "</span>" +
          "</div>" +
          '<div class="score-row">' +
            '<input class="score-input" type="number" min="0" max="20" inputmode="numeric" ' +
              'data-side="home" aria-label="' + escapeHtml(m.home) + ' score" ' +
              'value="' + (played ? score.home : "") + '" />' +
            '<span class="score-sep">–</span>' +
            '<input class="score-input" type="number" min="0" max="20" inputmode="numeric" ' +
              'data-side="away" aria-label="' + escapeHtml(m.away) + ' score" ' +
              'value="' + (played ? score.away : "") + '" />' +
          "</div>" +
          '<div class="team away">' +
            '<span class="team-flag">' + escapeHtml(core.flag(m.away)) + "</span>" +
            '<span class="team-name">' + escapeHtml(m.away) + "</span>" +
          "</div>" +
        "</div>" +
        '<div class="venue">' + escapeHtml(m.venue) + "</div>" +
      "</article>"
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
      html += renderMatchCard(m, scores[String(m.id)]);
    });

    container.innerHTML = html;
    bindInputs();
  }

  function bindInputs() {
    container.querySelectorAll(".match-card").forEach(function (card) {
      var id = card.getAttribute("data-id");
      var homeInput = card.querySelector('[data-side="home"]');
      var awayInput = card.querySelector('[data-side="away"]');

      function commit() {
        saveScore(id, homeInput, awayInput);
      }

      [homeInput, awayInput].forEach(function (input) {
        input.addEventListener("change", commit);
        input.addEventListener("blur", commit);
        input.addEventListener("keydown", function (e) {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
            input.blur();
          }
        });
      });
    });
  }

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
