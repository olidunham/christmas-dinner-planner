// Christmas Dinner Planner: tiny zero-dependency server (Node 22.13+/24, built-in node:sqlite).
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const PORT = Number(process.env.PORT) || 3000;
const DB_PATH = process.env.DB_PATH || "/data/planner.db";
const SEED_FILE = process.env.SEED_FILE || path.join(__dirname, "seed", "christmas-dinner-data.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const COLS = ["dishes", "ingredients", "schedule", "meta"];
const MAX_BODY = 1024 * 1024;

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS docs (col TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, ord REAL NOT NULL DEFAULT 0, PRIMARY KEY (col, id));
  CREATE TABLE IF NOT EXISTS rev (n INTEGER NOT NULL);
  INSERT INTO rev (n) SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM rev);
`);

const q = {
  rev: db.prepare("SELECT n FROM rev"),
  bump: db.prepare("UPDATE rev SET n = n + 1"),
  list: db.prepare("SELECT id, data FROM docs WHERE col = ? ORDER BY ord, id"),
  get: db.prepare("SELECT data, ord FROM docs WHERE col = ? AND id = ?"),
  put: db.prepare("INSERT OR REPLACE INTO docs (col, id, data, ord) VALUES (?, ?, ?, ?)"),
  del: db.prepare("DELETE FROM docs WHERE col = ? AND id = ?"),
  count: db.prepare("SELECT COUNT(*) AS c FROM docs"),
  wipe: db.prepare("DELETE FROM docs"),
};

const getRev = () => q.rev.get().n;
const list = col => q.list.all(col).map(r => ({ id: r.id, ...JSON.parse(r.data) }));
const ordOf = d => (typeof d.order === "number" ? d.order : Date.now());

function tx(fn) {
  db.exec("BEGIN");
  try { const r = fn(); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; }
}

function seed(force) {
  if (force) tx(() => q.wipe.run());
  if (q.count.get().c > 0) return;
  if (!fs.existsSync(SEED_FILE)) { console.log("No seed file at " + SEED_FILE + "; starting empty."); return; }
  const data = JSON.parse(fs.readFileSync(SEED_FILE, "utf8"));
  tx(() => {
    for (const col of COLS) for (const { id, ...rest } of data[col] || []) q.put.run(col, String(id), JSON.stringify(rest), ordOf(rest));
    q.bump.run();
  });
  console.log("Seeded database from " + SEED_FILE);
}

seed(process.argv.includes("--reseed"));
if (process.argv.includes("--reseed")) { console.log("Re-seed complete."); db.close(); process.exit(0); }

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

function clean(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "Body must be a JSON object");
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    if (k === "id") continue;
    if (["string", "number", "boolean"].includes(typeof v) || v === null) out[k] = v;
    else throw new HttpError(400, "Field " + k + " must be a string, number or boolean");
  }
  return out;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", c => { size += c.length; if (size > MAX_BODY) { reject(new HttpError(413, "Body too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); } catch { reject(new HttpError(400, "Invalid JSON")); } });
    req.on("error", reject);
  });
}

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(body);
}

function exportAll() { const o = {}; for (const c of COLS) o[c] = list(c); return o; }

async function api(req, res, parts) {
  const [, a, b] = parts; // ["api", a, b]
  const m = req.method;
  if (a === "rev" && m === "GET") return send(res, 200, { rev: getRev() });
  if (a === "state" && m === "GET") return send(res, 200, { rev: getRev(), ...exportAll() });
  if (a === "export" && m === "GET") return send(res, 200, exportAll());
  if (!COLS.includes(a)) throw new HttpError(404, "Unknown collection");

  if (!b) {
    if (m === "GET") return send(res, 200, list(a));
    if (m === "POST") {
      const body = await readBody(req);
      const id = typeof body.id === "string" && /^[\w-]{1,64}$/.test(body.id) ? body.id : crypto.randomUUID().replace(/-/g, "").slice(0, 20);
      const data = clean(body);
      if (q.get.get(a, id)) throw new HttpError(409, "Id already exists");
      tx(() => { q.put.run(a, id, JSON.stringify(data), ordOf(data)); q.bump.run(); });
      return send(res, 201, { id, ...data });
    }
    throw new HttpError(405, "Method not allowed");
  }

  if (!/^[\w-]{1,64}$/.test(b)) throw new HttpError(400, "Bad id");
  const row = q.get.get(a, b);
  if (m === "GET") { if (!row) throw new HttpError(404, "Not found"); return send(res, 200, { id: b, ...JSON.parse(row.data) }); }
  if (m === "PATCH") {
    if (!row) throw new HttpError(404, "Not found");
    const data = { ...JSON.parse(row.data), ...clean(await readBody(req)) };
    tx(() => { q.put.run(a, b, JSON.stringify(data), ordOf(data)); q.bump.run(); });
    return send(res, 200, { id: b, ...data });
  }
  if (m === "PUT") {
    const data = clean(await readBody(req));
    tx(() => { q.put.run(a, b, JSON.stringify(data), ordOf(data)); q.bump.run(); });
    return send(res, 200, { id: b, ...data });
  }
  if (m === "DELETE") {
    tx(() => { q.del.run(a, b); q.bump.run(); });
    return send(res, 200, { ok: true });
  }
  throw new HttpError(405, "Method not allowed");
}

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };

function serveStatic(req, res, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(405, "Method not allowed");
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { throw new HttpError(400, "Bad path"); }
  if (rel === "/" || rel === "") rel = "/index.html";
  const file = path.resolve(PUBLIC_DIR, "." + rel);
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) throw new HttpError(403, "Forbidden");
  let st;
  try { st = fs.statSync(file); } catch { throw new HttpError(404, "Not found"); }
  if (!st.isFile()) throw new HttpError(404, "Not found");
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, "http://localhost");
    if (pathname === "/healthz") { getRev(); return send(res, 200, { ok: true }); }
    const parts = pathname.split("/").filter(Boolean);
    if (parts[0] === "api") return await api(req, res, parts);
    serveStatic(req, res, pathname);
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    if (res.headersSent) return res.end();
    const status = e instanceof HttpError ? e.status : 500;
    send(res, status, { error: status === 500 ? "Server error" : e.message });
  }
});

server.listen(PORT, "0.0.0.0", () => console.log("Planner listening on :" + PORT + " (db: " + DB_PATH + ")"));
for (const s of ["SIGTERM", "SIGINT"]) process.on(s, () => { server.close(); db.close(); process.exit(0); });
