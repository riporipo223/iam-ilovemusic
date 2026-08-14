import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { resolveBinary, ytDlpJsRuntimeArgs } from '../binaries';
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
  /**
   * Required unless `metadata` is supplied — used to fetch metadata directly
   * via the official Spotify Web API (Client Credentials flow).
   */
  spotify?: SpotifyCredentials;
  /**
   * Pre-fetched track metadata (e.g. from a proxy endpoint that holds its
   * own Spotify credentials server-side). When supplied, this skips the
   * internal fetchSpotifyTrackMetadata() call entirely, so no Spotify
   * credentials are needed on the caller's side at all. Takes priority over
   * `spotify` if both are somehow provided.
   */
  metadata?: SpotifyTrackMetadata;
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
    // {output-ext} is load-bearing, not decoration: --output is a spotdl
    // filename *template*, and a bare `<outputDir>/<trackId>` (no
    // extension/placeholder) makes spotdl treat that whole string as a
    // directory and write the real file inside it under spotdl's own
    // default naming (e.g. "Sade-No_Ordinary_Love.mp3"), not as
    // "<trackId>.mp3" as findDownloadedFile() below expects. Confirmed via
    // direct reproduction: the file existed but one directory level deeper
    // than findDownloadedFile()'s non-recursive listing looks, so it always
    // returned "not found" even on a fully successful download — invisible
    // until the ffmpeg-detection fix let spotdl actually finish for the
    // first time. This template makes spotdl write directly to
    // "<trackId>.<ext>" in outputDir, matching findDownloadedFile()'s exact
    // match tier the same way the yt-dlp downloader's own
    // `${jobId}.%(ext)s` template already does for SoundCloud/Bandcamp.
    '--output', path.join(outputDir, `${trackId}.{output-ext}`),
    '--format', 'mp3',
    '--bitrate', '320k',
    '--threads', '4',
    '--print-errors',
    '--sponsor-block',
    '--restrict',
    // NOT '--m3u false' / '--generate-lrc false' — pre-existing bug found
    // while investigating the ffmpeg issue below: in the currently-bundled
    // spotdl version, --generate-lrc is a plain store_true flag (no value)
    // and --m3u takes an *optional* string value, not a boolean either way.
    // Passing 'false' after --generate-lrc left it as a stray unconsumed
    // token, which broke argparse entirely — confirmed via direct CLI
    // reproduction with this exact original argument sequence, unrelated to
    // the ffmpeg fix. Omitting both flags achieves the originally-intended
    // "don't create an m3u file, don't generate lrc files" — that's already
    // the default when neither flag is passed.
    // NOT repeated '--audio-provider X' flags either — another pre-existing
    // drift from an older spotdl CLI. The current flag is '--audio' (not
    // '--audio-provider', which no longer exists at all — "unrecognized
    // arguments" was the exact failure), and it takes multiple fallback
    // providers as one space-separated list, not one flag per provider.
    '--audio', 'youtube-music', 'youtube',
    // spotdl is a separate frozen executable with its own internal ffmpeg
    // detection (PATH + a couple of hardcoded fallback locations) — it has
    // no idea about ILOVEMUSIC_BIN_DIR/resolveBinary(), so on a machine
    // without a system-installed ffmpeg it fails even though our own
    // bundled copy is sitting right there. Point it there explicitly via
    // spotdl's own --ffmpeg flag rather than relying on it to find ours.
    '--ffmpeg', resolveBinary('ffmpeg'),
    // spotdl also runs its OWN internal yt-dlp for the actual audio match,
    // separate from (and not reached by) the --js-runtimes handling already
    // wired into our own direct yt-dlp calls elsewhere. Found while
    // investigating this exact "downloaded file not found" bug: some
    // YouTube Music matches spotdl picks need a JS runtime, spotdl defaults
    // to requiring Deno specifically for that internal call ("Some YouTube
    // downloads require Deno. Run spotdl --download-deno or install Deno
    // system-wide."), and on failure it prints an AudioProviderError but —
    // because of --print-errors above — does NOT raise a process-level
    // error, so execFileAsync resolves successfully having downloaded
    // nothing at all. --yt-dlp-args is spotdl's passthrough for its
    // internal yt-dlp invocation; pointing it at our already-bundled
    // quickjs (confirmed working with this exact machine's real path,
    // which itself contains a space — "2. PROJECT" — with no quoting
    // issues observed) resolves *most* of these matches without needing
    // Deno. Not all, though — see the file-existence check below.
    ...(ytDlpJsRuntimeArgs().length > 0 ? ['--yt-dlp-args', ytDlpJsRuntimeArgs().join(' ')] : []),
  ];

  try {
    await execFileAsync(spotdlPath, downloadArgs, {
      timeout: 180000,
      maxBuffer: 1024 * 1024 * 10,
    });
  } catch (err) {
    throw new Error(`Failed to download from Spotify: ${(err as Error).message}`);
  }

  // --print-errors above means a per-song failure (e.g. spotdl's internal
  // yt-dlp still hitting a JS challenge quickjs couldn't solve — confirmed
  // via repeated reproduction to be genuinely intermittent, not fixed by
  // --yt-dlp-args alone: 2 of 3 identical attempts against the same video
  // succeeded, 1 failed) gets printed but does NOT make spotdl exit
  // non-zero, so the try/catch above never fires for this case — spotdl
  // "succeeds" having downloaded nothing. Without this check,
  // processSpotifyTrack()'s existing spotdl -> YouTube-search fallback
  // (which uses our own direct yt-dlp call, not spotdl's internal one)
  // never gets a chance to run, and the caller only finds out via a vaguer
  // "Downloaded audio file not found" error one step later. Checking here
  // instead turns this into the same kind of failure as any other spotdl
  // error, so the existing fallback in processSpotifyTrack() actually
  // triggers as designed.
  if (!findDownloadedFile(outputDir, trackId)) {
    throw new Error(`spotdl reported success but produced no output file for track ${trackId}`);
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

  // yt-dlp does its own audio extraction/conversion post-processing here
  // (-x), which needs ffmpeg — and like spotdl, yt-dlp has its own separate
  // PATH-only ffmpeg detection with no idea about our bundled copy.
  // --ffmpeg-location is yt-dlp's equivalent of spotdl's --ffmpeg above.
  const ffmpegLocationArgs = ['--ffmpeg-location', resolveBinary('ffmpeg')];

  const downloadArgs = [
    ...ytDlpJsRuntimeArgs(),
    ...ffmpegLocationArgs,
    '-x',
    '--audio-format', 'mp3',
    '--audio-quality', '0',
    '--prefer-ffmpeg',
    '-o', outputPath,
    searchUrl,
  ];

  try {
    await execFileAsync(ytDlpPath, downloadArgs, { timeout: 120000 });
  } catch (downloadError) {
    const message = (downloadError as Error).message || '';
    if (message.includes('ffmpeg') || message.includes('ffprobe')) {
      // Note: -x (--extract-audio) here still needs an audio encoder for
      // most source formats, so this fallback doesn't actually avoid the
      // ffmpeg dependency — it's a distinct code path (no forced mp3
      // conversion) kept for whatever originally motivated it, not a way
      // around a missing ffmpeg. --ffmpeg-location is included for the same
      // reason as above, not because this branch is expected to need it
      // less.
      const originalArgs = [...ytDlpJsRuntimeArgs(), ...ffmpegLocationArgs, '-x', '-f', 'bestaudio', '-o', outputPath, searchUrl];
      await execFileAsync(ytDlpPath, originalArgs, { timeout: 120000 });
    } else {
      throw downloadError;
    }
  }

  // yt-dlp exits 0 even when a ytsearch query matches zero videos — it just
  // "successfully" downloads an empty playlist, no error raised. Confirmed
  // via direct reproduction against a real track (Swapa — "Real Sex") whose
  // video is fully public and unrestricted on YouTube (found instantly via
  // an unrelated query for the same artist), but every search query
  // containing the phrase "real sex" — including the video's own exact
  // title — returned zero results. Without this check, that silent
  // zero-results case was indistinguishable from a real success all the way
  // up to processSpotifyTrack()'s generic "Downloaded audio file not found"
  // message, which gives no hint this is a search-relevance limitation
  // rather than something worth retrying. Mirrors the equivalent check
  // already in downloadAudioFromSpotify() above.
  const outputDir = path.dirname(outputPath);
  const outputStem = path.basename(outputPath).replace(/\.%\(ext\)s$/, '');
  if (!findDownloadedFile(outputDir, outputStem)) {
    throw new Error(
      `No YouTube results found for "${improvedQuery}" — this track may not be findable via YouTube search, or nothing relevant matched.`
    );
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
  let spotifyMetadata: SpotifyTrackMetadata;
  if (options.metadata) {
    spotifyMetadata = options.metadata;
  } else if (options.spotify) {
    spotifyMetadata = await fetchSpotifyTrackMetadata(trackId, options.spotify);
  } else {
    throw new Error('processSpotifyTrack requires either `spotify` credentials or pre-fetched `metadata`.');
  }

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
