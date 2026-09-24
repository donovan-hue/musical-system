import { clamp } from '../util/clamp'

export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index] ?? 0
    sum += sample * sample
  }
  return Math.sqrt(sum / samples.length)
}

/** Maps RMS to a 0..1 meter. −60 dBFS is empty, 0 dBFS is full. */
export function meterFromRms(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  const db = 20 * Math.log10(value)
  return clamp((db + 60) / 60, 0, 1)
}

export function logBands(frequencies: Uint8Array, bars: number): number[] {
  const count = Math.max(1, bars)
  const result = new Array<number>(count).fill(0)
  if (frequencies.length === 0) return result
  const maxBin = frequencies.length - 1
  for (let bar = 0; bar < count; bar += 1) {
    const startRatio = bar / count
    const endRatio = (bar + 1) / count
    const start = Math.min(maxBin, Math.floor(maxBin * startRatio * startRatio))
    const end = Math.max(start + 1, Math.min(frequencies.length, Math.ceil(maxBin * endRatio * endRatio)))
    let peak = 0
    for (let bin = start; bin < end; bin += 1) {
      const value = frequencies[bin] ?? 0
      if (value > peak) peak = value
    }
    result[bar] = peak / 255
  }
  return result
}
