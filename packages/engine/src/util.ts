import * as fs from 'fs';
import * as path from 'path';

export const AUDIO_EXTENSIONS = ['.mp3', '.m4a', '.opus', '.ogg', '.webm', '.flac', '.wav', '.aac'];
export const POSSIBLE_EXTENSIONS = ['mp3', 'm4a', 'mp4', 'aac', 'ogg', 'flac', 'opus', 'webm'];

/**
 * Remove any leftover file from a previous attempt at this jobId before a
 * fresh download, across every extension yt-dlp/spotdl might produce.
 */
export function clearExistingOutputFiles(outputDir: string, jobId: string | number): void {
  for (const ext of POSSIBLE_EXTENSIONS) {
    const existingFile = path.join(outputDir, `${jobId}.${ext}`);
    if (fs.existsSync(existingFile)) fs.unlinkSync(existingFile);
  }
}

/**
 * Locate the audio file a download just produced: prefer an exact
 * `<jobId>.<ext>` match (our `-o` templates always use the jobId as the
 * filename stem), falling back to "most recently modified audio file" for
 * tools that don't respect the template exactly.
 */
export function findDownloadedFile(outputDir: string, jobId: string | number): string | null {
  const filesInDir = fs.readdirSync(outputDir);
  const jobIdStr = jobId.toString();

  const exact = filesInDir.find((f) => f.startsWith(jobIdStr) && AUDIO_EXTENSIONS.some((ext) => f.toLowerCase().endsWith(ext)));
  if (exact) return exact;

  const audioFiles = filesInDir
    .filter((f) => AUDIO_EXTENSIONS.some((ext) => f.toLowerCase().endsWith(ext)))
    .map((f) => ({ name: f, mtime: fs.statSync(path.join(outputDir, f)).mtime.getTime() }))
    .sort((a, b) => b.mtime - a.mtime);

  const recentFile = audioFiles.find((f) => Date.now() - f.mtime < 30000);
  return recentFile ? recentFile.name : null;
}
