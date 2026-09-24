import { describe, expect, it } from 'vitest';
import { computePeaks, estimateBpm } from '../src/audio/analysis.js';

const SR = 44100;

/** Synthesize a kick-drum pulse train at a given tempo. */
function makeKickTrain(bpm: number, seconds: number, sampleRate = SR): Float32Array {
  const out = new Float32Array(Math.floor(seconds * sampleRate));
  const beat = 60 / bpm;
  const burst = Math.floor(0.05 * sampleRate);
  for (let beatIndex = 0; beatIndex * beat < seconds; beatIndex++) {
    const start = Math.floor(beatIndex * beat * sampleRate);
    for (let i = 0; i < burst && start + i < out.length; i++) {
      const env = Math.exp(-i / (0.008 * sampleRate));
      out[start + i] = Math.sin((2 * Math.PI * 55 * i) / sampleRate) * env * 0.9;
    }
  }
  return out;
}

describe('computePeaks', () => {
  it('takes the absolute max per bucket', () => {
    const data = Float32Array.from([0, 0.1, -0.5, 0.25, 0.9, -0.9, 0, 0.2]);
    const peaks = computePeaks(data, 4);
    const expected = [0.1, 0.5, 0.9, 0.2];
    expect([...peaks].map((v, i) => [v, expected[i]])).toHaveLength(4);
    peaks.forEach((v, i) => expect(v).toBeCloseTo(expected[i]!, 5));
  });

  it('returns zeros for silence and handles empty input', () => {
    expect([...computePeaks(new Float32Array(100), 10)]).toEqual(new Array<number>(10).fill(0));
    expect(computePeaks(new Float32Array(0), 8).length).toBe(8);
  });
});

describe('estimateBpm', () => {
  it('finds 120 BPM in a steady kick train', () => {
    const bpm = estimateBpm(makeKickTrain(120, 30), SR);
    expect(bpm).not.toBeNull();
    expect(Math.abs(bpm! - 120)).toBeLessThanOrEqual(2);
  });

  it('finds 90 BPM', () => {
    const bpm = estimateBpm(makeKickTrain(90, 30), SR);
    expect(bpm).not.toBeNull();
    expect(Math.abs(bpm! - 90)).toBeLessThanOrEqual(2);
  });

  it('finds 140 BPM', () => {
    const bpm = estimateBpm(makeKickTrain(140, 30), SR);
    expect(bpm).not.toBeNull();
    expect(Math.abs(bpm! - 140)).toBeLessThanOrEqual(2);
  });

  it('returns null for silence', () => {
    expect(estimateBpm(new Float32Array(SR * 10), SR)).toBeNull();
  });

  it('returns null for degenerate input', () => {
    expect(estimateBpm(new Float32Array(10), SR)).toBeNull();
    expect(estimateBpm(makeKickTrain(120, 5), 0)).toBeNull();
  });
});
