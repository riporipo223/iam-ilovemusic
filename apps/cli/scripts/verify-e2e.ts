/**
 * Manual end-to-end verification against a LIVE API instance, exercising the
 * CLI's real modules (api.ts, config.ts, sanitizeFilename.ts) directly —
 * the same code the interactive `create-api-key`/`download` commands call.
 * Not a substitute for actually trying the interactive commands in a real
 * terminal (this script bypasses @clack/prompts entirely), but it proves
 * the HTTP calls, config persistence, ID3-tag-based renaming, and file save
 * all work end-to-end. Mirrors apps/api/scripts/verify-e2e.ts's shape.
 *
 * Usage:
 *   npm run verify:e2e --workspace @ilovemusic/cli
 *   CLI_TEST_BANDCAMP_URL="https://artist.bandcamp.com/track/..." npm run verify:e2e --workspace @ilovemusic/cli
 *
 * What this does NOT cover: the interactive Spotify BYOK prompt flow in
 * `download.ts` (ensureSpotifyCredentials) — that needs a real terminal
 * (text/password/confirm prompts) AND a real Spotify Developer App pair,
 * neither of which this script has. It only proves the server-side
 * rejection path works against a deliberately bad pair, and that
 * registerSpotifyCredentials/deleteSpotifyCredentials call the right
 * endpoints correctly — not the full "type real credentials, see it
 * succeed and continue inline" path. See apps/cli/README.md for what to
 * try by hand.
 */
import { promises as fs, createWriteStream } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { parseFile } from 'music-metadata';
import {
  createApiKey,
  createDownload,
  getJobStatus,
  registerSpotifyCredentials,
  deleteSpotifyCredentials,
  ApiError,
  type JobStatus,
} from '../src/api';
import { writeConfig, readConfig, getConfigPath } from '../src/config';
import { sanitizeFilename } from '../src/util/sanitizeFilename';

const DOWNLOADS_DIR = path.join(os.homedir(), 'Downloads', 'ILoveMusic');

interface TestCase {
  source: 'spotify' | 'soundcloud' | 'bandcamp';
  url: string | undefined;
  expectSuccess: boolean;
}

async function main() {
  console.log('=== 1. create-api-key ===');
  const created = await createApiKey('cli-e2e-verification');
  console.log('Created key id:', created.id);

  await writeConfig({ apiKey: created.key, apiKeyId: created.id, createdAt: created.created_at });
  const persisted = await readConfig();
  if (persisted?.apiKey !== created.key) throw new Error('Config round-trip mismatch!');
  console.log('Config saved and read back correctly from', getConfigPath());

  console.log('\n=== 2. registerSpotifyCredentials rejection path ===');
  try {
    await registerSpotifyCredentials(persisted.apiKey, 'not-a-real-client-id', 'not-a-real-secret');
    throw new Error('Expected a bogus credential pair to be rejected, but it succeeded!');
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 400) throw err;
    console.log('Got expected rejection (HTTP 400):', err.message);
  }

  console.log('\n=== 3. deleteSpotifyCredentials (idempotent — no credentials were ever registered) ===');
  await deleteSpotifyCredentials(persisted.apiKey);
  console.log('DELETE succeeded with no credentials on record, as expected.');

  const cases: TestCase[] = [
    { source: 'soundcloud', url: 'https://soundcloud.com/forss/flickermood', expectSuccess: true },
    { source: 'bandcamp', url: process.env.CLI_TEST_BANDCAMP_URL, expectSuccess: true },
    // No BYOK Spotify credentials are registered for a freshly self-served
    // key, so this is expected to fail with a specific 400 — proves the
    // error path (reportApiError's Spotify-specific message) is reachable.
    { source: 'spotify', url: 'https://open.spotify.com/track/3n3Ppam7vgaVa1iaRUc9Lp', expectSuccess: false },
  ];

  for (const testCase of cases) {
    if (!testCase.url) {
      console.log(`\n=== Skipping ${testCase.source} (no URL provided) ===`);
      continue;
    }
    console.log(`\n=== Testing source=${testCase.source} ===`);
    let job: JobStatus;
    try {
      const submitted = await createDownload(persisted.apiKey, testCase.source, testCase.url);
      console.log('Job submitted:', submitted.job_id);

      const startedAt = Date.now();
      while (true) {
        if (Date.now() - startedAt > 3 * 60 * 1000) throw new Error('Timed out polling');
        job = await getJobStatus(persisted.apiKey, submitted.job_id);
        console.log(`  [${Math.round((Date.now() - startedAt) / 1000)}s] status=${job.status}`);
        if (job.status === 'done' || job.status === 'failed') break;
        await new Promise((r) => setTimeout(r, 3000));
      }
    } catch (err) {
      if (testCase.expectSuccess) throw err;
      console.log('Got expected error:', (err as Error).message);
      continue;
    }

    if (job.status === 'failed') {
      if (testCase.expectSuccess) throw new Error(`Unexpected failure: ${job.error}`);
      console.log('Got expected job failure:', job.error);
      continue;
    }
    if (!testCase.expectSuccess) throw new Error('Expected this case to fail but it succeeded');

    await fs.mkdir(DOWNLOADS_DIR, { recursive: true });
    const res = await fetch(job.result_url!);
    if (!res.ok) throw new Error(`Fetch result_url failed: HTTP ${res.status}`);
    const tempPath = path.join(DOWNLOADS_DIR, `.tmp-verify-${Date.now()}.mp3`);
    await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream<Uint8Array>), createWriteStream(tempPath));

    let baseName = 'ilovemusic-track';
    const metadata = await parseFile(tempPath);
    const artist = metadata.common.artist?.trim();
    const title = metadata.common.title?.trim();
    if (artist && title) baseName = `${artist} - ${title}`;
    else if (title) baseName = title;
    console.log('  Parsed ID3 tags -> artist:', artist, '| title:', title);

    const finalPath = path.join(DOWNLOADS_DIR, `${sanitizeFilename(baseName)}.mp3`);
    await fs.rename(tempPath, finalPath);
    const stat = await fs.stat(finalPath);

    console.log('  Saved:', finalPath);
    console.log('  Size:', (stat.size / 1024 / 1024).toFixed(2), 'MB');
    console.log('  BPM:', job.bpm, '| Key:', job.key_signature);
    if (stat.size === 0) throw new Error('Saved file is 0 bytes!');
  }

  console.log('\n=== ALL CHECKS PASSED ===');
}

main().catch((err) => {
  console.error('\n=== FAILED ===');
  console.error(err);
  process.exit(1);
});
