# CLAUDE.md — ILoveMusic Project Documentation

Guidance for AI assistants (and human contributors) working in this repository.

---

## Project overview

- **Name**: ILoveMusic
- **What it is**: an Electron desktop app for downloading, organizing, and previewing music from Spotify, SoundCloud, and Bandcamp — built for DJs and music collectors who want clean metadata, automatic BPM detection, and a local-first library.
- **License**: MIT
- **Platform**: macOS, Windows, Linux (Electron)

The project has two parts today:

1. **Desktop app** (root of the repo) — the original, released product. Electron + React.
2. **`packages/engine` + `apps/api`** — a shared download/processing engine extracted from the desktop app, plus a companion job-based API service that runs the same engine outside Electron. This is newer, unreleased, and currently only runs locally (no production deployment). It exists so the download/BPM/metadata logic isn't duplicated between the desktop app and any future non-Electron consumer. See `apps/api/README.md` for how to run it.

Philosophy carried over from the original project and still binding:

- lightweight, hackable, local-first, maintainable
- avoid unnecessary complexity, over-engineered abstractions, bloated dependencies
- understand before modifying — if you're unsure why something exists, don't rewrite it blindly

---

## Repository structure

```
ILoveMusic/
├── main.js, preload.js        # Electron main process + IPC bridge (desktop app)
├── renderer/                  # React UI (Vite)
├── electron-builder.yml       # Desktop app packaging config
│
├── packages/engine/           # Shared download/processing engine (TS)
│   ├── src/downloader/        # spotify.ts, soundcloud.ts, bandcamp.ts, ytdlp-track.ts
│   ├── src/processing/        # bpm.ts, key.ts, metadata.ts
│   ├── src/binaries.ts        # Resolves spotdl/yt-dlp/ffmpeg/aubio/python3 across dev+prod+server
│   ├── src/url.ts             # Source detection + URL validation (incl. Bandcamp album guard)
│   └── scripts/detect_key.py  # librosa-based key detection (Spotify only)
│
├── apps/api/                  # Companion job-based download API (Fastify + BullMQ), local-only
│   ├── src/                   # server.ts, worker.ts, routes/, db/, storage/, queue/
│   ├── scripts/                # create-api-key, migrate, verify-infra, verify-e2e
│   └── README.md
│
├── docs/                      # Current, still-relevant technical notes
│   └── archive/               # Historical/superseded docs (status reports, old proposals) — kept for reference, not maintained
│
├── README.md, CHANGELOG.md, CONTRIBUTING.md
└── CLAUDE.md                  # This file
```

`packages/engine` is a private npm workspace (never published) consumed by both `main.js` (via `require('@ilovemusic/engine')`, built to `dist/`) and `apps/api`.

---

## How downloads actually work, per source

This matters more than it looks — the three sources are architecturally very different, and it's easy to assume they work the same way. They don't.

### Spotify — BYOK, official metadata API + spotdl

