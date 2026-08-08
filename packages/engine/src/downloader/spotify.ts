import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { resolveBinary } from '../binaries';
import { SpotifyCredentials, SpotifyTrackMetadata, fetchSpotifyTrackMetadata } from '../spotify-api';
import { extractSpotifyTrackId } from '../url';
import { detectBPMFromAudio } from '../processing/bpm';
import { detectKey } from '../processing/key';
import { downloadArtwork, readAudioMetadata, writeMetadataToFile } from '../processing/metadata';
import { clearExistingOutputFiles, findDownloadedFile } from '../util';

const execFileAsync = promisify(execFile);

export type DownloadSource = 'spotdl' | 'youtube-fallback';

export type SpotifyProgressStage =
  | 'fetching-metadata'
  | 'downloading-audio'
  | 'downloading-audio-fallback'
  | 'detecting-bpm-key'
  | 'downloading-artwork'
  | 'writing-metadata'
  | 'done';

export interface SpotifyProgressEvent {
  stage: SpotifyProgressStage;
  message?: string;
}

export interface ProcessSpotifyTrackOptions {
  /** Directory the downloaded audio file is written to (created if missing). */
  outputDir: string;
  /** Directory artwork images are written to (created if missing). */
  artworkDir: string;
  spotify: SpotifyCredentials;
  /** Used as the on-disk filename stem. Defaults to Date.now(). */
  jobId?: string | number;
  /** Run the python/librosa key detector when the audio file has no embedded key tag. Default true. */
  detectKeyFallback?: boolean;
  onProgress?: (event: SpotifyProgressEvent) => void;
}

export interface ProcessedSpotifyTrack {
  id: string | number;
  title: string;
  artist: string;
  /** Seconds */
  duration: number;
  filePath: string;
  bpm: number | null;
  key: string | null;
  artworkPath: string | null;
  source: 'spotify';
  downloadSource: DownloadSource;
  spotifyUrl: string;
}

/**
 * Download audio for a Spotify track using spotdl (matches against
 * YouTube Music using the Spotify metadata for better accuracy than a raw
 * YouTube search).
 */
export async function downloadAudioFromSpotify(
  spotifyUrl: string,
  outputDir: string,
  trackId: string | number
): Promise<void> {
  const spotdlPath = resolveBinary('spotdl');

  const downloadArgs = [
    spotifyUrl,
    '--output', path.join(outputDir, `${trackId}`),
    '--format', 'mp3',
    '--bitrate', '320k',
    '--threads', '4',
    '--print-errors',
    '--sponsor-block',
    '--restrict',
    '--m3u', 'false',
    '--generate-lrc', 'false',
    '--audio-provider', 'youtube-music',
    '--audio-provider', 'youtube',
  ];

  try {
    await execFileAsync(spotdlPath, downloadArgs, {
      timeout: 180000,
      maxBuffer: 1024 * 1024 * 10,
    });
  } catch (err) {
    throw new Error(`Failed to download from Spotify: ${(err as Error).message}`);
  }
}

/**
 * Fallback: search YouTube directly via yt-dlp when spotdl fails to find a match.
 */
export async function downloadAudioFromYouTubeSearch(
  searchQuery: string,
  outputPath: string,
  metadata?: { title: string; artist: string } | null
): Promise<void> {
  const ytDlpPath = resolveBinary('yt-dlp');

  const improvedQuery = metadata ? `${metadata.artist} ${metadata.title} official audio` : searchQuery;
  const searchUrl = `ytsearch1:${improvedQuery}`;

  const downloadArgs = ['-x', '--audio-format', 'mp3', '--audio-quality', '0', '--prefer-ffmpeg', '-o', outputPath, searchUrl];

  try {
    await execFileAsync(ytDlpPath, downloadArgs, { timeout: 120000 });
  } catch (downloadError) {
    const message = (downloadError as Error).message || '';
    if (message.includes('ffmpeg') || message.includes('ffprobe')) {
      const originalArgs = ['-x', '-f', 'bestaudio', '-o', outputPath, searchUrl];
      await execFileAsync(ytDlpPath, originalArgs, { timeout: 120000 });
    } else {
      throw downloadError;
    }
  }
}

