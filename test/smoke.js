// Smoke test: starts the real server on a temp DB and exercises the API.
// Run: node test/smoke.js   (exits non-zero on any failure, so CI blocks a bad publish)
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

const PORT = 3900 + Math.floor(Math.random() * 90);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "planner-test-"));
const base = `http://127.0.0.1:${PORT}`;
const seed = require("../seed/christmas-dinner-data.json");

const server = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
  env: { ...process.env, PORT: String(PORT), DB_PATH: path.join(dir, "t.db") },
  stdio: ["ignore", "inherit", "inherit"],
});

const call = async (method, url, body) => {
  const r = await fetch(base + url, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};

async function waitUp() {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(base + "/healthz")).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error("server did not start");
}

async function run() {
  await waitUp();

  let r = await call("GET", "/api/state");
  assert.equal(r.status, 200);
  for (const c of ["dishes", "ingredients", "schedule"]) assert.equal(r.body[c].length, seed[c].length, c + " seeded");
  const rev0 = r.body.rev;

  r = await call("POST", "/api/dishes", { id: "t1", name: "Test", order: 1 });
  assert.equal(r.status, 201);
  r = await call("PATCH", "/api/dishes/t1", { name: "Renamed" });
  assert.equal(r.body.name, "Renamed");
  r = await call("PUT", "/api/meta/plan", { serveTime: "15:30" });
  assert.equal(r.body.serveTime, "15:30");
  r = await call("DELETE", "/api/dishes/t1");
  assert.equal(r.status, 200);
  r = await call("GET", "/api/dishes/t1");
  assert.equal(r.status, 404);

  r = await call("GET", "/api/rev");
  assert.ok(r.body.rev > rev0, "rev bumps on writes");

  assert.equal((await call("GET", "/api/nope")).status, 404);
  assert.equal((await call("POST", "/api/dishes", { bad: { nested: 1 } })).status, 400);

  const page = await fetch(base + "/");
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Christmas Dinner Planner/);
  assert.equal((await fetch(base + "/..%2fserver.js")).status >= 400, true, "no path traversal");

  console.log("smoke test passed");
}

run()
  .then(() => 0, e => { console.error("SMOKE TEST FAILED:", e); return 1; })
  .then(code => { server.kill(); setTimeout(() => { fs.rmSync(dir, { recursive: true, force: true }); process.exit(code); }, 300); });
