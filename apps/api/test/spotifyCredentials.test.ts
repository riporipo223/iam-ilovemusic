import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { randomBytes } from 'crypto';
import { hashApiKey } from '../src/apiKeys';

beforeAll(() => {
  process.env.CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString('base64');
});

const TEST_KEY = 'ilm_test_key_123';
const TEST_KEY_HASH = hashApiKey(TEST_KEY);
const TEST_API_KEY_ID = 'api-key-uuid-1';

const queryMock = vi.fn();
const fetchSpotifyTrackMetadataMock = vi.fn();

vi.mock('../src/db/pool', () => ({
  pool: { query: (...args: unknown[]) => queryMock(...args) },
}));

vi.mock('../src/queue/connection', () => ({
  redisConnection: undefined,
  downloadsQueue: { add: vi.fn() },
  DOWNLOADS_QUEUE_NAME: 'downloads',
}));

vi.mock('../src/storage/r2', () => ({ getDownloadUrl: vi.fn(), uploadResultFile: vi.fn() }));

vi.mock('@ilovemusic/engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ilovemusic/engine')>();
  return {
    ...actual,
    fetchSpotifyTrackMetadata: (...args: unknown[]) => fetchSpotifyTrackMetadataMock(...args),
  };
});

const { buildServer } = await import('../src/server');

function mockAuthLookup() {
  queryMock.mockImplementationOnce(async (sql: string) => {
    expect(sql).toContain('FROM api_keys');
    return { rows: [{ id: TEST_API_KEY_ID }] };
  });
}

beforeEach(() => {
  queryMock.mockReset();
  fetchSpotifyTrackMetadataMock.mockReset();
});

describe('PUT /v1/spotify-credentials', () => {
  it('rejects a missing client_secret', async () => {
    mockAuthLookup();
    const app = buildServer();
    const res = await app.inject({
      method: 'PUT',
      url: '/v1/spotify-credentials',
      headers: { 'x-api-key': TEST_KEY },
      payload: { client_id: 'abc' },
    });
    expect(res.statusCode).toBe(400);
    expect(fetchSpotifyTrackMetadataMock).not.toHaveBeenCalled();
  });

  it('rejects credentials Spotify itself refuses (e.g. owner not Premium)', async () => {
    mockAuthLookup();
    fetchSpotifyTrackMetadataMock.mockRejectedValueOnce(
      new Error('Spotify auth failed: 403 Active premium subscription required for the owner of the app.')
    );

    const app = buildServer();
    const res = await app.inject({
      method: 'PUT',
      url: '/v1/spotify-credentials',
      headers: { 'x-api-key': TEST_KEY },
      payload: { client_id: 'abc', client_secret: 'def' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('premium');
  });

  it('stores encrypted credentials after live validation succeeds, never echoing the secret', async () => {
    mockAuthLookup();
    fetchSpotifyTrackMetadataMock.mockResolvedValueOnce({
      id: 'probe',
      title: 'Probe Track',
      artist: 'Probe Artist',
      allArtists: 'Probe Artist',
      duration: 180,
      thumbnail: null,
      albumName: null,
    });
    queryMock.mockImplementationOnce(async (sql: string, params: unknown[]) => {
      expect(sql).toContain('UPDATE api_keys');
      expect(sql).toContain('spotify_client_secret_encrypted');
      expect(params[0]).toBe(TEST_API_KEY_ID);
      expect(params[1]).toBe('abc');
      // The stored value must not be the plaintext secret.
      expect(params[2]).not.toBe('def');
      return { rows: [] };
    });

    const app = buildServer();
    const res = await app.inject({
      method: 'PUT',
      url: '/v1/spotify-credentials',
      headers: { 'x-api-key': TEST_KEY },
      payload: { client_id: 'abc', client_secret: 'def' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, client_id: 'abc' });
    expect(JSON.stringify(res.json())).not.toContain('def');
  });
});

describe('DELETE /v1/spotify-credentials', () => {
  it('clears stored credentials', async () => {
    mockAuthLookup();
    queryMock.mockImplementationOnce(async (sql: string, params: unknown[]) => {
      expect(sql).toContain('UPDATE api_keys');
      expect(sql).toContain('NULL');
      expect(params[0]).toBe(TEST_API_KEY_ID);
      return { rows: [] };
    });

    const app = buildServer();
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/spotify-credentials',
      headers: { 'x-api-key': TEST_KEY },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});
