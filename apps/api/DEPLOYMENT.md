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

Whichever of these you pick, Postgres/Redis should be managed services (Neon, Upstash, Redis Cloud, etc.), not self-hosted containers next to the app — see the note at the top of `docker-compose.prod.yml`.

**Current status: none of these three are in use.** Render was evaluated first (config below still exists and works) but ruled out — Render requires a credit card on file to run a Background Worker, even within its otherwise-free tier. **Actually in use right now: self-hosting from home via Cloudflare Tunnel** — no cloud account, no credit card, no monthly cost. See the next section. The Render config is kept because it's genuinely useful later if/when this needs real uptime guarantees — see that section's own note on when self-hosting stops being the right call.

## Self-Hosting via Cloudflare Tunnel

**This is the setup actually in use.** Everything runs on your own Mac — the same processes as local dev (`server`, `worker`, Postgres, Redis) — made reachable from the internet via a Cloudflare Tunnel instead of a cloud deployment. Free, no port forwarding on your router, no credit card. The trade-off is explicit: **this has no SLA. The API is only reachable while your Mac is on, awake, and connected to the internet.** Fine for testing, demos, and a portfolio link; not something to point real users at.

### What's already true, corrected from an earlier assumption

Postgres and Redis for local dev run via **Homebrew (`brew services`), not `docker-compose.yml`** — confirmed by checking this machine directly, not assumed. This is good news, not a gap: `brew services start postgresql@16` and `brew services start redis` already register their own auto-starting `launchd` LaunchAgents (Homebrew does this for you) — `~/Library/LaunchAgents/homebrew.mxcl.postgresql@16.plist` and the Redis equivalent already exist on this machine. **Nothing to set up for these two** — if `brew services list` shows them as `started`, they'll already come back up after a reboot. (Docker *is* installed on this machine too, from building the Render images earlier — but switching Postgres/Redis to Docker now would just be churn for a setup that already auto-starts correctly, so this doc doesn't recommend it.)

What genuinely needs new configuration: the API **server**, the **worker**, and **cloudflared** itself — none of those exist as long-running background services yet.

### 1. Cloudflare Tunnel — Quick Tunnel (currently active; no domain needed)

**In use right now, because no domain is registered on Cloudflare.** Quick Tunnel needs no `cloudflared tunnel login`, no `tunnel create`, no `config.yml` at all — just one CLI flag pointed at the local server. The cost of that simplicity: Cloudflare hands back a **random `https://<random-words>.trycloudflare.com` URL that changes every time the tunnel (re)connects** — not pinnable, not something you register once and forget. See "URL stability trade-offs" below before deciding this is the right mode for what you're using it for.

Setup (run yourself — Claude Code has no access to your Cloudflare account and didn't run any of this):

```bash
brew install cloudflared
```

That's it — no login, no account interaction needed for Quick Tunnel mode. The launchd agent (next section) runs `cloudflared tunnel --url http://localhost:3000` directly; there's nothing else to configure.

**If you get a domain on Cloudflare later** and want a stable URL instead: `apps/api/cloudflared/config.named-tunnel.yml.example` and `apps/api/launchd/com.ilovemusic.cloudflared.named-tunnel.plist.example` are the named-tunnel equivalents, kept specifically for this — not deleted, not currently active. To switch: `cloudflared tunnel login` + `cloudflared tunnel create ilovemusic-api` (writes `~/.cloudflared/<tunnel-id>.json`), fill in the real `<TUNNEL_ID>` in the `.example` config and rename it to `config.yml`, then rename the `.example` plist to replace the active `com.ilovemusic.cloudflared.plist` (reload via `launchctl unload`/`load`). Both `.example` files already reflect the same single-port/no-Postgres-Redis-ingress design as the active setup — read their header comments when you get there.

### 2. Reading the current URL — it changes, so don't try to remember it

`apps/api/scripts/get-tunnel-url.sh` reads the tunnel's own log for the most recently announced URL:

```bash
apps/api/scripts/get-tunnel-url.sh
# -> https://some-random-words-1234.trycloudflare.com
```

Run this after every Mac restart, tunnel reconnect, or crash-triggered `KeepAlive` restart — anything that makes the plist below relaunch `cloudflared` assigns a new URL. There is no notification for this; the only way to know is to ask (this script) or watch the log (`tail -f ~/Library/Logs/ilovemusic-cloudflared.log`).

### 3. Auto-start everything via launchd (macOS's equivalent of systemd — this is a Mac, not a Linux server)

Three new LaunchAgents, one each for the server, the worker, and cloudflared — in `apps/api/launchd/`. Read each file's header comment; they explain the reasoning (built output not `npm run dev`, absolute paths since launchd doesn't source your shell profile, `KeepAlive` for auto-restart on crash). The active `com.ilovemusic.cloudflared.plist` runs Quick Tunnel mode (no `--config` flag) — the `.named-tunnel.plist.example` alongside it is the inactive alternative described above.

**Before installing any of them**, build the app once — launchd runs the compiled `dist/`, not `tsx`:

```bash
npm run build --workspace @ilovemusic/engine
npm run build --workspace @ilovemusic/api
```

**Verify the hardcoded paths in each `.plist` actually match this machine** before installing — `node` and `cloudflared`'s paths were confirmed directly on this machine (`which node`, `which cloudflared`), not guessed, but re-check if you're setting this up somewhere else:

