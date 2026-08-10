# @ilovemusic/api

Public download API. Spotify (BYOK), SoundCloud, and Bandcamp are all
implemented and live-verified end-to-end. Bandcamp album/playlist URLs are
rejected — track URLs only. See the repo root (`CLAUDE.md`) for the full
architecture context, and [DEPLOYMENT.md](DEPLOYMENT.md) for running this
in production (Docker images, env vars, migrations, platform trade-offs).
This service itself is not deployed anywhere yet — local development only.

## Manual end-to-end verification

`scripts/verify-e2e.ts` is a manual verification script, not a unit test —
run it once by hand against a **live** server + worker to confirm the full
success path actually works (submit → poll → confirm the file is real).
It's a plain API consumer (X-API-Key only), same as any external caller —
it never touches the database or Spotify credentials directly.

Prerequisites:
- `npm run dev --workspace @ilovemusic/api` (server) and
  `npm run worker:dev --workspace @ilovemusic/api` (worker) both running
- An API key created via `npm run create-api-key --workspace @ilovemusic/api`
- **Spotify only**: credentials already registered for that API key via
  `PUT /v1/spotify-credentials` (from an account with an active Premium
  subscription — see the root conversation/notes on Spotify's Developer
  Mode restrictions). **SoundCloud needs no credentials at all** — it's
  yt-dlp based, not an authenticated API.

Usage:

```bash
export ILOVEMUSIC_API_KEY="ilm_..."
export ILOVEMUSIC_API_BASE_URL="http://localhost:3000"
npm run verify:e2e --workspace @ilovemusic/api -- spotify "https://open.spotify.com/track/<id>"
npm run verify:e2e --workspace @ilovemusic/api -- soundcloud "https://soundcloud.com/<artist>/<track>"
```

Both env vars are required — deliberately not CLI flags or hardcoded values,
so the API key never ends up in shell history or gets committed by accident.

On success it prints total duration, confirmed file size (fetched from the
live `result_url`, not just trusted from the DB), and the detected BPM/key
(`bpm`/`key_signature` in the `GET /v1/downloads/:job_id` response — null is
a valid outcome when detection degrades gracefully, not an error). On
failure (job failed, or timeout after 3 minutes) it prints the real error
and exits non-zero.
