import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createApiKey,
  createDownload,
  getJobStatus,
  registerSpotifyCredentials,
  deleteSpotifyCredentials,
  ApiError,
  NetworkError,
  getBaseUrl,
} from '../src/api';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ILOVEMUSIC_API_BASE_URL;
});

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('getBaseUrl', () => {
  it('defaults to the production API', () => {
    expect(getBaseUrl()).toBe('https://api.madebyripo.sbs');
  });

  it('respects ILOVEMUSIC_API_BASE_URL, stripping a trailing slash', () => {
    process.env.ILOVEMUSIC_API_BASE_URL = 'http://localhost:3000/';
    expect(getBaseUrl()).toBe('http://localhost:3000');
  });
});

describe('createApiKey', () => {
  it('posts to /v1/api-keys with no auth header and returns the parsed body', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { id: 'x', key: 'ilm_abc', created_at: 'now' }));

    const result = await createApiKey('my label');

    expect(result.key).toBe('ilm_abc');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.madebyripo.sbs/v1/api-keys');
    expect(init.headers).not.toHaveProperty('X-API-Key');
    expect(JSON.parse(init.body)).toEqual({ label: 'my label' });
  });

  it('throws an ApiError carrying the HTTP status on failure', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(429, { error: 'Too many requests' }));

    await expect(createApiKey()).rejects.toMatchObject(
      new ApiError('Too many requests', 429)
    );
  });
});

describe('createDownload', () => {
  it('sends the API key as X-API-Key', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(202, { job_id: 'job-1', status: 'queued' }));

    await createDownload('ilm_key', 'soundcloud', 'https://soundcloud.com/a/b');

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['X-API-Key']).toBe('ilm_key');
    expect(JSON.parse(init.body)).toEqual({ source: 'soundcloud', url: 'https://soundcloud.com/a/b' });
  });
});

describe('registerSpotifyCredentials', () => {
  it('PUTs client_id/client_secret with the API key header and returns the ok body', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true, client_id: 'abc123' }));

    const result = await registerSpotifyCredentials('ilm_key', 'abc123', 'super-secret');

    expect(result).toEqual({ ok: true, client_id: 'abc123' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.madebyripo.sbs/v1/spotify-credentials');
    expect(init.method).toBe('PUT');
    expect(init.headers['X-API-Key']).toBe('ilm_key');
    expect(JSON.parse(init.body)).toEqual({ client_id: 'abc123', client_secret: 'super-secret' });
  });

  it('surfaces the server rejection message verbatim on a bad pair', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(400, { error: 'Spotify rejected these credentials: invalid_client' })
    );

    await expect(registerSpotifyCredentials('ilm_key', 'bad', 'creds')).rejects.toMatchObject({
      message: 'Spotify rejected these credentials: invalid_client',
      status: 400,
    });
  });
});

describe('deleteSpotifyCredentials', () => {
  it('sends DELETE with the API key header', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    await deleteSpotifyCredentials('ilm_key');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.madebyripo.sbs/v1/spotify-credentials');
    expect(init.method).toBe('DELETE');
    expect(init.headers['X-API-Key']).toBe('ilm_key');
  });

  it('throws an ApiError on failure', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: 'Invalid or revoked API key' }));

    await expect(deleteSpotifyCredentials('bad_key')).rejects.toMatchObject({
      message: 'Invalid or revoked API key',
      status: 401,
    });
  });
});

describe('network-level failures', () => {
  // fetch() itself throwing (DNS failure, connection refused/reset, timeout)
  // is a different failure mode than the server responding with an error
  // status — it should surface as NetworkError with a plain-language
  // message, never the raw "fetch failed" Node throws, and never mistaken
  // for a real server rejection (ApiError).
  it('wraps a raw fetch failure as a NetworkError with a friendly message, not the raw error', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));

    let caught: unknown;
    try {
      await createApiKey();
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(NetworkError);
    expect(caught).not.toBeInstanceOf(ApiError);
  });

  it('the NetworkError message never leaks the raw underlying error text', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));

    try {
      await createApiKey();
      throw new Error('expected createApiKey to reject');
    } catch (err) {
      expect((err as Error).message).not.toContain('fetch failed');
      expect((err as Error).message).toMatch(/couldn't reach the ilovemusic server/i);
    }
  });

  it('applies the same NetworkError wrapping to every endpoint, not just createApiKey', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(createDownload('ilm_key', 'soundcloud', 'https://soundcloud.com/a/b')).rejects.toBeInstanceOf(
      NetworkError
    );

    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(getJobStatus('ilm_key', 'job-1')).rejects.toBeInstanceOf(NetworkError);
  });

  it('still throws a real ApiError, not a NetworkError, when the server actually responds', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { error: 'Bandcamp album/playlist URLs are not yet supported' }));

    let caught: unknown;
    try {
      await createDownload('ilm_key', 'bandcamp', 'https://x.bandcamp.com/album/y');
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ApiError);
    expect(caught).not.toBeInstanceOf(NetworkError);
    expect((caught as Error).message).toBe('Bandcamp album/playlist URLs are not yet supported');
  });
});

describe('getJobStatus', () => {
  it('falls back to a generic message when the error body is not JSON', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('not json');
      },
    } as unknown as Response);

    await expect(getJobStatus('ilm_key', 'job-1')).rejects.toMatchObject({
      message: 'Request failed with HTTP 500',
      status: 500,
    });
  });
});
