# VoiceCraft Fish Audio relay setup

The relay in `relay/worker.js` is intentionally fail-closed. It returns HTTP 503 until a Cloudflare Rate Limiting binding named `RATE_LIMITER` is configured. Do not remove that check to make the relay appear to work: an unrestricted relay can be abused.

## Configure the required Cloudflare binding

Cloudflare's Workers Rate Limiting API is configured through the Worker's Wrangler configuration. It is not a normal dashboard-only variable.

Add this to the existing `wrangler.toml` for the Worker that runs `relay/worker.js`:

```toml
[[ratelimits]]
name = "RATE_LIMITER"
# Replace this with a positive integer unique to your Cloudflare account.
namespace_id = "REPLACE_WITH_YOUR_OWN_UNIQUE_INTEGER"

  [ratelimits.simple]
  limit = 20
  period = 60
```

Do not deploy until you replace the placeholder with a unique numeric namespace ID for your Cloudflare account. Keep any existing Worker name, entry-point, compatibility date, and other settings in your current Wrangler configuration. The `main` entry must point to `relay/worker.js` (or to the actual path you use for this Worker).

Then deploy the Worker using Wrangler from the directory containing that configuration. If you do not currently use Wrangler to deploy this Worker, stop and check the current deployment method before changing it. Do not create a second Worker by accident.

Cloudflare's Worker Rate Limiting API is approximate and enforced separately in each Cloudflare location. Requests may exceed the configured threshold briefly. It is useful abuse protection, not a strict global quota. For strict global limits, Cloudflare recommends a Durable Object-based limiter. See the [Cloudflare Rate Limiting documentation](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).

## What the relay enforces

- Only the configured VoiceCraft GitHub Pages origin is allowed by the browser CORS policy.
- Only `GET /model`, `GET /model/*`, `POST /model` for voice cloning, and `POST /v1/tts` are accepted.
- A Fish Audio bearer token is required.
- The bearer token is SHA-256 hashed before being used as the rate-limit key. The raw token is not logged or stored by this Worker.
- Text-to-speech request bodies are limited to 1 MiB. Fish Audio voice-cloning uploads to `POST /model` are limited to 25 MiB. Both limits are enforced while streaming, even when Content-Length is missing or inaccurate.
- Requests are not cached.
- Missing or unavailable rate limiting fails closed with HTTP 503.

**Important:** an Origin header is not authentication. Non-browser clients can forge it. The rate-limit binding is therefore required, not optional. The relay forwards the user's own Fish Audio bearer token; it does not provide a shared VoiceCraft API key.

## Verify after deployment

From VoiceCraft, enter your own Fish Audio key and test:
1. Load the Fish Audio voice/model list.
2. Generate a short narration.
3. Generate a longer narration that is split into multiple sections.
4. Upload an eligible voice sample and create a private Fish Audio clone through the relay.
5. Confirm that invalid credentials return a useful provider error.
6. Confirm that oversized TTS and clone uploads are rejected with HTTP 413.
7. Confirm that the relay returns HTTP 503 if the rate-limit binding is unavailable, and HTTP 429 after the configured limit is exceeded.

Do not publish the relay address as production-ready until these checks pass. Monitor Worker logs and traces for HTTP 429 and 5xx responses.
