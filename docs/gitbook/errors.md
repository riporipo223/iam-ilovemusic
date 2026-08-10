# Error Handling

Errors are returned as JSON with an `error` field describing what went wrong. This page lists every error response the API can currently return, grouped by status code.

## 400 Bad Request

Request was well-formed but invalid in some way. The message tells you exactly what to fix.

| Endpoint | Message |
|---|---|
| `POST /v1/downloads` | `'url' is required` |
| `POST /v1/downloads` | `'source' is required` |
| `POST /v1/downloads` | `'url' does not look like a valid {source} track URL` |
| `POST /v1/downloads` | `source '{source}' is not supported yet` |
| `POST /v1/downloads` | `Bandcamp album/playlist URLs are not yet supported — submit an individual track URL (path containing /track/).` |
| `POST /v1/downloads` | `No Spotify credentials registered for this API key. Register yours first via PUT /v1/spotify-credentials.` |
| `PUT /v1/spotify-credentials` | `'client_id' and 'client_secret' are both required` |
| `PUT /v1/spotify-credentials` | `Spotify rejected these credentials: <reason>` |

These are all client-side fixes — correct the request and retry.

## 401 Unauthorized

Applies to every endpoint except `GET /health`.

| Situation | Message |
|---|---|
| `X-API-Key` header missing | `Missing X-API-Key header` |
| Key doesn't match any active key, or has been revoked | `Invalid or revoked API key` |

If you're getting this unexpectedly, double-check the header name (`X-API-Key`, not `Authorization`) and ask the operator whether your key is still active.

## 404 Not Found

| Endpoint | Situation | Message |
|---|---|---|
| `GET /v1/downloads/{job_id}` | Job doesn't exist, or belongs to a different API key | `Job not found` |

Jobs are scoped to the API key that created them — you cannot look up another key's job even with a valid `job_id`.

## 429 Too Many Requests

Returned when you exceed the rate limit for your API key (see [Getting Started](README.md#rate-limiting)). The response includes a `Retry-After` header indicating how long to wait before your next request will be accepted. Back off and retry after that interval rather than retrying immediately.

## 501 Not Implemented

| Endpoint | Message |
|---|---|
| `GET /v1/downloads/{job_id}/events` | `SSE progress events are not implemented yet` |

This is a reserved-for-later endpoint, not an error in your request. Use `GET /v1/downloads/{job_id}` to poll for status instead.

## 503 Service Unavailable

| Endpoint | Situation |
|---|---|
| `GET /health` | Postgres and/or Redis is unreachable |

Indicates an operator-side infrastructure problem, not something wrong with your request. See [Health Check](endpoints/health.md) for the response shape.

## Errors that don't come back as a clean status

If a job fails *after* being accepted — for example, the source track was removed, or processing hit an unrecoverable error — you won't see it as an HTTP error at all. `POST /v1/downloads` already returned `202` and a `job_id`. Instead, poll `GET /v1/downloads/{job_id}` and check for `"status": "failed"`, with details in the `error` field if one was recorded. See [Downloads](endpoints/downloads.md).