- Metadata comes from the real Spotify Web API (Client Credentials flow) — `packages/engine/src/spotify-api.ts`.
- **Every API caller brings their own Spotify Developer App credentials** (`PUT /v1/spotify-credentials`, encrypted at rest, AES-256-GCM). The platform holds no shared Spotify app. This exists because Spotify now requires the app owner to have an active Premium subscription and caps Development Mode apps — a shared platform credential would either need Extended Quota approval (250k MAU minimum) or hit that cap almost immediately.
- **The desktop app's single-track Spotify flow does not hold a Spotify Client Secret at all** — it calls `GET /v1/spotify-metadata` (a *non*-BYOK proxy backed by `PLATFORM_SPOTIFY_CLIENT_ID`/`PLATFORM_SPOTIFY_CLIENT_SECRET`, the platform operator's own credentials, not a per-consumer registration) to fetch metadata, then feeds that into `packages/engine`'s `processSpotifyTrack()` via its `metadata` option instead of `spotify` credentials. This exists because a packaged Electron app's `asar` is trivially extractable, so bundling a real Client Secret into a public `.dmg` would leak it. `spotdl` itself (the actual audio download/matching step) doesn't need Spotify credentials at all as invoked here — confirmed against spotDL's own source: it only requires them when `--use-official-api`/`--auth-token`/`--user-auth`/`--use-cache-file` are passed, none of which this app passes, so it runs against spotDL's built-in unauthenticated client. Two *other* desktop Spotify code paths still use local `SPOTIFY_CLIENT_ID`/`SPOTIFY_CLIENT_SECRET` from `.env` directly and were deliberately left unchanged: the SoundCloud/Bandcamp BPM/key cross-reference fallback (`getBpmKeyFromSpotify` in `main.js`) and Spotify album downloads (`download-spotify-album`) — both call the official Spotify Web API for something other than a single track's core metadata, out of scope for the proxy migration.
- Audio itself never comes from Spotify — `spotdl` matches the track against YouTube Music and downloads from there, falling back to a raw `yt-dlp` YouTube search if spotdl fails.
- Key detection uses `packages/engine/scripts/detect_key.py` (librosa) — the only source that gets real key detection.

### SoundCloud & Bandcamp — no auth, yt-dlp only

- No official API for either. `packages/engine/src/downloader/ytdlp-track.ts` is the **one shared implementation** — confirmed by direct investigation that the original desktop code ran both sources through identical logic, since yt-dlp normalizes both extractors' output into the same field schema. `soundcloud.ts` and `bandcamp.ts` are thin aliases over it, not duplicates. If you're adding source-specific behavior, it almost certainly belongs in `ytdlp-track.ts` behind an `options.source` check, not copy-pasted into a new file.
- yt-dlp's `--print-json` dump doubles as both URL validation and the metadata source — there's no separate "resolve" call.
- BPM: tags → description → title → embedded audio metadata → aubio audio analysis (in that order). Key: tags/description/embedded metadata only — **no librosa call for these two sources**. A `null` key on a successful SoundCloud/Bandcamp job is expected, not a bug.
- Artwork: an 8-tier fallback chain across the various fields yt-dlp might populate, ending in a `--write-thumbnail` yt-dlp call if nothing else resolved. That last-resort call writes to an **absolute path via `-o`, never `process.chdir()`** — the original Electron code used chdir there, which is safe for a single-job-at-a-time desktop app but a real race condition in the API's concurrent worker. Don't reintroduce chdir here.
- **Bandcamp album/playlist URLs are explicitly rejected before a job is queued** (`isBandcampTrackUrl` in `url.ts`, whitelists `/track/` paths). yt-dlp treats an album/artist page as a playlist and would attempt to download the whole thing into one job's single expected output file — undefined, corrupt behavior. Track vs. album routing has no equivalent guard in the desktop app because the UI uses separate IPC channels for track-add vs. album-add; the API has no such UI-level distinction, so it has to validate the URL shape itself.

---

## Design system (desktop UI — unchanged by the engine/API work)

- Brutalist/minimal aesthetic, dark theme, glassmorphism panels, animated gradient background
- Accent: electric blue `#00D4FF`
- Monospace fonts, all text uppercase, sharp corners (no border-radius)
- Native macOS traffic lights / window chrome — see `docs/macos-window-controls.md` and `docs/scrollbar-hide.md`

---

## Development

```bash
git clone git@github.com:riporipo223/iam-ilovemusic.git
cd iam-ilovemusic
npm install                    # root workspace (desktop app + packages/engine + apps/api)
npm install --prefix renderer  # renderer has its own lockfile, installed separately

cp .env.example .env           # Spotify credentials for the desktop app only
npm run dev                    # builds packages/engine, then runs Vite + Electron
```

