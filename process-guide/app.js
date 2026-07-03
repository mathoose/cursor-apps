(function () {
  "use strict";

  var STORAGE_KEY = "process-guide-v1";
  var PHOTO_DB = "process-guide-photos-v1";
  var PHOTO_STORE = "photos";
  var EXPORT_FORMAT = "process-guide-processes";
  var PROCESS_STATUSES = ["draft", "published", "archived"];

  var state = { version: 1, processes: [] };
  var selectedProcessId = null;
  var processStatusFilter = "active";
  var expandedPePath = null;
  var processViewMode = "edit";
  var guideStepIndex = 0;
  var guideBranchChoices = {};
  var photoUrlCache = {};
  var photoUrlPending = {};

  function nowISO() {
    return new Date().toISOString();
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  }

  function escapeHtml(s) {
    var d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  function escapeAttr(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  }

  function toast(msg) {
    var el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove("show"); }, 2800);
  }

  function flashSaved() {
    var el = document.getElementById("savedFlash");
    el.classList.add("show");
    clearTimeout(flashSaved._t);
    flashSaved._t = setTimeout(function () { el.classList.remove("show"); }, 1500);
  }

  function formatTime(iso) {
    try {
      return new Date(iso).toLocaleString();
    } catch (e) {
      return iso || "";
    }
  }

  function stepPhotoSlot(stepId) {
    return "step:" + stepId;
  }

  function branchPhotoSlot(forkId, branchId) {
    return "branch:" + forkId + ":" + branchId;
  }

  function photoDbKey(processId, slot) {
    return processId + ":" + slot;
  }

  function photoDomKey(processId, slot) {
    return processId + "|" + slot;
  }

  function openPhotoDb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(PHOTO_DB, 1);
      req.onerror = function () { reject(req.error); };
      req.onsuccess = function () { resolve(req.result); };
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(PHOTO_STORE)) {
          db.createObjectStore(PHOTO_STORE);
        }
      };
    });
  }

  function putPhotoBlob(processId, slot, blob) {
    return openPhotoDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(PHOTO_STORE, "readwrite");
        tx.objectStore(PHOTO_STORE).put(blob, photoDbKey(processId, slot));
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function getPhotoBlob(processId, slot) {
    return openPhotoDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(PHOTO_STORE, "readonly");
        var req = tx.objectStore(PHOTO_STORE).get(photoDbKey(processId, slot));
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function deletePhotoBlob(processId, slot) {
    return openPhotoDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(PHOTO_STORE, "readwrite");
        tx.objectStore(PHOTO_STORE).delete(photoDbKey(processId, slot));
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function clearAllPhotoBlobs() {
    return openPhotoDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(PHOTO_STORE, "readwrite");
        tx.objectStore(PHOTO_STORE).clear();
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function clearImageFlagsFromNodes(nodes) {
    (nodes || []).forEach(function (node) {
      if (!node) return;
      if (node.type === "fork") {
        (node.branches || []).forEach(function (branch) {
          branch.hasImage = false;
          delete branch.imageName;
          clearImageFlagsFromNodes(branch.steps);
        });
      } else {
        node.hasImage = false;
        delete node.imageName;
      }
    });
  }

  function clearAllProcessPhotos() {
    if (!confirm("Clear all step photos from this device?\n\nExport or share processes first if you want to keep images. Steps, forks, and text stay — only photos are removed.")) {
      return;
    }
    var btn = document.getElementById("btnClearPhotos");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Clearing…";
    }
    clearAllPhotoBlobs()
      .then(function () {
        Object.keys(photoUrlCache).forEach(function (k) {
          URL.revokeObjectURL(photoUrlCache[k]);
        });
        photoUrlCache = {};
        photoUrlPending = {};
        (state.processes || []).forEach(function (proc) {
          clearImageFlagsFromNodes(proc.steps);
        });
        return persist();
      })
      .then(function () {
        toast("Photos cleared — processes unchanged");
        renderProcessList();
      })
      .catch(function () {
        toast("Could not clear photos");
      })
      .finally(function () {
        if (btn) {
          btn.disabled = false;
          btn.textContent = "Clear photos";
        }
      });
  }

  function invalidatePhotoUrl(processId, slot) {
    var domKey = photoDomKey(processId, slot);
    if (photoUrlCache[domKey]) {
      URL.revokeObjectURL(photoUrlCache[domKey]);
      delete photoUrlCache[domKey];
    }
    delete photoUrlPending[domKey];
  }

  function getPhotoObjectUrl(processId, slot) {
    var domKey = photoDomKey(processId, slot);
    if (photoUrlCache[domKey]) return Promise.resolve(photoUrlCache[domKey]);
    if (photoUrlPending[domKey]) return photoUrlPending[domKey];
    photoUrlPending[domKey] = getPhotoBlob(processId, slot).then(function (blob) {
      delete photoUrlPending[domKey];
      if (!blob) return null;
      var url = URL.createObjectURL(blob);
      photoUrlCache[domKey] = url;
      return url;
    });
    return photoUrlPending[domKey];
  }

  function hydratePhotos(root) {
    if (!root) return;
    root.querySelectorAll("[data-pe-photo]").forEach(function (img) {
      var key = img.getAttribute("data-pe-photo");
      if (!key) return;
      var sep = key.indexOf("|");
      if (sep < 0) return;
      var processId = key.slice(0, sep);
      var slot = key.slice(sep + 1);
      getPhotoObjectUrl(processId, slot).then(function (url) {
        if (url) img.src = url;
      });
    });
  }

  function dataUrlToBlob(dataUrl) {
    var parts = String(dataUrl).split(",");
    if (parts.length < 2) return null;
    var mimeMatch = parts[0].match(/:(.*?);/);
    var mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
    var bstr = atob(parts[1]);
    var n = bstr.length;
    var u8 = new Uint8Array(n);
    for (var i = 0; i < n; i++) u8[i] = bstr.charCodeAt(i);
    return new Blob([u8], { type: mime });
  }

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsDataURL(blob);
    });
  }

  function walkProcessTree(nodes, pathPrefix, visitor) {
    (nodes || []).forEach(function (node, idx) {
      var path = pathPrefix === "main" ? String(idx) : pathPrefix + "." + idx;
      visitor(node, path);
      if (node.type === "fork") {
        (node.branches || []).forEach(function (branch, bi) {
          visitor(branch, path, { branchIndex: bi, isBranch: true });
          walkProcessTree(branch.steps || [], path + ".b" + bi, visitor);
        });
      }
    });
  }

  function collectLegacyPhotoJobs(parsed) {
    var jobs = [];
    (parsed.processes || []).forEach(function (proc) {
      if (!proc || !proc.id) return;
      walkProcessTree(proc.steps, "main", function (node, path, ctx) {
        if (ctx && ctx.isBranch) {
          if (!node.imageData || String(node.imageData).indexOf("data:") !== 0) return;
          var blob = dataUrlToBlob(node.imageData);
          if (!blob) return;
          var forkCtx = getNodeContext(proc, path);
          var forkId = forkCtx && forkCtx.node ? forkCtx.node.id : path;
          var slot = branchPhotoSlot(forkId, node.id);
          jobs.push(putPhotoBlob(proc.id, slot, blob).then(function () {
            node.hasImage = true;
            delete node.imageData;
          }));
          return;
        }
        if (node.type === "fork") return;
        if (!node.imageData || String(node.imageData).indexOf("data:") !== 0) return;
        var stepBlob = dataUrlToBlob(node.imageData);
        if (!stepBlob) return;
        jobs.push(putPhotoBlob(proc.id, stepPhotoSlot(node.id), stepBlob).then(function () {
          node.hasImage = true;
          delete node.imageData;
        }));
      });
    });
    return jobs;
  }

  function migrateLegacyPhotos(parsed) {
    var jobs = collectLegacyPhotoJobs(parsed);
    if (!jobs.length) return Promise.resolve(false);
    return Promise.all(jobs).then(function () { return true; });
  }

  function deleteAllProcessPhotos(processId) {
    return openPhotoDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(PHOTO_STORE, "readwrite");
        var store = tx.objectStore(PHOTO_STORE);
        var req = store.getAllKeys();
        req.onsuccess = function () {
          var prefix = processId + ":";
          (req.result || []).forEach(function (key) {
            if (String(key).indexOf(prefix) === 0) {
              store.delete(key);
              var slot = String(key).slice(prefix.length);
              invalidatePhotoUrl(processId, slot);
            }
          });
        };
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function embedPhotosForExport(processes) {
    var jobs = [];
    (processes || []).forEach(function (proc) {
      if (!proc || !proc.id) return;
      walkProcessTree(proc.steps, "main", function (node, path, ctx) {
        if (ctx && ctx.isBranch) {
          if (!node.hasImage) return;
          var forkCtx = getNodeContext(proc, path);
          var forkId = forkCtx && forkCtx.node ? forkCtx.node.id : path;
          jobs.push(getPhotoBlob(proc.id, branchPhotoSlot(forkId, node.id)).then(function (blob) {
            if (!blob) return;
            return blobToDataUrl(blob).then(function (dataUrl) {
              node.imageData = dataUrl;
            });
          }));
          return;
        }
        if (node.type === "fork" || !node.hasImage) return;
        jobs.push(getPhotoBlob(proc.id, stepPhotoSlot(node.id)).then(function (blob) {
          if (!blob) return;
          return blobToDataUrl(blob).then(function (dataUrl) {
            node.imageData = dataUrl;
          });
        }));
      });
    });
    return Promise.all(jobs);
  }

  function importPhotosFromProcesses(processes) {
    var jobs = collectLegacyPhotoJobs({ processes: processes });
    return Promise.all(jobs);
  }

  function defaultState() {
    return { version: 1, processes: [] };
  }

  function normalizeProcessStep(s) {
    var legacyImage = String(s.imageData != null ? s.imageData : "").trim();
    return {
      type: "step",
      id: s.id || uid(),
      title: String(s.title != null ? s.title : "").trim(),
      body: String(s.body != null ? s.body : "").trim(),
      caution: String(s.caution != null ? s.caution : "").trim(),
      hasImage: !!(s.hasImage || legacyImage.indexOf("data:") === 0),
      imageName: String(s.imageName != null ? s.imageName : "").trim(),
      createdAt: s.createdAt || nowISO(),
      updatedAt: s.updatedAt || s.createdAt || nowISO(),
    };
  }

  function normalizeProcessBranch(b) {
    var legacyImage = String(b.imageData != null ? b.imageData : "").trim();
    return {
      id: b.id || uid(),
      label: String(b.label != null ? b.label : "Branch").trim() || "Branch",
      whenToUse: String(b.whenToUse != null ? b.whenToUse : "").trim(),
      hasImage: !!(b.hasImage || legacyImage.indexOf("data:") === 0),
      imageName: String(b.imageName != null ? b.imageName : "").trim(),
      steps: Array.isArray(b.steps) ? b.steps.map(normalizeProcessNode) : [],
    };
  }

  function normalizeProcessFork(f) {
    var branches = Array.isArray(f.branches) ? f.branches.map(normalizeProcessBranch) : [];
    while (branches.length < 2) {
      branches.push(
        normalizeProcessBranch({
          id: uid(),
          label: branches.length === 0 ? "Branch A" : "Branch B",
          whenToUse: "",
          steps: [],
        })
      );
    }
    return {
      type: "fork",
      id: f.id || uid(),
      title: String(f.title != null ? f.title : "Decision point").trim() || "Decision point",
      prompt: String(f.prompt != null ? f.prompt : f.title != null ? f.title : "").trim() || "Choose a path",
      branches: branches,
      mergeNote: String(f.mergeNote != null ? f.mergeNote : "").trim(),
      createdAt: f.createdAt || nowISO(),
      updatedAt: f.updatedAt || f.createdAt || nowISO(),
    };
  }

  function normalizeProcessNode(n) {
    if (!n || typeof n !== "object") return normalizeProcessStep({});
    if (n.type === "fork") return normalizeProcessFork(n);
    return normalizeProcessStep(n);
  }

  function normalizeProcess(p) {
    var status = PROCESS_STATUSES.indexOf(p.status) >= 0 ? p.status : "draft";
    return {
      id: p.id || uid(),
      title: String(p.title != null ? p.title : "Untitled process").trim() || "Untitled process",
      summary: String(p.summary != null ? p.summary : "").trim(),
      status: status,
      version: Math.max(1, parseInt(p.version, 10) || 1),
      tags: Array.isArray(p.tags) ? p.tags.map(function (t) { return String(t).trim(); }).filter(Boolean) : [],
      steps: Array.isArray(p.steps) ? p.steps.map(normalizeProcessNode) : [],
      createdAt: p.createdAt || nowISO(),
      updatedAt: p.updatedAt || nowISO(),
    };
  }

  function normalizeState(raw) {
    var st = raw && typeof raw === "object" ? raw : defaultState();
    st.version = 1;
    st.processes = Array.isArray(st.processes) ? st.processes.map(normalizeProcess) : [];
    return st;
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return Promise.resolve(defaultState());
      var parsed = JSON.parse(raw);
      return migrateLegacyPhotos(parsed).then(function (migrated) {
        var st = normalizeState(parsed);
        if (migrated) {
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(st));
          } catch (e) { /* ignore */ }
        }
        return st;
      });
    } catch (e) {
      return Promise.resolve(defaultState());
    }
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      flashSaved();
    } catch (e) {
      toast("Could not save — storage may be full");
    }
  }

  function walkProcessNodes(nodes, callback, ctx) {
    ctx = ctx || {};
    (nodes || []).forEach(function (node, index) {
      callback(node, Object.assign({}, ctx, { index: index, nodes: nodes }));
      if (node.type === "fork") {
        (node.branches || []).forEach(function (branch, branchIndex) {
          walkProcessNodes(branch.steps || [], callback, Object.assign({}, ctx, {
            branchIndex: branchIndex,
            branchLabel: branch.label,
            whenToUse: branch.whenToUse,
            imageName: branch.imageName,
          }));
        });
      }
    });
  }

  function reassignNodeIds(node) {
    if (node.type === "fork") {
      node.id = uid();
      (node.branches || []).forEach(function (br) {
        br.id = uid();
        (br.steps || []).forEach(reassignNodeIds);
      });
    } else {
      node.id = uid();
    }
  }

  function cloneProcessWithNewId(proc) {
    var copy = JSON.parse(JSON.stringify(proc));
    copy.id = uid();
    copy.createdAt = nowISO();
    copy.updatedAt = nowISO();
    (copy.steps || []).forEach(reassignNodeIds);
    return normalizeProcess(copy);
  }

  function getProcess(id) {
    return state.processes.find(function (p) { return p.id === id; });
  }

  function resolveStepsContainer(process, containerPath) {
    if (!containerPath || containerPath === "main") return process.steps;
    var parts = String(containerPath).split(".");
    var nodes = process.steps;
    var i = 0;
    while (i < parts.length) {
      var idx = parseInt(parts[i], 10);
      if (isNaN(idx) || idx < 0 || idx >= nodes.length) return null;
      var node = nodes[idx];
      i++;
      if (i >= parts.length) return null;
      if (!parts[i].startsWith("b")) return null;
      var bi = parseInt(parts[i].slice(1), 10);
      if (!node || node.type !== "fork" || !node.branches[bi]) return null;
      nodes = node.branches[bi].steps;
      i++;
    }
    return nodes;
  }

  function getNodeContext(process, path) {
    if (path === null || path === undefined || path === "") return null;
    var parts = String(path).split(".");
    var nodes = process.steps;
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (p.startsWith("b")) return null;
      var idx = parseInt(p, 10);
      if (isNaN(idx) || idx < 0 || idx >= nodes.length) return null;
      var node = nodes[idx];
      if (i === parts.length - 1) return { nodes: nodes, index: idx, node: node };
      var next = parts[i + 1];
      if (!next || !next.startsWith("b") || node.type !== "fork") return null;
      var bi = parseInt(next.slice(1), 10);
      if (isNaN(bi) || bi < 0 || bi >= node.branches.length) return null;
      nodes = node.branches[bi].steps;
      i++;
    }
    return null;
  }

  function countProcessSteps(process) {
    var n = 0;
    walkProcessNodes(process.steps || [], function (node) {
      if (node.type === "step") n++;
    });
    return n;
  }

  function processStatusLabel(status) {
    if (status === "published") return "Published";
    if (status === "archived") return "Archived";
    return "Draft";
  }

  function processStatusBadge(status) {
    if (status === "published") return "process-published";
    if (status === "archived") return "process-archived";
    return "process-draft";
  }

  function processSearchBlob(proc) {
    var parts = [proc.title, proc.summary, proc.status].concat(proc.tags || []);
    walkProcessNodes(proc.steps || [], function (node, ctx) {
      if (node.type === "fork") {
        parts.push(node.title, node.prompt, node.mergeNote);
        if (ctx.branchLabel) parts.push(ctx.branchLabel, ctx.whenToUse, ctx.imageName);
      } else {
        parts.push(node.title, node.body, node.caution, node.imageName);
      }
    });
    return parts.join(" ").toLowerCase();
  }

  function getFilteredProcesses() {
    var q = String(document.getElementById("processSearch").value || "").trim().toLowerCase();
    var list = state.processes.slice();
    if (processStatusFilter === "published") list = list.filter(function (p) { return p.status === "published"; });
    else if (processStatusFilter === "draft") list = list.filter(function (p) { return p.status === "draft"; });
    else if (processStatusFilter === "active") list = list.filter(function (p) { return p.status === "published" || p.status === "draft"; });
    else if (processStatusFilter === "archived") list = list.filter(function (p) { return p.status === "archived"; });
    if (q) list = list.filter(function (p) { return processSearchBlob(p).includes(q); });
    return list.sort(function (a, b) { return new Date(b.updatedAt) - new Date(a.updatedAt); });
  }

  function buildGuideSequence(process, branchChoices) {
    var sequence = [];
    function walk(nodes) {
      (nodes || []).forEach(function (node) {
        if (node.type === "fork") {
          sequence.push({ kind: "fork", node: node });
          var branchId = branchChoices[node.id];
          if (branchId) {
            var branch = node.branches.find(function (b) { return b.id === branchId; });
            if (branch) walk(branch.steps || []);
          }
        } else {
          sequence.push({ kind: "step", node: node });
        }
      });
    }
    walk(process.steps || []);
    return sequence;
  }

  function newProcessStep() {
    var ts = nowISO();
    return normalizeProcessStep({ id: uid(), title: "", body: "", createdAt: ts, updatedAt: ts });
  }

  function newProcessFork() {
    var ts = nowISO();
    return normalizeProcessFork({
      id: uid(),
      title: "Decision point",
      prompt: "Choose a path",
      branches: [
        { id: uid(), label: "Branch A", whenToUse: "", steps: [] },
        { id: uid(), label: "Branch B", whenToUse: "", steps: [] },
      ],
      createdAt: ts,
      updatedAt: ts,
    });
  }

  function addProcessNode(process, containerPath, node) {
    var arr = resolveStepsContainer(process, containerPath);
    if (!arr) return;
    arr.push(node);
    process.updatedAt = nowISO();
  }

  function moveProcessNode(process, path, dir) {
    var ctx = getNodeContext(process, path);
    if (!ctx) return;
    var newIdx = ctx.index + dir;
    if (newIdx < 0 || newIdx >= ctx.nodes.length) return;
    var tmp = ctx.nodes[ctx.index];
    ctx.nodes[ctx.index] = ctx.nodes[newIdx];
    ctx.nodes[newIdx] = tmp;
    process.updatedAt = nowISO();
  }

  function deleteProcessNode(process, path) {
    var ctx = getNodeContext(process, path);
    if (!ctx) return;
    if (ctx.node.type === "step" && ctx.node.hasImage) {
      deletePhotoBlob(process.id, stepPhotoSlot(ctx.node.id));
      invalidatePhotoUrl(process.id, stepPhotoSlot(ctx.node.id));
    }
    ctx.nodes.splice(ctx.index, 1);
    process.updatedAt = nowISO();
    if (expandedPePath === path) expandedPePath = null;
  }

  function stepPreview(node) {
    if (node.type === "fork") return node.prompt || node.title || "Decision";
    var t = node.title || node.body || "";
    return t.length > 60 ? t.slice(0, 57) + "…" : t || "(untitled step)";
  }

  function compressImageFile(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var img = new Image();
        img.onload = function () {
          var maxW = 1600;
          var w = img.width;
          var h = img.height;
          if (w > maxW) {
            h = Math.round((h * maxW) / w);
            w = maxW;
          }
          var canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          canvas.getContext("2d").drawImage(img, 0, 0, w, h);
          canvas.toBlob(function (blob) {
            if (blob) resolve(blob);
            else reject(new Error("Could not compress image"));
          }, "image/jpeg", 0.82);
        };
        img.onerror = function () { reject(new Error("Could not load image")); };
        img.src = reader.result;
      };
      reader.onerror = function () { reject(new Error("Could not read file")); };
      reader.readAsDataURL(file);
    });
  }

  function photoAttr(processId, slot) {
    return escapeAttr(photoDomKey(processId, slot));
  }

  function renderBranchStepsHtml(process, branch, branchPath, numCtx) {
    var steps = branch.steps || [];
    if (!steps.length) {
      return '<p class="pe-branch-empty">No steps on this path yet.</p>';
    }
    return '<div class="pe-branch-steps">' + renderStepsListHtml(process, steps, branchPath, numCtx) + "</div>";
  }

  function renderForkOptionHtml(process, node, path, branch, bi, forkNum) {
    var letter = String.fromCharCode(65 + bi);
    var imgHtml = branch.hasImage
      ? '<img class="pe-fork-option-img" alt="' + escapeAttr(branch.imageName || letter) + '" data-pe-branch-img="' + escapeAttr(path) + '" data-pe-branch-idx="' + bi + '" data-pe-photo="' + photoAttr(process.id, branchPhotoSlot(node.id, branch.id)) + '" />'
      : '<div class="pe-fork-option-img-placeholder project-paste-zone" data-pe-branch-paste="' + escapeAttr(path) + '" data-pe-branch-idx="' + bi + '" tabindex="0">' +
        '<span class="pe-fork-option-add">+ Photo</span></div>';
    return '<div class="pe-fork-option" data-pe-branch="' + bi + '">' +
      '<div class="pe-fork-option-letter">' + letter + "</div>" +
      imgHtml +
      '<input type="text" class="pe-fork-option-label" data-pe-branch-label="' + bi + '" value="' + escapeAttr(branch.label) + '" placeholder="Option ' + letter + '" />' +
      '<textarea class="pe-fork-option-desc" data-pe-branch-when="' + bi + '" rows="2" placeholder="Description">' + escapeHtml(branch.whenToUse) + "</textarea>" +
      (branch.hasImage ? '<button type="button" class="ghost danger pe-fork-option-clear" data-pe-clear-branch-img="' + escapeAttr(path) + '" data-pe-branch-idx="' + bi + '">Remove photo</button>' : "") +
      '<div class="pe-branch-actions">' +
      '<button type="button" class="ghost" data-pe-add-step="' + escapeAttr(path + ".b" + bi) + '">+ Step</button>' +
      "</div>" +
      renderBranchStepsHtml(process, branch, path + ".b" + bi, { forkNum: forkNum, letter: letter, subNum: 0 }) +
      "</div>";
  }

  function renderForkCardHtml(process, node, path, numCtx) {
    var spineNum = numCtx.spineNum || 0;
    if (!numCtx.letter) spineNum++;
    var forkLabel = numCtx.letter ? numCtx.forkNum + numCtx.letter + " ◆" : spineNum + " ◆";
    numCtx.spineNum = spineNum;
    var branches = (node.branches || []).slice(0, 2);
    var optionsHtml = branches.map(function (br, bi) {
      return renderForkOptionHtml(process, node, path, br, bi, spineNum);
    }).join("");
    return '<div class="pe-fork-card" data-pe-path="' + escapeAttr(path) + '">' +
      '<div class="pe-step-card-head">' +
      '<span class="pe-num pe-fork-num">' + escapeHtml(forkLabel) + "</span>" +
      '<span class="pe-card-type">Fork</span>' +
      '<div class="pe-row-actions">' +
      '<button type="button" class="ghost" data-pe-up="' + escapeAttr(path) + '">Up</button>' +
      '<button type="button" class="ghost" data-pe-down="' + escapeAttr(path) + '">Down</button>' +
      '<button type="button" class="ghost danger" data-pe-del="' + escapeAttr(path) + '">Delete</button>' +
      "</div></div>" +
      '<div class="pe-fork-editor" data-pe-fork-editor="' + escapeAttr(path) + '">' +
      '<input type="text" class="pe-fork-prompt" data-pe-fork-field="prompt" value="' + escapeAttr(node.prompt || node.title) + '" placeholder="What choice is this?" />' +
      '<div class="pe-fork-options">' + optionsHtml + "</div>" +
      "</div></div>";
  }

  function renderStepsListHtml(process, nodes, pathPrefix, numCtx) {
    var html = "";
    var spineNum = numCtx.spineNum || 0;
    (nodes || []).forEach(function (node, idx) {
      var path = pathPrefix === "main" ? String(idx) : pathPrefix + "." + idx;
      var isExpanded = expandedPePath === path;
      if (node.type === "fork") {
        html += renderForkCardHtml(process, node, path, numCtx);
      } else {
        var label;
        if (numCtx.letter) {
          numCtx.subNum = (numCtx.subNum || 0) + 1;
          label = numCtx.forkNum + numCtx.letter + "." + numCtx.subNum;
        } else {
          spineNum++;
          label = String(spineNum);
          numCtx.spineNum = spineNum;
        }
        html += '<div class="pe-step-card' + (isExpanded ? " expanded" : "") + '" data-pe-path="' + escapeAttr(path) + '">' +
          '<div class="pe-step-card-head">' +
          '<span class="pe-num">' + escapeHtml(label) + "</span>" +
          '<span class="pe-step-card-title">' + escapeHtml(node.title || "(untitled step)") + "</span>" +
          (node.hasImage ? '<span class="pe-has-photo" title="Has photo">📷</span>' : "") +
          '<div class="pe-row-actions">' +
          '<button type="button" class="ghost" data-pe-expand="' + escapeAttr(path) + '">' + (isExpanded ? "Close" : "Edit") + "</button>" +
          '<button type="button" class="ghost" data-pe-up="' + escapeAttr(path) + '">Up</button>' +
          '<button type="button" class="ghost" data-pe-down="' + escapeAttr(path) + '">Down</button>' +
          '<button type="button" class="ghost danger" data-pe-del="' + escapeAttr(path) + '">Delete</button>' +
          "</div></div>" +
          (isExpanded ? renderStepEditorHtml(process, node, path) : "") +
          "</div>";
      }
    });
    return html;
  }

  function renderStepEditorHtml(process, node, path) {
    return '<div class="pe-step-editor" data-pe-editor="' + escapeAttr(path) + '">' +
      "<label>Step title</label>" +
      '<input type="text" data-pe-field="title" value="' + escapeAttr(node.title) + '" placeholder="Short action label" />' +
      "<label>Instructions</label>" +
      '<textarea data-pe-field="body" rows="4" placeholder="What to do, where to click, what to verify…">' + escapeHtml(node.body) + "</textarea>" +
      "<label>Caution (optional)</label>" +
      '<input type="text" data-pe-field="caution" value="' + escapeAttr(node.caution) + '" placeholder="Safety or quality warning" />' +
      '<div class="project-paste-zone" data-pe-paste="' + escapeAttr(path) + '" tabindex="0" style="margin-top:0.65rem">' +
      "Tap to add a photo (gallery, camera, or paste)</div>" +
      (node.hasImage ? '<img alt="' + escapeAttr(node.imageName || "Step") + '" data-pe-img="' + escapeAttr(path) + '" data-pe-photo="' + photoAttr(process.id, stepPhotoSlot(node.id)) + '" />' : "") +
      '<div class="btn-row" style="margin-top:0.5rem">' +
      '<button type="button" class="primary" data-pe-save-step="' + escapeAttr(path) + '">Save step</button>' +
      (node.hasImage ? '<button type="button" class="ghost danger" data-pe-clear-img="' + escapeAttr(path) + '">Remove image</button>' : "") +
      "</div></div>";
  }

  function saveForkFields(process, path, editor) {
    var ctx = getNodeContext(process, path);
    if (!ctx || ctx.node.type !== "fork") return;
    var promptEl = editor.querySelector('[data-pe-fork-field="prompt"]');
    if (promptEl) {
      ctx.node.prompt = promptEl.value.trim() || "Choose a path";
      ctx.node.title = ctx.node.prompt;
    }
    ctx.node.branches.slice(0, 2).forEach(function (br, bi) {
      var labelEl = editor.querySelector('[data-pe-branch-label="' + bi + '"]');
      var whenEl = editor.querySelector('[data-pe-branch-when="' + bi + '"]');
      if (labelEl) br.label = labelEl.value.trim() || "Option " + String.fromCharCode(65 + bi);
      if (whenEl) br.whenToUse = whenEl.value.trim();
    });
    ctx.node.updatedAt = nowISO();
    process.updatedAt = nowISO();
    persist();
    renderProcessList();
  }

  function applyImageToNode(process, node, blob, name) {
    return putPhotoBlob(process.id, stepPhotoSlot(node.id), blob).then(function () {
      node.hasImage = true;
      node.imageName = name || "photo.jpg";
      node.updatedAt = nowISO();
      invalidatePhotoUrl(process.id, stepPhotoSlot(node.id));
    });
  }

  function applyImageToBranch(process, forkNode, branch, blob, name) {
    return putPhotoBlob(process.id, branchPhotoSlot(forkNode.id, branch.id), blob).then(function () {
      branch.hasImage = true;
      branch.imageName = name || "photo.jpg";
      invalidatePhotoUrl(process.id, branchPhotoSlot(forkNode.id, branch.id));
    });
  }

  function handleImageFile(process, file, onApply) {
    compressImageFile(file).then(function (blob) {
      return onApply(blob, file.name || "photo.jpg");
    }).then(function () {
      process.updatedAt = nowISO();
      persist();
      renderProcessDetail(process);
      renderProcessList();
    }).catch(function () { toast("Could not add image"); });
  }

  function bindProcessDetailEvents(process) {
    var pane = document.getElementById("processDetailPane");

    pane.querySelectorAll("[data-pe-expand]").forEach(function (btn) {
      btn.onclick = function (e) {
        e.stopPropagation();
        expandedPePath = expandedPePath === btn.dataset.peExpand ? null : btn.dataset.peExpand;
        renderProcessDetail(process);
      };
    });

    pane.querySelectorAll("[data-pe-up]").forEach(function (btn) {
      btn.onclick = function (e) {
        e.stopPropagation();
        moveProcessNode(process, btn.dataset.peUp, -1);
        persist();
        renderProcessDetail(process);
        renderProcessList();
      };
    });

    pane.querySelectorAll("[data-pe-down]").forEach(function (btn) {
      btn.onclick = function (e) {
        e.stopPropagation();
        moveProcessNode(process, btn.dataset.peDown, 1);
        persist();
        renderProcessDetail(process);
        renderProcessList();
      };
    });

    pane.querySelectorAll("[data-pe-del]").forEach(function (btn) {
      btn.onclick = function (e) {
        e.stopPropagation();
        var ctx = getNodeContext(process, btn.dataset.peDel);
        var label = ctx && ctx.node && ctx.node.type === "fork" ? "fork and all branch steps" : "this step";
        if (!confirm("Delete " + label + "?")) return;
        deleteProcessNode(process, btn.dataset.peDel);
        persist();
        renderProcessDetail(process);
        renderProcessList();
      };
    });

    pane.querySelectorAll("[data-pe-add-step]").forEach(function (btn) {
      btn.onclick = function () {
        addProcessNode(process, btn.dataset.peAddStep, newProcessStep());
        persist();
        var arr = resolveStepsContainer(process, btn.dataset.peAddStep);
        expandedPePath = btn.dataset.peAddStep === "main" ? String(arr.length - 1) : btn.dataset.peAddStep + "." + (arr.length - 1);
        renderProcessDetail(process);
        renderProcessList();
      };
    });

    pane.querySelectorAll("[data-pe-add-fork]").forEach(function (btn) {
      btn.onclick = function () {
        addProcessNode(process, btn.dataset.peAddFork, newProcessFork());
        persist();
        renderProcessDetail(process);
        renderProcessList();
      };
    });

    pane.querySelectorAll("[data-pe-fork-editor]").forEach(function (editor) {
      var path = editor.dataset.peForkEditor;
      editor.querySelectorAll("[data-pe-fork-field], [data-pe-branch-label], [data-pe-branch-when]").forEach(function (field) {
        field.onchange = function () { saveForkFields(process, path, editor); };
        field.onblur = function () { saveForkFields(process, path, editor); };
      });
    });

    pane.querySelectorAll("[data-pe-save-step]").forEach(function (btn) {
      btn.onclick = function () {
        var ctx = getNodeContext(process, btn.dataset.peSaveStep);
        if (!ctx || ctx.node.type !== "step") return;
        var editor = pane.querySelector('[data-pe-editor="' + btn.dataset.peSaveStep + '"]');
        ctx.node.title = editor.querySelector('[data-pe-field="title"]').value.trim();
        ctx.node.body = editor.querySelector('[data-pe-field="body"]').value.trim();
        ctx.node.caution = editor.querySelector('[data-pe-field="caution"]').value.trim();
        ctx.node.updatedAt = nowISO();
        process.updatedAt = nowISO();
        persist();
        renderProcessDetail(process);
        renderProcessList();
      };
    });

    pane.querySelectorAll("[data-pe-clear-img]").forEach(function (btn) {
      btn.onclick = function () {
        var ctx = getNodeContext(process, btn.dataset.peClearImg);
        if (!ctx || ctx.node.type !== "step") return;
        var slot = stepPhotoSlot(ctx.node.id);
        deletePhotoBlob(process.id, slot).then(function () {
          invalidatePhotoUrl(process.id, slot);
          ctx.node.hasImage = false;
          ctx.node.imageName = "";
          ctx.node.updatedAt = nowISO();
          process.updatedAt = nowISO();
          persist();
          renderProcessDetail(process);
        });
      };
    });

    pane.querySelectorAll("[data-pe-clear-branch-img]").forEach(function (btn) {
      btn.onclick = function () {
        var ctx = getNodeContext(process, btn.dataset.peClearBranchImg);
        if (!ctx || ctx.node.type !== "fork") return;
        var bi = parseInt(btn.dataset.peBranchIdx, 10);
        var branch = ctx.node.branches[bi];
        if (!branch) return;
        var slot = branchPhotoSlot(ctx.node.id, branch.id);
        deletePhotoBlob(process.id, slot).then(function () {
          invalidatePhotoUrl(process.id, slot);
          branch.hasImage = false;
          branch.imageName = "";
          ctx.node.updatedAt = nowISO();
          process.updatedAt = nowISO();
          persist();
          renderProcessDetail(process);
        });
      };
    });

    pane.querySelectorAll("[data-pe-paste]").forEach(function (zone) {
      var path = zone.dataset.pePaste;
      zone.onclick = function () {
        zone.focus();
        if (typeof AppsPhotoPicker === "undefined") return;
        AppsPhotoPicker.prompt({
          title: "Add step photo",
          multiple: false,
          onFiles: function (files) {
            if (!files.length) return;
            var ctx = getNodeContext(process, path);
            if (!ctx || ctx.node.type !== "step") return;
            handleImageFile(process, files[0], function (blob, name) {
              return applyImageToNode(process, ctx.node, blob, name);
            });
          },
        });
      };
      zone.onpaste = function (e) {
        var items = e.clipboardData && e.clipboardData.items;
        if (!items) return;
        for (var i = 0; i < items.length; i++) {
          if (items[i].type.indexOf("image/") === 0) {
            e.preventDefault();
            var file = items[i].getAsFile();
            if (!file) return;
            var ctx = getNodeContext(process, path);
            if (!ctx || ctx.node.type !== "step") return;
            handleImageFile(process, file, function (blob, name) {
              return applyImageToNode(process, ctx.node, blob, name);
            });
            return;
          }
        }
      };
    });

    pane.querySelectorAll("[data-pe-branch-paste]").forEach(function (zone) {
      var path = zone.dataset.peBranchPaste;
      var bi = parseInt(zone.dataset.peBranchIdx, 10);
      zone.onclick = function () {
        zone.focus();
        if (typeof AppsPhotoPicker === "undefined") return;
        AppsPhotoPicker.prompt({
          title: "Add option photo",
          multiple: false,
          onFiles: function (files) {
            if (!files.length) return;
            var ctx = getNodeContext(process, path);
            if (!ctx || ctx.node.type !== "fork") return;
            var branch = ctx.node.branches[bi];
            if (!branch) return;
            handleImageFile(process, files[0], function (blob, name) {
              return applyImageToBranch(process, ctx.node, branch, blob, name).then(function () {
                ctx.node.updatedAt = nowISO();
              });
            });
          },
        });
      };
      zone.onpaste = function (e) {
        var items = e.clipboardData && e.clipboardData.items;
        if (!items) return;
        for (var i = 0; i < items.length; i++) {
          if (items[i].type.indexOf("image/") === 0) {
            e.preventDefault();
            var file = items[i].getAsFile();
            if (!file) return;
            var ctx = getNodeContext(process, path);
            if (!ctx || ctx.node.type !== "fork") return;
            var branch = ctx.node.branches[bi];
            if (!branch) return;
            handleImageFile(process, file, function (blob, name) {
              return applyImageToBranch(process, ctx.node, branch, blob, name).then(function () {
                ctx.node.updatedAt = nowISO();
              });
            });
            return;
          }
        }
      };
    });

    hydratePhotos(pane);

    pane.querySelectorAll("[data-pe-img], [data-pe-branch-img]").forEach(function (img) {
      img.onclick = function () {
        var w = window.open("");
        if (w) w.document.write('<img src="' + img.src + '" style="max-width:100%" />');
      };
    });
  }

  function renderGuideView(process) {
    var pane = document.getElementById("processDetailPane");
    var sequence = buildGuideSequence(process, guideBranchChoices);
    var atFork = sequence[guideStepIndex] && sequence[guideStepIndex].kind === "fork";
    var forkNode = atFork ? sequence[guideStepIndex].node : null;
    var chosenBranch = forkNode ? guideBranchChoices[forkNode.id] : null;
    var bodyHtml = "";

    if (atFork && !chosenBranch) {
      var picks = (forkNode.branches || []).slice(0, 2).map(function (br) {
        return '<button type="button" class="pe-fork-pick-btn" data-pe-guide-branch="' + escapeAttr(br.id) + '">' +
          (br.hasImage ? '<img class="pe-fork-pick-img" alt="' + escapeAttr(br.imageName || br.label) + '" data-pe-photo="' + photoAttr(process.id, branchPhotoSlot(forkNode.id, br.id)) + '" />' : "") +
          "<strong>" + escapeHtml(br.label) + "</strong>" +
          (br.whenToUse ? '<div class="when">' + escapeHtml(br.whenToUse) + "</div>" : "") +
          "</button>";
      }).join("");
      bodyHtml = '<div class="pe-guide-panel">' +
        (process.status === "draft" ? '<div class="pe-draft-banner">Draft — verify before relying on this.</div>' : "") +
        '<div class="pe-guide-progress">Decision point</div>' +
        "<h3>" + escapeHtml(forkNode.prompt || forkNode.title) + "</h3>" +
        (forkNode.mergeNote ? '<p class="hint">' + escapeHtml(forkNode.mergeNote) + "</p>" : "") +
        '<div class="pe-fork-pick">' + picks + "</div></div>";
    } else {
      var stepItems = sequence.filter(function (s) { return s.kind === "step"; });
      var currentStepItem = sequence[guideStepIndex];
      var stepNode = currentStepItem && currentStepItem.kind === "step" ? currentStepItem.node : null;
      var stepNum = stepItems.findIndex(function (s) { return s.node.id === (stepNode && stepNode.id); }) + 1;
      bodyHtml = stepNode
        ? '<div class="pe-guide-panel">' +
          (process.status === "draft" ? '<div class="pe-draft-banner">Draft — verify before relying on this.</div>' : "") +
          '<div class="pe-guide-progress">Step ' + stepNum + " of " + stepItems.length + "</div>" +
          "<h3>" + escapeHtml(stepNode.title || "(untitled step)") + "</h3>" +
          (stepNode.caution ? '<div class="pe-guide-caution">' + escapeHtml(stepNode.caution) + "</div>" : "") +
          (stepNode.hasImage ? '<img alt="' + escapeAttr(stepNode.imageName || "") + '" data-pe-photo="' + photoAttr(process.id, stepPhotoSlot(stepNode.id)) + '" />' : "") +
          '<div class="pe-guide-body">' + escapeHtml(stepNode.body || "") + "</div>" +
          '<div class="btn-row">' +
          '<button type="button" class="ghost" id="btnGuidePrev"' + (guideStepIndex <= 0 ? " disabled" : "") + ">Back</button>" +
          '<button type="button" class="primary" id="btnGuideNext">' + (guideStepIndex >= sequence.length - 1 ? "Finish" : "Next") + "</button>" +
          "</div></div>"
        : '<p class="empty">No steps yet. Switch to Edit mode to add steps.</p>';
    }

    var mount = pane.querySelector("#peGuideMount");
    if (mount) mount.innerHTML = bodyHtml;

    hydratePhotos(pane);

    pane.querySelectorAll("[data-pe-guide-branch]").forEach(function (btn) {
      btn.onclick = function () {
        guideBranchChoices[forkNode.id] = btn.dataset.peGuideBranch;
        guideStepIndex++;
        renderProcessDetail(process);
      };
    });

    var prevBtn = pane.querySelector("#btnGuidePrev");
    if (prevBtn) {
      prevBtn.onclick = function () {
        if (guideStepIndex <= 0) return;
        guideStepIndex--;
        var seq = buildGuideSequence(process, guideBranchChoices);
        var item = seq[guideStepIndex];
        if (item && item.kind === "fork" && item.node) delete guideBranchChoices[item.node.id];
        renderProcessDetail(process);
      };
    }

    var nextBtn = pane.querySelector("#btnGuideNext");
    if (nextBtn) {
      nextBtn.onclick = function () {
        var seq = buildGuideSequence(process, guideBranchChoices);
        if (guideStepIndex >= seq.length - 1) {
          toast("End of procedure");
          return;
        }
        guideStepIndex++;
        renderProcessDetail(process);
      };
    }

    pane.querySelectorAll(".pe-guide-panel img").forEach(function (img) {
      img.onclick = function () {
        var w = window.open("");
        if (w) w.document.write('<img src="' + img.src + '" style="max-width:100%" />');
      };
    });
  }

  function exportSingleProcess(process) {
    var copy = JSON.parse(JSON.stringify(process));
    embedPhotosForExport([copy]).then(function () {
      var payload = {
        format: EXPORT_FORMAT,
        version: 1,
        exportedAt: nowISO(),
        processes: [copy],
      };
      var slug = (process.title || "process").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "process";
      var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "process-" + slug + ".json";
      a.click();
      URL.revokeObjectURL(a.href);
      toast("Exported \"" + process.title + "\"");
    }).catch(function () {
      toast("Export failed");
    });
  }

  function renderProcessDetail(process) {
    var pane = document.getElementById("processDetailPane");
    if (!process) {
      pane.innerHTML = '<p class="empty" id="processSelectHint">Select a process or create a new one.</p>';
      return;
    }

    if (processViewMode === "guide") {
      pane.innerHTML =
        '<div class="card" style="background:#0d1218;margin:0">' +
        '<div class="pe-mode-toggle">' +
        '<button type="button" class="ghost" data-pe-mode="edit">Edit</button>' +
        '<button type="button" class="ghost active" data-pe-mode="guide">Guide</button>' +
        "</div>" +
        '<h3 style="margin:0 0 0.35rem">' + escapeHtml(process.title) + "</h3>" +
        '<p class="hint" style="margin-bottom:0.75rem">' + escapeHtml(process.summary || "") + "</p>" +
        '<div id="peGuideMount"></div></div>';
      pane.querySelector('[data-pe-mode="edit"]').onclick = function () {
        processViewMode = "edit";
        renderProcessDetail(process);
      };
      renderGuideView(process);
      return;
    }

    var stepsHtml = renderStepsListHtml(process, process.steps, "main", {});
    pane.innerHTML =
      '<div class="card" style="background:#0d1218;margin:0">' +
      '<div class="pe-mode-toggle">' +
      '<button type="button" class="ghost active" data-pe-mode="edit">Edit</button>' +
      '<button type="button" class="ghost" data-pe-mode="guide">Guide</button>' +
      "</div>" +
      '<div class="grid-2" style="margin-bottom:0.65rem">' +
      '<div style="grid-column:1/-1"><label for="procEditTitle">Process title</label>' +
      '<input id="procEditTitle" type="text" value="' + escapeAttr(process.title) + '" /></div>' +
      '<div style="grid-column:1/-1"><label for="procEditSummary">Summary</label>' +
      '<input id="procEditSummary" type="text" value="' + escapeAttr(process.summary) + '" placeholder="One-line description" /></div>' +
      "<div><label for=\"procEditStatus\">Status</label><select id=\"procEditStatus\">" +
      '<option value="draft"' + (process.status === "draft" ? " selected" : "") + ">Draft</option>" +
      '<option value="published"' + (process.status === "published" ? " selected" : "") + ">Published</option>" +
      '<option value="archived"' + (process.status === "archived" ? " selected" : "") + ">Archived</option></select></div>" +
      "<div><label for=\"procEditTags\">Tags (comma-separated)</label>" +
      '<input id="procEditTags" type="text" value="' + escapeAttr((process.tags || []).join(", ")) + '" placeholder="e.g. dog, morning" /></div>' +
      "</div>" +
      '<div class="btn-row" style="margin-top:0;margin-bottom:0.75rem">' +
      '<button type="button" class="primary" id="btnSaveProcessMeta">Save process info</button>' +
      '<button type="button" class="ghost" id="btnExportProcess">Export</button>' +
      '<button type="button" class="ghost danger" id="btnDeleteProcess">Delete</button>' +
      "</div>" +
      '<p class="hint" style="margin-bottom:0.5rem">v' + process.version + " · " + countProcessSteps(process) + " steps · Updated " + formatTime(process.updatedAt) + "</p>" +
      '<div class="pe-steps-list">' +
      (stepsHtml || '<p class="empty">No steps yet — add a step or fork below.</p>') +
      "</div>" +
      '<div class="btn-row">' +
      '<button type="button" class="primary" data-pe-add-step="main">+ Add step</button>' +
      '<button type="button" class="ghost" data-pe-add-fork="main">+ Add fork</button>' +
      "</div></div>";

    pane.querySelector('[data-pe-mode="guide"]').onclick = function () {
      processViewMode = "guide";
      guideStepIndex = 0;
      guideBranchChoices = {};
      renderProcessDetail(process);
    };

    document.getElementById("btnSaveProcessMeta").onclick = function () {
      var newStatus = document.getElementById("procEditStatus").value;
      if (newStatus === "published" && process.status !== "published") process.version = (process.version || 1) + 1;
      process.title = document.getElementById("procEditTitle").value.trim() || "Untitled process";
      process.summary = document.getElementById("procEditSummary").value.trim();
      process.status = newStatus;
      process.tags = document.getElementById("procEditTags").value.split(",").map(function (t) { return t.trim(); }).filter(Boolean);
      process.updatedAt = nowISO();
      persist();
      renderProcessList();
    };

    document.getElementById("btnExportProcess").onclick = function () {
      exportSingleProcess(process);
    };

    document.getElementById("btnDeleteProcess").onclick = function () {
      if (!confirm('Delete process "' + process.title + '" and all steps?')) return;
      deleteAllProcessPhotos(process.id).finally(function () {
        state.processes = state.processes.filter(function (p) { return p.id !== process.id; });
        selectedProcessId = null;
        expandedPePath = null;
        persist();
        renderProcessList();
      });
    };

    bindProcessDetailEvents(process);
  }

  function renderProcessList() {
    var listEl = document.getElementById("processList");
    var empty = document.getElementById("processListEmpty");
    var processes = getFilteredProcesses();
    listEl.innerHTML = "";
    if (!processes.length) {
      empty.hidden = false;
      if (!selectedProcessId) renderProcessDetail(null);
      else renderProcessDetail(getProcess(selectedProcessId));
      return;
    }
    empty.hidden = true;
    if (!selectedProcessId || !getProcess(selectedProcessId)) {
      selectedProcessId = processes[0].id;
    }
    processes.forEach(function (p) {
      var div = document.createElement("div");
      div.className = "project-list-item" + (p.id === selectedProcessId ? " active" : "");
      var n = countProcessSteps(p);
      div.innerHTML =
        '<div class="proj-title">' + escapeHtml(p.title) + "</div>" +
        '<div class="proj-meta"><span class="badge ' + processStatusBadge(p.status) + '">' + processStatusLabel(p.status) + "</span>" +
        " · " + n + " step" + (n === 1 ? "" : "s") + " · " + formatTime(p.updatedAt) + "</div>";
      div.onclick = function () {
        selectedProcessId = p.id;
        expandedPePath = null;
        guideStepIndex = 0;
        guideBranchChoices = {};
        renderProcessList();
      };
      listEl.appendChild(div);
    });
    renderProcessDetail(getProcess(selectedProcessId));
  }

  function extractProcessesFromImport(parsed) {
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof AppsBackup !== "undefined" && AppsBackup.isUnifiedBackup(parsed)) {
      var slice = AppsBackup.getAppSlice(parsed, "process-guide");
      return slice && Array.isArray(slice.processes) ? slice.processes : null;
    }
    if (parsed.format === EXPORT_FORMAT && Array.isArray(parsed.processes)) return parsed.processes;
    if (Array.isArray(parsed.processes)) return parsed.processes;
    if (Array.isArray(parsed.processExcellence)) return parsed.processExcellence;
    return null;
  }

  function mergeProcesses(incoming) {
    var existingIds = {};
    state.processes.forEach(function (p) { existingIds[p.id] = true; });
    var added = 0;
    incoming.forEach(function (raw) {
      var proc = normalizeProcess(raw);
      if (existingIds[proc.id]) proc = cloneProcessWithNewId(proc);
      state.processes.push(proc);
      existingIds[proc.id] = true;
      added++;
    });
    return added;
  }

  function handleImportFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = JSON.parse(reader.result);
        var processes = extractProcessesFromImport(parsed);
        if (!processes || !processes.length) {
          toast("No processes found in this file");
          return;
        }
        var normalized = processes.map(normalizeProcess);
        importPhotosFromProcesses(processes).then(function () {
          var added = mergeProcesses(normalized);
          persist();
          if (processes.length === 1 && added === 1) {
            selectedProcessId = state.processes[state.processes.length - 1].id;
          }
          renderProcessList();
          toast("Added " + added + " process" + (added === 1 ? "" : "es"));
        }).catch(function () {
          toast("Import failed");
        });
      } catch (e) {
        toast("Invalid JSON file");
      }
    };
    reader.readAsText(file);
  }

  function exportAll() {
    var copy = JSON.parse(JSON.stringify(state));
    embedPhotosForExport(copy.processes).then(function () {
      var blob = new Blob([JSON.stringify(copy, null, 2)], { type: "application/json" });
      var a = document.createElement("a");
      var d = new Date();
      var stamp = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
      a.href = URL.createObjectURL(blob);
      a.download = "process-guide-backup-" + stamp + ".json";
      a.click();
      URL.revokeObjectURL(a.href);
      toast("Backup exported");
    }).catch(function () {
      toast("Export failed");
    });
  }

  function switchView(view) {
    document.querySelectorAll(".view").forEach(function (v) {
      v.classList.toggle("active", v.dataset.view === view);
    });
    document.querySelectorAll(".nav-btn").forEach(function (btn) {
      var on = btn.dataset.view === view;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
  }

  function wireEvents() {
    document.getElementById("btnNewProcess").onclick = function () {
      var proc = normalizeProcess({
        id: uid(),
        title: "Untitled process",
        summary: "",
        status: "draft",
        version: 1,
        tags: [],
        steps: [],
        createdAt: nowISO(),
        updatedAt: nowISO(),
      });
      state.processes.push(proc);
      selectedProcessId = proc.id;
      processViewMode = "edit";
      expandedPePath = null;
      persist();
      renderProcessList();
      setTimeout(function () {
        var el = document.getElementById("procEditTitle");
        if (el) {
          el.focus();
          el.select();
        }
      }, 50);
    };

    document.getElementById("processSearch").oninput = renderProcessList;
    document.getElementById("processStatusFilter").onchange = function () {
      processStatusFilter = document.getElementById("processStatusFilter").value;
      renderProcessList();
    };

    document.getElementById("btnExportAll").onclick = exportAll;
    document.getElementById("btnClearPhotos").onclick = clearAllProcessPhotos;
    document.getElementById("importFile").onchange = function (e) {
      var file = e.target.files && e.target.files[0];
      e.target.value = "";
      handleImportFile(file);
    };

    document.querySelectorAll(".nav-btn").forEach(function (btn) {
      btn.onclick = function () { switchView(btn.dataset.view); };
    });
  }

  loadState().then(function (st) {
    state = st;
    wireEvents();
    renderProcessList();
  });
})();
