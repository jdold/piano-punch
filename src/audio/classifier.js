// Low-cost local heuristic. This returns evidence, not a validated piano identity.
function fft(real, imag) {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = -2 * Math.PI / len;
    const wr0 = Math.cos(angle), wi0 = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let wr = 1, wi = 0;
      for (let j = 0; j < len / 2; j++) {
        const uR = real[i + j], uI = imag[i + j];
        const vR = real[i + j + len / 2] * wr - imag[i + j + len / 2] * wi;
        const vI = real[i + j + len / 2] * wi + imag[i + j + len / 2] * wr;
        real[i + j] = uR + vR; imag[i + j] = uI + vI;
        real[i + j + len / 2] = uR - vR; imag[i + j + len / 2] = uI - vI;
        const nextWr = wr * wr0 - wi * wi0;
        wi = wr * wi0 + wi * wr0; wr = nextWr;
      }
    }
  }
}

export function analyzePianoFrame(samples, sampleRate, settings = {}) {
  const {
    minVolume = 0.003,
    minFrequencyHz = 55,
    maxFrequencyHz = 1200,
    minHarmonicity = 0.25,
  } = settings;
  const n = samples.length;
  if (!n || !sampleRate) return { reliable: false, score: 0, rms: 0 };
  const real = new Float64Array(n), imag = new Float64Array(n);
  let squares = 0, crossings = 0;
  for (let i = 0; i < n; i++) {
    const value = samples[i];
    squares += value * value;
    if (i && (samples[i - 1] < 0) !== (value < 0)) crossings++;
    real[i] = value * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  }
  const rms = Math.sqrt(squares / n);
  if (rms < minVolume) return { reliable: true, score: 0, rms, pitched: false, onset: false };
  fft(real, imag);
  const mags = new Float32Array(n / 2);
  let total = 0, geometric = 0, arithmetic = 0, peakCount = 0;
  for (let i = 2; i < mags.length - 1; i++) {
    const magnitude = Math.hypot(real[i], imag[i]);
    mags[i] = magnitude;
    total += magnitude;
    arithmetic += magnitude;
    geometric += Math.log(magnitude + 1e-9);
    if (magnitude > 0.0001 && magnitude > mags[i - 1]) peakCount++;
  }
  const flatness = Math.exp(geometric / (mags.length - 3)) / (arithmetic / (mags.length - 3) + 1e-9);
  let harmonicScore = 0, fundamentalCount = 0;
  const minBin = Math.max(2, Math.floor(minFrequencyHz * n / sampleRate));
  const maxBin = Math.min(mags.length - 1, Math.floor(maxFrequencyHz * n / sampleRate));
  let strongestFundamental = 0, strongestHarmonics = 0;
  for (let f = minBin; f < maxBin; f++) {
    if (mags[f] < mags[f - 1] || mags[f] < mags[f + 1]) continue;
    const base = mags[f];
    if (base < total * 0.008) continue;
    let partials = 0;
    for (let h = 2; h <= 6; h++) {
      const bin = Math.round(f * h);
      if (bin < mags.length && mags[bin] > base * 0.035) partials++;
    }
    if (partials >= 2) {
      fundamentalCount++;
      harmonicScore += Math.min(1, partials / 4);
      if (base * partials > strongestHarmonics) { strongestHarmonics = base * partials; strongestFundamental = f * sampleRate / n; }
    }
  }
  const harmonicity = Math.min(1, harmonicScore / Math.max(1, fundamentalCount));
  const pitched = flatness < 0.42 && harmonicity > minHarmonicity && fundamentalCount > 0 && peakCount >= 3;
  const onset = crossings > n * 0.01 && rms > minVolume * 2;
  // Confidence requires repeated harmonic/pitched evidence; no volume-only credit.
  const score = Math.max(0, Math.min(1, 0.54 * harmonicity + 0.24 * (1 - flatness) + 0.12 * Math.min(1, peakCount / 18) + 0.1 * Number(onset)));
  return { reliable: true, score, rms, flatness, harmonicity, fundamentalCount, peakCount, fundamentalHz: strongestFundamental || null, pitched, onset };
}

export class PianoEvidenceGate {
  constructor({ minConfidence = 0.72 } = {}) {
    this.minConfidence = minConfidence;
    this.history = [];
    this.lastFrameAt = 0;
  }
  push(features, nowMs) {
    this.lastFrameAt = nowMs;
    this.history.push(Boolean(features?.reliable && features.pitched && features.score >= this.minConfidence));
    if (this.history.length > 5) this.history.shift();
    const hits = this.history.filter(Boolean).length;
    return hits >= 3 ? 'playing' : 'silent';
  }
}
