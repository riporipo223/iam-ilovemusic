import * as fs from 'fs';
import * as path from 'path';
import { Worker, Job } from 'bullmq';
import {
  processSpotifyTrack,
  processSoundCloudTrack,
  processBandcampTrack,
  ProcessedSpotifyTrack,
  ProcessedSoundCloudTrack,
  ProcessedBandcampTrack,
} from '@ilovemusic/engine';
import { config, assertRuntimeConfig } from './config';
import { pool } from './db/pool';
import { redisConnection, DOWNLOADS_QUEUE_NAME, DownloadJobData } from './queue/connection';
import { uploadResultFile } from './storage/r2';
import { decryptSecret } from './credentialsCrypto';

/**
 * SoundCloud goes through yt-dlp scraping rather than an official API, so
 * it's more prone to transient failures (rate limiting, temporary blocks)
 * than Spotify's spotdl/official-metadata path. This retries the whole
 * SoundCloud pipeline (resolve + download + processing) with exponential
 * backoff before giving up — separate from BullMQ's own job-level retry,
 * which re-queues the job entirely and is a coarser, slower fallback.
 */
async function withRetry<T>(fn: () => Promise<T>, attempts: number, baseDelayMs: number): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err as Error;
      if (attempt < attempts) {
        const delay = baseDelayMs * 2 ** (attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

async function getSpotifyCredentialsFor(apiKeyId: string): Promise<{ clientId: string; clientSecret: string }> {
  const result = await pool.query<{ spotify_client_id: string | null; spotify_client_secret_encrypted: string | null }>(
    'SELECT spotify_client_id, spotify_client_secret_encrypted FROM api_keys WHERE id = $1',
    [apiKeyId]
  );
  const row = result.rows[0];
  if (!row?.spotify_client_id || !row.spotify_client_secret_encrypted) {
    throw new Error('No Spotify credentials registered for this API key');
  }
  return { clientId: row.spotify_client_id, clientSecret: decryptSecret(row.spotify_client_secret_encrypted) };
}

async function markProcessing(jobId: string) {
  await pool.query(`UPDATE jobs SET status = 'processing', started_at = now() WHERE id = $1`, [jobId]);
}

async function markDone(jobId: string, resultKey: string, bpm: number | null, keySignature: string | null) {
  // bpm/key detection degrades to null on failure (see packages/engine) —
  // that's a partial result, not a job failure, so it's stored as-is here
  // rather than routed through markFailed.
  await pool.query(
    `UPDATE jobs SET status = 'done', result_key = $2, bpm = $3, key_signature = $4, completed_at = now() WHERE id = $1`,
    [jobId, resultKey, bpm, keySignature]
  );
  await pool.query(`INSERT INTO usage_log (api_key_id, job_id, event)
                     SELECT api_key_id, id, 'job_completed' FROM jobs WHERE id = $1`, [jobId]);
}

async function markFailed(jobId: string, error: string) {
  await pool.query(`UPDATE jobs SET status = 'failed', error = $2, completed_at = now() WHERE id = $1`, [
    jobId,
    error.slice(0, 2000),
  ]);
  await pool.query(`INSERT INTO usage_log (api_key_id, job_id, event)
                     SELECT api_key_id, id, 'job_failed' FROM jobs WHERE id = $1`, [jobId]);
}

// Confirmed via direct reproduction against a real failing track (Spotify's
// YouTube-search fallback, non-verbose yt-dlp invocation — the exact one
// this worker runs, not a guess): a video-data-level 403 produces exactly
// this string, distinct from a metadata/extraction-level failure. This is
// YouTube's PO Token / SABR streaming enforcement (yt-dlp's own tracked
// issue #12482) — a genuine, currently-unfixable platform limitation, not
// a bug. Deliberately not implementing PO Token mitigation (would require
// the operator's own YouTube account cookies — a security tradeoff not
// worth it, same reasoning as Spotify's BYOK/proxy design). See CHANGELOG.
const YOUTUBE_VIDEO_DATA_403_PATTERN = /unable to download video data: HTTP Error 403: Forbidden/;

/**
 * job.error is returned verbatim to every API consumer (GET
 * /v1/downloads/:job_id — CLI, raw HTTP, anything else), so most errors
 * should stay exactly as thrown: specific technical detail is more useful
 * than a generic message (see the "No YouTube results found" fix in
 * packages/engine). The one confirmed exception is the 403 case above,
 * which a raw yt-dlp command line + Python deprecation warning gives a
 * non-developer nothing actionable to do with. Scoped to `source ===
 * 'spotify'` specifically — SoundCloud/Bandcamp's own yt-dlp calls can
 * produce the same generic 403 message shape for an entirely different
 * (their own platform's) reason, and mislabeling that as "YouTube" would
 * be wrong, not just imprecise.
 */
export function clientFacingError(source: string, rawMessage: string): string {
  if (source === 'spotify' && YOUTUBE_VIDEO_DATA_403_PATTERN.test(rawMessage)) {
    return "This track couldn't be downloaded from YouTube right now due to platform restrictions. Try a different track, or try again later.";
  }
  return rawMessage;
}

async function processDownloadJob(job: Job<DownloadJobData>) {
  const { jobId, apiKeyId, source, url } = job.data;

  await markProcessing(jobId);

  const workDir = path.join(config.workDir, jobId);
  const outputDir = path.join(workDir, 'audio');
  const artworkDir = path.join(workDir, 'artwork');

  try {
    let track: ProcessedSpotifyTrack | ProcessedSoundCloudTrack | ProcessedBandcampTrack;

    if (source === 'spotify') {
      // BYOK: each API key brings its own Spotify Developer App credentials —
      // the platform holds no Spotify app of its own. downloads.ts already
      // checked this exists before enqueueing; re-checking here is what
      // actually uses it (and guards against it being deleted mid-flight).
      const spotifyCreds = await getSpotifyCredentialsFor(apiKeyId);

      track = await processSpotifyTrack(url, {
        outputDir,
        artworkDir,
        spotify: spotifyCreds,
        jobId,
        detectKeyFallback: true, // API is a one-shot job — no follow-up "enrich" round trip like desktop has
        onProgress: (event) => job.updateProgress({ stage: event.stage, message: event.message }),
      });
    } else if (source === 'soundcloud') {
      // No credentials of any kind — SoundCloud goes through yt-dlp
      // scraping, not an authenticated API. Retried (see withRetry) because
      // that scraping path is more failure-prone than Spotify's.
      track = await withRetry(
        () =>
          processSoundCloudTrack(url, {
            outputDir,
            artworkDir,
            jobId,
            onProgress: (event) => job.updateProgress({ stage: event.stage, message: event.message }),
          }),
        3,
        3000
      );
    } else if (source === 'bandcamp') {
      // Same yt-dlp scraping pipeline as SoundCloud (confirmed identical in
      // the Phase 3 investigation) — same retry treatment applies for the
      // same reason. downloads.ts already rejected non-track URLs before
      // this job was ever queued (see isBandcampTrackUrl), so `url` here is
      // guaranteed to be a single-track URL, not an album/playlist.
      track = await withRetry(
        () =>
          processBandcampTrack(url, {
            outputDir,
            artworkDir,
            jobId,
            onProgress: (event) => job.updateProgress({ stage: event.stage, message: event.message }),
          }),
        3,
        3000
      );
    } else {
      throw new Error(`Worker does not yet support source '${source}'`);
    }

    const resultKey = `downloads/${jobId}${path.extname(track.filePath)}`;
    await uploadResultFile(track.filePath, resultKey);
    await markDone(jobId, resultKey, track.bpm, track.key);
  } catch (err) {
    const rawMessage = (err as Error).message ?? String(err);
    // Only what's stored (and later returned via the API) is simplified —
    // `err` itself is re-thrown unchanged below, so BullMQ's own failure
    // logging (see worker.on('failed', ...) in startWorker's caller) still
    // records the full raw message, same as before this change.
    await markFailed(jobId, clientFacingError(source, rawMessage));
    throw err; // let BullMQ record the failure / retry per defaultJobOptions
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

export function startWorker() {
  return new Worker<DownloadJobData>(DOWNLOADS_QUEUE_NAME, processDownloadJob, {
    connection: redisConnection,
    concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2),
  });
}

if (require.main === module) {
  assertRuntimeConfig();
  const worker = startWorker();
  worker.on('completed', (job) => console.log(`Job ${job.id} completed`));
  worker.on('failed', (job, err) => console.error(`Job ${job?.id} failed:`, err.message));
  console.log('Download worker started.');

  // Container platforms send SIGTERM on redeploy/scale-down. BullMQ's
  // Worker.close() stops pulling new jobs but lets any job currently being
  // processed finish first — exactly what we want, since killing a job
  // mid-download would leave a jobs row stuck in "processing" until BullMQ's
  // lock expires and it's retried from scratch. Don't call process.exit()
  // until close() resolves.
  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received — waiting for the active job (if any) to finish before shutting down...`);
    try {
      await worker.close();
      console.log('Worker closed cleanly.');
      process.exit(0);
    } catch (err) {
      console.error('Error during worker shutdown:', err);
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}
