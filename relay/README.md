# VoiceCraft Fish Audio relay setup

The relay in `relay/worker.js` is intentionally fail-closed. It will return HTTP 503 until a Cloudflare Rate Limiting binding named `RATE_LIMITER` is configured. Do not remove that check to make the relay appear to work: an unrestricted relay can be abused.

## Configure the required Cloudflare binding

1. Open **Cloudflare Dashboard → Workers & Pages**.
2. Open the Worker that serves as your VoiceCraft Fish Audio relay.
3. Open **Settings → Bindings** and add a **Rate limiting** binding.
4. Set the variable name to exactly `RATE_LIMITER`.
5. Choose a unique numeric namespace ID for this Cloudflare account. Do not copy an ID from another account or Worker.
6. Set the limit to **20 requests per 60 seconds** as a starting point.
7. Save the binding and deploy a new Worker version containing the updated `relay/worker.js`.

Cloudflare's Worker Rate Limiting API is approximate and is enforced per Cloudflare location. It is useful abuse protection, but it is not a strict global quota. See the [Cloudflare Rate Limiting documentation](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).

## What the relay enforces

- Only the configured VoiceCraft GitHub Pages origin is allowed by the browser CORS policy.
- Only `GET /model`, `GET /model/*`, and `POST /v1/tts` are accepted.
- A Fish Audio bearer token is required.
- The bearer token is SHA-256 hashed before being used as the rate-limit key. The raw token is not logged or stored by this Worker.
- Requests are limited to 1 MiB, including streamed bodies without a trustworthy Content-Length header.
- Requests are not cached.
- Missing or unavailable rate limiting fails closed with HTTP 503.

**Important:** an Origin header is not authentication. Non-browser clients can forge it. The rate-limit binding is therefore required, not optional. The relay forwards the user's own Fish Audio bearer token; it does not provide a shared VoiceCraft API key.

## Verify after deployment

From VoiceCraft, enter your own Fish Audio key and test:
1. Load the Fish Audio voice/model list.
2. Generate a short narration.
3. Generate a longer narration that is split into multiple sections.
4. Confirm that invalid credentials return a useful provider error.
5. Confirm that the relay rejects requests when the rate-limit binding is removed or unavailable.

Do not publish the relay address as production-ready until these checks pass. Cloudflare rate limits are approximate, so monitor Worker analytics for HTTP 429 and 5xx responses.
