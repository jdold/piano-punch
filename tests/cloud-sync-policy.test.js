import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ACTIVE_SESSION_CLOUD_SYNC_INTERVAL_MS } from '../src/lib/cloud-sync-policy.js';

test('practice keeps five-second cloud checkpoints without background state polling', async () => {
  assert.equal(ACTIVE_SESSION_CLOUD_SYNC_INTERVAL_MS, 5_000);
  const app = await readFile(new URL('../src/lib/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /scheduleCloudRefresh|refreshCloudState|cloudRefreshIntervalMs|IDLE_REFRESH_INTERVAL_MS/);
});
