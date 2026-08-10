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

There are also two standalone files, `Dockerfile.server` and `Dockerfile.worker` — target-less duplicates of the same two stages, built the same way minus `--target`:

```bash
docker build -f apps/api/Dockerfile.server -t ilovemusic-api-server .
docker build -f apps/api/Dockerfile.worker -t ilovemusic-api-worker .
```

These exist because **Render's Blueprint spec has no field to select a multi-stage build target** (confirmed against Render's own docs — no `dockerTarget` or equivalent). `render.yaml` points at these two files instead of the combined `Dockerfile`. If you ever move off Render to a platform that does support `--target`, the combined `Dockerfile` is still there and still the one to prefer (one file, less to keep in sync). Until then, changing deps or the build steps means updating all three Dockerfiles.

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

**Decided: Render.** The rest of this section is specific to it.

## Deploying to Render

`render.yaml` (repo root) is a [Blueprint](https://render.com/docs/blueprint-spec) defining every service below. This is a walkthrough for **you** to run manually in the Render dashboard — nothing here was provisioned or deployed as part of writing it, and it shouldn't be automated by Claude Code.

### What `render.yaml` defines

| Service | Type | Purpose |
|---|---|---|
| `ilovemusic-postgres` | `databases:` entry (Render Postgres, managed) | Job/API-key/usage data |
| `ilovemusic-redis` | `type: keyvalue` | BullMQ queue + rate limiting |
| `ilovemusic-api-server` | `type: web` | Fastify HTTP API, `Dockerfile.server` |
| `ilovemusic-api-worker` | `type: worker` | Download job processor, `Dockerfile.worker` |

Postgres and Redis **are** definable directly in the Blueprint (confirmed against Render's docs) — no manual dashboard database creation needed, unlike some platforms. That's genuinely convenient here; the two real limitations are the Docker build target and the shared-secret issue below, both already designed around in the files as written.

### Manual steps (things `render.yaml` can't do for you)

1. **Create a Render account**, connect your GitHub account, and give Render access to the `riporipo223/iam-ilovemusic` repo.
2. **New → Blueprint**, select the repo. Render reads `render.yaml` from the root automatically.
3. Render will show a preview of the 4 resources above before creating anything — **check the Postgres plan name shown in that preview**. `render.yaml` specifies `basic-1gb` as a starting point, but Render's exact Postgres plan slugs weren't verified live (no account exists to check against) — if the preview shows a different/renamed plan, that's expected; just pick the closest equivalent size.
4. During blueprint creation, Render prompts you once per `sync: false` variable **per service**. You'll be prompted for `CREDENTIALS_ENCRYPTION_KEY`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` **twice each** — once for `ilovemusic-api-server`, once for `ilovemusic-api-worker`. See the warning below before filling these in.
5. **Do not apply the blueprint yet if you haven't run migrations.** Order matters: create the Postgres database first (the blueprint does this as part of the same apply, which is fine), get its connection string, run the migration (see below) against it, *then* let the server/worker actually start receiving traffic/jobs. In practice: apply the blueprint, then immediately run the one-off migration command before either service handles real requests — a few seconds of a freshly-booted `server` returning `503` from `/health` (empty `jobs`/`api_keys` tables would still let `SELECT 1` succeed, so this is more about the app being *functionally* ready than the health check specifically) is not the failure mode to worry about; a request hitting `INSERT INTO jobs` before the table exists is.
6. Use `npm run create-api-key --workspace @ilovemusic/api` (from your own machine, pointed at the production `DATABASE_URL`) to mint the first real API key — same script used locally, still your responsibility to run, still never something to paste back into an AI chat.

### ⚠️ `CREDENTIALS_ENCRYPTION_KEY` must match exactly between both services

Render's Blueprint has no way to define a `sync: false` secret once and share it (environment variable groups exist, but explicitly don't support `sync: false` — confirmed against Render's docs). You will be prompted for this value **twice**, independently, for `server` and `worker`. **Paste the identical value both times.** If they diverge, credentials encrypted by one process become undecryptable by the other — worker-side decryption failures for BYOK Spotify credentials, specifically, with no obvious error pointing back at "these two values don't match." Generate it once yourself beforehand (`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`) and keep it somewhere you can paste from twice, rather than trying to type it from memory the second time.

### Env var → Render mapping

| Variable | Render mechanism | Who provides the value |
|---|---|---|
| `DATABASE_URL` | `fromDatabase` (auto) | Render — wires up `ilovemusic-postgres` automatically |
| `REDIS_URL` | `fromService` (auto) | Render — wires up `ilovemusic-redis` automatically |
| `CREDENTIALS_ENCRYPTION_KEY` | `sync: false` | **You**, at blueprint-creation prompt — same value both services |
| `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | `sync: false` | **You** — from your Cloudflare R2 dashboard |
| `R2_BUCKET` | plain `value:` in the YAML | Pre-filled (`ilovemusic-downloads`) — edit the YAML if yours differs; not secret |
| `PORT`, `HOST`, `NODE_ENV`, `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW`, `DOWNLOAD_URL_TTL_SECONDS`, `WORKER_CONCURRENCY` | plain `value:` in the YAML | Pre-filled with the same defaults as `.env.example` |

### Region and sizing

**Region: Singapore.** Render's available regions are Oregon, Ohio, Virginia, Frankfurt, and Singapore — Singapore is the only one in Asia-Pacific. This matters twice over: it's the lowest-latency option to you as the operator/API caller from Indonesia, and — more concretely — your R2 bucket (`ilovemusic-downloads`, created earlier this project) is already set to the **Asia-Pacific** location in Cloudflare's dashboard, so Singapore also minimizes server↔storage latency for every upload/presign, not just server↔you.

**`server`: Starter (512MB / 0.5 CPU).** It never runs ffmpeg/spotdl/aubio — just Fastify routing, DB/Redis queries, and the occasional Spotify Web API call for BYOK credential validation. Genuinely light; scale up only if request volume grows, not because of memory pressure.

**`worker`: Standard (2GB / 1 CPU), not Starter.** This is the one to not under-provision. With the default `WORKER_CONCURRENCY=2`, up to two jobs run concurrently, each potentially spinning up ffmpeg (audio conversion), aubio (BPM), spotdl (which itself shells out to yt-dlp), and — for Spotify jobs specifically — a Python process running librosa/numpy for key detection. librosa alone can comfortably use 150–300MB per invocation depending on track length; multiply by two concurrent jobs plus Node's own overhead plus ffmpeg/spotdl subprocess memory, and Starter's 512MB is a real, not theoretical, OOM risk under simultaneous load. If cost matters more than throughput at first, drop `WORKER_CONCURRENCY` to `1` and Starter becomes plausible — but that serializes every download, so Standard is the more honest "won't fall over under normal use" starting point.

## Findings you should decide on

Nothing below blocks writing this deployment config, and nothing here was changed without flagging it first — these are review items, not silent fixes, except where noted as already fixed.

1. **`WORK_DIR` defaults to the OS temp dir** (`/tmp/ilovemusic-api` in a container). Some PaaS platforms give `/tmp` a small default tmpfs size (occasionally as low as ~64MB). With `WORKER_CONCURRENCY=2` and multi-MB audio files per job, this is plausibly tight under load. Not changed — set `WORK_DIR` to a mounted volume path if your platform's default is small; no code change needed either way, it's an env var.
2. **Already fixed, not just flagged**: `REDIS_URL` and the four `R2_*` variables used to have silent fallbacks (`localhost:6379`, empty strings) instead of being required at boot. A misconfigured production deployment would have started successfully and only failed confusingly on the first real request/job. `assertRuntimeConfig()` now requires all of them — this is config validation, not engine/API logic, so it's in scope for this pass; flagging it here anyway since it changes what counts as a valid `.env`.
3. **Desktop app parity**: only Spotify's desktop flow runs through `packages/engine` (from Fase 1). SoundCloud/Bandcamp desktop downloads still use the original inline `main.js` code. Not a deployment concern for `apps/api`, but worth knowing this asymmetry exists if you're reasoning about "does the engine behave identically everywhere" — it doesn't yet, everywhere.
