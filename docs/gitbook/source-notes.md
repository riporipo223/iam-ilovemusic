# Source-Specific Notes

The three sources (`spotify`, `soundcloud`, `bandcamp`) share one API surface, but they don't behave identically underneath. Knowing the differences up front avoids confusing "bugs" that are actually expected behavior.

## Spotify

- **Requires BYOK credentials** registered via `PUT /v1/spotify-credentials` before any Spotify job can be submitted — see the [BYOK Guide](byok-guide.md).
- Metadata (title, artist, album, artwork) comes from Spotify's real Web API, using your credentials.
- The audio itself is **not** sourced from Spotify — it's matched against YouTube Music and downloaded from there, with a raw YouTube search as a fallback if that match fails.
- Musical key detection is real audio analysis (via `librosa`) and is generally reliable — this is the only source that gets this treatment.

## SoundCloud

- **No credentials needed.** Just your API key.
- Uses `yt-dlp` directly — there's no official SoundCloud API involved, and the URL itself doubles as validation: if `yt-dlp` can't extract track info from it, the job fails.
- BPM detection falls back through several signals in order (tags → description → title → embedded audio metadata → audio analysis), so it's usually populated.
- **`key_signature` is very often `null`.** Key detection for this source only looks at tags, description, and embedded metadata — there's no audio-analysis fallback for key the way there is for Spotify. A `null` key on an otherwise-successful job is expected, not an error.

## Bandcamp

- **No credentials needed.** Just your API key.
- Also uses `yt-dlp` directly, sharing the same underlying extraction and fallback logic as SoundCloud.
- Same BPM/key behavior as SoundCloud: BPM is usually populated, `key_signature` is often `null`.
- **Only individual track URLs are accepted** — URLs pointing at an album or artist page are rejected up front with a `400`:

  ```json
  { "error": "Bandcamp album/playlist URLs are not yet supported — submit an individual track URL (path containing /track/)." }
  ```

  This isn't an arbitrary restriction: `yt-dlp` treats a Bandcamp album/artist page as a playlist and would try to download every track on it into the single output slot one job expects, producing a corrupt or incomplete result. Look for a URL containing `/track/` — that's the shape this API accepts.

## Quick comparison

| | Spotify | SoundCloud | Bandcamp |
|---|---|---|---|
| Credentials required | Yes (BYOK) | No | No |
| Metadata source | Spotify Web API | `yt-dlp` | `yt-dlp` |
| Audio source | YouTube Music (matched), YouTube search fallback | Direct | Direct |
| Key detection | Real audio analysis, usually populated | Tags/metadata only, often `null` | Tags/metadata only, often `null` |
| URL restrictions | — | — | Track URLs only, no albums/playlists |
