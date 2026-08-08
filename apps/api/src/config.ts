import * as path from 'path';
import * as os from 'os';
import { config as loadEnv } from 'dotenv';

// quiet: true suppresses dotenv's console "tip" line (as of v17.4.x this
// occasionally advertises an unrelated side project of the maintainer's).
loadEnv({ quiet: true });

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',

  databaseUrl: process.env.DATABASE_URL ?? '',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',

  // BYOK: each API consumer supplies their own Spotify Developer App
  // credentials (see routes/spotifyCredentials.ts) — the platform no longer
  // holds a shared Spotify app. This key encrypts those user-supplied
  // secrets at rest; it must never be the same secret as anything stored in
  // the database itself.
  credentialsEncryptionKey: process.env.CREDENTIALS_ENCRYPTION_KEY ?? '',

  r2: {
    endpoint: process.env.R2_ENDPOINT ?? '',
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
    bucket: process.env.R2_BUCKET ?? '',
  },

  // Local scratch directory for in-flight downloads before they're uploaded
  // to R2 and deleted. Never served directly.
  workDir: process.env.WORK_DIR ?? path.join(os.tmpdir(), 'ilovemusic-api'),

  rateLimit: {
    max: Number(process.env.RATE_LIMIT_MAX ?? 20),
    window: process.env.RATE_LIMIT_WINDOW ?? '1 minute',
  },

  // How long a presigned download URL for a finished job stays valid.
  downloadUrlTtlSeconds: Number(process.env.DOWNLOAD_URL_TTL_SECONDS ?? 3600),
};

export function assertRuntimeConfig() {
  required('DATABASE_URL');
  required('CREDENTIALS_ENCRYPTION_KEY');
}
