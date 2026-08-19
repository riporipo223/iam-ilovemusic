import * as path from 'node:path';

/**
 * The downloaded result isn't always an .mp3 — the Spotify pipeline's
 * YouTube-search fallback commonly produces .opus, and other sources can
 * produce other extensions too. Read the real one from the presigned
 * result URL's own path rather than assuming .mp3 universally: confirmed
 * via direct reproduction that saving/parsing a real .opus file under a
 * mismatched .mp3 name makes music-metadata trust the (wrong) extension
 * over the file's actual content and silently return no tags at all — not
 * an error, just empty — which produced the generic "ilovemusic-track"
 * fallback name even for a file that genuinely had real embedded tags.
 */
export function resultExtension(resultUrl: string): string {
  return path.extname(new URL(resultUrl).pathname) || '.mp3';
}
