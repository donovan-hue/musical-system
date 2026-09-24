import { clamp01 } from '../util/clamp'

/** Equal-power crossfade. 0 is full A, 1 is full B, 0.5 is about −3 dB each. */
export function crossfaderGains(position: number): { a: number; b: number } {
  const x = clamp01(position)
  if (x === 0) return { a: 1, b: 0 }
  if (x === 1) return { a: 0, b: 1 }
  const angle = x * (Math.PI / 2)
  return {
    a: Math.cos(angle),
    b: Math.sin(angle),
  }
}
