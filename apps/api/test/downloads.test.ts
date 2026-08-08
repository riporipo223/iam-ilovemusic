import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hashApiKey } from '../src/apiKeys';

const TEST_KEY = 'ilm_test_key_123';
const TEST_KEY_HASH = hashApiKey(TEST_KEY);
const TEST_API_KEY_ID = 'api-key-uuid-1';
const OTHER_API_KEY_ID = 'api-key-uuid-2';

const queryMock = vi.fn();
const queueAddMock = vi.fn().mockResolvedValue({});
const getDownloadUrlMock = vi.fn().mockResolvedValue('https://r2.example.com/presigned');

vi.mock('../src/db/pool', () => ({
  pool: { query: (...args: unknown[]) => queryMock(...args) },
}));

vi.mock('../src/queue/connection', () => ({
  redisConnection: undefined, // rate-limit plugin falls back to its in-memory store
  downloadsQueue: { add: (...args: unknown[]) => queueAddMock(...args) },
  DOWNLOADS_QUEUE_NAME: 'downloads',
}));

vi.mock('../src/storage/r2', () => ({
  getDownloadUrl: (...args: unknown[]) => getDownloadUrlMock(...args),
  uploadResultFile: vi.fn(),
}));

// Imported after the mocks above so server.ts picks up the mocked modules.
const { buildServer } = await import('../src/server');

function mockAuthLookup(matchApiKeyId: string | null) {
  queryMock.mockImplementationOnce(async (sql: string) => {
    expect(sql).toContain('FROM api_keys');
    return { rows: matchApiKeyId ? [{ id: matchApiKeyId }] : [] };
  });
}

// Sanity check that auth.ts really does hash the incoming key the same way
// this test file computes TEST_KEY_HASH (guards against the two drifting).
it('hashApiKey is deterministic for the header value tests send', () => {
  expect(hashApiKey(TEST_KEY)).toBe(TEST_KEY_HASH);
});

beforeEach(() => {
  queryMock.mockReset();
  queueAddMock.mockClear();
  getDownloadUrlMock.mockClear();
});

