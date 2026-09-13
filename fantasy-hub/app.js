(function () {
  "use strict";

  var APP_ID = "fantasy-hub";
  var STORAGE_KEY = "fantasy-hub-v1";
  var SECRETS_KEY = "fantasy-hub-secrets-v1";
  var PLAYERS_DB = "fantasy-hub-players-v1";
  var SLEEPER = "https://api.sleeper.app/v1";
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
      var moved = migrateLegacyCodes(parsed);
      var st = normalizeState(parsed);
      if (moved) {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(stripAuthFields(st)));
        } catch (e2) {}
      }
      return st;
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
    return {
      localId: String(row.localId || uid("lg")),
      id: String(row.id || ""),
      name: String(row.name || "League"),
      season: String(row.season || currentSeason()),
      rosterId: row.rosterId == null ? null : row.rosterId,
      teamId: row.teamId == null ? null : row.teamId,
      teamName: String(row.teamName || ""),
      enabled: row.enabled !== false,
      error: String(row.error || "")
    };
  }

  function stripAuthFields(obj) {
    if (!obj || typeof obj !== "object") return obj;
    var copy = JSON.parse(JSON.stringify(obj));
    (((copy.espn || {}).leagues) || []).forEach(function (l) {
      if (!l) return;
      delete l.espnS2;
      delete l.swid;
    });
    return copy;
  }

  function emptySecrets() {
    return { version: 1, espn: {} };
  }

  function loadSecrets() {
    try {
      var raw = localStorage.getItem(SECRETS_KEY);
      if (!raw) return emptySecrets();
      var p = JSON.parse(raw);
      if (!p || typeof p !== "object" || !p.espn || typeof p.espn !== "object") return emptySecrets();
      return { version: 1, espn: p.espn };
    } catch (e) {
      return emptySecrets();
    }
  }

  function saveSecrets(secrets) {
    try {
      var espn = (secrets && secrets.espn) || {};
      if (!Object.keys(espn).length) {
        localStorage.removeItem(SECRETS_KEY);
        return;
      }
      localStorage.setItem(SECRETS_KEY, JSON.stringify({ version: 1, espn: espn }));
    } catch (e) {
      toast("Could not save sign-in on this phone");
    }
  }

  function secretSlot(league) {
    if (!league) return "";
    return String(league.localId || "") || (String(league.id || "") + "|" + String(league.season || ""));
  }

  function getEspnCodes(league) {
    var all = loadSecrets();
    var slot = secretSlot(league);
    var row = (slot && all.espn[slot]) || all.espn[String(league && league.id) + "|" + String(league && league.season)] || null;
    if (!row) return { espnS2: "", swid: "" };
    return { espnS2: String(row.espnS2 || ""), swid: String(row.swid || "") };
  }

  function hasEspnCodes(league) {
    var c = getEspnCodes(league);
    return !!(c.espnS2 || c.swid);
  }

  function setEspnCodes(league, codes) {
    if (!league) return;
    var all = loadSecrets();
    var slot = secretSlot(league);
    if (!slot) return;
    var s2 = codes && String(codes.espnS2 || "").trim();
    var swid = codes && String(codes.swid || "").trim();
    if (s2 || swid) all.espn[slot] = { espnS2: s2 || "", swid: swid || "" };
    else delete all.espn[slot];
    saveSecrets(all);
  }

  function removeEspnCodes(leagueOrId) {
    var all = loadSecrets();
    if (typeof leagueOrId === "string") {
      delete all.espn[leagueOrId];
    } else if (leagueOrId) {
      delete all.espn[secretSlot(leagueOrId)];
      delete all.espn[String(leagueOrId.id || "") + "|" + String(leagueOrId.season || "")];
    }
    saveSecrets(all);
  }

  function clearAllSecrets() {
    try { localStorage.removeItem(SECRETS_KEY); } catch (e) {}
  }

  function migrateLegacyCodes(st) {
    var moved = false;
    ((st && st.espn && st.espn.leagues) || []).forEach(function (l) {
      if (!l) return;
      if (l.espnS2 || l.swid) {
        setEspnCodes(l, { espnS2: l.espnS2, swid: l.swid });
        delete l.espnS2;
        delete l.swid;
        moved = true;
      }
    });
    return moved;
  }

  function persist() {
    try {
      if (state && state.espn && Array.isArray(state.espn.leagues)) {
        state.espn.leagues.forEach(function (l) {
          if (!l) return;
          delete l.espnS2;
          delete l.swid;
        });
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stripAuthFields(state)));
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
        return {
          localId: old.localId || uid("sl"),
          id: String(lg.league_id),
          name: lg.name || "Sleeper league",
          season: String(lg.season || currentSeason()),
          rosterId: old.rosterId == null ? null : old.rosterId,
          teamId: null,
          teamName: old.teamName || "",
          enabled: old.enabled !== false,
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

  function loadSleeperMatchup(league, week) {
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

      var userById = {};
      users.forEach(function (u) { userById[String(u.user_id)] = u; });

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
      var oppRoster = oppRow ? rosters.filter(function (r) { return Number(r.roster_id) === Number(oppRow.roster_id); })[0] : null;
      var oppUser = oppRoster ? userById[String(oppRoster.owner_id)] || {} : {};

      return {
        platform: "sleeper",
        leagueId: league.id,
        leagueName: league.name,
        week: week,
        mine: packSleeperSide(mineRow, myRoster, league.teamName || "You"),
        opp: packSleeperSide(oppRow, oppRoster, (oppUser.metadata && oppUser.metadata.team_name) || oppUser.display_name || "Opponent")
      };
    });
  }

  function packSleeperSide(row, roster, teamName) {
    if (!row) {
      return { teamName: teamName || "Bye", points: 0, starters: [], bench: [], roster: [] };
    }
    var pointsMap = row.players_points || {};
    var starters = (row.starters || []).map(function (id) {
      var p = sleeperPlayer(id);
      if (!p) return null;
      p.points = Number(pointsMap[id] || 0);
      p.starter = true;
      return p;
    }).filter(Boolean);
    var starterSet = {};
    (row.starters || []).forEach(function (id) { starterSet[String(id)] = true; });
    var bench = (row.players || roster && roster.players || []).map(function (id) {
      if (starterSet[String(id)]) return null;
      var p = sleeperPlayer(id);
      if (!p) return null;
      p.points = Number(pointsMap[id] || 0);
      p.starter = false;
      return p;
    }).filter(Boolean);
    return {
      teamName: teamName,
      points: Number(row.points || 0),
      starters: starters,
      bench: bench,
      roster: starters.concat(bench)
    };
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

  function espnHeaders(league, codes) {
    var headers = { Accept: "application/json" };
    var auth = codes || getEspnCodes(league);
    if (auth.espnS2) headers.espn_s2 = auth.espnS2;
    if (auth.swid) headers.swid = auth.swid;
    return headers;
  }

  function espnLeagueUrl(league, week) {
    return ESPN + "/seasons/" + league.season + "/segments/0/leagues/" + league.id +
      "?view=mTeam&view=mRoster&view=mMatchup&view=mMatchupScore&view=mSettings&scoringPeriodId=" + week;
  }

  function addEspnLeague() {
    var parsed = parseEspnInput(el("espnUrl").value, el("espnSeason").value || currentSeason());
    if (!parsed.id) {
      toast("Paste an ESPN league URL or ID");
      return Promise.resolve();
    }
    var teamField = String(el("espnTeam").value || "").trim();
    var codes = {
      espnS2: String(el("espnS2").value || "").trim(),
      swid: String(el("espnSwid").value || "").trim()
    };
    el("espnS2").value = "";
    el("espnSwid").value = "";
    var league = {
      localId: uid("es"),
      id: parsed.id,
      name: "ESPN " + parsed.id,
      season: String(parsed.season || currentSeason()),
      rosterId: null,
      teamId: parsed.teamId,
      teamName: teamField,
      enabled: true,
      error: ""
    };
    if (!league.teamId && /^\d+$/.test(teamField)) league.teamId = Number(teamField);
    el("espnStatus").textContent = "Loading league " + league.id + "…";
    return fetchJson(espnLeagueUrl(league, currentWeek()), { headers: espnHeaders(league, codes) }).then(function (res) {
      if (res.status === 401 || (res.data && res.data.details && String((res.data.messages || [])[0] || "").indexOf("not authorized") >= 0)) {
        throw new Error("Private ESPN league — add espn_s2 and SWID cookies");
      }
      if (!res.ok || !res.data || !res.data.teams) {
        throw new Error((res.data && res.data.messages && res.data.messages[0]) || "Could not load that ESPN league");
      }
      var teams = res.data.teams || [];
      var picked = pickEspnTeam(teams, league);
      if (!picked && teams.length) {
        pendingEspn = { league: league, payload: res.data, codes: codes };
        openTeamPicker(teams, res.data.settings && res.data.settings.name);
        return;
      }
      if (!picked) throw new Error("No teams in that ESPN league");
      finishEspnLeague(league, res.data, picked, codes);
    }).catch(function (err) {
      el("espnStatus").textContent = err.message || "ESPN lookup failed";
      toast(err.message || "ESPN lookup failed");
    });
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

  function finishEspnLeague(league, payload, team, codes) {
    league.teamId = team.id;
    league.teamName = espnTeamName(team);
    league.name = (payload.settings && payload.settings.name) || league.name;
    league.error = "";
    delete league.espnS2;
    delete league.swid;
    state.espn.leagues = (state.espn.leagues || []).filter(function (l) {
      if (l.id === league.id && String(l.season) === String(league.season)) {
        removeEspnCodes(l);
        return false;
      }
      return true;
    });
    if (codes && (codes.espnS2 || codes.swid)) setEspnCodes(league, codes);
    state.espn.leagues.push(league);
    state.demo = false;
    persist();
    el("espnUrl").value = "";
    el("espnTeam").value = "";
    el("espnStatus").textContent = "Added " + league.name;
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

  function loadEspnMatchup(league, week) {
    return fetchJson(espnLeagueUrl(league, week), { headers: espnHeaders(league) }).then(function (res) {
      if (!res.ok || !res.data || !res.data.teams) {
        throw new Error((res.data && res.data.messages && res.data.messages[0]) || "Could not load " + league.name);
      }
      var data = res.data;
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
    });
  }

  function packEspnSide(side, team, data, week) {
    var name = espnTeamName(team);
    if (!side && !team) {
      return { teamName: "Bye", points: 0, starters: [], bench: [], roster: [] };
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
      var p = espnEntryToPlayer(entry);
      if (!p) return;
      if (p.starter) starters.push(p);
      else bench.push(p);
    });
    var points = side && (side.totalPointsLive != null ? side.totalPointsLive : side.totalPoints);
    if (points == null) points = starters.reduce(function (sum, p) { return sum + (p.points || 0); }, 0);
    return {
      teamName: name,
      points: Number(points || 0),
      starters: starters,
      bench: bench,
      roster: starters.concat(bench)
    };
  }

  function espnEntryToPlayer(entry) {
    var pool = entry && entry.playerPoolEntry;
    var player = pool && pool.player;
    if (!player) return null;
    var pos = ESPN_POS[player.defaultPositionId] || "FLEX";
    var team = ESPN_TEAMS[player.proTeamId] || "";
    var slot = entry.lineupSlotId;
    var starter = !ESPN_BENCH[slot];
    var points = 0;
    if (pool.appliedStatTotal != null) points = Number(pool.appliedStatTotal);
    else if (player.stats) {
      var st = player.stats.filter(function (s) { return s.appliedTotal != null; })[0];
      if (st) points = Number(st.appliedTotal || 0);
    }
    return {
      id: String(player.id),
      name: pos === "DEF" ? (team ? team + " D/ST" : player.fullName) : player.fullName,
      pos: pos,
      team: team,
      points: points,
      starter: starter
    };
  }

  function demoSnapshot(week) {
    function p(name, pos, team, points, starter) {
      return { id: normName(name), name: name, pos: pos, team: team, points: points, starter: starter !== false };
    }
    var chase = p("Ja'Marr Chase", "WR", "CIN", 22.4);
    var cmc = p("Christian McCaffrey", "RB", "SF", 18.1);
    var kelce = p("Travis Kelce", "TE", "KC", 11.2);
    var mahomes = p("Patrick Mahomes", "QB", "KC", 19.6);
    var achane = p("De'Von Achane", "RB", "MIA", 14.8);
    var dk = p("DK Metcalf", "WR", "SEA", 9.3);
    var nico = p("Nico Collins", "WR", "HOU", 13.5);
    var niners = p("49ers D/ST", "DEF", "SF", 7.0);
    var aubrey = p("Brandon Aubrey", "K", "DAL", 8.0);
    var jefferson = p("Justin Jefferson", "WR", "MIN", 16.2);
    var bijan = p("Bijan Robinson", "RB", "ATL", 17.4);
    var amonra = p("Amon-Ra St. Brown", "WR", "DET", 15.8);
    var allen = p("Josh Allen", "QB", "BUF", 23.2);
    var mcbride = p("Trey McBride", "TE", "ARI", 10.1);
    var kyren = p("Kyren Williams", "RB", "LAR", 12.6);
    var ladd = p("Ladd McConkey", "WR", "LAC", 11.4);
    var ravens = p("Ravens D/ST", "DEF", "BAL", 6.0);
    var bates = p("Jake Bates", "K", "DET", 7.0);

    var l1Mine = [mahomes, cmc, achane, chase, nico, dk, kelce, niners, aubrey];
    var l1Opp = [p("Lamar Jackson", "QB", "BAL", 18.4), p("Breece Hall", "RB", "NYJ", 12.0), jefferson, p("A.J. Brown", "WR", "PHI", 13.1), p("Mark Andrews", "TE", "BAL", 8.8), p("James Cook", "RB", "BUF", 11.4), p("Eagles D/ST", "DEF", "PHI", 5.0), p("Harrison Butker", "K", "KC", 9.0), p("Chris Olave", "WR", "NO", 10.3)];
    var l2Mine = [allen, bijan, kyren, chase, amonra, ladd, mcbride, ravens, bates];
    var l2Opp = [p("Jalen Hurts", "QB", "PHI", 20.1), p("Saquon Barkley", "RB", "PHI", 21.4), p("CeeDee Lamb", "WR", "DAL", 14.8), p("Puka Nacua", "WR", "LAR", 13.6), p("George Kittle", "TE", "SF", 9.9), p("Jahmyr Gibbs", "RB", "DET", 16.2), p("Cowboys D/ST", "DEF", "DAL", 4.0), p("Cameron Dicker", "K", "LAC", 8.0), p("Marvin Harrison Jr.", "WR", "ARI", 9.1)];
    var l3Mine = [p("Joe Burrow", "QB", "CIN", 17.8), p("Kyren Williams", "RB", "LAR", 11.9), jefferson, p("Malik Nabers", "WR", "NYG", 12.4), p("Brock Bowers", "TE", "LV", 9.6), p("James Conner", "RB", "ARI", 10.2), p("Lions D/ST", "DEF", "DET", 8.0), p("Jake Elliott", "K", "PHI", 6.0), p("Zay Flowers", "WR", "BAL", 10.5)];
    var l3Opp = [mahomes, cmc, p("Garrett Wilson", "WR", "NYJ", 11.1), p("Tee Higgins", "WR", "CIN", 12.8), p("Sam LaPorta", "TE", "DET", 8.4), p("Alvin Kamara", "RB", "NO", 9.7), p("Packers D/ST", "DEF", "GB", 5.0), p("Younghoe Koo", "K", "ATL", 7.0), p("Jaylen Waddle", "WR", "MIA", 8.6)];

    function side(teamName, players) {
      var starters = players.map(function (x) { return Object.assign({}, x, { starter: true }); });
      return {
        teamName: teamName,
        points: starters.reduce(function (s, x) { return s + x.points; }, 0),
        starters: starters,
        bench: [],
        roster: starters
      };
    }

    return {
      week: week,
      season: currentSeason(),
      demo: true,
      generatedAt: new Date().toISOString(),
      errors: [],
      matchups: [
        { platform: "sleeper", leagueId: "demo-home", leagueName: "Hometown Heroes", week: week, mine: side("Mathoose", l1Mine), opp: side("Gronk's Cousin", l1Opp) },
        { platform: "sleeper", leagueId: "demo-work", leagueName: "Work League", week: week, mine: side("Mathoose", l2Mine), opp: side("Waiver Wire FC", l2Opp) },
        { platform: "espn", leagueId: "demo-keep", leagueName: "Thursday Keepers", week: week, mine: side("Keep the Receipts", l3Mine), opp: side("Sunday Scaries", l3Opp) }
      ]
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
    clearAllSecrets();
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
      return (needPlayers ? loadSleeperPlayers(false) : Promise.resolve(null)).then(function () {
        var jobs = [];
        enabledSleeper().forEach(function (league) {
          jobs.push(loadSleeperMatchup(league, week).then(function (m) {
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
            if (row.ok) matchups.push(row.matchup);
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
        '<button type="button" class="score-card" data-idx="' + idx + '">' +
          '<div class="score-top">' +
            '<h3 class="league-name">' + escapeHtml(m.leagueName) + "</h3>" +
            '<span class="platform ' + m.platform + '">' + (m.platform === "espn" ? "ESPN" : "Sleeper") + "</span>" +
          "</div>" +
          '<div class="score-grid">' +
            '<div class="score-side">' +
              '<p class="who">' + escapeHtml(m.mine.teamName || "You") + "</p>" +
              '<p class="pts">' + fmtPts(m.mine.points) + "</p>" +
            "</div>" +
            '<div class="score-mid">VS</div>' +
            '<div class="score-side opp">' +
              '<p class="who">' + escapeHtml(m.opp.teamName || "Opponent") + "</p>" +
              '<p class="pts">' + fmtPts(m.opp.points) + "</p>" +
            "</div>" +
          "</div>" +
          '<div class="bars">' +
            '<div class="bar mine"><span style="width:' + minePct + '%"></span></div>' +
            '<div class="bar opp"><span style="width:' + oppPct + '%"></span></div>' +
          "</div>" +
          '<p class="result ' + res.cls + '">' + res.text + " · tap for lineups</p>" +
          '<div class="lineup">' +
            lineupCol(m.mine.teamName, m.mine.starters) +
            lineupCol(m.opp.teamName, m.opp.starters) +
          "</div>" +
        "</button>"
      );
    }).join("");
  }

  function lineupCol(title, players) {
    var rows = (players || []).map(function (p) {
      return '<div class="player-row"><span>' + escapeHtml(p.name) +
        ' <span class="meta">' + escapeHtml((p.pos || "") + (p.team ? " " + p.team : "")) +
        "</span></span><span class=\"pts\">" + fmtPts(p.points) + "</span></div>";
    }).join("");
    return "<div><h4>" + escapeHtml(title || "") + "</h4>" + (rows || "<p class=\"muted\">No starters</p>") + "</div>";
  }

  function renderRoots() {
    var snap = snapshot();
    var empty = el("rootsEmpty");
    var happyBox = el("happyList");
    var conflictBlock = el("conflictBlock");
    var conflictList = el("conflictList");
    if (!hasAccounts() || !(snap.matchups || []).length) {
      empty.hidden = false;
      happyBox.innerHTML = "";
      conflictBlock.hidden = true;
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
    var sub = (l.teamName ? l.teamName + " · " : "") + (l.season || "") + (l.error ? " · " + l.error : "");
    if (platform === "espn" && hasEspnCodes(l)) sub += " · signed in on this phone";
    return (
      '<div class="league-item" data-id="' + escapeHtml(l.localId) + '" data-platform="' + platform + '">' +
        '<label class="check-row" style="margin:0">' +
          '<input type="checkbox" data-toggle="' + escapeHtml(l.localId) + '" ' + (l.enabled ? "checked" : "") + " />" +
        "</label>" +
        '<div class="grow"><p class="name">' + escapeHtml(l.name) + '</p><p class="sub">' + escapeHtml(sub) + "</p></div>" +
        '<button type="button" class="tiny" data-remove="' + escapeHtml(l.localId) + '">Remove</button>' +
      "</div>"
    );
  }

  function renderAll() {
    renderHeader();
    renderScores();
    renderRoots();
    renderAccounts();
  }

  function findLeague(localId) {
    var all = (state.sleeper.leagues || []).concat(state.espn.leagues || []);
    return all.filter(function (l) { return l.localId === localId; })[0];
  }

  function exportJson() {
    var payload = stripAuthFields(normalizeState(state));
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
        slice = stripAuthFields(slice);
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
    el("espnCookieToggle").addEventListener("click", function () {
      el("espnCookieFields").hidden = !el("espnCookieFields").hidden;
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
      finishEspnLeague(pendingEspn.league, pendingEspn.payload, team, pendingEspn.codes);
    });
  }

  function onLeagueListClick(e) {
    var btn = e.target.closest("[data-remove]");
    if (!btn) return;
    var id = btn.getAttribute("data-remove");
    var doomed = findLeague(id);
    if (doomed) removeEspnCodes(doomed);
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
