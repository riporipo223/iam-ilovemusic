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

// Mutable so each test can flip between "configured"/"unconfigured" without
// vi.resetModules() + a fresh dynamic import — that approach worked in
// isolation but was flaky under the full suite (module-registry resets
// interacting with other test files' own dynamic imports of ../src/server).
// A getter on the mocked config re-reads this object on every access, same
// effect without touching module-loading machinery at all.
const platformSpotifyMock = { clientId: 'platform-client-id', clientSecret: 'platform-client-secret' };

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

vi.mock('../src/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/config')>();
  return {
    ...actual,
    config: {
      ...actual.config,
      get platformSpotify() {
        return platformSpotifyMock;
      },
    },
  };
});

const { buildServer } = await import('../src/server');

function mockAuthLookup() {
  queryMock.mockImplementationOnce(async (sql: string) => {
    expect(sql).toContain('FROM api_keys');
    return { rows: [{ id: TEST_API_KEY_ID }] };
  });
}

const VALID_URL = 'https://open.spotify.com/track/47iKV0KlcvlflSsrCPD3TQ';

beforeEach(() => {
  queryMock.mockReset();
  fetchSpotifyTrackMetadataMock.mockReset();
  platformSpotifyMock.clientId = 'platform-client-id';
  platformSpotifyMock.clientSecret = 'platform-client-secret';
});

describe('GET /v1/spotify-metadata', () => {
  it('requires a valid API key', async () => {
    const app = buildServer();
    const res = await app.inject({
      method: 'GET',
      url: `/v1/spotify-metadata?url=${encodeURIComponent(VALID_URL)}`,
    });

    expect(res.statusCode).toBe(401);
    expect(fetchSpotifyTrackMetadataMock).not.toHaveBeenCalled();
  });

  it("rejects a missing 'url' query parameter", async () => {
    mockAuthLookup();
    const app = buildServer();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/spotify-metadata',
      headers: { 'x-api-key': TEST_KEY },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("'url'");
    expect(fetchSpotifyTrackMetadataMock).not.toHaveBeenCalled();
  });

  it('rejects a URL that is not a valid Spotify track URL with a clear error', async () => {
    mockAuthLookup();
    const app = buildServer();
    const res = await app.inject({
      method: 'GET',
      url: `/v1/spotify-metadata?url=${encodeURIComponent('https://soundcloud.com/someone/a-track')}`,
      headers: { 'x-api-key': TEST_KEY },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('valid Spotify track URL');
    expect(fetchSpotifyTrackMetadataMock).not.toHaveBeenCalled();
  });

  it('returns 500 with a clear error when platform Spotify credentials are not configured on this server', async () => {
    platformSpotifyMock.clientId = '';
    platformSpotifyMock.clientSecret = '';

    mockAuthLookup();
    const app = buildServer();
    const res = await app.inject({
      method: 'GET',
      url: `/v1/spotify-metadata?url=${encodeURIComponent(VALID_URL)}`,
      headers: { 'x-api-key': TEST_KEY },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toContain('not configured');
    expect(fetchSpotifyTrackMetadataMock).not.toHaveBeenCalled();
  });

  it('returns the track metadata for a valid Spotify track URL, using the platform credentials (not BYOK)', async () => {
    mockAuthLookup();
    fetchSpotifyTrackMetadataMock.mockResolvedValueOnce({
      id: '47iKV0KlcvlflSsrCPD3TQ',
      title: 'Test Track',
      artist: 'Test Artist',
      allArtists: 'Test Artist',
      duration: 180,
      thumbnail: 'https://example.com/art.jpg',
      albumName: 'Test Album',
    });

    const app = buildServer();
    const res = await app.inject({
      method: 'GET',
      url: `/v1/spotify-metadata?url=${encodeURIComponent(VALID_URL)}`,
      headers: { 'x-api-key': TEST_KEY },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      id: '47iKV0KlcvlflSsrCPD3TQ',
      title: 'Test Track',
      artist: 'Test Artist',
      allArtists: 'Test Artist',
      duration: 180,
      thumbnail: 'https://example.com/art.jpg',
      albumName: 'Test Album',
    });
    expect(fetchSpotifyTrackMetadataMock).toHaveBeenCalledWith('47iKV0KlcvlflSsrCPD3TQ', {
      clientId: 'platform-client-id',
      clientSecret: 'platform-client-secret',
    });
  });

  it('returns 404 when Spotify reports the track was not found', async () => {
    mockAuthLookup();
    fetchSpotifyTrackMetadataMock.mockRejectedValueOnce(new Error('Spotify track not found'));

    const app = buildServer();
    const res = await app.inject({
      method: 'GET',
      url: `/v1/spotify-metadata?url=${encodeURIComponent(VALID_URL)}`,
      headers: { 'x-api-key': TEST_KEY },
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 502 with a clear error for other upstream Spotify failures', async () => {
    mockAuthLookup();
    fetchSpotifyTrackMetadataMock.mockRejectedValueOnce(new Error('Spotify API error: 500 internal error'));

    const app = buildServer();
    const res = await app.inject({
      method: 'GET',
      url: `/v1/spotify-metadata?url=${encodeURIComponent(VALID_URL)}`,
      headers: { 'x-api-key': TEST_KEY },
    });

    expect(res.statusCode).toBe(502);
    expect(res.json().error).toContain('Failed to fetch Spotify metadata');
  });
});
