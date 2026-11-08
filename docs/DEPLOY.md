# Deploying: how it works

```
you / Claude --PR merged to main--> GitHub Action --(tests pass)--> builds image --> GHCR
                                                                                      |
LXC: Watchtower polls GHCR every 5 min --new image?--> pulls it, recreates container <-+
```

## The pieces
- **Image**: the app plus everything it needs, packaged once. Same image runs anywhere.
- **Registry (GHCR)**: GitHub's store for images, at `ghcr.io/<owner>/<repo>`.
- **Tag**: a label on an image. `latest` moves with every build. `sha-<commit>` is fixed forever, which makes it ideal for rollback.
- **Digest**: the image's real fingerprint. Watchtower compares digests, so it knows when `latest` changed.
- **Action**: `.github/workflows/publish.yml`. Tests first; publishing only runs on `main` and only if tests pass.
- **Watchtower**: runs on the LXC (`infra/watchtower/`), updates only containers with the label `com.centurylinklabs.watchtower.enable: "true"`.
- **Volume** (`./data`): your database lives outside the container, so replacing the container never touches it.

## One-time LXC setup
1. Proxmox: container Options -> Features -> enable **nesting** and **keyctl**, restart.
2. Install Docker + the compose plugin.
3. Shared Watchtower (once per LXC): copy `infra/watchtower/docker-compose.yml` to `/opt/watchtower/` and run `docker compose up -d`.
4. Per app: folder such as `/opt/christmas-planner` with `docker-compose.yml`; `mkdir -p data && chown 1000:1000 data`; `docker compose up -d`.

## Everyday: ship a change
1. Change code on a branch, open a PR. The Action runs the tests on the PR.
2. Merge the PR into `main`.
3. Action publishes `latest` + `sha-<commit>`. Within ~5 minutes Watchtower swaps the container.

Watch it: Actions tab on GitHub; `docker logs watchtower` (or Portainer) on the LXC.

## Roll back
1. Find the last good commit on GitHub and copy its first 7 characters.
2. On the LXC edit the app's compose file: `image: ghcr.io/<owner>/<repo>:sha-<those7>`.
3. `docker compose up -d`.
Watchtower only watches the digest of the tag you pinned, so it will stay put. When fixed, switch back to `:latest` (or revert the PR on GitHub, which republishes a good `latest`, the easier route).

Portainer can do the same: Containers -> the app -> Duplicate/Edit -> change the image tag.

## Data safety
- Updates never touch `./data`. Still, take a backup before big changes: `curl http://localhost:3000/api/export > backup.json`.
- Database changes should only ever add things (new columns/tables), never remove, so an older image can still read a newer database.
- Don't merge to `main` close to a big event (25 December!).

## Repo settings to turn on (GitHub, in the browser)
- **Settings -> Branches -> Add rule** for `main`: require a pull request before merging, and require the **test** check to pass. This makes the merge gate real.
- **Settings -> General -> Template repository**: tick it, so new projects can start from this layout.
- Package visibility: Packages -> the image -> Package settings -> Public (so the LXC needs no login).

## Common problems
| Symptom | Cause / fix |
|---|---|
| `unable to open database file` | `./data` owned by root. `chown -R 1000:1000 data`. |
| `denied` on pull | Package still private. Make public or `docker login ghcr.io`. |
| Docker won't start in LXC | Enable nesting + keyctl, restart LXC. |
| Nothing updates | Missing `watchtower.enable` label, or Action failed. Check both logs. |
| Image name rejected | GHCR names must be lowercase. |