describe('auth', () => {
  it('rejects requests with no X-API-Key header', async () => {
    const app = buildServer();
    const res = await app.inject({ method: 'GET', url: '/v1/downloads/some-id' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects requests with an unknown API key', async () => {
    mockAuthLookup(null);
    const app = buildServer();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/downloads/some-id',
      headers: { 'x-api-key': 'not-a-real-key' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /v1/downloads', () => {
  it('rejects a non-Spotify URL claiming to be Spotify', async () => {
    mockAuthLookup(TEST_API_KEY_ID);
    const app = buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/downloads',
      headers: { 'x-api-key': TEST_KEY },
      payload: { source: 'spotify', url: 'https://soundcloud.com/artist/track' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a source detectUrlSource would never recognize', async () => {
    // Now that spotify/soundcloud/bandcamp (everything detectUrlSource can
    // return) are all supported, there's no reachable input left that hits
    // the SUPPORTED_SOURCES check specifically without failing the earlier
    // detected-source-mismatch check first — this still exercises the
    // overall "garbage source gets rejected with 400, never 500/200" gate.
    mockAuthLookup(TEST_API_KEY_ID);
    const app = buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/downloads',
      headers: { 'x-api-key': TEST_KEY },
      payload: { source: 'tidal', url: 'https://tidal.com/track/song' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an invalid/unrecognized SoundCloud URL', async () => {
    mockAuthLookup(TEST_API_KEY_ID);
    const app = buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/downloads',
      headers: { 'x-api-key': TEST_KEY },
      payload: { source: 'soundcloud', url: 'https://open.spotify.com/track/47iKV0KlcvlflSsrCPD3TQ' },
    });
    expect(res.statusCode).toBe(400);
    expect(queueAddMock).not.toHaveBeenCalled();
  });

  it('creates a queued SoundCloud job WITHOUT any Spotify credential check', async () => {
    mockAuthLookup(TEST_API_KEY_ID);
    // Only 2 queries expected for this request: the auth lookup (above) and
    // the job insert below — no spotify_client_id lookup in between. If the
    // credential gate ever leaks to non-Spotify sources, this mock sequence
    // will desync and the assertions on call args below will fail.
    queryMock.mockImplementationOnce(async (sql: string) => {
      expect(sql).toContain('INSERT INTO jobs');
      expect(sql).not.toContain('spotify_client_id');
      return { rows: [{ id: 'job-uuid-sc-1', created_at: new Date().toISOString() }] };
    });
    queryMock.mockImplementationOnce(async (sql: string) => {
      expect(sql).toContain('INSERT INTO usage_log');
      return { rows: [] };
    });

    const app = buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/downloads',
      headers: { 'x-api-key': TEST_KEY },
      payload: { source: 'soundcloud', url: 'https://soundcloud.com/artist/track' },
    });

    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ job_id: 'job-uuid-sc-1', status: 'queued' });
    expect(queueAddMock).toHaveBeenCalledTimes(1);
    expect(queueAddMock.mock.calls[0][1]).toMatchObject({ jobId: 'job-uuid-sc-1', source: 'soundcloud' });
    // Exactly 2 pool.query calls total (auth + insert-jobs + usage_log = 3
    // mocks configured, all consumed) confirms no extra credential-check
    // query snuck in for this source.
    expect(queryMock).toHaveBeenCalledTimes(3);
  });

  it('rejects a Spotify job when the API key has no Spotify credentials registered', async () => {
    mockAuthLookup(TEST_API_KEY_ID);
    queryMock.mockImplementationOnce(async (sql: string) => {
      expect(sql).toContain('spotify_client_id');
      return { rows: [{ spotify_client_id: null }] };
    });

    const app = buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/downloads',
      headers: { 'x-api-key': TEST_KEY },
      payload: { source: 'spotify', url: 'https://open.spotify.com/track/47iKV0KlcvlflSsrCPD3TQ' },
    });

    expect(res.statusCode).toBe(400);
    expect(queueAddMock).not.toHaveBeenCalled();
  });

  it('creates a queued job for a valid Spotify URL when credentials are registered', async () => {
    mockAuthLookup(TEST_API_KEY_ID);
    queryMock.mockImplementationOnce(async (sql: string) => {
      expect(sql).toContain('spotify_client_id');
      return { rows: [{ spotify_client_id: 'user-owned-client-id' }] };
    });
    queryMock.mockImplementationOnce(async (sql: string) => {
      expect(sql).toContain('INSERT INTO jobs');
      return { rows: [{ id: 'job-uuid-1', created_at: new Date().toISOString() }] };
    });
    queryMock.mockImplementationOnce(async (sql: string) => {
      expect(sql).toContain('INSERT INTO usage_log');
      return { rows: [] };
    });

    const app = buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/downloads',
      headers: { 'x-api-key': TEST_KEY },
      payload: { source: 'spotify', url: 'https://open.spotify.com/track/47iKV0KlcvlflSsrCPD3TQ' },
    });

    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ job_id: 'job-uuid-1', status: 'queued' });
    expect(queueAddMock).toHaveBeenCalledTimes(1);
    expect(queueAddMock.mock.calls[0][1]).toMatchObject({ jobId: 'job-uuid-1', source: 'spotify' });
  });

  // Real, currently-live Bandcamp URLs — verified via web search before
  // building the guard, not fabricated. See packages/engine/src/url.ts's
  // isBandcampTrackUrl for the same list used at the unit level.
  const REAL_BANDCAMP_TRACK_URL = 'https://hopalong.bandcamp.com/track/tibetan-pop-stars';
  const REAL_BANDCAMP_ALBUM_URLS = [
    'https://discoveryband.bandcamp.com/album/lp-deluxe-edition',
    'https://samadamsmusic.bandcamp.com/album/discover',
    'https://phobiarecords.bandcamp.com/album/discover-crimes-of-humanity-lp',
    'https://panterah.bandcamp.com/album/discover',
  ];

  it('creates a queued Bandcamp job WITHOUT any Spotify credential check', async () => {
    mockAuthLookup(TEST_API_KEY_ID);
    // Only 2 queries expected: auth lookup (above) + job insert below — no
    // spotify_client_id lookup in between, same guarantee as SoundCloud.
    queryMock.mockImplementationOnce(async (sql: string) => {
      expect(sql).toContain('INSERT INTO jobs');
      expect(sql).not.toContain('spotify_client_id');
      return { rows: [{ id: 'job-uuid-bc-1', created_at: new Date().toISOString() }] };
    });
    queryMock.mockImplementationOnce(async (sql: string) => {
      expect(sql).toContain('INSERT INTO usage_log');
      return { rows: [] };
    });

    const app = buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/downloads',
      headers: { 'x-api-key': TEST_KEY },
      payload: { source: 'bandcamp', url: REAL_BANDCAMP_TRACK_URL },
    });

    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ job_id: 'job-uuid-bc-1', status: 'queued' });
    expect(queueAddMock).toHaveBeenCalledTimes(1);
    expect(queueAddMock.mock.calls[0][1]).toMatchObject({ jobId: 'job-uuid-bc-1', source: 'bandcamp' });
    expect(queryMock).toHaveBeenCalledTimes(3);
  });

  it.each(REAL_BANDCAMP_ALBUM_URLS)(
    'rejects a real Bandcamp album URL before it ever reaches the queue: %s',
    async (albumUrl) => {
      mockAuthLookup(TEST_API_KEY_ID);
      const app = buildServer();
      const res = await app.inject({
        method: 'POST',
        url: '/v1/downloads',
        headers: { 'x-api-key': TEST_KEY },
        payload: { source: 'bandcamp', url: albumUrl },
      });

      expect(res.statusCode).toBe(400);
      expect(queueAddMock).not.toHaveBeenCalled();
      // Only the auth lookup should have run — no job insert attempted at all.
      expect(queryMock).toHaveBeenCalledTimes(1);
    }
  );
});

