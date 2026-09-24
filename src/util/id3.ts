export interface Id3Tags {
  title?: string;
  artist?: string;
  album?: string;
  bpm?: number;
}

interface FrameResult {
  id: string;
  text: string;
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

function parseFrame(id: string, raw: Uint8Array): FrameResult | null {
  if (!id.startsWith('T')) return null; // Only text frames matter here.
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

    const frame = parseFrame(id, raw);
    if (!frame) continue;
    const text = frame.text;
    if (text.length === 0) continue;
    if (id === 'TIT2' || id === 'TT2') tags.title ??= text;
    else if (id === 'TPE1' || id === 'TP1') tags.artist ??= text;
    else if (id === 'TALB' || id === 'TAL') tags.album ??= text;
    else if (id === 'TBPM' || id === 'TBP') {
      const bpm = parseFloat(text);
      if (Number.isFinite(bpm) && bpm > 0) tags.bpm = bpm;
    }
  }
  return tags;
}
