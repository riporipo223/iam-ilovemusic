-- ILoveMusic desktop app — SQLite schema (Phase 1 of ILOVEMUSIC_IMPLEMENTATION_PLAN.md).
-- Applied by db/migrate-from-json.js. Idempotent: every statement uses
-- IF NOT EXISTS, safe to run against an already-migrated database.
--
-- Columns reflect a real field survey of this machine's actual tracks.json
-- (35 tracks), not the implementation plan's first-pass sketch — bitrate/
-- sample_rate were planned but don't exist anywhere in real data; format
-- and file_size (as human strings) do. See ILOVEMUSIC_IMPLEMENTATION_PLAN.md
-- section 2 for the schema this superseded, and the migration report for
-- the reasoning behind each of the four confirmed transform decisions
-- below (artwork blob dropped, key '—' normalized to NULL, current_time
-- dropped, file_size parsed to bytes).

CREATE TABLE IF NOT EXISTS tracks (
    id                INTEGER PRIMARY KEY,  -- the original numeric track id (a timestamp-shaped value from the source app), not a new surrogate key
    title             TEXT NOT NULL,
    artist            TEXT NOT NULL,
    duration          REAL,                 -- seconds, fractional (source data: e.g. 148.816708)
    file_path         TEXT NOT NULL,        -- canonical location of the audio file; url (file://+file_path) is derived on read, not stored
    artwork_path      TEXT NOT NULL,        -- canonical location of the artwork file; confirmed present and pointing to a real file for every track before dropping the redundant base64 blob
    bpm               INTEGER,
    bpm_source        TEXT,                 -- 'aubio' | 'spotify' | NULL — how bpm was determined, present for 12/35 source tracks
    key                TEXT,                -- musical key, e.g. 'D min'; NULL means "not detected" (source used the literal string '—' for this — normalized here per confirmed decision; '—' is a DISPLAY concern for the UI layer, not a stored value)
    genre             TEXT,                 -- nullable, present for 12/35 source tracks
    format            TEXT NOT NULL,        -- 'MP3' | 'M4A' in source data
    file_size_bytes   INTEGER,              -- parsed from the source's human-formatted "4.5 MB" string (1024*1024-based, confirmed against real on-disk file sizes) — see migration report for the precision caveat this implies
    source            TEXT NOT NULL,        -- 'spotify' | 'soundcloud' | 'bandcamp'
    download_source   TEXT,                 -- 'youtube-fallback' | 'spotdl' | NULL — Spotify-specific, present for 27/35 source tracks
    spotify_url       TEXT,                 -- nullable, present only for Spotify-sourced tracks
    date_added        TEXT NOT NULL         -- ISO 8601 string, kept as the source's own representation rather than converted to a Unix timestamp
);

CREATE INDEX IF NOT EXISTS idx_tracks_bpm ON tracks(bpm);
CREATE INDEX IF NOT EXISTS idx_tracks_key ON tracks(key);
CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
CREATE INDEX IF NOT EXISTS idx_tracks_genre ON tracks(genre);

-- Small internal bookkeeping table, not part of the app's real data model —
-- lets the migration (and, later, the app's own startup check) tell
-- "database exists but is empty because nothing has been added yet" apart
-- from "database exists because a migration already ran."
CREATE TABLE IF NOT EXISTS _migrations (
    name        TEXT PRIMARY KEY,
    applied_at  TEXT NOT NULL
);
