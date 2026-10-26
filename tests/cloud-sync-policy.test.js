import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ACTIVE_SESSION_CLOUD_SYNC_INTERVAL_MS, LOCAL_SESSION_CHECKPOINT_INTERVAL_MS } from '../src/lib/cloud-sync-policy.js';

test('practice checkpoints locally every five seconds and syncs only the active session every thirty seconds', async () => {
  assert.equal(LOCAL_SESSION_CHECKPOINT_INTERVAL_MS, 5_000);
  assert.equal(ACTIVE_SESSION_CLOUD_SYNC_INTERVAL_MS, 30_000);
  const app = await readFile(new URL('../src/lib/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /scheduleCloudRefresh|refreshCloudState|cloudRefreshIntervalMs|IDLE_REFRESH_INTERVAL_MS/);
  assert.match(app, /queueCloudSync\(\{ checkpointOnly: true \}\)/);
  assert.match(app, /fetch\('\/api\/kid-checkpoint'/);
  assert.match(app, /snapshot\.currentSession, revision: cloudRevision/);
  assert.match(app, /LOCAL_SESSION_CHECKPOINT_INTERVAL_MS/);
});
