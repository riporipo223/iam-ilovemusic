# ILoveMusic — Implementation Plan

Second document per `ILOVEMUSIC_PRODUCT_AUDIT.md`. This is a plan, not an implementation — no phase below has been started. Scope is the desktop app only (`main.js`, `preload.js`, `renderer/`); `packages/engine`, `apps/api`, and `apps/cli` are confirmed solid in the audit and are not touched by anything here.

---

## 0. Completed prerequisite: Crate → Queue rename

Done. `main.js`, `preload.js`, and `renderer/src/ILoveMusic.jsx` no longer use "crate" anywhere — the existing download basket/wishlist is now "Queue" throughout (variables, IPC channel names `queue:save`/`queue:load`, UI copy, comments). Verified:

- Renamed via a case-preserving whole-word substitution (`CRATE`→`QUEUE`, `Crate`→`Queue`, `crate`→`queue`) across all three files — confirmed beforehand there are no unrelated words containing "crate" as a substring in this codebase (no `concentrate`/`accurate`/etc. false positives), so a blanket rename was safe.
- **Data continuity**: the on-disk file was also renamed, `crate.json` → `queue.json`. A real user's saved queue lives under the old filename, so `queue:load` now migrates it on first read (`fs.renameSync` from `crate.json` to `queue.json` if the new file doesn't exist yet but the old one does) — otherwise this "pure rename" would have silently emptied every existing user's queue, which is a data-loss bug, not a rename. Confirmed against this machine's actual installed app data (`~/Library/Application Support/ilovemusic-desktop/crate.json` existed, currently empty `[]` for this install, but the migration path is real and necessary for any user who has saved items).
- Verified no behavior changed: `renderer/` builds clean (`vite build`), `main.js`/`preload.js` pass `node --check`, ESLint shows the same 3 pre-existing, unrelated errors as before the rename (an unused `err`, an unused `statPill`, an unused `handleAlbumSeek` — none reference queue/crate, confirmed via `git diff` that the rename touched none of those lines). Full monorepo test suite (`packages/engine`/`apps/api`/`apps/cli`, 96 tests) still green, as expected since none of those packages were touched.

"Crate" is now free for the real DJ-crate concept in Phase 4 below.

---

## 1. `webSecurity: false` investigation

**Finding, not a guess** — traced via `git log --all -p -- main.js`: this flag has been present since the very first commit that added a `BrowserWindow` config (`e8a3cb4`, "Initial commit"), alongside `nodeIntegration: false`/`contextIsolation: true`. No commit message ever explained it (`git show 7abc98d8...` — commit message is literally "Updated New").

**Why it's actually there** (reconstructed from what the code does, not the commit history): the renderer has **zero** direct `fetch`/`axios` calls anywhere (confirmed via `grep` — `axios` is a declared dependency but unused in `ILoveMusic.jsx`). All network activity happens in the main process. What the renderer *does* do is play back locally downloaded audio directly: `main.js` builds raw `file://${track.filePath}` URLs (four call sites: track playback, album playback, artwork-adjacent paths) and hands them to the renderer, which feeds them into `Audio` objects via `audioRefs`. In dev mode, the renderer's origin is `http://localhost:5173` (the Vite dev server) — a real network origin, not `file://` — and Electron treats a `file://` audio/image `src` loaded from a network-origin page as "insecure content," which it blocks unless `webSecurity` is off. That's almost certainly the original motivation, even though it was never written down.

**Is it safe to remove as-is?** No — removing it today would very likely break local track/album playback in dev mode at minimum (and possibly in the packaged build too, depending on exact Electron version behavior around `file://`-origin pages referencing other `file://` paths).

**Is it safe to *keep* as-is?** Not ideal. `webSecurity: false` doesn't just permit local file playback — it disables the renderer's same-origin policy and CORS enforcement *entirely*, for everything, permanently. Today's actual exposure is low (no remote content is rendered, no `<iframe>`, no direct renderer-side network calls to untrusted hosts), but it's a standing landmine: Electron's own security documentation explicitly lists this as something that should not be disabled in shipped apps, and any future renderer feature that fetches or embeds anything remote (an update-checker page, an embedded preview, a webview) would silently inherit zero CORS protection, with nothing in the code to flag that.

