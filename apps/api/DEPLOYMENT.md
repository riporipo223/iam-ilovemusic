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

### 1. Domain & DNS — madebyripo.sbs, migrated from Vercel to Cloudflare

**Named tunnel is now the active method**, using a real domain instead of a random `trycloudflare.com` URL. This section explains how that domain got set up, in plain terms — don't assume you already know DNS.

- **Domain**: `madebyripo.sbs`, registered on **Hostinger**. Registration (who owns the domain name, billed yearly) and DNS hosting (who answers "what IP/record does this hostname point to") are separate concerns — a domain can be registered at one company and have its DNS managed by a completely different one. That's exactly what happened here.
- **API subdomain**: `api.madebyripo.sbs` — this is what the tunnel is actually routed to, not the bare root domain.
- **Nameserver migration, Vercel → Cloudflare**: A domain's **nameservers** are what determine *which provider is authoritative for its DNS* — i.e., who the rest of the internet asks "what does this hostname resolve to?" Changing nameservers moves DNS *management* from one provider to another; it does **not** move the domain registration itself (Hostinger stays the registrar either way). This domain's nameservers were changed from Vercel's (`ns1.vercel-dns.com`, `ns2.vercel-dns.com`) to Cloudflare's (`john.ns.cloudflare.com`, `kia.ns.cloudflare.com`) specifically so Cloudflare could issue DNS records and a certificate for it. The domain was idle on Vercel beforehand — no live project depended on it, so this wasn't a disruptive cutover.
- **DNS propagation is not instant.** Once nameservers are changed at the registrar, that change has to spread to every DNS resolver on the internet that might have cached the old answer — anywhere from a few minutes to **up to 24 hours**, governed by TTL (time-to-live) values cached at each resolver. This is why `dig NS madebyripo.sbs` can keep showing the *old* nameservers for a while after the change was made at Hostinger — that's expected, not a sign anything is broken. Re-check periodically rather than assuming a single failed lookup means the migration didn't take.
- **SSL only works after the zone is Active.** Once Cloudflare's dashboard shows the zone status as **Active** (meaning it's confirmed itself as authoritative — i.e., the nameserver change has propagated enough for Cloudflare to see it), it automatically issues a **Universal SSL** certificate covering the root domain and first-level subdomains (`madebyripo.sbs` and `*.madebyripo.sbs`, which covers `api.madebyripo.sbs`). **Before that certificate exists, HTTPS to any subdomain on this domain will fail the TLS handshake** — not a bug, not a misconfiguration, just a certificate that doesn't exist yet. `curl`'s `SSL_ERROR_SYSCALL` (rather than a clean "could not resolve host") is the specific symptom of this: DNS resolves to *something*, but there's no valid cert being served for that hostname yet.
- **As of the most recent check in this session, `dig NS madebyripo.sbs` still returned Vercel's nameservers** (`ns1.vercel-dns.com`, `ns2.vercel-dns.com`), and `https://api.madebyripo.sbs/health` failed with exactly the TLS symptom described above — confirmed directly, not assumed. This means the nameserver change likely hasn't finished propagating yet (or wasn't fully completed at Hostinger's end) as of this write-up. **Re-run `dig NS madebyripo.sbs` and re-test `curl https://api.madebyripo.sbs/health` before relying on this domain being live** — don't take this doc's word for it being reachable.

### 2. Cloudflare Tunnel — Named Tunnel (active method) + Quick Tunnel (fallback)

**Named tunnel is the active configuration**, using the domain above. Unlike Quick Tunnel, it needs a Cloudflare account, a domain on Cloudflare (previous section), and a one-time `cloudflared tunnel login` — but in exchange, the URL is **persistent**: `api.madebyripo.sbs` stays the same across every Mac restart, tunnel reconnect, and crash, for as long as the tunnel exists. That's the core trade-off versus Quick Tunnel: **named tunnel is a stable URL that costs an account + domain to set up once; Quick Tunnel is a zero-setup URL that's a different random string every single time the process reconnects.** Quick Tunnel is kept as the fallback/emergency option — see the end of this section for when to fall back to it.

