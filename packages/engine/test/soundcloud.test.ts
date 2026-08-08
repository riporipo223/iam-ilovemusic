import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';

const execFileMock = vi.fn();
const detectBPMFromAudioMock = vi.fn();
const readAudioMetadataMock = vi.fn();

// Mock at the level of soundcloud.ts's direct collaborators, not further
// down (real 'fs' is used so the concurrency test below proves actual
// filesystem behavior, not just mock bookkeeping).
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
  // Real child_process.execFile carries this symbol so util.promisify()
  // resolves to {stdout, stderr} instead of just the first callback arg —
  // replicate it here or promisify(execFile) behaves differently under
  // test than it does for real.
  (execFile as unknown as Record<symbol, unknown>)[promisify.custom] = async (file: string, args: string[]) => {
    const result = (await execFileMock(file, args)) ?? {};
    return { stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  };
  return { execFile };
});

vi.mock('../src/processing/bpm', () => ({
  detectBPMFromAudio: (...args: unknown[]) => detectBPMFromAudioMock(...args),
}));

vi.mock('../src/processing/metadata', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/processing/metadata')>();
  return {
    ...actual,
    readAudioMetadata: (...args: unknown[]) => readAudioMetadataMock(...args),
  };
});

// These now live in ytdlp-track.ts (generalized in Phase 3 for Bandcamp
// reuse — see soundcloud.ts, which is now a thin alias). Same functions,
// same behavior, just relocated — this file keeps testing them directly.
import {
  resolveYtDlpTrackInfo as resolveSoundCloudTrackInfo,
  detectBpmKeyFromInfo,
  resolveArtworkUrl,
  downloadThumbnailViaYtDlp,
} from '../src/downloader/ytdlp-track';

beforeEach(() => {
  execFileMock.mockReset();
  detectBPMFromAudioMock.mockReset();
  readAudioMetadataMock.mockReset();
  readAudioMetadataMock.mockRejectedValue(new Error('no embedded tags (default test mock)'));
  detectBPMFromAudioMock.mockResolvedValue(null);
});

describe('resolveSoundCloudTrackInfo', () => {
  it('parses yt-dlp JSON output', async () => {
    execFileMock.mockResolvedValueOnce({ stdout: JSON.stringify({ id: '123', title: 'Track' }) });
    const info = await resolveSoundCloudTrackInfo('https://soundcloud.com/artist/track');
    expect(info).toEqual({ id: '123', title: 'Track' });
  });

  it('gives a clear error when yt-dlp itself is missing', async () => {
    execFileMock.mockRejectedValueOnce(new Error('yt-dlp: command not found'));
    await expect(resolveSoundCloudTrackInfo('https://soundcloud.com/artist/track')).rejects.toThrow(
      /yt-dlp not found or not working/
    );
  });

  it('gives a clear error when the URL/track cannot be resolved', async () => {
    execFileMock.mockRejectedValueOnce(new Error('ERROR: Unsupported URL'));
    await expect(resolveSoundCloudTrackInfo('https://soundcloud.com/bad/track')).rejects.toThrow(
      /may be invalid or the track unavailable/
    );
  });
});

describe('detectBpmKeyFromInfo — BPM/key fallback tiers', () => {
  it('tier 1: reads bpm/key from tags', async () => {
    const result = await detectBpmKeyFromInfo({ tags: ['Techno bpm: 128', 'F key'] }, '/tmp/does-not-matter.mp3');
    expect(result).toEqual({ bpm: 128, key: 'F' });
  });

  it('tier 2: falls back to description when tags have nothing', async () => {
    const result = await detectBpmKeyFromInfo({ description: 'Recorded at bpm 140, G key' }, '/tmp/x.mp3');
    expect(result).toEqual({ bpm: 140, key: 'G' });
  });

  it('tier 3: falls back to title for BPM only (no key from title)', async () => {
    const result = await detectBpmKeyFromInfo({ title: 'My Track (bpm 122 edit)' }, '/tmp/x.mp3');
    expect(result.bpm).toBe(122);
    expect(result.key).toBeNull();
  });

  it('tier 4: falls back to embedded audio file metadata', async () => {
    readAudioMetadataMock.mockResolvedValueOnce({ common: { bpm: 95.4, key: 'A min' } });
    const result = await detectBpmKeyFromInfo({}, '/tmp/x.mp3');
    expect(result).toEqual({ bpm: 95, key: 'A min' });
  });

  it('tier 5: falls back to aubio audio analysis for BPM (no key equivalent)', async () => {
    detectBPMFromAudioMock.mockResolvedValueOnce(174);
    const result = await detectBpmKeyFromInfo({}, '/tmp/x.mp3');
    expect(result).toEqual({ bpm: 174, key: null });
  });

  it('never calls python/librosa key detection — key stays null when every tier misses', async () => {
    const result = await detectBpmKeyFromInfo({}, '/tmp/x.mp3');
    expect(result).toEqual({ bpm: null, key: null });
  });

  it('an earlier tier finding bpm does not stop key still being searched in later tiers', async () => {
    readAudioMetadataMock.mockResolvedValueOnce({ common: { bpm: null, key: 'D min' } });
    // bpm found in tags (tier 1), key only shows up in tier 4 (embedded metadata).
    const result = await detectBpmKeyFromInfo({ tags: ['bpm 130'] }, '/tmp/x.mp3');
    expect(result).toEqual({ bpm: 130, key: 'D min' });
  });
});

