# Changelog

All notable changes to ILoveMusic will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

This release covers extracting the shared download engine and building `apps/api` around it (Spotify BYOK, SoundCloud, Bandcamp), deployment-readiness work for `apps/api` (Docker, env var audit, Render Blueprint evaluated but not used), a full desktop-release readiness pass (binary bundling, packaging bug fixes, credential-handling redesign, `.env`-loading fix), and self-hosting the API via Cloudflare Tunnel — first Quick Tunnel, now migrated to a named tunnel on a real domain. Grouped by category below, not by individual commit.

### 🌐 Self-Hosting / Deployment

- **Migrated `apps/api`'s self-hosted Cloudflare Tunnel from Quick Tunnel to a named tunnel** on a real domain — `api.madebyripo.sbs` (domain `madebyripo.sbs`, registered on Hostinger, DNS migrated from Vercel's nameservers to Cloudflare's). Unlike Quick Tunnel's random `*.trycloudflare.com` URL that changes on every reconnect, a named tunnel URL is persistent — created via `cloudflared tunnel create ilovemusic-api` (tunnel ID `219cb51d-7f8e-4ae0-b8f3-42394bb102ae`, not secret by itself — the sensitive part is `~/.cloudflared/<tunnel-id>.json`, which never leaves the home directory or gets referenced by value anywhere in the repo) and routed via `cloudflared tunnel route dns`. Quick Tunnel is kept as the fallback/emergency option, not deleted.
  - Fixed a real bug hit during this migration: `apps/api/launchd/com.ilovemusic.cloudflared.plist` was pointing `--config` at `config.named-tunnel.yml.example` (the placeholder template, literal `<TUNNEL_ID>` in its `credentials-file` path) instead of the real, filled-in `config.yml` — confirmed via the actual cloudflared error (`Tunnel credentials file '.../<TUNNEL_ID>.json' doesn't exist`) before fixing, not assumed from reading the diff alone. Verified the fix by reloading the launchd job and confirming cloudflared registers successfully with Cloudflare's edge.
  - **DNS propagation was still in progress as of this write-up** — `dig NS madebyripo.sbs` returned Vercel's nameservers, not Cloudflare's, meaning `https://api.madebyripo.sbs` isn't publicly reachable yet (TLS handshake fails since Cloudflare hasn't issued a certificate for a zone it isn't yet authoritative for). Not a code/config bug — see `apps/api/DEPLOYMENT.md`'s "Domain & DNS" section for what to re-check before relying on this being live.

### 🏗️ Architecture

