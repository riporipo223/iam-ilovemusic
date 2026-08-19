import { describe, it, expect, vi } from 'vitest';

// worker.ts's top-level imports create real Postgres/Redis/Queue clients —
// mock them the same way downloads.test.ts/health.test.ts do, purely so
// importing the module under test doesn't try to open a real connection.
// clientFacingError() itself touches none of these; it's a pure function.
vi.mock('../src/db/pool', () => ({ pool: { query: vi.fn() } }));
vi.mock('../src/queue/connection', () => ({
  redisConnection: undefined,
  downloadsQueue: { add: vi.fn() },
  DOWNLOADS_QUEUE_NAME: 'downloads',
}));
vi.mock('../src/storage/r2', () => ({ getDownloadUrl: vi.fn(), uploadResultFile: vi.fn() }));

const { clientFacingError } = await import('../src/worker');

// Captured via direct reproduction (non-verbose yt-dlp, matching this
// worker's actual invocation exactly) against a real, fully public,
// unrestricted YouTube video that still hit YouTube's PO Token/SABR
// streaming enforcement — not fabricated.
const REAL_PO_TOKEN_403_MESSAGE = `Command failed: /opt/homebrew/bin/yt-dlp --js-runtimes quickjs:/Users/ripo/2. PROJECT/ILoveMusic/apps/api/bin/quickjs --ffmpeg-location /opt/homebrew/bin/ffmpeg -x -f bestaudio -o 2264f835-eeba-4997-b929-fe72ab92a23d/audio/2264f835-eeba-4997-b929-fe72ab92a23d.%(ext)s ytsearch1:The Smiths Well I Wonder - 2011 Remaster official audio
WARNING: Your yt-dlp version (2026.03.17) is older than 90 days!
         It is strongly recommended to always use the latest version.
         You installed yt-dlp with pip or using the wheel from PyPi; Use that to update.
         To suppress this warning, add --no-update to your command/config.
ERROR: unable to download video data: HTTP Error 403: Forbidden
[download] Finished downloading playlist: The Smiths Well I Wonder - 2011 Remaster official audio`;

const FRIENDLY_MESSAGE = "This track couldn't be downloaded from YouTube right now due to platform restrictions. Try a different track, or try again later.";

describe('clientFacingError', () => {
  it('replaces the real, confirmed PO Token/SABR 403 message for a Spotify job', () => {
    expect(clientFacingError('spotify', REAL_PO_TOKEN_403_MESSAGE)).toBe(FRIENDLY_MESSAGE);
  });

  it('does not touch the same 403 shape for SoundCloud/Bandcamp — their own yt-dlp calls never touch YouTube, so it would be a wrong, not just imprecise, label', () => {
    const soundcloudLikeMessage = REAL_PO_TOKEN_403_MESSAGE.replace('ytsearch1:', '').replace(
      'The Smiths Well I Wonder - 2011 Remaster official audio',
      'https://soundcloud.com/some/track'
    );
    expect(clientFacingError('soundcloud', soundcloudLikeMessage)).toBe(soundcloudLikeMessage);
    expect(clientFacingError('bandcamp', soundcloudLikeMessage)).toBe(soundcloudLikeMessage);
  });

  it('leaves the zero-results fallback message untouched (already specific and correct)', () => {
    const zeroResultsMessage =
      'No YouTube results found for "Swapa Real Sex official audio" — this track may not be findable via YouTube search, or nothing relevant matched.';
    expect(clientFacingError('spotify', zeroResultsMessage)).toBe(zeroResultsMessage);
  });

  it('leaves the generic "file not found" message untouched', () => {
    const message = 'Downloaded audio file not found for track: Some Track';
    expect(clientFacingError('spotify', message)).toBe(message);
  });

  it('leaves the Bandcamp album/playlist rejection untouched', () => {
    const message =
      'Bandcamp album/playlist URLs are not yet supported — submit an individual track URL (path containing /track/).';
    expect(clientFacingError('bandcamp', message)).toBe(message);
  });

  it('leaves a BYOK credential validation error untouched', () => {
    const message = 'Spotify rejected these credentials: invalid_client';
    expect(clientFacingError('spotify', message)).toBe(message);
  });

  it('leaves an unrelated Spotify error (not a video-data 403) untouched', () => {
    const message = 'spotdl reported success but produced no output file for track abc123';
    expect(clientFacingError('spotify', message)).toBe(message);
  });
});