describe('resolveArtworkUrl — 8-tier fallback (pure function, no mocking needed)', () => {
  it('tier 1: direct thumbnail string', () => {
    expect(resolveArtworkUrl({ thumbnail: 'https://i1.sndcdn.com/artworks-abc-t500x500.jpg' })).toBe(
      'https://i1.sndcdn.com/artworks-abc-large.jpg'
    );
  });

  it('tier 2: thumbnails array, prefers highest quality (last element)', () => {
    const info = { thumbnails: [{ url: 'https://x/small.jpg' }, { url: 'https://x/large-medium.jpg' }] };
    expect(resolveArtworkUrl(info)).toBe('https://x/large-large.jpg');
  });

  it('tier 2: thumbnails object with quality keys', () => {
    const info = { thumbnails: { large: 'https://x/big-small.jpg' } };
    expect(resolveArtworkUrl(info)).toBe('https://x/big-large.jpg');
  });

  it('tier 3: artwork_url field', () => {
    expect(resolveArtworkUrl({ artwork_url: 'https://x/art-medium.jpg' })).toBe('https://x/art-large.jpg');
  });

  it('tier 4: track.artwork_url', () => {
    expect(resolveArtworkUrl({ track: { artwork_url: 'https://x/track-art.jpg' } })).toBe('https://x/track-art.jpg');
  });

  it('tier 5: album thumbnail', () => {
    expect(resolveArtworkUrl({ album: { thumbnail: 'https://x/album.jpg' } })).toBe('https://x/album.jpg');
  });

  it('tier 6: playlist artwork_url', () => {
    expect(resolveArtworkUrl({ playlist: { artwork_url: 'https://x/playlist-small.jpg' } })).toBe(
      'https://x/playlist-large.jpg'
    );
  });

  it('tier 7: uploader_thumbnail as last-resort real field', () => {
    expect(resolveArtworkUrl({ uploader_thumbnail: 'https://x/uploader.jpg' })).toBe('https://x/uploader.jpg');
  });

  it('tier 8: constructs a CDN URL from an id regex-extracted out of thumbnails when no earlier tier resolves', () => {
    // artwork_url must be absent here — if it were set, tier 3 would
    // consume it directly and tier 8 would never run. thumbnails is a
    // shape tier 2 can't extract a URL from directly (no large/default/
    // medium keys), but still contains an "artworks-ID" pattern tier 8's
    // regex can pull out — gated on info.id being present, matching
    // main.js's original gate (the id value itself isn't used, only its
    // presence).
    const info = { id: 'x', thumbnails: { nested: { random: 'artworks-XYZ123-foo' } } };
    expect(resolveArtworkUrl(info)).toBe('https://i1.sndcdn.com/artworks-XYZ123-large.jpg');
  });

  it('returns null when nothing resolves', () => {
    expect(resolveArtworkUrl({})).toBeNull();
  });
});

describe('downloadThumbnailViaYtDlp — concurrency safety (the process.chdir() fix)', () => {
  it('resolves two concurrent SoundCloud artwork fallbacks to their own correct directories without cross-contamination', async () => {
    // execFile mock stands in for yt-dlp: it reads the real `-o` argument
    // (an absolute path — this only works because the real code never
    // calls process.chdir()) and writes a real file there via the real
    // 'fs' module, with a random delay so the two concurrent calls
    // actually interleave in time instead of running serially.
    execFileMock.mockImplementation(async (_file: string, args: string[]) => {
      const oIndex = args.indexOf('-o');
      const outputTemplate = args[oIndex + 1];
      const resolvedPath = outputTemplate.replace('%(ext)s', 'jpg');

      await new Promise((resolve) => setTimeout(resolve, Math.random() * 30));
      fs.writeFileSync(resolvedPath, `thumbnail-for:${resolvedPath}`);
      return { stdout: '' };
    });

    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'ilm-engine-test-a-'));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'ilm-engine-test-b-'));

    try {
      const [pathA, pathB] = await Promise.all([
        downloadThumbnailViaYtDlp('https://soundcloud.com/artist/track-a', dirA, 'job-a'),
        downloadThumbnailViaYtDlp('https://soundcloud.com/artist/track-b', dirB, 'job-b'),
      ]);

      expect(pathA).toBe(path.join(dirA, 'job-a.jpg'));
      expect(pathB).toBe(path.join(dirB, 'job-b.jpg'));

      // The real assertion: each file landed in ITS OWN directory with ITS
      // OWN content, not swapped or overwritten by the other concurrent call.
      expect(fs.readFileSync(pathA!, 'utf8')).toBe(`thumbnail-for:${pathA}`);
      expect(fs.readFileSync(pathB!, 'utf8')).toBe(`thumbnail-for:${pathB}`);
      expect(fs.readdirSync(dirA)).toEqual(['job-a.jpg']);
      expect(fs.readdirSync(dirB)).toEqual(['job-b.jpg']);
    } finally {
      fs.rmSync(dirA, { recursive: true, force: true });
      fs.rmSync(dirB, { recursive: true, force: true });
    }
  });

  it('returns null when yt-dlp itself fails, without throwing', async () => {
    execFileMock.mockRejectedValueOnce(new Error('yt-dlp exited with code 1'));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ilm-engine-test-'));
    try {
      const result = await downloadThumbnailViaYtDlp('https://soundcloud.com/artist/track', dir, 'job-x');
      expect(result).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
