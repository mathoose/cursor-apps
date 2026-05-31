(function () {
  "use strict";

  var core = window.WC2026Core;
  var container = document.getElementById("groups");
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

  function renderGroup(groupKey, rows) {
    var body = rows.map(function (row, i) {
      var qualify = i < 2 ? " qualify" : "";
      return (
        "<tr class=\"" + qualify.trim() + "\">" +
          "<td><span class=\"team-cell\">" +
            "<span>" + escapeHtml(core.flag(row.team)) + "</span>" +
            "<span>" + escapeHtml(row.team) + "</span>" +
          "</span></td>" +
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
          '<span>Top 2 advance</span></div>' +
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

  function render() {
    var standings = core.computeStandings();
    var groupKeys = Object.keys(standings).sort();
    container.innerHTML = groupKeys.map(function (g) {
      return renderGroup(g, standings[g]);
    }).join("");
    updateProgress();
    updatedEl.textContent = "Updated " + new Date().toLocaleTimeString();
  }

  core.onScoresChange(render);
  render();
})();
