export type BpmEstimate = {
  bpm: number
  confidence: number
}

const MIN_BPM = 70
const MAX_BPM = 180
const MIN_CONFIDENCE = 0.3
const ANALYSIS_SECONDS = 45

/**
 * Energy-onset autocorrelation. Returns null when the signal has no clear pulse.
 * The result is an estimate, not a ground truth.
 */
export function detectBpm(samples: Float32Array, sampleRate: number): BpmEstimate | null {
  if (!Number.isFinite(sampleRate) || sampleRate < 8000) return null
  const usable = Math.min(samples.length, Math.floor(sampleRate * ANALYSIS_SECONDS))
  if (usable < sampleRate * 4) return null

  const hop = Math.max(1, Math.round(sampleRate / 100))
  const frames = Math.floor(usable / hop)
  if (frames < 200) return null

  const energy = new Float32Array(frames)
  let mean = 0
  for (let frame = 0; frame < frames; frame += 1) {
    let sum = 0
    const start = frame * hop
    for (let offset = 0; offset < hop; offset += 1) {
      const sample = samples[start + offset] ?? 0
      sum += sample * sample
    }
    const value = Math.sqrt(sum / hop)
    energy[frame] = value
    mean += value
  }
  mean /= frames
  if (mean < 1e-5) return null

  const onset = new Float32Array(frames)
  let previous = energy[0] ?? 0
  for (let frame = 0; frame < frames; frame += 1) {
    const value = energy[frame] ?? 0
    const diff = value - previous
    onset[frame] = diff > 0 ? diff : 0
    previous = value
  }

  const frameRate = sampleRate / hop
  const minLag = Math.max(1, Math.round((frameRate * 60) / MAX_BPM))
  const maxLag = Math.min(frames - 2, Math.round((frameRate * 60) / MIN_BPM))
  if (maxLag <= minLag) return null

  let bestLag = 0
  let best = 0
  const scores: number[] = []
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let correlation = 0
    const count = frames - lag
    for (let index = 0; index < count; index += 1) {
      correlation += (onset[index] ?? 0) * (onset[index + lag] ?? 0)
    }
    correlation /= count
    scores.push(correlation)
    if (correlation > best) {
      best = correlation
      bestLag = lag
    }
  }
  if (bestLag === 0 || best <= 0) return null

  const sorted = scores.slice().sort((left, right) => left - right)
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0
  const prominence = best - median
  const confidence = prominence / best
  if (confidence < MIN_CONFIDENCE) return null

  const bpm = (60 * frameRate) / bestLag
  if (!Number.isFinite(bpm) || bpm < MIN_BPM || bpm > MAX_BPM) return null
  return {
    bpm: Math.round(bpm * 10) / 10,
    confidence,
  }
}
