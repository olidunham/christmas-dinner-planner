#!/usr/bin/env node
// Safely add ingredients / schedule steps / dish details to the LIVE planner through its API.
//
//   node scripts/import.js <base-url> <rows.json>           dry run: validate and preview, writes nothing
//   node scripts/import.js <base-url> <rows.json> --apply   back up the database, then write the rows
//
// rows.json: { "dishPatches": [{ "id": "<dish id>", "recipe"?, "ahead"?, "course"?, "notes"? }],
//              "ingredients": [{ "dish", "item", "qty", "when": "early"|"late"|"", "shop"? }],
//              "schedule":    [{ "day", "time": "HH:MM"|"", "task", "dish"?, "where"? }] }
// Only ever creates rows (and patches dishes you list). Never deletes. Skips rows that already exist.
// The lists below must match the ones in public/index.html.
const fs = require("node:fs");
const path = require("node:path");

const DAYS = ["Before 23 Dec", "23 Dec", "Christmas Eve", "Christmas Day"];
const WHERE = ["", "Main oven", "Top oven", "Combi microwave", "Hob", "Fridge", "Freezer", "Shopping", "Other"];
const WHEN = ["", "early", "late"];
const COURSES = ["", "Starter", "Main", "Side", "Sauce & gravy", "Dessert", "Drinks", "Nibbles"];
const AHEAD = ["", "On the day", "Day before", "2–3 days before", "Freeze ahead"];

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const [baseArg, file] = args.filter(a => !a.startsWith("--"));
if (!baseArg || !file) { console.error("Usage: node scripts/import.js <base-url> <rows.json> [--apply]"); process.exit(2); }
const base = baseArg.replace(/\/+$/, "");

const api = async (method, url, body) => {
  const r = await fetch(base + url, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(`${method} ${url} -> HTTP ${r.status}`);
  return r.json();
};
const key = (...p) => p.map(x => String(x ?? "").trim().toLowerCase()).join("|");

(async () => {
  const input = JSON.parse(fs.readFileSync(file, "utf8"));
  const state = await api("GET", "/api/state");
  const dishIds = new Set(state.dishes.map(d => d.id));
  const dishName = id => (state.dishes.find(d => d.id === id) || {}).name || "-";
  const errors = [], warnings = [];
  const must = (ok, msg) => { if (!ok) errors.push(msg); };

  const patches = (input.dishPatches || []).map((p, i) => {
    must(dishIds.has(p.id), `dishPatches[${i}]: unknown dish id ${p.id}`);
    if (p.course !== undefined) must(COURSES.includes(p.course), `dishPatches[${i}]: bad course "${p.course}"`);
    if (p.ahead !== undefined) must(AHEAD.includes(p.ahead), `dishPatches[${i}]: bad ahead "${p.ahead}"`);
    if (p.recipe !== undefined) must(p.recipe === "" || /^https?:\/\//i.test(p.recipe), `dishPatches[${i}]: recipe must be an http(s) link`);
    return p;
  });

  const haveIng = new Set(state.ingredients.map(i => key(i.dish, i.item)));
  const ingredients = [];
  (input.ingredients || []).forEach((r, i) => {
    must(dishIds.has(r.dish), `ingredients[${i}] "${r.item}": unknown dish id ${r.dish}`);
    must(typeof r.item === "string" && r.item.trim(), `ingredients[${i}]: item is required`);
    must(WHEN.includes(r.when ?? ""), `ingredients[${i}] "${r.item}": when must be early, late or ""`);
    const row = { item: String(r.item || "").trim(), dish: r.dish, qty: String(r.qty ?? ""), when: r.when ?? "", shop: String(r.shop ?? ""), bought: false };
    if (haveIng.has(key(row.dish, row.item))) { warnings.push(`skip (already there): ${dishName(row.dish)} / ${row.item}`); return; }
    haveIng.add(key(row.dish, row.item));
    ingredients.push(row);
  });

  const haveStep = new Set(state.schedule.map(s => key(s.dish, s.day, s.time, s.task)));
  const schedule = [];
  (input.schedule || []).forEach((r, i) => {
    must(DAYS.includes(r.day), `schedule[${i}]: day must be one of ${DAYS.join(", ")}`);
    must(r.time === "" || /^([01]\d|2[0-3]):[0-5]\d$/.test(r.time ?? ""), `schedule[${i}]: time must be HH:MM or ""`);
    must(typeof r.task === "string" && r.task.trim(), `schedule[${i}]: task is required`);
    must(WHERE.includes(r.where ?? ""), `schedule[${i}]: bad where "${r.where}"`);
    must(!r.dish || dishIds.has(r.dish), `schedule[${i}]: unknown dish id ${r.dish}`);
    const row = { day: r.day, time: r.time ?? "", task: String(r.task || "").trim(), dish: r.dish ?? "", where: r.where ?? "", done: false };
    if (haveStep.has(key(row.dish, row.day, row.time, row.task))) { warnings.push(`skip (already there): ${row.day} ${row.time} ${row.task.slice(0, 40)}`); return; }
    haveStep.add(key(row.dish, row.day, row.time, row.task));
    schedule.push(row);
  });

  if (errors.length) { console.error("Not safe to write. Fix these first:\n - " + errors.join("\n - ")); process.exit(1); }

  console.log(`\nTarget: ${base}  (currently ${state.dishes.length} dishes, ${state.ingredients.length} ingredients, ${state.schedule.length} steps)`);
  if (patches.length) { console.log(`\nDish updates (${patches.length}):`); patches.forEach(p => { const { id, ...rest } = p; console.log(`  ${dishName(id)}: ${JSON.stringify(rest)}`); }); }
  console.log(`\nIngredients to add (${ingredients.length}):`);
  ingredients.forEach(r => console.log(`  [${(r.when || "-").padEnd(5)}] ${r.item}  |  ${r.qty}  |  ${dishName(r.dish)}${r.shop ? "  |  " + r.shop : ""}`));
  console.log(`\nSchedule steps to add (${schedule.length}):`);
  schedule.sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.time.localeCompare(b.time))
    .forEach(r => console.log(`  ${r.day.padEnd(14)} ${(r.time || "--:--")}  ${(r.where || "-").padEnd(15)} ${r.task.slice(0, 90)}`));
  if (warnings.length) console.log("\nNotes:\n  " + warnings.join("\n  "));

  if (!apply) { console.log("\nDRY RUN: nothing written. Re-run with --apply to write."); return; }

  const backup = path.resolve(`planner-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(backup, JSON.stringify(await api("GET", "/api/export"), null, 2));
  console.log(`\nBackup saved: ${backup}`);

  let n = Date.now();
  for (const p of patches) { const { id, ...rest } = p; await api("PATCH", `/api/dishes/${id}`, rest); }
  for (const r of ingredients) await api("POST", "/api/ingredients", { ...r, order: n++ });
  for (const r of schedule) await api("POST", "/api/schedule", { ...r, order: n++ });

  const after = await api("GET", "/api/state");
  console.log(`Done. Now ${after.dishes.length} dishes, ${after.ingredients.length} ingredients, ${after.schedule.length} steps.`);
})().catch(e => { console.error("Failed:", e.message); process.exit(1); });
