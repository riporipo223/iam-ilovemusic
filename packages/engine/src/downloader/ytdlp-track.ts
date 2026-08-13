import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { resolveBinary } from '../binaries';
import { cleanSoundCloudUrl } from '../url';
import { detectBPMFromAudio } from '../processing/bpm';
import { downloadArtwork, readAudioMetadata, writeMetadataToFile } from '../processing/metadata';
import { clearExistingOutputFiles, findDownloadedFile } from '../util';

const execFileAsync = promisify(execFile);

/**
 * Sources handled by this generic yt-dlp pipeline — confirmed (not
 * assumed) to run through identical logic in the original main.js:
 * SoundCloud and Bandcamp share one handler there because yt-dlp
 * normalizes both extractors' output into the same field schema. If a
 * future source turns out to need the exact same treatment, add it here
 * rather than duplicating this file.
 */
export type YtDlpSource = 'soundcloud' | 'bandcamp';

export type YtDlpProgressStage =
  | 'resolving-track'
  | 'downloading-audio'
  | 'detecting-bpm'
  | 'downloading-artwork'
  | 'writing-metadata'
  | 'done';

export interface YtDlpProgressEvent {
  stage: YtDlpProgressStage;
  message?: string;
}

export interface ProcessYtDlpTrackOptions {
  source: YtDlpSource;
  /** Directory the downloaded audio file is written to (created if missing). */
  outputDir: string;
  /** Directory artwork images are written to (created if missing). */
  artworkDir: string;
  /** Used as the on-disk filename stem for BOTH audio and artwork — deliberately our
   * own job id, not the source's native track id (see note in resolveArtwork). */
  jobId?: string | number;
  onProgress?: (event: YtDlpProgressEvent) => void;
}

export interface ProcessedYtDlpTrack {
  id: string | number;
  title: string;
  artist: string;
  /** Seconds */
  duration: number;
  filePath: string;
  bpm: number | null;
  /** Usually null — neither SoundCloud nor Bandcamp gets a key-detection step (see detectBpmKeyFromInfo). */
  key: string | null;
  artworkPath: string | null;
  source: YtDlpSource;
  sourceUrl: string;
}

// yt-dlp's --print-json output, normalized across extractors (SoundCloud,
// Bandcamp, ...). Neither source has an official metadata API, so this
// dump IS the metadata source (and doubles as URL validation).
interface YtDlpTrackInfo {
  id?: string | number;
  title?: string;
  uploader?: string;
  channel?: string;
  duration?: number;
  thumbnail?: unknown;
  thumbnails?: unknown;
  artwork_url?: string;
  track?: { artwork_url?: string };
  album?: { thumbnail?: unknown; thumbnails?: unknown[]; artwork_url?: string };
  playlist?: { thumbnail?: unknown; thumbnails?: unknown[]; artwork_url?: string };
  uploader_thumbnail?: unknown;
  tags?: unknown;
  description?: string;
}

/**
 * Fetch track info via yt-dlp's JSON dump. No separate "resolve" API call —
 * this single invocation both validates the URL and supplies all metadata.
 */
export async function resolveYtDlpTrackInfo(url: string): Promise<YtDlpTrackInfo> {
  const ytDlpPath = resolveBinary('yt-dlp');
  const cleanUrl = cleanSoundCloudUrl(url); // name is historical — strips query params generically, not SoundCloud-specific

  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(ytDlpPath, [
      '--print-json',
      '--no-download',
      '--flat-playlist',
      '--yes-playlist',
      cleanUrl,
    ]));
  } catch (err) {
    const message = (err as Error).message || '';
    if (message.includes('yt-dlp') || message.includes('not found')) {
      throw new Error(`yt-dlp not found or not working: ${message}`);
    }
    throw new Error(`Failed to resolve track URL — it may be invalid or the track unavailable: ${message}`);
  }

  try {
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(`yt-dlp returned unparseable track info for this URL: ${(err as Error).message}`);
  }
}

