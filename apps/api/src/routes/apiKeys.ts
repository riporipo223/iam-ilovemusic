import { FastifyInstance } from 'fastify';
import { pool } from '../db/pool';
import { generateApiKey } from '../apiKeys';
import { config } from '../config';

interface CreateApiKeyBody {
  label?: string;
}

/**
 * Self-serve counterpart to scripts/create-api-key.ts. That script has
 * direct DB access and is operator-only; this route is what an end user
 * (e.g. the CLI's `create-api-key` command) hits instead. Deliberately no
 * auth — it's how a caller gets their first key — so it relies entirely on
 * the strict per-IP rate limit below, not on requireApiKey.
 */
export async function apiKeysRoutes(app: FastifyInstance) {
  app.post<{ Body: CreateApiKeyBody }>(
    '/v1/api-keys',
    {
      config: {
        rateLimit: {
          max: config.selfServeApiKeyRateLimit.max,
          timeWindow: config.selfServeApiKeyRateLimit.window,
          // Override the server-wide keyGenerator (which prefers X-API-Key)
          // — there is never one on this route, so it would silently fall
          // through to IP anyway, but pinning it to IP explicitly here
          // means this route's rate limit can never accidentally key off
          // anything else if the global default ever changes.
          keyGenerator: (request) => request.ip,
        },
      },
    },
    async (request, reply) => {
      const label = typeof request.body?.label === 'string' ? request.body.label : null;

      const { plaintext, hash } = generateApiKey();

      const result = await pool.query<{ id: string; created_at: string }>(
        `INSERT INTO api_keys (key_hash, label, created_via) VALUES ($1, $2, 'self_serve')
         RETURNING id, created_at`,
        [hash, label]
      );
      const row = result.rows[0];

      return reply.code(201).send({
        id: row.id,
        key: plaintext,
        created_at: row.created_at,
        note: 'Store this key now — it will not be shown again.',
      });
    }
  );
}
