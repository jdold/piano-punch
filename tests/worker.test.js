import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/worker.js', import.meta.url), 'utf8');
const workerModule = await import(`data:text/javascript;base64,${Buffer.from(source.replace('const ASSETS = __ASSETS__;', 'const ASSETS = {};')).toString('base64')}`);
const worker = workerModule.default;

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


test('kid sync preserves restored recurring streak bonuses across repeated saves', async () => {
  const state = sampleState(null);
  state.children[0].requiredWeekdays = [1,2,3,4,5,6];
  state.children[0].pointRules = { dailyGoal:10, practiceDay:1, streakEveryDays:5, streakBonusPoints:40 };
  for (let n=0; n<6; n++) {
    const date = `2026-11-${String(16+n).padStart(2,'0')}`;
    state.sessions.push(sampleSession({ id:crypto.randomUUID(), date, status:'complete', creditedMs:20*60_000 }));
  }
  state.ledger.push({ id:'parent-bonus', childId:'gordon', points:40, type:'streak_milestone', sourceId:'2026-11-20', idempotencyKey:'streak:gordon:2026-11-20:5:40' });
  const db = mockDatabase(state);
  for (let n=0; n<2; n++) {
    const response = await worker.fetch(familyRequest('/api/kid-data', PRIMARY_KEY, { state:db.state, revision:db.revision }), testEnv(db));
    assert.equal(response.status, 200);
    assert.equal(db.state.ledger.filter(row=>row.type==='streak_milestone').length, 1);
    assert.equal(db.state.ledger.some(row=>row.reversesLedgerId==='parent-bonus'), false);
  }
});


function mockHistoryBucket() {
  const objects = new Map();
  let writes = 0;
  return {
    objects,
    get writes() { return writes; },
    async put(key, body) { writes++; objects.set(key, body); },
    async get(key) { return objects.has(key) ? { json:async()=>JSON.parse(objects.get(key)) } : null; },
  };
}

test('a recovery upload larger than the former 4 MB cap saves compact history and can be read on another device', async () => {
  const sessions = Array.from({length:70},(_,n)=>sampleSession({
    id:crypto.randomUUID(),status:'complete',endedAt:'2026-10-25T18:30:00.000Z',
    events:Array.from({length:2000},(_,i)=>({at:i*250,state:'playing',reason:'piano_detected',confidence:0.91})),
  }));
  const state=sampleState(null,sessions);
  const db=mockDatabase(state);
  const bucket=mockHistoryBucket();
  const env={...testEnv(db),RECORDINGS:bucket};
  const request=familyRequest('/api/kid-data',PRIMARY_KEY,{state,revision:7});
  const length=Buffer.byteLength(await request.clone().text());
  assert.ok(length>4_000_000);
  request.headers.set('Content-Length',String(length));
  const response=await worker.fetch(request,env);
  assert.equal(response.status,200);
  assert.ok(JSON.stringify(db.state).length<150_000);
  assert.equal(bucket.objects.size,70);
  const shared=await worker.fetch(new Request('https://piano-punch.test/api/kid-data',{headers:{'X-Piano-Family-Key':PRIMARY_KEY}}),env);
  const body=await shared.json();
  assert.equal(body.state.sessions.length,70);
  assert.equal(body.state.sessions[0].eventArchive.count,2000);
  const archived=JSON.parse(bucket.objects.get(body.state.sessions[0].eventArchive.key));
  assert.equal(archived.eventLog.rows.length,2000);
  const again=await worker.fetch(familyRequest('/api/kid-data',PRIMARY_KEY,{state:body.state,revision:body.revision}),env);
  assert.equal(again.status,200);
  assert.equal(bucket.writes,70);
});

test('archiving a correction retains the earlier detector history and audit timestamp', async () => {
  const bucket=mockHistoryBucket();
  const state=sampleState(null,[sampleSession({status:'complete'})]);
  const first=await workerModule.archiveStateEventLogs(state,{RECORDINGS:bucket});
  const session=structuredClone(first.sessions[0]);
  session.events.push({at:5000,state:'manual_correction',reason:'Parent verified',correctedAt:'2026-11-28T14:00:00Z'});
  const second=await workerModule.archiveStateEventLogs({...state,sessions:[session]},{RECORDINGS:bucket},first);
  assert.equal(second.sessions[0].eventArchive.count,2);
  assert.equal(second.sessions[0].eventArchive.lastCorrectionAt,Date.parse('2026-11-28T14:00:00Z'));
  assert.equal(JSON.parse(bucket.objects.get(second.sessions[0].eventArchive.key)).eventLog.rows.length,2);
  const denied=await worker.fetch(new Request(`https://piano-punch.test/api/session-events/${SESSION_ID}`,{headers:{'X-Piano-Family-Key':PRIMARY_KEY}}),{...testEnv(mockDatabase(second)),RECORDINGS:bucket});
  assert.equal(denied.status,401);
});

test('kid sync cannot create parent credits and recovered real time does not duplicate an existing credit', async () => {
  const credit=sampleSession({id:crypto.randomUUID(),status:'complete',endedAt:'2026-10-25T18:30:00.000Z',elapsedMs:30*60_000,creditedMs:30*60_000,parentDayCredit:true});
  const forbidden=sampleState(null);
  const deniedDb=mockDatabase(forbidden);
  const denied=await worker.fetch(familyRequest('/api/kid-data',PRIMARY_KEY,{state:{...forbidden,sessions:[credit]},revision:7}),testEnv(deniedDb));
  assert.equal(denied.status,400);
  const saved=sampleState(null,[credit]);
  saved.children[0].pointRules={dailyGoal:10,practiceDay:1,extraEveryMinutes:10,extraMinutes:5};
  saved.children[0].goalMinutes=30;
  const db=mockDatabase(saved);
  const actual=sampleSession({id:crypto.randomUUID(),status:'complete',endedAt:'2026-10-25T18:30:00.000Z',elapsedMs:30*60_000,creditedMs:30*60_000});
  const accepted=await worker.fetch(familyRequest('/api/kid-data',PRIMARY_KEY,{state:{...saved,sessions:[credit,actual]},revision:7}),testEnv(db));
  assert.equal(accepted.status,200);
  assert.equal(db.state.ledger.some(row=>row.type==='extra_minutes'),false);
  assert.equal(db.state.ledger.reduce((sum,row)=>sum+row.points,0),11);
});
