import { createRequire } from "node:module";
import { createServer } from "node:http";
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "./db.mjs";

const require = createRequire(import.meta.url);
const L = require("./logic.js");
const scrypt = promisify(scryptCb);
const root = path.dirname(fileURLToPath(import.meta.url));
const KEYLEN = 32;
const MAX_BODY = 500000;
const ALLOWED_ORIGINS = new Set(["https://mathoose.github.io"]);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function normalizeCode(code) {
  return String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
}

function normalizePin(pin) {
  return String(pin || "").replace(/\D/g, "").slice(0, 8);
}

function validCode(code) {
  return /^[A-Z0-9]{4,12}$/.test(code);
}

function validPin(pin) {
  return /^[0-9]{4,8}$/.test(pin);
}

async function hashPin(pin) {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scrypt(pin, salt, KEYLEN)).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

async function checkPin(pin, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const hash = (await scrypt(pin, parts[1], KEYLEN)).toString("hex");
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(parts[2], "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function asData(value) {
  if (value && typeof value === "object") return L.normalizeData(value);
  if (typeof value === "string") {
    try { return L.normalizeData(JSON.parse(value)); } catch (e) { return L.emptyData(); }
  }
  return L.emptyData();
}

function locked(row) {
  if (!row || !row.pin_locked_until) return false;
  return new Date(row.pin_locked_until).getTime() > Date.now();
}

async function noteFail(code) {
  const rows = await sql(
    `update rooms
        set pin_fails = pin_fails + 1,
            pin_locked_until = case when pin_fails + 1 >= 8 then now() + interval '5 minutes' else pin_locked_until end
      where code = $1
      returning pin_fails`,
    [code],
  );
  return rows[0] ? Number(rows[0].pin_fails) : 0;
}

async function joinRoom(body) {
  const code = normalizeCode(body.code);
  const pin = normalizePin(body.pin);
  const confirm = normalizePin(body.confirm || body.pin);
  if (!validCode(code)) return { status: "bad_code" };
  if (!validPin(pin)) return { status: "bad_pin" };
  const incoming = asData(body.data);
  const found = await sql("select code, pin_hash, data, revision, pin_fails, pin_locked_until from rooms where code = $1", [code]);
  const row = found[0];
  if (!row) {
    if (pin !== confirm) return { status: "pin_mismatch" };
    const pinHash = await hashPin(pin);
    const data = L.pruneData(incoming);
    try {
      await sql(
        "insert into rooms (code, pin_hash, data, revision) values ($1, $2, $3::jsonb, 1)",
        [code, pinHash, JSON.stringify(data)],
      );
    } catch (error) {
      if (!/duplicate|unique/i.test(String(error && error.message))) throw error;
      return joinRoom(body);
    }
    return { status: "ok", created: true, revision: 1, data };
  }
  if (locked(row)) return { status: "locked" };
  if (!(await checkPin(pin, row.pin_hash))) {
    await noteFail(code);
    return { status: "bad_pin" };
  }
  await sql("update rooms set pin_fails = 0, pin_locked_until = null where code = $1", [code]);
  const merged = L.pruneData(L.mergeData(asData(row.data), incoming));
  const same = L.sameData(merged, asData(row.data));
  if (same) return { status: "ok", created: false, revision: Number(row.revision), data: asData(row.data) };
  const saved = await sql(
    "update rooms set data = $2::jsonb, revision = revision + 1 where code = $1 and revision = $3 returning revision, data",
    [code, JSON.stringify(merged), Number(row.revision)],
  );
  if (!saved[0]) return joinRoom(body);
  return { status: "ok", created: false, revision: Number(saved[0].revision), data: asData(saved[0].data) };
}

async function openRoom(body) {
  const code = normalizeCode(body.code);
  const pin = normalizePin(body.pin);
  if (!validCode(code) || !validPin(pin)) return { status: "bad_pin" };
  const found = await sql("select pin_hash, data, revision, pin_locked_until from rooms where code = $1", [code]);
  const row = found[0];
  if (!row) return { status: "new" };
  if (locked(row)) return { status: "locked" };
  if (!(await checkPin(pin, row.pin_hash))) {
    await noteFail(code);
    return { status: "bad_pin" };
  }
  await sql("update rooms set pin_fails = 0, pin_locked_until = null where code = $1", [code]);
  return { status: "ok", revision: Number(row.revision), data: asData(row.data) };
}

async function saveRoom(body) {
  const code = normalizeCode(body.code);
  const pin = normalizePin(body.pin);
  if (!validCode(code) || !validPin(pin)) return { status: "bad_pin" };
  const raw = JSON.stringify(body.data || {});
  if (raw.length > 400000) return { status: "bad_data" };
  const data = L.pruneData(asData(body.data));
  const revision = Number(body.revision);
  const found = await sql("select pin_hash, data, revision, pin_locked_until from rooms where code = $1", [code]);
  const row = found[0];
  if (!row) return { status: "new" };
  if (locked(row)) return { status: "locked" };
  if (!(await checkPin(pin, row.pin_hash))) {
    await noteFail(code);
    return { status: "bad_pin" };
  }
  if (Number(row.revision) !== revision) {
    return { status: "conflict", revision: Number(row.revision), data: asData(row.data) };
  }
  const saved = await sql(
    "update rooms set data = $2::jsonb, revision = revision + 1, pin_fails = 0, pin_locked_until = null where code = $1 and revision = $3 returning revision",
    [code, JSON.stringify(data), revision],
  );
  if (!saved[0]) {
    const again = await sql("select data, revision from rooms where code = $1", [code]);
    return { status: "conflict", revision: Number(again[0].revision), data: asData(again[0].data) };
  }
  return { status: "ok", revision: Number(saved[0].revision) };
}

function send(res, status, payload, origin) {
  const headers = { "Content-Type": "application/json; charset=utf-8" };
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
  }
  res.writeHead(status, headers);
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > MAX_BODY) {
        reject(Object.assign(new Error("too_big"), { status: 413 }));
        req.destroy();
      }
    });
    req.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(Object.assign(new Error("bad_json"), { status: 400 })); }
    });
    req.on("error", reject);
  });
}

