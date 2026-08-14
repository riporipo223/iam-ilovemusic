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
  // No silent localhost fallback — required in assertRuntimeConfig() below.
  // An unset REDIS_URL in production used to fail quietly by trying (and
  // failing) to reach a Redis that was never going to exist on that host,
  // instead of refusing to boot with a clear message.
  redisUrl: process.env.REDIS_URL ?? '',

  // BYOK: each API consumer supplies their own Spotify Developer App
  // credentials (see routes/spotifyCredentials.ts) — the platform no longer
  // holds a shared Spotify app. This key encrypts those user-supplied
  // secrets at rest; it must never be the same secret as anything stored in
  // the database itself.
  credentialsEncryptionKey: process.env.CREDENTIALS_ENCRYPTION_KEY ?? '',

  // NOT BYOK — deliberately separate from the per-consumer credentials
  // above. These belong to the platform operator (the desktop app's own
  // developer) and back GET /v1/spotify-metadata specifically: a proxy the
  // desktop app calls so it never has to hold a Spotify Client Secret
  // itself (previously bundled locally, which is extractable from a
  // packaged .dmg's asar). Optional at boot — same reasoning as BYOK
  // credentials not being required: an operator who hasn't set these up yet
  // should still be able to run every other endpoint.
  platformSpotify: {
    clientId: process.env.PLATFORM_SPOTIFY_CLIENT_ID ?? '',
    clientSecret: process.env.PLATFORM_SPOTIFY_CLIENT_SECRET ?? '',
  },

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

  // POST /v1/api-keys is unauthenticated by necessity (it's how a caller gets
  // their first key), so it can't be gated behind the per-key limit above.
  // Deliberately strict and IP-scoped only — no email/captcha verification
  // (see CHANGELOG for the reasoning) — the abuse ceiling this accepts is
  // "someone burns their own download quota with a throwaway IP," not
  // anything higher-value.
  selfServeApiKeyRateLimit: {
    max: Number(process.env.API_KEY_SELF_SERVE_RATE_LIMIT_MAX ?? 3),
    window: process.env.API_KEY_SELF_SERVE_RATE_LIMIT_WINDOW ?? '1 day',
  },

  // How long a presigned download URL for a finished job stays valid.
  downloadUrlTtlSeconds: Number(process.env.DOWNLOAD_URL_TTL_SECONDS ?? 3600),
};

/**
 * Called once at boot (server.ts and worker.ts). Fails loudly and
 * immediately when a required var is missing, rather than letting the
 * process start and fail confusingly later — e.g. R2 vars used to default
 * to empty strings, so a misconfigured deployment would boot fine and only
 * error the first time a job tried to upload a result.
 */
export function assertRuntimeConfig() {
  required('DATABASE_URL');
  required('REDIS_URL');
  required('CREDENTIALS_ENCRYPTION_KEY');
  required('R2_ENDPOINT');
  required('R2_ACCESS_KEY_ID');
  required('R2_SECRET_ACCESS_KEY');
  required('R2_BUCKET');
}
