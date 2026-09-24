import { AUDIO } from '../config/audio'

const AUDIO_EXTENSIONS = new Set([
  'mp3',
  'mpeg',
  'mp2',
  'wav',
  'wave',
  'm4a',
  'aac',
  'mp4',
  'm4b',
  'flac',
  'ogg',
  'oga',
  'opus',
  'aiff',
  'aif',
  'aifc',
  'caf',
  'webm',
])

export type RejectCode = 'empty' | 'too-large' | 'unsupported'

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot < 0 || dot === name.length - 1) return ''
  return name.slice(dot + 1).toLowerCase()
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let out = ''
  for (let index = 0; index < length; index += 1) {
    const byte = bytes[start + index]
    if (byte === undefined) return ''
    out += String.fromCharCode(byte)
  }
  return out
}

function hasMp3FrameSync(header: Uint8Array): boolean {
  const last = Math.min(header.length - 1, AUDIO.headerBytes)
  for (let index = 0; index < last; index += 1) {
    const second = header[index + 1] ?? 0
    if (header[index] === 0xff && (second & 0xe0) === 0xe0) return true
  }
  return false
}

export function looksLikeAudio(header: Uint8Array): boolean {
  if (header.length >= 3 && ascii(header, 0, 3) === 'ID3') return true
  if (header.length < 4) return false
  if (ascii(header, 0, 4) === 'OggS') return true
  if (ascii(header, 0, 4) === 'fLaC') return true
  if (ascii(header, 0, 4) === 'caff') return true
  if (ascii(header, 0, 4) === 'RIFF' && ascii(header, 8, 4) === 'WAVE') return true
  if (ascii(header, 0, 4) === 'FORM' && (ascii(header, 8, 4) === 'AIFF' || ascii(header, 8, 4) === 'AIFC')) {
    return true
  }
  if (header.length >= 12 && ascii(header, 4, 4) === 'ftyp') return true
  return hasMp3FrameSync(header)
}

export function validateAudioFile(
  file: { name: string; size: number; type: string },
  header: Uint8Array,
): { ok: true } | { ok: false; code: RejectCode } {
  if (file.size <= 0) return { ok: false, code: 'empty' }
  if (file.size > AUDIO.maxBytes) return { ok: false, code: 'too-large' }
  const mime = file.type.toLowerCase()
  const extension = fileExtension(file.name)
  const known =
    looksLikeAudio(header) ||
    mime.startsWith('audio/') ||
    mime === 'video/mp4' ||
    AUDIO_EXTENSIONS.has(extension)
  if (!known) return { ok: false, code: 'unsupported' }
  return { ok: true }
}
