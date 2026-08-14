# Spotify Credentials

{% hint style="info" %}
Looking for the simplest way to use ILoveMusic? See the [CLI Guide](../cli-guide.md) instead — `ilovemusic download` prompts for your Spotify Client ID/Secret inline the first time you need them and calls this endpoint for you. This page is for developers building their own integration.
{% endhint %}

Manages your **own** Spotify Developer App credentials, used only for Spotify downloads. See the [BYOK Guide](../byok-guide.md) for why this exists and how to create the credentials in the first place — this page is the endpoint reference.

Both endpoints require an `X-API-Key` header, and act on the credentials attached to that key only.

## Register or update your credentials

```
PUT {{BASE_URL}}/v1/spotify-credentials
```

### Body

| Field | Type | Required |
|---|---|---|
| `client_id` | `string` | Yes |
| `client_secret` | `string` | Yes |

```bash
curl -X PUT {{BASE_URL}}/v1/spotify-credentials \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "client_id": "your_spotify_client_id_here",
    "client_secret": "your_spotify_client_secret_here"
  }'
```

{% hint style="danger" %}
Never put a real `client_secret` in a script you commit, share, or paste into a chat. Treat it like a password — it's yours, generated in your own Spotify Developer Dashboard, and the API only ever stores it encrypted.
{% endhint %}

### What happens on submit

The credentials are validated **live against Spotify** before anything is saved — the API fetches a known track's metadata using the client ID/secret you provided. If Spotify rejects them, nothing is stored:

```
400 Bad Request
```
```json
{ "error": "Spotify rejected these credentials: <reason from Spotify>" }
```

If both fields are missing or empty:

```
400 Bad Request
```
```json
{ "error": "'client_id' and 'client_secret' are both required" }
```

If validation succeeds, the secret is encrypted at rest and associated with your API key:

```
200 OK
```
```json
{ "ok": true, "client_id": "your_spotify_client_id_here" }
```

Note that `client_secret` is **never** echoed back — this response is the only confirmation you get that it was saved. If you lose it, you'll need to re-register (Spotify lets you view/regenerate your client secret from your own Developer Dashboard at any time).

Registering new credentials overwrites any previously registered ones for this API key.

## Remove your credentials

```
DELETE {{BASE_URL}}/v1/spotify-credentials
```

```bash
curl -X DELETE {{BASE_URL}}/v1/spotify-credentials \
  -H "X-API-Key: YOUR_API_KEY"
```

Clears any stored Spotify credentials for this API key.

```
200 OK
```
```json
{ "ok": true }
```

After this, `POST /v1/downloads` with `source: "spotify"` will fail with the "no Spotify credentials registered" error until you register new ones. SoundCloud and Bandcamp downloads are unaffected — they never used these credentials.
