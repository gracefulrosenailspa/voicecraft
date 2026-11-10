import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';

globalThis.crypto ??= webcrypto;
const source = await readFile(new URL('../relay/worker.js', import.meta.url), 'utf8');
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const { default: worker } = await import(moduleUrl);
const origin = 'https://gracefulrosenailspa.github.io';
const token = 'Bearer voicecraft-test-token';
const originalFetch = globalThis.fetch;
let upstreamCalls = [];
let lastRateKey = '';
globalThis.fetch = async (url, options = {}) => {
  upstreamCalls.push({ url: String(url), method: options.method, headers: new Headers(options.headers || {}) });
  return new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'secret=1' } });
};
const allowed = { RATE_LIMITER: { limit: async ({ key }) => { lastRateKey = key; return { success: true }; } } };
const request = (path, options = {}, requestOrigin = origin) => new Request('https://relay.example' + path, {
  ...options,
  headers: { Origin: requestOrigin, ...(options.headers || {}) }
});
async function expectStatus(req, env, status, message) {
  const response = await worker.fetch(req, env);
  assert.equal(response.status, status, message);
  return response;
}

try {
  await expectStatus(request('/v1/tts', { method: 'POST', headers: { Authorization: token } }, 'https://evil.example'), allowed, 403, 'reject an unapproved origin');
  await expectStatus(request('/v1/tts', { method: 'POST' }), allowed, 401, 'require a bearer token');
  await expectStatus(request('/v1/tts', { method: 'POST', headers: { Authorization: token } }), {}, 503, 'fail closed without the rate limiter');
  await expectStatus(request('/v1/tts', { method: 'GET', headers: { Authorization: token } }), allowed, 405, 'reject unsupported methods');
  await expectStatus(request('/unknown', { method: 'GET', headers: { Authorization: token } }), allowed, 404, 'reject unknown routes');
  const preflight = await expectStatus(request('/v1/tts', { method: 'OPTIONS' }), allowed, 204, 'allow valid CORS preflight');
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), origin, 'preflight returns the configured origin');
  console.log('PASS: relay origin, authentication, method, route and preflight controls');

  const rejected = { RATE_LIMITER: { limit: async () => ({ success: false }) } };
  await expectStatus(request('/v1/tts', { method: 'POST', headers: { Authorization: token }, body: '{}' }), rejected, 429, 'reject rate-limited callers');
  const unavailable = { RATE_LIMITER: { limit: async () => { throw new Error('limiter down'); } } };
  await expectStatus(request('/v1/tts', { method: 'POST', headers: { Authorization: token }, body: '{}' }), unavailable, 503, 'fail closed when the limiter errors');
  console.log('PASS: relay rate limiting and fail-closed behavior');

  upstreamCalls = [];
  const modelResponse = await expectStatus(request('/model?page_size=1', { method: 'GET', headers: { Authorization: token } }), allowed, 200, 'proxy model list');
  assert.equal(modelResponse.headers.get('Cache-Control'), 'no-store', 'upstream response is not cached');
  assert.equal(modelResponse.headers.get('Set-Cookie'), null, 'upstream cookies are not forwarded');
  assert.match(lastRateKey, /^[a-f0-9]{64}$/, 'rate-limit key is a SHA-256 hex digest');
  assert.equal(upstreamCalls[0].headers.get('Authorization'), token, 'bearer token reaches Fish Audio');
  console.log('PASS: authenticated upstream proxy, no-store response and hashed rate-limit key');

  // ElevenLabs routes share the same relay and per-user rate limiting.
  upstreamCalls = [];
  const elevenPreflight = await expectStatus(request('/elevenlabs/v2/voices', { method: 'OPTIONS', headers: { 'Access-Control-Request-Headers': 'xi-api-key' } }), allowed, 204, 'allow ElevenLabs CORS preflight');
  assert.match(elevenPreflight.headers.get('Access-Control-Allow-Headers') || '', /xi-api-key/i, 'CORS allows the ElevenLabs API key header');
  await expectStatus(request('/elevenlabs/v2/voices', { method: 'GET' }), allowed, 401, 'require an ElevenLabs API key');
  const elevenVoices = await expectStatus(request('/elevenlabs/v2/voices?page_size=1', { method: 'GET', headers: { 'xi-api-key': 'voicecraft-eleven-test' } }), allowed, 200, 'proxy ElevenLabs personal voices');
  assert.equal(upstreamCalls[0].url, 'https://api.elevenlabs.io/v2/voices?page_size=1', 'ElevenLabs voice list is forwarded to the correct upstream path');
  assert.equal(upstreamCalls[0].headers.get('xi-api-key'), 'voicecraft-eleven-test', 'ElevenLabs key is forwarded to the provider');
  assert.equal(elevenVoices.headers.get('Cache-Control'), 'no-store', 'ElevenLabs response is not cached');
  console.log('PASS: ElevenLabs CORS, key validation and personal voice-list proxy');

  upstreamCalls = [];
  const elevenLibrary = await expectStatus(request('/elevenlabs/v1/shared-voices?page_size=5', { method: 'GET', headers: { 'xi-api-key': 'voicecraft-eleven-test' } }), allowed, 200, 'proxy ElevenLabs public library');
  assert.equal(upstreamCalls[0].url, 'https://api.elevenlabs.io/v1/shared-voices?page_size=5', 'public library route is forwarded');
  await expectStatus(request('/elevenlabs/v1/text-to-speech/voice_123', { method: 'POST', headers: { 'xi-api-key': 'voicecraft-eleven-test', 'Content-Type': 'application/json' }, body: '{"text":"Hello"}' }), allowed, 200, 'proxy ElevenLabs TTS');
  assert.equal(upstreamCalls[1].url, 'https://api.elevenlabs.io/v1/text-to-speech/voice_123', 'TTS route is forwarded');
  assert.equal(upstreamCalls[1].method, 'POST', 'TTS is forwarded as POST');
  await expectStatus(request('/elevenlabs/v1/text-to-speech/voice_123/extra', { method: 'POST', headers: { 'xi-api-key': 'voicecraft-eleven-test' }, body: '{}' }), allowed, 404, 'reject unapproved ElevenLabs paths');
  console.log('PASS: ElevenLabs public library and text-to-speech routes');


  upstreamCalls = [];
  const form = new FormData();
  form.append('type', 'tts');
  form.append('title', 'Smoke test clone');
  form.append('visibility', 'private');
  form.append('voices', new Blob(['sample audio']), 'sample.wav');
  const cloneResponse = await expectStatus(request('/model', { method: 'POST', headers: { Authorization: token }, body: form }), allowed, 200, 'proxy voice-clone upload');
  assert.equal((await cloneResponse.json()).ok, true, 'clone endpoint returns upstream result');
  assert.equal(upstreamCalls[0].method, 'POST', 'clone upload is forwarded as POST');
  assert.match(upstreamCalls[0].headers.get('Content-Type') || '', /^multipart\/form-data; boundary=/, 'multipart boundary is preserved');
  console.log('PASS: Fish Audio voice-clone upload route forwards multipart data');

  const oversizedTts = new Uint8Array(1024 * 1024 + 1);
  await expectStatus(request('/v1/tts', { method: 'POST', headers: { Authorization: token, 'Content-Type': 'application/json' }, body: oversizedTts }), allowed, 413, 'reject TTS payloads over 1 MiB');
  const oversizedClone = new Uint8Array(25 * 1024 * 1024 + 1);
  await expectStatus(request('/model', { method: 'POST', headers: { Authorization: token, 'Content-Type': 'application/octet-stream' }, body: oversizedClone }), allowed, 413, 'reject clone uploads over 25 MiB');
  await expectStatus(request('/model/voices', { method: 'POST', headers: { Authorization: token }, body: '{}' }), allowed, 405, 'do not allow POST to other model paths');
  console.log('PASS: separate TTS and voice-clone upload limits');

  console.log('VoiceCraft relay smoke tests completed.');
} finally {
  globalThis.fetch = originalFetch;
}