import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { config, assertRuntimeConfig } from './config';
import { redisConnection } from './queue/connection';
import { apiKeysRoutes } from './routes/apiKeys';
import { downloadsRoutes } from './routes/downloads';
import { healthRoutes } from './routes/health';
import { spotifyCredentialsRoutes } from './routes/spotifyCredentials';
import { spotifyMetadataRoutes } from './routes/spotifyMetadata';

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
  app.register(apiKeysRoutes);
  app.register(downloadsRoutes);
  app.register(spotifyCredentialsRoutes);
  app.register(spotifyMetadataRoutes);

  return app;
}

async function main() {
  assertRuntimeConfig();
  const app = buildServer();
  await app.listen({ port: config.port, host: config.host });

  // Container platforms send SIGTERM on redeploy/scale-down and expect the
  // process to stop accepting new connections, finish in-flight requests,
  // then exit — not die mid-request. app.close() does exactly that
  // (Fastify waits for open connections/requests to drain).
  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info(`${signal} received, closing server...`);
    try {
      await app.close();
      app.log.info('Server closed cleanly.');
      process.exit(0);
    } catch (err) {
      app.log.error(err, 'Error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Failed to start API server:', err);
    process.exit(1);
  });
}
