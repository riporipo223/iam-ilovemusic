import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { config, assertRuntimeConfig } from './config';
import { redisConnection } from './queue/connection';
import { downloadsRoutes } from './routes/downloads';
import { healthRoutes } from './routes/health';
import { spotifyCredentialsRoutes } from './routes/spotifyCredentials';

export function buildServer() {
  const app = Fastify({
    logger: {
      transport: process.env.NODE_ENV === 'production' ? undefined : { target: 'pino-pretty' },
    },
  });

  app.register(rateLimit, {
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.window,
    redis: redisConnection,
    // Rate-limit per API key when present, falling back to IP for
    // unauthenticated requests (e.g. repeated bad-key attempts).
    keyGenerator: (request) => (request.headers['x-api-key'] as string | undefined) ?? request.ip,
  });

  app.register(healthRoutes);
  app.register(downloadsRoutes);
  app.register(spotifyCredentialsRoutes);

  return app;
}

async function main() {
  assertRuntimeConfig();
  const app = buildServer();
  await app.listen({ port: config.port, host: config.host });
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Failed to start API server:', err);
    process.exit(1);
  });
}
