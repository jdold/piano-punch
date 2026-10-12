import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, loadState, saveState, STORAGE_KEY } from '../src/lib/piano-state.js';

test('family profile names survive a saved-state reload', () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const state = initialState();
  state.children[0].name = 'Gordon';
  state.children[1].name = 'Caroline';
  saveState(state, storage);
  const restored = loadState(storage);
  assert.equal(values.has(STORAGE_KEY), true);
  assert.deepEqual(restored.children.map((child) => child.name), ['Gordon', 'Caroline']);
});
