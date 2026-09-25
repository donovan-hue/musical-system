import { describe, expect, it } from 'vitest';
import { evaluateSmart, opsForField, type SmartPlaylist } from '../src/library/smart.js';
import type { TrackMeta } from '../src/library/library.js';
import { parseSpotifyPlaylistUrl } from '../src/library/spotify.js';
import { computeQuality, describeQuality, formatFromFileName, qualityFromHeaders } from '../src/util/quality.js';
import { sha256Hex } from '../src/util/hash.js';
import { parseId3 } from '../src/util/id3.js';
import { Library } from '../src/library/library.js';
import { MemoryStore } from '../src/library/storage.js';

function track(overrides: Partial<TrackMeta> = {}): TrackMeta {
  return {
    id: 't1',
    fileName: 'song.mp3',
    title: 'Neon Skyline',
    artist: 'DJ Prisma',
    album: 'Night Drive',
    bpm: 128,
    bpmSource: 'tag',
    durationSec: 200,
    sizeBytes: 5_000_000,
    peaks: [0.5],
    addedAt: '2026-09-24T10:00:00.000Z',
    hasAudio: true,
    analysis: 'complete',
    ...overrides,
  };
}

describe('playlists inteligentes (evaluador)', () => {
  const tracks: TrackMeta[] = [
    track({ id: 'a', artist: 'DJ Prisma', bpm: 128, genre: 'house', favorite: true }),
    track({ id: 'b', artist: 'Otra Banda', bpm: 140, genre: 'trance', favorite: false }),
    track({ id: 'c', artist: 'DJ Prisma', bpm: 100, genre: 'hip hop', favorite: false }),
  ];

  const byArtist: SmartPlaylist = {
    id: 's1',
    name: 'Prisma',
    match: 'all',
    rules: [{ field: 'artist', op: 'contains', value: 'prisma' }],
  };
  const fastHouse: SmartPlaylist = {
    id: 's2',
    name: 'Fast house',
    match: 'all',
    rules: [
      { field: 'bpm', op: 'gte', value: '120' },
      { field: 'genre', op: 'equals', value: 'house' },
    ],
  };
  const anyRule: SmartPlaylist = {
    id: 's3',
    name: 'O cual',
    match: 'any',
    rules: [
      { field: 'bpm', op: 'lte', value: '110' },
      { field: 'favorite', op: 'equals', value: 'sí' },
    ],
  };

  it('filtra por contains', () => {
    expect(evaluateSmart(byArtist, tracks).map((t) => t.id)).toEqual(['a', 'c']);
  });

  it('exige todas las reglas con match=all', () => {
    expect(evaluateSmart(fastHouse, tracks).map((t) => t.id)).toEqual(['a']);
  });

  it('basta una regla con match=any (y entiende favorito en español)', () => {
    expect(evaluateSmart(anyRule, tracks).map((t) => t.id)).toEqual(['a', 'c']);
  });

  it('sin reglas no devuelve nada (nunca "todo")', () => {
    expect(evaluateSmart({ id: 'x', name: 'vacía', match: 'all', rules: [] }, tracks)).toEqual([]);
  });

  it('operadores válidos por campo (la UI no inventa reglas)', () => {
    expect(opsForField('bpm')).toContain('gte');
    expect(opsForField('favorite')).toEqual(['equals']);
    expect(opsForField('title')).toContain('contains');
  });

  it('filtra por fuente y formato reales', () => {
    const withMeta = [
      track({ id: 's', origin: { type: 'spotify' }, quality: { format: 'OPUS', codec: 'opus', bitrateKbps: 160, sampleRate: 48000, channels: 2 } }),
      ...tracks,
    ];
    const spotifyOnly: SmartPlaylist = { id: 'v', name: 'spot', match: 'all', rules: [{ field: 'source', op: 'equals', value: 'spotify' }] };
    const opusOnly: SmartPlaylist = { id: 'w', name: 'opus', match: 'all', rules: [{ field: 'format', op: 'equals', value: 'opus' }] };
    expect(evaluateSmart(spotifyOnly, withMeta).map((t) => t.id)).toEqual(['s']);
    expect(evaluateSmart(opusOnly, withMeta).map((t) => t.id)).toEqual(['s']);
  });
});