```bash
mkdir -p ~/Library/LaunchAgents ~/Library/Logs
cp apps/api/launchd/com.ilovemusic.api.server.plist ~/Library/LaunchAgents/
cp apps/api/launchd/com.ilovemusic.api.worker.plist ~/Library/LaunchAgents/
cp apps/api/launchd/com.ilovemusic.cloudflared.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.ilovemusic.api.server.plist
launchctl load ~/Library/LaunchAgents/com.ilovemusic.api.worker.plist
launchctl load ~/Library/LaunchAgents/com.ilovemusic.cloudflared.plist
```

(Only the three active `.plist` files — not the `.named-tunnel.plist.example` one, which isn't meant to be loaded until you've switched modes per the section above.)

Check they're actually running, and watch the logs (`~/Library/Logs/ilovemusic-*.log`) for the first minute:

```bash
launchctl list | grep ilovemusic
tail -f ~/Library/Logs/ilovemusic-api-server.log
apps/api/scripts/get-tunnel-url.sh   # confirm you can see today's URL
```

After any code change: rebuild, then `launchctl unload` + `launchctl load` the relevant agent (server/worker only — cloudflared doesn't need reloading for app code changes, only if you edit its own config/plist).

### 4. URL stability trade-offs — read this before sharing the URL anywhere

Quick Tunnel's URL instability isn't a minor inconvenience to work around, it's a real fit constraint:

**Fine for**: manual testing against a real public URL, live demos where you paste the current URL to someone while you're both looking at it, one-off end-to-end verification. In all of these you're present at the moment the URL matters, so "it changed since last time" is a non-issue — you just run `get-tunnel-url.sh` right before you need it.

**Not fine for**: anything that references the URL *without you being there to update it* — a link in the GitHub README, a CV/portfolio entry, or (specifically flagged since it's on the roadmap) **GitBook documentation that would reference a fixed API base URL**. Any of these would silently break the next time the tunnel reconnects, with no mechanism to notify whoever's reading that stale link. If/when GitBook docs happen, that's exactly the point to either switch to the named-tunnel setup above (needs a domain) or move to a real platform deployment (`## Deploying to Render`, below) — not to keep using Quick Tunnel and hope the Mac never restarts.

### 5. Security hardening for "exposed from a home network" specifically

Reviewed against the actual current code, not assumed:

- **`/health` doesn't leak internals** — verified directly in `src/routes/health.ts`: it returns only `'ok'`/`'error'` strings per dependency, never the underlying error message or a stack trace. Nothing to change here.
- **Error responses generally don't leak internals either** — the one place a raw `.message` reaches a client is `PUT /v1/spotify-credentials`, and that's *Spotify's own* rejection reason being relayed back to the caller who submitted those exact credentials (deliberate UX, not an internal leak — they already know what they sent).
- **IP + timestamp logging already exists** — Fastify's request logger (already configured in `server.ts`) logs `remoteAddress` and a timestamp for every request by default; you've been seeing this in every dev session's console output already. Once running under launchd, this goes to `~/Library/Logs/ilovemusic-api-server.log` instead of a terminal — that log file *is* your access audit trail. Nothing new needed to get IP+timestamp specifically.
- **Not done, and deliberately out of scope for this pass**: logging *which API key* made each request (only the IP is logged automatically; correlating that to a specific key would mean adding a log line inside `auth.ts`, which is application code, not infra/ops config — flagged here as a real gap worth a future small change, not silently added now).
- **Rate limiting — recommend tightening the values for this specific scenario**, not the mechanism itself (already sound: per-API-key with an IP fallback, already in place since Fase 1). `RATE_LIMIT_MAX`/`RATE_LIMIT_WINDOW` are env vars, so this is a config change, not a code change. Default is `20` per `1 minute`. For a home-exposed instance without the traffic-absorbing infrastructure a real platform gives you, consider lowering to something like `10` per `1 minute` in this deployment's `.env` — still generous for legitimate use (each request either creates a real download job or checks one job's status), meaningfully more conservative against casual probing from the public internet.

**Read before you do anything else:**
- **Never add an `ingress` rule for Postgres (5432) or Redis (6379) in `config.yml`, ever, for any reason** — including "just for a minute to debug something." Neither has meaningful auth against a public connection; the entire local dev setup trusts localhost implicitly. If you need to inspect them remotely, tunnel over SSH instead, not through this Cloudflare Tunnel.
- **Never lower/disable rate limiting "just to test something" and forget to revert it.** If you do this, set a calendar reminder before you touch `.env`, not after.

### Limitations — read this before treating this as more than a demo

- **No uptime guarantee.** The API is unreachable whenever your Mac is off, asleep, restarting, or loses internet — including routine things like a macOS update reboot or closing the lid without a sleep override.
- **No redundancy.** One Mac, one Postgres, one Redis, one path in. A crashed process comes back via `KeepAlive`; a crashed *machine* does not.
- **Not built for real traffic.** No load balancing, no horizontal scaling, home upload bandwidth in the loop for every response.
- **This is fine for what it's for right now** — testing, demos, a portfolio link — and not a reason to over-engineer this setup further. It's a reason to know when to stop using it: once you want something reachable on a schedule other than "whenever my Mac happens to be on," that's the point to revisit the **Deploying to Render** section below (or Fly.io/Railway from the table above) rather than trying to make a home Mac more production-grade than it can reasonably be.

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
