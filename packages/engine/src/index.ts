export { resolveBinary } from './binaries';
export type { BinaryName } from './binaries';

export { detectUrlSource, extractSpotifyTrackId, cleanSoundCloudUrl, isBandcampTrackUrl } from './url';
export type { TrackSource } from './url';

export { getSpotifyAccessToken, fetchSpotifyTrackMetadata } from './spotify-api';
export type { SpotifyCredentials, SpotifyTrackMetadata } from './spotify-api';

export { detectBPMFromAudio } from './processing/bpm';
export { detectKey } from './processing/key';
export { downloadArtwork, writeMetadataToFile, readAudioMetadata } from './processing/metadata';
export type { TrackMetadataInput } from './processing/metadata';

export {
  processSpotifyTrack,
  downloadAudioFromSpotify,
  downloadAudioFromYouTubeSearch,
} from './downloader/spotify';
export type {
  ProcessSpotifyTrackOptions,
  ProcessedSpotifyTrack,
  DownloadSource,
  SpotifyProgressStage,
  SpotifyProgressEvent,
} from './downloader/spotify';

export { processSoundCloudTrack } from './downloader/soundcloud';
export type {
  ProcessSoundCloudTrackOptions,
  ProcessedSoundCloudTrack,
  SoundCloudProgressStage,
  SoundCloudProgressEvent,
} from './downloader/soundcloud';

export { processBandcampTrack } from './downloader/bandcamp';
export type {
  ProcessBandcampTrackOptions,
  ProcessedBandcampTrack,
  BandcampProgressStage,
  BandcampProgressEvent,
} from './downloader/bandcamp';

// Generic yt-dlp pipeline shared by soundcloud.ts/bandcamp.ts above — exported
// directly too since apps/api's engine-level tests target it (the tiered
// fallback logic lives here now, not duplicated per source).
export {
  processYtDlpTrack,
  resolveYtDlpTrackInfo,
  downloadYtDlpAudio,
  detectBpmKeyFromInfo,
  resolveArtworkUrl,
  downloadThumbnailViaYtDlp,
  resolveArtwork,
} from './downloader/ytdlp-track';
export type {
  YtDlpSource,
  ProcessYtDlpTrackOptions,
  ProcessedYtDlpTrack,
  YtDlpProgressStage,
  YtDlpProgressEvent,
} from './downloader/ytdlp-track';

export { findDownloadedFile, clearExistingOutputFiles } from './util';
