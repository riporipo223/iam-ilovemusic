-- Phase 1 schema: API keys, download jobs, usage log.
-- Applied by `npm run migrate --workspace @ilovemusic/api` (src/db/migrate.ts).
-- Statements are idempotent (IF NOT EXISTS) so this file can be re-run safely.

CREATE TABLE IF NOT EXISTS api_keys (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key_hash    TEXT NOT NULL UNIQUE,
    label       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at  TIMESTAMPTZ
);

-- 'operator' = minted via scripts/create-api-key.ts (direct DB access, run by
-- the platform operator). 'self_serve' = minted via the public, unauthenticated
-- POST /v1/api-keys endpoint (see routes/apiKeys.ts) — kept distinct so a burst
-- of abuse there can be bulk-revoked without touching operator-issued keys.
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS created_via TEXT NOT NULL DEFAULT 'operator';

-- BYOK: each API key owner brings their own Spotify Developer App credentials
-- (see routes/spotifyCredentials.ts). client_secret is encrypted at rest
-- (AES-256-GCM, see credentialsCrypto.ts) — never stored in plaintext.
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS spotify_client_id TEXT;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS spotify_client_secret_encrypted TEXT;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS spotify_credentials_updated_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS jobs (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    api_key_id   UUID NOT NULL REFERENCES api_keys(id),
    source       TEXT NOT NULL,             -- 'spotify' | 'soundcloud' | 'bandcamp'
    input_url    TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'queued', -- queued | processing | done | failed
    result_key   TEXT, -- R2 object key; a presigned GET URL is minted on read, not stored
    error        TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at   TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);

-- BPM/key as detected by packages/engine (platform-agnostic — same columns
-- get populated for SoundCloud/Bandcamp jobs once those phases land, not
-- Spotify-specific). Null on a "done" job means detection degraded
-- gracefully, not that the job failed. "key" is unreserved in Postgres but
-- avoided anyway to sidestep confusion with SQL KEY/PRIMARY KEY vocabulary.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS bpm REAL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS key_signature TEXT;

CREATE INDEX IF NOT EXISTS idx_jobs_api_key_id ON jobs(api_key_id);

CREATE TABLE IF NOT EXISTS usage_log (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    api_key_id UUID NOT NULL REFERENCES api_keys(id),
    job_id     UUID REFERENCES jobs(id),
    event      TEXT NOT NULL,   -- 'job_created' | 'job_completed' | 'job_failed' | 'rate_limited'
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_usage_log_api_key_id ON usage_log(api_key_id);
