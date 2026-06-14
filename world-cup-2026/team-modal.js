(function () {
  "use strict";

  var core = window.WC2026Core;
  var modal = document.getElementById("team-modal");
  if (!modal) return;

  var titleEl = document.getElementById("team-modal-title");
  var metaEl = document.getElementById("team-modal-meta");
  var statusEl = document.getElementById("team-modal-status");
  var matchesEl = document.getElementById("team-modal-matches");
  var closeBtn = document.getElementById("team-modal-close");

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function matchResultLabel(m, score, team) {
    if (!core.isPlayed(score)) return { text: "Upcoming", cls: "upcoming" };

    var isHome = m.home === team;
    var gf = isHome ? score.home : score.away;
    var ga = isHome ? score.away : score.home;
    var outcome;

    if (gf > ga) outcome = "W";
    else if (gf < ga) outcome = "L";
    else outcome = "D";

    return {
      text: gf + "–" + ga + " " + outcome,
      cls: outcome === "W" ? "win" : outcome === "L" ? "loss" : "draw"
    };
  }

  function renderTeamMatch(m, team, scores) {
    var score = scores[String(m.id)];
    var isHome = m.home === team;
    var opponent = isHome ? m.away : m.home;
    var venue = isHome ? "vs" : "@";
    var result = matchResultLabel(m, score, team);

    return (
      '<li class="team-match-item' + (core.isPlayed(score) ? " played" : "") + '">' +
        '<div class="team-match-date">' +
          escapeHtml(core.formatDate(m.date)) + " · " + escapeHtml(core.formatTime(m.time)) +
        "</div>" +
        '<div class="team-match-main">' +
          '<span class="team-match-opponent">' +
            escapeHtml(venue) + " " + escapeHtml(core.flag(opponent)) + " " + escapeHtml(opponent) +
          "</span>" +
          '<span class="team-match-result ' + result.cls + '">' + escapeHtml(result.text) + "</span>" +
        "</div>" +
        '<div class="team-match-venue">Group ' + escapeHtml(m.group) + " · " + escapeHtml(m.venue) + "</div>" +
      "</li>"
    );
  }

  function renderStatus(standing) {
    if (!standing) return "";

    var row = standing.row;
    var stats =
      row.played + " played · " +
      row.won + "W " + row.drawn + "D " + row.lost + "L · " +
      row.gf + "–" + row.ga + " · " +
      (row.gd > 0 ? "+" : "") + row.gd + " GD · " +
      row.pts + " pts";

    return (
      '<div class="team-status-card ' + standing.status + '">' +
        '<div class="team-status-label">' + escapeHtml(standing.statusLabel) + "</div>" +
        '<div class="team-status-detail">' + escapeHtml(standing.statusDetail) + "</div>" +
        '<div class="team-status-stats">' + escapeHtml(stats) + "</div>" +
      "</div>"
    );
  }

  function openTeamModal(team) {
    if (!team) return;

    var standing = core.getTeamStanding(team);
    var teamMatches = core.getTeamMatches(team);
    var scores = core.readScores();
    var group = core.getTeamGroup(team);

    titleEl.innerHTML =
      '<span class="team-modal-flag">' + escapeHtml(core.flag(team)) + "</span>" +
      "<span>" + escapeHtml(team) + "</span>";

    metaEl.textContent = group ? "Group " + group + " · " + teamMatches.length + " group-stage matches" : "";
    statusEl.innerHTML = renderStatus(standing);

    matchesEl.innerHTML = teamMatches.map(function (m) {
      return renderTeamMatch(m, team, scores);
    }).join("");

    modal.hidden = false;
    document.body.classList.add("modal-open");
    closeBtn.focus();
  }

  function closeTeamModal() {
    modal.hidden = true;
    document.body.classList.remove("modal-open");
  }

  closeBtn.addEventListener("click", closeTeamModal);

  modal.addEventListener("click", function (e) {
    if (e.target === modal) closeTeamModal();
  });

  document.addEventListener("keydown", function (e) {
    if (modal.hidden) return;
    if (e.key === "Escape") closeTeamModal();
  });

  window.WC2026TeamModal = {
    open: openTeamModal,
    close: closeTeamModal
  };
})();
