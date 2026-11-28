import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ACTIVE_SESSION_CLOUD_SYNC_INTERVAL_MS, LOCAL_SESSION_CHECKPOINT_INTERVAL_MS, IDLE_REFRESH_INTERVAL_MS, shouldRefreshCloud } from '../src/lib/cloud-sync-policy.js';

test('practice checkpoints locally every five seconds and syncs only the active session every thirty seconds', async () => {
  assert.equal(LOCAL_SESSION_CHECKPOINT_INTERVAL_MS, 5_000);
  assert.equal(ACTIVE_SESSION_CLOUD_SYNC_INTERVAL_MS, 30_000);
  const app = await readFile(new URL('../src/lib/app.js', import.meta.url), 'utf8');
  assert.equal(IDLE_REFRESH_INTERVAL_MS, 3_600_000);
  assert.match(app, /queueCloudSync\(\{ checkpointOnly: true \}\)/);
  assert.match(app, /fetch\('\/api\/kid-checkpoint'/);
  assert.match(app, /snapshot\.currentSession, revision: cloudRevision/);
  assert.match(app, /LOCAL_SESSION_CHECKPOINT_INTERVAL_MS/);
});


test('idle refresh waits at least a minute after a read and never interrupts practice or a save', () => {
  const idle = { hidden:false, active:false, pending:false, lastReadAt:0, now:60_000 };
  assert.equal(shouldRefreshCloud(idle), true);
  assert.equal(shouldRefreshCloud({...idle,now:59_999}), false);
  for (const field of ['hidden','active','pending']) assert.equal(shouldRefreshCloud({...idle,[field]:true,force:true}), false);
});
