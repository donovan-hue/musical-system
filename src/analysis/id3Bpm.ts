function syncsafe(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) & 0x7f) * 2 ** 21 +
    ((bytes[offset + 1] ?? 0) & 0x7f) * 2 ** 14 +
    ((bytes[offset + 2] ?? 0) & 0x7f) * 2 ** 7 +
    ((bytes[offset + 3] ?? 0) & 0x7f)
  )
}

function parseBpmText(text: string): number | null {
  const match = text.match(/(\d+(?:[.,]\d+)?)/)
  if (!match?.[1]) return null
  const value = Number(match[1].replace(',', '.'))
  if (!Number.isFinite(value) || value < 40 || value > 240) return null
  return value
}

function decodeFrameText(data: Uint8Array): string {
  if (data.length < 2) return ''
  const encoding = data[0]
  const body = data.subarray(1)
  if (encoding === 0) return new TextDecoder('iso-8859-1').decode(body).replace(/\0/g, '')
  if (encoding === 3) return new TextDecoder('utf-8').decode(body).replace(/\0/g, '')
  return ''
}

/** Reads a TBPM tag when the file actually has one. Returns null otherwise. */
export function readId3Bpm(bytes: Uint8Array): number | null {
  if (bytes.length < 10) return null
  if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return null
  const version = bytes[3] ?? 0
  const flags = bytes[5] ?? 0
  if (version !== 3 && version !== 4) return null
  if ((flags & 0b1000_0000) !== 0 || (flags & 0b0100_0000) !== 0) return null

  const tagSize = syncsafe(bytes, 6)
  const tagEnd = Math.min(bytes.length, 10 + tagSize)
  let offset = 10
  while (offset + 10 <= tagEnd) {
    const id = String.fromCharCode(bytes[offset] ?? 0, bytes[offset + 1] ?? 0, bytes[offset + 2] ?? 0, bytes[offset + 3] ?? 0)
    if (id === '\0\0\0\0') break
    const size = version === 4 ? syncsafe(bytes, offset + 4) : readU32(bytes, offset + 4)
    const frameStart = offset + 10
    const frameEnd = frameStart + size
    if (size <= 0 || frameEnd > tagEnd) break
    if (id === 'TBPM') {
      return parseBpmText(decodeFrameText(bytes.subarray(frameStart, frameEnd)))
    }
    offset = frameEnd
  }
  return null
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) * 2 ** 24 +
    (bytes[offset + 1] ?? 0) * 2 ** 16 +
    (bytes[offset + 2] ?? 0) * 2 ** 8 +
    (bytes[offset + 3] ?? 0)
  )
}
