(function () {
  "use strict";

  var SOURCE_KEYS = ["bdge", "rotowire", "ktc", "fantasycalc", "fantasypros"];
  var POSITIONS = ["ALL", "QB", "RB", "WR", "TE"];
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
    data: null
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
    if (p.you) return "you";
    if (state.roster !== "all" && state.roster !== "fa" && p.owner === state.roster) return "theirs";
    return "";
  }

  function render() {
    var rows = applyFilters(state.data.players);
    $("count").textContent = rows.length + " players · " + rosterLabel() + " · Superflex dynasty " + state.data.updated;
    $("ageLabel").textContent = state.ageMin + "–" + state.ageMax;
    $("valueLabel").textContent = fmtVal(state.valMin) + "–" + fmtVal(state.valMax);
    renderHead();
    $("body").innerHTML = rows.map(function (p) {
      var own = ownerName(p.owner);
      return (
        '<tr class="' + rowClass(p) + '">' +
          '<td class="col-player"><span class="name">' + p.name + "</span>" +
          '<span class="meta"><span class="pos">' + p.pos + "</span> " + p.team + "</span></td>" +
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
  }

  fetch("rankings.json?v=2")
    .then(function (r) { return r.json(); })
    .then(function (data) {
      state.data = data;
      $("headerSub").textContent = "Superflex dynasty · " + data.updated;
      $("footnote").innerHTML =
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
      bind();
      render();
    })
    .catch(function () {
      $("count").textContent = "Could not load rankings.json";
    });
})();
