import { describe, expect, it } from 'vitest';
import { beatLoop, beatSeconds, computeChroma, estimateKey, keyFromChroma, quantizeToBeat } from '../src/audio/key.js';

const SR = 11025; // suficiente para pitch classes hasta ~5 kHz

/** Síntesis simple de una nota (seno con envolvente). */
function tone(data: Float32Array, freq: number, startSec: number, durSec: number): void {
  const start = Math.floor(startSec * SR);
  const len = Math.floor(durSec * SR);
  for (let i = 0; i < len && start + i < data.length; i++) {
    const env = Math.min(1, i / 800, (len - i) / 800);
    data[start + i] = (data[start + i] ?? 0) + Math.sin((2 * Math.PI * freq * i) / SR) * 0.3 * env;
  }
}

describe('computeChroma + keyFromChroma', () => {
  it('concentra energía en la clase de pitch correcta (A)', () => {
    const data = new Float32Array(SR * 4);
    // A3, A4, A5
    tone(data, 220, 0, 1.3);
    tone(data, 440, 1.3, 1.3);
    tone(data, 880, 2.6, 1.3);
    const chroma = computeChroma(data, SR);
    let total = 0;
    for (const v of chroma) total += v;
    expect(total).toBeCloseTo(1, 2);
    const aIndex = 9; // A
    expect(chroma[aIndex]).toBeGreaterThan(0.25);
    // y mayor que las vecinas
    expect(chroma[aIndex]).toBeGreaterThan(chroma[8]!);
    expect(chroma[aIndex]).toBeGreaterThan(chroma[10]!);
  });

  it('clasifica un acorde/trío con tónica A', () => {
    // Trío La menor amplio: A2 A3, C4, E4, A4 repetido
    const data = new Float32Array(SR * 6);
    const parts: [number, number, number][] = [
      [110, 0, 1.5], [220, 0, 1.5], [261.63, 1.5, 1.5], [329.63, 1.5, 1.5],
      [440, 3, 1.5], [220, 4.5, 1.5],
    ];
    for (const [freq, at, dur] of parts) tone(data, freq, at, dur);
    const key = estimateKey(data, SR);
    expect(key).not.toBeNull();
    expect(key!.tonic).toBe('A');
    expect(['major', 'minor']).toContain(key!.mode);
    expect(key!.label).toMatch(/^A/);
  });

  it('devuelve null sin señal', () => {
    expect(estimateKey(new Float32Array(SR * 2), SR)).toBeNull();
    expect(keyFromChroma(new Float32Array(12))).toBeNull();
  });
});

describe('beat math (loops cuantizados)', () => {
  it('segundos por beat con pitch acoplado', () => {
    expect(beatSeconds(120, 1)).toBeCloseTo(0.5, 5);
    expect(beatSeconds(120, 1.04)).toBeCloseTo(0.5 / 1.04, 5);
    expect(beatSeconds(NaN, 1)).toBeNull();
    expect(beatSeconds(0, 1)).toBeNull();
  });

  it('cuantiza al beat más cercano', () => {
    expect(quantizeToBeat(0.62, 0.5)).toBeCloseTo(0.5, 5);
    expect(quantizeToBeat(0.76, 0.5)).toBeCloseTo(1.0, 5);
    expect(quantizeToBeat(3.1, 0.5, 0.1)).toBeCloseTo(3.1, 5);
  });

  it('construye loops de N beats alineados a la rejilla', () => {
    const loop = beatLoop(0.62, 0.5, 4, 30);
    expect(loop).not.toBeNull();
    expect(loop!.start).toBeCloseTo(0.5, 5);
    expect(loop!.end).toBeCloseTo(2.5, 5);

    expect(beatLoop(29.9, 0.5, 4, 30)).toBeNull(); // no cabe
    expect(beatLoop(1, 0, 4, 30)).toBeNull();
  });
});
