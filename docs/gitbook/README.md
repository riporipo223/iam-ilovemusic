# Getting Started

ILoveMusic downloads tracks from Spotify, SoundCloud, and Bandcamp with clean metadata, automatic BPM detection, and (for Spotify) musical key detection. There are two ways to use it: the **`ilovemusic` CLI** — no HTTP knowledge needed — or the **raw REST API** if you're building your own integration.

## Quick Start via CLI

The fastest way to actually download something. No `curl`, no headers, no polling loops.

```bash
npm install -g @ilovemusic/cli

ilovemusic create-api-key   # registers a key for you, saves it locally
ilovemusic download         # pick a source, paste a URL, done
```

That's it — `download` prompts you for everything else (source, URL, and Spotify credentials the first time you pick Spotify) and saves the finished file to `~/Downloads/ILoveMusic/`. See the [CLI Guide](cli-guide.md) for the full walkthrough, including the Spotify BYOK prompt and troubleshooting.

## Building your own integration?

Everything below, plus the **API Reference** section, documents the raw HTTP API the CLI itself is built on. Use it if you're writing your own script, app, or service against ILoveMusic rather than using the CLI directly.

{% hint style="warning" %}
**This is a self-hosted instance, not a hosted product.** There is no uptime guarantee — see [Limitations & Roadmap](limitations-and-roadmap.md). It's currently live at a stable domain (below), but treat everything on this page as "how the API behaves," not a promise about availability.
{% endhint %}

## Base URL

Every request in this documentation uses the placeholder:

```
{{BASE_URL}}
```

The instance this documentation was written against is `https://api.madebyripo.sbs`, served over a named Cloudflare Tunnel — unlike an ad-hoc Quick Tunnel, this address doesn't change on reconnect or restart. Still, confirm it's live before relying on it, since this remains a self-hosted, no-SLA instance (see [Limitations & Roadmap](limitations-and-roadmap.md)):

```bash
curl {{BASE_URL}}/health
```

A `200` response with `"ok": true` means you have a working, current base URL. See [Health Check](endpoints/health.md) for the full response shape.

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

**Get a key yourself** via `POST /v1/api-keys` — see [API Keys](endpoints/api-keys.md) for the raw request, or just run `ilovemusic create-api-key` if you're using the CLI. That endpoint is unauthenticated by necessity (it's how you get your first key) and is instead protected by a strict per-IP rate limit.

Keep your key out of client-side code, public repos, and chat logs. If a key leaks, register a new one and stop using the old one — there's currently no self-serve revoke endpoint, only creation.

## Rate limiting

Requests are rate-limited per API key (or per IP address for unauthenticated calls, i.e. `/health` and `POST /v1/api-keys`, each with their own separate limit). The default configuration for most endpoints is:

- **20 requests per 1-minute window**

`POST /v1/api-keys` has its own, much stricter default (3 per day per IP) — see [API Keys](endpoints/api-keys.md). An operator can configure different limits for their instance, so treat these as documented defaults rather than a guarantee. When you exceed a limit, you'll get a `429 Too Many Requests` response with a `Retry-After` header telling you how long to wait — see [Error Handling](errors.md).

## A typical flow

1. Get an API key via `POST {{BASE_URL}}/v1/api-keys` (or `ilovemusic create-api-key`).
2. Register your own Spotify Developer App credentials, **only if you plan to download from Spotify** — see [BYOK Guide](byok-guide.md). SoundCloud and Bandcamp need no setup beyond your API key.
3. `POST {{BASE_URL}}/v1/downloads` with a track URL. You get back a `job_id` immediately (`202 Accepted`) — the actual download and processing happen asynchronously.
4. Poll `GET {{BASE_URL}}/v1/downloads/{job_id}` until `status` is `done` or `failed`.
5. On `done`, the response includes a `result_url` you can download the finished file from, plus `bpm` and `key_signature`.

Full request/response details are in [Downloads](endpoints/downloads.md).
