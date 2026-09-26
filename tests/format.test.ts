import { describe, expect, it } from 'vitest';
import { clamp, formatBpm, formatBytes, formatTime, formatTimeTenths } from '../src/util/format.js';

describe('formatTime', () => {
  it('formats seconds as m:ss', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(5)).toBe('0:05');
    expect(formatTime(59.9)).toBe('0:59');
    expect(formatTime(61)).toBe('1:01');
    expect(formatTime(754)).toBe('12:34');
  });

  it('guards against invalid input', () => {
    expect(formatTime(-3)).toBe('0:00');
    expect(formatTime(Number.NaN)).toBe('0:00');
    expect(formatTime(Number.POSITIVE_INFINITY)).toBe('0:00');
  });
});

describe('formatTimeTenths', () => {
  it('formats with tenths', () => {
    expect(formatTimeTenths(0)).toBe('0:00.0');
    expect(formatTimeTenths(61.23)).toBe('1:01.2');
    expect(formatTimeTenths(9.99)).toBe('0:09.9');
    expect(formatTimeTenths(-1)).toBe('0:00.0');
  });
});

describe('formatBytes', () => {
  it('scales units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(3.5 * 1024 * 1024 * 1024)).toBe('3.50 GB');
  });
});

describe('formatBpm', () => {
  it('renders a placeholder for unknown bpm', () => {
    expect(formatBpm(null)).toBe('—');
    expect(formatBpm(undefined)).toBe('—');
    expect(formatBpm(0)).toBe('—');
  });

  it('renders one decimal', () => {
    expect(formatBpm(128)).toBe('128.0');
    expect(formatBpm(124.96)).toBe('125.0');
  });
});

describe('clamp', () => {
  it('clamps into range', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });
});
