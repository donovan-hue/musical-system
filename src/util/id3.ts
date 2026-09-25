export interface Id3Artwork {
  mime: string;
  data: Uint8Array;
}

export interface Id3Tags {
  title?: string;
  artist?: string;
  album?: string;
  bpm?: number;
  genre?: string;
  date?: string;
  /** Número de pista (frame TRCK), tal como viene ("3" o "3/12"). */
  trackNumber?: string;
  artwork?: Id3Artwork;
}

interface FrameResult {
  id: string;
  text?: string;
  artwork?: Id3Artwork;
}

const LATIN1 = 'iso-8859-1';
const UTF16LE = 'utf-16le';
const UTF16BE = 'utf-16be';
const UTF8 = 'utf-8';

function decodeTextBytes(raw: Uint8Array): string {
  if (raw.length === 0) return '';
  const encoding = raw[0]!;
  const body = raw.subarray(1);
  try {
    switch (encoding) {
      case 0:
        return stripTerminator(new TextDecoder(LATIN1).decode(body));
      case 1: {
        // UTF-16 with BOM; fall back to LE when absent.
        if (body.length >= 2 && body[0] === 0xff && body[1] === 0xfe) {
          return stripTerminator(new TextDecoder(UTF16LE).decode(body.subarray(2)));
        }
        if (body.length >= 2 && body[0] === 0xfe && body[1] === 0xff) {
          return stripTerminator(new TextDecoder(UTF16BE).decode(body.subarray(2)));
        }
        return stripTerminator(new TextDecoder(UTF16LE).decode(body));
      }
      case 2:
        return stripTerminator(new TextDecoder(UTF16BE).decode(body));
      default:
        return stripTerminator(new TextDecoder(UTF8).decode(body));
    }
  } catch {
    return '';
  }
}

function stripTerminator(text: string): string {
  const idx = text.indexOf('\0');
  const clean = idx === -1 ? text : text.slice(0, idx);
  return clean.trim();
}

function readSyncSafe(view: DataView, offset: number): number {
  return (
    ((view.getUint8(offset) & 0x7f) << 21) |
    ((view.getUint8(offset + 1) & 0x7f) << 14) |
    ((view.getUint8(offset + 2) & 0x7f) << 7) |
    (view.getUint8(offset + 3) & 0x7f)
  );
}

function readUInt24(view: DataView, offset: number): number {
  return (view.getUint8(offset) << 16) | (view.getUint8(offset + 1) << 8) | view.getUint8(offset + 2);
}

/** Extrae artwork APIC (v2.3/2.4) o PIC (v2.2). */
function parseArtwork(id: string, raw: Uint8Array): Id3Artwork | null {
  if (raw.length < 4) return null;
  const encoding = raw[0]!;
  try {
    if (id === 'APIC') {
      // mime: cadena latin1 terminada en null.
      let end = 1;
      while (end < raw.length && raw[end] !== 0) end++;
      if (end >= raw.length) return null;
      const mime = new TextDecoder(LATIN1).decode(raw.subarray(1, end)) || 'image/jpeg';
      let cursor = end + 2; // +1 null del mime, +1 tipo de imagen
      // descripción terminada en null (1 o 2 bytes según encoding).
      if (encoding === 1 || encoding === 2) {
        while (cursor + 1 < raw.length && !(raw[cursor] === 0 && raw[cursor + 1] === 0)) cursor += 2;
        cursor += 2;
      } else {
        while (cursor < raw.length && raw[cursor] !== 0) cursor++;
        cursor += 1;
      }
      if (cursor >= raw.length) return null;
      const data = raw.subarray(cursor);
      return data.length > 16 ? { mime: mime.toLowerCase(), data } : null;
    }
    // v2.2 PIC: formato de 3 caracteres en vez de mime.
    const format = new TextDecoder(LATIN1).decode(raw.subarray(1, 4)).toUpperCase();
    const mime = format === 'PNG' ? 'image/png' : 'image/jpeg';
    let cursor = 5; // enc(1) + fmt(3) + type(1)
    if (encoding === 1 || encoding === 2) {
      while (cursor + 1 < raw.length && !(raw[cursor] === 0 && raw[cursor + 1] === 0)) cursor += 2;
      cursor += 2;
    } else {
      while (cursor < raw.length && raw[cursor] !== 0) cursor++;
      cursor += 1;
    }
    if (cursor >= raw.length) return null;
    const data = raw.subarray(cursor);
    return data.length > 16 ? { mime, data } : null;
  } catch {
    return null;
  }
}

