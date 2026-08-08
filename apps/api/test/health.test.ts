import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/db/pool', () => ({ pool: { query: vi.fn() } }));
vi.mock('../src/queue/connection', () => ({
  redisConnection: undefined,
  downloadsQueue: { add: vi.fn() },
  DOWNLOADS_QUEUE_NAME: 'downloads',
}));
vi.mock('../src/storage/r2', () => ({ getDownloadUrl: vi.fn(), uploadResultFile: vi.fn() }));

const { buildServer } = await import('../src/server');

describe('GET /health', () => {
  it('returns ok', async () => {
    const app = buildServer();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});
