// VoiceCraft relay for Fish Audio. Runs on Cloudflare Workers (free plan).
// It only forwards requests from your own VoiceCraft site to Fish Audio,
// and it does not store your key or your text.
const ALLOWED_ORIGIN = 'https://gracefulrosenailspa.github.io';

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, model',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    if (origin !== ALLOWED_ORIGIN) {
      return new Response('Forbidden', { status: 403, headers: cors });
    }

    const url = new URL(request.url);
    const okPath = url.pathname === '/v1/tts' || url.pathname === '/model' || url.pathname.startsWith('/model/');
    if (!okPath) {
      return new Response('Not found', { status: 404, headers: cors });
    }

    const headers = new Headers();
    for (const name of ['authorization', 'content-type', 'model']) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }

    const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
    const upstream = await fetch('https://api.fish.audio' + url.pathname + url.search, {
      method: request.method,
      headers,
      body: hasBody ? request.body : undefined
    });

    const out = new Headers(upstream.headers);
    for (const [k, v] of Object.entries(cors)) out.set(k, v);
    return new Response(upstream.body, { status: upstream.status, headers: out });
  }
};
