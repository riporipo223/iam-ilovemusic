/**
 * Thin per-source alias over ytdlp-track.ts. SoundCloud has no logic of
 * its own — confirmed via investigation that main.js runs it through
 * exactly the same code as Bandcamp (yt-dlp normalizes both extractors'
 * output into one schema). If SoundCloud ever needs source-specific
 * behavior, it belongs in ytdlp-track.ts behind an `options.source`
 * check, not duplicated here.
 */
import {
  processYtDlpTrack,
  ProcessYtDlpTrackOptions,
  ProcessedYtDlpTrack,
  YtDlpProgressStage,
  YtDlpProgressEvent,
} from './ytdlp-track';

export type SoundCloudProgressStage = YtDlpProgressStage;
export type SoundCloudProgressEvent = YtDlpProgressEvent;

export type ProcessSoundCloudTrackOptions = Omit<ProcessYtDlpTrackOptions, 'source'>;

export type ProcessedSoundCloudTrack = Omit<ProcessedYtDlpTrack, 'source' | 'sourceUrl'> & {
  source: 'soundcloud';
  soundcloudUrl: string;
};

export async function processSoundCloudTrack(
  url: string,
  options: ProcessSoundCloudTrackOptions
): Promise<ProcessedSoundCloudTrack> {
  const track = await processYtDlpTrack(url, { ...options, source: 'soundcloud' });
  const { sourceUrl, ...rest } = track;
  return { ...rest, source: 'soundcloud', soundcloudUrl: sourceUrl };
}
