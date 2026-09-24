import { describe, expect, it } from 'vitest'
import { formatDb, formatPercent, formatTime } from '../src/ui/formatTime'

describe('formatTime', () => {
  it('formats minutes, seconds and tenths from a real position', () => {
    expect(formatTime(0)).toBe('0:00.0')
    expect(formatTime(65.24)).toBe('1:05.2')
    expect(formatTime(3723.4)).toBe('1:02:03.4')
  })

  it('does not invent a time for invalid numbers', () => {
    expect(formatTime(Number.NaN)).toBe('0:00.0')
    expect(formatTime(-4)).toBe('0:00.0')
  })
})

describe('level labels', () => {
  it('formats volume and eq from the stored values', () => {
    expect(formatPercent(0.8)).toBe('80%')
    expect(formatDb(0)).toBe('0 dB')
    expect(formatDb(6)).toBe('+6 dB')
    expect(formatDb(-26)).toBe('-26 dB')
  })
})
