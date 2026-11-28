import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "./db.mjs";
import { getIdentity } from "./cursor/identity.js";

const require = createRequire(import.meta.url);
const L = require("./logic.js");
const root = path.dirname(fileURLToPath(import.meta.url));
const MAX_BODY = 500000;
const ALLOWED_ORIGINS = new Set(["https://mathoose.github.io"]);
const hits = new Map();

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function asData(value) {
  if (value && typeof value === "object") return L.normalizeData(value);
  if (typeof value === "string") {
    try { return L.normalizeData(JSON.parse(value)); } catch (e) { return L.emptyData(); }
  }
  return L.emptyData();
}

function householdId(identity) {
  return identity && identity.stage === "preview" ? "preview" : "home";
}

function limited(key, max, windowMs) {
  const now = Date.now();
  const row = hits.get(key);
  if (!row || now > row.reset) {
    hits.set(key, { n: 1, reset: now + windowMs });
    return false;
  }
  row.n += 1;
  return row.n > max;
}

async function loadHousehold(id) {
  const found = await sql("select data, revision from household where id = $1", [id]);
  if (found[0]) return found[0];
  await sql(
    "insert into household (id, data, revision) values ($1, $2::jsonb, 1) on conflict (id) do nothing",
    [id, JSON.stringify(L.emptyData())],
  );
  const again = await sql("select data, revision from household where id = $1", [id]);
  return again[0] || { data: L.emptyData(), revision: 1 };
}

async function openHousehold(identity) {
  const row = await loadHousehold(householdId(identity));
  return { status: "ok", revision: Number(row.revision), data: asData(row.data) };
}

async function saveHousehold(identity, body) {
  const id = householdId(identity);
  const raw = JSON.stringify(body.data || {});
  if (raw.length > 400000) return { status: "bad_data" };
  const data = L.pruneData(asData(body.data));
  const revision = Number(body.revision);
  const row = await loadHousehold(id);
  if (Number(row.revision) !== revision) {
    return { status: "conflict", revision: Number(row.revision), data: asData(row.data) };
  }
  const saved = await sql(
    "update household set data = $2::jsonb, revision = revision + 1 where id = $1 and revision = $3 returning revision",
    [id, JSON.stringify(data), revision],
  );
  if (!saved[0]) {
    const again = await sql("select data, revision from household where id = $1", [id]);
    return { status: "conflict", revision: Number(again[0].revision), data: asData(again[0].data) };
  }
  return { status: "ok", revision: Number(saved[0].revision) };
}

function send(res, status, payload, origin) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "private, no-store",
  };
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

function callerKey(req) {
  return String((req.socket && req.socket.remoteAddress) || "local");
}

function blockedPath(pathname) {
  const clean = path.posix.normalize(pathname);
  const base = path.posix.basename(clean);
  if (base.startsWith(".")) return true;
  if (["server.mjs", "db.mjs", "package.json", "package-lock.json", "config.js"].includes(base)) return true;
  const ext = path.extname(base).toLowerCase();
  if (ext === ".mjs" || ext === ".sql" || ext === ".map") return true;
  if (clean.startsWith("/cursor/") || clean.startsWith("/migrations/") || clean.startsWith("/scripts/") || clean.startsWith("/node_modules/")) return true;
  return false;
}

async function person(req) {
  const identity = await getIdentity(req);
  if (!identity || !identity.verified || identity.kind !== "person") return null;
  return identity;
}

async function onRequest(req, res) {
  const origin = req.headers.origin || "";
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (limited("all", 600, 60000) || limited("ip:" + callerKey(req), 120, 60000)) {
    send(res, 429, { status: "busy" }, origin);
    return;
  }
  if (req.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
    send(res, 204, {}, origin);
    return;
  }
  if (req.method === "POST" && (url.pathname === "/api/open" || url.pathname === "/api/save")) {
    try {
      const identity = await person(req);
      if (!identity) {
        send(res, 401, { status: "unauthorized" }, origin);
        return;
      }
      if (limited("person:" + identity.sub, 120, 60000)) {
        send(res, 429, { status: "busy" }, origin);
        return;
      }
      const body = await readBody(req);
      const result = url.pathname === "/api/open"
        ? await openHousehold(identity)
        : await saveHousehold(identity, body);
      send(res, 200, result, origin);
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
  if (blockedPath(url.pathname)) {
    send(res, 404, { status: "missing" }, origin);
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
