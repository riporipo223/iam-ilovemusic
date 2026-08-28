# ILoveMusic — Product Audit

Temporary analysis document. Findings below are from direct inspection of this repository (file reads, `grep`, dependency listings) on 2026-08-19, not from assumption. Where something couldn't be verified, it's marked as such rather than guessed.

---

## A. Current architecture

**Monorepo, npm workspaces**, four parts:

```
ILoveMusic/
├── main.js (2,621 lines), preload.js (32 lines), renderer/   # Desktop app (Electron 39 + React 19)
├── packages/engine/                                          # Shared download/BPM/key/metadata engine (TS)
├── apps/api/                                                  # Public job-based download API (Fastify + BullMQ), self-hosted, live at api.madebyripo.sbs
└── apps/cli/                                                  # @ilovemusic/cli — published npm package, interactive terminal client
```

**Desktop app** — the part this audit focuses on, since it's the actual product surface:
- Electron 39.2.7, React 19.2.0, Vite (via `rolldown-vite` alias) for the renderer build.
- `main.js` is a single 2,621-line file. No separation into services/modules — window creation, all 16 IPC handlers, binary resolution, download orchestration, and metadata enrichment all live in this one file.
- `preload.js` is a thin 32-line bridge exposing an `window.electron` API surface via `contextBridge`.
- `contextIsolation: true`, `nodeIntegration: false` (correct, secure defaults) — but **`webSecurity: false`** is also set, which disables the renderer's same-origin policy entirely. No comment in the code explains why; this is worth revisiting rather than assuming it's load-bearing.
- **The entire UI is one file**: `renderer/src/ILoveMusic.jsx`, 2,135 lines. `App.jsx` is a 7-line pass-through. There is no router (no react-router or equivalent), no state management library (no Redux/Zustand/Jotai — everything is `useState`/`useEffect` in the one component), and no component folder structure. A `view` state string (`'library' | 'playlists' | 'collections' | 'bpm' | 'settings'`) conditionally renders sections within the same file.
- Styling is inline `style={{...}}` objects reading from CSS custom properties defined once in `index.css`, not a CSS-in-JS library, not Tailwind, not CSS modules.

