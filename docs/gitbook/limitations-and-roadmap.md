# Limitations & Roadmap

Honest state of the API today, so you can plan around it rather than discover it mid-integration.

## Limitations

**This is a self-hosted instance, not a hosted product.**
There's no uptime SLA, no on-call, no status page. The operator runs it on their own machine. Expect occasional downtime for restarts, updates, or connectivity blips.

**The base URL is not stable.**
The current deployment uses a Cloudflare Quick Tunnel, which assigns a new random `*.trycloudflare.com` address on every (re)connect — including after an unplanned restart, not just a deliberate change. Always confirm your base URL with `GET /health` before relying on it — see [Getting Started](README.md#base-url). If a future deployment moves to a stable domain, this limitation goes away, but don't assume it has without checking.

**No album or playlist support, for any source.**
Every source accepts individual track URLs only. Spotify and SoundCloud playlist/album URLs will simply fail source detection; Bandcamp album/artist pages are explicitly rejected with a clear error (see [Source-Specific Notes](source-notes.md)) rather than silently mis-processed.

**No real-time progress.**
`GET /v1/downloads/{job_id}/events` is a reserved endpoint that currently returns `501 Not Implemented`. The only way to track a job right now is polling `GET /v1/downloads/{job_id}` — there's no push/webhook/SSE mechanism yet.

**No self-serve API key signup.**
Keys are issued manually by the operator. There's no `POST /v1/api-keys` or account system.

**Musical key detection is inconsistent across sources.**
Only Spotify jobs get real audio-analysis key detection. SoundCloud and Bandcamp rely on tags/metadata only, so `key_signature` is frequently `null` for those two sources. This is a genuine capability gap, not a bug — see [Source-Specific Notes](source-notes.md).

**Result URLs expire.**
`result_url` on a completed job is a time-limited presigned link, not a permanent one. Download promptly; re-fetch the job for a fresh link if it expires.

## Roadmap

Nothing here is committed or scheduled — this is a directional list of what would make the most sense to build next, not a promise:

- **SSE progress events** for `GET /v1/downloads/{job_id}/events`, so consumers don't have to poll.
- **Album/playlist support**, likely as a distinct endpoint or job type rather than overloading the single-track flow, given the corruption risk described in [Source-Specific Notes](source-notes.md).
- **A stable base URL**, if the operator moves off the Quick Tunnel to a registered domain with a named Cloudflare Tunnel (or another hosting approach) — this documentation is written so that transition wouldn't change any endpoint behavior, only the value you substitute for `{{BASE_URL}}`.
- **Self-serve API key issuance**, to remove the manual step of asking the operator directly.

If you're building something against this API and one of these gaps blocks you, that's useful signal for the operator — but there's no formal feature-request channel documented here yet.
