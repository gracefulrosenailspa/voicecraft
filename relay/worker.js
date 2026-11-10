// VoiceCraft Fish Audio relay for Cloudflare Workers.
//
// Required Worker binding:
//   RATE_LIMITER: Cloudflare Rate Limiting binding (recommended: 20 requests / 60 seconds).
//
// The browser Origin check is CORS protection, NOT authentication. API requests
// must carry the user's Fish Audio bearer token. The relay hashes that token
// before using it as the rate-limit key; the token is never logged or stored.

const ALLOWED_ORIGIN = 'https://gracefulrosenailspa.github.io';
const FISH_API = 'https://api.fish.audio';
const MAX_TTS_BODY_BYTES = 1024 * 1024;
const MAX_CLONE_BODY_BYTES = 25 * 1024 * 1024;

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, model',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function response(message, status, cors) {
  return new Response(message, {
    status,
    headers: { ...cors, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

async function readLimitedBody(body, maxBytes) {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error('BODY_TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function rateLimitKey(authorization) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(authorization)
  );
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders();
    const origin = request.headers.get('Origin') || '';

    // This is a browser CORS boundary only. It is not treated as authentication.
    if (origin !== ALLOWED_ORIGIN) {
      return response('Forbidden', 403, cors);
    }

    const url = new URL(request.url);
    const isModelPath = url.pathname === '/model' || url.pathname.startsWith('/model/');
    const isTtsPath = url.pathname === '/v1/tts';
    const isModelUpload = url.pathname === '/model' && request.method === 'POST';

    if (!isModelPath && !isTtsPath) {
      return response('Not found', 404, cors);
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const allowedMethod = (isModelPath && request.method === 'GET') ||
      isModelUpload || (isTtsPath && request.method === 'POST');
    if (!allowedMethod) {
      return response('Method not allowed', 405, cors);
    }

    const authorization = request.headers.get('Authorization') || '';
    if (!/^Bearer\s+\S+/i.test(authorization)) {
      return response('A Fish Audio bearer token is required', 401, cors);
    }

    // Fail closed: do not operate an unrestricted public relay if the binding
    // has not been configured in the Cloudflare Worker settings.
    if (!env || !env.RATE_LIMITER || typeof env.RATE_LIMITER.limit !== 'function') {
      return response('Relay rate limiting is not configured', 503, cors);
    }

    try {
      const key = await rateLimitKey(authorization);
      const { success } = await env.RATE_LIMITER.limit({ key });
      if (!success) {
        return response('Rate limit exceeded. Please wait and try again.', 429, cors);
      }
    } catch (error) {
      // A failed rate-limit check must not silently turn protection off.
      return response('Relay protection is temporarily unavailable', 503, cors);
    }

    let body;
    if (request.method === 'POST') {
      const bodyLimit = isModelUpload ? MAX_CLONE_BODY_BYTES : MAX_TTS_BODY_BYTES;
      const declaredLength = Number(request.headers.get('Content-Length') || 0);
      if (declaredLength > bodyLimit) {
        return response('Request body is too large', 413, cors);
      }
      try {
        body = await readLimitedBody(request.body, bodyLimit);
      } catch (error) {
        if (error && error.message === 'BODY_TOO_LARGE') {
          return response('Request body is too large', 413, cors);
        }
        return response('Could not read request body', 400, cors);
      }
      if (!body.byteLength) {
        return response('Request body is required', 400, cors);
      }
    }

    const headers = new Headers();
    headers.set('Authorization', authorization);
    for (const name of ['content-type', 'model']) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }

    try {
      const upstream = await fetch(FISH_API + url.pathname + url.search, {
        method: request.method,
        headers,
        body: request.method === 'POST' ? body : undefined,
        redirect: 'error'
      });

      const out = new Headers(upstream.headers);
      for (const [name, value] of Object.entries(cors)) out.set(name, value);
      out.set('Cache-Control', 'no-store');
      out.delete('set-cookie');
      return new Response(upstream.body, { status: upstream.status, headers: out });
    } catch (error) {
      return response('Fish Audio could not be reached by the relay', 502, cors);
    }
  }
};
