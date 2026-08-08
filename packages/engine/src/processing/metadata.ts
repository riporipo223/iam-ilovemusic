import { execFile } from 'child_process';
import { promisify } from 'util';
import * as https from 'https';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { resolveBinary } from '../binaries';

const execFileAsync = promisify(execFile);

/**
 * Download a thumbnail/artwork image to `outputPath`, following redirects.
 */
export async function downloadArtwork(thumbnailUrl: string, outputPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(thumbnailUrl);
    } catch (err) {
      reject(err);
      return;
    }
    const client = parsedUrl.protocol === 'https:' ? https : http;
    const file = fs.createWriteStream(outputPath);

    client
      .get(thumbnailUrl, (response) => {
        if (response.statusCode === 200) {
          response.pipe(file);
          file.on('finish', () => {
            file.close();
            resolve(outputPath);
          });
        } else if (response.statusCode === 301 || response.statusCode === 302) {
          file.close();
          if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
          const location = response.headers.location;
          if (!location) {
            reject(new Error('Redirect with no Location header'));
            return;
          }
          downloadArtwork(location, outputPath).then(resolve).catch(reject);
        } else {
          file.close();
          if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
          reject(new Error(`Failed to download artwork: ${response.statusCode}`));
        }
      })
      .on('error', (err) => {
        file.close();
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        reject(err);
      });
  });
}

export interface TrackMetadataInput {
  title?: string;
  artist?: string;
  bpm?: number | null;
  key?: string | null;
  artworkPath?: string | null;
}

/**
 * Write title/artist/bpm/key metadata (and optionally embed artwork) into an
 * audio file using ffmpeg. Falls back to node-id3 for MP3s if ffmpeg fails.
 */
export async function writeMetadataToFile(filePath: string, metadata: TrackMetadataInput): Promise<void> {
  const fileExt = path.extname(filePath).toLowerCase();
  const tempPath = filePath + '.tmp';
  const hasArtwork = !!(metadata.artworkPath && fs.existsSync(metadata.artworkPath));

  try {
    const ffmpegPath = resolveBinary('ffmpeg');
    const ffmpegArgs: string[] = [];

    if (hasArtwork && (fileExt === '.m4a' || fileExt === '.mp4' || fileExt === '.aac')) {
      ffmpegArgs.push('-i', filePath, '-loop', '1', '-i', metadata.artworkPath!);
      ffmpegArgs.push('-map', '0:a', '-map', '1:v');
      ffmpegArgs.push('-c:a', 'copy', '-c:v', 'mjpeg');
      ffmpegArgs.push('-disposition:v', 'attached_pic');
      ffmpegArgs.push('-map_chapters', '-1');
      ffmpegArgs.push('-shortest');
      ffmpegArgs.push('-metadata', `title=${(metadata.title || '').replace(/:/g, '\\:')}`);
      ffmpegArgs.push('-metadata', `artist=${(metadata.artist || '').replace(/:/g, '\\:')}`);
      if (metadata.bpm) ffmpegArgs.push('-metadata', `bpm=${Math.round(metadata.bpm)}`);
      if (metadata.key) ffmpegArgs.push('-metadata', `initialkey=${metadata.key}`);
      ffmpegArgs.push('-f', 'mp4', '-movflags', '+faststart', '-brand', 'M4A ');
    } else {
      ffmpegArgs.push('-i', filePath);
      if (hasArtwork) {
        ffmpegArgs.push('-i', metadata.artworkPath!);
        ffmpegArgs.push('-map', '0:a', '-map', '1');
        ffmpegArgs.push('-c:a', 'copy', '-c:v', 'copy');
        ffmpegArgs.push('-disposition:v', 'attached_pic');
      } else {
        ffmpegArgs.push('-c', 'copy');
      }

      ffmpegArgs.push('-metadata', `title=${(metadata.title || '').replace(/:/g, '\\:')}`);
      ffmpegArgs.push('-metadata', `artist=${(metadata.artist || '').replace(/:/g, '\\:')}`);
      if (metadata.bpm) {
        ffmpegArgs.push('-metadata', fileExt === '.mp3' ? `TBPM=${Math.round(metadata.bpm)}` : `bpm=${Math.round(metadata.bpm)}`);
      }
      if (metadata.key) ffmpegArgs.push('-metadata', `initialkey=${metadata.key}`);

      if (fileExt === '.mp3') {
        ffmpegArgs.push('-f', 'mp3', '-id3v2_version', '3');
      } else if (fileExt === '.flac') {
        ffmpegArgs.push('-f', 'flac');
      } else if (fileExt === '.ogg' || fileExt === '.oga') {
        ffmpegArgs.push('-f', 'ogg');
      }
    }

    ffmpegArgs.push('-y', tempPath);

    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    await execFileAsync(ffmpegPath, ffmpegArgs);

    if (!fs.existsSync(tempPath)) {
      throw new Error('FFmpeg did not create output file');
    }

    fs.unlinkSync(filePath);
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    if (fileExt === '.mp3') {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const NodeID3 = require('node-id3');
      const tags: Record<string, unknown> = {
        title: metadata.title || '',
        artist: metadata.artist || '',
      };
      if (metadata.bpm) tags.bpm = Math.round(metadata.bpm).toString();
      if (metadata.key) tags.initialKey = metadata.key;
      if (hasArtwork) {
        tags.image = {
          mime: 'image/jpeg',
          type: { id: 3, name: 'front cover' },
          description: 'Cover',
          imageBuffer: fs.readFileSync(metadata.artworkPath!),
        };
      }

      try {
        NodeID3.write(tags, filePath);
      } finally {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      }
    } else {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      throw error;
    }
  }
}

/**
 * Parse an audio file's embedded tags (music-metadata is ESM-only, hence the
 * dynamic import from this CommonJS module).
 */
export async function readAudioMetadata(filePath: string) {
  const mm = await import('music-metadata');
  return mm.parseFile(filePath);
}
