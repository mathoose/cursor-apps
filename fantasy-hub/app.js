(function () {
  "use strict";

  var APP_ID = "fantasy-hub";
  var APP_VERSION = "7 · Sep 20, 2026";
  var STORAGE_KEY = "fantasy-hub-v1";
  var PLAYERS_DB = "fantasy-hub-players-v1";
  var SLEEPER = "https://api.sleeper.app/v1";
  var SLEEPER_PROJ = "https://api.sleeper.app/projections/nfl";
  var ESPN = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl";

  var ESPN_TEAMS = {
    1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN",
    8: "DET", 9: "GB", 10: "TEN", 11: "IND", 12: "KC", 13: "LV", 14: "LAR",
    15: "MIA", 16: "MIN", 17: "NE", 18: "NO", 19: "NYG", 20: "NYJ", 21: "PHI",
    22: "ARI", 23: "PIT", 24: "LAC", 25: "SF", 26: "SEA", 27: "TB", 28: "WAS",
    29: "CAR", 30: "JAX", 33: "BAL", 34: "HOU"
  };
  var ESPN_POS = { 1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "DEF" };
  var ESPN_BENCH = { 20: 1, 21: 1, 22: 1 };

  var state = defaultState();
  var nflState = { week: 1, season: "2026", display_week: 1 };
  var sleeperPlayers = null;
  var sleeperProjCache = { key: "", map: null };
  var sleeperGameStatusCache = { key: "", map: null };
  var toastTimer = 0;
  var pendingEspn = null;

  function defaultState() {
    return {
      version: 1,
      demo: false,
      includeBench: false,
      weekOverride: null,
      sleeper: { username: "", userId: "", displayName: "", leagues: [] },
      espn: { leagues: [] },
      snapshot: null,
      lastSync: null
    };
  }

  function uid(prefix) {
    return prefix + "-" + Math.random().toString(36).slice(2, 10);
  }

  function el(id) { return document.getElementById(id); }

  function toast(msg) {
    var node = el("toast");
    node.textContent = msg;
    node.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { node.classList.remove("show"); }, 2200);
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      var parsed = JSON.parse(raw);
      return normalizeState(parsed);
    } catch (e) {
      return defaultState();
    }
  }

  function normalizeState(raw) {
    var base = defaultState();
    if (!raw || typeof raw !== "object") return base;
    base.demo = !!raw.demo;
    base.includeBench = !!raw.includeBench;
    base.weekOverride = typeof raw.weekOverride === "number" ? raw.weekOverride : null;
    base.lastSync = typeof raw.lastSync === "string" ? raw.lastSync : null;
    base.snapshot = raw.snapshot && typeof raw.snapshot === "object" ? raw.snapshot : null;
    if (raw.sleeper && typeof raw.sleeper === "object") {
      base.sleeper.username = String(raw.sleeper.username || "");
      base.sleeper.userId = String(raw.sleeper.userId || "");
      base.sleeper.displayName = String(raw.sleeper.displayName || "");
      base.sleeper.leagues = Array.isArray(raw.sleeper.leagues) ? raw.sleeper.leagues.map(cloneLeague).filter(Boolean) : [];
    }
    if (raw.espn && typeof raw.espn === "object") {
      base.espn.leagues = Array.isArray(raw.espn.leagues) ? raw.espn.leagues.map(cloneLeague).filter(Boolean) : [];
    }
    return base;
  }

  function cloneLeague(row) {
    if (!row || typeof row !== "object") return null;
    var medianWin = null;
    if (row.medianWin === true || row.medianWin === false) medianWin = row.medianWin;
    return {
      localId: String(row.localId || uid("lg")),
      id: String(row.id || ""),
      name: String(row.name || "League"),
      season: String(row.season || currentSeason()),
      rosterId: row.rosterId == null ? null : row.rosterId,
      teamId: row.teamId == null ? null : row.teamId,
      teamName: String(row.teamName || ""),
      enabled: row.enabled !== false,
      medianWin: medianWin,
      source: row.source === "snapshot" ? "snapshot" : "live",
      espnPayload: row.espnPayload && typeof row.espnPayload === "object" ? row.espnPayload : null,
      error: String(row.error || "")
    };
  }

  function looksLikeMedianLeague(name) {
    return /\bbeta\b/i.test(String(name || "")) || /\bmedian\b/i.test(String(name || ""));
  }

  function leagueUsesMedian(league) {
    if (!league) return false;
    if (league.medianWin === true) return true;
    if (league.medianWin === false) return false;
    return looksLikeMedianLeague(league.name);
  }

  function persist() {
    try {
      ((state.espn && state.espn.leagues) || []).forEach(function (l) {
        if (!l) return;
        delete l.espnS2;
        delete l.swid;
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      toast("Could not save on this phone");
    }
  }

  function currentSeason() {
    return String((nflState && nflState.season) || new Date().getFullYear());
  }

  function currentWeek() {
    if (typeof state.weekOverride === "number") return clampWeek(state.weekOverride);
    var w = nflState.display_week || nflState.week || 1;
    return clampWeek(w);
  }

  function clampWeek(w) {
    w = parseInt(w, 10);
    if (!w || w < 1) return 1;
    if (w > 18) return 18;
    return w;
  }

  function hasAccounts() {
    return enabledSleeper().length + enabledEspn().length > 0 || state.demo;
  }

  function enabledSleeper() {
    return (state.sleeper.leagues || []).filter(function (l) { return l && l.enabled && l.id; });
  }

  function enabledEspn() {
    return (state.espn.leagues || []).filter(function (l) { return l && l.enabled && l.id; });
  }

  function showView(name) {
    document.querySelectorAll(".view").forEach(function (node) {
      node.classList.toggle("active", node.getAttribute("data-view") === name);
    });
    document.querySelectorAll(".nav-btn").forEach(function (btn) {
      var on = btn.getAttribute("data-view") === name;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    document.body.setAttribute("data-view", name);
  }

  function fmtPts(n) {
    if (n == null || isNaN(n)) return "—";
    var v = Math.round(Number(n) * 10) / 10;
    return (v % 1 === 0) ? String(v) : v.toFixed(1);
  }

  function fmtPct(p) {
    if (p == null || isNaN(p)) return "—";
    return Math.round(Number(p) * 100) + "%";
  }

  function erfApprox(x) {
    var sign = x < 0 ? -1 : 1;
    x = Math.abs(x);
    var t = 1 / (1 + 0.3275911 * x);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return sign * y;
  }

  function winProbability(projA, projB) {
    if (projA == null || projB == null || isNaN(projA) || isNaN(projB)) return null;
    var diff = Number(projA) - Number(projB);
    if (Math.abs(diff) < 0.05) return 0.5;
    var sigma = 22;
    var z = diff / (sigma * Math.SQRT2);
    var p = 0.5 * (1 + erfApprox(z / Math.SQRT2));
    return Math.max(0.01, Math.min(0.99, p));
  }

  function decorateMatchup(m) {
    if (!m || !m.mine || !m.opp) return m;
    if (m.mine.projected == null) m.mine.projected = sumStarterProjected(m.mine);
    if (m.opp.projected == null) m.opp.projected = sumStarterProjected(m.opp);
    var mineWin = m.mine.winPct != null ? Number(m.mine.winPct) : winProbability(m.mine.projected, m.opp.projected);
    m.mine.winPct = mineWin;
    m.opp.winPct = mineWin == null ? null : 1 - mineWin;
    return m;
  }

  function sumStarterProjected(side) {
    if (!side) return null;
    var sum = 0;
    var any = false;
    (side.starters || []).forEach(function (p) {
      var v = livePlayerProjected(p);
      if (v != null && !isNaN(v)) {
        sum += Number(v);
        any = true;
      }
    });
    return any ? sum : null;
  }

  function livePlayerProjected(player) {
    if (!player) return null;
    var pre = player.projected;
    var pts = player.points != null && !isNaN(Number(player.points)) ? Number(player.points) : null;
    if (player.gameStatus === "complete") {
      return pts != null ? pts : pre;
    }
    if (player.gameStatus === "in_progress") {
      if (pre == null) return pts;
      if (pts == null) return Number(pre);
      return Math.max(pts, Number(pre));
    }
    return pre;
  }

  function sleeperProjPts(stats, scoringSettings) {
    if (!stats) return null;
    if (scoringSettings && typeof scoringSettings === "object") {
      var total = 0;
      var any = false;
      Object.keys(scoringSettings).forEach(function (key) {
        if (!key || key.indexOf("pts_") === 0) return;
        var weight = scoringSettings[key];
        var val = stats[key];
        if (weight == null || val == null || isNaN(Number(weight)) || isNaN(Number(val))) return;
        total += Number(weight) * Number(val);
        any = true;
      });
      if (any) return total;
    }
    if (stats.pts_ppr != null && !isNaN(Number(stats.pts_ppr))) return Number(stats.pts_ppr);
    if (stats.pts_half_ppr != null && !isNaN(Number(stats.pts_half_ppr))) return Number(stats.pts_half_ppr);
    if (stats.pts_std != null && !isNaN(Number(stats.pts_std))) return Number(stats.pts_std);
    return null;
  }

  function loadSleeperProjections(season, week) {
    var key = String(season) + "-" + String(week);
    if (sleeperProjCache.key === key && sleeperProjCache.map) return Promise.resolve(sleeperProjCache.map);
    var url = SLEEPER_PROJ + "/" + season + "/" + week +
      "?season_type=regular&position[]=QB&position[]=RB&position[]=WR&position[]=TE&position[]=K&position[]=DEF";
    return fetchJson(url).then(function (res) {
      var map = {};
      var rows = Array.isArray(res.data) ? res.data : [];
      rows.forEach(function (row) {
        if (!row || row.player_id == null) return;
        map[String(row.player_id)] = row.stats || {};
      });
      sleeperProjCache = { key: key, map: map };
      return map;
    }).catch(function () {
      return sleeperProjCache.key === key ? sleeperProjCache.map : {};
    });
  }

  function loadSleeperGameStatus(season, week) {
    var key = String(season) + "-" + String(week);
    if (sleeperGameStatusCache.key === key && sleeperGameStatusCache.map) {
      return Promise.resolve(sleeperGameStatusCache.map);
    }
    return fetchJson(SLEEPER + "/scores/nfl/regular/" + season + "/" + week).then(function (res) {
      var map = {};
      var rows = Array.isArray(res.data) ? res.data : [];
      rows.forEach(function (g) {
        if (!g) return;
        var md = g.metadata || {};
        var status = "pre";
        if (g.status === "complete" || md.is_over || md.status === "closed" || md.closed) status = "complete";
        else if (g.status === "in_game" || md.is_in_progress || md.has_started) status = "in_progress";
        [md.home_team, md.away_team].forEach(function (t) {
          if (t) map[String(t).toUpperCase()] = status;
        });
      });
      sleeperGameStatusCache = { key: key, map: map };
      return map;
    }).catch(function () {
      return sleeperGameStatusCache.key === key ? sleeperGameStatusCache.map : {};
    });
  }

  function playerNflTeam(player) {
    if (!player) return "";
    var team = String(player.team || "").toUpperCase();
    if (team) return team;
    if (player.pos === "DEF" && player.id && String(player.id).length <= 3) {
      return String(player.id).toUpperCase();
    }
    return "";
  }

  function playerGameStatus(player, gameStatusMap) {
    var team = playerNflTeam(player);
    if (!team || !gameStatusMap) return "pre";
    return gameStatusMap[team] || "pre";
  }

  function normName(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/\./g, "")
      .replace(/'/g, "")
      .replace(/\b(jr|sr|iii|ii|iv)\b/g, "")
      .replace(/[^a-z0-9]/g, "");
  }

  function canonPos(pos) {
    pos = String(pos || "").toUpperCase();
    if (pos === "D/ST" || pos === "DST" || pos === "DEF" || pos === "D") return "DEF";
    return pos || "FLEX";
  }

  function playerKey(p) {
    var pos = canonPos(p.pos);
    var team = String(p.team || "").toUpperCase();
    if (pos === "DEF" && team) return "def|" + team;
    return normName(p.name) + "|" + pos;
  }

  function idbOpen() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error("no idb")); return; }
      var req = indexedDB.open(PLAYERS_DB, 1);
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains("kv")) req.result.createObjectStore("kv");
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function idbGet(key) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction("kv", "readonly");
        var get = tx.objectStore("kv").get(key);
        get.onsuccess = function () { resolve(get.result || null); db.close(); };
        get.onerror = function () { resolve(null); db.close(); };
      });
    }).catch(function () { return null; });
  }

  function idbSet(key, value) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction("kv", "readwrite");
        tx.objectStore("kv").put(value, key);
        tx.oncomplete = function () { db.close(); resolve(true); };
        tx.onerror = function () { db.close(); resolve(false); };
      });
    }).catch(function () { return false; });
  }

  function fetchJson(url, opts) {
    return fetch(url, opts || {}).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
        return { ok: res.ok, status: res.status, data: data, text: text };
      });
    });
  }

  function loadNflState() {
    return fetchJson(SLEEPER + "/state/nfl").then(function (res) {
      if (res.ok && res.data) nflState = res.data;
      return nflState;
    }).catch(function () { return nflState; });
  }

  function slimPlayers(all) {
    var out = {};
    Object.keys(all || {}).forEach(function (id) {
      var p = all[id];
      if (!p) return;
      out[id] = {
        name: p.full_name || [p.first_name, p.last_name].filter(Boolean).join(" ") || id,
        pos: p.position || "",
        team: p.team || ""
      };
    });
    return out;
  }

  function loadSleeperPlayers(force) {
    if (sleeperPlayers && !force) return Promise.resolve(sleeperPlayers);
    return idbGet("nfl").then(function (cached) {
      if (!force && cached && cached.at && Date.now() - cached.at < 24 * 60 * 60 * 1000 && cached.map) {
        sleeperPlayers = cached.map;
        return sleeperPlayers;
      }
      return fetchJson(SLEEPER + "/players/nfl").then(function (res) {
        if (!res.ok || !res.data) throw new Error("Could not load Sleeper players");
        sleeperPlayers = slimPlayers(res.data);
        idbSet("nfl", { at: Date.now(), map: sleeperPlayers });
        return sleeperPlayers;
      });
    });
  }

  function sleeperPlayer(id) {
    if (!id || id === "0") return null;
    var p = sleeperPlayers && sleeperPlayers[id];
    if (p) return { id: String(id), name: p.name, pos: canonPos(p.pos || (ESPN_TEAMS[id] ? "DEF" : "")), team: p.team || (String(id).length <= 3 ? String(id).toUpperCase() : "") };
    if (String(id).length <= 3) {
      return { id: String(id), name: String(id).toUpperCase() + " D/ST", pos: "DEF", team: String(id).toUpperCase() };
    }
    return { id: String(id), name: "Player " + id, pos: "", team: "" };
  }

  function connectSleeper(username) {
    username = String(username || "").trim().replace(/^@/, "");
    if (!username) {
      toast("Enter a Sleeper username");
      return Promise.resolve();
    }
    el("sleeperStatus").textContent = "Looking up " + username + "…";
    var path = /^\d{8,}$/.test(username) ? "/user/" + username : "/user/" + encodeURIComponent(username);
    return fetchJson(SLEEPER + path).then(function (res) {
      if (!res.ok || !res.data || !res.data.user_id) {
        throw new Error("No Sleeper user named “" + username + "”");
      }
      var user = res.data;
      state.sleeper.username = user.username || username;
      state.sleeper.userId = String(user.user_id);
      state.sleeper.displayName = user.display_name || user.username || username;
      return fetchJson(SLEEPER + "/user/" + user.user_id + "/leagues/nfl/" + currentSeason());
    }).then(function (res) {
      var leagues = Array.isArray(res.data) ? res.data : [];
      if (!leagues.length) throw new Error("No " + currentSeason() + " NFL leagues on that account");
      var prev = {};
      (state.sleeper.leagues || []).forEach(function (l) { prev[l.id] = l; });
      state.sleeper.leagues = leagues.map(function (lg) {
        var old = prev[String(lg.league_id)] || {};
        var name = lg.name || "Sleeper league";
        var medianWin = old.medianWin === true || old.medianWin === false ? old.medianWin : null;
        return {
          localId: old.localId || uid("sl"),
          id: String(lg.league_id),
          name: name,
          season: String(lg.season || currentSeason()),
          rosterId: old.rosterId == null ? null : old.rosterId,
          teamId: null,
          teamName: old.teamName || "",
          enabled: old.enabled !== false,
          medianWin: medianWin,
          error: ""
        };
      });
      state.demo = false;
      persist();
      el("sleeperStatus").textContent = state.sleeper.leagues.length + " league" + (state.sleeper.leagues.length === 1 ? "" : "s") + " found";
      toast("Sleeper connected");
      renderAccounts();
      return refreshAll();
    }).catch(function (err) {
      el("sleeperStatus").textContent = err.message || "Sleeper lookup failed";
      toast(err.message || "Sleeper lookup failed");
    });
  }

  function loadSleeperMatchup(league, week, projMap, gameStatusMap) {
    return Promise.all([
      fetchJson(SLEEPER + "/league/" + league.id),
      fetchJson(SLEEPER + "/league/" + league.id + "/users"),
      fetchJson(SLEEPER + "/league/" + league.id + "/rosters"),
      fetchJson(SLEEPER + "/league/" + league.id + "/matchups/" + week)
    ]).then(function (parts) {
      var info = parts[0].data || {};
      var users = Array.isArray(parts[1].data) ? parts[1].data : [];
      var rosters = Array.isArray(parts[2].data) ? parts[2].data : [];
      var matchups = Array.isArray(parts[3].data) ? parts[3].data : [];
      if (!parts[0].ok) throw new Error("Could not load " + league.name);
      var scoringSettings = info.scoring_settings || {};

      var userById = {};
      users.forEach(function (u) { userById[String(u.user_id)] = u; });

      var rosterById = {};
      rosters.forEach(function (r) { rosterById[Number(r.roster_id)] = r; });

      var myRoster = null;
      rosters.forEach(function (r) {
        var owner = String(r.owner_id || "");
        var cos = (r.co_owners || []).map(String);
        if (league.rosterId != null && Number(r.roster_id) === Number(league.rosterId)) myRoster = r;
        else if (myRoster == null && (owner === state.sleeper.userId || cos.indexOf(state.sleeper.userId) >= 0)) myRoster = r;
      });
      if (!myRoster) throw new Error("Could not find your roster in " + (info.name || league.name));

      league.name = info.name || league.name;
      league.rosterId = myRoster.roster_id;
      var meUser = userById[String(myRoster.owner_id)] || {};
      league.teamName = (meUser.metadata && meUser.metadata.team_name) || meUser.display_name || league.teamName || "You";

      var mineRow = matchups.filter(function (m) { return Number(m.roster_id) === Number(myRoster.roster_id); })[0];
      if (!mineRow) throw new Error("No week " + week + " matchup in " + league.name);
      var oppRow = matchups.filter(function (m) {
        return m.matchup_id === mineRow.matchup_id && Number(m.roster_id) !== Number(myRoster.roster_id);
      })[0] || null;
      var oppRoster = oppRow ? rosterById[Number(oppRow.roster_id)] : null;
      var oppUser = oppRoster ? userById[String(oppRoster.owner_id)] || {} : {};
      var useMedian = leagueUsesMedian(league);

      var out = {
        platform: "sleeper",
        leagueId: league.id,
        leagueName: league.name,
        week: week,
        medianWin: useMedian,
        mine: packSleeperSide(mineRow, myRoster, league.teamName || "You", projMap, scoringSettings, gameStatusMap),
        opp: packSleeperSide(oppRow, oppRoster, (oppUser.metadata && oppUser.metadata.team_name) || oppUser.display_name || "Opponent", projMap, scoringSettings, gameStatusMap)
      };

      if (useMedian) {
        out.median = buildMedianBoard(matchups, rosterById, userById, myRoster.roster_id, projMap, scoringSettings, gameStatusMap);
      }
      return out;
    });
  }

  function teamLabel(roster, userById, fallback) {
    if (!roster) return fallback || "Team";
    var user = userById[String(roster.owner_id)] || {};
    return (user.metadata && user.metadata.team_name) || user.display_name || fallback || "Team";
  }

  function buildMedianBoard(matchupRows, rosterById, userById, myRosterId, projMap, scoringSettings, gameStatusMap) {
    var teams = (matchupRows || []).map(function (row) {
      var roster = rosterById[Number(row.roster_id)] || null;
      var side = packSleeperSide(row, roster, teamLabel(roster, userById, "Team " + row.roster_id), projMap, scoringSettings, gameStatusMap);
      return {
        rosterId: Number(row.roster_id),
        isMine: Number(row.roster_id) === Number(myRosterId),
        teamName: side.teamName,
        points: Number(side.points || 0),
        projected: side.projected,
        starters: side.starters || []
      };
    });

    function sortBy(metric) {
      return teams.slice().sort(function (a, b) {
        var av = a[metric];
        var bv = b[metric];
        if (av == null && bv == null) return a.teamName.localeCompare(b.teamName);
        if (av == null) return 1;
        if (bv == null) return -1;
        if (bv !== av) return bv - av;
        if (b.points !== a.points) return b.points - a.points;
        return a.teamName.localeCompare(b.teamName);
      }).map(function (t, i) {
        return Object.assign({}, t, { rank: i + 1 });
      });
    }

    var byProjected = sortBy("projected");
    var byPoints = sortBy("points");
    var teamCount = byProjected.length;
    var topSlots = Math.max(1, Math.floor(teamCount / 2));
    var lastIn = byProjected[topSlots - 1] || null;
    var firstOut = byProjected[topSlots] || null;
    var medianProjected = lastIn && lastIn.projected != null ? lastIn.projected : null;
    if (lastIn && firstOut && lastIn.projected != null && firstOut.projected != null) {
      medianProjected = Math.round(((Number(lastIn.projected) + Number(firstOut.projected)) / 2) * 10) / 10;
    }
    var medianLive = null;
    var lastInLive = byPoints[topSlots - 1] || null;
    var firstOutLive = byPoints[topSlots] || null;
    if (lastInLive && firstOutLive) {
      medianLive = Math.round(((Number(lastInLive.points) + Number(firstOutLive.points)) / 2) * 10) / 10;
    } else if (lastInLive) {
      medianLive = Number(lastInLive.points);
    }

    var mineProj = byProjected.filter(function (t) { return t.isMine; })[0] || null;
    var mineLive = byPoints.filter(function (t) { return t.isMine; })[0] || null;
    var ranked = byProjected.map(function (t) {
      return Object.assign({}, t, {
        inTopHalf: t.rank <= topSlots,
        onBubble: Math.abs(t.rank - topSlots) <= 2 || Math.abs(t.rank - (topSlots + 1)) <= 2
      });
    });

    var bubbleStart = Math.max(1, topSlots - 2);
    var bubbleEnd = Math.min(teamCount, topSlots + 3);
    var foeTeams = ranked.filter(function (t) {
      if (t.isMine) return false;
      return t.rank >= bubbleStart && t.rank <= bubbleEnd;
    });
    if (!foeTeams.length) {
      foeTeams = ranked.filter(function (t) { return !t.isMine && t.rank <= topSlots + 1; });
    }

    var rootAgainst = [];
    foeTeams.forEach(function (team) {
      (team.starters || []).forEach(function (p) {
        if (!p) return;
        rootAgainst.push({
          player: p,
          teamName: team.teamName,
          teamRank: team.rank,
          inTopHalf: team.inTopHalf,
          onBubble: team.onBubble,
          projected: p.projected,
          points: p.points
        });
      });
    });
    rootAgainst.sort(function (a, b) {
      var ap = a.projected;
      var bp = b.projected;
      if (ap == null && bp == null) return (b.points || 0) - (a.points || 0);
      if (ap == null) return 1;
      if (bp == null) return -1;
      if (bp !== ap) return bp - ap;
      return String(a.player.name || "").localeCompare(String(b.player.name || ""));
    });

    return {
      teamCount: teamCount,
      topSlots: topSlots,
      medianProjected: medianProjected,
      medianLive: medianLive,
      cutProjected: firstOut && firstOut.projected != null ? firstOut.projected : null,
      myProjectedRank: mineProj ? mineProj.rank : null,
      myLiveRank: mineLive ? mineLive.rank : null,
      myProjected: mineProj ? mineProj.projected : null,
      myPoints: mineLive ? mineLive.points : null,
      myInTopHalfProjected: mineProj ? mineProj.rank <= topSlots : null,
      myInTopHalfLive: mineLive ? mineLive.rank <= topSlots : null,
      teams: ranked,
      rootAgainst: rootAgainst
    };
  }

  function packSleeperSide(row, roster, teamName, projMap, scoringSettings, gameStatusMap) {
    if (!row) {
      return { teamName: teamName || "Bye", points: 0, projected: null, winPct: null, starters: [], bench: [], roster: [] };
    }
    var pointsMap = row.players_points || {};
    function decorate(id, starter) {
      var p = sleeperPlayer(id);
      if (!p) return null;
      p.points = Number(pointsMap[id] || 0);
      var pregame = sleeperProjPts(projMap && projMap[String(id)], scoringSettings);
      p.gameStatus = playerGameStatus(p, gameStatusMap);
      // Match Sleeper's player line: pregame proj for finished/upcoming; live floor for in-progress.
      if (p.gameStatus === "in_progress" && pregame != null) {
        p.projected = Math.max(p.points, Number(pregame));
      } else {
        p.projected = pregame;
      }
      p.starter = starter;
      return p;
    }
    var starters = (row.starters || []).map(function (id) { return decorate(id, true); }).filter(Boolean);
    var starterSet = {};
    (row.starters || []).forEach(function (id) { starterSet[String(id)] = true; });
    var bench = sleeperBenchIds(row, roster).map(function (id) {
      if (starterSet[String(id)]) return null;
      return decorate(id, false);
    }).filter(Boolean);
    return {
      teamName: teamName,
      points: Number(row.points || 0),
      projected: sumStarterProjected({ starters: starters }),
      winPct: null,
      starters: starters,
      bench: bench,
      roster: starters.concat(bench)
    };
  }

  function sleeperBenchIds(row, roster) {
    var ids = [];
    var seen = {};
    function add(id) {
      if (id == null || id === "" || id === "0") return;
      id = String(id);
      if (seen[id]) return;
      seen[id] = true;
      ids.push(id);
    }
    (row && row.players || []).forEach(add);
    (roster && roster.players || []).forEach(add);
    (roster && roster.reserve || []).forEach(add);
    (roster && roster.taxi || []).forEach(add);
    return ids;
  }

  function parseEspnInput(raw, seasonDefault) {
    raw = String(raw || "").trim();
    var out = { id: "", season: seasonDefault, teamId: null, teamName: "" };
    if (!raw) return out;
    var url;
    try { url = new URL(raw); } catch (e) { url = null; }
    if (url) {
      out.id = url.searchParams.get("leagueId") || "";
      out.season = url.searchParams.get("seasonId") || seasonDefault;
      var teamId = url.searchParams.get("teamId");
      if (teamId) out.teamId = Number(teamId);
    } else if (/^\d+$/.test(raw)) {
      out.id = raw;
    } else {
      var m = raw.match(/leagueId=(\d+)/i);
      if (m) out.id = m[1];
      var s = raw.match(/seasonId=(\d+)/i);
      if (s) out.season = s[1];
      var t = raw.match(/teamId=(\d+)/i);
      if (t) out.teamId = Number(t[1]);
    }
    return out;
  }

  function espnLeagueUrl(league, week) {
    return ESPN + "/seasons/" + league.season + "/segments/0/leagues/" + league.id +
      "?view=mTeam&view=mRoster&view=mMatchup&view=mMatchupScore&view=mSettings&scoringPeriodId=" + week;
  }

  function isEspnUnauthorized(res) {
    if (!res) return false;
    if (res.status === 401) return true;
    var msg = res.data && ((res.data.messages || [])[0] || "");
    return String(msg).toLowerCase().indexOf("not authorized") >= 0;
  }

  function compactEspnPayload(data, week) {
    return {
      id: data && data.id,
      seasonId: data && data.seasonId,
      settings: { name: data && data.settings && data.settings.name },
      teams: (data && data.teams) || [],
      schedule: ((data && data.schedule) || []).filter(function (g) {
        return Number(g.matchupPeriodId) === Number(week);
      })
    };
  }

  function espnHelperScript() {
    return [
      "(async function(){",
      "  const u = new URL(location.href);",
      "  const id = u.searchParams.get('leagueId');",
      "  const season = u.searchParams.get('seasonId') || '" + currentSeason() + "';",
      "  if (!id) { alert('Open your ESPN fantasy league page first'); return; }",
      "  const week = prompt('NFL week', '" + currentWeek() + "') || '" + currentWeek() + "';",
      "  const api = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/' + season + '/segments/0/leagues/' + id + '?view=mTeam&view=mRoster&view=mMatchup&view=mMatchupScore&view=mSettings&scoringPeriodId=' + week;",
      "  const res = await fetch(api, { credentials: 'include' });",
      "  const data = await res.json();",
      "  if (!res.ok) { alert((data && data.messages && data.messages[0]) || 'ESPN would not load the league'); return; }",
      "  const out = JSON.stringify({ source: 'espn-hub', leagueId: id, season: season, week: Number(week), data: data });",
      "  try { await navigator.clipboard.writeText(out); alert('Copied. Open Fantasy Hub and tap Add from snapshot.'); }",
      "  catch (e) { prompt('Copy this snapshot', out); }",
      "})();"
    ].join("\n");
  }

  function copyEspnHelper() {
    var text = espnHelperScript();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        toast("Helper copied — paste it in the ESPN Console");
      }).catch(function () {
        prompt("Copy this helper script", text);
      });
    } else {
      prompt("Copy this helper script", text);
    }
  }

  function addEspnLeague() {
    var parsed = parseEspnInput(el("espnUrl").value, el("espnSeason").value || currentSeason());
    if (!parsed.id) {
      toast("Paste an ESPN league URL or ID");
      return Promise.resolve();
    }
    var teamField = String(el("espnTeam").value || "").trim();
    var league = {
      localId: uid("es"),
      id: parsed.id,
      name: "ESPN " + parsed.id,
      season: String(parsed.season || currentSeason()),
      rosterId: null,
      teamId: parsed.teamId,
      teamName: teamField,
      enabled: true,
      source: "live",
      espnPayload: null,
      error: ""
    };
    if (!league.teamId && /^\d+$/.test(teamField)) league.teamId = Number(teamField);
    el("espnStatus").textContent = "Loading league " + league.id + "…";
    return fetchJson(espnLeagueUrl(league, currentWeek()), { headers: { Accept: "application/json" } }).then(function (res) {
      if (isEspnUnauthorized(res)) {
        throw new Error("Private league — paste a snapshot from the helper below. This site cannot sign in to ESPN.");
      }
      if (!res.ok || !res.data || !res.data.teams) {
        throw new Error((res.data && res.data.messages && res.data.messages[0]) || "Could not load that ESPN league");
      }
      acceptEspnPayload(league, res.data, "live");
    }).catch(function (err) {
      el("espnStatus").textContent = err.message || "ESPN lookup failed";
      toast(err.message || "ESPN lookup failed");
    });
  }

  function addEspnSnapshot() {
    var raw = String(el("espnSnapshot").value || "").trim();
    if (!raw) {
      toast("Paste the snapshot from the helper first");
      return;
    }
    var parsed;
    try { parsed = JSON.parse(raw); } catch (e) {
      toast("That snapshot is not valid JSON");
      return;
    }
    var data = parsed.data || parsed;
    if (!data || !Array.isArray(data.teams)) {
      toast("That file does not look like an ESPN league");
      return;
    }
    var fromUrl = parseEspnInput(el("espnUrl").value, el("espnSeason").value || currentSeason());
    var teamField = String(el("espnTeam").value || "").trim();
    var league = {
      localId: uid("es"),
      id: String(parsed.leagueId || data.id || fromUrl.id || ""),
      name: (data.settings && data.settings.name) || ("ESPN " + (parsed.leagueId || data.id || "")),
      season: String(parsed.season || data.seasonId || fromUrl.season || currentSeason()),
      rosterId: null,
      teamId: fromUrl.teamId,
      teamName: teamField,
      enabled: true,
      source: "snapshot",
      espnPayload: null,
      error: ""
    };
    if (!league.id) {
      toast("Could not find a league ID in that snapshot");
      return;
    }
    if (!league.teamId && /^\d+$/.test(teamField)) league.teamId = Number(teamField);
    if (parsed.week) state.weekOverride = clampWeek(parsed.week);
    acceptEspnPayload(league, data, "snapshot");
  }

  function acceptEspnPayload(league, data, source) {
    var teams = data.teams || [];
    var picked = pickEspnTeam(teams, league);
    if (!picked && teams.length) {
      pendingEspn = { league: league, payload: data, source: source };
      openTeamPicker(teams, data.settings && data.settings.name);
      return;
    }
    if (!picked) throw new Error("No teams in that ESPN league");
    finishEspnLeague(league, data, picked, source);
  }

  function pickEspnTeam(teams, league) {
    if (league.teamId != null) {
      return teams.filter(function (t) { return Number(t.id) === Number(league.teamId); })[0] || null;
    }
    var want = normName(league.teamName);
    if (!want) return teams.length === 1 ? teams[0] : null;
    var hits = teams.filter(function (t) {
      var name = espnTeamName(t);
      return normName(name) === want || normName(t.abbrev) === want || String(t.id) === league.teamName;
    });
    return hits[0] || null;
  }

  function espnTeamName(team) {
    if (!team) return "Team";
    return [team.location, team.nickname].filter(Boolean).join(" ") || team.abbrev || ("Team " + team.id);
  }

  function finishEspnLeague(league, payload, team, source) {
    league.teamId = team.id;
    league.teamName = espnTeamName(team);
    league.name = (payload.settings && payload.settings.name) || league.name;
    league.error = "";
    league.source = source || "live";
    delete league.espnS2;
    delete league.swid;
    if (league.source === "snapshot") {
      league.espnPayload = compactEspnPayload(payload, currentWeek());
    } else {
      league.espnPayload = null;
    }
    state.espn.leagues = (state.espn.leagues || []).filter(function (l) {
      return !(l.id === league.id && String(l.season) === String(league.season));
    });
    state.espn.leagues.push(league);
    state.demo = false;
    persist();
    el("espnUrl").value = "";
    el("espnTeam").value = "";
    if (el("espnSnapshot")) el("espnSnapshot").value = "";
    el("espnStatus").textContent = "Added " + league.name + (league.source === "snapshot" ? " · snapshot" : "");
    toast("ESPN league added");
    renderAccounts();
    closeTeamPicker();
    return refreshAll();
  }

  function openTeamPicker(teams, leagueName) {
    el("teamPickNote").textContent = leagueName || "Pick your ESPN team";
    el("teamPickList").innerHTML = teams.map(function (t) {
      return '<button type="button" data-team="' + t.id + '">' + escapeHtml(espnTeamName(t)) + "</button>";
    }).join("");
    el("teamOverlay").hidden = false;
  }

  function closeTeamPicker() {
    pendingEspn = null;
    el("teamOverlay").hidden = true;
  }

  function matchupFromEspnData(league, data, week) {
    league.name = (data.settings && data.settings.name) || league.name;
    var teams = data.teams || [];
    var mine = pickEspnTeam(teams, league);
    if (!mine) throw new Error("Pick your team in " + league.name);
    league.teamId = mine.id;
    league.teamName = espnTeamName(mine);

    var schedule = data.schedule || [];
    var game = schedule.filter(function (g) {
      return Number(g.matchupPeriodId) === Number(week) &&
        (Number(g.home && g.home.teamId) === Number(mine.id) || Number(g.away && g.away.teamId) === Number(mine.id));
    })[0];
    if (!game) throw new Error("No week " + week + " matchup in " + league.name);

    var iAmHome = Number(game.home && game.home.teamId) === Number(mine.id);
    var mineSide = iAmHome ? game.home : game.away;
    var oppSide = iAmHome ? game.away : game.home;
    var oppTeam = teams.filter(function (t) { return oppSide && Number(t.id) === Number(oppSide.teamId); })[0];

    return {
      platform: "espn",
      leagueId: league.id,
      leagueName: league.name,
      week: week,
      mine: packEspnSide(mineSide, mine, data, week),
      opp: packEspnSide(oppSide, oppTeam, data, week)
    };
  }

  function loadEspnMatchup(league, week) {
    if (league.source === "snapshot" && league.espnPayload) {
      try {
        return Promise.resolve(matchupFromEspnData(league, league.espnPayload, week));
      } catch (err) {
        return Promise.reject(err);
      }
    }
    return fetchJson(espnLeagueUrl(league, week), { headers: { Accept: "application/json" } }).then(function (res) {
      if (isEspnUnauthorized(res)) {
        throw new Error(league.name + " is private — paste a new snapshot. This site cannot sign in to ESPN.");
      }
      if (!res.ok || !res.data || !res.data.teams) {
        throw new Error((res.data && res.data.messages && res.data.messages[0]) || "Could not load " + league.name);
      }
      return matchupFromEspnData(league, res.data, week);
    });
  }

  function packEspnSide(side, team, data, week) {
    var name = espnTeamName(team);
    if (!side && !team) {
      return { teamName: "Bye", points: 0, projected: null, winPct: null, starters: [], bench: [], roster: [] };
    }
    var entries = [];
    if (side && side.rosterForCurrentScoringPeriod && Array.isArray(side.rosterForCurrentScoringPeriod.entries)) {
      entries = side.rosterForCurrentScoringPeriod.entries;
    } else if (team && team.roster && Array.isArray(team.roster.entries)) {
      entries = team.roster.entries;
    }
    var starters = [];
    var bench = [];
    entries.forEach(function (entry) {
      var p = espnEntryToPlayer(entry, week);
      if (!p) return;
      if (p.starter) starters.push(p);
      else bench.push(p);
    });
    var points = side && (side.totalPointsLive != null ? side.totalPointsLive : side.totalPoints);
    if (points == null) points = starters.reduce(function (sum, p) { return sum + (p.points || 0); }, 0);
    var projected = null;
    if (side && side.totalProjectedPointsLive != null) projected = Number(side.totalProjectedPointsLive);
    else if (side && side.totalProjectedPoints != null) projected = Number(side.totalProjectedPoints);
    else projected = sumStarterProjected({ starters: starters });
    var winPct = null;
    if (side && side.winProbability != null) winPct = Number(side.winProbability);
    else if (side && side.projectedWinPct != null) winPct = Number(side.projectedWinPct);
    if (winPct != null && !isNaN(winPct) && winPct > 1) winPct = winPct / 100;
    if (winPct != null && (isNaN(winPct) || winPct < 0 || winPct > 1)) winPct = null;
    return {
      teamName: name,
      points: Number(points || 0),
      projected: projected,
      winPct: winPct,
      starters: starters,
      bench: bench,
      roster: starters.concat(bench)
    };
  }

  function espnStatTotal(stats, week, sourceId) {
    if (!Array.isArray(stats)) return null;
    var hits = stats.filter(function (s) {
      if (!s || s.appliedTotal == null) return false;
      if (sourceId != null && Number(s.statSourceId) !== Number(sourceId)) return false;
      return s.scoringPeriodId == null || Number(s.scoringPeriodId) === Number(week);
    });
    if (!hits.length) return null;
    return Number(hits[0].appliedTotal || 0);
  }

  function espnEntryToPlayer(entry, week) {
    var pool = entry && entry.playerPoolEntry;
    var player = pool && pool.player;
    if (!player) return null;
    var pos = ESPN_POS[player.defaultPositionId] || "FLEX";
    var team = ESPN_TEAMS[player.proTeamId] || "";
    var slot = entry.lineupSlotId;
    var starter = !ESPN_BENCH[slot];
    var points = 0;
    if (pool.appliedStatTotal != null) points = Number(pool.appliedStatTotal);
    else {
      var actual = espnStatTotal(player.stats, week, 0);
      if (actual == null) actual = espnStatTotal(player.stats, week, null);
      if (actual != null) points = actual;
    }
    return {
      id: String(player.id),
      name: pos === "DEF" ? (team ? team + " D/ST" : player.fullName) : player.fullName,
      pos: pos,
      team: team,
      points: points,
      projected: espnStatTotal(player.stats, week, 1),
      starter: starter
    };
  }

  function demoSnapshot(week) {
    function p(name, pos, team, points, opts) {
      opts = opts || {};
      return {
        id: normName(name),
        name: name,
        pos: pos,
        team: team,
        points: points,
        projected: opts.projected != null ? opts.projected : Math.round((points + 3.2) * 10) / 10,
        starter: opts.starter !== false
      };
    }
    var chase = p("Ja'Marr Chase", "WR", "CIN", 22.4, { projected: 19.8 });
    var cmc = p("Christian McCaffrey", "RB", "SF", 18.1, { projected: 20.4 });
    var kelce = p("Travis Kelce", "TE", "KC", 11.2, { projected: 12.6 });
    var mahomes = p("Patrick Mahomes", "QB", "KC", 19.6, { projected: 21.1 });
    var achane = p("De'Von Achane", "RB", "MIA", 14.8, { projected: 15.9 });
    var dk = p("DK Metcalf", "WR", "SEA", 9.3, { projected: 13.2 });
    var nico = p("Nico Collins", "WR", "HOU", 13.5, { projected: 14.7 });
    var niners = p("49ers D/ST", "DEF", "SF", 7.0, { projected: 8.1 });
    var aubrey = p("Brandon Aubrey", "K", "DAL", 8.0, { projected: 8.4 });
    var jefferson = p("Justin Jefferson", "WR", "MIN", 16.2, { projected: 17.5 });
    var bijan = p("Bijan Robinson", "RB", "ATL", 17.4, { projected: 18.6 });
    var amonra = p("Amon-Ra St. Brown", "WR", "DET", 15.8, { projected: 16.4 });
    var allen = p("Josh Allen", "QB", "BUF", 23.2, { projected: 22.8 });
    var mcbride = p("Trey McBride", "TE", "ARI", 10.1, { projected: 11.3 });
    var kyren = p("Kyren Williams", "RB", "LAR", 12.6, { projected: 14.2 });
    var ladd = p("Ladd McConkey", "WR", "LAC", 11.4, { projected: 12.8 });
    var ravens = p("Ravens D/ST", "DEF", "BAL", 6.0, { projected: 7.2 });
    var bates = p("Jake Bates", "K", "DET", 7.0, { projected: 7.8 });

    var l1Mine = [mahomes, cmc, achane, chase, nico, dk, kelce, niners, aubrey];
    var l1MineBench = [
      p("Rico Dowdle", "RB", "CAR", 3.2, { starter: false, projected: 8.4 }),
      p("Rome Odunze", "WR", "CHI", 2.8, { starter: false, projected: 9.1 }),
      p("Tyler Higbee", "TE", "LAR", 1.4, { starter: false, projected: 5.6 })
    ];
    var l1Opp = [p("Lamar Jackson", "QB", "BAL", 18.4, { projected: 22.0 }), p("Breece Hall", "RB", "NYJ", 12.0, { projected: 14.8 }), jefferson, p("A.J. Brown", "WR", "PHI", 13.1, { projected: 15.2 }), p("Mark Andrews", "TE", "BAL", 8.8, { projected: 10.4 }), p("James Cook", "RB", "BUF", 11.4, { projected: 13.6 }), p("Eagles D/ST", "DEF", "PHI", 5.0, { projected: 6.8 }), p("Harrison Butker", "K", "KC", 9.0, { projected: 8.6 }), p("Chris Olave", "WR", "NO", 10.3, { projected: 12.1 })];
    var l1OppBench = [
      p("Tank Dell", "WR", "HOU", 0.0, { starter: false, projected: 10.2 }),
      p("Zach Charbonnet", "RB", "SEA", 4.1, { starter: false, projected: 7.5 })
    ];
    var l2Mine = [allen, bijan, kyren, chase, amonra, ladd, mcbride, ravens, bates];
    var l2MineBench = [
      p("Javonte Williams", "RB", "DAL", 5.6, { starter: false, projected: 9.8 }),
      p("Xavier Worthy", "WR", "KC", 3.9, { starter: false, projected: 10.6 })
    ];
    var l2Opp = [p("Jalen Hurts", "QB", "PHI", 20.1, { projected: 21.4 }), p("Saquon Barkley", "RB", "PHI", 21.4, { projected: 19.8 }), p("CeeDee Lamb", "WR", "DAL", 14.8, { projected: 16.9 }), p("Puka Nacua", "WR", "LAR", 13.6, { projected: 15.5 }), p("George Kittle", "TE", "SF", 9.9, { projected: 11.2 }), p("Jahmyr Gibbs", "RB", "DET", 16.2, { projected: 17.1 }), p("Cowboys D/ST", "DEF", "DAL", 4.0, { projected: 6.4 }), p("Cameron Dicker", "K", "LAC", 8.0, { projected: 8.2 }), p("Marvin Harrison Jr.", "WR", "ARI", 9.1, { projected: 12.4 })];
    var l2OppBench = [p("Chuba Hubbard", "RB", "CAR", 6.2, { starter: false, projected: 10.8 })];
    var l3Mine = [p("Joe Burrow", "QB", "CIN", 17.8, { projected: 20.9 }), p("Kyren Williams", "RB", "LAR", 11.9, { projected: 14.2 }), jefferson, p("Malik Nabers", "WR", "NYG", 12.4, { projected: 14.6 }), p("Brock Bowers", "TE", "LV", 9.6, { projected: 11.0 }), p("James Conner", "RB", "ARI", 10.2, { projected: 12.3 }), p("Lions D/ST", "DEF", "DET", 8.0, { projected: 7.4 }), p("Jake Elliott", "K", "PHI", 6.0, { projected: 7.6 }), p("Zay Flowers", "WR", "BAL", 10.5, { projected: 12.0 })];
    var l3MineBench = [p("Jayden Reed", "WR", "GB", 4.4, { starter: false, projected: 9.3 })];
    var l3Opp = [mahomes, cmc, p("Garrett Wilson", "WR", "NYJ", 11.1, { projected: 13.4 }), p("Tee Higgins", "WR", "CIN", 12.8, { projected: 13.9 }), p("Sam LaPorta", "TE", "DET", 8.4, { projected: 10.1 }), p("Alvin Kamara", "RB", "NO", 9.7, { projected: 12.5 }), p("Packers D/ST", "DEF", "GB", 5.0, { projected: 6.2 }), p("Younghoe Koo", "K", "ATL", 7.0, { projected: 8.0 }), p("Jaylen Waddle", "WR", "MIA", 8.6, { projected: 11.2 })];
    var l3OppBench = [p("D'Andre Swift", "RB", "CHI", 5.1, { starter: false, projected: 9.7 })];

    function side(teamName, players, benchPlayers) {
      var starters = players.map(function (x) { return Object.assign({}, x, { starter: true }); });
      var bench = (benchPlayers || []).map(function (x) { return Object.assign({}, x, { starter: false }); });
      return {
        teamName: teamName,
        points: starters.reduce(function (s, x) { return s + x.points; }, 0),
        projected: starters.reduce(function (s, x) { return s + (x.projected || 0); }, 0),
        winPct: null,
        starters: starters,
        bench: bench,
        roster: starters.concat(bench)
      };
    }

    return {
      week: week,
      season: currentSeason(),
      demo: true,
      generatedAt: new Date().toISOString(),
      errors: [],
      matchups: [
        decorateMatchup({
          platform: "sleeper",
          leagueId: "demo-beta",
          leagueName: "Beta League",
          week: week,
          medianWin: true,
          mine: side("Mathoose", l1Mine, l1MineBench),
          opp: side("Gronk's Cousin", l1Opp, l1OppBench),
          median: demoMedianBoard(side("Mathoose", l1Mine, l1MineBench), side("Gronk's Cousin", l1Opp, l1OppBench), [
            side("Waiver Wire FC", l2Opp, l2OppBench),
            side("Keep the Receipts", l3Mine, l3MineBench),
            side("Sunday Scaries", l3Opp, l3OppBench),
            side("Hometown Heroes", l2Mine, l2MineBench),
            side("Red Zone Rats", [jefferson, bijan, amonra, allen, mcbride, kyren, ladd, ravens, bates]),
            side("Stacked Deck", [chase, cmc, kelce, mahomes, achane, dk, nico, niners, aubrey])
          ])
        }),
        decorateMatchup({ platform: "sleeper", leagueId: "demo-work", leagueName: "Work League", week: week, mine: side("Mathoose", l2Mine, l2MineBench), opp: side("Waiver Wire FC", l2Opp, l2OppBench) }),
        decorateMatchup({ platform: "espn", leagueId: "demo-keep", leagueName: "Thursday Keepers", week: week, mine: side("Keep the Receipts", l3Mine, l3MineBench), opp: side("Sunday Scaries", l3Opp, l3OppBench) })
      ]
    };
  }

  function demoMedianBoard(mine, opp, others) {
    var teams = [Object.assign({}, mine, { isMine: true, rosterId: 1 })]
      .concat([Object.assign({}, opp, { isMine: false, rosterId: 2 })])
      .concat((others || []).map(function (t, i) {
        return Object.assign({}, t, { isMine: false, rosterId: i + 3 });
      }));
    var ranked = teams.slice().sort(function (a, b) {
      return (b.projected || 0) - (a.projected || 0);
    }).map(function (t, i) {
      var topSlots = Math.floor(teams.length / 2);
      return {
        rosterId: t.rosterId,
        isMine: !!t.isMine,
        teamName: t.teamName,
        points: t.points,
        projected: t.projected,
        starters: t.starters || [],
        rank: i + 1,
        inTopHalf: i < topSlots,
        onBubble: Math.abs((i + 1) - topSlots) <= 2 || Math.abs((i + 1) - (topSlots + 1)) <= 2
      };
    });
    var topSlots = Math.floor(teams.length / 2);
    var lastIn = ranked[topSlots - 1];
    var firstOut = ranked[topSlots];
    var medianProjected = lastIn && firstOut
      ? Math.round(((lastIn.projected + firstOut.projected) / 2) * 10) / 10
      : (lastIn ? lastIn.projected : null);
    var byPoints = teams.slice().sort(function (a, b) { return (b.points || 0) - (a.points || 0); });
    var medianLive = byPoints.length >= topSlots + 1
      ? Math.round(((byPoints[topSlots - 1].points + byPoints[topSlots].points) / 2) * 10) / 10
      : (byPoints[topSlots - 1] ? byPoints[topSlots - 1].points : null);
    var mineRow = ranked.filter(function (t) { return t.isMine; })[0];
    var mineLiveRank = null;
    byPoints.forEach(function (t, i) { if (t.isMine) mineLiveRank = i + 1; });
    var bubbleStart = Math.max(1, topSlots - 2);
    var bubbleEnd = Math.min(ranked.length, topSlots + 3);
    var rootAgainst = [];
    ranked.forEach(function (team) {
      if (team.isMine) return;
      if (team.rank < bubbleStart || team.rank > bubbleEnd) return;
      (team.starters || []).forEach(function (p) {
        rootAgainst.push({
          player: p,
          teamName: team.teamName,
          teamRank: team.rank,
          inTopHalf: team.inTopHalf,
          onBubble: team.onBubble,
          projected: p.projected,
          points: p.points
        });
      });
    });
    rootAgainst.sort(function (a, b) { return (b.projected || 0) - (a.projected || 0); });
    return {
      teamCount: ranked.length,
      topSlots: topSlots,
      medianProjected: medianProjected,
      medianLive: medianLive,
      cutProjected: firstOut ? firstOut.projected : null,
      myProjectedRank: mineRow ? mineRow.rank : null,
      myLiveRank: mineLiveRank,
      myProjected: mineRow ? mineRow.projected : null,
      myPoints: mineRow ? mineRow.points : null,
      myInTopHalfProjected: mineRow ? mineRow.rank <= topSlots : null,
      myInTopHalfLive: mineLiveRank != null ? mineLiveRank <= topSlots : null,
      teams: ranked,
      rootAgainst: rootAgainst
    };
  }

  function loadDemo() {
    state.demo = true;
    state.weekOverride = state.weekOverride || currentWeek();
    state.snapshot = demoSnapshot(currentWeek());
    state.lastSync = new Date().toISOString();
    persist();
    renderAll();
    toast("Sample leagues loaded");
  }

  function clearBoard() {
    state = defaultState();
    persist();
    renderAll();
    toast("Board cleared");
  }

  function refreshAll() {
    var week = currentWeek();
    el("refreshBtn").classList.add("busy");
    return loadNflState().then(function () {
      week = currentWeek();
      if (state.demo && !enabledSleeper().length && !enabledEspn().length) {
        state.snapshot = demoSnapshot(week);
        state.lastSync = new Date().toISOString();
        persist();
        return;
      }
      var needPlayers = enabledSleeper().length > 0;
      return Promise.all([
        needPlayers ? loadSleeperPlayers(false) : Promise.resolve(null),
        needPlayers ? loadSleeperProjections(currentSeason(), week) : Promise.resolve({}),
        needPlayers ? loadSleeperGameStatus(currentSeason(), week) : Promise.resolve({})
      ]).then(function (parts) {
        var projMap = parts[1] || {};
        var gameStatusMap = parts[2] || {};
        var jobs = [];
        enabledSleeper().forEach(function (league) {
          jobs.push(loadSleeperMatchup(league, week, projMap, gameStatusMap).then(function (m) {
            league.error = "";
            return { ok: true, matchup: m };
          }).catch(function (err) {
            league.error = err.message || "Sleeper sync failed";
            return { ok: false, error: league.error, league: league.name, platform: "sleeper" };
          }));
        });
        enabledEspn().forEach(function (league) {
          jobs.push(loadEspnMatchup(league, week).then(function (m) {
            league.error = "";
            return { ok: true, matchup: m };
          }).catch(function (err) {
            league.error = err.message || "ESPN sync failed";
            return { ok: false, error: league.error, league: league.name, platform: "espn" };
          }));
        });
        return Promise.all(jobs).then(function (rows) {
          var matchups = [];
          var errors = [];
          rows.forEach(function (row) {
            if (row.ok) matchups.push(decorateMatchup(row.matchup));
            else errors.push(row);
          });
          state.snapshot = {
            week: week,
            season: currentSeason(),
            demo: false,
            generatedAt: new Date().toISOString(),
            errors: errors,
            matchups: matchups
          };
          state.lastSync = state.snapshot.generatedAt;
          persist();
        });
      });
    }).catch(function (err) {
      toast(err.message || "Refresh failed");
    }).then(function () {
      el("refreshBtn").classList.remove("busy");
      renderAll();
    });
  }

  function snapshot() {
    return state.snapshot || { matchups: [], errors: [], week: currentWeek(), demo: state.demo };
  }

  function playersForSide(side, includeBench) {
    if (!side) return [];
    return includeBench ? (side.roster || []).slice() : (side.starters || []).slice();
  }

  function buildRootBoard(matchups, includeBench) {
    var map = {};
    matchups.forEach(function (m) {
      playersForSide(m.mine, includeBench).forEach(function (p) { addRoot(map, p, m, "mine"); });
      playersForSide(m.opp, includeBench).forEach(function (p) { addRoot(map, p, m, "opp"); });
    });
    var all = Object.keys(map).map(function (k) { return map[k]; });
    all.forEach(function (row) {
      row.myPoints = row.mine.reduce(function (s, x) { return s + (x.points || 0); }, 0);
      row.oppPoints = row.opp.reduce(function (s, x) { return s + (x.points || 0); }, 0);
      row.leagues = row.mine.length;
    });
    var happy = all.filter(function (r) { return r.mine.length && !r.opp.length; });
    var conflicted = all.filter(function (r) { return r.mine.length && r.opp.length; });
    function rank(a, b) {
      if (b.leagues !== a.leagues) return b.leagues - a.leagues;
      if (b.myPoints !== a.myPoints) return b.myPoints - a.myPoints;
      return a.player.name.localeCompare(b.player.name);
    }
    happy.sort(rank);
    conflicted.sort(function (a, b) {
      var as = a.myPoints - a.oppPoints;
      var bs = b.myPoints - b.oppPoints;
      if (as !== bs) return as - bs;
      return a.player.name.localeCompare(b.player.name);
    });
    return { happy: happy, conflicted: conflicted };
  }

  function addRoot(map, player, matchup, side) {
    if (!player || !player.name) return;
    var key = playerKey(player);
    if (!map[key]) {
      map[key] = { key: key, player: player, mine: [], opp: [] };
    } else if (player.name && map[key].player.name.indexOf("Player ") === 0) {
      map[key].player = player;
    }
    map[key][side].push({
      league: matchup.leagueName,
      platform: matchup.platform,
      points: Number(player.points || 0),
      starter: !!player.starter
    });
  }

  function resultLabel(mine, opp) {
    if (mine === opp) return { cls: "tie", text: "Tie" };
    if (mine > opp) return { cls: "win", text: "Winning" };
    return { cls: "loss", text: "Losing" };
  }

  function maxPts(matchup) {
    return Math.max(matchup.mine.points || 0, matchup.opp.points || 0, 1);
  }

  function renderHeader() {
    var week = currentWeek();
    var snap = snapshot();
    var n = (snap.matchups || []).length;
    el("weekTitle").textContent = "Week " + week;
    el("weekEyebrow").textContent = (snap.season || currentSeason()) + (snap.demo ? " · sample" : "");
    if (!hasAccounts()) el("headerSub").textContent = "Scores in one spot";
    else el("headerSub").textContent = n + " league" + (n === 1 ? "" : "s") + " · week " + week;
  }

  function renderScores() {
    var snap = snapshot();
    var empty = el("scoresEmpty");
    var list = el("scoreList");
    var errors = el("scoreErrors");
    if (!hasAccounts() || (!(snap.matchups || []).length && !(snap.errors || []).length && !state.demo)) {
      empty.hidden = false;
      list.hidden = true;
      list.innerHTML = "";
      errors.hidden = true;
      errors.innerHTML = "";
      return;
    }
    empty.hidden = true;
    var errHtml = (snap.errors || []).map(function (e) {
      return '<div class="error-card">' + escapeHtml(e.error || "League failed") + "</div>";
    }).join("");
    errors.innerHTML = errHtml;
    errors.hidden = !errHtml;
    if (!(snap.matchups || []).length) {
      list.hidden = true;
      return;
    }
    list.hidden = false;
    list.innerHTML = snap.matchups.map(function (m, idx) {
      var res = resultLabel(m.mine.points, m.opp.points);
      var top = maxPts(m);
      var minePct = Math.max(6, Math.round((m.mine.points / top) * 100));
      var oppPct = Math.max(6, Math.round((m.opp.points / top) * 100));
      return (
        '<button type="button" class="score-card' + (m.medianWin ? " has-median" : "") + '" data-idx="' + idx + '">' +
          '<div class="score-top">' +
            '<h3 class="league-name">' + escapeHtml(m.leagueName) + "</h3>" +
            '<span class="platform ' + m.platform + '">' + (m.platform === "espn" ? "ESPN" : "Sleeper") + "</span>" +
          "</div>" +
          '<div class="score-grid">' +
            '<div class="score-side">' +
              '<p class="who">' + escapeHtml(m.mine.teamName || "You") + "</p>" +
              '<p class="pts">' + fmtPts(m.mine.points) + "</p>" +
              outlookLine(m.mine) +
            "</div>" +
            '<div class="score-mid">VS</div>' +
            '<div class="score-side opp">' +
              '<p class="who">' + escapeHtml(m.opp.teamName || "Opponent") + "</p>" +
              '<p class="pts">' + fmtPts(m.opp.points) + "</p>" +
              outlookLine(m.opp) +
            "</div>" +
          "</div>" +
          '<div class="bars">' +
            '<div class="bar mine"><span style="width:' + minePct + '%"></span></div>' +
            '<div class="bar opp"><span style="width:' + oppPct + '%"></span></div>' +
          "</div>" +
          '<p class="result ' + res.cls + '">' + res.text + " · tap for lineups</p>" +
          medianSummaryHtml(m) +
          '<div class="lineup">' +
            lineupCol(m.mine.teamName, m.mine.starters, m.mine.bench) +
            lineupCol(m.opp.teamName, m.opp.starters, m.opp.bench) +
            medianBoardHtml(m) +
          "</div>" +
        "</button>"
      );
    }).join("");
  }

  function medianSummaryHtml(m) {
    if (!m || !m.medianWin || !m.median) return "";
    var med = m.median;
    var bits = [];
    if (med.medianProjected != null) bits.push("Proj median " + fmtPts(med.medianProjected));
    if (med.myProjectedRank != null) {
      bits.push("#" + med.myProjectedRank + " of " + med.teamCount + " proj");
    }
    var status = med.myInTopHalfProjected
      ? "Top " + med.topSlots + " · extra win"
      : "Outside top " + med.topSlots;
    return (
      '<div class="median-summary">' +
        '<p class="median-kicker">Median · top ' + med.topSlots + " get a win</p>" +
        '<p class="median-line">' + escapeHtml(bits.join(" · ")) + "</p>" +
        '<p class="median-status' + (med.myInTopHalfProjected ? " in" : " out") + '">' + escapeHtml(status) + "</p>" +
      "</div>"
    );
  }

  function medianBoardHtml(m) {
    if (!m || !m.medianWin || !m.median || !(m.median.teams || []).length) return "";
    var med = m.median;
    var rows = med.teams.map(function (t) {
      var cls = "median-row" +
        (t.isMine ? " mine" : "") +
        (t.inTopHalf ? " in" : " out") +
        (t.rank === med.topSlots ? " cut" : "");
      return (
        '<div class="' + cls + '">' +
          '<span class="median-rank">' + t.rank + "</span>" +
          '<span class="median-team">' + escapeHtml(t.teamName) + (t.isMine ? " · you" : "") + "</span>" +
          '<span class="median-pts">' +
            '<strong>' + fmtPts(t.points) + "</strong>" +
            (t.projected != null ? '<span class="proj">' + fmtPts(t.projected) + "</span>" : "") +
          "</span>" +
        "</div>"
      );
    }).join("");
    return (
      '<div class="median-board">' +
        "<h4>Projected standings · median</h4>" +
        '<p class="median-note">Top ' + med.topSlots + " of " + med.teamCount +
          (med.medianProjected != null ? " · line " + fmtPts(med.medianProjected) : "") +
          "</p>" +
        rows +
      "</div>"
    );
  }

  function outlookLine(side) {
    if (!side) return "";
    var bits = [];
    if (side.projected != null) bits.push("Proj " + fmtPts(side.projected));
    if (side.winPct != null) bits.push(fmtPct(side.winPct) + " win");
    if (!bits.length) return "";
    return '<p class="outlook">' + bits.join(" · ") + "</p>";
  }

  function playerRow(p) {
    var proj = p.projected != null ? '<span class="proj">' + fmtPts(p.projected) + "</span>" : "";
    return '<div class="player-row' + (p.starter === false ? " bench" : "") + '"><span>' + escapeHtml(p.name) +
      ' <span class="meta">' + escapeHtml((p.pos || "") + (p.team ? " " + p.team : "")) +
      "</span></span><span class=\"pts\">" + fmtPts(p.points) + proj + "</span></div>";
  }

  function lineupCol(title, starters, bench) {
    var startRows = (starters || []).map(playerRow).join("");
    var benchRows = (bench || []).map(playerRow).join("");
    var benchBlock = '<p class="bench-label">Bench</p>' + (benchRows || "<p class=\"muted\">No bench players</p>");
    return "<div><h4>" + escapeHtml(title || "") + "</h4>" +
      (startRows || "<p class=\"muted\">No starters</p>") +
      benchBlock + "</div>";
  }

  function renderRoots() {
    var snap = snapshot();
    var empty = el("rootsEmpty");
    var happyBox = el("happyList");
    var conflictBlock = el("conflictBlock");
    var conflictList = el("conflictList");
    var medianBlock = el("medianRootBlock");
    var medianList = el("medianRootList");
    if (!hasAccounts() || !(snap.matchups || []).length) {
      empty.hidden = false;
      happyBox.innerHTML = "";
      conflictBlock.hidden = true;
      if (medianBlock) medianBlock.hidden = true;
      return;
    }
    empty.hidden = true;
    var board = buildRootBoard(snap.matchups, state.includeBench);
    el("rootIntro").textContent = state.includeBench
      ? "Your rostered players who are not on an opponent in any connected league. Ranked by how many of your teams they help, then their points this week."
      : "Players on your lineups who are not starting against you in any connected league. Ranked by how many of your teams they help, then their points this week.";
    happyBox.innerHTML = board.happy.length
      ? board.happy.map(function (row, i) { return rankCard(row, i + 1, false); }).join("")
      : '<div class="empty-state compact"><p>Every player you started is also on an opponent somewhere this week.</p></div>';
    if (board.conflicted.length) {
      conflictBlock.hidden = false;
      conflictList.innerHTML = board.conflicted.map(function (row, i) { return rankCard(row, i + 1, true); }).join("");
    } else {
      conflictBlock.hidden = true;
    }
    renderMedianRoots(snap.matchups || []);
  }

  function renderMedianRoots(matchups) {
    var medianBlock = el("medianRootBlock");
    var medianList = el("medianRootList");
    var medianIntro = el("medianRootIntro");
    if (!medianBlock || !medianList) return;
    var rows = [];
    matchups.forEach(function (m) {
      if (!m.medianWin || !m.median || !(m.median.rootAgainst || []).length) return;
      (m.median.rootAgainst || []).forEach(function (item) {
        rows.push({
          league: m.leagueName,
          topSlots: m.median.topSlots,
          medianProjected: m.median.medianProjected,
          item: item
        });
      });
    });
    if (!rows.length) {
      medianBlock.hidden = true;
      medianList.innerHTML = "";
      return;
    }
    medianBlock.hidden = false;
    if (medianIntro) {
      medianIntro.textContent = "Starters on bubble teams fighting for the top-half median win. Root against big projected games that could push you out — or keep a rival in.";
    }
    medianList.innerHTML = rows.map(function (row, i) {
      return medianRootCard(row, i + 1);
    }).join("");
  }

  function medianRootCard(row, n) {
    var p = row.item.player || {};
    var tag = row.item.inTopHalf ? "above line" : "below line";
    if (row.item.onBubble) tag = "bubble · " + tag;
    return (
      '<article class="rank-card against">' +
        '<div class="rank-num">' + n + "</div>" +
        "<div>" +
          '<p class="rank-name">' + escapeHtml(p.name || "Player") + "</p>" +
          '<p class="rank-sub">' + escapeHtml(
            (p.pos || "") + (p.team ? " · " + p.team : "") +
            " · #" + row.item.teamRank + " " + row.item.teamName +
            " · " + row.league + " · " + tag
          ) + "</p>" +
        "</div>" +
        '<div class="rank-pts">' + fmtPts(row.item.projected != null ? row.item.projected : row.item.points) +
          "<span>" + (row.item.projected != null ? "proj" : "pts") + " against</span>" +
        "</div>" +
      "</article>"
    );
  }

  function rankCard(row, n, conflict) {
    var p = row.player;
    var help = unique(row.mine.map(function (x) { return x.league; }));
    var hurt = unique(row.opp.map(function (x) { return x.league; }));
    var sub = conflict
      ? "Helps " + help.join(", ") + " · hurts " + hurt.join(", ")
      : (row.leagues > 1 ? row.leagues + " of your lineups" : help[0] || "Your lineup");
    return (
      '<article class="rank-card' + (conflict ? " conflict" : "") + '">' +
        '<div class="rank-num">' + n + "</div>" +
        "<div>" +
          '<p class="rank-name">' + escapeHtml(p.name) + "</p>" +
          '<p class="rank-sub">' + escapeHtml((p.pos || "") + (p.team ? " · " + p.team : "") + " · " + sub) + "</p>" +
        "</div>" +
        '<div class="rank-pts">' + fmtPts(row.myPoints) +
          "<span>" + (conflict ? "net " + fmtPts(row.myPoints - row.oppPoints) : "pts for you") + "</span>" +
        "</div>" +
      "</article>"
    );
  }

  function unique(list) {
    var seen = {};
    var out = [];
    (list || []).forEach(function (x) {
      if (!x || seen[x]) return;
      seen[x] = true;
      out.push(x);
    });
    return out;
  }

  function renderAccounts() {
    el("sleeperUser").value = state.sleeper.username || el("sleeperUser").value;
    if (!el("espnSeason").value) el("espnSeason").value = currentSeason();
    el("includeBench").checked = !!state.includeBench;
    if (state.sleeper.userId) {
      el("sleeperStatus").textContent = (state.sleeper.displayName || state.sleeper.username) +
        " · " + (state.sleeper.leagues || []).length + " league" + ((state.sleeper.leagues || []).length === 1 ? "" : "s");
    }
    el("sleeperLeagueList").innerHTML = (state.sleeper.leagues || []).map(function (l) {
      return leagueRow(l, "sleeper");
    }).join("");
    el("espnLeagueList").innerHTML = (state.espn.leagues || []).map(function (l) {
      return leagueRow(l, "espn");
    }).join("");
    if (state.lastSync) {
      var when = new Date(state.lastSync);
      el("syncMeta").textContent = (state.demo ? "Sample board · " : "Last sync ") +
        (isNaN(when.getTime()) ? state.lastSync : when.toLocaleString());
    } else {
      el("syncMeta").textContent = "Not synced yet.";
    }
  }

  function leagueRow(l, platform) {
    var usesMedian = platform === "sleeper" && leagueUsesMedian(l);
    var sub = (l.teamName ? l.teamName + " · " : "") + (l.season || "") + (l.error ? " · " + l.error : "");
    if (platform === "espn" && l.source === "snapshot") sub += " · snapshot";
    if (usesMedian) sub += " · median win";
    var medianBtn = platform === "sleeper"
      ? '<button type="button" class="tiny median-btn' + (usesMedian ? " on" : "") +
        '" data-median="' + escapeHtml(l.localId) + '" aria-pressed="' + (usesMedian ? "true" : "false") + '">' +
        (usesMedian ? "Median on" : "Median") + "</button>"
      : "";
    return (
      '<div class="league-item" data-id="' + escapeHtml(l.localId) + '" data-platform="' + platform + '">' +
        '<label class="check-row" style="margin:0">' +
          '<input type="checkbox" data-toggle="' + escapeHtml(l.localId) + '" ' + (l.enabled ? "checked" : "") + " />" +
        "</label>" +
        '<div class="grow"><p class="name">' + escapeHtml(l.name) + '</p><p class="sub">' + escapeHtml(sub) + "</p></div>" +
        medianBtn +
        '<button type="button" class="tiny" data-remove="' + escapeHtml(l.localId) + '">Remove</button>' +
      "</div>"
    );
  }

  function stampVersion() {
    var node = document.querySelector(".app-version");
    if (node) node.textContent = "v" + APP_VERSION;
  }

  function renderAll() {
    renderHeader();
    renderScores();
    renderRoots();
    renderAccounts();
    stampVersion();
  }

  function findLeague(localId) {
    var all = (state.sleeper.leagues || []).concat(state.espn.leagues || []);
    return all.filter(function (l) { return l.localId === localId; })[0];
  }

  function exportJson() {
    var payload = normalizeState(state);
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "fantasy-hub.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 800);
    toast("Exported");
  }

  function mergeState(existing, incoming) {
    existing = normalizeState(existing);
    incoming = normalizeState(incoming);
    function mergeLeagues(a, b) {
      var out = (a || []).map(cloneLeague).filter(Boolean);
      var ids = {};
      out.forEach(function (l) { ids[l.id + "|" + l.season] = true; });
      (b || []).forEach(function (l) {
        l = cloneLeague(l);
        if (!l || ids[l.id + "|" + l.season]) return;
        out.push(l);
        ids[l.id + "|" + l.season] = true;
      });
      return out;
    }
    existing.sleeper.username = incoming.sleeper.username || existing.sleeper.username;
    existing.sleeper.userId = incoming.sleeper.userId || existing.sleeper.userId;
    existing.sleeper.displayName = incoming.sleeper.displayName || existing.sleeper.displayName;
    existing.sleeper.leagues = mergeLeagues(existing.sleeper.leagues, incoming.sleeper.leagues);
    existing.espn.leagues = mergeLeagues(existing.espn.leagues, incoming.espn.leagues);
    if (incoming.snapshot) existing.snapshot = incoming.snapshot;
    existing.includeBench = incoming.includeBench;
    existing.demo = incoming.demo || existing.demo;
    return existing;
  }

  function importJson(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onerror = function () { toast("Could not read file"); };
    reader.onload = function () {
      try {
        var parsed = JSON.parse(reader.result);
        var slice = parsed;
        if (typeof AppsBackup !== "undefined" && AppsBackup.isUnifiedBackup(parsed)) {
          slice = AppsBackup.getAppSlice(parsed, APP_ID);
          if (!slice) { toast("No Fantasy Hub data in this file"); return; }
        }
        if (!slice || typeof slice !== "object" || (!slice.sleeper && !slice.espn && !slice.demo && !slice.snapshot)) {
          toast("Invalid backup file");
          return;
        }
        state = mergeState(state, slice);
        persist();
        renderAll();
        toast("Imported");
        if (hasAccounts() && !state.demo) refreshAll();
      } catch (e) {
        toast("Could not read file");
      }
    };
    reader.readAsText(file);
  }

  function bind() {
    document.querySelectorAll(".nav-btn").forEach(function (btn) {
      btn.addEventListener("click", function () { showView(btn.getAttribute("data-view")); });
    });
    el("emptyConnectBtn").addEventListener("click", function () { showView("accounts"); });
    el("emptyDemoBtn").addEventListener("click", loadDemo);
    el("demoBtn").addEventListener("click", loadDemo);
    el("clearDemoBtn").addEventListener("click", clearBoard);
    el("refreshBtn").addEventListener("click", function () {
      if (!hasAccounts()) { showView("accounts"); toast("Connect a league first"); return; }
      refreshAll();
    });
    el("weekPrev").addEventListener("click", function () {
      state.weekOverride = clampWeek(currentWeek() - 1);
      persist();
      if (hasAccounts()) refreshAll();
      else renderHeader();
    });
    el("weekNext").addEventListener("click", function () {
      state.weekOverride = clampWeek(currentWeek() + 1);
      persist();
      if (hasAccounts()) refreshAll();
      else renderHeader();
    });
    el("sleeperConnectBtn").addEventListener("click", function () {
      connectSleeper(el("sleeperUser").value);
    });
    el("sleeperUser").addEventListener("keydown", function (e) {
      if (e.key === "Enter") connectSleeper(el("sleeperUser").value);
    });
    el("espnAddBtn").addEventListener("click", addEspnLeague);
    el("espnCopyHelper").addEventListener("click", copyEspnHelper);
    el("espnPasteBtn").addEventListener("click", function () {
      try { addEspnSnapshot(); } catch (err) {
        el("espnStatus").textContent = err.message || "Could not read snapshot";
        toast(err.message || "Could not read snapshot");
      }
    });
    el("includeBench").addEventListener("change", function () {
      state.includeBench = el("includeBench").checked;
      persist();
      renderRoots();
    });
    el("exportJsonBtn").addEventListener("click", exportJson);
    el("importJsonFile").addEventListener("change", function (e) {
      importJson(e.target.files && e.target.files[0]);
      e.target.value = "";
    });
    el("scoreList").addEventListener("click", function (e) {
      var card = e.target.closest(".score-card");
      if (!card) return;
      card.classList.toggle("open");
    });
    el("sleeperLeagueList").addEventListener("click", onLeagueListClick);
    el("espnLeagueList").addEventListener("click", onLeagueListClick);
    el("sleeperLeagueList").addEventListener("change", onLeagueToggle);
    el("espnLeagueList").addEventListener("change", onLeagueToggle);
    el("teamPickCancel").addEventListener("click", closeTeamPicker);
    el("teamOverlay").addEventListener("click", function (e) {
      if (e.target.id === "teamOverlay") closeTeamPicker();
    });
    el("teamPickList").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-team]");
      if (!btn || !pendingEspn) return;
      var teamId = Number(btn.getAttribute("data-team"));
      var teams = (pendingEspn.payload.teams || []);
      var team = teams.filter(function (t) { return Number(t.id) === teamId; })[0];
      if (!team) return;
      finishEspnLeague(pendingEspn.league, pendingEspn.payload, team, pendingEspn.source || "live");
    });
  }

  function onLeagueListClick(e) {
    var medianBtn = e.target.closest("[data-median]");
    if (medianBtn) {
      var mid = medianBtn.getAttribute("data-median");
      var mrow = findLeague(mid);
      if (!mrow) return;
      var currentlyOn = leagueUsesMedian(mrow);
      mrow.medianWin = !currentlyOn;
      persist();
      renderAccounts();
      if (hasAccounts()) refreshAll();
      else renderAll();
      toast(mrow.medianWin ? "Median win tracking on" : "Median win tracking off");
      return;
    }
    var btn = e.target.closest("[data-remove]");
    if (!btn) return;
    var id = btn.getAttribute("data-remove");
    state.sleeper.leagues = (state.sleeper.leagues || []).filter(function (l) { return l.localId !== id; });
    state.espn.leagues = (state.espn.leagues || []).filter(function (l) { return l.localId !== id; });
    persist();
    renderAccounts();
    if (hasAccounts()) refreshAll();
    else {
      state.snapshot = null;
      persist();
      renderAll();
    }
  }

  function onLeagueToggle(e) {
    var box = e.target.closest("[data-toggle]");
    if (!box) return;
    var row = findLeague(box.getAttribute("data-toggle"));
    if (!row) return;
    row.enabled = box.checked;
    persist();
    if (hasAccounts()) refreshAll();
    else renderAll();
  }

  function init() {
    state = loadState();
    bind();
    renderAll();
    loadNflState().then(function () {
      if (state.weekOverride == null) renderHeader();
      if (el("espnSeason") && !el("espnSeason").value) el("espnSeason").value = currentSeason();
      if (hasAccounts() && !state.demo) refreshAll();
      else if (state.demo && (!state.snapshot || !state.snapshot.matchups)) {
        state.snapshot = demoSnapshot(currentWeek());
        persist();
        renderAll();
      }
    });
  }

  init();
})();