describe('URL de playlist de Spotify', () => {
  it('acepta URL estándar con y sin query', () => {
    expect(parseSpotifyPlaylistUrl('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc')).toEqual({
      ok: true,
      playlistId: '37i9dQZF1DXcBWIGoYBM5M',
    });
    expect(parseSpotifyPlaylistUrl('https://open.spotify.com/playlist/abc123')).toEqual({ ok: true, playlistId: 'abc123' });
  });

  it('acepta URI spotify:playlist:ID', () => {
    expect(parseSpotifyPlaylistUrl('spotify:playlist:abc123')).toEqual({ ok: true, playlistId: 'abc123' });
  });

  it('rechaza URLs que no son playlists de Spotify', () => {
    expect(parseSpotifyPlaylistUrl('').ok).toBe(false);
    expect(parseSpotifyPlaylistUrl('https://youtube.com/watch?v=x').ok).toBe(false);
    expect(parseSpotifyPlaylistUrl('https://open.spotify.com/track/abc').ok).toBe(false);
    expect(parseSpotifyPlaylistUrl('no es url').ok).toBe(false);
  });
});

describe('calidad de audio (valores reales, sin inventar)', () => {
  it('formato desde el nombre de archivo', () => {
    expect(formatFromFileName('mix.mp3')).toBe('MP3');
    expect(formatFromFileName('set.opus')).toBe('OPUS');
    expect(formatFromFileName('raro.xyz')).toBe('XYZ');
    expect(formatFromFileName('sinextension')).toBe('—');
  });

  it('bitrate efectivo = bytes×8/duración', () => {
    const q = computeQuality('song.mp3', 1_000_000, { sampleRate: 44100, channels: 2, durationSec: 50 });
    expect(q.bitrateKbps).toBe(160); // 1e6*8/50/1000
    expect(q.sampleRate).toBe(44100);
    expect(q.channels).toBe(2);
    expect(q.codec).toBeNull(); // sin ffprobe no se inventa códec
  });

  it('los headers del servidor tienen prioridad', () => {
    const q = qualityFromHeaders('song.opus', 1000, 10, { codec: 'opus', bitrateKbps: 96, sampleRate: 48000, channels: 2 });
    expect(q.codec).toBe('opus');
    expect(q.bitrateKbps).toBe(96);
    expect(q.sampleRate).toBe(48000);
  });

  it('describe con — lo desconocido', () => {
    expect(describeQuality(null)).toBe('—');
    expect(describeQuality({ format: 'MP3', codec: null, bitrateKbps: 320, sampleRate: null, channels: null })).toBe('MP3 · 320 kbps');
  });
});

