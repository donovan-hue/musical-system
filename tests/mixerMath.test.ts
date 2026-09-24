import { describe, expect, it } from 'vitest';
import { crossfadeGains } from '../src/audio/crossfade.js';
import { effectiveBpm, PITCH_RANGE, syncRate, clampRate } from '../src/audio/rate.js';

describe('crossfadeGains (equal power)', () => {
  it('is hard left / right at the extremes', () => {
    expect(crossfadeGains(0).a).toBe(1);
    expect(crossfadeGains(0).b).toBeCloseTo(0, 12);
    expect(crossfadeGains(1).a).toBeCloseTo(0, 12);
    expect(crossfadeGains(1).b).toBe(1);
  });

  it('keeps constant power across the travel', () => {
    for (let x = 0; x <= 1.0001; x += 0.05) {
      const { a, b } = crossfadeGains(x);
      expect(a * a + b * b).toBeCloseTo(1, 5);
    }
  });

  it('sits both decks at -3 dB in the center', () => {
    const { a, b } = crossfadeGains(0.5);
    expect(a).toBeCloseTo(Math.SQRT1_2, 5);
    expect(b).toBeCloseTo(Math.SQRT1_2, 5);
  });

  it('clamps out-of-range positions', () => {
    expect(crossfadeGains(-2).a).toBe(1);
    expect(crossfadeGains(7).b).toBe(1);
  });
});

describe('rate math', () => {
  it('computes effective BPM from base and rate', () => {
    expect(effectiveBpm(120, 1)).toBe(120);
    expect(effectiveBpm(120, 1.02)).toBeCloseTo(122.4, 5);
    expect(effectiveBpm(null, 1.5)).toBeNull();
    expect(effectiveBpm(Number.NaN, 1)).toBeNull();
  });

  it('syncs within the pitch range', () => {
    expect(syncRate(120, 120)).toBe(1);
    expect(syncRate(120, 126)).toBeCloseTo(1.05, 5);
    const edge = 1 + PITCH_RANGE;
    expect(syncRate(100, 100 * edge)).toBeCloseTo(edge, 5);
  });

  it('refuses sync outside the pitch range', () => {
    expect(syncRate(100, 200)).toBeNull();
    expect(syncRate(200, 100)).toBeNull();
    expect(syncRate(0, 120)).toBeNull();
    expect(syncRate(120, Number.NaN)).toBeNull();
  });

  it('clamps manual rates into the fader span', () => {
    expect(clampRate(2)).toBeCloseTo(1 + PITCH_RANGE, 5);
    expect(clampRate(0.1)).toBeCloseTo(1 - PITCH_RANGE, 5);
    expect(clampRate(1.03)).toBeCloseTo(1.03, 5);
  });
});
