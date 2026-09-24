/**
 * PCM analysis helpers. Everything here is pure math over Float32Array so it
 * runs (and is tested) outside the browser; only decodeAudioBytes touches
 * the Web Audio API.
 */

/** Absolute peak per bucket from mono PCM — the waveform drawing data. */
export function computePeaks(data: Float32Array, buckets: number): Float32Array {
  const out = new Float32Array(Math.max(1, buckets));
  if (data.length === 0) return out;
  const size = data.length / out.length;
  for (let b = 0; b < out.length; b++) {
    const start = Math.floor(b * size);
    const end = Math.min(data.length, Math.floor((b + 1) * size));
    let peak = 0;
    for (let i = start; i < end; i++) {
      const abs = Math.abs(data[i]!);
      if (abs > peak) peak = abs;
    }
    out[b] = peak;
  }
  return out;
}

/** Average all channels of a decoded buffer into mono. */
export function toMono(getChannel: (index: number) => Float32Array, channels: number, length: number): Float32Array {
  if (channels <= 1) return getChannel(0).slice();
  const mono = new Float32Array(length);
  for (let c = 0; c < channels; c++) {
    const data = getChannel(c);
    for (let i = 0; i < length; i++) mono[i] = (mono[i] ?? 0) + data[i]! / channels;
  }
  return mono;
}

/**
 * Estimate tempo from an onset envelope via autocorrelation, restricted to
 * [minBpm, maxBpm]. Returns null for silence (or degenerate input).
 */
export function estimateBpm(
  data: Float32Array,
  sampleRate: number,
  minBpm = 70,
  maxBpm = 180,
): number | null {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return null;
  if (data.length < sampleRate / 2) return null; // Under half a second: unusable.

  // 1. Energy envelope at ~86 fps (hop 512 @ 44.1 kHz).
  const hop = 512;
  const frames = Math.floor(data.length / hop);
  if (frames < 16) return null;
  const env = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    const base = f * hop;
    for (let i = 0; i < hop; i++) {
      const v = data[base + i]!;
      sum += v * v;
    }
    env[f] = Math.sqrt(sum / hop);
  }

  // 2. Half-wave-rectified difference → onset strength.
  const onset = new Float32Array(frames);
  for (let i = 1; i < frames; i++) onset[i] = Math.max(0, env[i]! - env[i - 1]!);

  // 3. Autocorrelation over lags inside the BPM window.
  const framesPerSecond = sampleRate / hop;
  const lagMin = Math.max(1, Math.floor((60 / maxBpm) * framesPerSecond));
  const lagMax = Math.min(frames - 2, Math.ceil((60 / minBpm) * framesPerSecond));
  if (lagMax <= lagMin) return null;

  let bestLag = -1;
  let bestScore = 0;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let score = 0;
    for (let i = 0; i + lag < frames; i++) score += onset[i]! * onset[i + lag]!;
    score /= frames - lag;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  if (bestLag < 0 || bestScore <= 0) return null;

  const bpm = (60 * framesPerSecond) / bestLag;
  if (!Number.isFinite(bpm)) return null;
  return Math.round(bpm * 10) / 10;
}

/** Decode compressed bytes using any BaseAudioContext (never throws). */
export async function decodeAudioBytes(
  ctx: BaseAudioContext,
  bytes: ArrayBuffer,
): Promise<AudioBuffer | null> {
  try {
    return await ctx.decodeAudioData(bytes.slice(0));
  } catch {
    return null;
  }
}
