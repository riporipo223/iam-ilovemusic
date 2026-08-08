import { FastifyInstance } from 'fastify';
import { pool } from '../db/pool';
import { requireApiKey } from '../auth';
import { downloadsQueue } from '../queue/connection';
import { getDownloadUrl } from '../storage/r2';
import { detectUrlSource, isBandcampTrackUrl } from '@ilovemusic/engine';

const SUPPORTED_SOURCES = new Set(['spotify', 'soundcloud', 'bandcamp']);

interface CreateDownloadBody {
  source?: string;
  url?: string;
}

interface JobRow {
  id: string;
  source: string;
  input_url: string;
  status: string;
  result_key: string | null;
  error: string | null;
  bpm: number | null;
  key_signature: string | null;
  created_at: string;
  completed_at: string | null;
}

export async function downloadsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireApiKey);

  app.post<{ Body: CreateDownloadBody }>('/v1/downloads', async (request, reply) => {
    const { source, url } = request.body ?? {};

    if (!url || typeof url !== 'string') {
      return reply.code(400).send({ error: "'url' is required" });
    }
    if (!source || typeof source !== 'string') {
      return reply.code(400).send({ error: "'source' is required" });
    }

    const detected = detectUrlSource(url);
    if (detected === 'unknown' || detected !== source) {
      return reply.code(400).send({ error: `'url' does not look like a valid ${source} track URL` });
    }
    if (!SUPPORTED_SOURCES.has(source)) {
      return reply.code(400).send({ error: `source '${source}' is not supported yet` });
    }

    // Bandcamp album/playlist guard: main.js has no URL-shape branching for
    // Bandcamp (track vs. album routing is done by the desktop UI picking a
    // different IPC channel, not by parsing the URL), so a non-track URL
    // reaching the worker would make yt-dlp attempt to download an entire
    // album into this job's single expected output file — corrupt/undefined
    // behavior, not just "unsupported". Reject before the job is ever queued.
    if (source === 'bandcamp' && !isBandcampTrackUrl(url)) {
      return reply.code(400).send({
        error: 'Bandcamp album/playlist URLs are not yet supported — submit an individual track URL (path containing /track/).',
      });
    }

    const apiKeyId = request.apiKeyId!;

    if (source === 'spotify') {
      const creds = await pool.query<{ spotify_client_id: string | null }>(
        'SELECT spotify_client_id FROM api_keys WHERE id = $1',
        [apiKeyId]
      );
      if (!creds.rows[0]?.spotify_client_id) {
        return reply.code(400).send({
          error: 'No Spotify credentials registered for this API key. Register yours first via PUT /v1/spotify-credentials.',
        });
      }
    }

    const insertResult = await pool.query<{ id: string; created_at: string }>(
      `INSERT INTO jobs (api_key_id, source, input_url, status)
       VALUES ($1, $2, $3, 'queued')
       RETURNING id, created_at`,
      [apiKeyId, source, url]
    );
    const job = insertResult.rows[0];

    await downloadsQueue.add(
      'download',
      { jobId: job.id, apiKeyId, source: source as 'spotify' | 'soundcloud' | 'bandcamp', url },
      { jobId: job.id }
    );

    await pool.query(`INSERT INTO usage_log (api_key_id, job_id, event) VALUES ($1, $2, 'job_created')`, [
      apiKeyId,
      job.id,
    ]);

    return reply.code(202).send({ job_id: job.id, status: 'queued' });
  });

  app.get<{ Params: { job_id: string } }>('/v1/downloads/:job_id', async (request, reply) => {
    const { job_id } = request.params;
    const apiKeyId = request.apiKeyId!;

    const result = await pool.query<JobRow>(
      `SELECT id, source, input_url, status, result_key, error, bpm, key_signature, created_at, completed_at
       FROM jobs WHERE id = $1 AND api_key_id = $2`,
      [job_id, apiKeyId]
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'Job not found' });
    }

    const job = result.rows[0];
    const response: Record<string, unknown> = {
      job_id: job.id,
      source: job.source,
      status: job.status,
      created_at: job.created_at,
      completed_at: job.completed_at,
    };

    if (job.status === 'done') {
      if (job.result_key) {
        response.result_url = await getDownloadUrl(job.result_key);
      }
      // Present but possibly null — detection can degrade gracefully on a
      // successful job (see packages/engine), which is a real result, not
      // a missing field.
      response.bpm = job.bpm;
      response.key_signature = job.key_signature;
    }
    if (job.status === 'failed' && job.error) {
      response.error = job.error;
    }

    return reply.send(response);
  });

  // Scaffold only — real-time progress lands in a later phase. Structured now
  // so the route/auth/job-lookup plumbing doesn't need to change later.
  app.get<{ Params: { job_id: string } }>('/v1/downloads/:job_id/events', async (_request, reply) => {
    return reply.code(501).send({ error: 'SSE progress events are not implemented yet' });
  });
}