export async function downloadYtDlpAudio(url: string, outputTemplate: string): Promise<void> {
  const ytDlpPath = resolveBinary('yt-dlp');
  const cleanUrl = cleanSoundCloudUrl(url);

  // yt-dlp does its own audio extraction/conversion here (-x), which needs
  // ffmpeg — and yt-dlp has its own separate PATH-only ffmpeg detection with
  // no idea about our bundled copy (same class of bug fixed for Spotify's
  // yt-dlp fallback in downloadAudioFromYouTubeSearch — see spotify.ts).
  // Confirmed by reproduction before this fix: on a machine with no system
  // ffmpeg, this doesn't error — it silently falls through to the
  // bestaudio fallback below and produces a raw .m4a instead of the
  // requested .mp3, no error surfaced anywhere. --ffmpeg-location is
  // yt-dlp's flag for pointing it at an explicit binary.
  const ffmpegLocationArgs = ['--ffmpeg-location', resolveBinary('ffmpeg')];

  const downloadArgs = [...ffmpegLocationArgs, '-x', '--audio-format', 'mp3', '--audio-quality', '0', '--prefer-ffmpeg', '-o', outputTemplate, cleanUrl];

  try {
    await execFileAsync(ytDlpPath, downloadArgs);
  } catch (downloadError) {
    const message = (downloadError as Error).message || '';
    if (message.includes('ffmpeg') || message.includes('ffprobe')) {
      // Note: -f bestaudio picks an already-audio-only format, which is why
      // this fallback can succeed without ffmpeg at all (no video track to
      // strip) — but the resulting file is whatever native format that
      // source served (m4a, webm, ...), not necessarily mp3. Included here
      // too for consistency/robustness, not because this branch is known to
      // need it.
      const originalArgs = [...ffmpegLocationArgs, '-x', '-f', 'bestaudio', '-o', outputTemplate, cleanUrl];
      await execFileAsync(ytDlpPath, originalArgs);
    } else {
      throw new Error(`Failed to download audio: ${message}`);
    }
  }
}

// ---- BPM/key detection: ported tier-by-tier from main.js's soundcloud:add
// (confirmed identical for Bandcamp — see Phase 3 investigation) ----

