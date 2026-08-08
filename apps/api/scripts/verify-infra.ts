/**
 * Checks that DATABASE_URL, REDIS_URL, and the R2_* vars in .env are all
 * actually reachable — run this after filling in .env, before attempting a
 * real download job. Each check fails independently so you get all three
 * results in one pass instead of discovering them one at a time.
 *
 * Usage: npm run verify-infra --workspace @ilovemusic/api
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pool } from '../src/db/pool';
import { redisConnection } from '../src/queue/connection';
import { uploadResultFile, getDownloadUrl } from '../src/storage/r2';

async function checkPostgres(): Promise<string> {
  const result = await pool.query<{ exists: string | null }>('SELECT to_regclass($1) AS exists', ['public.jobs']);
  const migrated = !!result.rows[0].exists;
  return migrated
    ? 'connected, jobs table exists'
    : 'connected, but jobs table is missing — run: npm run migrate --workspace @ilovemusic/api';
}

async function checkRedis(): Promise<string> {
  const pong = await redisConnection.ping();
  if (pong !== 'PONG') throw new Error(`unexpected response: ${pong}`);
  return 'connected (PONG)';
}

async function checkR2(): Promise<string> {
  const tmpFile = path.join(os.tmpdir(), `ilovemusic-verify-infra-${Date.now()}.txt`);
  fs.writeFileSync(tmpFile, `verify-infra check at ${new Date().toISOString()}`);
  const key = `_verify-infra-check/${Date.now()}.txt`;

  try {
    await uploadResultFile(tmpFile, key);
    const url = await getDownloadUrl(key);
    return `uploaded + presigned ok — fetch this URL to fully confirm the bucket is reachable, then delete the object from the R2 dashboard:\n      ${url}`;
  } finally {
    fs.unlinkSync(tmpFile);
  }
}

async function main() {
  const checks: Array<[string, () => Promise<string>]> = [
    ['Postgres (DATABASE_URL)', checkPostgres],
    ['Redis    (REDIS_URL)   ', checkRedis],
    ['R2       (R2_* vars)   ', checkR2],
  ];

  let allPassed = true;
  for (const [name, check] of checks) {
    process.stdout.write(`${name} ... `);
    try {
      console.log('OK —', await check());
    } catch (err) {
      allPassed = false;
      console.log('FAILED —', (err as Error).message);
    }
  }

  await pool.end().catch(() => {});
  redisConnection.disconnect();
  process.exit(allPassed ? 0 : 1);
}

main();
