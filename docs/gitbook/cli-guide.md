# CLI Guide

`ilovemusic` is an interactive command-line client for the ILoveMusic public API — it wraps every HTTP call, job-status poll, and file save shown in the [API Reference](endpoints/downloads.md) behind three commands. If you just want to download music and don't care how the API works underneath, this page is all you need.

Runs on macOS, Linux, and Windows (it only talks HTTP — no `ffmpeg`/`spotdl`/`yt-dlp` install required, unlike the desktop app).

## Installation

```bash
npm install -g @ilovemusic/cli
```

Requires Node.js 20 or later. There's no compiled/standalone binary yet — see the project's `CHANGELOG.md` for why npm was chosen first.

## `ilovemusic create-api-key`

Registers a new API key for yourself and saves it locally so every other command can use it automatically.

```bash
ilovemusic create-api-key
```

You'll be asked for an optional label (just for your own reference — press Enter to skip it), then the key is created and saved.

**This is self-serve** — it calls the public, unauthenticated `POST /v1/api-keys` endpoint directly (see [API Keys](endpoints/api-keys.md)). Because that endpoint has no login of its own, it's protected by a strict rate limit instead:

- **3 new keys per day, per IP address.**

If you hit it, the CLI tells you plainly:

> Rate limit hit: only a few keys can be created per network per day. If you already have a key saved elsewhere, reuse it instead of requesting a new one.

**Where the key is saved** — an OS-conventional config location, not inside this repo or your project folder:

| OS | Path |
|---|---|
| macOS | `~/Library/Preferences/ilovemusic/config.json` |
| Linux | `$XDG_CONFIG_HOME/ilovemusic/config.json` (or `~/.config/ilovemusic/config.json`) |
| Windows | `%APPDATA%\ilovemusic\Config\config.json` |

If you run `create-api-key` again while a key is already saved, it asks for confirmation before overwriting:

> A key is already saved at `<path>`. Replace it with a new one?

Answering no keeps the existing key untouched.

## `ilovemusic download`

The main command. Fully interactive — no flags to remember.

```bash
ilovemusic download
```

