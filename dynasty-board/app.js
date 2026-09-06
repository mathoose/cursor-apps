(function () {
  "use strict";

  var SOURCE_KEYS = ["bdge", "rotowire", "ktc", "fantasycalc", "fantasypros"];
  var SOURCE_LABELS = { bdge: "BDGE", rotowire: "RW", ktc: "KTC", fantasycalc: "FC", fantasypros: "FP" };
  var POSITIONS = ["ALL", "QB", "RB", "WR", "TE"];
  var LEAGUE = "10-team Superflex dynasty (QB, Superflex, 2 RB, 3 WR, TE, flex, D/ST, K)";
  var state = {
    pos: "ALL",
    roster: "all",
    top14: false,
    ageMin: 20,
    ageMax: 44,
    valMin: 0,
    valMax: 10000,
    sort: "consensus",
    dir: "asc",
    data: null,
    picked: []
  };

  function $(id) { return document.getElementById(id); }

  function ownerName(id) {
    if (!id) return "FA";
    var owners = state.data && state.data.owners ? state.data.owners : [];
    var hit = owners.filter(function (o) { return o.id === id; })[0];
    return hit ? hit.name : id;
  }

  function consensus(player) {
    var vals = SOURCE_KEYS.map(function (k) { return player.ranks[k]; }).filter(function (n) {
      return typeof n === "number";
    });
    if (!vals.length) return 99;
    return vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
  }

  function inTop14(player) {
    return SOURCE_KEYS.some(function (k) {
      var r = player.ranks[k];
      return typeof r === "number" && r <= 14;
    });
  }

  function matchesRoster(player) {
    if (state.roster === "all") return true;
    if (state.roster === "mine") return !!player.you;
    if (state.roster === "fa") return !player.owner;
    return player.owner === state.roster;
  }

  function sortValue(player, key) {
    if (key === "consensus") return consensus(player);
    if (key === "age") return player.age;
    if (key === "value") return player.value == null ? -1 : player.value;
    if (key === "name") return player.name;
    if (key === "owner") return ownerName(player.owner).toLowerCase();
    if (SOURCE_KEYS.indexOf(key) !== -1) {
      var r = player.ranks[key];
      return typeof r === "number" ? r : 999;
    }
    return 0;
  }

  function applyFilters(players) {
    return players.filter(function (p) {
      if (state.pos !== "ALL" && p.pos !== state.pos) return false;
      if (!matchesRoster(p)) return false;
      if (state.top14 && !inTop14(p)) return false;
      if (p.age < state.ageMin || p.age > state.ageMax) return false;
      var v = p.value == null ? 0 : p.value;
      if (v < state.valMin || v > state.valMax) return false;
      return true;
    }).sort(function (a, b) {
      if (state.sort === "value") {
        var av = a.value == null ? -1 : a.value;
        var bv = b.value == null ? -1 : b.value;
        var cmp = state.dir === "asc" ? av - bv : bv - av;
        return cmp || consensus(a) - consensus(b);
      }
      var av = sortValue(a, state.sort);
      var bv = sortValue(b, state.sort);
      var cmp = av < bv ? -1 : av > bv ? 1 : 0;
      if (state.dir === "desc") cmp = -cmp;
      return cmp || consensus(a) - consensus(b);
    });
  }

  function fmtVal(n) {
    if (n == null) return "—";
    if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k";
    return String(n);
  }

  function rankCell(n) {
    return typeof n === "number" ? String(n) : '<span class="blank">—</span>';
  }

  function rosterLabel() {
    if (state.roster === "all") return "all skill";
    if (state.roster === "mine") return "your roster";
    if (state.roster === "fa") return "not on a roster";
    return ownerName(state.roster);
  }

  function isPicked(name) {
    return state.picked.indexOf(name) !== -1;
  }

  function togglePick(name) {
    var i = state.picked.indexOf(name);
    if (i === -1) state.picked.push(name);
    else state.picked.splice(i, 1);
    renderSelectBar();
    render();
  }

  function playerByName(name) {
    var list = state.data.players;
    for (var i = 0; i < list.length; i++) {
      if (list[i].name === name) return list[i];
    }
    return null;
  }

  function rankBits(p) {
    return SOURCE_KEYS.map(function (k) {
      var n = p.ranks[k];
      return SOURCE_LABELS[k] + " " + (typeof n === "number" ? n : "—");
    }).join(" / ");
  }

  function playerLine(p) {
    return "- " + p.name + " · " + p.pos + " " + p.team +
      " · age " + p.age.toFixed(1) +
      " · val " + (p.value == null ? "—" : p.value) +
      " · avg " + consensus(p).toFixed(1) +
      " · " + rankBits(p);
  }

  function playerPayload(p) {
    return {
      name: p.name,
      pos: p.pos,
      team: p.team,
      age: p.age,
      value: p.value,
      owner: ownerName(p.owner),
      you: !!p.you,
      avg: Number(consensus(p).toFixed(1)),
      ranks: p.ranks
    };
  }

  function selectedGroups() {
    var send = [];
    var getBy = {};
    state.picked.forEach(function (name) {
      var p = playerByName(name);
      if (!p) return;
      if (p.you) {
        send.push(p);
        return;
      }
      var key = ownerName(p.owner);
      if (!getBy[key]) getBy[key] = [];
      getBy[key].push(p);
    });
    return { send: send, getBy: getBy, getKeys: Object.keys(getBy).sort() };
  }

  function exportText() {
    var groups = selectedGroups();
    var send = groups.send;
    var getBy = groups.getBy;
    var getKeys = groups.getKeys;
    var lines = [
      "DYNASTY BOARD TRADE ASK",
      "League: " + LEAGUE,
      "Snapshot: Superflex dynasty " + state.data.updated + " (BDGE / RW / KTC / FC / FP positional ranks; RW Superflex JTV)",
      ""
    ];
    if (send.length && getKeys.length) {
      lines.push("Ask: Propose Superflex dynasty trade packages. SEND is what I can offer. GET is who I want. Group packages by the other manager.");
    } else if (send.length) {
      lines.push("Ask: Propose Superflex dynasty packages to move these SEND chips. Suggest realistic targets and the other manager.");
    } else {
      lines.push("Ask: Propose Superflex dynasty packages to acquire these GET targets from my (mathoose) roster. Group by the other manager.");
    }
    lines.push("");
    if (send.length) {
      lines.push("SEND (mathoose)");
      send.forEach(function (p) { lines.push(playerLine(p)); });
      lines.push("");
    }
    if (getKeys.length) {
      lines.push("GET");
      getKeys.forEach(function (owner) {
        lines.push("  " + owner);
        getBy[owner].forEach(function (p) { lines.push("  " + playerLine(p)); });
      });
      lines.push("");
    }
    lines.push("Paste this in the Cursor Apps chat for trade packages.");
    lines.push("");
    lines.push("---json---");
    lines.push(JSON.stringify({
      type: "dynasty-board-trade-ask",
      format: "superflex-dynasty",
      league: LEAGUE,
      updated: state.data.updated,
      send: send.map(playerPayload),
      get: getKeys.map(function (owner) {
        return { owner: owner, players: getBy[owner].map(playerPayload) };
      })
    }));
    return lines.join("\n");
  }

  function toast(msg) {
    var el = $("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove("show"); }, 2800);
  }

  function showCopySheet(text) {
    var sheet = $("copySheet");
    var ta = $("copyText");
    ta.value = text;
    sheet.hidden = false;
    ta.focus();
    ta.select();
  }

  function copyToClipboard(text) {
    var done = function () {
      toast("Copied " + state.picked.length + " — paste in the Cursor Apps chat");
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () {
        showCopySheet(text);
      });
      return;
    }
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "0";
      ta.style.left = "0";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if (ok) done();
      else showCopySheet(text);
    } catch (err) {
      showCopySheet(text);
    }
  }

  function renderSelectBar() {
    var n = state.picked.length;
    $("selectMeta").textContent = n
      ? n + " selected · export, then paste here for packages"
      : "Tap players to select";
    $("clearSelect").disabled = !n;
    $("exportBtn").disabled = !n;
  }

  function renderChips() {
    $("posChips").innerHTML = POSITIONS.map(function (pos) {
      return '<button type="button" class="chip' + (state.pos === pos ? " on" : "") + '" data-pos="' + pos + '">' + pos + "</button>";
    }).join("");

    var owners = state.data.owners || [];
    var rosterOpts = [
      { id: "all", label: "All" },
      { id: "mine", label: "Mine" }
    ].concat(owners.filter(function (o) { return !o.you; }).map(function (o) {
      return { id: o.id, label: o.name };
    })).concat([{ id: "fa", label: "FA" }]);

    $("rosterChips").innerHTML = rosterOpts.map(function (opt) {
      return '<button type="button" class="chip' + (state.roster === opt.id ? " on" : "") + '" data-roster="' + opt.id + '">' + opt.label + "</button>";
    }).join("");
  }

  function renderHead() {
    var cols = [
      ["name", "Player"],
      ["owner", "Roster"],
      ["consensus", "Avg"],
      ["bdge", "BDGE"],
      ["rotowire", "RW"],
      ["ktc", "KTC"],
      ["fantasycalc", "FC"],
      ["fantasypros", "FP"],
      ["age", "Age"],
      ["value", "Val"]
    ];
    $("headRow").innerHTML = cols.map(function (c) {
      var cls = "col-" + c[0] + (state.sort === c[0] ? (state.dir === "asc" ? " sort-asc" : " sort-desc") : "");
      return '<th class="' + cls + '" data-sort="' + c[0] + '">' + c[1] + "</th>";
    }).join("");
  }

  function rowClass(p) {
    var bits = [];
    if (isPicked(p.name)) bits.push("sel");
    if (p.you) bits.push("you");
    else if (state.roster !== "all" && state.roster !== "fa" && p.owner === state.roster) bits.push("theirs");
    return bits.join(" ");
  }

  function render() {
    var rows = applyFilters(state.data.players);
    $("count").textContent = rows.length + " players · " + rosterLabel() + " · Superflex dynasty " + state.data.updated;
    $("ageLabel").textContent = state.ageMin + "–" + state.ageMax;
    $("valueLabel").textContent = fmtVal(state.valMin) + "–" + fmtVal(state.valMax);
    renderHead();
    $("body").innerHTML = rows.map(function (p) {
      var own = ownerName(p.owner);
      var picked = isPicked(p.name);
      return (
        '<tr class="' + rowClass(p) + '" data-name="' + p.name.replace(/"/g, "&quot;") + '" aria-selected="' + (picked ? "true" : "false") + '">' +
          '<td class="col-player"><div class="pick"><span class="tick" aria-hidden="true"></span>' +
          '<span class="who"><span class="name">' + p.name + "</span>" +
          '<span class="meta"><span class="pos">' + p.pos + "</span> " + p.team + "</span></span></div></td>" +
          '<td class="col-owner">' + own + "</td>" +
          "<td>" + consensus(p).toFixed(1) + "</td>" +
          "<td>" + rankCell(p.ranks.bdge) + "</td>" +
          "<td>" + rankCell(p.ranks.rotowire) + "</td>" +
          "<td>" + rankCell(p.ranks.ktc) + "</td>" +
          "<td>" + rankCell(p.ranks.fantasycalc) + "</td>" +
          "<td>" + rankCell(p.ranks.fantasypros) + "</td>" +
          "<td>" + p.age.toFixed(1) + "</td>" +
          "<td>" + fmtVal(p.value) + "</td>" +
        "</tr>"
      );
    }).join("");
  }

  function bind() {
    $("posChips").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-pos]");
      if (!btn) return;
      state.pos = btn.getAttribute("data-pos");
      renderChips();
      render();
    });
    $("rosterChips").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-roster]");
      if (!btn) return;
      state.roster = btn.getAttribute("data-roster");
      renderChips();
      render();
    });
    $("top14").addEventListener("change", function () {
      state.top14 = $("top14").checked;
      render();
    });
    ["ageMin", "ageMax", "valMin", "valMax"].forEach(function (id) {
      $(id).addEventListener("input", function () {
        var a = Number($("ageMin").value);
        var b = Number($("ageMax").value);
        state.ageMin = Math.min(a, b);
        state.ageMax = Math.max(a, b);
        var c = Number($("valMin").value);
        var d = Number($("valMax").value);
        state.valMin = Math.min(c, d);
        state.valMax = Math.max(c, d);
        render();
      });
    });
    $("headRow").addEventListener("click", function (e) {
      var th = e.target.closest("[data-sort]");
      if (!th) return;
      var key = th.getAttribute("data-sort");
      if (state.sort === key) state.dir = state.dir === "asc" ? "desc" : "asc";
      else {
        state.sort = key;
        state.dir = key === "value" || key === "name" || key === "owner" ? "desc" : "asc";
      }
      render();
    });
    $("body").addEventListener("click", function (e) {
      var tr = e.target.closest("tr[data-name]");
      if (!tr) return;
      togglePick(tr.getAttribute("data-name"));
    });
    $("selectVisible").addEventListener("click", function () {
      applyFilters(state.data.players).forEach(function (p) {
        if (!isPicked(p.name)) state.picked.push(p.name);
      });
      renderSelectBar();
      render();
    });
    $("clearSelect").addEventListener("click", function () {
      state.picked = [];
      renderSelectBar();
      render();
    });
    $("exportBtn").addEventListener("click", function () {
      if (!state.picked.length) return;
      copyToClipboard(exportText());
    });
    $("closeSheet").addEventListener("click", function () {
      $("copySheet").hidden = true;
    });
  }

  fetch("rankings.json?v=3")
    .then(function (r) { return r.json(); })
    .then(function (data) {
      state.data = data;
      $("headerSub").textContent = "Superflex dynasty · " + data.updated;
      $("footnote").innerHTML =
        "Tap players, then <strong>Export</strong> to copy a trade ask — paste it in the Cursor Apps chat for packages. " +
        "Your players go under SEND; everyone else is GET. " +
        "Every rank column is <strong>Superflex dynasty</strong> (positional). Avg skips blanks. Value is RotoWire Superflex JTV. " +
        "Your rows are highlighted. Other-team chips use reconstructed Sleeper skill rosters — benches may be incomplete. " +
        (data.rosterNote ? data.rosterNote + " " : "") +
        data.sources.map(function (s) {
          return "<strong>" + s.label + "</strong> — " + s.note;
        }).join(" · ") +
        ' · <a href="https://keeptradecut.com/dynasty-rankings?format=2">KTC Superflex</a> · ' +
        '<a href="https://www.rotowire.com/football/article/dynasty-trade-value-chart-september-2026-update-132022">RotoWire Superflex</a> · ' +
        '<a href="https://www.fantasycalc.com/dynasty-rankings">FantasyCalc Superflex</a> · ' +
        '<a href="https://www.fantasypros.com/nfl/rankings/nick-ercolano-bdge.php?position=OP&amp;type=dynasty">BDGE Superflex</a> · ' +
        '<a href="https://www.fantasypros.com/nfl/rankings/dynasty-qb.php">FantasyPros Superflex</a>';
      renderChips();
      renderSelectBar();
      bind();
      render();
    })
    .catch(function () {
      $("count").textContent = "Could not load rankings.json";
    });
})();
