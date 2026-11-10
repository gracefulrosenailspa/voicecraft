// VoiceCraft shared Cloudflare Worker relay for Fish Audio and ElevenLabs.
//
// Required Worker binding:
//   RATE_LIMITER: Cloudflare Rate Limiting binding (recommended: 20 requests / 60 seconds).
//
// The browser Origin check is CORS protection, NOT authentication. Each request
// must carry the user's own provider API key. The Worker hashes that key for
// rate limiting and never logs or stores it.

const ALLOWED_ORIGINS = new Set([
  'https://gracefulrosenailspa.github.io',
  'https://voicecraft-preview-kpp1gw.v2.appdeploy.ai'
]);
const FISH_API = 'https://api.fish.audio';
const ELEVEN_API = 'https://api.elevenlabs.io';
const MAX_TTS_BODY_BYTES = 1024 * 1024;
const MAX_CLONE_BODY_BYTES = 25 * 1024 * 1024;

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, model, xi-api-key',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}
function response(message, status, cors) {
  return new Response(message, { status, headers: { ...cors, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
}
async function readLimitedBody(body, maxBytes) {
  if (!body) return new Uint8Array();
  const reader = body.getReader(), chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { await reader.cancel(); throw new Error('BODY_TOO_LARGE'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}
async function rateLimitKey(secret) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
function resolveRoute(pathname, method) {
  if (pathname === '/model' || pathname.startsWith('/model/')) {
    const upload = pathname === '/model' && method === 'POST';
    const allowed = (method === 'GET' && (pathname === '/model' || pathname.startsWith('/model/'))) || upload;
    return allowed ? { provider: 'fish', upstreamPath: pathname, upload } : null;
  }
  if (pathname === '/v1/tts' && method === 'POST') return { provider: 'fish', upstreamPath: pathname, upload: false };
  if (!pathname.startsWith('/elevenlabs/')) return null;
  const upstreamPath = pathname.slice('/elevenlabs'.length);
  const voiceList = method === 'GET' && (upstreamPath === '/v2/voices' || upstreamPath === '/v1/shared-voices');
  const tts = method === 'POST' && /^\/v1\/text-to-speech\/[A-Za-z0-9_-]+$/.test(upstreamPath);
  const clone = method === 'POST' && upstreamPath === '/v1/voices/add';
  return voiceList || tts || clone ? { provider: 'eleven', upstreamPath, upload: clone } : null;
}
export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (!ALLOWED_ORIGINS.has(origin)) return response('Forbidden: website origin is not allowed', 403, corsHeaders('null'));
    const cors = corsHeaders(origin), url = new URL(request.url);
    const route = resolveRoute(url.pathname, request.method);
    if (!route) return response('Not found or method not allowed', 404, cors);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const credential = route.provider === 'fish' ? (request.headers.get('Authorization') || '') : (request.headers.get('xi-api-key') || '');
    if (route.provider === 'fish' && !/^Bearer\s+\S+/i.test(credential)) return response('A Fish Audio bearer token is required', 401, cors);
    if (route.provider === 'eleven' && !credential.trim()) return response('An ElevenLabs xi-api-key is required', 401, cors);
    if (!env || !env.RATE_LIMITER || typeof env.RATE_LIMITER.limit !== 'function') return response('Relay rate limiting is not configured', 503, cors);
    try {
      const key = await rateLimitKey(route.provider + ':' + credential);
      const { success } = await env.RATE_LIMITER.limit({ key });
      if (!success) return response('Rate limit exceeded. Please wait and try again.', 429, cors);
    } catch (error) { return response('Relay protection is temporarily unavailable', 503, cors); }

    let body;
    if (request.method === 'POST') {
      const limit = route.upload ? MAX_CLONE_BODY_BYTES : MAX_TTS_BODY_BYTES;
      if (Number(request.headers.get('Content-Length') || 0) > limit) return response('Request body is too large', 413, cors);
      try { body = await readLimitedBody(request.body, limit); }
      catch (error) {
        if (error && error.message === 'BODY_TOO_LARGE') return response('Request body is too large', 413, cors);
        return response('Could not read request body', 400, cors);
      }
      if (!body.byteLength) return response('Request body is required', 400, cors);
    }

    const headers = new Headers();
    headers.set(route.provider === 'fish' ? 'Authorization' : 'xi-api-key', credential);
    for (const name of ['content-type', 'model']) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    try {
      const base = route.provider === 'fish' ? FISH_API : ELEVEN_API;
      const upstream = await fetch(base + route.upstreamPath + url.search, {
        method: request.method, headers, body: request.method === 'POST' ? body : undefined, redirect: 'error'
      });
      const out = new Headers(upstream.headers);
      for (const [name, value] of Object.entries(cors)) out.set(name, value);
      out.set('Cache-Control', 'no-store');
      out.delete('set-cookie');
      return new Response(upstream.body, { status: upstream.status, headers: out });
    } catch (error) {
      return response(route.provider === 'fish' ? 'Fish Audio could not be reached by the relay' : 'ElevenLabs could not be reached by the relay', 502, cors);
    }
  }
};
