import test from 'node:test';
import assert from 'node:assert/strict';
import { SmartTimer, TIMER_STATES } from '../src/lib/smart-timer.js';

test('initial silence earns no time; the first detected note starts credit', () => {
  const t = new SmartTimer({ thresholdMs: 20_000, nowMs: 0 });
  t.punchIn(0);
  t.update('silent', 20_000);
  t.update('playing', 25_000);
  t.update('playing', 35_000);
  assert.equal(t.snapshot(35_000).activeMs, 10_000);
  assert.equal(t.snapshot(35_000).state, TIMER_STATES.PLAYING);
});

test('short gaps are provisional, then commit if playing resumes', () => {
  const t = new SmartTimer({ thresholdMs: 20_000 });
  t.punchIn(0); t.update('playing', 1_000); t.update('playing', 11_000);
  t.update('silent', 12_000);
  t.tick(18_000);
  assert.equal(t.snapshot(18_000).provisionalMs, 6_000);
  t.update('playing', 18_000);
  assert.equal(t.snapshot(18_000).activeMs, 17_000);
  assert.equal(t.snapshot(18_000).provisionalMs, 0);
});

test('extended silence discards the whole provisional gap, including its first 20 seconds', () => {
  const t = new SmartTimer({ thresholdMs: 20_000 });
  t.punchIn(0); t.update('playing', 1_000); t.update('playing', 11_000);
  t.update('silent', 12_000); t.tick(32_000);
  assert.equal(t.snapshot(32_000).state, TIMER_STATES.PAUSED);
  assert.equal(t.snapshot(32_000).activeMs, 11_000);
  assert.equal(t.snapshot(32_000).provisionalMs, 0);
  t.update('playing', 40_000);
  assert.equal(t.snapshot(40_000).state, TIMER_STATES.PLAYING);
  assert.equal(t.snapshot(40_000).activeMs, 11_000);
});

test('microphone loss discards unresolved time and freezes credit until a new classification', () => {
  const t = new SmartTimer({ thresholdMs: 20_000 });
  t.punchIn(0); t.update('playing', 1_000); t.update('playing', 6_000);
  t.update('silent', 7_000); t.microphoneLost(10_000); t.tick(50_000);
  assert.equal(t.snapshot(50_000).state, TIMER_STATES.UNAVAILABLE);
  assert.equal(t.snapshot(50_000).activeMs, 6_000);
  t.update('playing', 51_000);
  assert.equal(t.snapshot(51_000).activeMs, 6_000);
  assert.equal(t.snapshot(51_000).state, TIMER_STATES.PLAYING);
});

test('punching out finalizes verified playing and excludes an unresolved gap', () => {
  const t = new SmartTimer({ thresholdMs: 20_000 });
  t.punchIn(0); t.update('playing', 1_000); t.update('playing', 11_000); t.update('silent', 12_000);
  const result = t.punchOut(15_000);
  assert.equal(result.activeMs, 11_000);
  assert.equal(result.elapsedMs, 15_000);
  assert.equal(result.state, TIMER_STATES.ENDED);
});
