import test from 'node:test';
import assert from 'node:assert/strict';
import { hasLegacyCloudEvents, packCloudState, unpackCloudState } from '../src/lib/cloud-state.js';
import { initialState, loadState, recoverInterruptedSession, saveState, STORAGE_KEY } from '../src/lib/piano-state.js';

test('packed session timelines round-trip without mutating the live state', () => {
  const state = {
    sessions: [{
      id: 'session-1',
      events: [
        { at: 0, state: 'listening', reason: 'punch_in' },
        { at: 1200, state: 'playing', reason: 'piano_detected', confidence: 0.91 },
        { at: 2400, state: 'paused', reason: 'manual_correction', deltaMs: 500, note: 'Phrase gap' },
      ],
    }],
  };
  const originalEvents = structuredClone(state.sessions[0].events);

  const packed = packCloudState(state);

  assert.deepEqual(state.sessions[0].events, originalEvents);
  assert.deepEqual(packed.sessions[0].events, []);
  assert.equal(packed.sessions[0].eventLog.v, 1);
  assert.deepEqual(unpackCloudState(packed), state);
  assert.equal(hasLegacyCloudEvents(state), true);
  assert.equal(hasLegacyCloudEvents(packed), false);
});

test('packing repeated detector events brings cloud state below the 1 MB request limit', () => {
  const events = Array.from({ length: 5000 }, (_, i) => ({
    at: i * 250,
    state: i % 2 ? 'playing' : 'paused',
    reason: i % 2 ? 'piano_detected' : 'silence_threshold',
  }));
  const state = { sessions: [{ id: 'large-session', events }] };
  const originalBytes = Buffer.byteLength(JSON.stringify(state));
  const packedBytes = Buffer.byteLength(JSON.stringify(packCloudState(state)));

  assert.ok(packedBytes < 1_000_000);
  assert.ok(packedBytes < originalBytes * 0.6);
});

test('local recovery storage stays compact and expands timelines on load', () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const state = initialState();
  state.sessions.push({
    id: 'session-1',
    childId: 'son',
    date: '2026-10-22',
    startedAt: '2026-10-22T10:00:00.000Z',
    endedAt: '2026-10-22T10:05:00.000Z',
    creditedMs: 5 * 60_000,
    status: 'complete',
    events: [{ at: 0, state: 'playing', reason: 'piano_detected' }],
  });

  saveState(state, storage);
  const stored = JSON.parse(values.get(STORAGE_KEY));

  assert.deepEqual(stored.sessions[0].events, []);
  assert.deepEqual(loadState(storage).sessions[0].events, [{ at: 0, state: 'playing', reason: 'piano_detected' }]);
});

test('interrupted-session recovery uses the last checkpoint instead of reopen time', () => {
  const startedAt = Date.parse('2026-10-22T10:00:00.000Z');
  const recovered = recoverInterruptedSession({
    id: 'session-1',
    startedAt: new Date(startedAt).toISOString(),
    checkpointAt: new Date(startedAt + 45_000).toISOString(),
    elapsedMs: 60_000,
    creditedMs: 40_000,
    events: [],
  }, startedAt + 10 * 60_000);

  assert.equal(recovered.endedAt, new Date(startedAt + 45_000).toISOString());
  assert.equal(recovered.elapsedMs, 45_000);
  assert.equal(recovered.recoveryRequired, false);
  assert.equal(recovered.status, 'interrupted');
});