Setup that was actually run for this domain (documented here for reference/future re-setup, not something to re-run unless you're starting over):

```bash
brew install cloudflared
cloudflared tunnel login                        # opens a browser, authorizes cloudflared against your Cloudflare account
cloudflared tunnel create ilovemusic-api         # prints a tunnel ID, writes ~/.cloudflared/<tunnel-id>.json (the tunnel's private key — treat like any other credential, never commit it)
cloudflared tunnel route dns ilovemusic-api api.madebyripo.sbs
```

- **Tunnel ID**: `219cb51d-7f8e-4ae0-b8f3-42394bb102ae` — this identifies the tunnel object in Cloudflare's system. It's fine for this to be public (it's in `apps/api/cloudflared/config.yml`, which is committed) — it's not a secret by itself, the same way a database's primary key isn't a secret. The actual sensitive material is `~/.cloudflared/219cb51d-7f8e-4ae0-b8f3-42394bb102ae.json`, the tunnel's private credentials file, which lives only in your home directory and is never referenced by value anywhere in this repo — only by path.
- **`cloudflared tunnel route dns`** creates a CNAME record pointing `api.madebyripo.sbs` at `<tunnel-id>.cfargotunnel.com` — a special Cloudflare-only hostname for reaching a specific tunnel, not a regular IP address. This CNAME only does anything once Cloudflare is actually authoritative for the zone (see DNS propagation above) — creating it earlier doesn't error, it just has no effect on the public internet until the nameserver migration completes.
- **`apps/api/cloudflared/config.yml`** is the active, filled-in config (real tunnel ID, real `credentials-file` path, real hostname) — committed to the repo, since none of that is secret (see above). **`apps/api/cloudflared/config.named-tunnel.yml.example`** is kept alongside it as a placeholder template (literal `<TUNNEL_ID>`, `api.yourdomain.com`) for setting this up again on a different domain/machine — not loaded by anything, reference only.
- **`apps/api/launchd/com.ilovemusic.cloudflared.plist`** now runs named-tunnel mode: `cloudflared tunnel --config apps/api/cloudflared/config.yml run`. **This must point at `config.yml`, not `config.named-tunnel.yml.example`** — pointing it at the `.example` file was a real bug hit during this migration (cloudflared fails immediately with `Tunnel credentials file '.../<TUNNEL_ID>.json' doesn't exist`, since that literal placeholder string is never a real path). Fixed and verified: the tunnel now registers successfully with Cloudflare's edge under this config.
- **Falling back to Quick Tunnel**, if the named tunnel ever has a problem you need to work around quickly: swap `com.ilovemusic.cloudflared.plist`'s `ProgramArguments` back to `["cloudflared", "tunnel", "--url", "http://localhost:3000"]` (no `--config` flag), reload via `launchctl unload`/`load`, then read the new random URL with `get-tunnel-url.sh` below. No account/domain interaction needed for this fallback — that's the whole point of keeping Quick Tunnel available rather than deleting the old setup.

### 3. Reading the current URL — mainly relevant if you've fallen back to Quick Tunnel

With the named tunnel active, `api.madebyripo.sbs` doesn't change — you don't need this script day-to-day anymore. It's still here for the Quick Tunnel fallback case, where the URL *does* change on every reconnect:

```bash
apps/api/scripts/get-tunnel-url.sh
# -> https://some-random-words-1234.trycloudflare.com
```

If you're running named tunnel (the default now) and this script returns something, that's leftover from a past Quick Tunnel session's log — ignore it and use `api.madebyripo.sbs` directly.

### 4. Auto-start everything via launchd (macOS's equivalent of systemd — this is a Mac, not a Linux server)

Three new LaunchAgents, one each for the server, the worker, and cloudflared — in `apps/api/launchd/`. Read each file's header comment; they explain the reasoning (built output not `npm run dev`, absolute paths since launchd doesn't source your shell profile, `KeepAlive` for auto-restart on crash). The active `com.ilovemusic.cloudflared.plist` now runs named-tunnel mode (`--config apps/api/cloudflared/config.yml`) — the `.named-tunnel.plist.example` file that used to describe this mode has been folded into the now-active plist itself; that `.example` file's role is now historical/template reference for setting this up fresh elsewhere.

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

### 5. URL stability — why the named-tunnel migration happened

This used to be the point in this doc where Quick Tunnel's URL instability was flagged as a real fit constraint: fine for manual testing/live demos where you're present to re-fetch the current URL, **not** fine for anything that references the URL without you there to update it — a GitHub README link, a portfolio entry, or GitBook documentation with a fixed API base URL. That constraint is exactly why the named-tunnel migration above happened: `api.madebyripo.sbs` doesn't have this problem — it's the same URL across restarts, reconnects, and crashes, for as long as the tunnel exists.

If you're temporarily back on the Quick Tunnel fallback (previous section) for any reason, the old constraint applies again for as long as you're on it: fine for testing where you're present, not fine for anything unattended.

### 6. Security hardening for "exposed from a home network" specifically

Reviewed against the actual current code, not assumed:

- **`/health` doesn't leak internals** — verified directly in `src/routes/health.ts`: it returns only `'ok'`/`'error'` strings per dependency, never the underlying error message or a stack trace. Nothing to change here.
- **Error responses generally don't leak internals either** — the one place a raw `.message` reaches a client is `PUT /v1/spotify-credentials`, and that's *Spotify's own* rejection reason being relayed back to the caller who submitted those exact credentials (deliberate UX, not an internal leak — they already know what they sent).
- **IP + timestamp logging already exists** — Fastify's request logger (already configured in `server.ts`) logs `remoteAddress` and a timestamp for every request by default; you've been seeing this in every dev session's console output already. Once running under launchd, this goes to `~/Library/Logs/ilovemusic-api-server.log` instead of a terminal — that log file *is* your access audit trail. Nothing new needed to get IP+timestamp specifically.
- **Not done, and deliberately out of scope for this pass**: logging *which API key* made each request (only the IP is logged automatically; correlating that to a specific key would mean adding a log line inside `auth.ts`, which is application code, not infra/ops config — flagged here as a real gap worth a future small change, not silently added now).
- **Rate limiting — recommend tightening the values for this specific scenario**, not the mechanism itself (already sound: per-API-key with an IP fallback, already in place since Fase 1). `RATE_LIMIT_MAX`/`RATE_LIMIT_WINDOW` are env vars, so this is a config change, not a code change. Default is `20` per `1 minute`. For a home-exposed instance without the traffic-absorbing infrastructure a real platform gives you, consider lowering to something like `10` per `1 minute` in this deployment's `.env` — still generous for legitimate use (each request either creates a real download job or checks one job's status), meaningfully more conservative against casual probing from the public internet.