describe('hash de contenido (dedup)', () => {
  it('es determinista y distingue entradas', async () => {
    const a = await sha256Hex(new Uint8Array([1, 2, 3]));
    const b = await sha256Hex(new Uint8Array([1, 2, 3]));
    const c = await sha256Hex(new Uint8Array([1, 2, 4]));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('ID3 TRCK (número de pista)', () => {
  it('lee el frame TRCK de v2.3', () => {
    // tag v2.3: header + frame TRCK "3/12"
    const payload = new Uint8Array(1 + 4);
    payload[0] = 0;
    payload.set([0x33, 0x2f, 0x31, 0x32], 1); // "3/12"
    const frame = new Uint8Array(10 + payload.length);
    frame.set([0x54, 0x52, 0x43, 0x4b], 0); // TRCK
    new DataView(frame.buffer).setUint32(4, payload.length);
    frame.set(payload, 10);
    const body = frame;
    const bytes = new Uint8Array(10 + body.length);
    bytes.set([0x49, 0x44, 0x33, 3, 0, 0], 0);
    bytes.set([0, 0, body.length & 0x7f], 6); // syncsafe simple (<128)
    bytes.set(body, 10);
    expect(parseId3(bytes).trackNumber).toBe('3/12');
  });
});

describe('biblioteca: referencias, dedup y portabilidad', () => {
  async function lib(): Promise<Library> {
    const l = new Library(new MemoryStore());
    await l.init();
    return l;
  }

  it('pista solo-metadatos → attachAudio la materializa', async () => {
    const l = await lib();
    const ref = await l.addMetadataTrack({
      fileName: 'x.spotify',
      title: 'Referencia',
      artist: 'Alguien',
      album: '',
      bpm: null,
      bpmSource: 'estimated',
      durationSec: 180,
      sizeBytes: 0,
      peaks: [],
      origin: { type: 'spotify' },
      spotifyId: 'sp1',
      favorite: false,
      hotCues: [null, null, null, null, null, null, null, null],
      playCount: 0,
      lastPlayedAt: null,
    });
    expect(ref.hasAudio).toBe(false);
    expect(ref.analysis).toBe('pending');

    const attached = await l.attachAudio(ref.id, new Uint8Array([9, 9]), {
      analysis: 'partial',
      contentHash: 'abc',
    });
    expect(attached?.hasAudio).toBe(true);
    expect(attached?.analysis).toBe('partial');
    expect(await (l as unknown as { store: { getBytes(id: string): Promise<Uint8Array | null> } }).store.getBytes(ref.id)).not.toBeNull();
  });

  it('findDuplicate encuentra por hash y por spotifyId', async () => {
    const l = await lib();
    const t = await l.addTrack(
      {
        fileName: 'a.mp3',
        title: 'A',
        artist: 'X',
        album: '',
        bpm: 120,
        bpmSource: 'tag',
        durationSec: 10,
        sizeBytes: 3,
        peaks: [],
        hasAudio: true,
        analysis: 'complete',
        contentHash: 'hash-uno',
        spotifyId: 'sp-uno',
      },
      new Uint8Array([1]),
    );
    expect(l.findDuplicate('hash-uno')?.id).toBe(t.id);
    expect(l.findDuplicate(undefined, 'sp-uno')?.id).toBe(t.id);
    expect(l.findDuplicate('hash-dos')).toBeNull();
  });

  it('exportDoc/importDoc fusiona sin duplicar y conserva playlists', async () => {
    const l = await lib();
    const t = await l.addTrack(
      {
        fileName: 'a.mp3',
        title: 'A',
        artist: 'X',
        album: '',
        bpm: 120,
        bpmSource: 'tag',
        durationSec: 10,
        sizeBytes: 3,
        peaks: [],
        hasAudio: true,
        analysis: 'complete',
        contentHash: 'h1',
      },
      new Uint8Array([1]),
    );
    await l.createPlaylist('Set');
    const doc = l.exportDoc();

    const other = await lib();
    const first = await other.importDoc(doc);
    expect(first.added).toBe(1);
    const second = await other.importDoc(doc);
    expect(second.added).toBe(0);
    expect(second.skipped).toBe(1);
    expect(other.tracks[0]?.title).toBe('A');
    expect(other.playlists[0]?.name).toBe('Set');
    expect(other.getTrack(t.id)).not.toBeNull();
  });

  it('análisis: estado y datos reales persisten', async () => {
    const l = await lib();
    const t = await l.addTrack(
      {
        fileName: 'a.mp3',
        title: 'A',
        artist: 'X',
        album: '',
        bpm: null,
        bpmSource: 'estimated',
        durationSec: 10,
        sizeBytes: 3,
        peaks: [],
        hasAudio: true,
        analysis: 'pending',
      },
      new Uint8Array([1]),
    );
    await l.setTrackAnalysisData(t.id, { bpm: 125.5, bpmSource: 'estimated', peaks: [0.4, 0.9] });
    await l.setAnalysis(t.id, 'partial');
    const updated = l.getTrack(t.id)!;
    expect(updated.bpm).toBe(125.5);
    expect(updated.analysis).toBe('partial');
    await l.setAnalysis(t.id, 'failed', 'decode roto');
    expect(l.getTrack(t.id)!.analysisError).toBe('decode roto');
  });
});
