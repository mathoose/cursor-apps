/* Tracker Viewer — read-only snapshot of a daily-tank-tracker export. */
(function () {
  "use strict";

  var APP_VERSION = "3 · Aug 28, 2026";
  var REJECT_MSG = "This does not look like a tracker export. Use Export ZIP from daily-tank-tracker.html.";
  var BACKUP_KEYS = [
    "tanks",
    "tasks",
    "projects",
    "processExcellence",
    "productProfiles",
    "seriesProfiles",
    "drbEntries",
    "drbNotes",
  ];
  var LARGE_BYTES = 150 * 1024 * 1024;
  var IDB_NAME = "trackerViewer";
  var IDB_STORE = "snapshots";
  var IDB_KEY = "current";
  var UI_KEY = "trackerViewer_ui";
  var TAB_LABELS = {
    todo: "To-do",
    batches: "Batches",
    processes: "Processes",
    projects: "Projects",
    drb: "DRB",
  };

  var snapshot = null;
  var currentTab = "todo";
  var detailId = null;
  var returnTab = null;
  var searches = { todo: "", processes: "", projects: "", batches: "", drb: "" };
  var pendingFile = null;
  var toastTimer = null;

  var els = {};

  function $(id) {
    return document.getElementById(id);
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function text(value) {
    if (value == null) return "";
    if (typeof value === "string") return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return "";
  }

  function populated(value) {
    if (value == null || value === "") return false;
    if (typeof value === "boolean") return true;
    if (Array.isArray(value)) return value.length > 0;
    return String(value).trim() !== "";
  }

  function formatDate(raw) {
    var s = text(raw);
    if (!s) return "";
    var iso = s.length === 10 && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s + "T00:00:00" : s;
    var d = new Date(iso);
    if (isNaN(d.getTime())) return s;
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function formatDateTime(raw) {
    var s = text(raw);
    if (!s) return "";
    var d = new Date(s);
    if (isNaN(d.getTime())) return formatDate(s);
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function formatBytes(n) {
    if (!n || n < 0) return "0 B";
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / (1024 * 1024)).toFixed(1) + " MB";
  }

  function blob(parts) {
    return parts
      .filter(function (p) {
        return p != null && String(p).trim() !== "";
      })
      .join(" ")
      .toLowerCase();
  }

  function matchesQuery(haystack, q) {
    if (!q) return true;
    return haystack.indexOf(q) !== -1;
  }

  function itemId(item, fallback) {
    if (item && item.id != null && String(item.id) !== "") return String(item.id);
    return fallback;
  }

  function clip(value, max) {
    var s = text(value);
    if (!s) return "";
    if (s.length <= max) return s;
    return s.slice(0, max - 1) + "…";
  }

  function firstText(obj, keys) {
    if (!obj) return "";
    for (var i = 0; i < keys.length; i++) {
      var v = text(obj[keys[i]]);
      if (v) return v;
    }
    return "";
  }

  function sortByCreatedDesc(arr) {
    return asArray(arr).slice().sort(function (a, b) {
      return new Date(b && b.createdAt ? b.createdAt : 0) - new Date(a && a.createdAt ? a.createdAt : 0);
    });
  }

  function isOpenItem(item) {
    if (!item) return false;
    if (item.done === true || item.completed === true) return false;
    var s = text(item.status).toLowerCase();
    if (s === "done" || s === "complete" || s === "completed" || s === "closed") return false;
    return true;
  }

  function normalizeLot(value) {
    return text(value).replace(/^lot\s+/i, "").replace(/\s+/g, "").toUpperCase();
  }

  function batchProduct(tank) {
    return firstText(tank, ["materialDescription", "product", "materialCode", "materialName"]);
  }

  function batchStage(tank) {
    return firstText(tank, ["stage", "status"]);
  }

  function lastCommentText(tank) {
    var comments = sortByCreatedDesc(tank && tank.comments);
    for (var i = 0; i < comments.length; i++) {
      if (text(comments[i] && comments[i].text)) return text(comments[i].text);
    }
    var adjs = sortByCreatedDesc(tank && tank.adjustments);
    for (var j = 0; j < adjs.length; j++) {
      var note = firstText(adjs[j], ["note", "commentAfter", "commentBefore"]);
      if (note) return note;
    }
    return "";
  }

  function humanizeKey(key) {
    var known = {
      type: "Type",
      kind: "Kind",
      note: "Note",
      commentBefore: "Comment before",
      commentAfter: "Comment after",
      createdAt: "When",
      updatedAt: "Updated",
      imageName: "Photo file",
      material: "Material",
      materialCode: "Material code",
      materialDescription: "Material",
      product: "Product",
      amount: "Amount",
      amountKg: "Amount (kg)",
      addedKg: "Added (kg)",
      weightKg: "Weight (kg)",
      kg: "kg",
      quantity: "Quantity",
      qty: "Qty",
      solidsPct: "Solids %",
      solidsBefore: "Solids before %",
      solidsAfter: "Solids after %",
      targetSolids: "Target solids %",
      startingSolidsPct: "Starting solids %",
      finalSolidsPct: "Final solids %",
      weightBefore: "Weight before",
      weightAfter: "Weight after",
      startingWeightKg: "Starting weight (kg)",
      finalWeightKg: "Final weight (kg)",
      reason: "Reason",
      description: "Description",
    };
    if (known[key]) return known[key];
    return String(key)
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " ")
      .replace(/\bKg\b/g, "kg")
      .replace(/\bPct\b/gi, "%")
      .replace(/^./, function (c) {
        return c.toUpperCase();
      });
  }

  function isImageishKey(key) {
    var k = String(key || "");
    return k === "imageData" || k === "imageRef" || k === "linkedImageId" || k === "image";
  }

  function orderedObjectKeys(obj, preferred) {
    var keys = Object.keys(obj || {});
    var seen = {};
    var out = [];
    (preferred || []).forEach(function (k) {
      if (Object.prototype.hasOwnProperty.call(obj, k) && !seen[k]) {
        seen[k] = true;
        out.push(k);
      }
    });
    keys.forEach(function (k) {
      if (!seen[k]) out.push(k);
    });
    return out;
  }

  function formatFieldDisplay(key, value) {
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (typeof value === "number") return String(value);
    if (/(^createdAt$|^updatedAt$|At$|Date$|Time$)/.test(key) || key === "when") {
      return formatDateTime(value) || formatDate(value) || String(value);
    }
    return value;
  }

  function recordFieldsHtml(obj, skip) {
    skip = skip || {};
    if (!obj || typeof obj !== "object") return "";
    var html = '<div class="fields">';
    var preferred = [
      "type",
      "kind",
      "title",
      "createdAt",
      "updatedAt",
      "note",
      "reason",
      "description",
      "material",
      "materialCode",
      "materialDescription",
      "product",
      "amount",
      "amountKg",
      "addedKg",
      "weightKg",
      "kg",
      "quantity",
      "qty",
      "solidsPct",
      "solidsBefore",
      "solidsAfter",
      "targetSolids",
      "startingSolidsPct",
      "finalSolidsPct",
      "weightBefore",
      "weightAfter",
      "startingWeightKg",
      "finalWeightKg",
      "commentBefore",
      "commentAfter",
    ];
    orderedObjectKeys(obj, preferred).forEach(function (key) {
      if (skip[key] || isImageishKey(key) || key === "id") return;
      var v = obj[key];
      if (Array.isArray(v)) {
        if (!v.length) return;
        html += '<div class="field"><div class="k">' + esc(humanizeKey(key)) + "</div>";
        if (v.every(function (item) { return item && typeof item === "object"; })) {
          v.forEach(function (item) {
            html += '<div class="nested-record">' + recordFieldsHtml(item, skip) + "</div>";
          });
        } else {
          html += '<div class="v">' + esc(v.map(function (item) { return text(item) || String(item); }).filter(Boolean).join(", ")) + "</div>";
        }
        html += "</div>";
        return;
      }
      if (v && typeof v === "object") {
        html +=
          '<div class="field"><div class="k">' +
          esc(humanizeKey(key)) +
          "</div>" +
          recordFieldsHtml(v, skip) +
          "</div>";
        return;
      }
      if (!populated(v) && v !== 0 && v !== false) return;
      html +=
        '<div class="field"><div class="k">' +
        esc(humanizeKey(key)) +
        '</div><div class="v">' +
        nl(formatFieldDisplay(key, v)) +
        "</div></div>";
    });
    html += "</div>";
    return html;
  }

  function collectRecordText(value, parts) {
    if (value == null) return;
    if (Array.isArray(value)) {
      value.forEach(function (item) {
        collectRecordText(item, parts);
      });
      return;
    }
    if (typeof value === "object") {
      Object.keys(value).forEach(function (k) {
        if (isImageishKey(k) || k === "id") return;
        collectRecordText(value[k], parts);
      });
      return;
    }
    parts.push(value);
  }

  function usawLabel(tank) {
    var lot = text(tank && tank.usawLot);
    if (!lot) return "";
    return /^usaw/i.test(lot) ? lot : "USAW " + lot;
  }

  function profileLabel(id) {
    if (id == null || id === "") return "";
    var sid = String(id);
    var pools = asArray(dataOf().productProfiles).concat(asArray(dataOf().seriesProfiles));
    for (var i = 0; i < pools.length; i++) {
      var p = pools[i];
      if (itemId(p, "") === sid) {
        return firstText(p, ["name", "title", "code", "materialCode", "description"]);
      }
    }
    return "";
  }

  function processProductLabel(proc) {
    var direct = firstText(proc, [
      "product",
      "productName",
      "materialDescription",
      "materialName",
      "materialCode",
      "productCode",
      "series",
      "materialSeries",
      "subtitle",
    ]);
    if (direct) return direct;
    var fromProfile = profileLabel(proc.productId || proc.productProfileId || proc.seriesId);
    if (fromProfile) return fromProfile;
    var tags = asArray(proc.tags).filter(function (t) {
      return text(t);
    });
    return tags.length ? text(tags[0]) : "";
  }

  function processDistinguisher(proc) {
    var label = processProductLabel(proc);
    if (label) return label;
    var title = text(proc.title) || "Untitled process";
    var siblings = asArray(lists().processes).filter(function (p) {
      return (text(p.title) || "Untitled process") === title;
    });
    if (siblings.length < 2) return text(proc.summary);
    var skip = {
      id: 1,
      title: 1,
      status: 1,
      version: 1,
      createdAt: 1,
      updatedAt: 1,
      type: 1,
      steps: 1,
      journal: 1,
      tags: 1,
      imageData: 1,
    };
    var keys = Object.keys(proc || {});
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (skip[k] || typeof proc[k] !== "string") continue;
      var mine = text(proc[k]);
      if (!mine) continue;
      var allSame = siblings.every(function (p) {
        return text(p[k]) === mine;
      });
      if (!allSame) return mine;
    }
    var myTags = asArray(proc.tags).map(text).filter(Boolean);
    var uniqueTags = myTags.filter(function (t) {
      return !siblings.every(function (p) {
        return asArray(p.tags).map(text).indexOf(t) !== -1;
      });
    });
    if (uniqueTags.length) return uniqueTags.join(", ");
    return text(proc.summary);
  }

  function processTitleCounts() {
    var counts = {};
    asArray(lists().processes).forEach(function (p) {
      var t = text(p.title) || "Untitled process";
      counts[t] = (counts[t] || 0) + 1;
    });
    return counts;
  }

  function drbMaterialTitle(entry) {
    return firstText(entry, ["materialName", "material", "product", "lotNumber"]) || "DRB";
  }

  function lotsMatch(a, b) {
    var na = normalizeLot(a);
    var nb = normalizeLot(b);
    if (!na || !nb) return false;
    return na === nb || na.indexOf(nb) !== -1 || nb.indexOf(na) !== -1;
  }

  function tanksLinkedToDrb(entry) {
    var out = [];
    var seen = {};
    function add(tank) {
      if (!tank) return;
      var key = itemId(tank, "t" + originalIndex(lists().batches, tank));
      if (seen[key]) return;
      seen[key] = true;
      out.push(tank);
    }
    asArray(lists().batches).forEach(function (tank) {
      if (lotsMatch(tank.usawLot, entry.lotNumber)) add(tank);
      else if (entry.tankNumber != null && String(entry.tankNumber) === String(tank.tankNumber)) add(tank);
      else if (entry.tankId && String(entry.tankId) === String(tank.id)) add(tank);
    });
    var extras = [].concat(
      asArray(entry.linkedTanks),
      asArray(entry.tanks),
      asArray(entry.batches),
      asArray(entry.tankIds)
    );
    extras.forEach(function (ref) {
      if (ref && typeof ref === "object") {
        asArray(lists().batches).forEach(function (tank) {
          if (tank.id && ref.id && String(tank.id) === String(ref.id)) add(tank);
          else if (lotsMatch(tank.usawLot, ref.usawLot || ref.lot || ref.lotNumber)) add(tank);
          else if (ref.tankNumber != null && String(tank.tankNumber) === String(ref.tankNumber)) add(tank);
        });
      } else if (ref != null && String(ref) !== "") {
        asArray(lists().batches).forEach(function (tank) {
          if (String(tank.id) === String(ref) || String(tank.tankNumber) === String(ref) || lotsMatch(tank.usawLot, ref)) add(tank);
        });
      }
    });
    return out;
  }

  function nl(value) {
    return esc(value).replace(/\n/g, "<br>");
  }

  function badgeClass(status) {
    var s = text(status).toLowerCase();
    if (s === "published" || s === "active" || s === "released" || s === "complete" || s === "done" || s === "yes") return "ok";
    if (s === "draft" || s === "in progress" || s === "in-progress" || s === "open" || s === "pending") return "draft";
    if (s === "archived" || s === "closed" || s === "held" || s === "inactive") return "archived";
    if (s === "rejected" || s === "fail" || s === "failed" || s === "critical") return "danger";
    return "";
  }

  function staticCheck(done) {
    return done
      ? '<span class="check" aria-hidden="true">✓</span>'
      : '<span class="check off" aria-hidden="true">☐</span>';
  }

  function photoHtml(src, alt, caption) {
    if (!src) return "";
    var cap = caption ? "<figcaption>" + esc(caption) + "</figcaption>" : "";
    return (
      '<figure class="photo"><img src="' +
      esc(src) +
      '" alt="' +
      esc(alt || "Photo") +
      '">' +
      cap +
      "</figure>"
    );
  }

  function fieldsHtml(rows) {
    var html = '<div class="fields">';
    rows.forEach(function (row) {
      if (!populated(row[1]) && row[1] !== false) return;
      var value = typeof row[1] === "boolean" ? (row[1] ? "Yes" : "No") : row[1];
      html +=
        '<div class="field"><div class="k">' +
        esc(row[0]) +
        '</div><div class="v">' +
        nl(value) +
        "</div></div>";
    });
    html += "</div>";
    return html;
  }

  function chipsHtml(tags) {
    var list = asArray(tags).filter(function (t) {
      return text(t);
    });
    if (!list.length) return "";
    return (
      '<div class="chips">' +
      list
        .map(function (t) {
          return '<span class="chip">' + esc(t) + "</span>";
        })
        .join("") +
      "</div>"
    );
  }

  function walkSteps(nodes, fn) {
    asArray(nodes).forEach(function (node) {
      fn(node);
      if (node && node.type === "fork") {
        asArray(node.branches).forEach(function (br) {
          walkSteps(br && br.steps, fn);
        });
      }
    });
  }

  function countSteps(nodes) {
    var n = 0;
    walkSteps(nodes, function (node) {
      if (node && node.type !== "fork") n += 1;
    });
    return n;
  }

  function branchLetter(index) {
    var n = index + 1;
    var s = "";
    while (n > 0) {
      n -= 1;
      s = String.fromCharCode(65 + (n % 26)) + s;
      n = Math.floor(n / 26);
    }
    return s;
  }

  function renderNodes(nodes, prefix) {
    var html = "";
    var n = 0;
    asArray(nodes).forEach(function (node) {
      n += 1;
      var num = prefix ? prefix + n : String(n);
      if (node && node.type === "fork") html += renderFork(node, num);
      else html += renderStep(node || {}, num);
    });
    return html;
  }

  function renderStep(node, num) {
    var html = '<article class="step">';
    html += '<span class="step-num">' + esc(num) + "</span>";
    html += "<h3>" + esc(node.title || "Step " + num) + "</h3>";
    if (text(node.body)) html += '<div class="step-body">' + nl(node.body) + "</div>";
    if (text(node.caution)) html += '<div class="caution">' + nl(node.caution) + "</div>";
    html += photoHtml(node.imageData, node.imageName, "Photo — Step " + num);
    html += "</article>";
    return html;
  }

  function renderFork(node, num) {
    var html = '<section class="fork">';
    html += '<span class="step-num">' + esc(num) + "</span>";
    html += '<div class="fork-label">Decision</div>';
    html += "<h3>" + esc(node.title || node.prompt || "Choose a path") + "</h3>";
    if (text(node.prompt) && text(node.title) && text(node.prompt) !== text(node.title)) {
      html += '<p class="fork-prompt">' + nl(node.prompt) + "</p>";
    }
    if (text(node.mergeNote)) html += '<p class="merge-note">' + nl(node.mergeNote) + "</p>";
    asArray(node.branches).forEach(function (br, i) {
      var letter = branchLetter(i);
      var childPrefix = num + letter + ".";
      html += '<div class="branch">';
      html +=
        '<div class="branch-label">' +
        esc(letter) +
        " · " +
        esc((br && br.label) || "Branch " + letter) +
        "</div>";
      if (br && text(br.whenToUse)) html += '<p class="when">' + nl(br.whenToUse) + "</p>";
      html += renderNodes(br && br.steps, childPrefix);
      html += "</div>";
    });
    html += "</section>";
    return html;
  }

  function processSearchBlob(proc) {
    var parts = [proc.title, proc.summary, proc.status].concat(asArray(proc.tags));
    walkSteps(proc.steps, function (node) {
      if (!node) return;
      if (node.type === "fork") {
        parts.push(node.title, node.prompt, node.mergeNote);
        asArray(node.branches).forEach(function (br) {
          if (br) parts.push(br.label, br.whenToUse);
        });
      } else {
        parts.push(node.title, node.body, node.caution, node.imageName);
      }
    });
    asArray(proc.journal).forEach(function (j) {
      if (j) parts.push(j.text, j.contextStepLabel, j.imageName);
    });
    parts.push(processProductLabel(proc));
    return blob(parts);
  }

  function projectSearchBlob(proj) {
    var parts = [proj.title, proj.status, proj.description].concat(asArray(proj.tags));
    asArray(proj.entries).forEach(function (e) {
      if (e) parts.push(e.text, e.imageName);
    });
    asArray(proj.followUps).forEach(function (f) {
      if (f) parts.push(f.text, f.kind, f.reminderDate);
    });
    asArray(proj.meetingNotes).forEach(function (m) {
      if (m) parts.push(m.title, m.text, m.meetingDate);
    });
    asArray(proj.mailLinks).forEach(function (m) {
      if (m) parts.push(m.subject, m.senderName, m.bodyText, m.lot);
    });
    return blob(parts);
  }

  function tankSearchBlob(tank) {
    var parts = [
      tank.tankNumber,
      tank.usawLot,
      tank.materialCode,
      tank.materialDescription,
      tank.materialSeries,
      tank.status,
      tank.stage,
      lastCommentText(tank),
    ];
    asArray(tank.comments).forEach(function (c) {
      if (c) parts.push(c.text);
    });
    asArray(tank.adjustments).forEach(function (a) {
      collectRecordText(a, parts);
    });
    return blob(parts);
  }

  function drbSearchBlob(entry) {
    var parts = [
      entry.date,
      entry.type,
      entry.classification,
      entry.product,
      entry.materialName,
      entry.product,
      entry.lotNumber,
      entry.supplier,
      entry.assignedQe,
      entry.issue,
      entry.overallRisk,
      entry.justification,
      entry.recommendedDecision,
    ];
    asArray(entry.todos).forEach(function (t) {
      if (t) parts.push(t.text);
    });
    asArray(entry.attachments).forEach(function (a) {
      if (a) parts.push(a.imageName);
    });
    return blob(parts);
  }

  function dataOf() {
    return (snapshot && snapshot.data) || {};
  }

  function lists() {
    var d = dataOf();
    return {
      processes: asArray(d.processExcellence),
      projects: asArray(d.projects),
      batches: asArray(d.tanks),
      drb: asArray(d.drbEntries),
      drbNotes: asArray(d.drbNotes),
      tasks: asArray(d.tasks),
    };
  }

  function sortByDateDesc(arr, field) {
    return arr.slice().sort(function (a, b) {
      var da = new Date(a && a[field] ? a[field] : 0).getTime();
      var db = new Date(b && b[field] ? b[field] : 0).getTime();
      if (db !== da) return db - da;
      return 0;
    });
  }

  function originalIndex(list, item) {
    return list.indexOf(item);
  }

  function rowKey(tab, item, list) {
    var prefix = { processes: "p", projects: "j", batches: "t", drb: "d", todo: "w" }[tab] || "x";
    return itemId(item, prefix + originalIndex(list, item));
  }

  function collectTodos() {
    var items = [];
    asArray(lists().projects).forEach(function (proj, pi) {
      var projKey = itemId(proj, "j" + pi);
      asArray(proj.followUps).forEach(function (f) {
        if (!isOpenItem(f)) return;
        var kind = text(f.kind).toLowerCase() || "followup";
        items.push({
          section: kind === "waiting" ? "waiting" : "todo",
          title: text(f.text) || "Follow-up",
          source: proj.title || "Project",
          kind: kind,
          when: f.reminderDate,
          tab: "projects",
          id: projKey,
        });
      });
    });
    asArray(lists().drb).forEach(function (entry, di) {
      var drbKey = itemId(entry, "d" + di);
      asArray(entry.todos).forEach(function (t) {
        if (!isOpenItem(t)) return;
        items.push({
          section: "todo",
          title: text(t.text) || "DRB to-do",
          source: drbMaterialTitle(entry),
          kind: "drb",
          when: entry.date,
          tab: "drb",
          id: drbKey,
        });
      });
    });
    asArray(lists().tasks).forEach(function (task, ti) {
      if (!isOpenItem(task)) return;
      var kind = text(task.kind || task.type).toLowerCase();
      var waiting = kind === "waiting" || task.waiting || text(task.waitingFor);
      var tab = "todo";
      var id = itemId(task, "k" + ti);
      if (task.projectId) {
        tab = "projects";
        id = String(task.projectId);
      } else if (task.tankId || task.tankNumber) {
        tab = "batches";
        var tanks = lists().batches;
        var match = tanks.filter(function (tn) {
          return String(tn.id) === String(task.tankId) || String(tn.tankNumber) === String(task.tankNumber);
        })[0];
        if (match) id = itemId(match, "t" + originalIndex(tanks, match));
      } else if (task.drbId) {
        tab = "drb";
        id = String(task.drbId);
      }
      items.push({
        section: waiting ? "waiting" : "todo",
        title: firstText(task, ["title", "text", "name", "waitingFor"]) || "Task",
        source: firstText(task, ["projectTitle", "source", "tankNumber"]) || "Task",
        kind: waiting ? "waiting" : "task",
        when: task.dueDate || task.reminderDate || task.createdAt,
        tab: tab,
        id: id,
      });
    });
    return items;
  }

  function filtered(tab) {
    var all = lists();
    var q = (searches[tab] || "").trim().toLowerCase();
    if (tab === "todo") {
      return collectTodos().filter(function (item) {
        return matchesQuery(blob([item.title, item.source, item.kind, item.when]), q);
      }).map(function (item, i) {
        return { item: item, key: "todo:" + i };
      });
    }
    var source =
      tab === "processes"
        ? sortByDateDesc(all.processes, "updatedAt")
        : tab === "projects"
          ? sortByDateDesc(all.projects, "updatedAt")
          : tab === "batches"
            ? sortByDateDesc(all.batches, "dateStarted")
            : sortByDateDesc(all.drb, "date");
    var orig =
      tab === "processes"
        ? all.processes
        : tab === "projects"
          ? all.projects
          : tab === "batches"
            ? all.batches
            : all.drb;
    var blobFn =
      tab === "processes"
        ? processSearchBlob
        : tab === "projects"
          ? projectSearchBlob
          : tab === "batches"
            ? tankSearchBlob
            : drbSearchBlob;
    var rows = [];
    source.forEach(function (item) {
      if (!matchesQuery(blobFn(item), q)) return;
      rows.push({ item: item, key: rowKey(tab, item, orig) });
    });
    return rows;
  }

  function isTrackerBackup(obj) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
    var found = 0;
    for (var i = 0; i < BACKUP_KEYS.length; i++) {
      var key = BACKUP_KEYS[i];
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        if (!Array.isArray(obj[key])) return false;
        found += 1;
      }
    }
    return found > 0;
  }

  function stripImageData(value) {
    if (Array.isArray(value)) {
      var arr = [];
      for (var i = 0; i < value.length; i++) arr.push(stripImageData(value[i]));
      return arr;
    }
    if (value && typeof value === "object") {
      var out = {};
      Object.keys(value).forEach(function (k) {
        if (k === "imageData") return;
        out[k] = stripImageData(value[k]);
      });
      return out;
    }
    return value;
  }

  function findZipFile(zip, fileName) {
    var direct = zip.file(fileName);
    if (direct) return direct;
    var found = null;
    zip.forEach(function (path, file) {
      if (found || file.dir) return;
      var base = path.split("/").pop();
      if (base === fileName) found = file;
    });
    return found;
  }

  function openDb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      };
      req.onsuccess = function () {
        resolve(req.result);
      };
      req.onerror = function () {
        reject(req.error || new Error("IndexedDB unavailable"));
      };
    });
  }

  function idbGet() {
    return openDb()
      .then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(IDB_STORE, "readonly");
          var req = tx.objectStore(IDB_STORE).get(IDB_KEY);
          req.onsuccess = function () {
            resolve(req.result || null);
          };
          req.onerror = function () {
            reject(req.error);
          };
        });
      })
      .catch(function () {
        return null;
      });
  }

  function idbPut(record) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(IDB_STORE, "readwrite");
        tx.oncomplete = function () {
          resolve();
        };
        tx.onerror = function () {
          reject(tx.error);
        };
        tx.objectStore(IDB_STORE).put(record, IDB_KEY);
      });
    });
  }

  function idbClear() {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(IDB_STORE, "readwrite");
        tx.oncomplete = function () {
          resolve();
        };
        tx.onerror = function () {
          reject(tx.error);
        };
        tx.objectStore(IDB_STORE).clear();
      });
    });
  }

  function readUi() {
    try {
      var raw = localStorage.getItem(UI_KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (parsed && parsed.uiVersion >= 2 && TAB_LABELS[parsed.tab]) currentTab = parsed.tab;
    } catch (e) {}
  }

  function writeUi() {
    try {
      localStorage.setItem(UI_KEY, JSON.stringify({ tab: currentTab, uiVersion: 2 }));
    } catch (e) {}
  }

  function setProgress(msg) {
    if (!msg) {
      els.progress.hidden = true;
      els.progress.textContent = "";
      return;
    }
    els.progress.hidden = false;
    els.progress.textContent = msg;
  }

  function setLoadError(msg) {
    if (!msg) {
      els.loadError.hidden = true;
      els.loadError.textContent = "";
      return;
    }
    els.loadError.hidden = false;
    els.loadError.textContent = msg;
  }

  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      els.toast.classList.remove("show");
    }, 2400);
  }

  function countsFrom(data) {
    return {
      processes: asArray(data.processExcellence).length,
      projects: asArray(data.projects).length,
      batches: asArray(data.tanks).length,
      drb: asArray(data.drbEntries).length,
    };
  }

  function exportedLabel(snap) {
    var when = snap && snap.exportedAt;
    return when ? formatDateTime(when) : "unknown date";
  }

  function showSummary(snap) {
    var c = countsFrom(snap.data);
    els.summaryCard.hidden = false;
    els.summaryCard.innerHTML =
      "<h2>Snapshot ready</h2>" +
      '<p class="muted">Exported ' +
      esc(exportedLabel(snap)) +
      (snap.textOnly ? " · text-only (photos omitted)" : "") +
      "</p>" +
      '<div class="counts">' +
      '<div class="count-chip"><span class="n">' +
      c.batches +
      '</span><span class="l">Batches</span></div>' +
      '<div class="count-chip"><span class="n">' +
      c.projects +
      '</span><span class="l">Projects</span></div>' +
      '<div class="count-chip"><span class="n">' +
      c.processes +
      '</span><span class="l">Processes</span></div>' +
      '<div class="count-chip"><span class="n">' +
      c.drb +
      '</span><span class="l">DRB</span></div>' +
      "</div>" +
      '<button type="button" class="btn-primary" id="btnOpenViewer">Open viewer</button>';
    var btn = document.getElementById("btnOpenViewer");
    if (btn) btn.addEventListener("click", showApp);
  }

  function parseJsonText(textValue) {
    var parsed;
    try {
      parsed = JSON.parse(textValue);
    } catch (e) {
      throw new Error(REJECT_MSG);
    }
    if (!isTrackerBackup(parsed)) throw new Error(REJECT_MSG);
    return parsed;
  }

  function parseZip(buffer) {
    if (typeof JSZip === "undefined") return Promise.reject(new Error("ZIP support failed to load."));
    return JSZip.loadAsync(buffer).then(function (zip) {
      var backup = findZipFile(zip, "full-backup.json");
      if (!backup) return Promise.reject(new Error(REJECT_MSG));
      var manifestFile = findZipFile(zip, "export-manifest.json");
      return backup.async("string").then(function (jsonText) {
        var data = parseJsonText(jsonText);
        if (!manifestFile) return { data: data, exportedAt: null };
        return manifestFile
          .async("string")
          .then(function (mText) {
            try {
              var manifest = JSON.parse(mText);
              return { data: data, exportedAt: manifest && manifest.exportedAt ? manifest.exportedAt : null };
            } catch (e) {
              return { data: data, exportedAt: null };
            }
          })
          .catch(function () {
            return { data: data, exportedAt: null };
          });
      });
    });
  }

  function looksLikeZip(file, buffer) {
    var name = (file && file.name) || "";
    var type = (file && file.type) || "";
    if (/\.zip$/i.test(name) || /zip/i.test(type)) return true;
    if (/\.json$/i.test(name)) return false;
    if (buffer && buffer.byteLength >= 4) {
      var u8 = new Uint8Array(buffer);
      if (u8[0] === 0x50 && u8[1] === 0x4b) return true;
    }
    return false;
  }

  function readFileBuffer(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(reader.result);
      };
      reader.onerror = function () {
        reject(new Error("Could not read that file."));
      };
      reader.readAsArrayBuffer(file);
    });
  }

  function utf8FromBuffer(buffer) {
    try {
      return new TextDecoder("utf-8").decode(buffer);
    } catch (e) {
      var u8 = new Uint8Array(buffer);
      var s = "";
      for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
      return decodeURIComponent(escape(s));
    }
  }

  function ingestParsed(data, exportedAt, file, textOnly) {
    var payload = textOnly ? stripImageData(data) : data;
    snapshot = {
      data: payload,
      exportedAt: exportedAt || null,
      textOnly: !!textOnly,
      fileName: file && file.name ? file.name : "",
      cachedAt: new Date().toISOString(),
    };
    setProgress("Saving snapshot on this device…");
    return idbPut(snapshot)
      .then(function () {
        setProgress("");
        showSummary(snapshot);
      })
      .catch(function () {
        setProgress("");
        showSummary(snapshot);
        toast("Opened, but this device could not cache it. You may need to pick the file again next time.");
      });
  }

  function parseAndLoad(file, textOnly) {
    setLoadError("");
    els.summaryCard.hidden = true;
    setProgress("Reading file…");
    return readFileBuffer(file)
      .then(function (buffer) {
        if (looksLikeZip(file, buffer)) {
          setProgress("Opening ZIP…");
          return parseZip(buffer);
        }
        setProgress("Parsing backup…");
        var data = parseJsonText(utf8FromBuffer(buffer));
        return { data: data, exportedAt: data.exportedAt || null };
      })
      .then(function (parsed) {
        return ingestParsed(parsed.data, parsed.exportedAt, file, textOnly);
      })
      .catch(function (err) {
        setProgress("");
        var msg = err && err.message ? err.message : REJECT_MSG;
        if (/zip|corrupt|invalid/i.test(msg) && msg !== REJECT_MSG) msg = REJECT_MSG;
        setLoadError(msg);
      });
  }

  function beginFile(file) {
    if (!file) return;
    pendingFile = file;
    if (file.size > LARGE_BYTES) {
      els.oversizeBody.textContent =
        "This export is about " +
        formatBytes(file.size) +
        ". Caching photos on iPhone may fail. Load with photos, or load text-only so notes still work without pictures.";
      els.oversize.hidden = false;
      return;
    }
    parseAndLoad(file, false);
  }

  function showLoad(keepSummary) {
    document.body.classList.remove("app-mode");
    els.loadScreen.hidden = false;
    els.appShell.hidden = true;
    if (!keepSummary) {
      els.summaryCard.hidden = true;
      setProgress("");
    }
    closeSheet();
  }

  function showApp() {
    if (!snapshot) return;
    document.body.classList.add("app-mode");
    els.loadScreen.hidden = true;
    els.appShell.hidden = false;
    closeSheet();
    els.oversize.hidden = true;
    renderAll();
  }

  function closeSheet() {
    els.sheet.hidden = true;
  }

  function openSheet() {
    if (!snapshot) return;
    var c = countsFrom(snapshot.data);
    els.sheetBody.textContent =
      "Exported " +
      exportedLabel(snapshot) +
      (snapshot.fileName ? " · " + snapshot.fileName : "") +
      (snapshot.textOnly ? " · text-only" : "") +
      " · " +
      c.batches +
      " batches, " +
      c.projects +
      " projects, " +
      c.processes +
      " processes, " +
      c.drb +
      " DRB.";
    els.sheet.hidden = false;
  }

  function headerForTab() {
    els.headerTitle.textContent = TAB_LABELS[currentTab] || "Tracker Viewer";
    if (currentTab === "todo") els.headerSub.textContent = "Waiting & open items";
    else els.headerSub.textContent = snapshot && snapshot.textOnly ? "Text-only snapshot" : "Read-only snapshot";
  }

  function renderBanner() {
    var extra = snapshot && snapshot.textOnly ? " · photos omitted" : "";
    els.banner.textContent = "Read-only snapshot — exported " + exportedLabel(snapshot) + extra;
  }

  function renderTabCounts() {
    var c = snapshot ? countsFrom(snapshot.data) : { processes: 0, projects: 0, batches: 0, drb: 0 };
    c.todo = snapshot ? collectTodos().length : 0;
    document.querySelectorAll("[data-count]").forEach(function (node) {
      var key = node.getAttribute("data-count");
      node.textContent = c[key] != null ? String(c[key]) : "";
    });
    document.querySelectorAll(".nav-btn").forEach(function (btn) {
      var on = btn.getAttribute("data-tab") === currentTab;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
  }

  function renderSearch() {
    var inDetail = !!detailId;
    els.searchWrap.hidden = inDetail;
    els.backRow.hidden = !inDetail;
    var placeholders = {
      todo: "Search waiting & to-dos…",
      processes: "Search title, tags, steps…",
      projects: "Search title, tags, notes…",
      batches: "Search tank, lot, product…",
      drb: "Search lot, product, issue…",
    };
    els.searchInput.placeholder = placeholders[currentTab] || "Search";
    if (els.searchInput.value !== (searches[currentTab] || "")) {
      els.searchInput.value = searches[currentTab] || "";
    }
    var backLabels = {
      todo: "← To-do",
      processes: "← All processes",
      projects: "← All projects",
      batches: "← All batches",
      drb: "← All DRB",
    };
    els.backToList.textContent = backLabels[currentTab] || "← All items";
  }

  function renderList() {
    if (currentTab === "todo") {
      renderTodoList();
      return;
    }
    var items = filtered(currentTab);
    if (!items.length) {
      var q = (searches[currentTab] || "").trim();
      var notes = currentTab === "drb" && !q ? drbNotesListHtml() : "";
      els.main.innerHTML =
        '<p class="empty">' +
        (q ? "No matches." : "No " + (TAB_LABELS[currentTab] || "items").toLowerCase() + " in this snapshot.") +
        "</p>" +
        notes;
      return;
    }
    var html = '<div class="list">';
    items.forEach(function (row) {
      html +=
        '<button type="button" class="list-item" data-open="' +
        esc(row.key) +
        '">' +
        listRowHtml(currentTab, row.item) +
        "</button>";
    });
    html += "</div>";
    if (currentTab === "drb" && !(searches.drb || "").trim()) html += drbNotesListHtml();
    els.main.innerHTML = html;
  }

  function renderTodoList() {
    var q = (searches.todo || "").trim().toLowerCase();
    var items = collectTodos().filter(function (item) {
      return matchesQuery(blob([item.title, item.source, item.kind, item.when]), q);
    });
    if (!items.length) {
      els.main.innerHTML =
        '<p class="empty">' +
        (q ? "No matches." : "Nothing waiting and no open to-dos in this snapshot.") +
        "</p>";
      return;
    }
    var waiting = items.filter(function (i) {
      return i.section === "waiting";
    });
    var todos = items.filter(function (i) {
      return i.section !== "waiting";
    });
    var html = "";
    function section(title, rows) {
      if (!rows.length) return;
      html += '<section class="detail-section"><h3>' + esc(title) + "</h3><div class='list'>";
      rows.forEach(function (item) {
        var canOpen = item.tab && item.tab !== "todo" && item.id;
        html += canOpen
          ? '<button type="button" class="list-item" data-open-tab="' +
            esc(item.tab) +
            '" data-open="' +
            esc(item.id) +
            '">'
          : '<div class="list-item">';
        html += todoRowHtml(item);
        html += canOpen ? "</button>" : "</div>";
      });
      html += "</div></section>";
    }
    section("Waiting for", waiting);
    section("To-do", todos);
    els.main.innerHTML = html;
  }

  function todoRowHtml(item) {
    var kindLabel = item.kind === "drb" ? "DRB" : item.kind || "to-do";
    return (
      '<div class="title">' +
      esc(item.title) +
      "</div>" +
      '<div class="meta"><span class="badge">' +
      esc(kindLabel) +
      "</span><span>" +
      esc(item.source) +
      "</span>" +
      (item.when ? "<span>" + esc(formatDate(item.when) || item.when) + "</span>" : "") +
      "</div>"
    );
  }

  function listRowHtml(tab, item) {
    if (tab === "processes") {
      var titleCounts = processTitleCounts();
      var rawTitle = text(item.title) || "Untitled process";
      var duplicate = (titleCounts[rawTitle] || 0) > 1;
      var distinguisher = processDistinguisher(item);
      var headline = duplicate && distinguisher && distinguisher !== rawTitle ? distinguisher : rawTitle;
      var sub = "";
      if (headline === rawTitle) {
        sub = distinguisher && distinguisher !== rawTitle ? distinguisher : "";
      } else {
        sub = rawTitle;
      }
      return (
        '<div class="title">' +
        esc(headline) +
        "</div>" +
        (sub ? '<div class="sub">' + esc(sub) + "</div>" : "") +
        '<div class="meta"><span class="badge ' +
        badgeClass(item.status) +
        '">' +
        esc(item.status || "draft") +
        "</span>" +
        (item.version != null ? "<span>v" + esc(item.version) + "</span>" : "") +
        "<span>" +
        countSteps(item.steps) +
        (countSteps(item.steps) === 1 ? " step" : " steps") +
        "</span><span>" +
        esc(formatDate(item.updatedAt)) +
        "</span></div>" +
        chipsHtml(item.tags)
      );
    }
    if (tab === "projects") {
      return (
        '<div class="title">' +
        esc(item.title || "Untitled project") +
        "</div>" +
        '<div class="meta"><span class="badge ' +
        badgeClass(item.status) +
        '">' +
        esc(item.status || "") +
        "</span><span>" +
        esc(formatDate(item.updatedAt)) +
        "</span></div>" +
        chipsHtml(item.tags)
      );
    }
    if (tab === "batches") {
      var lot = usawLabel(item) || "No USAW";
      var product = batchProduct(item) || "Unknown product";
      var comment = lastCommentText(item);
      return (
        '<div class="title">' +
        esc(lot) +
        " · " +
        esc(product) +
        "</div>" +
        '<div class="meta"><span>Tank ' +
        esc(item.tankNumber || "—") +
        '</span><span class="badge ' +
        badgeClass(batchStage(item)) +
        '">' +
        esc(batchStage(item) || "") +
        "</span></div>" +
        (comment ? '<div class="sub comment-line">' + esc(clip(comment, 110)) + "</div>" : "")
      );
    }
    var released = item.materialReleased ? "Released" : "Hold";
    var linked = tanksLinkedToDrb(item);
    var bubble = [];
    var productChip = text(item.product);
    var material = drbMaterialTitle(item);
    if (productChip && productChip !== material) bubble.push(productChip);
    linked.forEach(function (tank) {
      var label = "Tank " + (tank.tankNumber || "—");
      var prod = batchProduct(tank);
      if (prod) label += " · " + prod;
      bubble.push(label);
    });
    if (!bubble.length && text(item.lotNumber)) bubble.push(item.lotNumber);
    return (
      '<div class="title">' +
      esc(material) +
      "</div>" +
      chipsHtml(bubble) +
      '<div class="meta"><span>' +
      esc(formatDate(item.date) || "") +
      "</span><span>" +
      esc(item.classification || item.issue || "") +
      '</span><span class="badge ' +
      (item.materialReleased ? "ok" : "draft") +
      '">' +
      released +
      "</span></div>"
    );
  }

  function lookupItem(tab, id) {
    var all = lists();
    var list =
      tab === "processes"
        ? all.processes
        : tab === "projects"
          ? all.projects
          : tab === "batches"
            ? all.batches
            : tab === "drb"
              ? all.drb
              : null;
    if (!list) return null;
    for (var i = 0; i < list.length; i++) {
      if (rowKey(tab, list[i], list) === id) return list[i];
    }
    return null;
  }

  function renderDetail() {
    var item = lookupItem(currentTab, detailId);
    if (!item) {
      detailId = null;
      renderList();
      return;
    }
    if (currentTab === "processes") els.main.innerHTML = processDetail(item);
    else if (currentTab === "projects") els.main.innerHTML = projectDetail(item);
    else if (currentTab === "batches") els.main.innerHTML = batchDetail(item);
    else els.main.innerHTML = drbDetail(item);
  }

  function processDetail(proc) {
    var journal = asArray(proc.journal).slice().sort(function (a, b) {
      return new Date(a && a.createdAt ? a.createdAt : 0) - new Date(b && b.createdAt ? b.createdAt : 0);
    });
    var html = '<article class="detail">';
    html += "<h2>" + esc(proc.title || "Untitled process") + "</h2>";
    html +=
      '<div class="meta" style="margin-bottom:12px"><span class="badge ' +
      badgeClass(proc.status) +
      '">' +
      esc(proc.status || "draft") +
      "</span>" +
      (proc.version != null ? "<span class='muted'> v" + esc(proc.version) + "</span>" : "") +
      "</div>";
    html += chipsHtml(proc.tags);
    var product = processProductLabel(proc);
    if (product && product !== text(proc.title)) {
      html += '<p class="sub" style="margin:0 0 10px">' + esc(product) + "</p>";
    }
    if (text(proc.summary)) {
      html += '<section class="detail-section"><h3>Summary</h3><div class="v">' + nl(proc.summary) + "</div></section>";
    }
    html += '<section class="detail-section"><h3>Steps</h3>';
    html += asArray(proc.steps).length ? renderNodes(proc.steps, "") : '<p class="muted">No steps.</p>';
    html += "</section>";
    html += '<section class="detail-section"><h3>Log</h3>';
    if (!journal.length) html += '<p class="muted">No log entries.</p>';
    else {
      journal.forEach(function (j) {
        html += '<div class="log-item">';
        if (j.contextStepLabel) html += '<div class="ctx-tag">' + esc(j.contextStepLabel) + "</div>";
        html += '<div class="log-time">' + esc(formatDateTime(j.createdAt)) + "</div>";
        if (text(j.text)) html += "<div>" + nl(j.text) + "</div>";
        html += photoHtml(j.imageData, j.imageName, j.imageName ? "Photo — " + j.imageName : "Photo");
        html += "</div>";
      });
    }
    html += "</section></article>";
    return html;
  }

  function projectDetail(proj) {
    var html = '<article class="detail"><h2>' + esc(proj.title || "Untitled project") + "</h2>";
    html +=
      '<div class="meta" style="margin-bottom:12px"><span class="badge ' +
      badgeClass(proj.status) +
      '">' +
      esc(proj.status || "") +
      "</span></div>";
    html += chipsHtml(proj.tags);
    if (text(proj.description)) {
      html += '<section class="detail-section"><h3>Description</h3><div class="v">' + nl(proj.description) + "</div></section>";
    }
    var follows = asArray(proj.followUps);
    html += '<section class="detail-section"><h3>Follow-ups</h3>';
    if (!follows.length) html += '<p class="muted">None.</p>';
    else {
      follows.forEach(function (f) {
        html += '<div class="follow-row">' + staticCheck(!!f.done) + "<div>";
        if (f.kind) html += '<div class="k">' + esc(f.kind) + "</div>";
        html += "<div>" + nl(f.text) + "</div>";
        if (f.reminderDate) html += '<div class="muted">' + esc(formatDate(f.reminderDate)) + "</div>";
        html += "</div></div>";
      });
    }
    html += "</section>";
    var meetings = asArray(proj.meetingNotes);
    html += '<section class="detail-section"><h3>Meeting notes</h3>';
    if (!meetings.length) html += '<p class="muted">None.</p>';
    else {
      meetings.forEach(function (m) {
        html += '<div class="entry">';
        html += "<strong>" + esc(m.title || "Meeting") + "</strong>";
        if (m.meetingDate) html += '<div class="entry-time">' + esc(formatDate(m.meetingDate)) + "</div>";
        if (text(m.text)) html += "<div>" + nl(m.text) + "</div>";
        html += "</div>";
      });
    }
    html += "</section>";
    var mail = asArray(proj.mailLinks);
    if (mail.length) {
      html += '<section class="detail-section"><h3>Mail</h3>';
      mail.forEach(function (m) {
        html += '<div class="entry">';
        html += "<strong>" + esc(m.subject || "(no subject)") + "</strong>";
        html +=
          '<div class="entry-time">' +
          esc([m.senderName, formatDateTime(m.receivedTime), m.lot].filter(Boolean).join(" · ")) +
          "</div>";
        if (text(m.bodyText)) html += "<div>" + nl(m.bodyText) + "</div>";
        html += "</div>";
      });
      html += "</section>";
    }
    var entries = asArray(proj.entries).slice().sort(function (a, b) {
      return new Date(a && a.createdAt ? a.createdAt : 0) - new Date(b && b.createdAt ? b.createdAt : 0);
    });
    html += '<section class="detail-section"><h3>Timeline</h3>';
    if (!entries.length) html += '<p class="muted">No entries.</p>';
    else {
      entries.forEach(function (e) {
        html += '<div class="entry">';
        html += '<div class="entry-time">' + esc(formatDateTime(e.createdAt)) + "</div>";
        if (text(e.text)) html += "<div>" + nl(e.text) + "</div>";
        html += photoHtml(e.imageData, e.imageName, e.imageName ? "Photo — " + e.imageName : "Photo");
        html += "</div>";
      });
    }
    html += "</section></article>";
    return html;
  }

  function batchDetail(tank) {
    var html = '<article class="detail"><h2>' + esc(usawLabel(tank) || "Tank " + (tank.tankNumber || "—"));
    if (batchProduct(tank)) html += " · " + esc(batchProduct(tank));
    html += "</h2>";
    html += '<section class="detail-section"><h3>Identity</h3>';
    html += fieldsHtml([
      ["USAW lot", tank.usawLot],
      ["Product", batchProduct(tank)],
      ["Tank number", tank.tankNumber],
      ["Stage", batchStage(tank)],
      ["Material code", tank.materialCode],
      ["Series", tank.materialSeries],
      ["Status", tank.status],
      ["Starting weight (kg)", tank.startingWeightKg],
      ["Starting solids %", tank.startingSolidsPct],
      ["Final solids %", tank.finalSolidsPct],
      ["Date started", formatDate(tank.dateStarted) || tank.dateStarted],
      ["Date finished", formatDate(tank.dateFinished) || tank.dateFinished],
    ]);
    html += "</section>";
    var adjs = asArray(tank.adjustments).slice().sort(function (a, b) {
      return new Date(a && a.createdAt ? a.createdAt : 0) - new Date(b && b.createdAt ? b.createdAt : 0);
    });
    html += '<section class="detail-section"><h3>Adjustments</h3>';
    if (!adjs.length) html += '<p class="muted">None.</p>';
    else {
      adjs.forEach(function (a) {
        html += '<div class="adjust">';
        html += "<strong>" + esc(firstText(a, ["type", "kind", "title"]) || "Adjustment") + "</strong>";
        if (a.createdAt) html += '<div class="entry-time">' + esc(formatDateTime(a.createdAt)) + "</div>";
        html += recordFieldsHtml(a, { id: 1, type: 1, kind: 1, title: 1, createdAt: 1, imageName: 1 });
        html += photoHtml(a.imageData, a.imageName, a.imageName ? "Photo — " + a.imageName : "Photo — adjustment");
        html += "</div>";
      });
    }
    html += "</section>";
    var comments = asArray(tank.comments).slice().sort(function (a, b) {
      return new Date(a && a.createdAt ? a.createdAt : 0) - new Date(b && b.createdAt ? b.createdAt : 0);
    });
    html += '<section class="detail-section"><h3>Comments</h3>';
    if (!comments.length) html += '<p class="muted">None.</p>';
    else {
      comments.forEach(function (c) {
        html += '<div class="comment">';
        html += '<div class="entry-time">' + esc(formatDateTime(c.createdAt)) + "</div>";
        if (text(c.text)) html += "<div>" + nl(c.text) + "</div>";
        html += photoHtml(c.imageData, c.imageName, "Photo — comment");
        html += "</div>";
      });
    }
    html += "</section></article>";
    return html;
  }

  function drbDetail(entry) {
    var html = '<article class="detail"><h2>' + esc(drbMaterialTitle(entry)) + "</h2>";
    html += '<section class="detail-section"><h3>Record</h3>';
    html += fieldsHtml([
      ["Date", formatDate(entry.date) || entry.date],
      ["Type", entry.type],
      ["Classification", entry.classification],
      ["Product", entry.product],
      ["Material", entry.materialName],
      ["Lot", entry.lotNumber],
      ["Supplier", entry.supplier],
      ["Assigned QE", entry.assignedQe],
      ["Issue", entry.issue],
      ["Overall risk", entry.overallRisk],
      ["Justification", entry.justification],
      ["Recommended decision", entry.recommendedDecision],
      ["Material released", !!entry.materialReleased],
    ]);
    var linked = tanksLinkedToDrb(entry);
    if (linked.length) {
      html +=
        '<div class="field" style="margin-top:10px"><div class="k">Linked batches</div>' +
        chipsHtml(
          linked.map(function (tank) {
            return "Tank " + (tank.tankNumber || "—") + (batchProduct(tank) ? " · " + batchProduct(tank) : "");
          })
        ) +
        "</div>";
    }
    html += "</section>";
    var todos = asArray(entry.todos);
    html += '<section class="detail-section"><h3>To-dos</h3>';
    if (!todos.length) html += '<p class="muted">None.</p>';
    else {
      todos.forEach(function (t) {
        html += '<div class="todo-row">' + staticCheck(!!t.done) + "<div>" + nl(t.text) + "</div></div>";
      });
    }
    html += "</section>";
    var atts = asArray(entry.attachments);
    html += '<section class="detail-section"><h3>Attachments</h3>';
    if (!atts.length) html += '<p class="muted">None.</p>';
    else {
      atts.forEach(function (a) {
        html += photoHtml(a.imageData, a.imageName, a.imageName ? "Photo — " + a.imageName : "Photo");
      });
    }
    html += "</section>";
    html += "</article>";
    return html;
  }

  function drbNotesListHtml() {
    var notes = lists().drbNotes;
    if (!notes.length) return "";
    var html = '<section class="detail-section" style="margin-top:12px"><h3>DRB notes</h3>';
    notes.forEach(function (n) {
      html += '<div class="entry">';
      if (n.title) html += "<strong>" + esc(n.title) + "</strong>";
      if (n.createdAt || n.date) html += '<div class="entry-time">' + esc(formatDateTime(n.createdAt || n.date)) + "</div>";
      if (text(n.text || n.note)) html += "<div>" + nl(n.text || n.note) + "</div>";
      html += "</div>";
    });
    html += "</section>";
    return html;
  }

  function renderAll() {
    headerForTab();
    renderBanner();
    renderTabCounts();
    renderSearch();
    if (detailId && currentTab !== "todo") renderDetail();
    else renderList();
  }

  /* —— Photo lightbox with pinch-zoom —— */
  var lb = {
    open: false,
    scale: 1,
    panX: 0,
    panY: 0,
    startScale: 1,
    startPanX: 0,
    startPanY: 0,
    startDist: 0,
    pointers: {},
    pointerCount: 0,
    tapX: 0,
    tapY: 0,
    tapT: 0,
    lastTap: 0,
    swipeY: 0,
  };

  function lbApply() {
    els.lightboxImg.style.transform =
      "translate(-50%, -50%) translate(" + lb.panX + "px," + lb.panY + "px) scale(" + lb.scale + ")";
  }

  function openLightbox(src, alt) {
    els.lightboxImg.src = src;
    els.lightboxImg.alt = alt || "";
    lb.scale = 1;
    lb.panX = 0;
    lb.panY = 0;
    lb.open = true;
    lbApply();
    els.lightbox.hidden = false;
  }

  function closeLightbox() {
    lb.open = false;
    els.lightbox.hidden = true;
    els.lightboxImg.removeAttribute("src");
  }

  function pointerList() {
    return Object.keys(lb.pointers).map(function (k) {
      return lb.pointers[k];
    });
  }

  function dist(a, b) {
    var dx = a.x - b.x;
    var dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function onLbDown(e) {
    if (!lb.open) return;
    e.preventDefault();
    els.lightbox.setPointerCapture(e.pointerId);
    lb.pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    var pts = pointerList();
    if (pts.length === 1) {
      lb.tapX = e.clientX;
      lb.tapY = e.clientY;
      lb.tapT = Date.now();
      lb.startPanX = lb.panX;
      lb.startPanY = lb.panY;
      lb.swipeY = e.clientY;
    } else if (pts.length === 2) {
      lb.startDist = dist(pts[0], pts[1]) || 1;
      lb.startScale = lb.scale;
      lb.startPanX = lb.panX;
      lb.startPanY = lb.panY;
    }
  }

  function onLbMove(e) {
    if (!lb.open || !lb.pointers[e.pointerId]) return;
    e.preventDefault();
    lb.pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    var pts = pointerList();
    if (pts.length >= 2) {
      var d = dist(pts[0], pts[1]) || 1;
      lb.scale = Math.min(6, Math.max(1, lb.startScale * (d / lb.startDist)));
      lbApply();
      return;
    }
    if (pts.length === 1 && lb.scale > 1.02) {
      lb.panX = lb.startPanX + (e.clientX - lb.tapX);
      lb.panY = lb.startPanY + (e.clientY - lb.tapY);
      lbApply();
    }
  }

  function onLbUp(e) {
    if (!lb.open) return;
    var start = lb.pointers[e.pointerId];
    delete lb.pointers[e.pointerId];
    var pts = pointerList();
    if (pts.length === 1) {
      lb.tapX = pts[0].x;
      lb.tapY = pts[0].y;
      lb.startPanX = lb.panX;
      lb.startPanY = lb.panY;
      return;
    }
    if (pts.length > 0) return;
    if (!start) return;
    var dx = e.clientX - lb.tapX;
    var dy = e.clientY - lb.tapY;
    var dt = Date.now() - lb.tapT;
    var moved = Math.sqrt(dx * dx + dy * dy);
    if (lb.scale <= 1.05 && dy > 80 && Math.abs(dy) > Math.abs(dx)) {
      closeLightbox();
      return;
    }
    if (moved < 10 && dt < 350) {
      var now = Date.now();
      if (now - lb.lastTap < 350) {
        lb.lastTap = 0;
        if (lb.scale > 1.1) {
          lb.scale = 1;
          lb.panX = 0;
          lb.panY = 0;
        } else {
          lb.scale = 2.4;
        }
        lbApply();
        return;
      }
      lb.lastTap = now;
      if (lb.scale <= 1.05) closeLightbox();
    }
  }

  function bindLightbox() {
    els.lightbox.addEventListener("pointerdown", onLbDown);
    els.lightbox.addEventListener("pointermove", onLbMove);
    els.lightbox.addEventListener("pointerup", onLbUp);
    els.lightbox.addEventListener("pointercancel", onLbUp);
    els.lightbox.addEventListener("wheel", function (e) {
      if (!lb.open) return;
      e.preventDefault();
      var next = lb.scale * (e.deltaY < 0 ? 1.08 : 0.92);
      lb.scale = Math.min(6, Math.max(1, next));
      if (lb.scale === 1) {
        lb.panX = 0;
        lb.panY = 0;
      }
      lbApply();
    }, { passive: false });
  }

  function onMainClick(e) {
    var openBtn = e.target.closest("[data-open]");
    if (openBtn) {
      var tab = openBtn.getAttribute("data-open-tab");
      if (tab && TAB_LABELS[tab] && tab !== currentTab) {
        returnTab = currentTab === "todo" ? "todo" : null;
        currentTab = tab;
        writeUi();
      }
      detailId = openBtn.getAttribute("data-open");
      renderAll();
      window.scrollTo(0, 0);
      return;
    }
    var img = e.target.closest(".photo img");
    if (img && img.getAttribute("src")) {
      openLightbox(img.getAttribute("src"), img.getAttribute("alt"));
    }
  }

  function setTab(tab) {
    if (!TAB_LABELS[tab]) return;
    currentTab = tab;
    detailId = null;
    returnTab = null;
    writeUi();
    renderAll();
    window.scrollTo(0, 0);
  }

  function bind() {
    els.loadScreen = $("loadScreen");
    els.appShell = $("appShell");
    els.fileInput = $("fileInput");
    els.progress = $("progress");
    els.loadError = $("loadError");
    els.summaryCard = $("summaryCard");
    els.headerTitle = $("headerTitle");
    els.headerSub = $("headerSub");
    els.banner = $("banner");
    els.searchWrap = $("searchWrap");
    els.searchInput = $("searchInput");
    els.backRow = $("backRow");
    els.backToList = $("backToList");
    els.main = $("main");
    els.sheet = $("sheet");
    els.sheetBody = $("sheetBody");
    els.oversize = $("oversize");
    els.oversizeBody = $("oversizeBody");
    els.lightbox = $("lightbox");
    els.lightboxImg = $("lightboxImg");
    els.toast = $("toast");
    els.appVersion = $("appVersion");
    if (els.appVersion) els.appVersion.textContent = "Tracker Viewer v" + APP_VERSION;

    els.fileInput.addEventListener("change", function () {
      var file = els.fileInput.files && els.fileInput.files[0];
      els.fileInput.value = "";
      beginFile(file);
    });

    $("menuBtn").addEventListener("click", openSheet);
    $("sheetClose").addEventListener("click", closeSheet);
    els.sheet.addEventListener("click", function (e) {
      if (e.target === els.sheet) closeSheet();
    });
    $("btnLoadNew").addEventListener("click", function () {
      closeSheet();
      showLoad(false);
      setLoadError("");
    });
    $("btnClearCache").addEventListener("click", function () {
      idbClear()
        .catch(function () {})
        .then(function () {
          snapshot = null;
          detailId = null;
          closeSheet();
          showLoad(false);
          setLoadError("");
          els.summaryCard.hidden = true;
          toast("Cached snapshot cleared");
        });
    });

    $("btnLoadPhotos").addEventListener("click", function () {
      els.oversize.hidden = true;
      if (pendingFile) parseAndLoad(pendingFile, false);
    });
    $("btnLoadText").addEventListener("click", function () {
      els.oversize.hidden = true;
      if (pendingFile) parseAndLoad(pendingFile, true);
    });
    $("btnLoadCancel").addEventListener("click", function () {
      els.oversize.hidden = true;
      pendingFile = null;
    });

    els.searchInput.addEventListener("input", function () {
      searches[currentTab] = els.searchInput.value || "";
      if (!detailId) renderList();
    });
    els.backToList.addEventListener("click", function () {
      if (returnTab) {
        currentTab = returnTab;
        returnTab = null;
        writeUi();
      }
      detailId = null;
      renderAll();
    });
    els.main.addEventListener("click", onMainClick);

    document.querySelectorAll(".nav-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setTab(btn.getAttribute("data-tab"));
      });
    });

    bindLightbox();
  }

  function boot() {
    bind();
    readUi();
    idbGet().then(function (cached) {
      if (cached && cached.data && isTrackerBackup(cached.data)) {
        snapshot = cached;
        showApp();
        return;
      }
      showLoad(false);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
