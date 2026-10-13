import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePianoFrame, PianoEvidenceGate } from '../src/audio/classifier.js';

function harmonicFrame() {
  const sampleRate = 48_000;
  const samples = new Float32Array(4096);
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate;
    samples[i] = 0.018 * (Math.sin(2 * Math.PI * 220 * t) + 0.5 * Math.sin(2 * Math.PI * 440 * t) + 0.25 * Math.sin(2 * Math.PI * 660 * t));
  }
  return { samples, sampleRate };
}

test('live detector controls change volume and pitch-range qualification', () => {
  const { samples, sampleRate } = harmonicFrame();
  const baseline = analyzePianoFrame(samples, sampleRate, { minVolume: 0.001, minFrequencyHz: 100, maxFrequencyHz: 500, minHarmonicity: 0.1 });
  const tooQuiet = analyzePianoFrame(samples, sampleRate, { minVolume: 0.5, minFrequencyHz: 100, maxFrequencyHz: 500, minHarmonicity: 0.1 });
  const outOfRange = analyzePianoFrame(samples, sampleRate, { minVolume: 0.001, minFrequencyHz: 500, maxFrequencyHz: 1000, minHarmonicity: 0.1 });
  assert.equal(baseline.pitched, true);
  assert.equal(tooQuiet.pitched, false);
  assert.equal(outOfRange.pitched, false);
});

test('live detection gate uses configurable confidence', () => {
  const gate = new PianoEvidenceGate({ minConfidence: 0.6 });
  const evidence = { reliable: true, pitched: true, score: 0.7 };
  assert.deepEqual([gate.push(evidence, 0), gate.push(evidence, 1), gate.push(evidence, 2)], ['silent', 'silent', 'playing']);
  gate.minConfidence = 0.8;
  assert.deepEqual([gate.push(evidence, 3), gate.push(evidence, 4), gate.push(evidence, 5)], ['playing', 'playing', 'silent']);
});
