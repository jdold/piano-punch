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

function familyLinkAuthorized(request, env) {
  const expected = env.KID_LINK_KEY;
  const supplied = request.headers.get('X-Piano-Family-Key') || '';
  if (!expected || expected.length !== supplied.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ supplied.charCodeAt(i);
  return mismatch === 0;
}

function addKidPracticeAwards(state) {
  const autoTypes = new Set(['daily_goal', 'practice_day', 'streak_milestone', 'extra_minutes']);
  const ledger = [...state.ledger];
  const awards = [];
  const expectedKeys = new Set();
  const add = (child, points, type, date, key, note = '') => {
    expectedKeys.add(key);
    if (Number.isInteger(points) && points > 0 && !ledger.some((row) => row.idempotencyKey === key) && !awards.some((row) => row.idempotencyKey === key)) {
      awards.push({ id: crypto.randomUUID(), childId: child.id, points, type, sourceId: date, idempotencyKey: key, note, createdAt: new Date().toISOString() });
    }
  };
  for (const child of state.children) {
    const totals = new Map();
    for (const session of state.sessions) if (session.childId === child.id && (session.status === 'complete' || session.goalCelebrated === true)) totals.set(session.date, (totals.get(session.date) || 0) + session.creditedMs);
    const celebratedDates = new Set(state.sessions.filter((session) => session.childId === child.id && session.goalCelebrated === true).map((session) => session.date));
    const lessonDates = new Set((state.lessonSessions || []).filter((lesson) => lesson.childId === child.id).map((lesson) => lesson.date));
    for (const date of lessonDates) if (!totals.has(date)) totals.set(date, 0);
    if (state.currentSession?.childId === child.id) totals.set(state.currentSession.date, (totals.get(state.currentSession.date) || 0) + (state.currentSession.creditedMs || 0));
    const goal = Math.max(1, Number(child.goalMinutes) || 20);
    const completed = new Set([...totals].filter(([date, ms]) => celebratedDates.has(date) || lessonDates.has(date) || Math.floor(ms / 60_000) >= goal).map(([date]) => date));
    const required = (date) => child.requiredWeekdays?.includes(new Date(`${date}T12:00:00Z`).getUTCDay()) && !child.excusedDates?.includes(date);
    for (const [date, ms] of totals) {
      const minutes = Math.floor(ms / 60_000);
      if (completed.has(date)) {
        add(child, child.pointRules?.dailyGoal, 'daily_goal', date, `daily_goal:${child.id}:${date}`);
        add(child, child.pointRules?.practiceDay, 'practice_day', date, `practice_day:${child.id}:${date}`);
        let streak = 0;
        const cursor = new Date(`${date}T12:00:00Z`);
        for (let day = 0; day < 370; day++) {
          const key = cursor.toISOString().slice(0, 10);
          if (required(key)) { if (!completed.has(key)) break; streak++; }
          cursor.setUTCDate(cursor.getUTCDate() - 1);
        }
        for (const [milestone, value] of Object.entries(child.pointRules?.milestones || {})) {
          if (streak === Number(milestone)) add(child, value, 'streak_milestone', date, `streak:${child.id}:${date}:${milestone}`);
        }
      }
      const interval = Math.max(1, Number(child.pointRules?.extraEveryMinutes) || 10);
      const units = Math.floor(Math.max(0, minutes - goal) / interval);
      for (let unit = 1; unit <= units; unit++) add(child, child.pointRules?.extraMinutes, 'extra_minutes', date, `extra:${child.id}:${date}:${unit}`);
    }
  }
  const result = [...ledger, ...awards];
  for (const original of result.filter((row) => autoTypes.has(row.type) && !row.reversesLedgerId)) {
    const reversalTotal = result.filter((row) => row.reversesLedgerId === original.id).reduce((sum, row) => sum + row.points, 0);
    const active = original.points + reversalTotal > 0;
    const shouldBeActive = expectedKeys.has(original.idempotencyKey);
    if (active === shouldBeActive) continue;
    const points = (shouldBeActive ? 1 : -1) * original.points;
    const type = shouldBeActive ? 'award_reinstatement' : 'award_reversal';
    result.push({ id: crypto.randomUUID(), childId: original.childId, points, type, sourceId: original.sourceId, idempotencyKey: `family-link:${type}:${original.id}:${result.length}`, reversesLedgerId: original.id, note: `${shouldBeActive ? 'Restored' : 'Reversed'} practice points after session update`, createdAt: new Date().toISOString() });
  }
  return result;
}

function validateKidSession(session, ids) {
  if (!session || typeof session.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(session.id) || !ids.has(session.childId)) return false;
  if (!['complete', 'interrupted'].includes(session.status) || !/^\d{4}-\d{2}-\d{2}$/.test(session.date)) return false;
  const start = Date.parse(session.startedAt), end = Date.parse(session.endedAt);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start && end - start <= 24 * 60 * 60_000 && Number.isFinite(session.creditedMs) && session.creditedMs >= 0 && session.creditedMs <= end - start && Array.isArray(session.events) && session.events.length <= 20_000;
}

async function kidApi(request, env, url) {
  if (!env.DB) return json({ error: 'Database is not configured.' }, 503);
  const row = await env.DB.prepare('SELECT state_json, revision FROM app_state WHERE id = 1').first();
  if (!row) return json({ error: 'Family setup is incomplete. Ask a parent to open Parent Controls first.' }, 503);
  const current = JSON.parse(row.state_json);
  if (request.method === 'GET' && url.pathname === '/api/kid-data') return json({ state: { ...current, parentMode: false }, revision: row.revision });
  if (request.method === 'PUT' && url.pathname === '/api/kid-data') {
    const length = Number(request.headers.get('content-length') || 0);
    if (length > 1_000_000) return json({ error: 'State is too large.' }, 413);
    let input; try { input = await request.json(); } catch { return json({ error: 'Invalid JSON.' }, 400); }
    if (!input?.state || !Number.isInteger(input.revision) || input.revision !== row.revision) return json({ error: 'Family data changed. Refresh to continue.', revision: row.revision }, 409);
    const proposed = input.state;
    const ids = new Set(current.children.map((child) => child.id));
    if (!Array.isArray(proposed.sessions) || !Array.isArray(proposed.redemptions) || !Array.isArray(proposed.children) || proposed.children.map((c) => c.id).sort().join('|') !== [...ids].sort().join('|')) return json({ error: 'Invalid family update.' }, 400);
    const allowedThemes = new Set(['orange', 'blue', 'yellow', 'green', 'purple', 'pink']);
    const proposedChildren = new Map(proposed.children.map((child) => [child.id, child]));
    const nextChildren = current.children.map((child) => {
      const requestedTheme = proposedChildren.get(child.id)?.theme || child.theme || (child.id === 'son' ? 'orange' : child.id === 'emma' ? 'blue' : child.id === 'daughter' ? 'yellow' : 'green');
      return allowedThemes.has(requestedTheme) ? { ...child, theme: requestedTheme } : null;
    });
    if (nextChildren.some((child) => !child)) return json({ error: 'Invalid profile color.' }, 400);
    const existingSessions = new Map(current.sessions.map((session) => [session.id, session]));
    const nextSessions = [...current.sessions];
    for (const session of proposed.sessions) {
      const existing = existingSessions.get(session.id);
      if (existing) {
        if (existing.status === 'interrupted'
          && (session.status === 'complete' || session.goalCelebrated === true)
          && validateKidSession(session, ids)) {
          const index = nextSessions.findIndex((item) => item.id === session.id);
          const promoted = existing.recording && !session.recording ? { ...session, recording: existing.recording } : session;
          if (index >= 0) nextSessions[index] = promoted;
          existingSessions.set(session.id, promoted);
        }
        if (session.recording && !existing.recording && env.RECORDINGS) {
          const object = await env.RECORDINGS.head(`sessions/${session.id}.audio`);
          if (object) Object.assign(existing, { recording: { mimeType: object.httpMetadata?.contentType || 'audio/webm', size: object.size, createdAt: new Date().toISOString() } });
        }
        continue;
      }
      if (!validateKidSession(session, ids) || existingSessions.has(session.id) || nextSessions.some((item) => item.id === session.id)) return json({ error: 'Invalid practice session.' }, 400);
      if (session.recording && env.RECORDINGS && !await env.RECORDINGS.head(`sessions/${session.id}.audio`)) return json({ error: 'Recording is not available.' }, 400);
      nextSessions.push(session);
    }
    let nextCurrent = current.currentSession;
    const proposedCurrent = proposed.currentSession;
    if (proposedCurrent) {
      if (!ids.has(proposedCurrent.childId) || typeof proposedCurrent.id !== 'string' || !Number.isFinite(Date.parse(proposedCurrent.startedAt)) || !Number.isFinite(proposedCurrent.creditedMs) || proposedCurrent.creditedMs < 0 || proposedCurrent.creditedMs > (proposedCurrent.elapsedMs || 0)) return json({ error: 'Invalid active session.' }, 400);
      if (nextCurrent && nextCurrent.id !== proposedCurrent.id) return json({ error: 'Another practice session is already open.' }, 409);
      if (nextCurrent && (proposedCurrent.childId !== nextCurrent.childId || proposedCurrent.startedAt !== nextCurrent.startedAt || proposedCurrent.elapsedMs < nextCurrent.elapsedMs || proposedCurrent.creditedMs < nextCurrent.creditedMs)) return json({ error: 'Invalid active session update.' }, 400);
      nextCurrent = proposedCurrent;
    } else if (nextCurrent) {
      const ended = nextSessions.some((session) => session.id === nextCurrent.id);
      if (!ended) return json({ error: 'The active session must be punched out before it can be closed.' }, 409);
      nextCurrent = null;
    }
    const candidateLedger = addKidPracticeAwards({ ...current, children: nextChildren, sessions: nextSessions, currentSession: nextCurrent });
    let nextRedemptions = [...current.redemptions];
    const oldRequests = new Map(current.redemptions.map((item) => [item.id, item]));
    for (const request of proposed.redemptions) {
      const old = oldRequests.get(request.id);
      if (old) {
        if (old.status === 'pending' && request.status === 'cancelled') nextRedemptions = nextRedemptions.map((item) => item.id === old.id ? { ...item, status: 'cancelled', resolvedAt: new Date().toISOString() } : item);
        continue;
      }
      const reward = current.rewards.find((item) => item.id === request.rewardId && item.enabled);
      if (!reward || request.status !== 'pending' || request.cost !== reward.cost || !ids.has(request.childId) || !/^[0-9a-f-]{36}$/i.test(request.id)) return json({ error: 'Invalid reward request.' }, 400);
      const balance = candidateLedger.filter((item) => item.childId === request.childId).reduce((sum, item) => sum + item.points, 0);
      const reserved = nextRedemptions.filter((item) => item.childId === request.childId && item.status === 'pending').reduce((sum, item) => sum + item.cost, 0);
      if (balance - reserved < request.cost) return json({ error: 'Not enough available points.' }, 400);
      nextRedemptions.push(request);
    }
    const updated = { ...current, children: nextChildren, sessions: nextSessions, currentSession: nextCurrent, redemptions: nextRedemptions, ledger: candidateLedger, parentMode: false };
    const result = await env.DB.prepare(`UPDATE app_state SET state_json = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1 AND revision = ? RETURNING revision`).bind(JSON.stringify(updated), row.revision).first();
    if (!result) return json({ error: 'Family data changed. Refresh to continue.' }, 409);
    return json({ state: { ...updated, currentSession: null }, revision: result.revision });
  }
  const recordingMatch = url.pathname.match(/^\/api\/kid-recordings\/([0-9a-f-]{36})$/i);
  if (recordingMatch && env.RECORDINGS) {
    const id = recordingMatch[1].toLowerCase();
    if (!current.sessions.some((session) => session.id === id)) return json({ error: 'Recording not found.' }, 404);
    const key = `sessions/${id}.audio`;
    if (request.method === 'PUT') {
      if (!current.sessions.some((s) => s.id === id || current.currentSession?.id === id)) return json({ error: 'Session not found.' }, 404);
      const type = request.headers.get('content-type') || '';
      if (!type.toLowerCase().startsWith('audio/')) return json({ error: 'Only audio recordings are accepted.' }, 415);
      const length = Number(request.headers.get('content-length') || 0);
      if (length > 100 * 1024 * 1024) return json({ error: 'Recording must be under 100 MB.' }, 413);
      await env.RECORDINGS.put(key, request.body, { httpMetadata: { contentType: type } });
      return json({ ok: true });
    }
    if (request.method === 'GET' || request.method === 'HEAD') {
      const object = await env.RECORDINGS.get(key);
      if (!object) return json({ error: 'Recording not found.' }, 404);
      return new Response(request.method === 'HEAD' ? null : object.body, { headers: { 'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Length': String(object.size), 'Content-Disposition': 'inline' } });
    }
  }
  return json({ error: 'Not found.' }, 404);
}

async function api(request, env) {
  const url = new URL(request.url);
  if (url.pathname === '/api/kid-data' || url.pathname.startsWith('/api/kid-recordings/')) {
    if (!familyLinkAuthorized(request, env)) return json({ error: 'Open the family practice link to continue.' }, 401);
    return kidApi(request, env, url);
  }
  if (!await authorized(request)) return json({ error: 'Parent sign-in required.' }, 401);
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
    const asset = ASSETS[url.pathname === '/' || url.pathname === '/kids' || url.pathname === '/kids/' ? '/index.html' : url.pathname];
    if (!asset) return new Response('Not found', { status: 404 });
    const bytes = Uint8Array.from(atob(asset.body), (c) => c.charCodeAt(0));
    const appEntry = url.pathname === '/' || url.pathname === '/kids' || url.pathname === '/kids/';
    return new Response(request.method === 'HEAD' ? null : bytes, { headers: { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Permissions-Policy': 'microphone=(self)', 'Content-Type': asset.contentType, 'Cache-Control': appEntry ? 'no-cache' : 'public, max-age=31536000, immutable' } });
  },
};
