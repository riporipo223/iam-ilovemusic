# @ilovemusic/cli

Interactive command-line client for the ILoveMusic public API
([`apps/api`](../api)) — download tracks from Spotify, SoundCloud, and
Bandcamp without touching curl, HTTP headers, or job polling directly.
Talks to `https://api.madebyripo.sbs` by default (override with
`ILOVEMUSIC_API_BASE_URL`, e.g. for local development against
`apps/api`).

Distribution: this ships as an npm package (`npm install -g
@ilovemusic/cli`) for now — no compiled binary yet. See the repo's
CHANGELOG for the npm-vs-binary trade-off this was decided against.

## Commands

### `ilovemusic create-api-key`

Registers a new API key for yourself against the public, unauthenticated
`POST /v1/api-keys` endpoint (see `apps/api/src/routes/apiKeys.ts`) and
saves it to a local config file at an OS-conventional location (via
`env-paths`, no suffix):

- macOS: `~/Library/Preferences/ilovemusic/config.json`
- Linux: `$XDG_CONFIG_HOME/ilovemusic/config.json` (or `~/.config/ilovemusic/config.json`)
- Windows: `%APPDATA%\ilovemusic\Config\config.json`

That endpoint has no auth by design (it's how you get your first key) —
it's protected instead by a strict per-IP rate limit (3/day by default,
see `config.selfServeApiKeyRateLimit` in `apps/api/src/config.ts`), not
email/CAPTCHA verification. If you already have a key saved elsewhere,
reuse it instead of generating a new one.

If a key is already saved locally, this command asks for confirmation
before overwriting it.

### `ilovemusic download`

Prompts for a source (Spotify / SoundCloud / Bandcamp) and a track URL,
submits it to `POST /v1/downloads`, polls `GET /v1/downloads/:job_id`
with a live status spinner, then downloads the finished file into
`~/Downloads/ILoveMusic/` (created automatically).

The filename is `artist - title.mp3`, read from the file's own embedded
ID3 tags after download — the job-status API response doesn't carry
artist/title (`packages/engine` embeds that metadata into the file
itself, not into the job record). Falls back to a generic name if tags
are missing, and never overwrites an existing file of the same name
(appends ` (2)`, etc.).

**Spotify BYOK, asked for inline, not after a failed submit.** Picking
"Spotify" as the source checks a local flag (`spotifyCredentialsRegistered`
in the config file, set after a successful registration — there's no `GET
/v1/spotify-credentials` to check live status against the server). If
unset, you're prompted for your Spotify Client ID (plain text) and Client
Secret (masked input via `@clack/prompts`' `password()`, never echoed or
logged) before the URL prompt, and `PUT /v1/spotify-credentials` validates
the pair against Spotify itself — a bad pair or non-Premium account is
rejected with the server's real message, and you can retry or cancel
without restarting the whole `download` command. SoundCloud/Bandcamp never
trigger this — they need no credentials.

Because the flag is local-only, it can go stale if credentials were
registered/removed through another client (e.g. curl). Run `ilovemusic
spotify-logout` to reset it — it clears the flag *and* calls `DELETE
/v1/spotify-credentials`, so it's a real reset, not just hiding local
drift.

### `ilovemusic spotify-logout`

Removes your registered Spotify credentials from the server and clears
the local `spotifyCredentialsRegistered` flag. The next Spotify download
will ask for credentials again.

## Development

```bash
npm run dev --workspace @ilovemusic/cli -- create-api-key
npm run build --workspace @ilovemusic/cli
npm run typecheck --workspace @ilovemusic/cli
npm test --workspace @ilovemusic/cli
```

## Manual end-to-end verification

`scripts/verify-e2e.ts` exercises the CLI's real modules (`src/api.ts`,
`src/config.ts`, `src/util/sanitizeFilename.ts`) directly against a live
API — the same code the interactive commands call — since
`@clack/prompts`' raw keypress reading doesn't work over piped,
non-interactive stdin. It does not exercise the interactive prompt UI
itself; try the real commands in a terminal for that.

It also verifies `registerSpotifyCredentials`/`deleteSpotifyCredentials`
against the live server, but only the *rejection* path (a deliberately
bogus pair) and the idempotent-delete path — it has no real Spotify
Developer App credentials to test a successful registration with, and the
interactive prompt/retry-loop in `download.ts`'s `ensureSpotifyCredentials`
needs a real terminal regardless. **Try this by hand**: run `ilovemusic
download`, pick Spotify, and go through the Client ID/Secret prompts with
real credentials — confirm the secret is never echoed to the terminal,
that a bad pair shows the server's real rejection message and lets you
retry, and that a successful registration continues straight to the URL
prompt without restarting the command.

Each full run of this script creates one self-serve API key, counting
against the same strict per-IP daily limit `create-api-key` uses — don't
run it more than a couple of times a day.

```bash
npm run verify:e2e --workspace @ilovemusic/cli
# Bandcamp is skipped unless you provide a track URL (shares its
# implementation with SoundCloud in packages/engine, so the SoundCloud
# case is representative):
CLI_TEST_BANDCAMP_URL="https://artist.bandcamp.com/track/..." npm run verify:e2e --workspace @ilovemusic/cli
```