External tools required for the desktop app (and for `apps/api`'s worker, if you run it): `ffmpeg`, `aubio`, `spotdl` (Python), `yt-dlp`. `packages/engine/src/binaries.ts` resolves these via env var override → `ILOVEMUSIC_BIN_DIR` → common local dev paths → bare `PATH` lookup, in that order — see that file before hardcoding a new path.

`apps/api` is a separate local service (Fastify + BullMQ + Postgres + Redis + R2) — see `apps/api/README.md` for setup and its manual E2E verification script. It is not deployed anywhere; running it requires your own Postgres/Redis/R2.

### Testing

- `packages/engine`: `npm test --workspace @ilovemusic/engine` (vitest — BPM/key fallback tiers, artwork fallback tiers, URL guards, and a concurrency test that actually exercises two parallel jobs to catch races like the chdir issue above)
- `apps/api`: `npm test --workspace @ilovemusic/api` (vitest — route validation, auth, credential gating scoped correctly per source)
- Desktop app: no automated test suite — manual verification (add a track from each source, play, edit metadata, download, export)

---

## Security notes

- Spotify credentials: desktop app reads from local `.env` (gitignored, never committed). API callers' credentials are AES-256-GCM encrypted at rest, keyed by a separate `CREDENTIALS_ENCRYPTION_KEY` env var — never logged, never returned in any API response after registration.
- **Desktop app's `.env` path is resolved explicitly in `main.js`, not left to dotenv's default.** In dev, it's `path.join(__dirname, '.env')` (project root); in a packaged build, `path.join(app.getPath('userData'), '.env')` — on macOS, `~/Library/Application Support/ilovemusic-desktop/.env`, which is **not** created automatically and must be copied/created there manually (`.env` is never bundled into the app, same reasoning as `build/bin/`'s binaries). This was a real, previously-shipped bug: dotenv's default lookup is `cwd`-relative, which only worked under `npm run dev` by coincidence, and silently left every credential unset in a Finder-launched packaged app. **The folder name is `ilovemusic-desktop` (from `package.json`'s `"name"`), not `ILoveMusic`** — electron-builder's `productName` ("ILoveMusic") only affects the `.app` bundle name and DMG filename, not `app.getName()`/`app.getPath('userData')`, since it's never injected into the packaged `app.asar`'s `package.json`. Confirmed against a real running instance's `--user-data-dir` launch argument (`ps aux`), not assumed — an earlier attempt at this fix assumed the `.app` bundle's `CFBundleName` instead, which was wrong. `npm run verify:env` / `npm run verify:env:packaged` (`scripts/verify-env-loading.js`) check which vars actually load for each mode without needing to launch the Electron GUI — the desktop app has no automated test suite, so this is the closest thing to a regression guard for this bug class.
- API keys (`apps/api`) are stored as a deterministic SHA-256 hash (safe here specifically because the plaintext is always a 24-byte crypto-random token, not a user-chosen password) — never as plaintext, never as a per-row-salted hash (which would prevent the indexed lookup the auth path needs).
- Never commit `.env` files. `apps/api/.env.example` documents required variables without real values.

---

## For AI assistants

- Read `packages/engine/src/downloader/ytdlp-track.ts` before touching SoundCloud or Bandcamp logic — it's the one real implementation, not two.
- Read `apps/api/src/routes/downloads.ts`'s credential-gating logic before adding a new source — the Spotify BYOK check must stay scoped to `source === 'spotify'` specifically; it must never apply to sources that don't need it.
- The desktop app and `apps/api` intentionally do not share deployment/runtime assumptions — `packages/engine`'s binary resolution and file-path handling must stay platform-agnostic (no `app.getPath()`, no other Electron APIs) so both consumers keep working.
- Don't assume feature parity between sources. Key detection, credential requirements, and even BPM fallback ordering genuinely differ — verify against the actual code (or the investigation notes in recent commit messages / PR descriptions) rather than assuming symmetry.
- `docs/archive/` is historical — useful for understanding *why* something was built a certain way, but treat its technical claims as possibly stale. The current source of truth is the code, `CHANGELOG.md`, and this file.
