import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/worker.js', import.meta.url), 'utf8');
const worker = (await import(`data:text/javascript;base64,${Buffer.from(source.replace('const ASSETS = __ASSETS__;', 'const ASSETS = {};')).toString('base64')}`)).default;

const PRIMARY_KEY = 'primary-test-family-key';
const SECONDARY_KEY = 'secondary-test-family-key';
const SESSION_ID = '11111111-1111-4111-8111-111111111111';

function sampleSession(overrides = {}) {
  return {
    id: SESSION_ID,
    childId: 'gordon',
    startedAt: '2026-10-25T18:00:00.000Z',
    checkpointAt: '2026-10-25T18:01:00.000Z',
    date: '2026-10-25',
    elapsedMs: 5_000,
    creditedMs: 3_000,
    events: [{ at: 0, state: 'listening', reason: 'punch_in' }],
    ...overrides,
  };
}

function sampleState(currentSession = sampleSession(), sessions = []) {
  return {
    parentMode: false,
    children: [{
      id: 'gordon', name: 'Gordon', theme: 'orange', goalMinutes: 20,
      requiredWeekdays: [], excusedDates: [], pointRules: {},
    }],
    sessions,
    currentSession,
    ledger: [],
    rewards: [],
    redemptions: [],
    lessonSessions: [],
  };
}

function mockDatabase(initialState, initialRevision = 7) {
  let state = structuredClone(initialState);
  let revision = initialRevision;
  const statements = [];

  async function run(sql, params) {
    statements.push(sql);
    if (sql.includes("SET state_json = json_set(state_json, '$.currentSession'")) {
      const [serialized, expectedRevision, childId, id, sessionChildId, startedAt, elapsedMs, creditedMs] = params;
      const nextSession = JSON.parse(serialized);
      const current = state.currentSession;
      const sessionMatches = !current || (
        current.id === id && current.childId === sessionChildId && current.startedAt === startedAt
        && current.elapsedMs <= elapsedMs && current.creditedMs <= creditedMs
      );
      if (expectedRevision !== revision || !state.children.some((child) => child.id === childId) || !sessionMatches) return null;
      state = { ...state, currentSession: nextSession };
      revision += 1;
      return { revision };
    }
    if (sql.includes('SELECT json_set(state_json')) return { state_json: JSON.stringify({ ...state, parentMode: false }), revision };
    if (sql.includes('SELECT state_json, revision')) return { state_json: JSON.stringify(state), revision };
    if (sql.includes('SELECT revision FROM app_state')) return { revision };
    if (sql.includes('SET state_json = ?')) {
      const [serialized, expectedRevision] = params;
      if (expectedRevision !== revision) return null;
      state = JSON.parse(serialized);
      revision += 1;
      return { revision };
    }
    throw new Error(`Unexpected SQL in Worker test: ${sql}`);
  }

  return {
    statements,
    get state() { return structuredClone(state); },
    get revision() { return revision; },
    prepare(sql) {
      return {
        first: () => run(sql, []),
        bind: (...params) => ({ first: () => run(sql, params) }),
      };
    },
  };
}

function familyRequest(path, key, body) {
  return new Request(`https://piano-punch.test${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Piano-Family-Key': key },
    body: JSON.stringify(body),
  });
}

function testEnv(DB) {
  return { DB, KID_LINK_KEY: PRIMARY_KEY, KID_LINK_KEY_SECONDARY: SECONDARY_KEY };
}

test('session checkpoint updates only the active session and accepts both existing family keys', async () => {
  const state = sampleState();
  const db = mockDatabase(state);
  const checkpoint = sampleSession({ elapsedMs: 60_000, creditedMs: 45_000, checkpointAt: '2026-10-25T18:01:00.000Z' });
  const response = await worker.fetch(familyRequest('/api/kid-checkpoint', SECONDARY_KEY, { currentSession: checkpoint, revision: 7 }), testEnv(db));
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(body), { revision: 8 });
  assert.ok(body.length < 64, 'checkpoint response should contain only the revision');
  assert.deepEqual(db.state.sessions, state.sessions);
  assert.deepEqual(db.state.ledger, state.ledger);
  assert.deepEqual(db.state.children, state.children);
  assert.deepEqual(db.state.currentSession, checkpoint);
  assert.ok(db.statements.some((sql) => sql.includes('json_set')));
});

test('stale and backwards checkpoints are rejected without overwriting newer family data', async () => {
  const state = sampleState();
  const db = mockDatabase(state, 9);
  const stale = await worker.fetch(familyRequest('/api/kid-checkpoint', PRIMARY_KEY, { currentSession: sampleSession({ elapsedMs: 60_000, creditedMs: 45_000 }), revision: 8 }), testEnv(db));
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).revision, 9);
  assert.deepEqual(db.state, state);

  const backwards = await worker.fetch(familyRequest('/api/kid-checkpoint', PRIMARY_KEY, { currentSession: sampleSession({ elapsedMs: 2_000, creditedMs: 1_000 }), revision: 9 }), testEnv(db));
  assert.equal(backwards.status, 409);
  assert.equal((await backwards.json()).revision, 9);
  assert.deepEqual(db.state, state);
});

test('checkpoint endpoint rejects requests without either current family key', async () => {
  const db = mockDatabase(sampleState());
  const response = await worker.fetch(familyRequest('/api/kid-checkpoint', 'wrong-key', { currentSession: sampleSession(), revision: 7 }), testEnv(db));
  assert.equal(response.status, 401);
  assert.equal(db.statements.length, 0);
});

test('family state writes return only a revision for a large stored history', async () => {
  const sessions = Array.from({ length: 38 }, (_, sessionIndex) => ({
    id: `${String(sessionIndex + 1).padStart(8, '0')}-1111-4111-8111-111111111111`,
    childId: 'gordon',
    date: '2026-10-24',
    startedAt: '2026-10-24T18:00:00.000Z',
    endedAt: '2026-10-24T18:30:00.000Z',
    elapsedMs: 30 * 60_000,
    creditedMs: 0,
    status: 'complete',
    events: [],
    eventLog: {
      v: 1,
      states: ['playing', 'paused'],
      reasons: ['piano_detected', 'silence_threshold'],
      rows: Array.from({ length: 800 }, (_, i) => [i * 250, i % 2, i % 2, { confidence: 0.91, sample: 'detected' }]),
    },
  }));
  const state = sampleState(null, sessions);
  assert.ok(Buffer.byteLength(JSON.stringify(state)) > 1_000_000);
  const db = mockDatabase(state);
  const response = await worker.fetch(familyRequest('/api/kid-data', PRIMARY_KEY, { state, revision: 7 }), testEnv(db));
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(body), { revision: 8 });
  assert.ok(body.length < 64, 'successful state writes should not serialize the family state back to the client');
});