**Recommended fix, not urgent but real**: replace raw `file://` URLs with a registered custom protocol (Electron's `protocol.handle()`, e.g. serving local audio/artwork under `ilovemusic-media://<path>` instead of `file://<path>`), which lets `webSecurity` be re-enabled without breaking playback. This is a genuinely separate, small, self-contained piece of work — it touches the same "local file → renderer" surface as the eventual data-model migration below, but isn't blocked by it and isn't blocking anything else. Sequenced as **Phase 1.5** below: after the database foundation (so the protocol handler can read file paths from the new schema instead of ad hoc IPC payloads), before UI work resumes.

---

## 2. Foundation: flat JSON → SQLite

### Why SQLite, evaluated rather than assumed

Options actually considered:

| Option | Verdict |
|---|---|
| **`better-sqlite3`** | **Recommended.** Synchronous API (simpler in an Electron main process than async drivers), real SQL — indexes, `WHERE`/`ORDER BY`/range queries, which is exactly what "BPM 120–128 + Key 8A–10A + Genre House" smart filters need and flat JSON fundamentally cannot do efficiently. Single-file, easy to back up/relocate. Native module — but this project already rebuilds native modules for the Electron target via `@electron/rebuild` in `scripts/build-desktop.js`'s pipeline, so this isn't new build complexity, just one more package going through an existing mechanism. |
| **`node:sqlite`** (Node's built-in, experimental) | **Rejected for now** — checked directly on this project's actual Node version (22.0.0): the module doesn't exist yet (`ERR_UNKNOWN_BUILTIN_MODULE`; it landed later as experimental). Reconsider in the future once it's stable, but building on an experimental built-in today is the wrong tradeoff for a shipping product. |
| **IndexedDB in the renderer** | Rejected — would move data ownership into the renderer process, working against Electron's security model (main process should own filesystem/data access) and makes server-side-style exports (Rekordbox XML, CSV, etc., which run in the main process) awkward. |
| **`lowdb` / other JSON-wrapper libs** | Rejected — nicer API around the exact same problem the audit flagged (no real indexing or range queries), not a real fix. |
| **A bundled server DB (Postgres, etc.)** | Rejected outright — the audit and the brief both explicitly warn against over-engineering; this is a single-user local desktop app, not a service. |

### Schema (first pass — extend, don't over-normalize per the brief's own guidance)

```sql
CREATE TABLE tracks (
  id TEXT PRIMARY KEY,           -- keep existing track IDs stable across migration
  title TEXT, artist TEXT, album TEXT, genre TEXT, year INTEGER,
  bpm REAL, key TEXT,
  duration REAL, file_path TEXT, artwork_path TEXT,
  format TEXT, bitrate INTEGER, sample_rate INTEGER,
  source TEXT, download_source TEXT, spotify_url TEXT,
  date_added TEXT
);
CREATE INDEX idx_tracks_bpm ON tracks(bpm);
CREATE INDEX idx_tracks_key ON tracks(key);
CREATE INDEX idx_tracks_artist ON tracks(artist);
CREATE INDEX idx_tracks_genre ON tracks(genre);

CREATE TABLE queue (
  id TEXT PRIMARY KEY, status TEXT, source_url TEXT, title TEXT, artist TEXT,
  album_id TEXT, album_title TEXT
);

CREATE TABLE albums ( id TEXT PRIMARY KEY, title TEXT, artist TEXT /* extend as needed once albums.json's real shape is traced */ );
```

`crates`/`crate_tracks` (the *new* DJ-crate concept) are deliberately **not** in this first migration — see Phase 4. Standing up the database now, for the data that already exists, is its own bounded piece of work; adding brand-new tables for a feature that doesn't exist yet would blur what's actually being migrated versus what's being newly built.

### Migration strategy — no user data loss, by construction

1. On startup, main.js checks for `userData/ilovemusic.db`. If it doesn't exist **and** any of `tracks.json`/`queue.json`/`albums.json` do, run a one-time migration.
2. **Back up first, unconditionally**: copy (not move) each existing JSON file to `<name>.pre-sqlite-backup.json` in the same directory before touching anything. If migration fails partway, nothing about the source data has been destroyed.
3. Read each JSON file, insert rows into the corresponding table inside a single transaction (`better-sqlite3` supports this natively and it's the right tool for "all or nothing").
4. On success, leave the original JSON files in place (don't delete) for at least one release cycle — cheap insurance, and they're small. Add a note to delete them in a later cleanup pass once the migration has been live for a while.
5. If migration throws, **do not partially apply it** — the transaction wrapper handles this — and fall back to the JSON-file code path for that session, surfacing a clear in-app message rather than silently losing the library.
6. This is a genuinely high-risk piece of work specifically because it touches every existing user's actual music library metadata — it should get real manual testing against a copy of this machine's actual `tracks.json` (6.7MB, confirmed non-trivial size) before being considered done, not just a small synthetic fixture.

---

## 3. Implementation phases

Ordered by actual dependency, not feature wishlist order — each phase lists what it needs from the ones before it.

### Phase 1 — Foundation
- SQLite migration (Section 2 above).
- **Blocks everything below.** Smart filters, fast search, multi-crate management, and duplicate detection are all real SQL queries in the target design; none of them are practically buildable against three flat JSON files re-read/rewritten in full on every change.
- No new UI in this phase — it should be invisible to the user except that the app still works, with their existing library intact.

### Phase 1.5 — `webSecurity` remediation
- Custom protocol handler for local audio/artwork (Section 1 above), enabling `webSecurity: true`.
- Depends on Phase 1 only in that it's a natural place to also switch from raw file paths in IPC payloads to reading paths from the new `tracks` table — not a hard technical dependency, just avoids doing the same "how does the renderer get a playable URL for a track" plumbing twice.

### Phase 2 — Music workspace (renderer componentization)
- Break `ILoveMusic.jsx` (2,135 lines, one file) into real components — at minimum: Library view, Track row/list, Inspector panel, Queue panel (already renamed), a search/filter bar. This is prerequisite work, not a visual redesign — the audit's finding stands that meaningful new screens (Crates, Import, Tools) aren't viable to add on top of the current single-file structure.
- Introduce a router only if the "screens" genuinely need independent URLs/back-forward behavior — for a desktop app with a persistent left nav, a simple view-switch (as today) may still be the right call; this needs a real decision, not an assumption either way, once componentization is underway and the actual screen count is concrete.
- Depends on Phase 1: list/search/filter components should be built against the new SQLite-backed data access, not built once against JSON and rebuilt again against SQL.

### Phase 3 — Music preparation (batch + analysis surfacing)
- This phase is UI/UX work surfacing capability that **already exists** at the engine level (BPM, key, artwork, metadata writing — all real, per the audit) plus genuinely new analysis (loudness, quality scoring, duplicate detection) that doesn't exist anywhere yet.
- Batch metadata editing UI, batch artwork operations: new.
- Duplicate detection: start with metadata-based matching (filename/artist/title/duration) before audio fingerprinting — the audit explicitly notes this should support library hygiene, not be a headline feature; the cheap version delivers most of the value.
- Depends on Phase 1 (querying "which tracks are unanalyzed / missing artwork / possible duplicates" is a SQL query, not a full-table JS scan) and Phase 2 (needs somewhere to render).

### Phase 4 — Crates
- New `crates`/`crate_tracks` tables (additive migration on top of the Phase 1 schema, not a redo of it).
- Named, reorderable, multi-crate collections — the actual product-direction "Crate" concept, now unambiguous since the old queue no longer uses the name.
- Smart filters (BPM/key/genre/energy combinations) become real SQL `WHERE` clauses against the Phase 1 indexes.
- Depends on Phase 1 (schema/querying) and Phase 3 (crates are much less useful before tracks are actually analyzed/taggable at the fidelity Phase 3 provides).

### Phase 5 — DJ workflow (set builder)
- BPM progression / key compatibility (Camelot wheel) / energy progression recommendations for building a set from a crate.
- Depends entirely on Phase 4 (needs crates to exist) and real BPM/key data (Phase 1 schema + existing engine-level detection).

### Phase 6 — Export
- Exporter abstraction (the brief's `MusicExporter` interface) — M3U/CSV/JSON first (cheap, no external spec dependency), then Rekordbox XML.
- **Rekordbox XML specifically needs its own research pass before implementation**, separate from writing code: the existing `exportRekordbox` handler produces well-formed XML but was never verified against Pioneer's actual current import schema, and it currently guesses the saved filename (`title - artist.mp3`) instead of using the real one recorded per track — that's a real bug in the existing feature, findable and fixable independent of everything else in this plan, worth doing whenever this phase starts regardless of what else has landed by then.
- Depends on Phase 4 (exporting a crate needs crates to exist) but the exporter *interface* itself could reasonably be designed earlier if useful as a forcing function for the data model.

### Phase 7 — Polish
- UI consistency, accessibility, keyboard nav, loading/empty/error states, performance profiling (100/500/1,000/5,000-track libraries — the audit's data-model fix is what makes this remotely testable at that scale), Electron security audit (confirming Phase 1.5 actually closed the gap), build verification.
- Last, by definition — it's a pass over everything built in Phases 1–6, not new capability.

---

## 4. Risk register, by phase

| Phase | Primary risk | Mitigation |
|---|---|---|
| **1 — SQLite migration** | **Highest risk in this entire plan.** Touches every existing user's actual library data; a bug here can look like "my music library disappeared." | Backup-before-migrate (copy, not move); wrap the whole migration in one transaction; test against this machine's real 6.7MB `tracks.json`, not a synthetic fixture; keep the JSON fallback path reachable for at least one release in case the DB path needs to be disabled quickly |
| **1.5 — webSecurity** | Breaking local audio/artwork playback while trying to fix a security setting nobody had documented | Land behind a flag / verify manually (play a track, play an album, view artwork) before removing the old `file://` path entirely; this is exactly the kind of change that needs real manual QA since the desktop app has no automated tests |
| **2 — Componentization** | Regressing the existing 3D shelf visual identity while extracting it into components — the audit and the brief both explicitly call this out as something to preserve, not casualty of a refactor | Extract components incrementally (shelf, inspector, queue panel each as their own pass) rather than one big rewrite; visually compare before/after at each step, not just "it renders" |
| **3 — Analysis/duplicates** | False-positive duplicate detection leading to a user losing a track they didn't intend to remove | Never auto-delete — the audit and brief both already establish this; recommendation-only UI with explicit confirmation |
| **4 — Crates** | Schema churn if the Phase 1 schema didn't anticipate crate relationships well enough | Mitigated by deliberately *not* trying to guess the crate schema during Phase 1 — it's added fresh once the actual UI requirements are concrete, not retrofitted |
| **5 — Set builder** | Presenting BPM/key/energy recommendations as more musically authoritative than they are | Show compatibility as a qualitative signal ("high/moderate compatibility"), not a hard rule — matches the brief's own explicit instruction not to pretend the algorithm is musically perfect |
| **6 — Rekordbox export** | Shipping an export that looks correct but silently fails to import into current Rekordbox versions, since the existing implementation was never verified against a real spec | Research pass against Pioneer's current documentation is a named, required step in this phase, not assumed already done just because a version of this feature already exists |
| **7 — Polish** | Scope creep — "polish" quietly becoming a place new features sneak in | Explicitly scoped as a pass over what Phases 1–6 already built, nothing net-new |

---

*No phase above has been started. Per the standing instruction, implementation begins only on explicit direction about which phase to execute and when.*
