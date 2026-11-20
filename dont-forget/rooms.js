(function () {
  "use strict";

  var L = window.DontForgetLogic;
  var CACHE_KEY = "dont-forget-rooms-v1";
  var POLL_MS = 4000;

  var listeners = { status: null, scope: null };

  var roomState = {
    code: "",
    pin: "",
    revision: 0,
    data: L.emptyData(),
    dirty: false,
    saving: false,
    saveAgain: false,
    status: "",
    pollTimer: 0,
    saveTimer: 0,
  };

  var activeScope = "private";

  function config() {
    var c = window.DONT_FORGET_CONFIG || window.SHARED_LISTS_CONFIG || {};
    var url = String(c.supabaseUrl || "").trim().replace(/\/$/, "");
    var key = String(c.supabaseAnonKey || "").trim();
    if (!url || !key) return null;
    return { url: url, key: key };
  }

  function hasSync() {
    return !!config();
  }

  function loadCache() {
    try {
      var p = JSON.parse(localStorage.getItem(CACHE_KEY) || "");
      if (!p || typeof p !== "object" || !p.rooms || typeof p.rooms !== "object") {
        return { version: 1, activeScope: "private", activeCode: "", rooms: {} };
      }
      p.version = 1;
      if (!p.activeScope) p.activeScope = p.activeCode ? "room" : "private";
      return p;
    } catch (e) {
      return { version: 1, activeScope: "private", activeCode: "", rooms: {} };
    }
  }

  function saveCache() {
    var cache = loadCache();
    cache.version = 1;
    cache.activeScope = activeScope;
    if (activeScope === "room" && roomState.code && roomState.pin) {
      cache.activeCode = roomState.code;
      cache.rooms[roomState.code] = {
        pin: roomState.pin,
        revision: roomState.revision || 0,
        data: L.pruneData(L.normalizeData(roomState.data)),
      };
    } else if (activeScope === "private") {
      cache.activeCode = "";
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  }

  function emitStatus() {
    if (listeners.status) listeners.status(roomState.status);
  }

  function emitScope() {
    if (listeners.scope) listeners.scope(getScope());
  }

  function setStatus(text) {
    roomState.status = text || "";
    emitStatus();
  }

  function getScope() {
    if (activeScope === "room" && roomState.code) {
      return { mode: "room", code: roomState.code, pin: roomState.pin };
    }
    return { mode: "private", code: "", pin: "" };
  }

  function isRoomActive() {
    return getScope().mode === "room";
  }

  function getRoomData() {
    return L.normalizeData(roomState.data);
  }

  function rpc(name, body) {
    var cfg = config();
    if (!cfg) return Promise.reject(new Error("setup"));
    return fetch(cfg.url + "/rest/v1/rpc/" + name, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: cfg.key,
        Authorization: "Bearer " + cfg.key,
      },
      body: JSON.stringify(body),
    }).then(function (res) {
      return res.text().then(function (text) {
        var payload = null;
        try { payload = text ? JSON.parse(text) : null; } catch (e) { payload = text; }
        if (!res.ok) {
          var err = new Error("sync");
          err.status = res.status;
          err.payload = payload;
          throw err;
        }
        return payload;
      });
    });
  }

  function explainSyncError(err) {
    var blob = JSON.stringify(err && err.payload || "");
    if (err && err.status === 401) return "The anon key was rejected. Check config.js.";
    if (err && (err.status === 404 || /PGRST202|function/i.test(blob))) {
      return "Run dont-forget/supabase.sql in Supabase, then try again.";
    }
    return "Can't reach the shared room. Check your connection.";
  }

  function applyRemote(remoteData, revision) {
    var merged = L.pruneData(L.mergeData(roomState.data, remoteData));
    var aheadOfRemote = !L.sameData(merged, remoteData);
    roomState.data = merged;
    roomState.revision = Number(revision) || 0;
    if (aheadOfRemote) {
      roomState.dirty = true;
      scheduleSave();
    } else {
      roomState.dirty = false;
      setStatus("Synced");
    }
    saveCache();
    emitScope();
  }

  function pull() {
    if (!isRoomActive() || !roomState.code || !roomState.pin || roomState.saving) {
      return Promise.resolve();
    }
    return rpc("df_open_room", { p_code: roomState.code, p_pin: roomState.pin }).then(function (res) {
      if (!res || res.status === "bad_pin") {
        return Promise.reject({ kind: "bad_pin" });
      }
      if (res.status === "new") {
        return Promise.reject({ kind: "gone" });
      }
      if (res.status === "ok") applyRemote(res.data || L.emptyData(), res.revision);
    }).catch(function (err) {
      if (err && err.kind) return Promise.reject(err);
      setStatus(roomState.dirty ? "Offline — saved on this phone" : "Offline");
    });
  }

  function saveNow() {
    if (roomState.saving) {
      roomState.saveAgain = true;
      return;
    }
    if (!roomState.dirty || !isRoomActive() || !roomState.code || !roomState.pin) return;
    clearTimeout(roomState.saveTimer);
    var code = roomState.code;
    var pin = roomState.pin;
    var revision = roomState.revision;
    var payload = L.pruneData(L.normalizeData(roomState.data));
    roomState.data = payload;
    roomState.saving = true;
    setStatus("Saving…");
    rpc("df_save_room", {
      p_code: code,
      p_pin: pin,
      p_data: payload,
      p_revision: revision,
    }).then(function (res) {
      if (roomState.code !== code) return;
      if (res && res.status === "ok") {
        roomState.revision = Number(res.revision) || roomState.revision;
        if (!roomState.saveAgain) {
          roomState.dirty = false;
          setStatus("Synced");
        }
      } else if (res && res.status === "conflict") {
        roomState.data = L.pruneData(L.mergeData(roomState.data, res.data || L.emptyData()));
        roomState.revision = Number(res.revision) || roomState.revision;
        roomState.dirty = true;
        roomState.saveAgain = true;
      } else if (res && res.status === "bad_pin") {
        return Promise.reject({ kind: "bad_pin" });
      } else if (res && (res.status === "too_big" || res.status === "bad_data")) {
        setStatus("Room data too large");
      } else {
        setStatus("Saved on this phone");
      }
    }).catch(function (err) {
      if (err && err.kind === "bad_pin") return Promise.reject(err);
      if (roomState.code === code) setStatus("Offline — saved on this phone");
    }).then(function () {
      roomState.saving = false;
      if (roomState.code === code) {
        saveCache();
        if (roomState.saveAgain && roomState.dirty) {
          roomState.saveAgain = false;
          saveNow();
        }
        emitScope();
      }
    });
  }

  function scheduleSave() {
    if (!isRoomActive()) return;
    setStatus("Saving…");
    clearTimeout(roomState.saveTimer);
    roomState.saveTimer = setTimeout(saveNow, 450);
  }

  function mutateRoom(nextData) {
    if (!isRoomActive()) return;
    roomState.data = L.normalizeData(nextData);
    roomState.dirty = true;
    saveCache();
    scheduleSave();
    emitScope();
  }

  function usePrivate() {
    if (roomState.dirty && isRoomActive()) saveNow();
    activeScope = "private";
    saveCache();
    stopPoll();
    setStatus("");
    emitScope();
  }

  function enterRoom(code, pin, revision, data) {
    if (activeScope === "room" && roomState.code && roomState.code !== code && roomState.dirty) {
      saveNow();
    }
    activeScope = "room";
    roomState.code = code;
    roomState.pin = pin;
    roomState.revision = Number(revision) || 0;
    roomState.data = L.normalizeData(data || L.emptyData());
    roomState.dirty = false;
    roomState.saveAgain = false;
    saveCache();
    setStatus("Synced");
    emitScope();
    startPoll();
    pull();
  }

  function restoreFromCache() {
    var cache = loadCache();
    if (cache.activeScope === "room" && cache.activeCode && cache.rooms[cache.activeCode]) {
      var row = cache.rooms[cache.activeCode];
      if (row.pin) {
        enterRoom(cache.activeCode, row.pin, row.revision, row.data);
        return;
      }
    }
    activeScope = "private";
    emitScope();
  }

  function forgetRoom(code) {
    var cache = loadCache();
    if (cache.rooms[code]) delete cache.rooms[code];
    if (cache.activeCode === code) {
      cache.activeCode = "";
      cache.activeScope = "private";
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    if (roomState.code === code) usePrivate();
  }

  function listSavedRooms() {
    var cache = loadCache();
    return Object.keys(cache.rooms || {}).filter(function (code) {
      return cache.rooms[code] && cache.rooms[code].pin;
    }).sort();
  }

  function savedRoomMeta(code) {
    var cache = loadCache();
    var row = cache.rooms[code];
    if (!row) return null;
    return {
      code: code,
      pin: row.pin,
      revision: row.revision,
      data: row.data,
      count: L.activeItems(row.data).length,
    };
  }

  function startPoll() {
    stopPoll();
    roomState.pollTimer = setInterval(function () {
      if (document.hidden) return;
      if (isRoomActive()) pull();
    }, POLL_MS);
  }

  function stopPoll() {
    clearInterval(roomState.pollTimer);
    roomState.pollTimer = 0;
  }

  function roomStatus(code) {
    return rpc("df_room_status", { p_code: code });
  }

  function createRoom(code, pin, data) {
    return rpc("df_create_room", { p_code: code, p_pin: pin, p_data: data || L.emptyData() });
  }

  function openRoom(code, pin) {
    return rpc("df_open_room", { p_code: code, p_pin: pin });
  }

  window.DontForgetRooms = {
    hasSync: hasSync,
    config: config,
    explainSyncError: explainSyncError,
    loadCache: loadCache,
    getScope: getScope,
    isRoomActive: isRoomActive,
    getRoomData: getRoomData,
    mutateRoom: mutateRoom,
    usePrivate: usePrivate,
    enterRoom: enterRoom,
    restoreFromCache: restoreFromCache,
    forgetRoom: forgetRoom,
    listSavedRooms: listSavedRooms,
    savedRoomMeta: savedRoomMeta,
    pull: pull,
    startPoll: startPoll,
    stopPoll: stopPoll,
    roomStatus: roomStatus,
    createRoom: createRoom,
    openRoom: openRoom,
    onStatus: function (fn) { listeners.status = fn; },
    onScope: function (fn) { listeners.scope = fn; },
    getStatus: function () { return roomState.status; },
  };
})();