describe('GET /v1/downloads/:job_id', () => {
  it('returns 404 when the job does not belong to this API key', async () => {
    mockAuthLookup(OTHER_API_KEY_ID);
    queryMock.mockImplementationOnce(async (sql: string) => {
      expect(sql).toContain('FROM jobs');
      return { rows: [] };
    });

    const app = buildServer();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/downloads/job-uuid-1',
      headers: { 'x-api-key': TEST_KEY },
    });
    expect(res.statusCode).toBe(404);
  });

  it('includes a fresh presigned result_url and detected bpm/key once the job is done', async () => {
    mockAuthLookup(TEST_API_KEY_ID);
    queryMock.mockImplementationOnce(async () => ({
      rows: [
        {
          id: 'job-uuid-1',
          source: 'spotify',
          input_url: 'https://open.spotify.com/track/x',
          status: 'done',
          result_key: 'downloads/job-uuid-1.mp3',
          error: null,
          bpm: 128,
          key_signature: 'A min',
          created_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        },
      ],
    }));

    const app = buildServer();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/downloads/job-uuid-1',
      headers: { 'x-api-key': TEST_KEY },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.result_url).toBe('https://r2.example.com/presigned');
    expect(getDownloadUrlMock).toHaveBeenCalledWith('downloads/job-uuid-1.mp3');
    expect(body.bpm).toBe(128);
    expect(body.key_signature).toBe('A min');
  });

  it('returns bpm/key_signature as null when a done job had detection fail (not a job error)', async () => {
    mockAuthLookup(TEST_API_KEY_ID);
    queryMock.mockImplementationOnce(async () => ({
      rows: [
        {
          id: 'job-uuid-2',
          source: 'spotify',
          input_url: 'https://open.spotify.com/track/y',
          status: 'done',
          result_key: 'downloads/job-uuid-2.mp3',
          error: null,
          bpm: null,
          key_signature: null,
          created_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        },
      ],
    }));

    const app = buildServer();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/downloads/job-uuid-2',
      headers: { 'x-api-key': TEST_KEY },
    });

    const body = res.json();
    expect(res.statusCode).toBe(200);
    expect(body.status).toBe('done');
    expect(body.bpm).toBeNull();
    expect(body.key_signature).toBeNull();
    expect(body.error).toBeUndefined();
  });

  it('omits bpm/key_signature for jobs that are not done yet', async () => {
    mockAuthLookup(TEST_API_KEY_ID);
    queryMock.mockImplementationOnce(async () => ({
      rows: [
        {
          id: 'job-uuid-3',
          source: 'spotify',
          input_url: 'https://open.spotify.com/track/z',
          status: 'processing',
          result_key: null,
          error: null,
          bpm: null,
          key_signature: null,
          created_at: new Date().toISOString(),
          completed_at: null,
        },
      ],
    }));

    const app = buildServer();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/downloads/job-uuid-3',
      headers: { 'x-api-key': TEST_KEY },
    });

    const body = res.json();
    expect(res.statusCode).toBe(200);
    expect(body).not.toHaveProperty('bpm');
    expect(body).not.toHaveProperty('key_signature');
  });
});
