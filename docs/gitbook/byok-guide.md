# BYOK Guide (Spotify)

**BYOK = Bring Your Own Key.** To download from Spotify through this API, you register your own Spotify Developer App credentials. The platform does not hold a shared Spotify app on your behalf.

## Why this exists

Spotify's own API terms make a shared, platform-wide credential impractical for a multi-user download API:

- Apps in **Development Mode** are capped at a small number of allowed users (currently 25) — nowhere near enough for a public API with unknown numbers of callers.
- Moving beyond that cap requires Spotify's **Extended Quota** approval, which in practice expects a large existing user base (historically referenced around 250k MAU) — not something a small self-hosted project can realistically obtain.
- Spotify also now requires the app owner's account to have an active Premium subscription for certain API access.

Rather than hit a hard user ceiling or misrepresent the app's usage to Spotify, each API caller uses their **own** Spotify Developer App instead. Your app, your quota, your credentials — the platform only stores them (encrypted) long enough to make API calls on jobs you submit.

{% hint style="info" %}
This only applies to **metadata**. Spotify is never the source of the actual audio — the API matches the track on YouTube Music (via `spotdl`) and downloads from there. Your Spotify credentials are used exclusively to fetch accurate track/artist/album metadata from Spotify's real Web API.
{% endhint %}

## Step 1 — Create a Spotify Developer App

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and log in with your own Spotify account.
2. Click **Create app**.
3. Fill in a name and description (anything — this app is only used for API access, not shown to end users). For the redirect URI, any placeholder value like `http://127.0.0.1:8080/callback` works — this API only uses the Client Credentials flow, which doesn't redirect anywhere.
4. Once created, open the app's **Settings** to find your **Client ID** and **Client Secret**.

You now have a `client_id` and `client_secret` that belong to you, under your own Spotify account and quota.

## Step 2 — Register them with the API

```
PUT {{BASE_URL}}/v1/spotify-credentials
```

```bash
curl -X PUT {{BASE_URL}}/v1/spotify-credentials \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "client_id": "your_spotify_client_id_here",
    "client_secret": "your_spotify_client_secret_here"
  }'
```

The API validates these live against Spotify before storing anything — if they're wrong, you'll get a `400` explaining why (see [Spotify Credentials](endpoints/spotify-credentials.md) for the full response shapes). Once accepted, your `client_secret` is encrypted at rest and never returned in any future response.

{% hint style="danger" %}
The values above (`your_spotify_client_id_here` / `your_spotify_client_secret_here`) are placeholders. Never paste a real client secret into a shared doc, script committed to version control, or a chat/support thread.
{% endhint %}

## Step 3 — Download

Once registered, `POST /v1/downloads` with `"source": "spotify"` will work using your credentials automatically — you don't pass them again per-request. See [Downloads](endpoints/downloads.md).

If you ever remove your credentials (`DELETE /v1/spotify-credentials`) or they're never registered, Spotify downloads fail fast with a clear `400` rather than queuing a job that can't succeed:

```json
{ "error": "No Spotify credentials registered for this API key. Register yours first via PUT /v1/spotify-credentials." }
```

## FAQ

**Do I need this for SoundCloud or Bandcamp?**
No. Only Spotify requires credentials — see [Source-Specific Notes](source-notes.md).

**Can I use the same Spotify Developer App across multiple API keys?**
Nothing stops you technically, but each API key stores its own copy of the credentials — register them separately per key.

**What can this Spotify app do with my Spotify account?**
Nothing beyond reading public catalog metadata via the Client Credentials flow. It never gets access to your personal library, playlists, or an OAuth user token — it's app-level metadata access only.
