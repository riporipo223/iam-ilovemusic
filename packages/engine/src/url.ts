export type TrackSource = 'soundcloud' | 'spotify' | 'bandcamp' | 'unknown';

export function detectUrlSource(url: string): TrackSource {
  if (!url || typeof url !== 'string') return 'unknown';

  const lowerUrl = url.toLowerCase();
  if (lowerUrl.includes('soundcloud.com')) return 'soundcloud';
  if (lowerUrl.includes('open.spotify.com/track/')) return 'spotify';
  if (lowerUrl.includes('bandcamp.com')) return 'bandcamp';

  return 'unknown';
}

/**
 * Extract Spotify track ID from URL.
 * Example: https://open.spotify.com/track/47iKV0KlcvlflSsrCPD3TQ?si=xxx -> 47iKV0KlcvlflSsrCPD3TQ
 */
export function extractSpotifyTrackId(url: string): string | null {
  const match = url.match(/track\/([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

export function cleanSoundCloudUrl(url: string): string {
  if (!url || typeof url !== 'string') return url;
  try {
    const parsed = new URL(url);
    parsed.search = '';
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * True only for a single-track Bandcamp URL (path contains `/track/`).
 * Deliberately a whitelist, not a blacklist of `/album/` — main.js has no
 * URL-shape branching for Bandcamp at all (track vs. album routing is done
 * by the desktop UI choosing a different IPC channel, not by parsing the
 * URL), so our API has to make this distinction itself. Rejecting anything
 * that isn't clearly a track page also covers artist root/discography
 * pages, tag pages, etc. — not just `/album/` — since yt-dlp would treat
 * any of those as a playlist too, with the same corrupt-output risk.
 *
 * Pattern verified against live Bandcamp URLs, not assumed:
 *   track: https://hopalong.bandcamp.com/track/tibetan-pop-stars
 *   album: https://discoveryband.bandcamp.com/album/lp-deluxe-edition
 */
export function isBandcampTrackUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  try {
    const { pathname } = new URL(url);
    return /^\/track\//.test(pathname);
  } catch {
    return false;
  }
}
