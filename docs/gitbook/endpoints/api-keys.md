# API Keys

{% hint style="info" %}
Looking for the simplest way to use ILoveMusic? See the [CLI Guide](../cli-guide.md) instead — `ilovemusic create-api-key` does everything on this page for you. This page is for developers building their own integration.
{% endhint %}

Self-serve creation of a new API key. This is the only key-management endpoint currently exposed over HTTP — there's no way to list, rename, or revoke a key yourself yet (see [Limitations & Roadmap](../limitations-and-roadmap.md)).

## Create an API key

```
POST {{BASE_URL}}/v1/api-keys
```

**No `X-API-Key` header** — this is the one endpoint besides `GET /health` that doesn't require one, since it's how you get your first key at all. It's protected instead by a strict per-IP rate limit (see below).

### Body

| Field | Type | Required | Description |
|---|---|---|---|
| `label` | `string` | No | A name to help you recognize this key later. Not shown to anyone else. |

```bash
curl -X POST {{BASE_URL}}/v1/api-keys \
  -H "Content-Type: application/json" \
  -d '{"label": "my laptop"}'
```

`label` is entirely optional — an empty body (`-d '{}'`) works too.

### Success response

```
201 Created
```

```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "key": "ilm_0000000000000000000000000000000000000000000000",
  "created_at": "2026-08-10T09:00:00.000Z",
  "note": "Store this key now — it will not be shown again."
}
```

{% hint style="danger" %}
**`key` is shown exactly once, in this response.** It's stored server-side only as a one-way hash — if you lose the plaintext value, there is no way to recover it. Register a new key instead.
{% endhint %}

Use the `key` value as your `X-API-Key` header on every other endpoint from here on — see [Getting Started](../README.md#authentication).

### Rate limiting — stricter than every other endpoint

This endpoint has its **own, separate rate limit** from the general per-API-key limit documented in [Getting Started](../README.md#rate-limiting), because it has no API key to key off of yet — it's limited per IP address instead:

- **3 requests per 1-day window, per IP** (operator-configurable; treat this as the documented default)

Exceeding it returns the standard rate-limit response:

```
429 Too Many Requests
```

If you already have a key saved somewhere, reuse it rather than requesting a new one — this limit exists specifically to keep key creation cheap to abuse-proof, not to limit how many *downloads* you can do (that's the general per-key limit, which is much higher).

### Where this key came from

Keys created this way are tagged internally as self-serve, distinct from keys an operator mints directly via database access — both work identically for every other endpoint. There's no functional difference to you as a caller.
