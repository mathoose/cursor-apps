(function () {
  "use strict";

  var STORAGE_KEY = "draft-board-v1";
  var POS = ["ALL", "RB", "WR", "TE", "QB", "K", "DST"];
  var VERDICTS = [
    { id: "ALL", label: "All takes" },
    { id: "do", label: "Do" },
    { id: "take", label: "Take" },
    { id: "dont", label: "Don't" },
    { id: "watch", label: "Watch" },
    { id: "split", label: "Split" }
  ];

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
    data: null
  };

  function loadStarred() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var p = JSON.parse(raw);
      if (p && Array.isArray(p.starred)) {
        p.starred.forEach(function (id) { state.starred[id] = true; });
      }
    } catch (e) {}
  }

  function saveStarred() {
    var ids = Object.keys(state.starred).filter(function (id) { return state.starred[id]; });
    var slice = { version: 1, starred: ids };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(slice)); } catch (e) {}
  }

  function verdictLabel(v) {
    return ({ do: "Do", dont: "Don't", take: "Take", watch: "Watch", split: "Split", none: "" })[v] || v;
  }

  function renderPicks(league) {
    var grid = document.getElementById("pickGrid");
    grid.innerHTML = league.windows.map(function (w) {
      return '<div class="pick-pill"><strong>' + w.label + "</strong><span>Round " + w.round + "</span></div>";
    }).join("");
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
      var on = id === active ? " active" : "";
      return '<button type="button" class="chip' + on + '" data-' + key + '="' + id + '">' + label + "</button>";
    }).join("");
  }

  function playerBlurb(p) {
    if (!p.notes || !p.notes.length) return "";
    return p.notes[0].text;
  }

  function renderPlayers() {
    var list = document.getElementById("playerList");
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
    document.getElementById("count").textContent = rows.length + " players";
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

  function renderBoardChrome() {
    document.getElementById("posChips").innerHTML = chipHtml(POS, state.pos, "pos");
    document.getElementById("verdictChips").innerHTML = chipHtml(VERDICTS, state.verdict, "verdict");
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
        saveStarred();
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

  loadStarred();
  bind();
  fetch("players.json?" + Date.now())
    .then(function (r) { return r.json(); })
    .then(function (data) {
      state.data = data;
      renderPicks(data.league);
      renderVideos(data.videos);
      renderBoardChrome();
      renderPlayers();
    })
    .catch(function () {
      document.getElementById("playerList").innerHTML = '<p class="muted">Could not load ADP board.</p>';
    });
})();
