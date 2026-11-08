# Christmas Dinner Planner (self-hosted)

Tiny Node 24 server (no npm packages) + SQLite + the planner page. Data lives in `./data/planner.db`.

## Run
```
docker compose up -d --build
```
Open `http://<host-ip>:3000`. First start seeds the database from `seed/christmas-dinner-data.json`. Other open devices pick up edits within about 3 seconds.

Change the port by editing the left number in `ports:` in `docker-compose.yml`.

**Proxmox LXC:** Docker needs the container's Options → Features to have **nesting** and **keyctl** enabled (then restart the LXC).

## Run without Docker (for testing)
```
PORT=3000 DB_PATH=./data/planner.db node server.js
```
(PowerShell: `$env:PORT=3000; $env:DB_PATH="./data/planner.db"; node server.js`)

## Smoke test
- Counts match the old page: 13 dishes, 50 ingredients, 35 schedule steps, serve time 14:00.
- Add, edit, tick and delete on each tab; try the ingredient filters.
- Two browser windows: change one, the other updates within ~3s.
- `docker compose down && docker compose up -d`: edits are still there.
- Phone on the same Wi-Fi: layout and editing work.
- Block fonts.googleapis.com: page still usable (fallback fonts).

## Back up
- Any time: `curl http://localhost:3000/api/export > backup-$(date +%F).json` (same format as the seed file).
- Or copy the folder while stopped: `docker compose stop && cp -r data data-backup && docker compose start`.

## Restore / re-seed
- Back to the original snapshot: `docker compose down && rm data/planner.db* && docker compose up -d`
- From a backup JSON: replace `seed/christmas-dinner-data.json` with it, delete `data/planner.db*`, then `docker compose up -d --build`.
- From a copied folder: stop, put the `data` folder back, start.
- Wipe and reseed in place: `docker compose run --rm planner node server.js --reseed`.

## Update
Copy or `git pull` the new files, then `docker compose up -d --build`. The data folder is kept.
