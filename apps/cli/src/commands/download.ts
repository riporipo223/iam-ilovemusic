import * as p from '@clack/prompts';
import { promises as fs, createWriteStream } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { parseFile } from 'music-metadata';
import { createDownload, getJobStatus, registerSpotifyCredentials, ApiError, type JobStatus } from '../api.js';
import { readConfig, writeConfig, type CliConfig } from '../config.js';
import { sanitizeFilename } from '../util/sanitizeFilename.js';
import { resultExtension } from '../util/resultExtension.js';

const SOURCES = [
  { value: 'spotify', label: 'Spotify' },
  { value: 'soundcloud', label: 'SoundCloud' },
  { value: 'bandcamp', label: 'Bandcamp' },
] as const;

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;
const DOWNLOADS_DIR = path.join(os.homedir(), 'Downloads', 'ILoveMusic');

export async function runDownload(): Promise<void> {
  p.intro('ILoveMusic — download a track');

  const config = await readConfig();
  if (!config) {
    p.log.error('No API key found. Run `ilovemusic create-api-key` first, then try again.');
    process.exitCode = 1;
    return;
  }

  const source = await p.select({
    message: 'Where is this track from?',
    options: SOURCES.map((s) => ({ value: s.value, label: s.label })),
  });
  if (p.isCancel(source)) {
    p.cancel('Cancelled.');
    return;
  }

  // SoundCloud/Bandcamp need no credentials at all — only Spotify's BYOK
  // path branches here, and only on a key that hasn't registered them yet.
  let activeConfig: CliConfig = config;
  if (source === 'spotify' && !activeConfig.spotifyCredentialsRegistered) {
    const withCredentials = await ensureSpotifyCredentials(activeConfig);
    if (!withCredentials) return; // user cancelled or gave up after a rejection
    activeConfig = withCredentials;
  }

  const url = await p.text({
    message: `Paste the ${SOURCES.find((s) => s.value === source)!.label} track URL`,
    validate: (value) => {
      if (!value.trim()) return 'A URL is required';
      try {
        new URL(value.trim());
      } catch {
        return 'That does not look like a valid URL';
      }
      return undefined;
    },
  });
  if (p.isCancel(url)) {
    p.cancel('Cancelled.');
    return;
  }

  const s = p.spinner();
  s.start('Submitting download request');

  let jobId: string;
  try {
    const created = await createDownload(activeConfig.apiKey, source, url.trim());
    jobId = created.job_id;
  } catch (err) {
    s.stop('Failed to submit download.');
    reportApiError(err);
    return;
  }

  s.message('Queued — waiting for the worker to pick it up');

  let job: JobStatus;
  const startedAt = Date.now();
  try {
    while (true) {
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        s.stop('Timed out waiting for the job to finish.');
        p.log.error(`Job ${jobId} did not finish within ${POLL_TIMEOUT_MS / 1000}s. It may still complete server-side.`);
        process.exitCode = 1;
        return;
      }

      job = await getJobStatus(activeConfig.apiKey, jobId);
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      s.message(`Status: ${job.status} (${elapsed}s elapsed)`);

      if (job.status === 'done' || job.status === 'failed') break;
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  } catch (err) {
    s.stop('Failed while checking job status.');
    reportApiError(err);
    return;
  }

  if (job.status === 'failed') {
    s.stop('Download failed.');
    p.log.error(job.error ?? 'The job failed with no error message.');
    process.exitCode = 1;
    return;
  }

  if (!job.result_url) {
    s.stop('Download finished but no file was returned.');
    p.log.error('This is unexpected — the job reported "done" but result_url was missing.');
    process.exitCode = 1;
    return;
  }

  s.message('Downloading file');
  let savedPath: string;
  let sizeBytes: number;
  try {
    await fs.mkdir(DOWNLOADS_DIR, { recursive: true });
    const result = await downloadToLibrary(job.result_url);
    savedPath = result.path;
    sizeBytes = result.sizeBytes;
  } catch (err) {
    s.stop('Failed to save the downloaded file.');
    p.log.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }

  s.stop('Download complete.');

  const summaryLines = [
    `File:     ${path.basename(savedPath)}`,
    `Saved to: ${savedPath}`,
    `Size:     ${(sizeBytes / 1024 / 1024).toFixed(2)} MB`,
    `BPM:      ${job.bpm ?? 'not detected'}`,
    `Key:      ${job.key_signature ?? 'not detected'}`,
  ];
  p.note(summaryLines.join('\n'), 'Summary');
  p.outro('Done.');
}

