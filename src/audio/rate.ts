import { clamp } from '../util/format.js';

/** Pitch fader span: ±8 %, vinyl-style (pitch and tempo coupled). */
export const PITCH_RANGE = 0.08;

export function clampRate(rate: number): number {
  return clamp(rate, 1 - PITCH_RANGE, 1 + PITCH_RANGE);
}

/** BPM a deck plays right now, given its base BPM and current rate. */
export function effectiveBpm(baseBpm: number | null | undefined, rate: number): number | null {
  if (baseBpm == null || !Number.isFinite(baseBpm) || baseBpm <= 0) return null;
  return baseBpm * rate;
}

/**
 * Rate that makes a deck match `targetBpm` from its own `baseBpm`.
 * Returns null when the match would fall outside the pitch fader range.
 */
export function syncRate(baseBpm: number, targetBpm: number): number | null {
  if (!Number.isFinite(baseBpm) || baseBpm <= 0) return null;
  if (!Number.isFinite(targetBpm) || targetBpm <= 0) return null;
  const rate = targetBpm / baseBpm;
  if (rate < 1 - PITCH_RANGE || rate > 1 + PITCH_RANGE) return null;
  return rate;
}