function parseFrame(id: string, raw: Uint8Array): FrameResult | null {
  if (id === 'APIC' || id === 'PIC') return { id, artwork: parseArtwork(id, raw) ?? undefined };
  if (!id.startsWith('T')) return null; // Solo frames de texto + artwork.
  return { id, text: decodeTextBytes(raw) };
}

/**
 * Parse ID3v2 (2.2 / 2.3 / 2.4) metadata from the head of an audio file.
 * Returns an empty object for files without a usable tag — never throws.
 */
export function parseId3(bytes: Uint8Array): Id3Tags {
  const tags: Id3Tags = {};
  if (bytes.length < 10) return tags;
  if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return tags; // "ID3"

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const major = view.getUint8(3);
  const tagSize = readSyncSafe(view, 6);
  const available = Math.min(tagSize + 10, bytes.length);

  let offset = 10;
  if (view.getUint8(5) & 0x40) {
    // Extended header: skip it (size is syncsafe in v2.4, plain in v2.3).
    const extSize = major === 4 ? readSyncSafe(view, offset) + 4 : view.getUint32(offset) + 4;
    offset += extSize;
  }

  const idLen = major === 2 ? 3 : 4;
  const sizeLen = major === 2 ? 3 : 4;

  while (offset + idLen + sizeLen <= available) {
    let id = '';
    for (let i = 0; i < idLen; i++) {
      const code = view.getUint8(offset + i);
      if (code === 0x00) return tags; // Padding reached.
      const isUpper = code >= 0x41 && code <= 0x5a;
      const isDigit = code >= 0x30 && code <= 0x39;
      if (!isUpper && !isDigit) return tags; // Not a frame id.
      id += String.fromCharCode(code);
    }
    offset += idLen;

    const size =
      major === 2
        ? readUInt24(view, offset)
        : major === 4
          ? readSyncSafe(view, offset)
          : view.getUint32(offset);
    offset += sizeLen;
    if (major !== 2) offset += 2; // v2.3/v2.4 frames carry 2 flag bytes.

    if (size <= 0 || offset + size > available) return tags;
    const raw = bytes.subarray(offset, offset + size);
    offset += size;

    // Los artworks pueden ser enormes: solo conserva el primero útil.
    if (!tags.artwork && (id === 'APIC' || id === 'PIC')) {
      const art = parseFrame(id, raw)?.artwork;
      if (art) tags.artwork = art;
      continue;
    }

    const frame = parseFrame(id, raw);
    if (!frame?.text) continue;
    const text = frame.text;
    if (text.length === 0) continue;
    if (id === 'TIT2' || id === 'TT2') tags.title ??= text;
    else if (id === 'TPE1' || id === 'TP1') tags.artist ??= text;
    else if (id === 'TALB' || id === 'TAL') tags.album ??= text;
    else if (id === 'TBPM' || id === 'TBP') {
      const bpm = parseFloat(text);
      if (Number.isFinite(bpm) && bpm > 0) tags.bpm = bpm;
    } else if (id === 'TCON') tags.genre ??= text;
    else if (id === 'TDRC' || id === 'TYER' || id === 'TYE') tags.date ??= text;
    else if (id === 'TRCK' || id === 'TRK') tags.trackNumber ??= text;
  }
  return tags;
}
