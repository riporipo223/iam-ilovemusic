import { FastifyInstance } from 'fastify';
import { fetchSpotifyTrackMetadata } from '@ilovemusic/engine';
import { pool } from '../db/pool';
import { requireApiKey } from '../auth';
import { encryptSecret } from '../credentialsCrypto';

interface RegisterCredentialsBody {
  client_id?: string;
  client_secret?: string;
}

// A well-known public track ID used purely as an API probe. Token
// acquisition alone isn't a sufficient check — Spotify's "owner must have
// Premium" restriction rejects the *data* endpoints (GET /v1/tracks/:id),
// not the token endpoint, so a credential pair can mint a token fine and
// still fail on every real download job. This fetch is what actually proves
// the pair works end-to-end.
const PROBE_TRACK_ID = '47iKV0KlcvlflSsrCPD3TQ';

export async function spotifyCredentialsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireApiKey);

  app.put<{ Body: RegisterCredentialsBody }>('/v1/spotify-credentials', async (request, reply) => {
    const { client_id, client_secret } = request.body ?? {};

    if (!client_id || typeof client_id !== 'string' || !client_secret || typeof client_secret !== 'string') {
      return reply.code(400).send({ error: "'client_id' and 'client_secret' are both required" });
    }

    // Validate against Spotify itself before persisting — catches typos and
    // "owner isn't Premium" failures at registration time instead of
    // silently failing every download job later.
    try {
      await fetchSpotifyTrackMetadata(PROBE_TRACK_ID, { clientId: client_id, clientSecret: client_secret });
    } catch (err) {
      return reply.code(400).send({
        error: `Spotify rejected these credentials: ${(err as Error).message}`,
      });
    }

    const encrypted = encryptSecret(client_secret);

    await pool.query(
      `UPDATE api_keys
       SET spotify_client_id = $2, spotify_client_secret_encrypted = $3, spotify_credentials_updated_at = now()
       WHERE id = $1`,
      [request.apiKeyId, client_id, encrypted]
    );

    return reply.send({ ok: true, client_id });
  });

  app.delete('/v1/spotify-credentials', async (request, reply) => {
    await pool.query(
      `UPDATE api_keys
       SET spotify_client_id = NULL, spotify_client_secret_encrypted = NULL, spotify_credentials_updated_at = NULL
       WHERE id = $1`,
      [request.apiKeyId]
    );
    return reply.send({ ok: true });
  });
}
