import { describe, expect, it } from 'vitest'
import { AUDIO } from '../src/config/audio'
import { looksLikeAudio, validateAudioFile } from '../src/library/validateAudioFile'

function bytes(text: string): Uint8Array {
  return Uint8Array.from(text, (char) => char.charCodeAt(0))
}

describe('looksLikeAudio', () => {
  it('recognizes ID3 and MP3 frame sync', () => {
    expect(looksLikeAudio(bytes('ID3'))).toBe(true)
    expect(looksLikeAudio(new Uint8Array([0xff, 0xfb, 0x90, 0x00]))).toBe(true)
  })

  it('recognizes wav and m4a containers', () => {
    const wav = new Uint8Array(12)
    wav.set(bytes('RIFF'), 0)
    wav.set(bytes('WAVE'), 8)
    expect(looksLikeAudio(wav)).toBe(true)

    const m4a = new Uint8Array(12)
    m4a.set(bytes('ftyp'), 4)
    expect(looksLikeAudio(m4a)).toBe(true)
  })

  it('rejects a pdf header', () => {
    expect(looksLikeAudio(bytes('%PDF-1.7'))).toBe(false)
  })
})

describe('validateAudioFile', () => {
  it('rejects an empty file before decode', () => {
    expect(validateAudioFile({ name: 'song.mp3', size: 0, type: 'audio/mpeg' }, bytes('ID3')).ok).toBe(false)
  })

  it('rejects a file over the configured limit', () => {
    const result = validateAudioFile(
      { name: 'song.mp3', size: AUDIO.maxBytes + 1, type: 'audio/mpeg' },
      bytes('ID3'),
    )
    expect(result).toEqual({ ok: false, code: 'too-large' })
  })

  it('rejects a non-audio file even if the extension was not checked alone', () => {
    const result = validateAudioFile({ name: 'notes.pdf', size: 1200, type: 'application/pdf' }, bytes('%PDF-1.7'))
    expect(result).toEqual({ ok: false, code: 'unsupported' })
  })

  it('accepts an mp3 header for a later decode attempt', () => {
    expect(validateAudioFile({ name: 'track.mp3', size: 4096, type: 'audio/mpeg' }, bytes('ID3....'))).toEqual({
      ok: true,
    })
  })

  it('still attempts decode when the extension is mp3 and the header is odd', () => {
    const result = validateAudioFile({ name: 'weird.mp3', size: 2000, type: '' }, bytes('????'))
    expect(result).toEqual({ ok: true })
  })
})
