import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVE_SESSION_CLOUD_SYNC_INTERVAL_MS,
  ACTIVE_SESSION_REFRESH_INTERVAL_MS,
  IDLE_REFRESH_INTERVAL_MS,
  cloudRefreshIntervalMs,
} from '../src/lib/cloud-sync-policy.js';

test('active practice keeps the previous refresh and cloud checkpoint cadence', () => {
  assert.equal(cloudRefreshIntervalMs({ currentSession: { id: 'session-1' } }), 10_000);
  assert.equal(ACTIVE_SESSION_REFRESH_INTERVAL_MS, 10_000);
  assert.equal(ACTIVE_SESSION_CLOUD_SYNC_INTERVAL_MS, 5_000);
});

test('idle pages switch to the lower refresh frequency', () => {
  assert.equal(cloudRefreshIntervalMs({ currentSession: null }), 120_000);
  assert.equal(cloudRefreshIntervalMs({}), 120_000);
  assert.equal(cloudRefreshIntervalMs(null), 120_000);
});
