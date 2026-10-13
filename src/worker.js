const ASSETS = __ASSETS__;
const ACCESS_AUD = '472b0c23f85f568f6a50e844b07bde90867e68126247c1213be06c89f73cefba';
const ACCESS_ISSUER = 'https://jakedold07.cloudflareaccess.com';
const PARENT_EMAILS = new Set(['jakedold07@gmail.com', 'jdold@apexdp.com']);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

function decodePart(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')));
}

async function authorized(request) {
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return false;
  try {
    const [head, body, sig] = token.split('.');
    const header = decodePart(head); const claims = decodePart(body);
    if (header.alg !== 'RS256' || !header.kid || claims.iss !== ACCESS_ISSUER || !PARENT_EMAILS.has(claims.email?.toLowerCase()) || Number(claims.exp) <= Date.now() / 1000 || Number(claims.nbf || 0) > Date.now() / 1000) return false;
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes(ACCESS_AUD)) return false;
    const keyResponse = await fetch(`${ACCESS_ISSUER}/cdn-cgi/access/certs`);
    if (!keyResponse.ok) return false;
    const key = (await keyResponse.json()).public_certs?.find((item) => item.kid === header.kid);
    if (!key?.cert) return false;
    const publicKey = await crypto.subtle.importKey('spki', certificateSpki(pemBytes(key.cert)), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const signature = Uint8Array.from(atob(sig.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
    return crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, signature, new TextEncoder().encode(`${head}.${body}`));
  } catch { return false; }
}

function pemBytes(pem) {
  const binary = atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, ''));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function certificateSpki(der) {
  function node(offset) {
    let cursor = offset + 1;
    let length = der[cursor++];
    if (length & 0x80) { const size = length & 0x7f; length = 0; for (let i = 0; i < size; i++) length = length * 256 + der[cursor++]; }
    return { tag: der[offset], start: offset, content: cursor, end: cursor + length };
  }
  const root = node(0); const tbs = node(root.content);
  let cursor = tbs.content; const fields = [];
  while (cursor < tbs.end) { const item = node(cursor); fields.push(item); cursor = item.end; }
  const index = fields[0]?.tag === 0xa0 ? 6 : 5;
  const spki = fields[index];
  if (!spki || spki.tag !== 0x30) throw new Error('Invalid Access certificate');
  return der.slice(spki.start, spki.end);
}

async function api(request, env) {
  if (!await authorized(request)) return json({ error: 'Parent sign-in required.' }, 401);
  const url = new URL(request.url);
  const recordingMatch = url.pathname.match(/^\/api\/recordings\/([0-9a-f-]{36})$/i);
  if (recordingMatch) {
    if (!env.RECORDINGS) return json({ error: 'Recording storage is not configured.' }, 503);
    const key = `sessions/${recordingMatch[1].toLowerCase()}.audio`;
    if (request.method === 'PUT') {
      const type = request.headers.get('content-type') || '';
      const length = Number(request.headers.get('content-length') || 0);
      if (!type.toLowerCase().startsWith('audio/')) return json({ error: 'Only audio recordings are accepted.' }, 415);
      if (length > 100 * 1024 * 1024) return json({ error: 'Recording must be under 100 MB.' }, 413);
      let bytes = 0;
      const limitedBody = request.body.pipeThrough(new TransformStream({ transform(chunk, controller) { bytes += chunk.byteLength; if (bytes > 100 * 1024 * 1024) throw new Error('Recording exceeds 100 MB.'); controller.enqueue(chunk); } }));
      await env.RECORDINGS.put(key, limitedBody, { httpMetadata: { contentType: type }, customMetadata: { sessionId: recordingMatch[1], uploadedAt: new Date().toISOString() } });
      return json({ ok: true });
    }
    if (request.method === 'GET' || request.method === 'HEAD') {
      const object = await env.RECORDINGS.get(key);
      if (!object) return json({ error: 'Recording not found.' }, 404);
      const headers = new Headers({ 'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Length': String(object.size), 'Content-Disposition': 'inline' });
      return new Response(request.method === 'HEAD' ? null : object.body, { headers });
    }
    if (request.method === 'DELETE') { await env.RECORDINGS.delete(key); return json({ ok: true }); }
    return json({ error: 'Method not allowed.' }, 405);
  }
  if (!env.DB) return json({ error: 'Database is not configured.' }, 503);
  if (request.method === 'GET' && url.pathname === '/api/state') {
    const row = await env.DB.prepare('SELECT state_json, revision FROM app_state WHERE id = 1').first();
    return json(row ? { state: JSON.parse(row.state_json), revision: row.revision } : { state: null, revision: 0 });
  }
  if (request.method === 'PUT' && url.pathname === '/api/state') {
    const length = Number(request.headers.get('content-length') || 0);
    if (length > 1_000_000) return json({ error: 'State is too large.' }, 413);
    let input;
    try { input = await request.json(); } catch { return json({ error: 'Invalid JSON.' }, 400); }
    const s = input?.state;
    if (!s || !Array.isArray(s.children) || s.children.length < 1 || s.children.length > 8 || s.children.some((child) => !child?.id || typeof child.id !== 'string') || new Set(s.children.map((child) => child.id)).size !== s.children.length || !Array.isArray(s.sessions) || !Array.isArray(s.ledger) || !Array.isArray(s.rewards) || !Array.isArray(s.redemptions) || !Number.isInteger(input.revision) || input.revision < 0) return json({ error: 'Invalid family state.' }, 400);
    const serialized = JSON.stringify(s);
    const result = await env.DB.prepare(`INSERT INTO app_state (id, state_json, revision) VALUES (1, ?, 1)
      ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json, revision = app_state.revision + 1, updated_at = CURRENT_TIMESTAMP
      WHERE app_state.revision = ? RETURNING revision`).bind(serialized, input.revision).first();
    if (!result) {
      const current = await env.DB.prepare('SELECT revision FROM app_state WHERE id = 1').first();
      return json({ error: 'State changed on another device. Reload before saving.', revision: current?.revision || 0 }, 409);
    }
    return json({ revision: result.revision });
  }
  return json({ error: 'Not found.' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      if (!['GET', 'HEAD', 'PUT', 'DELETE'].includes(request.method)) return json({ error: 'Method not allowed.' }, 405);
      try { return await api(request, env); } catch { return json({ error: 'Storage request failed.' }, 500); }
    }
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    const asset = ASSETS[url.pathname === '/' ? '/index.html' : url.pathname];
    if (!asset) return new Response('Not found', { status: 404 });
    const bytes = Uint8Array.from(atob(asset.body), (c) => c.charCodeAt(0));
    return new Response(request.method === 'HEAD' ? null : bytes, { headers: { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Permissions-Policy': 'microphone=(self)', 'Content-Type': asset.contentType, 'Cache-Control': url.pathname === '/' ? 'no-cache' : 'public, max-age=31536000, immutable' } });
  },
};
