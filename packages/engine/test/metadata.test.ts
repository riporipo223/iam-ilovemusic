import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';

const execFileMock = vi.fn();

// Same mocking approach as spotify.test.ts — execFileAsync (promisify(execFile))
// uses [promisify.custom] under the hood, which is what actually gets exercised.
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

import { writeMetadataToFile } from '../src/processing/metadata';

let tmpDir: string;

beforeEach(() => {
  execFileMock.mockReset();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ilovemusic-metadata-test-'));
});

function makeSourceFile(ext: string): string {
  const filePath = path.join(tmpDir, `track${ext}`);
  fs.writeFileSync(filePath, 'fake audio bytes');
  return filePath;
}

// The real bug: ffmpeg can't infer an output container from "<name><ext>.tmp"
// (the ".tmp" suffix breaks its extension-based auto-detection), so every
// extension needs its own explicit -f flag — confirmed via direct
// reproduction that a missing case makes ffmpeg fail with "Unable to choose
// an output format ... use a standard extension for the filename or specify
// the format manually," which was previously silently swallowed by
// processSpotifyTrack()'s catch around this call, leaving tracks downloaded
// via yt-dlp's `-f bestaudio` path (typically .opus) with no embedded tags
// at all despite the job reporting success.
describe('writeMetadataToFile — output format flag per extension', () => {
  it.each([
    ['.mp3', 'mp3'],
    ['.flac', 'flac'],
    ['.ogg', 'ogg'],
    ['.oga', 'ogg'],
    ['.opus', 'opus'],
    ['.webm', 'webm'],
  ])('passes -f %s for a %s file, not left for ffmpeg to guess', async (ext, expectedFormat) => {
    const filePath = makeSourceFile(ext);

    execFileMock.mockImplementationOnce(async (_file: string, args: string[]) => {
      // Mirrors what the real code checks afterwards: the tempPath must exist.
      const outIndex = args.indexOf('-y') + 1;
      fs.writeFileSync(args[outIndex], 'fake output bytes');
      return { stdout: '', stderr: '' };
    });

    await writeMetadataToFile(filePath, { title: 'Test Title', artist: 'Test Artist' });

    const calledArgs = execFileMock.mock.calls[0][1] as string[];
    const formatFlagIndex = calledArgs.indexOf('-f');
    expect(formatFlagIndex, `expected -f to be present in ffmpeg args for ${ext}`).toBeGreaterThan(-1);
    expect(calledArgs[formatFlagIndex + 1]).toBe(expectedFormat);
  });

  it('renames the temp file over the original on success', async () => {
    const filePath = makeSourceFile('.opus');

    execFileMock.mockImplementationOnce(async (_file: string, args: string[]) => {
      const outIndex = args.indexOf('-y') + 1;
      fs.writeFileSync(args[outIndex], 'tagged output bytes');
      return { stdout: '', stderr: '' };
    });

    await writeMetadataToFile(filePath, { title: 'Test Title', artist: 'Test Artist' });

    expect(fs.readFileSync(filePath, 'utf8')).toBe('tagged output bytes');
    expect(fs.existsSync(filePath + '.tmp')).toBe(false);
  });
});

// A second, related bug found while reproducing the first live: even with
// the -f fix above, a track WITH artwork still failed for Ogg-family
// formats — confirmed via direct reproduction that ffmpeg's opus/ogg
// muxers reject a muxed-in video stream outright ("Unsupported codec id in
// stream 1"), unlike MP3/FLAC/M4A. Both bugs together meant an Ogg-family
// track with artwork (the common case for a Spotify job via the YouTube
// fallback) silently got no tags at all.
describe('writeMetadataToFile — artwork embedding per format', () => {
  function makeArtwork(): string {
    const artworkPath = path.join(tmpDir, 'cover.jpg');
    fs.writeFileSync(artworkPath, 'fake jpg bytes');
    return artworkPath;
  }

  it.each(['.opus', '.ogg', '.oga'])(
    'does not attempt to embed artwork for %s — degrades to text-only tags instead of failing entirely',
    async (ext) => {
      const filePath = makeSourceFile(ext);
      const artworkPath = makeArtwork();

      execFileMock.mockImplementationOnce(async (_file: string, args: string[]) => {
        const outIndex = args.indexOf('-y') + 1;
        fs.writeFileSync(args[outIndex], 'fake output bytes');
        return { stdout: '', stderr: '' };
      });

      await writeMetadataToFile(filePath, { title: 'Test Title', artist: 'Test Artist', artworkPath });

      const calledArgs = execFileMock.mock.calls[0][1] as string[];
      expect(calledArgs).not.toContain(artworkPath);
      expect(calledArgs).not.toContain('attached_pic');
      expect(calledArgs).toContain('title=Test Title');
    }
  );

  it('still embeds artwork for .mp3 — existing, unaffected behavior', async () => {
    const filePath = makeSourceFile('.mp3');
    const artworkPath = makeArtwork();

    execFileMock.mockImplementationOnce(async (_file: string, args: string[]) => {
      const outIndex = args.indexOf('-y') + 1;
      fs.writeFileSync(args[outIndex], 'fake output bytes');
      return { stdout: '', stderr: '' };
    });

    await writeMetadataToFile(filePath, { title: 'Test Title', artist: 'Test Artist', artworkPath });

    const calledArgs = execFileMock.mock.calls[0][1] as string[];
    expect(calledArgs).toContain(artworkPath);
    expect(calledArgs).toContain('attached_pic');
  });
});
