# Deploying apps/api

This documents what's needed to run `apps/api` in production. It does not deploy anything — no account was provisioned, no cloud command was run, no secret was generated as part of writing this. You provision and deploy yourself; this is the reference for what that requires.

## Images

```bash
# from the monorepo root — the build needs packages/engine too
docker build -f apps/api/Dockerfile --target server -t ilovemusic-api-server .
docker build -f apps/api/Dockerfile --target worker -t ilovemusic-api-worker .
```

Two images, deliberately different weight:

- **`server`** — Fastify HTTP layer only. Never shells out to spotdl/yt-dlp/ffmpeg/aubio/python3, so none of that is installed. Small, fast to build, fast to cold-start.
- **`worker`** — everything `server` has, plus `ffmpeg`, `aubio-tools`, and a Python venv with `spotdl`, `yt-dlp`, `librosa`/`numpy` (from `packages/engine/scripts/requirements.txt`) on `PATH`. This is the only process that actually runs `packages/engine`'s download pipeline, so it's the only one that needs the heavy toolchain.

Both run as **separate deployments/services** — they scale independently (the worker is the one under load during a burst of downloads; the server barely does any work per request) and a crash in one shouldn't take the other down.

## Environment variables

See `.env.example` — every variable there is annotated `[SECRET]` or `[PUBLIC]`. All of them are validated at boot (`assertRuntimeConfig()` in `src/config.ts`) — the process refuses to start if any is missing, rather than starting and failing confusingly on the first real request or job. Both `server` and `worker` read the same full set (simplest to reason about — no risk of "works on server, breaks on worker" from divergent env configs), even though `server` never directly touches the download-tool-related ones.

## Migrations

**Not run automatically on boot.** Neither `server.ts` nor `worker.ts` calls the migration logic — if they did, and you scale to multiple instances, you'd get multiple processes racing to apply the same migration simultaneously on startup. Instead:

```bash
docker run --rm --env DATABASE_URL=... ilovemusic-api-server node apps/api/dist/db/migrate.js
```

(Either image works — both have `dist/db/migrate.js`; `server` is smaller so slightly faster to pull for this.) Run this as a one-off step — manually, or as a CI/deploy-pipeline step that runs *before* the new server/worker images go live — never as part of the container's normal startup command. `src/db/schema.sql` is idempotent (`CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`), so re-running it against an already-migrated database is safe.

`npm run migrate` (using `tsx`) still exists for local dev — it's a devDependency, pruned from production images, so production uses the compiled equivalent: `npm run migrate:prod` (`node dist/db/migrate.js`), same script the `docker run` above calls directly.

## Health check

`GET /health` (server only) checks real connectivity — a `SELECT 1` against Postgres and a `PING` against Redis, not just "the process didn't crash." Returns `200 {"ok":true,"checks":{"database":"ok","redis":"ok"}}` when both are reachable, `503` with the specific failing check(s) otherwise. Point your platform's health check / load balancer probe at this, not just a TCP port check — a `200` on this endpoint means the server can actually do its job, not just that it's listening.

The `worker` has no HTTP server and thus no `/health` — its liveness is really "is it still consuming jobs," which is better observed via your queue/BullMQ metrics (or the platform's own process-alive check) than an HTTP probe.

## Graceful shutdown

Both processes handle `SIGTERM`/`SIGINT`:

- **server**: stops accepting new connections, waits for in-flight requests to finish, then exits.
- **worker**: stops pulling new jobs, but **lets a job currently being processed finish** before exiting. This matters specifically because a download job can legitimately take tens of seconds; killing it mid-flight would leave its `jobs` row stuck in `processing` until BullMQ's lock expires and it's retried from scratch — wasteful, and confusing to debug.

Container platforms send `SIGTERM` on redeploy/scale-down/restart, so this is what makes rolling deploys not corrupt an in-progress job.

## Platform options

Three reasonable fits for "one stateless HTTP service + one worker needing Python/CLI binaries + external managed Postgres/Redis." No pick made here on purpose — trade-offs:

| | Fly.io | Railway | Render |
|---|---|---|---|
| Multi-service from one repo (server + worker, different Dockerfile targets) | Yes (`fly.toml` process groups, or two separate apps) | Yes (natively — this is a core Railway feature) | Yes (separate "Web Service" + "Background Worker" resource types) |
| Runs arbitrary Docker images with custom system deps (ffmpeg/aubio/python) | Yes, no restrictions — it's just your container | Yes | Yes |
| Free/cheap tier viable for this shape | Small free allowance, usage-based beyond | Usage-based, less predictable at scale | Web service has a free tier (sleeps on idle — bad for an API); background workers need a paid plan |
| Ops burden | Highest — you think in terms of VMs/regions/volumes | Lowest — closest to "push and it works" | Low — but "Background Worker" as a distinct primitive is exactly this project's shape |
| Good fit for a worker that must not sleep mid-job | Yes | Yes (no idle-sleep on paid) | Only on a paid plan — free web services sleep, which would be a problem for `server`, less so for a paid background worker |

A fourth option worth naming even though it's not in the table: a **plain VPS** (Hetzner, DigitalOcean) running the two Docker images directly via `docker-compose.prod.yml` as a *structural reference* (not run as-is — see the comment at the top of that file). Cheapest at small scale, most control, but you own the ops entirely — restarts, log rotation, monitoring, OS patching. Reasonable for a solo/low-traffic deployment; not something to reach for once there's real load or you want to stop thinking about the host.

Whichever you pick, Postgres/Redis should be managed services (Neon, Upstash, Redis Cloud, etc.), not self-hosted containers next to the app — see the note at the top of `docker-compose.prod.yml`.

## Findings you should decide on

Nothing below blocks writing this deployment config, and nothing here was changed without flagging it first — these are review items, not silent fixes, except where noted as already fixed.

1. **`WORK_DIR` defaults to the OS temp dir** (`/tmp/ilovemusic-api` in a container). Some PaaS platforms give `/tmp` a small default tmpfs size (occasionally as low as ~64MB). With `WORKER_CONCURRENCY=2` and multi-MB audio files per job, this is plausibly tight under load. Not changed — set `WORK_DIR` to a mounted volume path if your platform's default is small; no code change needed either way, it's an env var.
2. **Already fixed, not just flagged**: `REDIS_URL` and the four `R2_*` variables used to have silent fallbacks (`localhost:6379`, empty strings) instead of being required at boot. A misconfigured production deployment would have started successfully and only failed confusingly on the first real request/job. `assertRuntimeConfig()` now requires all of them — this is config validation, not engine/API logic, so it's in scope for this pass; flagging it here anyway since it changes what counts as a valid `.env`.
3. **Desktop app parity**: only Spotify's desktop flow runs through `packages/engine` (from Fase 1). SoundCloud/Bandcamp desktop downloads still use the original inline `main.js` code. Not a deployment concern for `apps/api`, but worth knowing this asymmetry exists if you're reasoning about "does the engine behave identically everywhere" — it doesn't yet, everywhere.
