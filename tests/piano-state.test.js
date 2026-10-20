import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, loadState, saveState, STORAGE_KEY, ensureFamilyProfiles, ensureKidProfiles, settlePracticeDay, reconcilePracticeDay, completedDates, currentStreak, recalculateChildAwards, mergeParentActivity } from '../src/lib/piano-state.js';

test('family profile names survive a saved-state reload', () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const state = initialState();
  state.children[0].name = 'Gordon';
  state.children[1].name = 'Caroline';
  saveState(state, storage);
  const restored = loadState(storage);
  assert.equal(values.has(STORAGE_KEY), true);
  assert.deepEqual(restored.children.map((child) => child.name), ['Gordon', 'Caroline', 'Emma']);
});

test('each child gets a distinct default theme and custom choices survive migration', () => {
  const state = initialState();
  assert.deepEqual(state.children.map(({ id, theme }) => [id, theme]), [
    ['son', 'orange'], ['daughter', 'yellow'], ['emma', 'blue'],
  ]);

  state.children[0].theme = 'purple';
  state.children[1].theme = 'not-a-theme';
  assert.equal(ensureFamilyProfiles(state), true);
  assert.deepEqual(state.children.map((child) => child.theme), ['purple', 'yellow', 'blue']);
  assert.equal(ensureFamilyProfiles(state), false);
});

test('legacy two-child cloud state gains Emma and instrument defaults once', () => {
  const state = initialState();
  state.children = state.children.slice(0, 2);
  state.children.forEach((child) => { delete child.detector; delete child.instrumentType; });
  assert.equal(ensureFamilyProfiles(state), true);
  assert.deepEqual(state.children.map(({ name, instrumentType }) => [name, instrumentType]), [
    ['Gordon', 'digital_keyboard'], ['Caroline', 'acoustic_piano'], ['Emma', 'cello'],
  ]);
  assert.equal(ensureFamilyProfiles(state), false);
});

test('kid profile migration repairs old settings without adding unsaved profiles', () => {
  const state = initialState();
  state.children = state.children.slice(0, 2);
  state.children.forEach((child) => { delete child.detector; delete child.instrumentType; });
  ensureKidProfiles(state);
  assert.deepEqual(state.children.map((child) => child.instrumentType), ['digital_keyboard', 'acoustic_piano']);
  assert.equal(state.children.length, 2);
});

test('live verified goal time awards daily points once before punch-out', () => {
  const state = initialState();
  const first = settlePracticeDay(state, 'son', '2026-10-12', 20 * 60_000);
  const again = settlePracticeDay(state, 'son', '2026-10-12', 20 * 60_000);
  assert.equal(first.completed, true);
  assert.equal(state.ledger.filter((row) => row.type === 'daily_goal').length, 1);
  assert.equal(state.ledger.filter((row) => row.type === 'practice_day').length, 1);
  assert.equal(again.ledger.length, first.ledger.length);
});

test('an interrupted session reverses provisional goal awards until parent review', () => {
  const state = initialState();
  settlePracticeDay(state, 'son', '2026-10-12', 20 * 60_000);
  state.sessions.push({ childId:'son', date:'2026-10-12', creditedMs:20 * 60_000, status:'interrupted' });
  settlePracticeDay(state, 'son', '2026-10-12');
  reconcilePracticeDay(state, 'son', '2026-10-12', 'interrupted-test');
  assert.equal(state.ledger.reduce((sum, row) => sum + row.points, 0), 0);
});

test('a celebrated 30-minute goal still counts if the tab later recovers the session as interrupted', () => {
  const state = initialState();
  const child = state.children[0];
  state.sessions.push(
    { id:'prior-day', childId:child.id, date:'2026-10-15', creditedMs:30*60_000, status:'complete' },
    { id:'celebrated-interruption', childId:child.id, date:'2026-10-16', creditedMs:30*60_000, elapsedMs:32*60_000, status:'interrupted', goalCelebrated:true },
  );
  assert.deepEqual(completedDates(state, child), ['2026-10-15', '2026-10-16']);
  assert.equal(currentStreak(state, child, '2026-10-16'), 2);
  assert.equal(recalculateChildAwards(state, child.id), undefined);
  assert.equal(state.ledger.some((row)=>row.type==='daily_goal'&&row.sourceId==='2026-10-16'), true);
});

test('a logged lesson counts as a practice day without adding playing minutes', () => {
  const state = initialState();
  const child = state.children[0];
  state.lessonSessions.push({ id:'lesson-1', childId:child.id, date:'2026-10-12', durationMinutes:30, notes:'Scales and recital piece' });
  recalculateChildAwards(state, child.id);
  assert.deepEqual(completedDates(state, child), ['2026-10-12']);
  assert.equal(currentStreak(state, child, '2026-10-12'), 1);
  assert.equal(state.sessions.length, 0);
  assert.equal(state.ledger.some((row)=>row.type==='daily_goal'&&row.sourceId==='2026-10-12'), true);
  assert.equal(state.ledger.some((row)=>row.type==='practice_day'&&row.sourceId==='2026-10-12'), true);
  assert.equal(state.ledger.some((row)=>row.type==='extra_minutes'), false);
});

test('parent hydration recovers locally saved practice missing from cloud state', () => {
  const remote = initialState();
  const local = structuredClone(remote);
  local.sessions.push({ id:'manual-1', childId:'son', date:'2026-10-19', startedAt:'2026-10-19T12:00:00.000Z', endedAt:'2026-10-19T12:30:00.000Z', elapsedMs:30*60_000, creditedMs:30*60_000, status:'complete', events:[] });
  const merged = mergeParentActivity(remote, local);
  assert.equal(merged.changed, true);
  assert.equal(merged.state.sessions[0].id, 'manual-1');
  assert.equal(merged.state.children[0].goalMinutes, remote.children[0].goalMinutes);
});

test('parent merge keeps a local goal celebration when cloud has the interrupted session without it', () => {
  const remote = initialState();
  const local = structuredClone(remote);
  const base = { id:'session-1', childId:'son', date:'2026-10-19', startedAt:'2026-10-19T12:00:00.000Z', endedAt:'2026-10-19T12:40:00.000Z', elapsedMs:40*60_000, creditedMs:30*60_000, status:'interrupted', events:[] };
  remote.sessions.push({ ...base, goalCelebrated:false });
  local.sessions.push({ ...base, goalCelebrated:true });
  const merged = mergeParentActivity(remote, local);
  assert.equal(merged.state.sessions[0].goalCelebrated, true);
  assert.equal(completedDates(merged.state, merged.state.children[0]).includes('2026-10-19'), true);
});

test('parent sync conflict preserves the local child setting changed since last sync', () => {
  const baseline = initialState();
  const latest = structuredClone(baseline);
  latest.children[1].theme = 'purple';
  const local = structuredClone(baseline);
  local.children[0].goalMinutes = 35;
  const merged = mergeParentActivity(latest, local, baseline);
  assert.equal(merged.state.children[0].goalMinutes, 35);
  assert.equal(merged.state.children[1].theme, 'purple');
});
