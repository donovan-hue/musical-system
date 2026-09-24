import { describe, expect, it } from 'vitest'
import { crossfaderGains } from '../src/audio/CrossfaderLaw'

describe('crossfaderGains', () => {
  it('keeps only deck A at the left end', () => {
    expect(crossfaderGains(0)).toEqual({ a: 1, b: 0 })
  })

  it('keeps only deck B at the right end', () => {
    expect(crossfaderGains(1)).toEqual({ a: 0, b: 1 })
  })

  it('mixes both decks at equal power in the center', () => {
    const gains = crossfaderGains(0.5)
    expect(gains.a).toBeCloseTo(Math.SQRT1_2, 5)
    expect(gains.b).toBeCloseTo(Math.SQRT1_2, 5)
    expect(gains.a ** 2 + gains.b ** 2).toBeCloseTo(1, 5)
  })

  it('clamps positions outside 0..1', () => {
    expect(crossfaderGains(-2)).toEqual({ a: 1, b: 0 })
    expect(crossfaderGains(4)).toEqual({ a: 0, b: 1 })
  })

  it('moves energy from A toward B', () => {
    const left = crossfaderGains(0.25)
    const right = crossfaderGains(0.75)
    expect(left.a).toBeGreaterThan(left.b)
    expect(right.b).toBeGreaterThan(right.a)
    expect(left.a).toBeGreaterThan(right.a)
    expect(right.b).toBeGreaterThan(left.b)
  })
})
