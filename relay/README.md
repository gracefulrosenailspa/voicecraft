# VoiceCraft Cloudflare relay setup

The shared relay in `relay/worker.js` supports Fish Audio and ElevenLabs. It is fail-closed and returns HTTP 503 until a Cloudflare Rate Limiting binding named `RATE_LIMITER` is configured.

## Configure the required Cloudflare binding

Add this to the existing Worker's `wrangler.toml`:

```toml
[[ratelimits]]
name = "RATE_LIMITER"
# Replace with a positive integer unique to your Cloudflare account.
namespace_id = "REPLACE_WITH_YOUR_OWN_UNIQUE_INTEGER"

  [ratelimits.simple]
  limit = 20
  period = 60
```

Keep the existing Worker name, compatibility date and other settings. The entry point must be `relay/worker.js`. Do not create a second Worker if one already exists. Replace the placeholder namespace ID before deployment.

## Configure VoiceCraft

Deploy the Worker, then paste its base URL into VoiceCraft's **Cloudflare relay address** field. Use the same address for both providers. The frontend routes ElevenLabs requests through the `/elevenlabs` prefix.

Allowed browser origins:
- `https://gracefulrosenailspa.github.io`
- `https://voicecraft-preview-kpp1gw.v2.appdeploy.ai`

If the website moves, add its exact origin to `ALLOWED_ORIGINS` and review CORS.

## Routes and protections

- Fish Audio: `GET /model`, `GET /model/*`, `POST /model` for cloning, `POST /v1/tts`.
- ElevenLabs: `GET /elevenlabs/v2/voices`, `GET /elevenlabs/v1/shared-voices`, `POST /elevenlabs/v1/text-to-speech/{voice_id}`, `POST /elevenlabs/v1/voices/add`.
- Every request requires the user's own provider key.
- The key is forwarded to the chosen provider but not logged or stored by this Worker. A SHA-256 digest of provider plus key is used for rate limiting.
- TTS bodies are limited to 1 MiB; voice-cloning uploads to 25 MiB, enforced while streaming.
- Responses are not cached and upstream cookies are removed.
- Missing or unavailable rate limiting fails closed with HTTP 503. Rate limiting may return HTTP 429.

**Origin checks are CORS protection, not authentication.** Non-browser clients can forge Origin headers. The rate-limit binding is mandatory abuse protection, not a strict global quota.

## Verify after deployment

Test both providers: load personal voices, search the public library, generate a real preview, generate multi-section narration, check invalid keys, and test cloning only with voices you own or have permission to use. Confirm 503 without the rate-limit binding and 429 when limited. Do not treat the relay as production-ready until these checks pass.