function bpmFromText(text: string): number | null {
  const match = text.match(/bpm[:\s]*(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
}

function keyFromText(text: string): string | null {
  const match = text.match(/([A-G][#b]?m?)\s*(?:key|tonality)/i);
  return match ? match[1] : null;
}

/**
 * BPM: tags -> description -> title (BPM only) -> embedded audio tags ->
 * aubio audio analysis. Key: tags -> description -> embedded audio tags —
 * there is deliberately no python/librosa detectKey() call here, unlike
 * Spotify. A null key on a "done" job for either of these sources is the
 * expected, common case, not a bug.
 */
export async function detectBpmKeyFromInfo(
  info: YtDlpTrackInfo,
  absolutePath: string
): Promise<{ bpm: number | null; key: string | null }> {
  let bpm: number | null = null;
  let key: string | null = null;

  if (info.tags) {
    const tags = Array.isArray(info.tags) ? info.tags : [info.tags];
    for (const tag of tags) {
      if (typeof tag !== 'string') continue;
      if (!bpm) bpm = bpmFromText(tag);
      if (!key) key = keyFromText(tag);
    }
  }

  if (info.description) {
    if (!bpm) bpm = bpmFromText(info.description);
    if (!key) key = keyFromText(info.description);
  }

  if (!bpm && info.title) {
    bpm = bpmFromText(info.title);
  }

  if (!bpm || !key) {
    try {
      const audioMeta = await readAudioMetadata(absolutePath);
      if (!bpm && audioMeta.common.bpm) bpm = Math.round(audioMeta.common.bpm);
      if (!key) key = audioMeta.common.key || null;
    } catch {
      // No embedded tags on the downloaded file — fall through.
    }
  }

  if (!bpm) {
    bpm = await detectBPMFromAudio(absolutePath);
  }

  return { bpm, key };
}

// ---- Artwork: 8-tier fallback, ported from main.js's soundcloud:add
// (confirmed identical for Bandcamp — yt-dlp normalizes extractor output) ----

function extractThumbnailUrl(thumb: unknown): string | null {
  if (!thumb) return null;
  if (typeof thumb === 'string') return thumb;
  if (typeof thumb === 'object') {
    const obj = thumb as Record<string, unknown>;
    if (typeof obj.url === 'string') return obj.url;
    if (obj.id) return `https://i1.sndcdn.com/artworks-${obj.id}-large.jpg`;
  }
  return null;
}

export function resolveArtworkUrl(info: YtDlpTrackInfo): string | null {
  let url = extractThumbnailUrl(info.thumbnail); // Tier 1

  if (!url && info.thumbnails) {
    // Tier 2
    if (Array.isArray(info.thumbnails) && info.thumbnails.length > 0) {
      for (let i = info.thumbnails.length - 1; i >= 0; i--) {
        const candidate = extractThumbnailUrl(info.thumbnails[i]);
        if (candidate) {
          url = candidate;
          break;
        }
      }
    } else if (typeof info.thumbnails === 'object') {
      const t = info.thumbnails as Record<string, unknown>;
      url = extractThumbnailUrl(t.large ?? t.default ?? t.medium);
    }
  }

  if (!url && info.artwork_url) url = info.artwork_url; // Tier 3
  if (!url && info.track?.artwork_url) url = info.track.artwork_url; // Tier 4

  if (!url && info.album) {
    // Tier 5
    if (info.album.thumbnail) url = extractThumbnailUrl(info.album.thumbnail);
    else if (Array.isArray(info.album.thumbnails) && info.album.thumbnails.length > 0) {
      url = extractThumbnailUrl(info.album.thumbnails[info.album.thumbnails.length - 1]);
    } else if (info.album.artwork_url) url = info.album.artwork_url;
  }

  if (!url && info.playlist) {
    // Tier 6
    if (info.playlist.thumbnail) url = extractThumbnailUrl(info.playlist.thumbnail);
    else if (info.playlist.artwork_url) url = info.playlist.artwork_url;
    else if (Array.isArray(info.playlist.thumbnails) && info.playlist.thumbnails.length > 0) {
      url = extractThumbnailUrl(info.playlist.thumbnails[info.playlist.thumbnails.length - 1]);
    }
  }

  if (!url && info.uploader_thumbnail) url = extractThumbnailUrl(info.uploader_thumbnail); // Tier 7

  if (!url && info.id) {
    // Tier 8 — construct the CDN URL from an artwork id regex-extracted
    // from other fields. `info.id` only gates this tier's existence; the
    // id used in the URL comes from artwork_url/thumbnails, matching the
    // original main.js logic exactly.
    let artworkId: string | null = null;
    if (info.artwork_url) {
      const match = info.artwork_url.match(/artworks-([^-]+)/);
      if (match) artworkId = match[1];
    }
    if (!artworkId && info.thumbnails) {
      const match = JSON.stringify(info.thumbnails).match(/artworks-([^-]+)/);
      if (match) artworkId = match[1];
    }
    if (artworkId) url = `https://i1.sndcdn.com/artworks-${artworkId}-large.jpg`;
  }

  if (!url) return null;

  // CDN size-suffix upsizing (SoundCloud's convention — harmless no-op for
  // Bandcamp URLs that never match these patterns).
  url = url.replace(/-t\d+x\d+\.jpg/, '-large.jpg');
  url = url.replace(/-small\.jpg/, '-large.jpg');
  url = url.replace(/-medium\.jpg/, '-large.jpg');
  url = url.replace(/-t\d+x\d+\.png/, '-large.png');

  return url;
}

/**
 * Last-resort artwork fallback via yt-dlp's own thumbnail writer.
 *
 * FIX vs. the original main.js version: that code used `process.chdir()`
 * to land the thumbnail in the right directory, which mutates global
 * process state — safe in Electron (one job at a time) but a real race
 * condition in this worker, which runs multiple jobs concurrently. yt-dlp's
 * `-o` already accepts an absolute path directly, so chdir was never
 * actually necessary; this version never touches process.cwd().
 */
export async function downloadThumbnailViaYtDlp(url: string, artworkDir: string, id: string): Promise<string | null> {
  const ytDlpPath = resolveBinary('yt-dlp');
  const cleanUrl = cleanSoundCloudUrl(url);
  const outputTemplate = path.resolve(path.join(artworkDir, `${id}.%(ext)s`));

  try {
    await execFileAsync(ytDlpPath, [
      // --convert-thumbnails also goes through yt-dlp's own ffmpeg
      // detection when the source thumbnail isn't already the target
      // format — didn't reproduce a failure in testing (SoundCloud/Bandcamp
      // both happened to already serve jpg for the tracks tested, so no
      // conversion was actually triggered), but included for the same
      // reason as downloadYtDlpAudio above: cheap, harmless when unused,
      // and this is a genuine conversion step that could need it for a
      // thumbnail format we haven't hit in testing.
      '--ffmpeg-location',
      resolveBinary('ffmpeg'),
      '--write-thumbnail',
      '--skip-download',
      '--convert-thumbnails',
      'jpg',
      '--no-warnings',
      '-o',
      outputTemplate,
      cleanUrl,
    ]);
  } catch {
    return null;
  }

  const files = fs.readdirSync(artworkDir);
  const thumbnailFile = files.find((f) => f.startsWith(`${id}.`));
  return thumbnailFile ? path.join(artworkDir, thumbnailFile) : null;
}

export async function resolveArtwork(
  info: YtDlpTrackInfo,
  url: string,
  artworkDir: string,
  jobId: string | number
): Promise<string | null> {
  const thumbnailUrl = resolveArtworkUrl(info);

  if (thumbnailUrl) {
    try {
      const candidate = path.join(artworkDir, `${jobId}.jpg`);
      await downloadArtwork(thumbnailUrl, candidate);
      return candidate;
    } catch {
      // Fall through to the yt-dlp fallback below.
    }
  }

  return downloadThumbnailViaYtDlp(url, artworkDir, jobId.toString());
}

/**
 * End-to-end pipeline for a single track URL from any yt-dlp-only source
 * (SoundCloud, Bandcamp): resolve info via yt-dlp, download audio (yt-dlp,
 * mp3 -> bestaudio fallback), detect BPM/key from metadata + audio
 * analysis, resolve + embed artwork, write tags. Platform-agnostic — no
 * Electron APIs used here. No credentials of any kind are required for
 * these sources, unlike Spotify.
 *
 * This is the ONE implementation shared by soundcloud.ts and bandcamp.ts
 * (thin per-source aliases) — confirmed via investigation that main.js
 * runs both sources through identical logic, so there is nothing to
 * source-specialize here beyond the `source` label on the result.
 */
export async function processYtDlpTrack(url: string, options: ProcessYtDlpTrackOptions): Promise<ProcessedYtDlpTrack> {
  const emit = (stage: YtDlpProgressStage, message?: string) => options.onProgress?.({ stage, message });

  fs.mkdirSync(options.outputDir, { recursive: true });
  fs.mkdirSync(options.artworkDir, { recursive: true });

  emit('resolving-track');
  const info = await resolveYtDlpTrackInfo(url);

  const jobId = options.jobId ?? Date.now();
  clearExistingOutputFiles(options.outputDir, jobId);

  emit('downloading-audio');
  const outputTemplate = path.join(options.outputDir, `${jobId}.%(ext)s`);
  await downloadYtDlpAudio(url, outputTemplate);

  await new Promise((resolve) => setTimeout(resolve, 500));

  const downloadedFile = findDownloadedFile(options.outputDir, jobId);
  if (!downloadedFile) {
    throw new Error(`Downloaded audio file not found for track: ${info.title ?? url}`);
  }
  const absolutePath = path.resolve(path.join(options.outputDir, downloadedFile));

  emit('detecting-bpm');
  const { bpm, key } = await detectBpmKeyFromInfo(info, absolutePath);

  emit('downloading-artwork');
  const artworkPath = await resolveArtwork(info, url, options.artworkDir, jobId);

  emit('writing-metadata');
  const title = info.title || 'Unknown';
  const artist = info.uploader || info.channel || 'Unknown Artist';
  try {
    await writeMetadataToFile(absolutePath, { bpm, key, title, artist, artworkPath });
  } catch {
    // Non-fatal — track is still usable without embedded tags.
  }

  emit('done');

  return {
    id: jobId,
    title,
    artist,
    duration: info.duration || 0,
    filePath: absolutePath,
    bpm: bpm || null,
    key: key || null,
    artworkPath,
    source: options.source,
    sourceUrl: url,
  };
}
