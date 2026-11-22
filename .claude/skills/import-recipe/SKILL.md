---
name: import-recipe
description: Pull ingredients and schedule steps from a dish's recipe link into the LIVE Christmas planner through its API. Use when the user asks to import, fill in, add or update a dish's ingredients, method or timeline from its recipe, or to sort out the schedule for a dish.
---

# Import a recipe into the live planner

Writes to the real database on the home LXC (no git, no deploy). Changes appear in the app within a few seconds. Claude must be running on the user's PC on the home network.

## 0. Find the planner URL
Read `.planner-url` in the project root, or the `PLANNER_URL` env var. If neither exists, ask the user for the address (e.g. `http://192.168.1.50:3000`), then offer to save it to `.planner-url` (git-ignored). Check it works: `curl -s <url>/api/state` should return JSON.

## 1. Read the current state
`curl -s <url>/api/state` gives `dishes`, `ingredients`, `schedule`, `meta` (meta has `plan.serveTime`). Find the dish by name and note its `id` and `recipe` URL. If it has no recipe URL, ask for one. Look at what already exists for that dish so you add only what is missing, and at the existing Christmas Day schedule so oven use does not clash.

## 2. Read the recipe
WebFetch the recipe URL and extract: servings, ingredients with quantities, and method steps with times and temperatures. Say so if the page could not be read; never invent quantities.

## 3. Build `rows.json` (in the scratchpad or a temp dir, not the repo)
Format is documented at the top of `scripts/import.js`. Conventions already used in the data:
- **Scale to 6.** Put the scaled amount in `qty`; when scaling changes it, say so, e.g. `"1.5 kg (recipe's 1 kg scaled up for 6)"`.
- **`when`**: `early` = keeps well (tins, frozen, dry goods, spices, drinks, oils, butter); `late` = fresh (meat, veg, herbs, dairy, bread). Chilled pre-prepped items bought to freeze are `early`.
- **`shop`**: optional note, e.g. `"Buy when you make the gravy"` for ingredients needed only for a make-ahead step.
- **Schedule**: `day` is one of `Before 23 Dec`, `23 Dec`, `Christmas Eve`, `Christmas Day`; `time` is 24h `HH:MM` (blank for "anytime" tasks such as make-ahead jobs); `where` is one of Main oven, Top oven, Combi microwave, Hob, Fridge, Freezer, Shopping, Other. Work backwards from `meta/plan.serveTime`. Respect the dish's `ahead` setting (Freeze ahead, Day before, On the day). Keep each task one clear action with its time and temperature (the oven is fan-assisted in existing steps).
- Check oven clashes against the existing Christmas Day steps (Main oven vs Top oven vs Combi microwave) and flag conflicts to the user instead of silently double-booking.
- Use `dishPatches` only to set a dish's `recipe`, `ahead`, `course` or `notes` when the user asked or the field is blank.

## 4. Dry run and show the user
```
node scripts/import.js <url> <rows.json>
```
Show the preview (and any "skip" or error lines) and **wait for the user to confirm**. Point out judgement calls: scaling, early/late choices, assumed times.

## 5. Apply
```
node scripts/import.js <url> <rows.json> --apply
```
It saves a timestamped backup (`planner-backup-*.json`, git-ignored, in the current folder), creates the rows, and prints the new totals. Tell the user where the backup is and how to restore if needed (re-seed from that file as described in README.md, or ask Claude to re-create rows).

## Rules
- Only create rows and patch the dishes listed. Never DELETE or overwrite existing ingredients or steps; if something needs changing, tell the user which row and let them edit it in the app (or ask explicitly before using PATCH).
- Never send planner data anywhere except the planner URL.
- The API has no login and this changes real data, so always dry-run first and get a yes before `--apply`.
- If the LXC is unreachable, say so; do not fall back to editing `seed/` (it only applies to a brand-new database).
