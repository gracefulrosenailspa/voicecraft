# VoiceCraft Studio

A browser-based text-to-speech and voice-processing studio. The front end is a static site with no build step or application server requirement.

## Features

- **Narrate Studio:** write or paste a script, split long narration into sections, choose a speech engine and generate audio.
- **Device voices:** use speech synthesis voices available in the current browser and operating system.
- **Puter voices:** generate narration through Puter's browser SDK. This requires an internet connection and the provider's current browser integration.
- **Fish Audio and ElevenLabs:** use your own provider API key to select voices and generate narration.
- **Voice Lab:** load an audio recording, preview depth, warmth and room effects, export a processed WAV, or send the recording to a supported voice-cloning / re-voice provider.
- **Downloads:** download generated sections individually and, when provider audio can be fetched by the browser, export a combined narration WAV.
- **WAV safety:** combined narration and Voice Lab exports are limited to 32 MiB to reduce mobile browser memory pressure. For longer output, download generated sections individually.
- **Install icons:** includes 192px and 512px PNG icons for Chromium installation, plus the scalable SVG brand icon.

## Run and deploy

The front end is plain HTML, CSS and JavaScript.

1. Serve the repository root from a static web host, or use GitHub Pages.
2. Use HTTPS. Service workers and browser audio APIs require a secure context, except for localhost development.
3. Keep index.html, manifest.webmanifest, icon.svg, service-worker.js and the icons directory together at the deployed app root.
4. Do not deploy relay/worker.js as part of the static site. It is a separate Cloudflare Worker.

For GitHub Pages, enable deployment from the intended branch and root folder in the repository's Pages settings. The app uses relative paths so it can live under a project path such as /voicecraft/.

## Offline and install behavior

The service worker caches only the app shell: the home page, HTML entry point, web manifest and app icons. It does not cache generated audio, uploaded recordings, scripts, API keys, relay traffic or provider responses.

Offline access means the interface can reopen after it has been cached. Cloud speech generation, voice lists, cloning, re-voice and provider downloads still need an internet connection. The Puter SDK and other remote resources may also be unavailable offline.

On a supported mobile browser, open the HTTPS site and use the browser's Install app or Add to Home screen option if offered. Browser and operating-system install prompts vary.

When changing shell assets, increment CACHE_NAME in service-worker.js so clients replace the previous shell cache.

## Privacy and API keys

- Narration scripts and app settings are saved in the current browser's local storage.
- Provider keys are held in page memory by default. If Remember keys on this device is enabled, keys are stored in that browser's local storage. Local storage is not encrypted. Do not enable key remembering on a shared or untrusted device.
- The app sends a provider key to the provider selected by the user. For Fish Audio, requests may be routed through the user's configured relay.
- Fish Audio voice cloning can also use the configured relay. The relay accepts clone uploads up to 25 MiB; larger recordings are rejected before they are forwarded.
- Voice Lab cloning and re-voice upload the selected recording to the chosen provider. Only upload voices you own or have permission to use, and review the provider's retention and privacy terms.
- Clearing browser site data removes locally saved scripts, settings and remembered keys.

## Fish Audio relay

The optional relay is a separate Cloudflare Worker in relay/worker.js. It is not ready for production until the required RATE_LIMITER binding is configured.

Read relay/README.md before deploying. The Worker intentionally returns HTTP 503 if the binding is missing. Do not remove the fail-closed behavior to make an unconfigured relay appear functional.

The current relay allows browser requests from the VoiceCraft GitHub Pages origin. If the front end moves to another domain, update the allow-listed origin in the Worker and review the CORS policy before deployment.

## Developer checks

The front end has no build step. With Node.js 22 or later, run the static checks:

    node --check service-worker.js
    node --check relay/worker.js
    node scripts/relay-smoke.mjs
    node scripts/validate.mjs

To run the browser smoke suite locally, install Playwright and Chromium, start a static server in the repository root, then run the test:

    npm install --no-save --no-package-lock playwright
    npx playwright install chromium
    python3 -m http.server 4173 --bind 127.0.0.1
    node scripts/browser-smoke.mjs

The browser suite checks app startup, narration editing, mocked Puter generation and combined WAV export, Voice Lab decode and processed WAV export, mocked re-voice, stale-download cleanup, mobile viewport layout and offline app-shell reopening. Provider calls are mocked; this does not verify real account access or billing.

GitHub Actions runs static checks, relay security tests and browser smoke tests on pushes to main and on pull requests targeting main.

## Known testing boundary

Before treating a release as production-ready, test on real browsers and devices:

- Chrome on Android and desktop, plus Safari on iOS and macOS where available.
- Device speech voices and voice-loading behavior.
- Puter, Fish Audio and ElevenLabs generation, including invalid keys, provider outages and long multi-section scripts.
- Combined WAV export, Voice Lab effects and processed WAV export.
- Voice cloning consent, upload limits, provider responses and privacy disclosures.
- PWA installation, first-load caching, offline shell behavior and service-worker updates.
- The deployed Cloudflare relay with its real rate-limit binding, including expected 429 and fail-closed 503 responses.

Static checks cannot verify provider account access, API compatibility, audio quality, mobile memory limits or deployed Cloudflare configuration.