/**
 * End-to-end pipeline for a single Spotify track URL: fetch metadata, download
 * audio (spotdl -> yt-dlp fallback), detect BPM/key, fetch + embed artwork,
 * write metadata tags. Platform-agnostic — caller supplies output directories
 * and Spotify credentials (no Electron APIs used here).
 */
export async function processSpotifyTrack(
  url: string,
  options: ProcessSpotifyTrackOptions
): Promise<ProcessedSpotifyTrack> {
  const trackId = extractSpotifyTrackId(url);
  if (!trackId) {
    throw new Error('Invalid Spotify URL. Could not extract track ID.');
  }

  const emit = (stage: SpotifyProgressStage, message?: string) => options.onProgress?.({ stage, message });
  const detectKeyFallback = options.detectKeyFallback ?? true;

  fs.mkdirSync(options.outputDir, { recursive: true });
  fs.mkdirSync(options.artworkDir, { recursive: true });

  emit('fetching-metadata');
  const spotifyMetadata: SpotifyTrackMetadata = await fetchSpotifyTrackMetadata(trackId, options.spotify);

  const jobId = options.jobId ?? Date.now();
  clearExistingOutputFiles(options.outputDir, jobId);

  let downloadSource: DownloadSource = 'spotdl';
  emit('downloading-audio');
  try {
    await downloadAudioFromSpotify(url, options.outputDir, jobId);
  } catch {
    downloadSource = 'youtube-fallback';
    emit('downloading-audio-fallback');
    const outputTemplate = path.join(options.outputDir, `${jobId}.%(ext)s`);
    await downloadAudioFromYouTubeSearch(`${spotifyMetadata.title} ${spotifyMetadata.artist}`, outputTemplate, spotifyMetadata);
  }

  await new Promise((resolve) => setTimeout(resolve, 500));

  const downloadedFile = findDownloadedFile(options.outputDir, jobId);
  if (!downloadedFile) {
    throw new Error(`Downloaded audio file not found for track: ${spotifyMetadata.title}`);
  }

  const absolutePath = path.resolve(path.join(options.outputDir, downloadedFile));

  emit('detecting-bpm-key');
  let bpm: number | null = null;
  let key: string | null = null;
  try {
    const audioMeta = await readAudioMetadata(absolutePath);
    if (audioMeta.common.bpm) bpm = Math.round(audioMeta.common.bpm);
    key = audioMeta.common.key || null;
  } catch {
    // No embedded tags — fall through to active detection below.
  }

  if (!bpm) {
    bpm = await detectBPMFromAudio(absolutePath);
  }
  if (!key && detectKeyFallback) {
    key = await detectKey(absolutePath);
  }

  let artworkPath: string | null = null;
  if (spotifyMetadata.thumbnail) {
    emit('downloading-artwork');
    try {
      const candidate = path.join(options.artworkDir, `${jobId}.jpg`);
      await downloadArtwork(spotifyMetadata.thumbnail, candidate);
      artworkPath = candidate;
    } catch {
      artworkPath = null;
    }
  }

  emit('writing-metadata');
  try {
    await writeMetadataToFile(absolutePath, {
      bpm,
      key,
      title: spotifyMetadata.title || 'Unknown',
      artist: spotifyMetadata.allArtists || spotifyMetadata.artist || 'Unknown Artist',
      artworkPath,
    });
  } catch {
    // Non-fatal — track is still usable without embedded tags.
  }

  emit('done');

  return {
    id: jobId,
    title: spotifyMetadata.title || 'Unknown',
    artist: spotifyMetadata.allArtists || spotifyMetadata.artist || 'Unknown Artist',
    duration: spotifyMetadata.duration || 0,
    filePath: absolutePath,
    bpm: bpm || null,
    key: key || null,
    artworkPath,
    source: 'spotify',
    downloadSource,
    spotifyUrl: url,
  };
}