/**
 * Prompts for Spotify Client ID/Secret and registers them via PUT
 * /v1/spotify-credentials, looping on rejection so the user can fix a typo
 * without restarting the whole `download` command. Returns the config
 * updated with spotifyCredentialsRegistered: true on success, or null if
 * the user cancels/gives up — callers should treat null as "abort the
 * download flow," not "proceed without credentials."
 *
 * The registered flag is a local-only cache (see config.ts) — there's no
 * GET /v1/spotify-credentials to check live status, so this only runs when
 * the flag says "not registered yet." `ilovemusic spotify-logout` is the
 * escape hatch if that ever drifts from the server's real state.
 */
async function ensureSpotifyCredentials(config: CliConfig): Promise<CliConfig | null> {
  p.log.info(
    'Spotify requires your own Developer App credentials (BYOK) — the platform ' +
      "doesn't hold a shared one. Create one at https://developer.spotify.com/dashboard " +
      'if you haven\'t (requires an active Premium subscription).'
  );

  while (true) {
    const clientId = await p.text({
      message: 'Spotify Client ID',
      validate: (value) => (!value.trim() ? 'Required' : undefined),
    });
    if (p.isCancel(clientId)) {
      p.cancel('Cancelled.');
      return null;
    }

    // Masked input — @clack/prompts' password() (confirmed to exist before
    // using it, not assumed) never echoes the value to the terminal.
    const clientSecret = await p.password({
      message: 'Spotify Client Secret',
      validate: (value) => (!value.trim() ? 'Required' : undefined),
    });
    if (p.isCancel(clientSecret)) {
      p.cancel('Cancelled.');
      return null;
    }

    const s = p.spinner();
    s.start('Validating credentials with Spotify');
    try {
      await registerSpotifyCredentials(config.apiKey, clientId.trim(), clientSecret);
      s.stop('Spotify credentials registered.');
      // Only persisted after the server confirms the pair actually works —
      // never optimistically before this, and never on a failed attempt.
      const updated: CliConfig = { ...config, spotifyCredentialsRegistered: true };
      await writeConfig(updated);
      return updated;
    } catch (err) {
      // Only actually "rejected" if the server was reached and responded —
      // a connection failure never got that far, so don't claim it did.
      s.stop(err instanceof ApiError ? 'Spotify rejected these credentials.' : 'Failed to register Spotify credentials.');
      // The server's message is shown verbatim — it already describes what
      // was wrong (bad pair, account not Premium, etc.) — never the secret
      // itself, which this catch block never has access to log even if it
      // wanted to.
      p.log.error(err instanceof Error ? err.message : String(err));

      const retry = await p.confirm({ message: 'Try again?', initialValue: true });
      if (p.isCancel(retry) || !retry) {
        p.cancel('Cancelled the download.');
        return null;
      }
      // Loop back to re-prompt both fields.
    }
  }
}

function reportApiError(err: unknown): void {
  if (err instanceof ApiError && err.status === 400 && /spotify credentials/i.test(err.message)) {
    p.log.error(`${err.message}\nRegister Spotify credentials via PUT /v1/spotify-credentials before downloading Spotify tracks.`);
    process.exitCode = 1;
    return;
  }
  p.log.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
}

/**
 * Streams the file to a temp path first, reads its embedded tags to name it
 * "artist - title.<ext>" (the API's JSON response has no artist/title field
 * — packages/engine embeds that metadata into the file itself, not into the
 * job record), then moves it into place. Falls back to a source-derived
 * name when tags are missing, and avoids clobbering an existing file of the
 * same name.
 */
async function downloadToLibrary(resultUrl: string): Promise<{ path: string; sizeBytes: number }> {
  const res = await fetch(resultUrl);
  if (!res.ok || !res.body) {
    throw new Error(`Failed to fetch the downloaded file (HTTP ${res.status})`);
  }

  const ext = resultExtension(resultUrl);

  const tempPath = path.join(DOWNLOADS_DIR, `.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream<Uint8Array>), createWriteStream(tempPath));

  let baseName = 'ilovemusic-track';
  try {
    const metadata = await parseFile(tempPath);
    const artist = metadata.common.artist?.trim();
    const title = metadata.common.title?.trim();
    if (artist && title) baseName = `${artist} - ${title}`;
    else if (title) baseName = title;
  } catch {
    // Tags missing or unparseable — keep the generic fallback name.
  }

  const finalPath = await uniqueDestination(sanitizeFilename(baseName), ext);
  await fs.rename(tempPath, finalPath);
  const stat = await fs.stat(finalPath);
  return { path: finalPath, sizeBytes: stat.size };
}

async function uniqueDestination(baseName: string, ext: string): Promise<string> {
  let candidate = path.join(DOWNLOADS_DIR, `${baseName}${ext}`);
  let attempt = 1;
  while (await fileExists(candidate)) {
    candidate = path.join(DOWNLOADS_DIR, `${baseName} (${attempt})${ext}`);
    attempt++;
  }
  return candidate;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
