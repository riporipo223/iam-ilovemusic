import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();

vi.mock('../src/db/pool', () => ({
  pool: { query: (...args: unknown[]) => queryMock(...args) },
}));

vi.mock('../src/queue/connection', () => ({
  redisConnection: undefined, // rate-limit plugin falls back to its in-memory store
  downloadsQueue: { add: vi.fn() },
  DOWNLOADS_QUEUE_NAME: 'downloads',
}));

vi.mock('../src/storage/r2', () => ({ getDownloadUrl: vi.fn(), uploadResultFile: vi.fn() }));

const { buildServer } = await import('../src/server');

beforeEach(() => {
  queryMock.mockReset();
});

describe('POST /v1/api-keys', () => {
  it('requires no auth header and returns a plaintext key on success', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ id: 'new-key-id', created_at: '2026-08-14T00:00:00.000Z' }],
    });

    const app = buildServer();
    const res = await app.inject({ method: 'POST', url: '/v1/api-keys', payload: {} });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBe('new-key-id');
    expect(body.key).toMatch(/^ilm_[0-9a-f]{48}$/);

    // Inserted as self_serve, distinct from the operator-only script's inserts.
    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining("'self_serve'"), expect.any(Array));
  });

  it('passes an optional label through to the insert', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ id: 'new-key-id', created_at: '2026-08-14T00:00:00.000Z' }],
    });

    const app = buildServer();
    await app.inject({ method: 'POST', url: '/v1/api-keys', payload: { label: 'cli-user' } });

    expect(queryMock).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining(['cli-user']));
  });

  it('rejects requests over the strict self-serve rate limit, distinct from the general per-key limit', async () => {
    queryMock.mockResolvedValue({
      rows: [{ id: 'new-key-id', created_at: '2026-08-14T00:00:00.000Z' }],
    });

    const app = buildServer();
    // Default self-serve limit is 3/day (config.ts) — well under the general
    // 20/minute limit, so a 4th rapid request here proves this route has its
    // own stricter ceiling, not just inherited the general one.
    for (let i = 0; i < 3; i++) {
      const ok = await app.inject({ method: 'POST', url: '/v1/api-keys', payload: {} });
      expect(ok.statusCode).toBe(201);
    }
    const limited = await app.inject({ method: 'POST', url: '/v1/api-keys', payload: {} });
    expect(limited.statusCode).toBe(429);
  });
});
