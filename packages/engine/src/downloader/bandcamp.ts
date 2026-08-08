/**
 * Thin per-source alias over ytdlp-track.ts. Bandcamp has no logic of its
 * own — confirmed via investigation that main.js runs it through exactly
 * the same code as SoundCloud (yt-dlp normalizes both extractors' output
 * into one schema: resolve, BPM fallback tiers, artwork fallback tiers are
 * all identical). If Bandcamp ever needs source-specific behavior, it
 * belongs in ytdlp-track.ts behind an `options.source` check, not
 * duplicated here.
 *
 * Album/playlist URLs are explicitly NOT handled here or anywhere in this
 * module — see url.ts's isBandcampTrackUrl, which apps/api uses to reject
 * them before a job is ever created. Passing an album URL into
 * processBandcampTrack has undefined behavior (yt-dlp would attempt to
 * download the whole album into this function's single expected output
 * file) and must never happen — that's an API-layer guard, not a defense
 * in this file.
 */
import {
  processYtDlpTrack,
  ProcessYtDlpTrackOptions,
  ProcessedYtDlpTrack,
  YtDlpProgressStage,
  YtDlpProgressEvent,
} from './ytdlp-track';

export type BandcampProgressStage = YtDlpProgressStage;
export type BandcampProgressEvent = YtDlpProgressEvent;

export type ProcessBandcampTrackOptions = Omit<ProcessYtDlpTrackOptions, 'source'>;

export type ProcessedBandcampTrack = Omit<ProcessedYtDlpTrack, 'source' | 'sourceUrl'> & {
  source: 'bandcamp';
  bandcampUrl: string;
};

export async function processBandcampTrack(
  url: string,
  options: ProcessBandcampTrackOptions
): Promise<ProcessedBandcampTrack> {
  const track = await processYtDlpTrack(url, { ...options, source: 'bandcamp' });
  const { sourceUrl, ...rest } = track;
  return { ...rest, source: 'bandcamp', bandcampUrl: sourceUrl };
}
