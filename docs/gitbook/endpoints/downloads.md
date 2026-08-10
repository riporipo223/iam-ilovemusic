# Downloads

The core of the API: submit a track URL, get a job back, poll it until it's done.

All endpoints on this page require an `X-API-Key` header — see [Getting Started](../README.md#authentication).

## Create a download job

```
POST {{BASE_URL}}/v1/downloads
```

### Body

| Field | Type | Required | Description |
|---|---|---|---|
| `source` | `string` | Yes | One of `spotify`, `soundcloud`, `bandcamp` |
| `url` | `string` | Yes | The track URL to download |

```bash
curl -X POST {{BASE_URL}}/v1/downloads \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "source": "spotify",
    "url": "https://open.spotify.com/track/47iKV0KlcvlflSsrCPD3TQ"
  }'
```

### Success response

```
202 Accepted
```

```json
{
  "job_id": "123e4567-e89b-12d3-a456-426614174000",
  "status": "queued"
}
```

The job now exists and is queued for processing. Use `job_id` to poll for its result — see below.

### Validation

Requests are validated in this order; the first failing check is the one you'll see in the response. All validation errors are `400 Bad Request`:

| Condition | Message |
|---|---|
| `url` missing | `'url' is required` |
| `source` missing | `'source' is required` |
| `url` doesn't look like a track URL for the given `source` | `` 'url' does not look like a valid {source} track URL `` |
| `source` isn't one of the supported values | `` source '{source}' is not supported yet `` |
| `source` is `bandcamp` and the URL is an album/artist page, not a single track | `Bandcamp album/playlist URLs are not yet supported — submit an individual track URL (path containing /track/).` |
| `source` is `spotify` and this API key has no Spotify credentials registered | `No Spotify credentials registered for this API key. Register yours first via PUT /v1/spotify-credentials.` |

The Bandcamp and Spotify checks are source-specific — see [Source-Specific Notes](../source-notes.md) for why each exists.

## Check a job's status

```
GET {{BASE_URL}}/v1/downloads/{job_id}
```

```bash
curl {{BASE_URL}}/v1/downloads/123e4567-e89b-12d3-a456-426614174000 \
  -H "X-API-Key: YOUR_API_KEY"
```

A job can only be read by the API key that created it — requesting a `job_id` that doesn't exist, or that belongs to a different key, returns `404`:

```json
{ "error": "Job not found" }
```

### Response shape

The base fields are always present:

```json
{
  "job_id": "123e4567-e89b-12d3-a456-426614174000",
  "source": "spotify",
  "status": "processing",
  "created_at": "2026-08-10T09:00:00.000Z",
  "completed_at": null
}
```

`status` moves through: `queued` → `processing` → `done` or `failed`. Poll this endpoint until it's one of the terminal states.

**When `status` is `done`**, the response additionally includes:

| Field | Notes |
|---|---|
| `result_url` | A time-limited download URL for the processed file. Only present if the file was successfully stored. |
| `bpm` | Detected tempo. |
| `key_signature` | Detected musical key — **may be `null`**, especially for SoundCloud/Bandcamp. This is expected, not an error; see [Source-Specific Notes](../source-notes.md). |

```json
{
  "job_id": "123e4567-e89b-12d3-a456-426614174000",
  "source": "spotify",
  "status": "done",
  "created_at": "2026-08-10T09:00:00.000Z",
  "completed_at": "2026-08-10T09:00:42.000Z",
  "result_url": "https://.../signed-download-link",
  "bpm": 128.0,
  "key_signature": "A minor"
}
```

`result_url` is a presigned link with a limited lifetime — download it promptly rather than caching it long-term. If it expires, re-fetch the job to get a fresh one.

**When `status` is `failed`**, and an error was recorded, the response includes:

```json
{
  "job_id": "123e4567-e89b-12d3-a456-426614174000",
  "source": "soundcloud",
  "status": "failed",
  "created_at": "2026-08-10T09:00:00.000Z",
  "completed_at": "2026-08-10T09:00:12.000Z",
  "error": "..."
}
```

## Job progress events

```
GET {{BASE_URL}}/v1/downloads/{job_id}/events
```

Reserved for a future server-sent-events progress stream. Currently returns:

```
501 Not Implemented
```
```json
{ "error": "SSE progress events are not implemented yet" }
```

Poll `GET /v1/downloads/{job_id}` instead until this is available.
