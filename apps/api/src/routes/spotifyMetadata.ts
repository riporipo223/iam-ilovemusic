import { FastifyInstance } from 'fastify';
import { extractSpotifyTrackId, fetchSpotifyTrackMetadata } from '@ilovemusic/engine';
import { config } from '../config';
import { requireApiKey } from '../auth';

interface SpotifyMetadataQuery {
  url?: string;
}

/**
 * Proxies official Spotify Web API metadata using the *platform's own*
 * credentials (config.platformSpotify — not BYOK). Exists so the desktop
 * app can fetch title/artist/album/artwork/duration for a Spotify track
 * without holding a Spotify Client Secret locally at all — previously
 * bundled in the packaged .dmg, which is extractable from its asar.
 *
 * Deliberately metadata-only: the desktop app's own spotdl invocation does
 * the actual audio download/matching and doesn't need Spotify credentials
 * for that step (verified against spotdl's own source — it only requires
 * them when --use-official-api/--auth-token/--user-auth/--use-cache-file
 * are passed, none of which this app ever passes).
 */
export async function spotifyMetadataRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireApiKey);

  app.get<{ Querystring: SpotifyMetadataQuery }>(
    '/v1/spotify-metadata',
    {
      // Personal/limited use (the desktop app calling home for its own
      // Spotify metadata) — tighter than the platform default, but not so
      // tight that a normal browsing session trips it.
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const { url } = request.query ?? {};

      if (!url || typeof url !== 'string') {
        return reply.code(400).send({ error: "'url' query parameter is required" });
      }

      const trackId = extractSpotifyTrackId(url);
      if (!trackId) {
        return reply.code(400).send({ error: "'url' does not look like a valid Spotify track URL" });
      }

      const { clientId, clientSecret } = config.platformSpotify;
      if (!clientId || !clientSecret) {
        request.log.error('GET /v1/spotify-metadata called but PLATFORM_SPOTIFY_CLIENT_ID/SECRET are not configured');
        return reply.code(500).send({ error: 'Spotify metadata proxy is not configured on this server' });
      }

      try {
        const metadata = await fetchSpotifyTrackMetadata(trackId, { clientId, clientSecret });
        return reply.send(metadata);
      } catch (err) {
        const message = (err as Error).message || 'Unknown error';
        if (message.includes('not found')) {
          return reply.code(404).send({ error: 'Spotify track not found' });
        }
        request.log.error({ err }, 'Spotify metadata fetch failed');
        return reply.code(502).send({ error: `Failed to fetch Spotify metadata: ${message}` });
      }
    }
  );
}
