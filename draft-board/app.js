(function () {
  "use strict";

  var STORAGE_KEY = "draft-board-v1";
  var TEAM_OPTIONS = [8, 10, 12, 14, 16];
  var POS = ["ALL", "RB", "WR", "TE", "QB", "K", "DST"];
  var VERDICTS = [
    { id: "ALL", label: "All takes" },
    { id: "do", label: "Do" },
    { id: "take", label: "Take" },
    { id: "dont", label: "Don't" },
    { id: "watch", label: "Watch" },
    { id: "split", label: "Split" }
  ];

  var DEFAULT_SETTINGS = {
    teams: 14,
    pick: 1,
    rounds: 15,
    qb: 1,
    rb: 2,
    wr: 2,
    flex: 1,
    te: 1,
    k: 1,
    dst: 1
  };

  var state = {
    tab: "plan",
    pos: "ALL",
    verdict: "ALL",
    windowOnly: false,
    notesOnly: true,
    starredOnly: false,
    query: "",
    openId: null,
    starred: {},
    settings: Object.assign({}, DEFAULT_SETTINGS),
    data: null,
    picks: [],
    windows: []
  };

  function clamp(n, lo, hi) {
    n = Number(n);
    if (!isFinite(n)) return lo;
    return Math.max(lo, Math.min(hi, Math.round(n)));
  }

  function normalizeSettings(raw) {
    var s = Object.assign({}, DEFAULT_SETTINGS, raw || {});
    s.teams = TEAM_OPTIONS.indexOf(s.teams) >= 0 ? s.teams : 14;
    s.pick = clamp(s.pick, 1, s.teams);
    s.rounds = clamp(s.rounds, 10, 20);
    s.qb = clamp(s.qb, 0, 3);
    s.rb = clamp(s.rb, 0, 4);
    s.wr = clamp(s.wr, 0, 5);
    s.flex = clamp(s.flex, 0, 3);
    s.te = clamp(s.te, 0, 2);
    s.k = clamp(s.k, 0, 1);
    s.dst = clamp(s.dst, 0, 1);
    return s;
  }

  function loadStore() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var p = JSON.parse(raw);
      if (p && Array.isArray(p.starred)) {
        p.starred.forEach(function (id) { state.starred[id] = true; });
      }
      if (p && p.settings) state.settings = normalizeSettings(p.settings);
    } catch (e) {}
  }

  function saveStore() {
    var ids = Object.keys(state.starred).filter(function (id) { return state.starred[id]; });
    var slice = {
      version: 2,
      starred: ids,
      settings: normalizeSettings(state.settings)
    };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(slice)); } catch (e) {}
  }

  /** Snake overall picks for a given slot (1-indexed). */
  function snakePicks(teams, slot, rounds) {
    var out = [];
    var r, start;
    for (r = 1; r <= rounds; r++) {
      start = (r - 1) * teams;
      if (r % 2 === 1) out.push(start + slot);
      else out.push(start + (teams - slot + 1));
    }
    return out;
  }

  function pickLabel(overall, teams) {
    var round = Math.ceil(overall / teams);
    var posInRound = ((overall - 1) % teams) + 1;
    return round + "." + String(posInRound).padStart(2, "0");
  }

  function buildWindows(picks, teams) {
    var windows = [];
    var i = 0;
    while (i < picks.length) {
      var group = [picks[i]];
      while (i + 1 < picks.length && picks[i + 1] === picks[i] + 1) {
        i += 1;
        group.push(picks[i]);
      }
      var rounds = group.map(function (p) { return Math.ceil(p / teams); });
      var roundLabel = rounds[0] === rounds[rounds.length - 1]
        ? String(rounds[0])
        : rounds[0] + "–" + rounds[rounds.length - 1];
      var labels = group.map(function (p) { return pickLabel(p, teams); });
      windows.push({
        round: roundLabel,
        picks: group.slice(),
        label: labels.join(" & ") + (group.length > 1 ? " (you pick twice)" : "")
      });
      i += 1;
    }
    return windows;
  }

  function windowTolerance(teams) {
    return Math.max(3, Math.floor(teams / 3));
  }

  function windowForAdp(adp, picks, teams) {
    if (adp == null || !picks.length) return null;
    var tol = windowTolerance(teams);
    var best = null;
    var bestDist = Infinity;
    picks.forEach(function (pk, idx) {
      var d = Math.abs(adp - pk);
      if (d <= tol && d < bestDist) {
        bestDist = d;
        best = {
          round: Math.ceil(pk / teams),
          pick: pk,
          label: "R" + Math.ceil(pk / teams) + " (pick " + pk + ")"
        };
      }
    });
    return best;
  }

  function recompute() {
    var s = state.settings;
    state.picks = snakePicks(s.teams, s.pick, s.rounds);
    state.windows = buildWindows(state.picks, s.teams);
    if (state.data && state.data.players) {
      state.data.players.forEach(function (p) {
        p.window = windowForAdp(p.adp, state.picks, s.teams);
      });
    }
  }

  function slotName() {
    return pickLabel(state.settings.pick, state.settings.teams);
  }

  function rosterText() {
    var s = state.settings;
    var parts = [];
    if (s.qb) parts.push(s.qb + " QB");
    if (s.rb) parts.push(s.rb + " RB");
    if (s.wr) parts.push(s.wr + " WR");
    if (s.flex) parts.push("FLEX");
    if (s.te) parts.push("TE");
    if (s.k) parts.push("K");
    if (s.dst) parts.push("DST");
    return parts.join(" · ");
  }

  function turnPicks(startRound) {
    // Return overall pick numbers for a paired turn starting at startRound (1-based),
    // e.g. rounds 2-3 for edge slots, or just that round's pick.
    var picks = state.picks;
    var teams = state.settings.teams;
    var wanted = [];
    picks.forEach(function (p) {
      var r = Math.ceil(p / teams);
      if (r === startRound || r === startRound + 1) wanted.push(p);
    });
    // Prefer consecutive pair around the turn
    for (var i = 0; i < wanted.length - 1; i++) {
      if (wanted[i + 1] === wanted[i] + 1) return [wanted[i], wanted[i + 1]];
    }
    return wanted.slice(0, 2);
  }

  function fmtPair(pair) {
    if (!pair || !pair.length) return "—";
    if (pair.length === 1) return String(pair[0]);
    return pair[0] + "–" + pair[1];
  }

  function earlySlot() {
    return state.settings.pick <= 4;
  }

  function verdictLabel(v) {
    return ({ do: "Do", dont: "Don't", take: "Take", watch: "Watch", split: "Split", none: "" })[v] || v;
  }

  function renderHeader() {
    var s = state.settings;
    document.getElementById("headerSub").textContent =
      s.teams + "-team · " + slotName() + " snake · BDGE notes";
    document.getElementById("rosterLine").textContent = rosterText();
    var adp = state.data && state.data.adp;
    document.getElementById("adpNote").textContent =
      "Newest BDGE video wins when takes conflict. ADP is " +
      (adp ? adp.primary : "Fantasy Football Calculator PPR") +
      " (board windows update with your settings).";
  }

  function renderPicks() {
    var grid = document.getElementById("pickGrid");
    var edge = state.settings.pick === 1 || state.settings.pick === state.settings.teams;
    document.getElementById("pickHint").textContent = edge
      ? "On the edge of a snake you pick twice in a row at every turn after round 1."
      : "Snake draft — your overall pick numbers for each round.";
    grid.innerHTML = state.windows.map(function (w) {
      return '<div class="pick-pill"><strong>' + w.label + "</strong><span>Round " + w.round + "</span></div>";
    }).join("");
  }

  function renderPlanCopy() {
    var s = state.settings;
    var p1 = state.picks[0];
    var t23 = turnPicks(2);
    var t45 = turnPicks(4);
    var t67 = turnPicks(6);
    var t89 = turnPicks(8);
    var late = state.picks.filter(function (p) { return p >= s.teams * 9; });
    var lastTwo = state.picks.slice(-2);

    var doHtml = [];
    if (earlySlot() && s.pick === 1) {
      doHtml.push("<li><strong>Pick " + p1 + " (" + slotName() + "): Jahmyr Gibbs.</strong> Nick’s official 1.01. In a 2-WR league he wants hero RB, not Chase/Puka first. Bijan is the only other 1.01-quality back.</li>");
    } else if (earlySlot()) {
      doHtml.push("<li><strong>Early pick (" + slotName() + "):</strong> Prefer an elite RB (Gibbs/Bijan/CMC/JT tier) before locking into WR-WR if your format starts only 2 WRs.</li>");
    } else {
      doHtml.push("<li><strong>Pick " + p1 + " (" + slotName() + "):</strong> Best player available in that tier — don’t force a reach just because the cheat sheet was written for 1.01.</li>");
    }
    doHtml.push("<li><strong>" + fmtPair(t23) + ": lean WR firepower</strong> (Nabers, AJ Brown, Nico, Olave, DeVonta, Pickens, Rice, Tet) unless a true RB2 falls (KW3, Hampton, Henry).</li>");
    doHtml.push("<li><strong>Wait on QB</strong> in 1QB. Purdy / Stafford / Daniels / Hurts live mid/late. Don’t spend your " + fmtPair(t23) + " on Allen or Lamar.</li>");
    doHtml.push("<li><strong>Wait on elite TE.</strong> Skip Bowers/McBride early. Warren or Loveland around " + fmtPair(t45) + "; LaPorta / Kraft around " + fmtPair(t67) + "; Chig as a punt later.</li>");
    doHtml.push("<li><strong>Smash week-2 risers at value:</strong> Etienne (Kamara out), Nico (Higgins ACL), Breece (ignore the groin), Downs, Stribling mid/late, Keaton Mitchell last rounds if you have Hampton.</li>");
    doHtml.push("<li><strong>Handcuffs with a locked job:</strong> Tank Bigsby, MarShawn Lloyd, Jonathan Brooks (if Chuba is out). 49ers RB2 (Black / James) is free if you drafted CMC.</li>");
    document.getElementById("doRules").innerHTML = doHtml.join("");

    var dontHtml = [
      "<li><strong>Don’t leave RB1 empty early</strong> in a 2-WR format if you’re in the top few picks — you’ll be thin by " + fmtPair(t23) + ".</li>",
      "<li><strong>Don’t take Jacobs as your RB1</strong> over a WR1 at " + fmtPair(t23) + " (camp, OL, possible suspension).</li>",
      "<li><strong>Don’t draft Kamara, Tracy, Hutchinson, Tank Dell, Ja'Kobi Lane, Trey Harris, Gadsden, Cyrus Allen, or anyone behind Skattebo</strong> (Tracy / Singletary / Najee).</li>",
      "<li><strong>Don’t pay ADP for Achane, Kyren, Zay Flowers, Garrett Wilson, Alec Pierce, McLaurin, or Jordyn Tyson.</strong></li>",
      "<li><strong>Don’t reach Jeremiyah Love</strong> if the high ankle is still lingering — he slid from the 2–3 turn into the next tier.</li>",
      "<li><strong>Don’t smash Mike Washington</strong> as a Jeanty cuff — they don’t want that Raiders offense without Jeanty.</li>",
      "<li><strong>K / DST last</strong> (around " + fmtPair(lastTwo) + "). Never earlier.</li>"
    ];
    document.getElementById("dontRules").innerHTML = dontHtml.join("");

    var rounds = [
      "<li><strong>Pick " + p1 + ":</strong> " + (s.pick === 1 ? "Gibbs (Bijan only if Gibbs is somehow gone)." : "Best available in your tier — still prefer elite RB if you’re early.") + "</li>",
      "<li><strong>" + fmtPair(t23) + ":</strong> Two WRs from the Nabers / Nico / AJB / Olave / DeVonta / Pickens / Rice / Tet pile, or one WR + falling RB2.</li>",
      "<li><strong>" + fmtPair(t45) + ":</strong> Best available flex + TE if Warren/Loveland are there. Etienne is a smash if he lasts. Evans only at a discount (quad).</li>",
      "<li><strong>" + fmtPair(t67) + ":</strong> Downs, Daniels/Hurts/Purdy, LaPorta/Kraft, Skattebo if he slid. Still no kicker.</li>",
      "<li><strong>" + fmtPair(t89) + ":</strong> Stribling if he hasn’t gone; Lemon; JCM; Parker Washington if ADP hasn’t exploded.</li>",
      "<li><strong>" + (late[0] || "Late") + "+:</strong> Chig, Coker, Noel, Keaton Mitchell, Brooks, Bigsby, Lloyd, 49ers RB2. Stream QB if you waited.</li>"
    ];
    document.getElementById("roundSheet").innerHTML = rounds.join("");
  }

  function renderVideos(videos) {
    document.getElementById("videoList").innerHTML = videos.map(function (v) {
      return "<li><a href=\"https://youtu.be/" + v.id + "\">" + v.title + "</a> — " + v.when + "</li>";
    }).join("");
  }

  function chipHtml(items, active, key) {
    return items.map(function (item) {
      var id = typeof item === "string" ? item : item.id;
      var label = typeof item === "string" ? item : item.label;
      var on = String(id) === String(active) ? " active" : "";
      return '<button type="button" class="chip' + on + '" data-' + key + '="' + id + '">' + label + "</button>";
    }).join("");
  }

  function playerBlurb(p) {
    if (!p.notes || !p.notes.length) return "";
    return p.notes[0].text;
  }

  function renderPlayers() {
    var list = document.getElementById("playerList");
    if (!list || !state.data) return;
    var q = state.query.trim().toLowerCase();
    var rows = state.data.players.filter(function (p) {
      if (state.pos !== "ALL" && p.pos !== state.pos) return false;
      if (state.notesOnly && !p.hasNotes) return false;
      if (state.starredOnly && !state.starred[p.id]) return false;
      if (state.windowOnly && !p.window) return false;
      if (state.verdict !== "ALL" && p.verdict !== state.verdict) return false;
      if (q) {
        var hay = (p.name + " " + (p.team || "") + " " + p.pos).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    document.getElementById("count").textContent = rows.length + " players · " + state.settings.teams + "-team · slot " + slotName();
    list.innerHTML = rows.map(function (p) {
      var open = state.openId === p.id;
      var starOn = state.starred[p.id] ? " on" : "";
      var starMark = state.starred[p.id] ? "★" : "☆";
      var badges = "";
      if (p.verdict && p.verdict !== "none") {
        badges += '<span class="badge ' + p.verdict + '">' + verdictLabel(p.verdict) + "</span>";
      }
      if (p.window) badges += '<span class="badge window">' + p.window.label + "</span>";
      var extra = "";
      if (p.espnAdp) extra += " · ESPN " + Number(p.espnAdp).toFixed(1);
      if (p.approxAdp) extra += " · approx ADP";
      var notes = (p.notes || []).map(function (n) {
        return '<div class="note"><strong>' + n.srcLabel + " · " + verdictLabel(n.stance) + "</strong> — " + n.text + "</div>";
      }).join("");
      return (
        '<article class="player' + (open ? " open" : "") + '" data-id="' + p.id + '">' +
          '<div class="player-top">' +
            '<div class="adp">' + (p.adp != null ? p.adp : "—") + "</div>" +
            "<div>" +
              '<div class="player-name">' + p.name + "</div>" +
              '<div class="player-meta">' + p.pos + " · " + (p.team || "?") +
                (p.adpSlot ? " · " + p.adpSlot : "") + extra + "</div>" +
            "</div>" +
            '<div class="badges">' + badges +
              '<button type="button" class="star' + starOn + '" data-star="' + p.id + '" aria-label="Star">' + starMark + "</button>" +
            "</div>" +
          "</div>" +
          (p.hasNotes ? '<p class="blurb">' + playerBlurb(p) + "</p>" : "") +
          '<div class="more">' + notes + "</div>" +
        "</article>"
      );
    }).join("") || '<p class="muted">No players match those filters.</p>';
  }

  function fillSelect(el, values, selected, labelFn) {
    el.innerHTML = values.map(function (v) {
      var lab = labelFn ? labelFn(v) : String(v);
      return '<option value="' + v + '"' + (String(v) === String(selected) ? " selected" : "") + ">" + lab + "</option>";
    }).join("");
  }

  function renderSettingsForm() {
    var s = state.settings;
    document.getElementById("teamsChips").innerHTML = chipHtml(
      TEAM_OPTIONS.map(function (t) { return { id: t, label: t + " teams" }; }),
      s.teams,
      "teams"
    );
    var slots = [];
    for (var i = 1; i <= s.teams; i++) slots.push(i);
    fillSelect(document.getElementById("pickSelect"), slots, s.pick, function (v) {
      return "Pick " + v + " (" + pickLabel(v, s.teams) + ")";
    });
    var rounds = [];
    for (var r = 10; r <= 18; r++) rounds.push(r);
    fillSelect(document.getElementById("roundsSelect"), rounds, s.rounds, function (v) {
      return v + " rounds";
    });
    document.getElementById("setQb").value = s.qb;
    document.getElementById("setRb").value = s.rb;
    document.getElementById("setWr").value = s.wr;
    document.getElementById("setFlex").value = s.flex;
    document.getElementById("setTe").value = s.te;
    document.getElementById("setK").value = s.k;
    document.getElementById("setDst").value = s.dst;

    var previewPicks = state.picks.slice(0, 6).join(", ");
    document.getElementById("settingsPreview").textContent =
      s.teams + "-team snake, slot " + slotName() + ", " + s.rounds + " rounds. " +
      "First picks: " + previewPicks + (state.picks.length > 6 ? "…" : "") +
      ". Roster: " + rosterText() + ".";
  }

  function renderBoardChrome() {
    document.getElementById("posChips").innerHTML = chipHtml(POS, state.pos, "pos");
    document.getElementById("verdictChips").innerHTML = chipHtml(VERDICTS, state.verdict, "verdict");
  }

  function refreshAll() {
    recompute();
    renderHeader();
    renderPicks();
    renderPlanCopy();
    renderSettingsForm();
    renderPlayers();
  }

  function applySettings(partial) {
    state.settings = normalizeSettings(Object.assign({}, state.settings, partial));
    if (state.settings.pick > state.settings.teams) state.settings.pick = state.settings.teams;
    saveStore();
    refreshAll();
  }

  function showTab(tab) {
    state.tab = tab;
    document.querySelectorAll(".tab").forEach(function (el) {
      el.classList.toggle("active", el.getAttribute("data-tab") === tab);
    });
    document.querySelectorAll(".view").forEach(function (el) {
      el.classList.toggle("active", el.getAttribute("data-view") === tab);
    });
  }

  function bind() {
    document.querySelectorAll(".tab").forEach(function (el) {
      el.addEventListener("click", function () { showTab(el.getAttribute("data-tab")); });
    });
    document.querySelectorAll("[data-goto]").forEach(function (el) {
      el.addEventListener("click", function () { showTab(el.getAttribute("data-goto")); });
    });
    document.getElementById("posChips").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-pos]");
      if (!btn) return;
      state.pos = btn.getAttribute("data-pos");
      renderBoardChrome();
      renderPlayers();
    });
    document.getElementById("verdictChips").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-verdict]");
      if (!btn) return;
      state.verdict = btn.getAttribute("data-verdict");
      renderBoardChrome();
      renderPlayers();
    });
    document.getElementById("teamsChips").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-teams]");
      if (!btn) return;
      applySettings({ teams: Number(btn.getAttribute("data-teams")) });
    });
    document.getElementById("pickSelect").addEventListener("change", function (e) {
      applySettings({ pick: Number(e.target.value) });
    });
    document.getElementById("roundsSelect").addEventListener("change", function (e) {
      applySettings({ rounds: Number(e.target.value) });
    });
    ["setQb", "setRb", "setWr", "setFlex", "setTe", "setK", "setDst"].forEach(function (id) {
      var key = id.replace("set", "").toLowerCase();
      if (key === "qb") key = "qb";
      document.getElementById(id).addEventListener("change", function (e) {
        var map = {
          setQb: "qb", setRb: "rb", setWr: "wr", setFlex: "flex",
          setTe: "te", setK: "k", setDst: "dst"
        };
        var patch = {};
        patch[map[id]] = Number(e.target.value);
        applySettings(patch);
      });
    });
    document.getElementById("resetSettings").addEventListener("click", function () {
      state.settings = Object.assign({}, DEFAULT_SETTINGS);
      saveStore();
      refreshAll();
    });
    document.getElementById("search").addEventListener("input", function (e) {
      state.query = e.target.value;
      renderPlayers();
    });
    document.getElementById("windowOnly").addEventListener("change", function (e) {
      state.windowOnly = e.target.checked;
      renderPlayers();
    });
    document.getElementById("notesOnly").addEventListener("change", function (e) {
      state.notesOnly = e.target.checked;
      renderPlayers();
    });
    document.getElementById("starredOnly").addEventListener("change", function (e) {
      state.starredOnly = e.target.checked;
      renderPlayers();
    });
    document.getElementById("playerList").addEventListener("click", function (e) {
      var star = e.target.closest("[data-star]");
      if (star) {
        var sid = star.getAttribute("data-star");
        state.starred[sid] = !state.starred[sid];
        saveStore();
        renderPlayers();
        return;
      }
      var card = e.target.closest(".player");
      if (!card) return;
      var id = card.getAttribute("data-id");
      state.openId = state.openId === id ? null : id;
      renderPlayers();
    });
  }

  loadStore();
  bind();
  renderBoardChrome();
  fetch("players.json?" + Date.now())
    .then(function (r) { return r.json(); })
    .then(function (data) {
      state.data = data;
      renderVideos(data.videos);
      refreshAll();
    })
    .catch(function () {
      document.getElementById("playerList").innerHTML = '<p class="muted">Could not load ADP board.</p>';
    });
})();
