import { describe, expect, it } from 'vitest'
import { PositionClock } from '../src/audio/PositionClock'
import { resolvePlayOffset } from '../src/audio/playback'

describe('PositionClock', () => {
  it('stays at the paused offset instead of following the context clock', () => {
    const clock = new PositionClock()
    clock.setDuration(180)
    clock.play(10, 4)
    expect(clock.getPosition(12)).toBeCloseTo(6)
    expect(clock.pause(15)).toBeCloseTo(9)
    expect(clock.getPosition(40)).toBeCloseTo(9)
    expect(clock.isPlaying()).toBe(false)
  })

  it('restarts the anchor when playback resumes', () => {
    const clock = new PositionClock()
    clock.setDuration(90)
    clock.play(1, 8)
    clock.pause(4)
    clock.play(20, 11)
    expect(clock.getPosition(22.5)).toBeCloseTo(13.5)
  })

  it('seeks while playing without using wall time', () => {
    const clock = new PositionClock()
    clock.setDuration(60)
    clock.play(5, 0)
    expect(clock.seek(12, 9)).toBe(12)
    expect(clock.getPosition(11)).toBeCloseTo(14)
  })

  it('changes buffer speed when the rate changes and keeps the position continuous', () => {
    const clock = new PositionClock()
    clock.setDuration(100)
    clock.play(0, 0)
    expect(clock.getPosition(2)).toBeCloseTo(2)
    clock.setRate(2, 2)
    expect(clock.getPosition(2)).toBeCloseTo(2)
    expect(clock.getPosition(3)).toBeCloseTo(4)
  })

  it('wraps inside an enabled loop using buffer time', () => {
    const clock = new PositionClock()
    clock.setDuration(30)
    clock.setLoop({ enabled: true, inSec: 10, outSec: 12 })
    clock.play(0, 10)
    expect(clock.getPosition(1)).toBeCloseTo(11)
    expect(clock.getPosition(3)).toBeCloseTo(11)
  })

  it('clamps to the decoded duration', () => {
    const clock = new PositionClock()
    clock.setDuration(30)
    expect(clock.seek(80, 0)).toBe(30)
    clock.play(0, 29)
    expect(clock.getPosition(5)).toBe(30)
  })
})

describe('resolvePlayOffset', () => {
  it('restarts from the beginning when the playhead is at the end', () => {
    expect(resolvePlayOffset(30, 30)).toBe(0)
    expect(resolvePlayOffset(29.995, 30)).toBe(0)
  })

  it('keeps a mid-track offset', () => {
    expect(resolvePlayOffset(12.5, 40)).toBe(12.5)
  })

  it('returns 0 for an empty duration', () => {
    expect(resolvePlayOffset(4, 0)).toBe(0)
    expect(resolvePlayOffset(Number.NaN, 10)).toBe(0)
  })
})
