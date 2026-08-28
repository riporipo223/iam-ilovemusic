// Migrates tracks.json (the desktop app's current flat-file library) into
// SQLite. Phase 1 of ILOVEMUSIC_IMPLEMENTATION_PLAN.md.
//
// Scope: tracks.json only. queue.json and albums.json are both empty ([])
// on the machine this was developed/tested against, so there's no real
// data to verify a migration path for yet — deliberately left for a
// follow-up pass rather than building and "verifying" migration logic
// against files with nothing in them.
//
// Idempotent: schema creation uses IF NOT EXISTS; row insertion uses
// INSERT OR REPLACE keyed on the track's own original id, so re-running
// this against the same tracks.json again is a no-op in effect (same rows
// overwritten with the same values), not a duplicate-accumulating one.
//
// Reversible: this script only ever READS tracks.json — it never writes,
// moves, or deletes it. Rolling back is "delete the .db file"; the source
// JSON is untouched by construction, not because of a separate backup step
// (though a real backup of the source directory should still exist
// upstream of this — see the migration report for where that lives).
'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

/**
 * Parses the source app's human-formatted "4.5 MB" file-size string back
 * into raw bytes. Confirmed against real on-disk file sizes (not assumed)
 * that the source used 1024*1024 (MiB) as the unit, not 1000*1000.
 *
 * Precision caveat, real and worth stating plainly: the source string only
 * carries one decimal digit of MB precision, so this can only recover an
 * approximation of the original byte count, not the exact value — e.g.
 * "4.5 MB" parses to 4,718,592 bytes, while the actual file this came from
 * is 4,715,800 bytes. That imprecision was already baked into the data by
 * the time it reached this migration; parsing the string can't undo it.
 */
function parseFileSizeToBytes(fileSizeStr) {
  const match = /^([\d.]+)\s*MB$/.exec(fileSizeStr);
  if (!match) {
    throw new Error(`Unrecognized fileSize format: ${JSON.stringify(fileSizeStr)} — expected "<number> MB"`);
  }
  return Math.round(parseFloat(match[1]) * 1024 * 1024);
}

/**
 * Normalizes the source app's "no key detected" convention (the literal
 * string "—", an em dash) to SQL NULL. Confirmed decision: the em dash is
 * a display convention, not a stored value — the UI layer is responsible
 * for rendering NULL as "—" when it shows a track's key.
 */
function normalizeKey(key) {
  return key === '—' ? null : key;
}

function ensureSchema(db) {
  const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schemaSql);
}

/**
 * @param {string} userDataDir directory containing tracks.json (and where
 *   the sqlite file will be created) — a real userData dir in production,
 *   a scratch test directory when verifying against a copy.
 * @param {object} [options]
 * @param {string} [options.dbFileName] override the sqlite filename, for tests.
 * @returns {{trackCount: number, dbPath: string, warnings: string[]}}
 */
function migrateFromJson(userDataDir, options = {}) {
  const tracksJsonPath = path.join(userDataDir, 'tracks.json');
  const dbPath = path.join(userDataDir, options.dbFileName || 'ilovemusic.db');

  if (!fs.existsSync(tracksJsonPath)) {
    throw new Error(`No tracks.json found at ${tracksJsonPath} — nothing to migrate.`);
  }

  const tracks = JSON.parse(fs.readFileSync(tracksJsonPath, 'utf8'));
  if (!Array.isArray(tracks)) {
    throw new Error(`tracks.json did not contain a JSON array (got ${typeof tracks}) — refusing to guess a shape.`);
  }

  const db = new Database(dbPath);
  const warnings = [];

  try {
    db.pragma('journal_mode = WAL');
    ensureSchema(db);

    const insert = db.prepare(`
      INSERT OR REPLACE INTO tracks (
        id, title, artist, duration, file_path, artwork_path,
        bpm, bpm_source, key, genre, format, file_size_bytes,
        source, download_source, spotify_url, date_added
      ) VALUES (
        @id, @title, @artist, @duration, @file_path, @artwork_path,
        @bpm, @bpm_source, @key, @genre, @format, @file_size_bytes,
        @source, @download_source, @spotify_url, @date_added
      )
    `);

    const insertMany = db.transaction((rows) => {
      for (const row of rows) {
        insert.run(row);
      }
    });

    const rows = tracks.map((t, i) => {
      // Every field this migration writes is required to exist on the
      // source record except the ones already confirmed nullable (bpm_source,
      // genre, download_source, spotify_url) or normalized (key). Anything
      // else missing means the real data doesn't match what was surveyed —
      // fail loudly rather than silently defaulting, per the explicit
      // instruction not to invent values that change what the source data means.
      const required = ['id', 'title', 'artist', 'duration', 'filePath', 'artworkPath', 'bpm', 'format', 'fileSize', 'source', 'dateAdded'];
      for (const field of required) {
        if (t[field] === undefined || t[field] === null) {
          throw new Error(`Track at index ${i} (id=${t.id}, title=${JSON.stringify(t.title)}) is missing required field "${field}" — stopping rather than guessing a default.`);
        }
      }

      return {
        id: t.id,
        title: t.title,
        artist: t.artist,
        duration: t.duration,
        file_path: t.filePath,
        artwork_path: t.artworkPath,
        bpm: t.bpm,
        bpm_source: t.bpmSource ?? null,
        key: normalizeKey(t.key),
        genre: t.genre ?? null,
        format: t.format,
        file_size_bytes: parseFileSizeToBytes(t.fileSize),
        source: t.source,
        download_source: t.downloadSource ?? null,
        spotify_url: t.spotifyUrl ?? null,
        date_added: t.dateAdded,
      };
    });

    insertMany(rows);

    db.prepare('INSERT OR REPLACE INTO _migrations (name, applied_at) VALUES (?, ?)').run(
      'tracks-from-json',
      new Date().toISOString()
    );

    const trackCount = db.prepare('SELECT COUNT(*) AS n FROM tracks').get().n;
    return { trackCount, dbPath, warnings };
  } finally {
    db.close();
  }
}

module.exports = { migrateFromJson, parseFileSizeToBytes, normalizeKey };
