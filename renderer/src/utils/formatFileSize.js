/**
 * Formats a raw byte count as a human-readable string, e.g. "4.5 MB".
 *
 * Matches the exact convention the app already used before the SQLite
 * migration (main.js's enrich-track-metadata handler: `(stats.size /
 * (1024 * 1024)).toFixed(1) + ' MB'`) for the MB range, extended the same
 * way (1024-based, one decimal place) for bytes/KB/GB. The database now
 * stores the canonical byte count; this formatting is the UI layer's job,
 * not the database's — see ILOVEMUSIC_IMPLEMENTATION_PLAN.md's Phase 1.
 *
 * Not yet wired into any real UI — see the SQLite migration report for why.
 */
export function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
