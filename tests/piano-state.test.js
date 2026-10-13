import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, loadState, saveState, STORAGE_KEY, ensureFamilyProfiles, ensureKidProfiles, settlePracticeDay, reconcilePracticeDay } from '../src/lib/piano-state.js';

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
