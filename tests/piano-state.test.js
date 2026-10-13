import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, loadState, saveState, STORAGE_KEY, ensureFamilyProfiles } from '../src/lib/piano-state.js';

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
