# Health Check

```
GET {{BASE_URL}}/health
```

The only endpoint that does **not** require an `X-API-Key` header. It's intentionally unauthenticated so it can be used as a plain reachability/status check — most usefully here, as a way to confirm you have the instance's **current** base URL before relying on it (see [Getting Started](../README.md#base-url) for why that matters for this particular deployment).

```bash
curl {{BASE_URL}}/health
```

It checks the two stateful dependencies the API relies on — Postgres and Redis — independently, and reports both:

```
200 OK
```
```json
{
  "ok": true,
  "checks": {
    "database": "ok",
    "redis": "ok"
  }
}
```

If either dependency is unreachable, the endpoint reports `503` instead, with the specific check(s) marked `"error"`:

```
503 Service Unavailable
```
```json
{
  "ok": false,
  "checks": {
    "database": "ok",
    "redis": "error"
  }
}
```

No error details, stack traces, or connection strings are ever included in the response — only the `ok`/`error` status per dependency.

### Suggested use

- Before your first request, or after any period of not using the API: confirm `{{BASE_URL}}` still points at a live instance and both dependencies are healthy.
- If you're building an integration that retries on failure, treat a `503` here as "come back later," not as a bug in your request.
