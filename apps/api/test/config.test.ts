import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// config.ts calls dotenv's config() at import time, which fills in any
// process.env var missing at that moment from the local .env file. Left
// unmocked, that would silently repopulate whatever this file deletes from
// process.env with real local values, making these tests non-deterministic
// depending on what happens to be in apps/api/.env. Mocked to a no-op so
// process.env manipulation below is the only source of truth.
vi.mock('dotenv', () => ({ config: () => ({}) }));

const REQUIRED_VARS: Record<string, string> = {
  DATABASE_URL: 'postgresql://test',
  REDIS_URL: 'redis://test',
  CREDENTIALS_ENCRYPTION_KEY: 'test-key',
  R2_ENDPOINT: 'https://test.r2.cloudflarestorage.com',
  R2_ACCESS_KEY_ID: 'test-access-key-id',
  R2_SECRET_ACCESS_KEY: 'test-secret-access-key',
  R2_BUCKET: 'test-bucket',
};

const KEYS_TO_CLEAR = [...Object.keys(REQUIRED_VARS), 'SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET'];

let savedEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  savedEnv = { ...process.env };
  for (const key of KEYS_TO_CLEAR) delete process.env[key];
});

afterEach(() => {
  process.env = savedEnv;
});

describe('assertRuntimeConfig', () => {
  it('boots cleanly with only the currently-required vars set — SPOTIFY_CLIENT_ID/SECRET not needed at all', async () => {
    Object.assign(process.env, REQUIRED_VARS);
    // Not just omitted — explicitly confirmed absent, so this test actually
    // proves what it claims rather than passing by accident.
    expect(process.env.SPOTIFY_CLIENT_ID).toBeUndefined();
    expect(process.env.SPOTIFY_CLIENT_SECRET).toBeUndefined();

    vi.resetModules();
    const { assertRuntimeConfig } = await import('../src/config');
    expect(() => assertRuntimeConfig()).not.toThrow();
  });

  it('still throws when a genuinely required var is missing (confirms the gate itself works, not just that Spotify vars are gone)', async () => {
    Object.assign(process.env, REQUIRED_VARS);
    delete process.env.DATABASE_URL;

    vi.resetModules();
    const { assertRuntimeConfig } = await import('../src/config');
    expect(() => assertRuntimeConfig()).toThrow(/DATABASE_URL/);
  });

  it('regression guard: setting SPOTIFY_CLIENT_ID/SECRET has no effect on boot either way — BYOK (Fase 1) removed the global requirement; this must not silently come back', async () => {
    Object.assign(process.env, REQUIRED_VARS, {
      SPOTIFY_CLIENT_ID: 'present-but-should-be-irrelevant',
      SPOTIFY_CLIENT_SECRET: 'present-but-should-be-irrelevant',
    });

    vi.resetModules();
    const { assertRuntimeConfig } = await import('../src/config');
    expect(() => assertRuntimeConfig()).not.toThrow();
  });
});