1. **Pick a source** — Spotify, SoundCloud, or Bandcamp.
2. **Spotify only, first time**: you'll be asked for your Spotify Developer App credentials — see [Spotify BYOK in the CLI](#spotify-byok-in-the-cli) below. SoundCloud and Bandcamp skip straight to the next step; they need no credentials at all.
3. **Paste the track URL.**
4. The CLI submits the job and shows a live spinner while it polls, updating roughly every 3 seconds: `Status: processing (12s elapsed)`.
5. Once the job finishes, the file downloads automatically into `~/Downloads/ILoveMusic/` (created for you if it doesn't exist), named `Artist - Title.mp3` — read from the downloaded file's own embedded metadata, not typed by you. If a file with that name already exists, a numbered suffix is added (`Artist - Title (2).mp3`) rather than overwriting it.
6. A summary is printed:
   ```
   File:     Artist - Title.mp3
   Saved to: /Users/you/Downloads/ILoveMusic/Artist - Title.mp3
   Size:     6.50 MB
   BPM:      128
   Key:      A minor
   ```
   BPM/Key show `not detected` rather than blank when detection didn't produce a value — see [Source-Specific Notes](source-notes.md) for why that's expected for some sources, not a bug.

If you haven't run `create-api-key` yet, `download` tells you so and exits rather than failing with a raw HTTP error:

> No API key found. Run `ilovemusic create-api-key` first, then try again.

**Polling has a 5-minute timeout.** If a job hasn't finished by then, the CLI stops waiting and says so — the job may still complete on the server; check again later rather than assuming it failed:

> Job `<id>` did not finish within 300s. It may still complete server-side.

If the job itself fails (not a CLI-side error — the server reports `status: "failed"`), the CLI prints the server's own error message.

## Spotify BYOK in the CLI

Spotify downloads need your own Spotify Developer App credentials (BYOK — see the [BYOK Guide](byok-guide.md) for why). The CLI handles this **inline**, the first time you pick Spotify as a source, instead of letting you paste a URL and then fail:

1. A short explanation prints, with a link to create a Spotify Developer App if you don't have one:
   > Spotify requires your own Developer App credentials (BYOK) — the platform doesn't hold a shared one. Create one at `https://developer.spotify.com/dashboard` if you haven't (requires an active Premium subscription).
2. You're prompted for your **Client ID** (typed normally).
3. Then your **Client Secret** — this input is **masked**, never shown or echoed to the terminal, and never logged anywhere by the CLI.
4. The credentials are validated live against Spotify's own API before anything is saved. If they're rejected (typo, wrong pair, account not on Premium), the CLI shows Spotify's real rejection reason and asks: **Try again?** — answering yes re-prompts both fields; answering no cancels the download entirely, no partial state left behind.
5. Once accepted, you won't be asked again — every future Spotify download in that terminal profile skips straight to the URL prompt.

This only has to happen once per machine (technically: once per locally-saved API key) — the CLI remembers that credentials were registered successfully and doesn't ask again.

## `ilovemusic spotify-logout`

Resets the "Spotify credentials registered" state — both locally and on the server:

```bash
ilovemusic spotify-logout
```

This calls `DELETE /v1/spotify-credentials` for your key, then clears the local flag that makes `download` skip the BYOK prompt. Use it when:

- You want to register a **different** Spotify Developer App (rotate credentials).
- Your credentials were removed on the server through some other means (e.g. a raw `curl DELETE` call) and the CLI doesn't know that yet — it would otherwise keep skipping the prompt, assuming credentials still exist, and your next Spotify download would fail server-side instead.

After running it, the next Spotify download in `ilovemusic download` will ask for Client ID/Secret again, exactly like the first time.

If you haven't created an API key yet, it tells you so rather than failing:

> No API key found. Run `ilovemusic create-api-key` first.

## Troubleshooting

Real messages the CLI can show you, and what they actually mean — not a guess, pulled from the CLI's own source:

| Message | What's happening | What to do |
|---|---|---|
| `No API key found. Run 'ilovemusic create-api-key' first, then try again.` | `download` (or `spotify-logout`) ran with no saved config. | Run `ilovemusic create-api-key` once. |
| `Rate limit hit: only a few keys can be created per network per day.` | You (or someone on the same network) already created 3 keys today. | Reuse an existing saved key instead of creating another. |
| `A key is already saved at <path>. Replace it with a new one?` | You ran `create-api-key` again on top of an existing one. | Answer no to keep the existing key; yes only if you actually want to replace it. |
| `Spotify rejected these credentials: <reason>` | Your Client ID/Secret pair failed live validation against Spotify. | Re-check them in your Spotify Developer Dashboard — common causes are a typo, or the app owner's account not having active Premium. |
| `Job <id> did not finish within 300s. It may still complete server-side.` | Processing (especially Spotify, which can retry a YouTube match) took longer than the CLI's 5-minute poll window. | Wait and check again — this isn't necessarily a failure, just a timeout on the CLI's side. |
| `Downloaded audio file not found for track: <title>` / `No YouTube results found for "<query>"` | The job itself failed server-side — the track couldn't be matched/downloaded from any source. | See [Source-Specific Notes](source-notes.md) — for Spotify specifically, this can be a genuine YouTube search-content limitation for certain tracks, not always a bug. |
| `No Spotify credentials registered for this API key. Register yours first via PUT /v1/spotify-credentials.` | Rare — the local "registered" flag said yes but the server disagreed (e.g. credentials were deleted through another client). | Run `ilovemusic spotify-logout` to resync, then try the download again. |

For anything not listed here, the CLI generally prints the API's own error message verbatim — see [Error Handling](errors.md) for the full list of what the underlying API can return.
