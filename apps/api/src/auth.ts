import { FastifyReply, FastifyRequest } from 'fastify';
import { pool } from './db/pool';
import { hashApiKey } from './apiKeys';

declare module 'fastify' {
  interface FastifyRequest {
    apiKeyId?: string;
  }
}

/**
 * Fastify preHandler: requires a valid `X-API-Key` header, looked up by its
 * SHA-256 hash (indexed, deterministic — see apiKeys.ts for why that's safe
 * for high-entropy random tokens). Attaches `request.apiKeyId` on success.
 */
export async function requireApiKey(request: FastifyRequest, reply: FastifyReply) {
  const key = request.headers['x-api-key'];
  if (!key || typeof key !== 'string') {
    return reply.code(401).send({ error: 'Missing X-API-Key header' });
  }

  const hash = hashApiKey(key);
  const result = await pool.query<{ id: string }>(
    'SELECT id FROM api_keys WHERE key_hash = $1 AND revoked_at IS NULL',
    [hash]
  );

  if (result.rows.length === 0) {
    return reply.code(401).send({ error: 'Invalid or revoked API key' });
  }

  request.apiKeyId = result.rows[0].id;
}
