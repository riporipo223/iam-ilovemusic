/**
 * Manual end-to-end verification against a LIVE API instance (server +
 * worker must already be running) — not a unit test, no mocks. Walks the
 * full success path: submit a real job, poll until it resolves, then
 * confirm the resulting file is actually retrievable from storage.
 *
 * This script is a plain API consumer — same X-API-Key auth as any external
 * caller. It never touches the database or Spotify credentials directly.
 *
 * Usage:
 *   export ILOVEMUSIC_API_KEY="..."
 *   export ILOVEMUSIC_API_BASE_URL="http://localhost:3000"
 *   npm run verify:e2e --workspace @ilovemusic/api -- spotify "https://open.spotify.com/track/..."
 *   npm run verify:e2e --workspace @ilovemusic/api -- soundcloud "https://soundcloud.com/artist/track"
 *
 * For a Spotify URL, credentials must already be registered for this API
 * key via PUT /v1/spotify-credentials beforehand (out of scope for this
 * script). SoundCloud needs no credentials at all.
 */

const POLL_INTERVAL_MS = 5000;
const TIMEOUT_MS = 3 * 60 * 1000;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

interface JobStatus {
  job_id: string;
  source: string;
  status: 'queued' | 'processing' | 'done' | 'failed';
  created_at: string;
  completed_at: string | null;
  result_url?: string;
  error?: string;
  bpm?: number | null;
  key_signature?: string | null;
}

async function main() {
  const apiKey = requiredEnv('ILOVEMUSIC_API_KEY');
  const baseUrl = requiredEnv('ILOVEMUSIC_API_BASE_URL').replace(/\/$/, '');
  const source = process.argv[2];
  const url = process.argv[3];

  if (!source || !url) {
    console.error('Usage: npm run verify:e2e --workspace @ilovemusic/api -- <source> <track-url>');
    console.error('  source: spotify | soundcloud');
    process.exit(1);
  }

  const startedAt = Date.now();
  const headers = { 'X-API-Key': apiKey, 'Content-Type': 'application/json' };

  console.log(`Submitting ${source} URL ${url} to ${baseUrl} ...`);
  const createRes = await fetch(`${baseUrl}/v1/downloads`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ source, url }),
  });

  if (!createRes.ok) {
    console.error(`POST /v1/downloads failed: HTTP ${createRes.status} — ${await createRes.text()}`);
    process.exit(1);
  }

  const { job_id } = (await createRes.json()) as { job_id: string };
  console.log(`Job created: ${job_id}`);
  console.log(`Polling every ${POLL_INTERVAL_MS / 1000}s (timeout ${TIMEOUT_MS / 1000}s)...\n`);

  let job: JobStatus | null = null;

  while (true) {
    const elapsed = Date.now() - startedAt;
    if (elapsed > TIMEOUT_MS) {
      console.error(`\nTimed out after ${(elapsed / 1000).toFixed(0)}s — job never reached 'done'/'failed'.`);
      console.error(`Last known job state: ${JSON.stringify(job)}`);
      process.exit(1);
    }

    const res = await fetch(`${baseUrl}/v1/downloads/${job_id}`, { headers });
    if (!res.ok) {
      console.error(`GET /v1/downloads/${job_id} failed: HTTP ${res.status} — ${await res.text()}`);
      process.exit(1);
    }
    job = (await res.json()) as JobStatus;
    console.log(`  [${(elapsed / 1000).toFixed(0)}s] status=${job.status}`);

    if (job.status === 'done' || job.status === 'failed') break;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  const totalSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);

  if (job.status === 'failed') {
    console.log('\n=== RESULT: FAILED ===');
    console.log(`Duration: ${totalSeconds}s`);
    console.log(`Error (from jobs.error, verbatim): ${job.error ?? '(no error message returned)'}`);
    process.exit(1);
  }

  // status === 'done' — confirm the file is actually there, not just that
  // the DB row says so.
  if (!job.result_url) {
    console.error('\nJob is "done" but no result_url was returned — that is a bug, not an expected outcome.');
    process.exit(1);
  }

  console.log('\nFetching file headers to confirm it is actually retrievable from storage...');
  const fileRes = await fetch(job.result_url);
  const contentLength = fileRes.headers.get('content-length');
  const sizeBytes = contentLength ? Number(contentLength) : null;
  // Only need to prove the object exists with real content — no need to
  // download the whole track.
  await fileRes.body?.cancel().catch(() => {});

  const fileVerified = fileRes.ok && sizeBytes !== null && sizeBytes > 0;

  console.log(`HTTP status fetching file: ${fileRes.status}`);
  console.log(
    `File size: ${sizeBytes !== null ? `${sizeBytes} bytes (${(sizeBytes / 1024 / 1024).toFixed(2)} MB)` : 'unknown (no Content-Length header)'}`
  );

  if ('bpm' in job || 'key_signature' in job) {
    console.log(`BPM: ${job.bpm ?? 'n/a'}`);
    console.log(`Key: ${job.key_signature ?? 'n/a'}`);
  } else {
    console.log('BPM/Key: not exposed by GET /v1/downloads/:job_id (unexpected — check the API version)');
  }

  console.log(`\n=== RESULT: ${fileVerified ? 'SUCCESS' : 'FAILED (file not verifiable)'} ===`);
  console.log(`Duration: ${totalSeconds}s`);

  if (!fileVerified) {
    console.error('Job reported "done" but the file at result_url came back with a bad status or 0 bytes.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