async function onRequest(req, res) {
  const origin = req.headers.origin || "";
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (req.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
    send(res, 204, {}, origin);
    return;
  }
  if (req.method === "POST" && (url.pathname === "/api/join" || url.pathname === "/api/open" || url.pathname === "/api/save")) {
    try {
      const body = await readBody(req);
      const result = url.pathname === "/api/join"
        ? await joinRoom(body)
        : url.pathname === "/api/open"
          ? await openRoom(body)
          : await saveRoom(body);
      const status = result.status === "bad_pin" || result.status === "locked" ? 200 : 200;
      send(res, status, result, origin);
    } catch (error) {
      const code = error && error.status ? error.status : 500;
      send(res, code, { status: code === 413 ? "bad_data" : "error" }, origin);
    }
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    send(res, 405, { status: "error" }, origin);
    return;
  }
  const extras = {
    "/apps-shell.css": path.join(root, "..", "apps-shell.css"),
    "/apps-shell.js": path.join(root, "..", "apps-shell.js"),
    "/apps-backup.js": path.join(root, "..", "apps-backup.js"),
    "/versions.json": path.join(root, "..", "versions.json"),
    "/trip-packing/logic.js": path.join(root, "..", "trip-packing", "logic.js"),
  };
  if (extras[url.pathname]) {
    try {
      const file = await readFile(extras[url.pathname]);
      const type = TYPES[path.extname(url.pathname).toLowerCase()] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" });
      res.end(req.method === "HEAD" ? undefined : file);
    } catch (e) {
      send(res, 404, { status: "missing" }, origin);
    }
    return;
  }
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/") rel = "/index.html";
  const clean = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, "");
  const full = path.join(root, clean);
  if (!full.startsWith(root + path.sep) && full !== root) {
    send(res, 404, { status: "error" }, origin);
    return;
  }
  try {
    const file = await readFile(full);
    const type = TYPES[path.extname(full).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" });
    res.end(req.method === "HEAD" ? undefined : file);
  } catch (e) {
    send(res, 404, { status: "missing" }, origin);
  }
}

export function start(port) {
  return new Promise((resolve) => {
    const server = createServer(onRequest);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const port = Number(process.env.PORT) || 8787;
  start(port).then(() => {
    console.log("our-lists listening");
  });
}