**Read before you do anything else:**
- **Never add an `ingress` rule for Postgres (5432) or Redis (6379) in `config.yml`, ever, for any reason** — including "just for a minute to debug something." Neither has meaningful auth against a public connection; the entire local dev setup trusts localhost implicitly. If you need to inspect them remotely, tunnel over SSH instead, not through this Cloudflare Tunnel.
- **Never lower/disable rate limiting "just to test something" and forget to revert it.** If you do this, set a calendar reminder before you touch `.env`, not after.

### 7. `spotdl` and `quickjs` — this worker's actual binary setup, not the Docker plan's

The **Images** section above (and `packages/engine/scripts/requirements.txt`) describes a Docker `worker` image with `spotdl`/`yt-dlp`/`librosa` all on one shared venv's `PATH` — that's the *unused* Render/Docker plan, not what this self-hosted worker actually runs. This machine's real setup, worked out after `spotdl` turned out to be silently broken for every single Spotify track:

- **`spotdl` needs its own venv, separate from the `librosa`/key-detection one** (`.venv/` at repo root, referenced by `PYTHON_PATH`). Not for any dependency-conflict reason discovered in practice — just to keep spotdl's dependency tree (its own pinned `yt-dlp`, `ytmusicapi`, etc.) from ever being able to affect the already-working key-detection venv, or vice versa. Created the same way:
  ```bash
  python3 -m venv .venv-spotdl
  .venv-spotdl/bin/pip install spotdl
  ```
  **Check spotdl's actual `Requires-Python` before picking a Python version** (`curl -s https://pypi.org/pypi/spotdl/json | python3 -c "import json,sys; print(json.load(sys.stdin)['info']['requires_python'])"`) — don't assume the same version as `librosa`'s venv is fine just because it's already installed. As of spotdl 4.5.2 this is `>=3.10,<3.15`, comfortably covering this machine's Homebrew `python3` (3.14.6 at the time of this writeup) — no separate Python install needed here, but re-check if spotdl's range has narrowed by the time you read this.
  - **Root cause this replaced**: the previously-resolved `spotdl` (`~/Library/Python/3.9/bin/spotdl`, from an old `pip install --user` against Xcode Command Line Tools' bundled Python 3.9) crashed on *every* invocation — `check_ytmusic_connection()` constructs a `YoutubeDL` instance, which detects Python 3.9 as deprecated and logs an error-level message; spotdl's own custom logger turns any error-level message from yt-dlp into a raised `AudioProviderError`, unconditionally. Confirmed via direct reproduction (not assumed) before touching anything: same crash on a previously-successful control track, not just the track that surfaced the report. A newer Python makes this warning not fire at all, not just downgrades it to non-fatal.
  - Set in `.env`: `SPOTDL_PATH=/absolute/path/to/repo/.venv-spotdl/bin/spotdl` (already a supported override in `packages/engine/src/binaries.ts` — `resolveBinary()` needed no code change, just this value).
- **`quickjs` needs its own copy for the worker — the desktop app's `build/bin/quickjs` is packaged into the `.dmg`, never installed anywhere `apps/api` can reach.** Same binary, separate copy, so desktop packaging and this worker's config stay independent (`apps/api/bin/quickjs`, copied from `build/bin/quickjs` — checksum-verified identical to the documented `build/bin/README.md` entry before and after copying, not re-downloaded):
  ```bash
  mkdir -p apps/api/bin
  cp build/bin/quickjs apps/api/bin/quickjs
  ```
  Set in `.env`: `QUICKJS_PATH=/absolute/path/to/repo/apps/api/bin/quickjs` (also a pre-existing override, no code change).
  - **Only matters for the Spotify → YouTube-search fallback and spotdl's own internal yt-dlp call** — confirmed by reading `packages/engine/src/downloader/ytdlp-track.ts` before assuming SoundCloud/Bandcamp needed the same wiring: neither ever searches or extracts from YouTube (they hit soundcloud.com/bandcamp.com URLs directly), so `ytDlpJsRuntimeArgs()` is correctly *not* wired into that file, matching the desktop app's own deliberate omission there. Nothing to change for those two sources.
  - Even with quickjs available, `spotdl`'s own internal yt-dlp match against YouTube Music is genuinely intermittent (~2 of 3 identical attempts succeed in testing) — quickjs can't solve every challenge Deno would. That's a real, accepted limitation, not something this fix claims to eliminate; the existing "produced no output file" check + YouTube-search fallback in `packages/engine/src/downloader/spotify.ts` is what actually absorbs the remaining ~1/3.
- **After changing either path**: `launchctl kickstart -k gui/$(id -u)/com.ilovemusic.api.worker` (worker only — `server` never shells out to these, see **Images** above).

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
