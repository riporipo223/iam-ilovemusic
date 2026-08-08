import { describe, it, expect } from 'vitest';
import { isBandcampTrackUrl } from '../src/url';

// Real, currently-live Bandcamp URLs (verified via web search before
// implementing this guard, not assumed) — not fabricated examples.
const REAL_TRACK_URLS = ['https://hopalong.bandcamp.com/track/tibetan-pop-stars'];

const REAL_ALBUM_URLS = [
  'https://discoveryband.bandcamp.com/album/lp-deluxe-edition',
  'https://samadamsmusic.bandcamp.com/album/discover',
  'https://phobiarecords.bandcamp.com/album/discover-crimes-of-humanity-lp',
  'https://panterah.bandcamp.com/album/discover',
];

describe('isBandcampTrackUrl', () => {
  it.each(REAL_TRACK_URLS)('accepts a real track URL: %s', (url) => {
    expect(isBandcampTrackUrl(url)).toBe(true);
  });

  it.each(REAL_ALBUM_URLS)('rejects a real album URL: %s', (url) => {
    expect(isBandcampTrackUrl(url)).toBe(false);
  });

  it('rejects an artist root/discography page (also a playlist to yt-dlp)', () => {
    expect(isBandcampTrackUrl('https://hopalong.bandcamp.com/')).toBe(false);
    expect(isBandcampTrackUrl('https://hopalong.bandcamp.com/music')).toBe(false);
  });

  it('rejects a non-Bandcamp URL', () => {
    expect(isBandcampTrackUrl('https://soundcloud.com/artist/track')).toBe(false);
  });

  it('handles trailing query params/fragments on a real track URL', () => {
    expect(isBandcampTrackUrl('https://hopalong.bandcamp.com/track/tibetan-pop-stars?utm_source=x')).toBe(true);
  });

  it('rejects malformed input without throwing', () => {
    expect(isBandcampTrackUrl('not a url')).toBe(false);
    expect(isBandcampTrackUrl('')).toBe(false);
  });
});
