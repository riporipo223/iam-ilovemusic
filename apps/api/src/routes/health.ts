import { FastifyInstance } from 'fastify';
import { pool } from '../db/pool';
import { redisConnection } from '../queue/connection';

/**
 * Checks real connectivity, not just "the process is alive" — a load
 * balancer or PaaS health check should route traffic away from an
 * instance that's up but can't reach its database, not just kill it
 * blindly. Returns 503 (not 200) when any dependency is unreachable.
 */
export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async (_request, reply) => {
    const checks: { database: 'ok' | 'error'; redis: 'ok' | 'error' } = {
      database: 'ok',
      redis: 'ok',
    };

    try {
      await pool.query('SELECT 1');
    } catch {
      checks.database = 'error';
    }

    try {
      const pong = await redisConnection.ping();
      if (pong !== 'PONG') throw new Error('unexpected PING response');
    } catch {
      checks.redis = 'error';
    }

    const healthy = checks.database === 'ok' && checks.redis === 'ok';
    return reply.code(healthy ? 200 : 503).send({ ok: healthy, checks });
  });
}
