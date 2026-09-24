import { describe, expect, it } from 'vitest';
import { parseId3 } from '../src/util/id3.js';

function ascii(text: string): Uint8Array {
  return Uint8Array.from([...text].map((c) => c.charCodeAt(0)));
}

function syncsafe(n: number): [number, number, number, number] {
  return [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f];
}

function frame(id: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(10 + payload.length);
  out.set(ascii(id), 0);
  new DataView(out.buffer).setUint32(4, payload.length);
  out.set(payload, 10);
  return out;
}

function tag(major: 3 | 4, frames: Uint8Array[]): Uint8Array {
  const body = frames.reduce((n, f) => n + f.length, 0);
  const out = new Uint8Array(10 + body);
  out.set(ascii('ID3'), 0);
  out.set([major, 0, 0], 3);
  out.set(syncsafe(body), 6);
  let off = 10;
  for (const f of frames) {
    out.set(f, off);
    off += f.length;
  }
  return out;
}

function latin1(text: string): Uint8Array {
  const payload = new Uint8Array(1 + text.length);
  payload[0] = 0;
  payload.set(ascii(text), 1);
  return payload;
}

describe('ID3 extendido: género, fecha y artwork', () => {
  it('lee TCON y TDRC/TYER', () => {
    const bytes = tag(3, [
      frame('TIT2', latin1('T')),
      frame('TCON', latin1('Techno')),
      frame('TDRC', latin1('2024')),
    ]);
    const tags = parseId3(bytes);
    expect(tags.genre).toBe('Techno');
    expect(tags.date).toBe('2024');
  });

  it('extrae artwork APIC (mime + bytes reales)', () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const payload = new Uint8Array(1 + 9 + 1 + 1 + 1 + png.length);
    let o = 0;
    payload[o++] = 0; // latin1
    payload.set(ascii('image/png'), o);
    o += 9;
    payload[o++] = 0; // fin del mime
    payload[o++] = 3; // tipo: cover front
    payload[o++] = 0; // descripción vacía
    payload.set(png, o);
    const bytes = tag(3, [frame('APIC', payload)]);
    const tags = parseId3(bytes);
    expect(tags.artwork?.mime).toBe('image/png');
    expect([...(tags.artwork?.data ?? [])]).toEqual([...png]);
  });

  it('soporta PIC de v2.2', () => {
    const jpg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    const payload = new Uint8Array(1 + 3 + 1 + 1 + jpg.length);
    let o = 0;
    payload[o++] = 0;
    payload.set(ascii('JPG'), o);
    o += 3;
    payload[o++] = 3;
    payload[o++] = 0;
    payload.set(jpg, o);
    const body = new Uint8Array(6 + payload.length);
    body.set(ascii('PIC'), 0);
    body.set([0, 0, payload.length], 3);
    body.set(payload, 6);
    // v2.2: tag con header major=2
    const out = new Uint8Array(10 + body.length);
    out.set(ascii('ID3'), 0);
    out.set([2, 0, 0], 3);
    out.set(syncsafe(body.length), 6);
    out.set(body, 10);
    const tags = parseId3(out);
    expect(tags.artwork?.mime).toBe('image/jpeg');
    expect([...(tags.artwork?.data ?? [])]).toEqual([...jpg]);
  });
});
