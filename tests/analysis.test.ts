import { describe, expect, it } from 'vitest'
import { detectBpm } from '../src/analysis/bpm'
import { readId3Bpm, readId3Tags } from '../src/analysis/id3Bpm'
import { logBands, meterFromRms } from '../src/analysis/levels'
import { computePeaks, mixChannels } from '../src/analysis/peaks'
import { fitsPitchRange, loopBoundsFromBeats, originBpm, pitchPercentFromRate, syncRate } from '../src/analysis/tempo'

function clickTrack(bpm: number, seconds: number, sampleRate: number): Float32Array {
  const data = new Float32Array(Math.floor(seconds * sampleRate))
  const interval = sampleRate * (60 / bpm)
  for (let beat = 0; beat * interval < data.length; beat += 1) {
    const start = Math.round(beat * interval)
    for (let offset = 0; offset < 12; offset += 1) {
      const index = start + offset
      if (index < data.length) data[index] = 0.9 * (1 - offset / 12)
    }
  }
  return data
}

function id3WithBpm(bpm: string): Uint8Array {
  const text = Uint8Array.from(bpm, (char) => char.charCodeAt(0))
  const frameSize = 1 + text.length
  const frame = new Uint8Array(10 + frameSize)
  frame.set([0x54, 0x42, 0x50, 0x4d], 0)
  frame[4] = (frameSize >>> 24) & 0xff
  frame[5] = (frameSize >>> 16) & 0xff
  frame[6] = (frameSize >>> 8) & 0xff
  frame[7] = frameSize & 0xff
  frame[10] = 0
  frame.set(text, 11)
  const header = new Uint8Array(10)
  header.set([0x49, 0x44, 0x33, 3, 0, 0], 0)
  header[9] = frame.length
  const out = new Uint8Array(10 + frame.length)
  out.set(header, 0)
  out.set(frame, 10)
  return out
}

describe('detectBpm', () => {
  it('estimates a click track and does not invent a tempo for silence', () => {
    const sampleRate = 44100
    const estimate = detectBpm(clickTrack(120, 8, sampleRate), sampleRate)
    expect(estimate).not.toBeNull()
    expect(estimate?.bpm).toBeGreaterThan(118)
    expect(estimate?.bpm).toBeLessThan(122)
    expect(detectBpm(new Float32Array(sampleRate * 8), sampleRate)).toBeNull()
  })

  it('rejects a signal that is too short to analyze', () => {
    expect(detectBpm(clickTrack(120, 1, 44100), 44100)).toBeNull()
  })
})

describe('computePeaks', () => {
  it('stores the real min and max of each block', () => {
    const channel = new Float32Array(4)
    channel[0] = -0.25
    channel[1] = 0.5
    channel[2] = 0.1
    channel[3] = -0.8
    const peaks = computePeaks(channel, 2)
    expect(peaks[0]).toBeCloseTo(-0.25)
    expect(peaks[1]).toBeCloseTo(0.5)
    expect(peaks[2]).toBeCloseTo(-0.8)
    expect(peaks[3]).toBeCloseTo(0.1)
  })

  it('mixes channels without dropping a side', () => {
    const mixed = mixChannels([Float32Array.from([1, 0]), Float32Array.from([0, 1])])
    expect(mixed[0]).toBeCloseTo(0.5)
    expect(mixed[1]).toBeCloseTo(0.5)
  })
})

describe('tempo math', () => {
  it('syncs the slave rate to the master effective tempo', () => {
    expect(syncRate(140, 1, 70)).toBeCloseTo(2)
    expect(pitchPercentFromRate(1.08)).toBeCloseTo(8)
    expect(fitsPitchRange(8, 8)).toBe(true)
    expect(fitsPitchRange(100, 8)).toBe(false)
  })

  it('refuses a beat loop that does not fit', () => {
    expect(loopBoundsFromBeats(0, 4, 120, 10)).toEqual({ inSec: 0, outSec: 2 })
    expect(loopBoundsFromBeats(9, 4, 120, 10)).toBeNull()
  })

  it('prefers manual BPM over detection and tags', () => {
    expect(originBpm({ bpmManual: 100, bpmDetected: 120, bpmTag: 128 })).toEqual({
      value: 100,
      source: 'manual',
    })
    expect(originBpm({ bpmManual: null, bpmDetected: null, bpmTag: null })).toBeNull()
  })
})

function id3Text(frames: { id: string; text: string; encoding?: 0 | 3 }[]): Uint8Array {
  const encoded = frames.map((frame) => {
    const body = frame.encoding === 3 ? new TextEncoder().encode(frame.text) : Uint8Array.from(frame.text, (char) => char.charCodeAt(0))
    const size = 1 + body.length
    const bytes = new Uint8Array(10 + size)
    bytes.set([frame.id.charCodeAt(0), frame.id.charCodeAt(1), frame.id.charCodeAt(2), frame.id.charCodeAt(3)])
    bytes[4] = (size >>> 24) & 0xff
    bytes[5] = (size >>> 16) & 0xff
    bytes[6] = (size >>> 8) & 0xff
    bytes[7] = size & 0xff
    bytes[10] = frame.encoding ?? 0
    bytes.set(body, 11)
    return bytes
  })
  const bodyLength = encoded.reduce((sum, frame) => sum + frame.length, 0)
  const header = new Uint8Array(10)
  header.set([0x49, 0x44, 0x33, 3, 0, 0])
  header[6] = (bodyLength >>> 21) & 0x7f
  header[7] = (bodyLength >>> 14) & 0x7f
  header[8] = (bodyLength >>> 7) & 0x7f
  header[9] = bodyLength & 0x7f
  const out = new Uint8Array(10 + bodyLength)
  out.set(header)
  let offset = 10
  for (const frame of encoded) {
    out.set(frame, offset)
    offset += frame.length
  }
  return out
}

describe('readId3Bpm', () => {
  it('reads a real TBPM frame and ignores a file without one', () => {
    expect(readId3Bpm(id3WithBpm('128'))).toBe(128)
    expect(readId3Bpm(Uint8Array.from([0x49, 0x44, 0x33]))).toBeNull()
    expect(readId3Bpm(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))).toBeNull()
  })
})

describe('readId3Tags', () => {
  it('reads only the text frames that are present', () => {
    const tags = readId3Tags(
      id3Text([
        { id: 'TIT2', text: 'Año', encoding: 3 },
        { id: 'TPE1', text: 'Luna' },
        { id: 'TALB', text: 'Noche' },
        { id: 'TCON', text: 'Techno' },
        { id: 'TBPM', text: '126' },
      ]),
    )
    expect(tags).toEqual({
      title: 'Año',
      artist: 'Luna',
      album: 'Noche',
      genre: 'Techno',
      bpm: 126,
    })
    expect(readId3Tags(id3Text([{ id: 'TIT2', text: 'Solo' }]))).toEqual({
      title: 'Solo',
      artist: null,
      album: null,
      genre: null,
      bpm: null,
    })
  })
})

describe('levels', () => {
  it('maps silence to an empty meter and keeps spectrum bins in range', () => {
    expect(meterFromRms(0)).toBe(0)
    expect(meterFromRms(1)).toBe(1)
    const bars = logBands(Uint8Array.from([0, 0, 255]), 2)
    expect(bars.every((value) => value >= 0 && value <= 1)).toBe(true)
  })
})
