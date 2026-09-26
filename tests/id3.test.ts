import { describe, expect, it } from 'vitest';
import { parseId3 } from '../src/util/id3.js';

function syncsafe(n: number): [number, number, number, number] {
  return [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f];
}

function ascii(text: string): Uint8Array {
  return Uint8Array.from([...text].map((c) => c.charCodeAt(0)));
}

/** v2.3 frame: 4-char id, plain u32 size, 2 flag bytes, payload. */
function frameV23(id: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(10 + payload.length);
  out.set(ascii(id), 0);
  new DataView(out.buffer).setUint32(4, payload.length);
  out.set(payload, 10);
  return out;
}

/** Build a full tag header around frames with the given major version. */
function tag(headerMajor: 2 | 3 | 4, frames: Uint8Array[]): Uint8Array {
  const body = frames.reduce((total, f) => total + f.length, 0);
  const out = new Uint8Array(10 + body);
  out.set(ascii('ID3'), 0);
  out.set([headerMajor, 0, 0], 3);
  const [a, b, c, d] = syncsafe(body);
  out.set([a!, b!, c!, d!], 6);
  let offset = 10;
  for (const f of frames) {
    out.set(f, offset);
    offset += f.length;
  }
  return out;
}

/** v2.4 frame: size is syncsafe. */
function frameV24(id: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(10 + payload.length);
  out.set(ascii(id), 0);
  const [a, b, c, d] = syncsafe(payload.length);
  out.set([a!, b!, c!, d!], 4);
  out.set(payload, 10);
  return out;
}

function latin1Text(text: string): Uint8Array {
  const payload = new Uint8Array(1 + text.length);
  payload[0] = 0; // ISO-8859-1
  payload.set(ascii(text), 1);
  return payload;
}

function utf8Text(text: string): Uint8Array {
  const encoded = new TextEncoder().encode(text);
  const payload = new Uint8Array(1 + encoded.length);
  payload[0] = 3; // UTF-8
  payload.set(encoded, 1);
  return payload;
}

describe('parseId3', () => {
  it('reads title, artist and BPM from a v2.3 tag', () => {
    const bytes = tag(3, [
      frameV23('TIT2', latin1Text('Neon Skyline')),
      frameV23('TPE1', latin1Text('DJ Prisma')),
      frameV23('TBPM', latin1Text('128.5')),
    ]);
    const tags = parseId3(bytes);
    expect(tags.title).toBe('Neon Skyline');
    expect(tags.artist).toBe('DJ Prisma');
    expect(tags.bpm).toBeCloseTo(128.5);
  });

  it('reads UTF-8 text and syncsafe sizes in v2.4', () => {
    const bytes = tag(4, [frameV24('TIT2', utf8Text('Café Caliente')), frameV24('TBPM', utf8Text('96'))]);
    const tags = parseId3(bytes);
    expect(tags.title).toBe('Café Caliente');
    expect(tags.bpm).toBe(96);
  });

  it('handles v2.2 short frame ids', () => {
    // v2.2 frames: 3-char id + 3-byte size + payload (no flag bytes).
    const tt2 = new Uint8Array(6 + 5);
    tt2.set(ascii('TT2'), 0);
    tt2.set([0, 0, 5], 3);
    tt2.set(latin1Text('Beta'), 6);
    const tbpPayload = latin1Text('174');
    const tbp = new Uint8Array(6 + tbpPayload.length);
    tbp.set(ascii('TBP'), 0);
    tbp.set([0, 0, tbpPayload.length], 3);
    tbp.set(tbpPayload, 6);
    const bytes = tag(2, [tt2, tbp]);

    const tags = parseId3(bytes);
    expect(tags.title).toBe('Beta');
    expect(tags.bpm).toBe(174);
  });

  it('returns an empty object without a tag and never throws', () => {
    expect(parseId3(new Uint8Array(0))).toEqual({});
    expect(parseId3(ascii('not an mp3 tag at all'))).toEqual({});
    expect(parseId3(ascii('ID3'))).toEqual({});
  });

  it('ignores truncated frames', () => {
    const good = frameV23('TIT2', latin1Text('Hola'));
    const bytes = tag(3, [good]);
    const truncated = bytes.subarray(0, 10 + good.length - 2);
    expect(parseId3(truncated).title ?? '').toHaveLength(0);
  });
});
