import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';

const execFileMock = vi.fn();
const fetchSpotifyTrackMetadataMock = vi.fn();

// Only child_process and spotify-api are mocked — everything downstream of
// the metadata-fetch decision (audio download, bpm/key, artwork, metadata
// write) is never reached in these tests: with execFile resolving empty
// output, no audio file actually lands on disk for either the spotdl
// attempt or its YouTube-search fallback, so processSpotifyTrack fails at
// "No YouTube results found" (the fallback's own file-existence check)
// right after the metadata step. That's fine here — these tests only care
// whether fetchSpotifyTrackMetadata was (or wasn't) called, not whether the
// full pipeline completes.
vi.mock('child_process', () => {
  function execFile(file: string, args: string[], optionsOrCallback?: unknown, maybeCallback?: unknown) {
    const callback = (typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback) as
      | ((err: Error | null, stdout?: string, stderr?: string) => void)
      | undefined;
    Promise.resolve(execFileMock(file, args)).then(
      (result: { stdout?: string; stderr?: string } = {}) => callback?.(null, result.stdout ?? '', result.stderr ?? ''),
      (err: Error) => callback?.(err)
    );
  }
  (execFile as unknown as Record<symbol, unknown>)[promisify.custom] = async (file: string, args: string[]) => {
    const result = (await execFileMock(file, args)) ?? {};
    return { stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  };
  return { execFile };
});

vi.mock('../src/spotify-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/spotify-api')>();
  return {
    ...actual,
    fetchSpotifyTrackMetadata: (...args: unknown[]) => fetchSpotifyTrackMetadataMock(...args),
  };
});

import { processSpotifyTrack, downloadAudioFromYouTubeSearch } from '../src/downloader/spotify';
import type { SpotifyTrackMetadata } from '../src/spotify-api';

const TRACK_URL = 'https://open.spotify.com/track/47iKV0KlcvlflSsrCPD3TQ';

const PREFETCHED_METADATA: SpotifyTrackMetadata = {
  id: '47iKV0KlcvlflSsrCPD3TQ',
  title: 'Test Track',
  artist: 'Test Artist',
  allArtists: 'Test Artist',
  duration: 180,
  thumbnail: null,
  albumName: 'Test Album',
};

let tmpDir: string;

beforeEach(() => {
  execFileMock.mockReset();
  fetchSpotifyTrackMetadataMock.mockReset();
  execFileMock.mockResolvedValue({ stdout: '', stderr: '' });
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ilovemusic-spotify-test-'));
});

describe('processSpotifyTrack — metadata source', () => {
  it('uses pre-fetched `metadata` and never calls fetchSpotifyTrackMetadata (proxy path — no local credentials needed)', async () => {
    await expect(
      processSpotifyTrack(TRACK_URL, {
        outputDir: path.join(tmpDir, 'tracks'),
        artworkDir: path.join(tmpDir, 'artwork'),
        metadata: PREFETCHED_METADATA,
      })
    ).rejects.toThrow(/No YouTube results found/);

    expect(fetchSpotifyTrackMetadataMock).not.toHaveBeenCalled();
  });

  it('falls back to fetchSpotifyTrackMetadata via `spotify` credentials when no pre-fetched metadata is given (existing BYOK path, unchanged)', async () => {
    fetchSpotifyTrackMetadataMock.mockResolvedValue(PREFETCHED_METADATA);

    await expect(
      processSpotifyTrack(TRACK_URL, {
        outputDir: path.join(tmpDir, 'tracks'),
        artworkDir: path.join(tmpDir, 'artwork'),
        spotify: { clientId: 'test-id', clientSecret: 'test-secret' },
      })
    ).rejects.toThrow(/No YouTube results found/);

    expect(fetchSpotifyTrackMetadataMock).toHaveBeenCalledWith('47iKV0KlcvlflSsrCPD3TQ', {
      clientId: 'test-id',
      clientSecret: 'test-secret',
    });
  });

  it('throws a clear error immediately when neither `metadata` nor `spotify` is provided, before attempting any download', async () => {
    await expect(
      processSpotifyTrack(TRACK_URL, {
        outputDir: path.join(tmpDir, 'tracks'),
        artworkDir: path.join(tmpDir, 'artwork'),
      })
    ).rejects.toThrow('processSpotifyTrack requires either `spotify` credentials or pre-fetched `metadata`.');

    expect(fetchSpotifyTrackMetadataMock).not.toHaveBeenCalled();
    expect(execFileMock).not.toHaveBeenCalled();
  });
});

describe('downloadAudioFromYouTubeSearch — zero-results detection', () => {
  // Reproduces a real, confirmed case: yt-dlp exits 0 for a ytsearch query
  // that matches zero videos (searching for the phrase "real sex" — even
  // the exact title of a fully public, unrestricted video — returns zero
  // results, while unrelated searches for the same artist work fine). yt-dlp
  // itself never raises an error for this, so the only way to detect it is
  // checking whether a file actually landed on disk.
  it('throws a specific, actionable error when yt-dlp succeeds but produces no file', async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ilovemusic-ytsearch-test-'));
    const outputTemplate = path.join(outDir, 'job-1.%(ext)s');

    await expect(downloadAudioFromYouTubeSearch('Swapa Real Sex', outputTemplate)).rejects.toThrow(
      /No YouTube results found/
    );
  });

  it('succeeds without throwing when a matching file is actually produced', async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ilovemusic-ytsearch-test-'));
    const outputTemplate = path.join(outDir, 'job-2.%(ext)s');

    // Simulate yt-dlp actually writing a real file, same as a genuine match.
    execFileMock.mockImplementationOnce(async () => {
      fs.writeFileSync(path.join(outDir, 'job-2.mp3'), 'fake mp3 bytes');
      return { stdout: '', stderr: '' };
    });

    await expect(downloadAudioFromYouTubeSearch('Sade No Ordinary Love', outputTemplate)).resolves.toBeUndefined();
  });
});
