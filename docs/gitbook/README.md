# Getting Started

The ILoveMusic API is a job-based download service: you submit a track URL from Spotify, SoundCloud, or Bandcamp, poll until the job finishes, and download the processed result — audio file plus metadata, BPM, and (where available) musical key.

It sits on top of the same download/processing engine used by the ILoveMusic desktop app, exposed as a plain HTTP API so it can be used from anywhere, not just the Electron app.

{% hint style="warning" %}
**This is a self-hosted instance, not a hosted product.** There is no fixed domain and no uptime guarantee — see [Limitations & Roadmap](limitations-and-roadmap.md). Treat everything below as "how the API behaves," and get the actual base URL from whoever operates the instance you're using.
{% endhint %}

## Base URL

Every request in this documentation uses the placeholder:

```
{{BASE_URL}}
```

Replace it with the actual address of the instance you're calling. **Never assume a fixed or previously-seen URL still works** — this instance is currently exposed via a [Cloudflare Quick Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/), which hands out a new random `https://<random-words>.trycloudflare.com` address every time the tunnel process (re)connects, including after crashes or restarts — not just on a planned change.

Once you have a candidate base URL, confirm it's live and correct by calling the unauthenticated health check:

```bash
curl {{BASE_URL}}/health
```

A `200` response with `"ok": true` means you have a working, current base URL. See [Health Check](endpoints/health.md) for the full response shape. If this instance later moves to a stable domain (named Cloudflare Tunnel or otherwise), that will be reflected in how `{{BASE_URL}}` is communicated to you — the API's request/response behavior documented here does not change either way.

## Authentication

Every endpoint except `GET /health` requires an API key, sent as a header:

```
X-API-Key: <your-api-key>
```

Requests without a valid key are rejected before any other processing happens:

| Situation | Status | Body |
|---|---|---|
| Header missing | `401` | `{"error": "Missing X-API-Key header"}` |
| Key invalid or revoked | `401` | `{"error": "Invalid or revoked API key"}` |

**API keys are issued manually by the operator** — there is currently no self-serve signup or API endpoint to create one. Ask the operator of the instance you're using for a key.

Keep your key out of client-side code, public repos, and chat logs. If a key leaks, ask the operator to revoke it and issue a new one — a leaked key lets anyone submit jobs and read results under your quota.

## Rate limiting

Requests are rate-limited per API key (or per IP address for unauthenticated calls to `/health`, which itself isn't limited beyond that). The default configuration is:

- **20 requests per 1-minute window**

An operator can configure a different limit for their instance, so treat this as the documented default rather than a guarantee. When you exceed the limit, you'll get a `429 Too Many Requests` response with a `Retry-After` header telling you how long to wait — see [Error Handling](errors.md).

## A typical flow

1. Register your own Spotify Developer App credentials, **only if you plan to download from Spotify** — see [BYOK Guide](byok-guide.md). SoundCloud and Bandcamp need no setup beyond your API key.
2. `POST {{BASE_URL}}/v1/downloads` with a track URL. You get back a `job_id` immediately (`202 Accepted`) — the actual download and processing happen asynchronously.
3. Poll `GET {{BASE_URL}}/v1/downloads/{job_id}` until `status` is `done` or `failed`.
4. On `done`, the response includes a `result_url` you can download the finished file from, plus `bpm` and `key_signature`.

Full request/response details are in [Downloads](endpoints/downloads.md).