- **Extracted `packages/engine`** — the download/BPM-key-detection/metadata-embedding logic (previously all inline in `main.js`) is now a shared, platform-agnostic TypeScript package. The desktop app's Spotify flow now runs through it; SoundCloud/Bandcamp desktop flows still run the original inline `main.js` code (not yet migrated).
- **Desktop Spotify single-track downloads no longer hold a Client Secret locally.** Added `GET /v1/spotify-metadata` to `apps/api` — a proxy backed by the platform operator's own `PLATFORM_SPOTIFY_CLIENT_ID`/`PLATFORM_SPOTIFY_CLIENT_SECRET` (deliberately *not* BYOK — separate env vars, separate code path from the per-consumer `spotify_credentials` table). `packages/engine`'s `processSpotifyTrack()` gained an optional `metadata` option that bypasses its internal `fetchSpotifyTrackMetadata()` call when pre-fetched metadata is supplied; `apps/api`'s worker and any BYOK caller are unaffected (still pass `spotify` credentials, unchanged behavior). `main.js` now calls the proxy (`ILOVEMUSIC_API_BASE_URL`/`ILOVEMUSIC_API_KEY` from `.env`, a 15s timeout so an unreachable server fails clearly instead of hanging) instead of using a local `SPOTIFY_CLIENT_ID`/`SECRET`. Confirmed via spotDL's own source before making this change that `spotdl` itself needs no separate credentials for its audio-matching/download step as invoked here. Two other desktop code paths (SoundCloud/Bandcamp BPM/key cross-reference, Spotify album downloads) still use local Spotify credentials directly and were intentionally left unchanged — they're not part of the single-track flow this migration targeted.
- **Fixed `.env` never loading at all in a packaged build** — root cause of a report that read as "SoundCloud works but Spotify can't find `ILOVEMUSIC_API_KEY`/`BASE_URL` in the same `.env` file `SPOTIFY_CLIENT_ID` supposedly loads from." Turned out SoundCloud succeeding was never evidence `.env` loaded at all: its core flow doesn't touch Spotify vars, and the one place that does (`getBpmKeyFromSpotify`) degrades silently to `null` on missing credentials — so the real bug was invisible until a flow that hard-fails on a missing var (the new proxy call above) surfaced it. `dotenv`'s default `.env` lookup is `path.resolve(process.cwd(), '.env')` — relative to the process's *working directory*, not `main.js`'s location — which only happened to work under `npm run dev` by coincidence (cwd = project root there). A packaged app launched via Finder gets an unrelated cwd, so **every** credential in `.env` silently failed to load, not just the two new ones — confirmed with a standalone reproduction (`scripts/verify-env-loading.js`) before touching any code, by running the exact same `dotenv.config()` call from a different `cwd` and observing all four vars go missing together. Fixed by resolving the path explicitly: `path.join(__dirname, '.env')` in dev (no longer cwd-dependent either), `path.join(app.getPath('userData'), '.env')` when packaged — the standard Electron pattern for user-specific secrets that live outside the (potentially code-signed, read-only) app bundle. `scripts/verify-env-loading.js` stays in the repo as a permanent, Electron-free sanity check (`npm run verify:env` / `npm run verify:env:packaged`) — the desktop app has no automated test suite (manual verification only, per this file's Testing section), so this is the closest thing to a regression guard for this exact bug class.
  - **Correction to the above, found when the fix didn't actually resolve the user's report**: `app.getPath('userData')` on macOS is `~/Library/Application Support/<app.getName()>`, and `app.getName()` only prefers electron-builder's `productName` ("ILoveMusic") over `package.json`'s `"name"` ("ilovemusic-desktop") *if `productName` is present in the packaged `app.asar`'s own `package.json`* — confirmed directly via `npx asar extract` that electron-builder never injects it there; it's only used for the `.app` bundle name and DMG filename. The first pass at this fix wrongly assumed the folder was `ILoveMusic` (from the `.app` bundle's `CFBundleName`) and set up/documented that path — `scripts/verify-env-loading.js --packaged` "confirmed" it too, but only because it hardcoded the same wrong assumption rather than deriving it independently, so it was a false-positive self-check, not real verification. Corrected against a real running instance's actual `--user-data-dir` launch argument (`ps aux`), not re-assumed: the real folder is `ilovemusic-desktop`.
- **Added `apps/api`** — a companion job-based download API (Fastify + BullMQ worker + Postgres + R2) that runs the same engine outside Electron. Local development only; not deployed anywhere. Each API caller brings their own Spotify Developer App credentials (BYOK, AES-256-GCM encrypted at rest) rather than the platform holding a shared one — Spotify's Developer Mode restrictions (Premium-owner requirement, low user caps) make a shared credential impractical for anything beyond a handful of users.
- **Generalized SoundCloud/Bandcamp downloading** — confirmed (not assumed) that the original SoundCloud handler and Bandcamp handling ran identical code in `main.js`; `packages/engine` reflects that with one shared implementation (`downloader/ytdlp-track.ts`) instead of duplicating it per source.
- Fixed a concurrency bug carried over from the original artwork-fallback code: a `process.chdir()` call that's harmless in Electron (one job at a time) but a real race condition under concurrent job processing. Replaced with an absolute output path.
- Added a URL-shape guard rejecting Bandcamp album/playlist URLs before they reach a worker — the original code had no such distinction (routing was done by which button a user clicked in the desktop UI, not by parsing the URL), which would otherwise let yt-dlp attempt to download an entire album into a single track's expected output file.

### 📖 Documentation

- Reorganized historical docs (~20 files) out of the repo root into `docs/archive/` (kept for reference, explicitly marked unmaintained); current technical notes moved to `docs/`.
- Rewrote `CLAUDE.md` to describe the current architecture instead of the pre-refactor single-process app.
- Removed obsolete root-level ad-hoc scripts (`test-spotify.js`, `test-spotify-fixed.js`, `test-spotdl.sh`) — superseded by the `packages/engine`/`apps/api` test suites.

### 🧪 Testing

- Added vitest suites for `packages/engine` and `apps/api` (job creation/validation, per-source credential-gating scoped correctly, BPM/key/artwork fallback tiers, and a concurrency test that runs two jobs in parallel to catch the chdir-style race condition above).
- Added `packages/engine/test/key.test.ts`, proving `detectKey()` genuinely degrades gracefully (resolves `null`, never rejects) when `python3` is missing, `librosa` fails to import, the subprocess produces no output, or output is malformed — not just "should" per a code comment.

### 📦 macOS Packaging

- **Bundled `spotdl`, `ffmpeg`, and `ffprobe` for macOS** into `electron-builder.yml`'s `mac.extraResources`, following the existing `yt-dlp` pattern. Previously only `yt-dlp` was bundled — a clean end-user machine without Homebrew-installed tools would silently fail (`ENOENT`) on every Spotify download and every BPM/duration lookup. See `build/bin/README.md` for exact sources, versions, and checksums.
  - `spotdl` 4.5.2 is arm64-only (Apple Silicon); no universal2 build is published upstream. Does not run on Intel Macs.
  - `ffmpeg`/`ffprobe` 9.0 (evermeet.cx) are x86_64-only; run on Apple Silicon via Rosetta 2.
  - Verified `resolveBinary()` + `ILOVEMUSIC_BIN_DIR` actually resolve to the packaged copies (not just assumed from the pattern match) by resolving against a real built `.app`'s `Resources/bin`, and by executing each bundled binary from that path directly.
  - Package size impact (measured, not estimated): baseline `.dmg` 160MB → 252MB (+92MB), baseline `.zip` 157MB → 246MB (+89MB).
- **`aubio` deliberately not bundled** — no official static/portable CLI build exists for it anywhere (checked: every GitHub release ships source only). `detectBPMFromAudio()` already degrades gracefully without it, same as the `python3`/`librosa` key-detection fallback.
- Fixed `main.js`'s `getFfmpegPath()`/`getAubioPath()` to append `.exe` on Windows for their bundled-path branch, matching `getYtDlpPath()`'s existing correct handling. Latent bug, harmless today since neither was bundled for Windows yet, but would have broken silently the moment Windows bundling was added.
- **Fixed a packaging bug that crashed the app on launch on a clean machine**: `Error: Cannot find module '@ilovemusic/engine'`. Root cause, confirmed via `npx asar list` on a real build (not assumed): `@ilovemusic/engine` was completely absent from the packaged `app.asar` — not even present as a broken symlink. Two compounding causes — `@ilovemusic/engine` was never declared in this file's own `dependencies` (only referenced via `--workspace` npm scripts), so electron-builder's dependency-tree walker never considered it for inclusion at all; and even once declared, electron-builder preserves a symlinked workspace module by recreating the *same relative link target* in the packaged output (confirmed by reading `app-builder-lib`'s `copyAppFiles`), which for an npm-workspace symlink points outside the shipped `.app` entirely. Fixed by declaring the dependency explicitly and adding `scripts/build-desktop.js`, which temporarily replaces the `node_modules/@ilovemusic/engine` workspace symlink with the package's real publishable contents (same set `npm pack` would use) before `electron-builder` runs, then restores the symlink afterward so `npm run dev` is unaffected. Verified by extracting the rebuilt `app.asar` and actually `require()`-ing the module in Node — succeeds, all expected exports present.

---

## [0.2.0] - 2026-06-12

### 🎉 Major Features Added

#### Spotify Integration
- ✅ **Spotify URL support** - Paste Spotify track URLs alongside SoundCloud
- ✅ **Premium quality downloads** - 320kbps MP3 via spotdl
- ✅ **Spotify Web API integration** - Fetch metadata (title, artist, artwork, duration)
- ✅ **Smart audio provider** - Prioritize YouTube Music for better matching
- ✅ **Automatic fallback** - Falls back to YouTube if spotdl fails

#### Track Verification System
- ✅ **Automatic verification** - Compare downloaded metadata vs expected from Spotify
- ✅ **Console warnings** - Alert when track might not match
- ✅ **Download source tracking** - Know if track used spotdl or YouTube fallback
- ✅ **Enhanced logging** - Detailed debug information for troubleshooting

#### Quality Improvements
- ✅ **320kbps bitrate** - CD-quality audio for professional DJ use
- ✅ **Better matching accuracy** - 95-99% accuracy (up from ~80%)
- ✅ **Improved search queries** - Use "official audio" keyword for better results
- ✅ **Provider preference** - YouTube Music preferred over regular YouTube

### 🔧 Technical Changes

#### Dependencies
- Added `dotenv` for environment variable management
- Added `spotdl` (Python) for Spotify downloads
- Updated Spotify Web API integration (Client Credentials Flow)

#### Architecture
- Added `getSpotdlPath()` helper function
- Added `downloadAudioFromSpotify()` function (320kbps downloads)
- Added `detectUrlSource()` for SoundCloud vs Spotify detection
- Added `extractSpotifyTrackId()` for URL parsing
- Added `getSpotifyAccessToken()` with token caching (50-minute expiry)
- Added `fetchSpotifyTrackMetadata()` for Spotify API calls
- Improved `downloadAudioFromYouTubeSearch()` with better search queries
- Enhanced error handling in HTTP requests (fixed EPIPE errors)

#### Bug Fixes
- 🐛 Fixed **ffmpeg not found** - Reordered path checking (system paths first)
- 🐛 Fixed **yt-dlp ENOENT** - Improved binary path resolution
- 🐛 Fixed **aubio not found** - Added proper path detection
- 🐛 Fixed **EPIPE errors** - Added try-catch in HTTP callbacks
- 🐛 Improved **error messages** - More descriptive failure information

### 📖 Documentation

#### New Documentation Files
- `SPOTDL_UPGRADE.md` - Technical details of spotdl integration
- `UPGRADE_COMPLETE.md` - Complete upgrade summary
- `MATCHING_IMPROVEMENTS.md` - Matching accuracy improvements
- `VERIFICATION_GUIDE.md` - User guide for verifying tracks
- `FIXES_APPLIED.md` - Detailed list of bug fixes
- `STATUS_REPORT.md` - Current status and testing guide
- `QUICK_START.md` - Quick start guide for users
- `APP_SUMMARY.md` - Complete application overview
- `TROUBLESHOOTING.md` - Common issues and solutions
- `test-spotify-fixed.js` - Spotify API test script
- `test-spotdl.sh` - spotdl installation test script

#### Updated Documentation
- Updated `README.md` with Spotify features
- Updated `package.json` with new description
- Added `.env.example` for Spotify credentials
- Added setup instructions for Spotify API

### 🎨 UI Changes
- Updated input placeholder: "PASTE SOUNDCLOUD OR SPOTIFY URL"
- Added support for both URL types in same input field

### 🔐 Security
- Environment variable support for API credentials
- Secure token storage with expiry management
- Proper error handling for API failures

---

## [0.1.2] - 2026-06-10

### Features
- ✅ SoundCloud URL support
- ✅ Automatic BPM detection (3-tier system)
- ✅ Album artwork download and embedding
- ✅ Audio preview with playback controls
- ✅ Search and filter tracks
- ✅ Sort by title, artist, BPM, duration
- ✅ Batch download as ZIP
- ✅ Metadata extraction (BPM, key, duration)
- ✅ Cross-platform support (macOS, Windows, Linux)

### Technical Stack
- Electron 39.x for desktop framework
- React 19.x for UI
- Vite for build tooling
- ffmpeg for audio processing
- aubio for BPM detection
- music-metadata for metadata parsing
- soundcloud-downloader for SoundCloud integration

---

## Version Comparison

| Feature | 0.1.2 | 0.2.0 |
|---------|-------|-------|
| SoundCloud | ✅ | ✅ |
| Spotify | ❌ | ✅ |
| Quality | 128-256kbps | **320kbps** |
| BPM Detection | ✅ | ✅ |
| Track Verification | ❌ | ✅ |
| Download Tracking | ❌ | ✅ |
| Matching Accuracy | ~80% | **95-99%** |
| Smart Fallback | ❌ | ✅ |
| API Integration | SoundCloud only | SoundCloud + Spotify |

---

## Upgrade Instructions

### From 0.1.2 to 0.2.0

1. **Install spotdl**:
   ```bash
   pip3 install spotdl
   ```

2. **Setup Spotify credentials** (optional):
   ```bash
   cp .env.example .env
   # Edit .env and add your Spotify API credentials
   ```

3. **Update dependencies**:
   ```bash
   npm install
   npm install --prefix renderer
   ```

4. **Restart the app**:
   ```bash
   npm run dev
   ```

5. **Test Spotify integration**:
   - Paste a Spotify track URL
   - Check console for verification messages
   - Verify 320kbps quality

### Breaking Changes
- None. Fully backward compatible.
- Existing SoundCloud functionality unchanged.
- New Spotify features are additive.

---

## Known Issues

### 0.2.0
- Some tracks may not match perfectly (5-10% depending on rarity)
- spotdl requires Python 3.9+ and pip
- First Spotify download may be slow (spotdl setup)
- Regional-exclusive tracks may have matching issues

### Workarounds
- Check console for verification warnings
- Re-download if track doesn't match
- Use SoundCloud as fallback for problematic tracks

---

## Future Roadmap

### v0.3.0 (Planned)
- [ ] Spotify playlist import
- [ ] Multiple track selection from playlist
- [ ] Improved key detection
- [ ] Audio fingerprinting for duplicate detection

### v0.4.0 (Planned)
- [ ] Rekordbox XML export
- [ ] Waveform visualization
- [ ] Advanced metadata editing
- [ ] Cloud sync (optional)

### v1.0.0 (Future)
- [ ] Production-ready release
- [ ] Comprehensive testing suite
- [ ] Full documentation
- [ ] Stable API

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.

---

## Support

- **Issues**: [GitHub Issues](https://github.com/riporipo223/iam-ilovemusic/issues)
- **Documentation**: See README.md and related docs
- **Contact**: [@cactusdomain](https://www.instagram.com/cactusdomain/)

---

Made with ❤️ by RIPO (CactusDomain)