**Shared engine** (`packages/engine`) — genuinely well-factored, TypeScript, has a real test suite (58 tests):
- `src/downloader/`: `spotify.ts` (spotdl + YouTube-search fallback, with a confirmed-working alternate-client retry for YouTube's PO Token/SABR enforcement), `ytdlp-track.ts` (the one shared implementation for both SoundCloud and Bandcamp — `soundcloud.ts`/`bandcamp.ts` are thin aliases over it).
- `src/processing/`: `bpm.ts`, `key.ts` (librosa via a resolved Python venv), `metadata.ts` (ffmpeg-based tag/artwork writing, with per-container-format handling that was a real source of silent bugs this session — see Technical Debt).
- `src/binaries.ts`: resolves `spotdl`/`yt-dlp`/`ffmpeg`/`ffprobe`/`aubio`/`python3`/`quickjs` across dev, packaged-desktop, and server contexts via an env-var-override → `ILOVEMUSIC_BIN_DIR` → common-path → bare-`PATH` chain.
- `src/url.ts`: source detection, Bandcamp album/track URL discrimination.
- Consumed by both `main.js` (built to `dist/`, required via `@ilovemusic/engine`) and `apps/api`'s worker.

**Public API** (`apps/api`) — Fastify + BullMQ + Postgres + Redis + Cloudflare R2, self-hosted via a named Cloudflare Tunnel at `api.madebyripo.sbs` (not a cloud platform deployment):
- Routes: `POST /v1/downloads`, `GET /v1/downloads/:id`, `PUT`/`DELETE /v1/spotify-credentials` (BYOK — each caller supplies their own Spotify Developer App credentials, the platform holds none), `POST /v1/api-keys` (self-serve, IP-rate-limited), `GET /health`.
- `worker.ts` runs the same `packages/engine` pipeline outside Electron, uploads results to R2, returns presigned URLs.
- Real test suite (41 tests: route validation, auth, rate limiting, credential-gating scoping).
- API keys are SHA-256 hashed (no salt — deliberate, since plaintext is always a 24-byte random token, documented reasoning in the code). Spotify BYOK secrets are AES-256-GCM encrypted at rest.

**CLI** (`apps/cli`) — published to npm as `@ilovemusic/cli`, a thin HTTP client with no dependency on `packages/engine`'s binary-resolution machinery:
- `ilovemusic create-api-key`, `download` (interactive, inline Spotify BYOK prompt), `spotify-logout`.
- 24 tests. Config stored at OS-conventional paths via `env-paths`.

**Data persistence (desktop app)**: flat JSON files in Electron's `userData` directory — `tracks.json`, `crate.json`, `albums.json` — each read and rewritten in full on every save (`ipcMain.handle('tracks:save', ...)` does `fs.writeFileSync(tracksFilePath, JSON.stringify(tracks, null, 2))`). **There is no database.** No indexing, no querying beyond in-memory `Array.filter`/`.find` in the renderer, no migration path. This is the single biggest architectural gap relative to the "thousands of tracks" scale target.

**Testing**: `packages/engine`, `apps/api`, and `apps/cli` all have real vitest suites (123 tests total, confirmed passing as of this session). **The desktop app itself (`main.js`, `renderer/`) has zero automated tests** — confirmed via `find`, and stated explicitly in `CLAUDE.md`'s own Testing section ("manual verification" only).

---

## B. Existing functionality inventory

| Feature | Where | Current state | Keep / Modify / Deprecate |
|---|---|---|---|
| Spotify single-track download | `main.js` → `packages/engine` `processSpotifyTrack()` | Real Spotify Web API metadata via a platform metadata proxy (no local Client Secret); spotdl → YouTube-search fallback chain; genuine key detection via librosa | **Keep**, already solid |
| SoundCloud / Bandcamp download | `main.js` (legacy inline) + `ytdlp-track.ts` (shared engine version) | Desktop app's SoundCloud/Bandcamp flow is still the **original inline `main.js` code**, not yet migrated to `packages/engine` (confirmed in `CLAUDE.md`: "SoundCloud/Bandcamp desktop flows still run the original inline `main.js` code, not yet migrated") | **Modify** — real duplication between `main.js`'s inline version and the engine's `ytdlp-track.ts` |
| Spotify/SoundCloud/Bandcamp **album** download | `main.js`: `download-spotify-album`, `download-sc-bandcamp-album` | Exists, separate code path from single-track, uses local Spotify Client ID/Secret directly (not the proxy) | **Modify** — reconcile with single-track proxy pattern, or explicitly document why it's different |
| BPM detection | `packages/engine/src/processing/bpm.ts` | Tag → description → title → embedded metadata → aubio audio analysis fallback chain | **Keep** |
| Key detection | `packages/engine/src/processing/key.ts` + `electron/detect_key.py` | Real audio-analysis key detection (librosa) for Spotify only; SoundCloud/Bandcamp get tag-only (no audio-analysis fallback) — a genuine, documented capability gap, not a bug | **Keep**, but the gap should be visible in the UI, not just in code comments |
| Metadata writing/embedding | `packages/engine/src/processing/metadata.ts` | ffmpeg-based; **found and fixed this session**: `.opus`/`.ogg` files were silently losing all tags (missing output-format flag, then a second bug where cover-art embedding fails outright for Ogg-family containers) | **Keep**, now fixed — but this class of bug (format-specific ffmpeg argument gaps) is a sign the function needs a per-format capability matrix, not more `if (fileExt === ...)` branches |
| Artwork extraction/embedding | `main.js`: `extract-artwork` handler; engine: `downloadArtwork()` | 8-tier fallback chain (per `CLAUDE.md`) for SoundCloud/Bandcamp thumbnails | **Keep** |
| "Crate" (download queue/basket) | `renderer/src/ILoveMusic.jsx` (`crate` state), `main.js` (`crate:save`/`crate:load`) | **This is not a DJ crate.** It's a single unnamed list of queued/downloaded tracks, persisted as one `crate.json` array, shown in a slide-in drawer. There is exactly one of it. | **Rename or fundamentally extend** — naming collision with the product-direction "Crate" concept (a named, purpose-built collection) is real and will confuse both users and future contributors if not resolved explicitly |
| Rekordbox export | `main.js`: `exportRekordbox` handler | **Already exists.** Hand-written XML string concatenation (not a library, not validated against a schema). Writes `AverageBpm`, `Tonality`, `TotalTime`, a guessed `title - artist.mp3` filename (not the real saved filename), a `file://localhost/` location, and a single flat playlist node. No verification this matches Rekordbox's actual current XML import expectations (`RekordboxXML` DTD/attribute set) — the master prompt is correct that this needs research, not that it needs to be built from zero | **Modify** — validate against current Rekordbox XML spec, fix the filename mismatch (real path vs. guessed name), consider a small library instead of string concatenation |
| BPM/key manual playback view | `view === 'bpm'` in renderer | Exists as one of the five `view` states | Needs direct inspection before deciding — not fully traced in this pass |
| Playlists / Collections views | `view === 'playlists' / 'collections'` | Exist as `view` states; relationship to `crate.json`/`albums.json` not fully traced in this pass | Needs direct inspection |
| CLI (`@ilovemusic/cli`) | `apps/cli` | Fully separate product surface — download from the terminal, no Electron. Already published to npm. | **Keep, out of scope for this transformation** — the master prompt is entirely about the desktop app |
| Public API | `apps/api` | Self-hosted, BYOK Spotify, live, tested | **Keep, out of scope** — same reasoning |
| ZIP export of selected tracks | Referenced in renderer (`archiver`/`archiver-utils` deps, UI copy: "export the whole crate as a ZIP") | Exists | **Keep** |
| Haptic feedback | `main.js`: `trigger-haptic` | macOS-specific (`NSHapticFeedbackManager` presumably, not directly confirmed in this pass) | Needs direct inspection |

---

## C. Existing UI inventory

The renderer is a single component, so "screens" are really conditional render branches inside `ILoveMusic.jsx`, not separate files or routes. Confirmed structure:

- **Top-level nav**: a `view` state switching between `library`, `playlists`, `collections`, `bpm`, `settings`.
- **The centerpiece is a 3D "record shelf"**: CSS 3D transforms (`translate3d`, `rotateX`, `perspective`), a `requestAnimationFrame`-driven animation loop, each record rendered with a per-item color from a hand-picked 10-entry `PALETTE` (record-sleeve frame colors: teal, burnt orange, cream, navy, near-black-with-amber-ink, olive, magenta, slate, ivory, indigo — a genuinely considered, non-generic palette). This is a strong, distinctive visual identity, not a template.
- **Inspector panel**: a right-side detail/edit view for the selected track (`editing` state).
- **Crate drawer**: a slide-in panel (`crateOpen` state, `transform: translateX`) showing queued/downloaded counts and the ZIP-export action.
- **Design tokens** (`renderer/src/index.css`): `--accent: #fff6e3` (warm cream/ivory, not blue), `--accent-soft: rgba(230, 178, 76, 0.13)` (warm amber), `--bg: #08080a`, `--panel: #0d0d0f`, `--ink: #efece4`, `--dim`/`--faint` grays. Typography: **Space Grotesk** (body/display) + **JetBrains Mono** (data/mono contexts) — already a deliberate, non-default pairing.
- **Note on `CLAUDE.md` drift**: the project's own architecture doc claims "Accent: electric blue `#00D4FF`" — this does not match the actual current CSS (`#fff6e3`, warm cream/amber). The documentation is stale relative to the code; the code (warm, vinyl-adjacent palette) is what actually ships and is the stronger, more distinctive direction of the two.
- Window chrome: native macOS traffic lights via `titleBarStyle: 'hiddenInset'`, custom `trafficLightPosition`. Window is resizable (960×640 minimum, no maximum — fixed earlier this session; previously hard-locked at 1200×800).
- Scrollbars are globally hidden (`::-webkit-scrollbar { display: none }` + Firefox/IE equivalents) — a deliberate, consistent choice, documented in `docs/scrollbar-hide.md`.

**Not yet traced in this pass** (would need direct component-level reading before any redesign work): exact contents of the `playlists`, `collections`, and `bpm` views; the full Inspector panel's field set; empty/loading/error state coverage; whether search/filter exists today and how.

---

## D. Technical debt

Confirmed, not assumed:

1. **No database.** Every save rewrites a full JSON file. This is the architecture most at odds with the product direction's own scale target (hundreds to thousands of tracks, smart filters, fast search). This is the single highest-priority foundational fix if the product direction in the brief is pursued.
2. **`main.js` is a 2,621-line single file** mixing window management, IPC routing, download orchestration, and metadata enrichment. No separation of concerns. Any "batch processing queue" or "processing pipeline" work described in the brief needs this decomposed first, or it will make an already-large file substantially worse.
3. **`renderer/src/ILoveMusic.jsx` is a 2,135-line single component.** No router, no state library. Adding Library/Crates/Import/Queue/Tools as described in the brief's navigation section, inside this file as it stands, is not viable — this needs real componentization first.
4. **SoundCloud/Bandcamp duplication**: the desktop app's inline `main.js` version and `packages/engine`'s `ytdlp-track.ts` are two different implementations of the same thing (confirmed via `CLAUDE.md`'s own admission that desktop SoundCloud/Bandcamp flows were never migrated to the shared engine).
5. **`webSecurity: false`** in `BrowserWindow` — disables the renderer's same-origin policy entirely, with no comment explaining why. Worth a real investigation (what actually needs this?) before either keeping or removing it.
6. **The metadata-writing bug class found and fixed this session** (missing ffmpeg output-format flags per extension, then a second bug where Ogg-family containers can't hold embedded artwork the way MP3/FLAC/M4A can) is evidence that `writeMetadataToFile()`'s per-extension `if` chain is fragile and grows a new silent failure mode with each new format it needs to handle. A real capability table (format → supports-artwork? → muxer flag) would be more robust than more branches.
7. **Naming collision on "crate"** — the existing single download-queue "crate" and the product brief's intended DJ-crate concept are different things with the same name. This needs an explicit decision (rename the existing one, e.g. to "queue" or "basket") before building the new concept, or the two will be permanently confused in code and UI copy.
8. **No automated tests for the desktop app** at all — every fix this session to `packages/engine`/`apps/api`/`apps/cli` had real test coverage; `main.js`/`renderer/` has none. Any nontrivial refactor here is currently unverifiable except by manual click-through.
9. **Rekordbox export is unverified against the actual current Rekordbox XML import format.** It works in the sense that it produces well-formed XML, but nothing in this codebase confirms it matches what current Rekordbox versions expect on import (attribute names, required fields, location URI encoding). This should be verified against Pioneer's own current documentation before being presented as a real feature, not just left as-is.
10. **`CLAUDE.md`'s Design System section is stale** (wrong accent color) — a documentation-drift instance, low risk but should be corrected alongside any real design work so it doesn't mislead the next person (human or AI) who reads it first.

---

## E. Product gap analysis

Mapping the brief's intended workflow (`DISCOVER → IMPORT → PREPARE → ANALYZE → ORGANIZE → CRATE → EXPORT`) against what's confirmed to exist:

| Stage | Exists today | Gap |
|---|---|---|
| **Discover** | Not part of this app at all — discovery happens on Spotify/SoundCloud/Bandcamp themselves; the user brings a URL | Out of scope for a local tool by nature; the brief seems to acknowledge this ("downloader is an input mechanism") |
| **Import** | Single-track add via URL (Spotify/SoundCloud/Bandcamp), album import, batch add exists in some form (needs deeper tracing) | No confirmed folder import, no confirmed drag-and-drop of local files, no confirmed unified multi-URL paste-and-detect flow |
| **Prepare** | Metadata writing, artwork embedding, format handling — all real and working (engine-level) | No confirmed batch metadata editing UI, no confirmed manual artwork replacement UI |
| **Analyze** | Real BPM (all sources) and key (Spotify-only) detection; no loudness, no waveform, no energy, no quality scoring, no duplicate detection confirmed anywhere in this pass | This is almost entirely new work relative to what's confirmed to exist |
| **Organize** | Flat JSON storage, `view` states for library/playlists/collections | No confirmed smart filters, no confirmed saved filters, no confirmed duplicate detection, no confirmed quality-based views — and without a real database, most of this would be slow/fragile to build |
| **Crate** | A single, unnamed download-queue list (see naming collision above) | The brief's actual "named collections, reorderable, exportable, smart-filter-backed" concept does not exist yop |
| **Export** | ZIP export (confirmed), Rekordbox XML export (confirmed, unverified schema) | No confirmed M3U/CSV/JSON export, no exporter abstraction/interface, no Serato/Traktor path |

**Bottom line**: the engine-level "prepare" work (download, tag, BPM/key, artwork) is genuinely strong and already matches a lot of the brief's ambition. The gap is almost entirely in **data architecture** (no database) and **UI architecture** (no componentization, no router) — both of which block nearly everything in the brief's Phase 2 onward, not because the ideas are wrong, but because the current desktop app's foundation can't support them without real refactoring work first.

---

*This is a temporary analysis document per the audit request. See the accompanying chat response for the required 12-section summary, technical risk assessment, and the "wait for approval" checkpoint before any implementation begins.*
