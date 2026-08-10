import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
const pingMock = vi.fn();

vi.mock('../src/db/pool', () => ({ pool: { query: (...args: unknown[]) => queryMock(...args) } }));
// @fastify/rate-limit's RedisStore also gets handed this object (server.ts
// registers it with `redis: redisConnection`). At construction it calls
// defineCommand('rateLimit', ...) — real ioredis dynamically attaches a
// working method for that; this fake mimics that instead of just stubbing
// defineCommand as a no-op, otherwise the *next* request-time call to
// redis.rateLimit(...) throws (RedisStore.prototype.incr) and every request
// in this file 500s, not just the ones actually exercising the mock.
const redisConnectionMock: Record<string, unknown> = {
  ping: (...args: unknown[]) => pingMock(...args),
  defineCommand(name: string) {
    redisConnectionMock[name] = (...args: unknown[]) => {
      const callback = args[args.length - 1] as (err: Error | null, result?: unknown) => void;
      callback(null, [1, 1000]); // [current count, ttl ms] — comfortably under any limit
    };
  },
};

vi.mock('../src/queue/connection', () => ({
  redisConnection: redisConnectionMock,
  downloadsQueue: { add: vi.fn() },
  DOWNLOADS_QUEUE_NAME: 'downloads',
}));
vi.mock('../src/storage/r2', () => ({ getDownloadUrl: vi.fn(), uploadResultFile: vi.fn() }));

const { buildServer } = await import('../src/server');

beforeEach(() => {
  queryMock.mockReset();
  pingMock.mockReset();
});

describe('GET /health', () => {
  it('returns 200 and ok:true when database and redis are both reachable', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    pingMock.mockResolvedValueOnce('PONG');

    const app = buildServer();
    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, checks: { database: 'ok', redis: 'ok' } });
  });

  it('returns 503 when the database is unreachable, without crashing the request', async () => {
    queryMock.mockRejectedValueOnce(new Error('connection refused'));
    pingMock.mockResolvedValueOnce('PONG');

    const app = buildServer();
    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ ok: false, checks: { database: 'error', redis: 'ok' } });
  });

  it('returns 503 when redis is unreachable', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    pingMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const app = buildServer();
    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ ok: false, checks: { database: 'ok', redis: 'error' } });
  });
});
