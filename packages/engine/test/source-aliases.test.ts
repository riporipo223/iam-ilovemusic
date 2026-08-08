import { describe, it, expect, vi, beforeEach } from 'vitest';

// soundcloud.ts and bandcamp.ts are thin wrappers over processYtDlpTrack —
// this tests that wrapping (source label + url field renaming) in
// isolation, since the other engine tests exercise processYtDlpTrack
// itself directly and never actually go through these alias files.
const processYtDlpTrackMock = vi.fn();

vi.mock('../src/downloader/ytdlp-track', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/downloader/ytdlp-track')>();
  return { ...actual, processYtDlpTrack: (...args: unknown[]) => processYtDlpTrackMock(...args) };
});

import { processSoundCloudTrack } from '../src/downloader/soundcloud';
import { processBandcampTrack } from '../src/downloader/bandcamp';

beforeEach(() => {
  processYtDlpTrackMock.mockReset();
});

function fakeResult(source: 'soundcloud' | 'bandcamp', sourceUrl: string) {
  return {
    id: 'job-1',
    title: 'Track',
    artist: 'Artist',
    duration: 120,
    filePath: '/tmp/job-1.mp3',
    bpm: 128,
    key: null,
    artworkPath: null,
    source,
    sourceUrl,
  };
}

describe('processSoundCloudTrack (thin alias)', () => {
  it('calls processYtDlpTrack with source="soundcloud" and relabels the result', async () => {
    const url = 'https://soundcloud.com/artist/track';
    processYtDlpTrackMock.mockResolvedValueOnce(fakeResult('soundcloud', url));

    const result = await processSoundCloudTrack(url, { outputDir: '/tmp/out', artworkDir: '/tmp/art', jobId: 'job-1' });

    expect(processYtDlpTrackMock).toHaveBeenCalledWith(
      url,
      expect.objectContaining({ source: 'soundcloud', outputDir: '/tmp/out', artworkDir: '/tmp/art', jobId: 'job-1' })
    );
    expect(result.source).toBe('soundcloud');
    expect(result.soundcloudUrl).toBe(url);
    expect((result as unknown as { sourceUrl?: string }).sourceUrl).toBeUndefined();
  });
});

describe('processBandcampTrack (thin alias)', () => {
  it('calls processYtDlpTrack with source="bandcamp" and relabels the result', async () => {
    const url = 'https://artist.bandcamp.com/track/song-name';
    processYtDlpTrackMock.mockResolvedValueOnce(fakeResult('bandcamp', url));

    const result = await processBandcampTrack(url, { outputDir: '/tmp/out', artworkDir: '/tmp/art', jobId: 'job-1' });

    expect(processYtDlpTrackMock).toHaveBeenCalledWith(
      url,
      expect.objectContaining({ source: 'bandcamp', outputDir: '/tmp/out', artworkDir: '/tmp/art', jobId: 'job-1' })
    );
    expect(result.source).toBe('bandcamp');
    expect(result.bandcampUrl).toBe(url);
    expect((result as unknown as { sourceUrl?: string }).sourceUrl).toBeUndefined();
  });
});
