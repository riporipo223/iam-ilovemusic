# Limitations & Roadmap

Honest state of the API today, so you can plan around it rather than discover it mid-integration.

## Limitations

**This is a self-hosted instance, not a hosted product.**
There's no uptime SLA, no on-call, no status page. The operator runs it on their own machine. Expect occasional downtime for restarts, updates, or connectivity blips.

**The base URL is stable, but not guaranteed to stay reachable.**
The current deployment is served over a named Cloudflare Tunnel on a real domain (`api.madebyripo.sbs`), which — unlike an ad-hoc Quick Tunnel — doesn't change on reconnect or restart. Still worth confirming with `GET /health` before relying on it in anything unattended, since this remains a self-hosted, no-SLA instance (see the first limitation above) — see [Getting Started](README.md#base-url).

**No album or playlist support, for any source.**
Every source accepts individual track URLs only. Spotify and SoundCloud playlist/album URLs will simply fail source detection; Bandcamp album/artist pages are explicitly rejected with a clear error (see [Source-Specific Notes](source-notes.md)) rather than silently mis-processed.

**No real-time progress.**
`GET /v1/downloads/{job_id}/events` is a reserved endpoint that currently returns `501 Not Implemented`. The only way to track a job right now is polling `GET /v1/downloads/{job_id}` — there's no push/webhook/SSE mechanism yet.

**No account system beyond key creation itself.**
`POST /v1/api-keys` lets you self-serve a new key (rate-limited per IP — see [API Keys](endpoints/api-keys.md)), but there's no way to list your own keys, rename one, or revoke one yourself yet. If a key leaks, register a new one and stop using the old one.

**Musical key detection is inconsistent across sources.**
Only Spotify jobs get real audio-analysis key detection. SoundCloud and Bandcamp rely on tags/metadata only, so `key_signature` is frequently `null` for those two sources. This is a genuine capability gap, not a bug — see [Source-Specific Notes](source-notes.md).

**Result URLs expire.**
`result_url` on a completed job is a time-limited presigned link, not a permanent one. Download promptly; re-fetch the job for a fresh link if it expires.

## Roadmap

Nothing here is committed or scheduled — this is a directional list of what would make the most sense to build next, not a promise:

- **SSE progress events** for `GET /v1/downloads/{job_id}/events`, so consumers don't have to poll.
- **Album/playlist support**, likely as a distinct endpoint or job type rather than overloading the single-track flow, given the corruption risk described in [Source-Specific Notes](source-notes.md).
- **Self-serve key management** — listing/renaming/revoking your own keys, beyond just creating new ones.

If you're building something against this API and one of these gaps blocks you, that's useful signal for the operator — but there's no formal feature-request channel documented here yet.
