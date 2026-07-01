(function () {
  "use strict";

  var STORAGE_KEY = "world-cup-2026-scores-v1";
  var listeners = [];

  function readScores() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function writeScores(scores) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(scores));
    listeners.forEach(function (fn) { fn(scores); });
  }

  function getScore(matchId) {
    var scores = readScores();
    return scores[String(matchId)] || null;
  }

  function setScore(matchId, home, away, note) {
    var scores = readScores();
    var key = String(matchId);
    if (home === "" && away === "") {
      delete scores[key];
    } else {
      var entry = { home: Number(home), away: Number(away) };
      if (note && String(note).trim()) {
        entry.note = String(note).trim();
      }
      scores[key] = entry;
    }
    writeScores(scores);
    return scores;
  }

  function removeScore(matchId) {
    var scores = readScores();
    delete scores[String(matchId)];
    writeScores(scores);
    return scores;
  }

  function clearAllScores() {
    writeScores({});
  }

  function onScoresChange(fn) {
    listeners.push(fn);
    return function () {
      listeners = listeners.filter(function (x) { return x !== fn; });
    };
  }

  function flag(team) {
    return (window.WC2026.FLAGS && window.WC2026.FLAGS[team]) || "";
  }

  function formatDate(iso) {
    var d = new Date(iso + "T12:00:00");
    return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  }

  function formatTime(t) {
    var parts = t.split(":");
    var h = parseInt(parts[0], 10);
    var m = parts[1] || "00";
    var ampm = h >= 12 ? "PM" : "AM";
    var h12 = h % 12 || 12;
    return h12 + ":" + m + " " + ampm + " ET";
  }

  function isPlayed(score) {
    return score && Number.isFinite(score.home) && Number.isFinite(score.away);
  }

  function computeStandings() {
    var groups = window.WC2026.GROUPS;
    var matches = window.WC2026.MATCHES;
    var scores = readScores();
    var result = {};

    Object.keys(groups).forEach(function (groupKey) {
      var teams = groups[groupKey];
      var table = {};
      teams.forEach(function (team) {
        table[team] = { team: team, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, pts: 0 };
      });

      matches.filter(function (m) { return m.group === groupKey; }).forEach(function (m) {
        var s = scores[String(m.id)];
        if (!isPlayed(s)) return;

        var h = s.home;
        var a = s.away;
        var homeRow = table[m.home];
        var awayRow = table[m.away];

        homeRow.played += 1;
        awayRow.played += 1;
        homeRow.gf += h;
        homeRow.ga += a;
        awayRow.gf += a;
        awayRow.ga += h;

        if (h > a) {
          homeRow.won += 1;
          homeRow.pts += 3;
          awayRow.lost += 1;
        } else if (h < a) {
          awayRow.won += 1;
          awayRow.pts += 3;
          homeRow.lost += 1;
        } else {
          homeRow.drawn += 1;
          awayRow.drawn += 1;
          homeRow.pts += 1;
          awayRow.pts += 1;
        }
      });

      Object.keys(table).forEach(function (team) {
        table[team].gd = table[team].gf - table[team].ga;
      });

      result[groupKey] = teams
        .map(function (t) { return table[t]; })
        .sort(function (a, b) {
          if (b.pts !== a.pts) return b.pts - a.pts;
          if (b.gd !== a.gd) return b.gd - a.gd;
          if (b.gf !== a.gf) return b.gf - a.gf;
          return a.team.localeCompare(b.team);
        });
    });

    return result;
  }

  function computeThirdPlaceRanking(standings) {
    var third = Object.keys(standings).map(function (groupKey) {
      var row = standings[groupKey][2];
      return {
        group: groupKey,
        team: row.team,
        played: row.played,
        won: row.won,
        drawn: row.drawn,
        lost: row.lost,
        gf: row.gf,
        ga: row.ga,
        gd: row.gd,
        pts: row.pts
      };
    });

    third.sort(function (a, b) {
      if (b.pts !== a.pts) return b.pts - a.pts;
      if (b.gd !== a.gd) return b.gd - a.gd;
      if (b.gf !== a.gf) return b.gf - a.gf;
      return a.group.localeCompare(b.group);
    });

    return third;
  }

  function countPlayed() {
    return Object.keys(readScores()).length;
  }

  function sortMatches(list) {
    return list.slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      if (a.time !== b.time) return a.time < b.time ? -1 : 1;
      return a.id - b.id;
    });
  }

  function getTeamGroup(team) {
    var groups = window.WC2026.GROUPS;
    var keys = Object.keys(groups);
    for (var i = 0; i < keys.length; i++) {
      if (groups[keys[i]].indexOf(team) !== -1) return keys[i];
    }
    return null;
  }

  function getTeamMatches(team) {
    return sortMatches(
      window.WC2026.MATCHES.filter(function (m) {
        return m.home === team || m.away === team;
      })
    );
  }

  function getTeamStanding(team) {
    var group = getTeamGroup(team);
    if (!group) return null;

    var standings = computeStandings();
    var rows = standings[group];
    var position = -1;
    var row = null;

    for (var i = 0; i < rows.length; i++) {
      if (rows[i].team === team) {
        position = i;
        row = rows[i];
        break;
      }
    }

    if (!row) return null;

    var status = "out";
    var statusLabel = "Eliminated";
    var statusDetail = "4th in Group " + group;

    if (row.played === 0) {
      return {
        group: group,
        position: position,
        row: row,
        status: "pending",
        statusLabel: "Group stage not started",
        statusDetail: (position === 0 ? "1st" : position === 1 ? "2nd" : position === 2 ? "3rd" : "4th") +
          " on draw order · Group " + group
      };
    }

    if (position < 2) {
      status = "qualify";
      statusLabel = "Qualified";
      statusDetail = (position === 0 ? "1st" : "2nd") + " in Group " + group + " · advances to Round of 32";
    } else if (position === 2) {
      var thirdRank = computeThirdPlaceRanking(standings);
      var rankAmongThird = -1;
      for (var j = 0; j < thirdRank.length; j++) {
        if (thirdRank[j].team === team) {
          rankAmongThird = j;
          break;
        }
      }
      if (rankAmongThird >= 0 && rankAmongThird < 8) {
        status = "qualify";
        statusLabel = "Qualified via wildcard";
        statusDetail = "3rd in Group " + group + " · #" + (rankAmongThird + 1) + " among best 3rd-place teams";
      } else {
        status = "wildcard";
        statusLabel = "Wildcard race";
        statusDetail = "3rd in Group " + group + (rankAmongThird >= 0 ? " · #" + (rankAmongThird + 1) + " of 12 (need top 8)" : "");
      }
    }

    return {
      group: group,
      position: position,
      row: row,
      status: status,
      statusLabel: statusLabel,
      statusDetail: statusDetail
    };
  }

  var KNOCKOUT_KEY = "world-cup-2026-knockout-v1";

  function readKnockoutResults() {
    try {
      var raw = localStorage.getItem(KNOCKOUT_KEY);
      if (!raw) return {};
      var data = JSON.parse(raw);
      var cleaned = {};
      Object.keys(data).forEach(function (key) {
        var val = data[key];
        if (!val || typeof val !== "object") return;
        if (!Number.isFinite(val.home) || !Number.isFinite(val.away)) return;
        var entry = { home: val.home, away: val.away };
        if (val.note && String(val.note).trim()) {
          entry.note = String(val.note).trim();
        }
        if (Number.isFinite(val.aetHome) && Number.isFinite(val.aetAway)) {
          entry.aetHome = val.aetHome;
          entry.aetAway = val.aetAway;
        }
        if (Number.isFinite(val.penHome) && Number.isFinite(val.penAway)) {
          entry.penHome = val.penHome;
          entry.penAway = val.penAway;
        }
        cleaned[key] = entry;
      });
      return cleaned;
    } catch (e) {
      return {};
    }
  }

  function writeKnockoutResults(results) {
    localStorage.setItem(KNOCKOUT_KEY, JSON.stringify(results));
    listeners.forEach(function (fn) { fn(readScores()); });
  }

  function getKnockoutResult(matchId) {
    return readKnockoutResults()[String(matchId)] || null;
  }

  function hasAet(result) {
    return !!(result && Number.isFinite(result.aetHome) && Number.isFinite(result.aetAway));
  }

  function hasPens(result) {
    return !!(result && Number.isFinite(result.penHome) && Number.isFinite(result.penAway));
  }

  function isDrawAt90(result) {
    return isPlayed(result) && result.home === result.away;
  }

  function isKnockoutResolved(result) {
    if (!isPlayed(result)) return false;
    if (result.home !== result.away) return true;
    if (hasAet(result) && result.aetHome !== result.aetAway) return true;
    if (hasPens(result) && result.penHome !== result.penAway) return true;
    return false;
  }

  function formatKnockoutScore(result) {
    if (!isPlayed(result)) return "";
    var text = result.home + "\u2013" + result.away;
    if (hasAet(result)) {
      text += " aet " + result.aetHome + "\u2013" + result.aetAway;
    }
    if (hasPens(result)) {
      text += " (" + result.penHome + "\u2013" + result.penAway + "p)";
    }
    return text;
  }

  function setKnockoutResult(matchId, home, away, opts) {
    var results = readKnockoutResults();
    var key = String(matchId);
    opts = opts || {};

    if (home === "" && away === "") {
      delete results[key];
    } else {
      var entry = { home: Number(home), away: Number(away) };
      if (opts.note && String(opts.note).trim()) {
        entry.note = String(opts.note).trim();
      }
      if (opts.aetHome !== "" && opts.aetAway !== "" &&
          opts.aetHome !== null && opts.aetAway !== null &&
          opts.aetHome !== undefined && opts.aetAway !== undefined) {
        entry.aetHome = Number(opts.aetHome);
        entry.aetAway = Number(opts.aetAway);
      }
      if (opts.penHome !== "" && opts.penAway !== "" &&
          opts.penHome !== null && opts.penAway !== null &&
          opts.penHome !== undefined && opts.penAway !== undefined) {
        entry.penHome = Number(opts.penHome);
        entry.penAway = Number(opts.penAway);
      }
      results[key] = entry;
    }
    writeKnockoutResults(results);
    return results;
  }

  function removeKnockoutResult(matchId) {
    var results = readKnockoutResults();
    delete results[String(matchId)];
    writeKnockoutResults(results);
    return results;
  }

  function getKnockoutWinner(matchId, homeTeam, awayTeam) {
    var result = getKnockoutResult(matchId);
    if (!isKnockoutResolved(result) || !homeTeam || !awayTeam) return null;
    if (result.home !== result.away) {
      return result.home > result.away ? homeTeam : awayTeam;
    }
    if (hasAet(result) && result.aetHome !== result.aetAway) {
      return result.aetHome > result.aetAway ? homeTeam : awayTeam;
    }
    if (hasPens(result)) {
      return result.penHome > result.penAway ? homeTeam : awayTeam;
    }
    return null;
  }

  function getKnockoutLoser(matchId, homeTeam, awayTeam) {
    var winner = getKnockoutWinner(matchId, homeTeam, awayTeam);
    if (!winner) return null;
    return winner === homeTeam ? awayTeam : homeTeam;
  }

  function clearKnockoutWinners() {
    localStorage.removeItem(KNOCKOUT_KEY);
    listeners.forEach(function (fn) { fn(readScores()); });
  }

  // Legacy alias used by bracket resolution
  function readKnockoutWinners() {
    return readKnockoutResults();
  }

  window.WC2026Core = {
    STORAGE_KEY: STORAGE_KEY,
    readScores: readScores,
    writeScores: writeScores,
    getScore: getScore,
    setScore: setScore,
    removeScore: removeScore,
    clearAllScores: clearAllScores,
    onScoresChange: onScoresChange,
    flag: flag,
    formatDate: formatDate,
    formatTime: formatTime,
    isPlayed: isPlayed,
    isKnockoutResolved: isKnockoutResolved,
    isDrawAt90: isDrawAt90,
    hasAet: hasAet,
    hasPens: hasPens,
    formatKnockoutScore: formatKnockoutScore,
    computeStandings: computeStandings,
    computeThirdPlaceRanking: computeThirdPlaceRanking,
    countPlayed: countPlayed,
    sortMatches: sortMatches,
    getTeamGroup: getTeamGroup,
    getTeamMatches: getTeamMatches,
    getTeamStanding: getTeamStanding,
    readKnockoutResults: readKnockoutResults,
    getKnockoutResult: getKnockoutResult,
    setKnockoutResult: setKnockoutResult,
    removeKnockoutResult: removeKnockoutResult,
    getKnockoutWinner: getKnockoutWinner,
    getKnockoutLoser: getKnockoutLoser,
    readKnockoutWinners: readKnockoutWinners,
    clearKnockoutWinners: clearKnockoutWinners
  };

  window.addEventListener("storage", function (e) {
    if (e.key === STORAGE_KEY || e.key === KNOCKOUT_KEY) {
      listeners.forEach(function (fn) { fn(readScores()); });
    }
  });
})();
