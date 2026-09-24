import type { DeckState } from '../state/types'

export type BpmSource = 'manual' | 'detected' | 'tag'

export function originBpm(deck: Pick<DeckState, 'bpmManual' | 'bpmDetected' | 'bpmTag'>): {
  value: number
  source: BpmSource
} | null {
  if (deck.bpmManual !== null && deck.bpmManual > 0) return { value: deck.bpmManual, source: 'manual' }
  if (deck.bpmDetected !== null && deck.bpmDetected > 0) return { value: deck.bpmDetected, source: 'detected' }
  if (deck.bpmTag !== null && deck.bpmTag > 0) return { value: deck.bpmTag, source: 'tag' }
  return null
}

export function effectiveBpm(origin: number | null, rate: number): number | null {
  if (origin === null || !Number.isFinite(origin) || !Number.isFinite(rate) || rate <= 0) return null
  return origin * rate
}

export function rateFromPitchPercent(percent: number): number {
  return 1 + percent / 100
}

export function pitchPercentFromRate(rate: number): number {
  return (rate - 1) * 100
}

export function syncRate(masterOrigin: number, masterRate: number, slaveOrigin: number): number | null {
  if (!(masterOrigin > 0) || !(slaveOrigin > 0) || !(masterRate > 0)) return null
  const rate = (masterOrigin * masterRate) / slaveOrigin
  if (!Number.isFinite(rate) || rate <= 0) return null
  return rate
}

export function fitsPitchRange(percent: number, range: number): boolean {
  return percent >= -range && percent <= range
}

export function loopBoundsFromBeats(
  positionSec: number,
  beats: number,
  origin: number,
  durationSec: number,
): { inSec: number; outSec: number } | null {
  if (!(beats > 0) || !(origin > 0) || !(durationSec > 0)) return null
  const length = (beats * 60) / origin
  const inSec = Math.min(Math.max(positionSec, 0), durationSec)
  const outSec = inSec + length
  if (!(outSec > inSec) || outSec > durationSec + 0.0001) return null
  return { inSec, outSec: Math.min(outSec, durationSec) }
}

export function scaleBpm(value: number, factor: number): number | null {
  if (!(value > 0) || !(factor > 0)) return null
  const next = value * factor
  if (next < 40 || next > 240) return null
  return Math.round(next * 10) / 10
}
