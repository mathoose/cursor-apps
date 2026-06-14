(function () {
  "use strict";

  var core = window.WC2026Core;
  var container = document.getElementById("groups");
  var thirdPlaceEl = document.getElementById("third-place");
  var progressEl = document.getElementById("progress");
  var updatedEl = document.getElementById("updated");

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

  function rowClass(index) {
    if (index < 2) return "qualify";
    if (index === 2) return "wildcard";
    return "out";
  }

  function renderTeamCell(team) {
    return (
      '<button type="button" class="team-cell team-btn" data-team="' + escapeHtml(team) + '">' +
        "<span>" + escapeHtml(core.flag(team)) + "</span>" +
        "<span>" + escapeHtml(team) + "</span>" +
      "</button>"
    );
  }

  function renderGroup(groupKey, rows) {
    var body = rows.map(function (row, i) {
      return (
        "<tr class=\"" + rowClass(i) + "\">" +
          "<td>" + renderTeamCell(row.team) + "</td>" +
          "<td>" + row.played + "</td>" +
          "<td>" + row.won + "</td>" +
          "<td>" + row.drawn + "</td>" +
          "<td>" + row.lost + "</td>" +
          "<td>" + row.gf + "</td>" +
          "<td>" + row.ga + "</td>" +
          "<td>" + (row.gd > 0 ? "+" : "") + row.gd + "</td>" +
          "<td class=\"pts\">" + row.pts + "</td>" +
        "</tr>"
      );
    }).join("");

    return (
      '<section class="group-panel">' +
        '<div class="group-header">Group ' + escapeHtml(groupKey) +
          '<span>Top 2 → R32</span></div>' +
        '<table class="standings-table">' +
          "<thead><tr>" +
            "<th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th>" +
            "<th>GF</th><th>GA</th><th>GD</th><th>Pts</th>" +
          "</tr></thead>" +
          "<tbody>" + body + "</tbody>" +
        "</table>" +
      "</section>"
    );
  }

  function renderThirdPlace(rows) {
    var body = rows.map(function (row, i) {
      var cls = i < 8 ? "qualify" : "out";
      return (
        "<tr class=\"" + cls + "\">" +
          "<td>" + (i + 1) + "</td>" +
          "<td>" + renderTeamCell(row.team) + "</td>" +
          "<td>" + escapeHtml(row.group) + "</td>" +
          "<td>" + row.played + "</td>" +
          "<td>" + row.pts + "</td>" +
          "<td>" + (row.gd > 0 ? "+" : "") + row.gd + "</td>" +
          "<td>" + row.gf + "</td>" +
        "</tr>"
      );
    }).join("");

    return (
      '<section class="third-place-panel">' +
        '<div class="group-header">' +
          "Best 3rd-place teams" +
          '<span>Top 8 of 12 → R32</span>' +
        "</div>" +
        '<p class="third-place-note">All 12 group winners and runners-up (24 teams) qualify automatically. The eight best third-place teams fill the remaining Round of 32 spots.</p>' +
        '<table class="standings-table third-place-table">' +
          "<thead><tr>" +
            "<th>#</th><th>Team</th><th>Grp</th><th>P</th><th>Pts</th><th>GD</th><th>GF</th>" +
          "</tr></thead>" +
          "<tbody>" + body + "</tbody>" +
        "</table>" +
      "</section>"
    );
  }

  function render() {
    var standings = core.computeStandings();
    var groupKeys = Object.keys(standings).sort();
    container.innerHTML = groupKeys.map(function (g) {
      return renderGroup(g, standings[g]);
    }).join("");

    thirdPlaceEl.innerHTML = renderThirdPlace(core.computeThirdPlaceRanking(standings));
    updateProgress();
    updatedEl.textContent = "Updated " + new Date().toLocaleTimeString();
  }

  document.addEventListener("click", function (e) {
    var btn = e.target.closest(".team-btn");
    if (!btn) return;
    if (window.WC2026TeamModal) {
      window.WC2026TeamModal.open(btn.getAttribute("data-team"));
    }
  });

  core.onScoresChange(render);
  render();
})();
