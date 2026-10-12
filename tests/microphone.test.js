import test from 'node:test';
import assert from 'node:assert/strict';
import { microphoneErrorMessage, requestMicrophone } from '../src/lib/microphone.js';

test('microphone requests broad browser-compatible audio constraints', async () => {
  let requested;
  const stream = { getTracks: () => [] };
  const result = await requestMicrophone((constraints) => {
    requested = constraints;
    return Promise.resolve(stream);
  }, 100);
  assert.deepEqual(requested, { audio: true });
  assert.equal(result, stream);
});

test('late microphone permission is stopped after the startup timeout', async () => {
  let resolveRequest;
  let stopped = 0;
  const pending = new Promise((resolve) => { resolveRequest = resolve; });
  await assert.rejects(requestMicrophone(() => pending, 5), { name: 'TimeoutError' });
  resolveRequest({ getTracks: () => [{ stop: () => stopped++ }] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(stopped, 1);
});

test('microphone failures explain actionable permission and timeout steps', () => {
  assert.match(microphoneErrorMessage({ name: 'NotAllowedError' }), /permission is blocked/i);
  assert.match(microphoneErrorMessage({ name: 'TimeoutError' }), /did not start the microphone in time/i);
});
