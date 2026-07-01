(function () {
  "use strict";

  function resolveSide(side, standings, thirdSlots) {
    if (side.slot) {
      var g = thirdSlots[side.slot];
      return { team: standings[g][2].team, group: g, role: "3rd · Gr " + g };
    }
    var row = standings[side.g][side.r - 1];
    var role = side.r === 1 ? "1st · Gr " + side.g : "2nd · Gr " + side.g;
    return { team: row.team, group: side.g, role: role };
  }

  function buildRoundOf32(standings, thirdSlots) {
    return window.WC2026_BRACKET.r32.map(function (m) {
      return {
        id: m.id,
        date: m.date,
        time: m.time,
        venue: m.venue,
        home: resolveSide(m.home, standings, thirdSlots),
        away: resolveSide(m.away, standings, thirdSlots)
      };
    });
  }

  function previewFromMatch(m) {
    if (!m) return null;
    if (m.home.team && m.away.team) return m.home.team + " / " + m.away.team;
    var parts = [];
    if (m.home.preview) parts.push(m.home.preview);
    else if (m.home.label) parts.push(m.home.label);
    if (m.away.preview) parts.push(m.away.preview);
    else if (m.away.label) parts.push(m.away.label);
    return parts.length ? parts.join(" vs ") : null;
  }

  function winnerFromMatch(matchId, matchMap, core) {
    var m = matchMap[matchId];
    if (!m) {
      return { team: null, label: "Winner M" + matchId, preview: null };
    }
    if (!m.home.team || !m.away.team) {
      return {
        team: null,
        label: "Winner M" + matchId,
        preview: previewFromMatch(m)
      };
    }
    var winner = core.getKnockoutWinner(matchId, m.home.team, m.away.team);
    if (winner) {
      return { team: winner, label: winner, role: null, preview: null };
    }
    return {
      team: null,
      label: "Winner M" + matchId,
      preview: m.home.team + " / " + m.away.team
    };
  }

  function loserFromMatch(matchId, matchMap, core) {
    var m = matchMap[matchId];
    if (!m) {
      return { team: null, label: "Loser M" + matchId, preview: null };
    }
    if (!m.home.team || !m.away.team) {
      return {
        team: null,
        label: "Loser M" + matchId,
        preview: previewFromMatch(m)
      };
    }
    var loser = core.getKnockoutLoser(matchId, m.home.team, m.away.team);
    if (loser) {
      return { team: loser, label: loser, role: null, preview: null };
    }
    return {
      team: null,
      label: "Loser M" + matchId,
      preview: m.home.team + " / " + m.away.team
    };
  }

  function buildKnockoutRound(roundDefs, matchMap, core) {
    return roundDefs.map(function (def) {
      var match = {
        id: def.id,
        date: def.date,
        time: def.time,
        venue: def.venue,
        home: winnerFromMatch(def.home, matchMap, core),
        away: winnerFromMatch(def.away, matchMap, core)
      };
      matchMap[def.id] = match;
      return match;
    });
  }

  function computeBracket(standings, thirdRanking, scenarios) {
    var core = window.WC2026Core;
    var thirdQual = thirdRanking.slice(0, 8).map(function (t) { return t.group; });
    var key = thirdQual.slice().sort().join("");
    var slotMap = scenarios[key];

    if (!slotMap) {
      return { ready: false, key: key, error: "Unknown third-place combination" };
    }

    var thirdSlots = {};
    Object.keys(slotMap).forEach(function (slot) {
      thirdSlots[slot] = slotMap[slot];
    });

    var r32 = buildRoundOf32(standings, thirdSlots);
    var matchMap = {};
    r32.forEach(function (m) { matchMap[m.id] = m; });

    var r16 = buildKnockoutRound(window.WC2026_BRACKET.r16, matchMap, core);
    var qf = buildKnockoutRound(window.WC2026_BRACKET.qf, matchMap, core);
    var sf = buildKnockoutRound(window.WC2026_BRACKET.sf, matchMap, core);

    var bronze = {
      id: 103,
      date: window.WC2026_BRACKET.bronze.date,
      time: window.WC2026_BRACKET.bronze.time,
      venue: window.WC2026_BRACKET.bronze.venue,
      home: loserFromMatch(101, matchMap, core),
      away: loserFromMatch(102, matchMap, core),
      isBronze: true
    };
    matchMap[103] = bronze;

    var finalM = {
      id: 104,
      date: window.WC2026_BRACKET.final.date,
      time: window.WC2026_BRACKET.final.time,
      venue: window.WC2026_BRACKET.final.venue,
      home: winnerFromMatch(101, matchMap, core),
      away: winnerFromMatch(102, matchMap, core),
      isFinal: true
    };
    matchMap[104] = finalM;

    return {
      ready: true,
      scenarioKey: key,
      thirdQualGroups: thirdQual,
      eliminatedThird: thirdRanking.slice(8).map(function (t) {
        return { group: t.group, team: t.team, pts: t.pts, gd: t.gd };
      }),
      matchMap: matchMap,
      r32: r32,
      r16: r16,
      qf: qf,
      sf: sf,
      bronze: bronze,
      final: finalM
    };
  }

  window.WC2026Bracket = { computeBracket: computeBracket };
})();
