const DEFAULT_BASE_URL = 'https://api.madebyripo.sbs';

export function getBaseUrl(): string {
  return (process.env.ILOVEMUSIC_API_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, '');
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status?: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

export interface CreateApiKeyResult {
  id: string;
  key: string;
  created_at: string;
}

export async function createApiKey(label?: string): Promise<CreateApiKeyResult> {
  const res = await fetch(`${getBaseUrl()}/v1/api-keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label }),
  });
  if (!res.ok) {
    throw new ApiError(await readErrorMessage(res, `Request failed with HTTP ${res.status}`), res.status);
  }
  return (await res.json()) as CreateApiKeyResult;
}

export interface CreateDownloadResult {
  job_id: string;
  status: string;
}

export async function createDownload(apiKey: string, source: string, url: string): Promise<CreateDownloadResult> {
  const res = await fetch(`${getBaseUrl()}/v1/downloads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
    body: JSON.stringify({ source, url }),
  });
  if (!res.ok) {
    throw new ApiError(await readErrorMessage(res, `Request failed with HTTP ${res.status}`), res.status);
  }
  return (await res.json()) as CreateDownloadResult;
}

export interface RegisterSpotifyCredentialsResult {
  ok: true;
  client_id: string;
}

/**
 * PUT /v1/spotify-credentials validates the pair against Spotify itself
 * before persisting (see apps/api/src/routes/spotifyCredentials.ts), so a
 * non-ok response here is a real, user-facing rejection (bad credentials,
 * account not Premium, etc.) — surface err.message to the user as-is.
 */
export async function registerSpotifyCredentials(
  apiKey: string,
  clientId: string,
  clientSecret: string
): Promise<RegisterSpotifyCredentialsResult> {
  const res = await fetch(`${getBaseUrl()}/v1/spotify-credentials`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret }),
  });
  if (!res.ok) {
    throw new ApiError(await readErrorMessage(res, `Request failed with HTTP ${res.status}`), res.status);
  }
  return (await res.json()) as RegisterSpotifyCredentialsResult;
}

export async function deleteSpotifyCredentials(apiKey: string): Promise<void> {
  const res = await fetch(`${getBaseUrl()}/v1/spotify-credentials`, {
    method: 'DELETE',
    headers: { 'X-API-Key': apiKey },
  });
  if (!res.ok) {
    throw new ApiError(await readErrorMessage(res, `Request failed with HTTP ${res.status}`), res.status);
  }
}

export interface JobStatus {
  job_id: string;
  source: string;
  status: 'queued' | 'processing' | 'done' | 'failed';
  created_at: string;
  completed_at: string | null;
  result_url?: string;
  error?: string;
  bpm?: number | null;
  key_signature?: string | null;
}

export async function getJobStatus(apiKey: string, jobId: string): Promise<JobStatus> {
  const res = await fetch(`${getBaseUrl()}/v1/downloads/${jobId}`, {
    headers: { 'X-API-Key': apiKey },
  });
  if (!res.ok) {
    throw new ApiError(await readErrorMessage(res, `Request failed with HTTP ${res.status}`), res.status);
  }
  return (await res.json()) as JobStatus;
}
