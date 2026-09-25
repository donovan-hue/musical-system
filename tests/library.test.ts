import { describe, expect, it } from 'vitest';
import { Library, newId, type TrackMeta } from '../src/library/library.js';
import { MemoryStore } from '../src/library/storage.js';
import { validateAudioFile } from '../src/library/fileValidate.js';

function meta(overrides: Partial<TrackMeta> = {}): Omit<TrackMeta, 'id' | 'addedAt'> {
  return {
    fileName: 'track.mp3',
    title: 'Track',
    artist: 'Artist',
    album: '',
    bpm: 120,
    bpmSource: 'tag',
    durationSec: 180,
    sizeBytes: 1024,
    peaks: [0.2, 0.8, 0.5],
    hasAudio: true,
    analysis: 'complete',
    ...overrides,
  };
}

describe('Library', () => {
  it('adds tracks to the front and stores their bytes', async () => {
    const store = new MemoryStore();
    const lib = new Library(store);
    await lib.init();
    const a = await lib.addTrack(meta({ title: 'A' }), new Uint8Array([1, 2, 3]));
    const b = await lib.addTrack(meta({ title: 'B' }), new Uint8Array([4]));
    expect(lib.tracks.map((t) => t.title)).toEqual(['B', 'A']);
    expect([...(await store.getBytes(a.id))!]).toEqual([1, 2, 3]);
    expect([...(await store.getBytes(b.id))!]).toEqual([4]);
  });

  it('persists and reloads tracks and playlists', async () => {
    const store = new MemoryStore();
    const lib = new Library(store);
    await lib.init();
    const track = await lib.addTrack(meta(), new Uint8Array([9]));
    const playlist = await lib.createPlaylist('Noche');
    await lib.addToPlaylist(playlist.id, track.id);

    const reloaded = new Library(store);
    await reloaded.init();
    expect(reloaded.tracks.map((t) => t.title)).toEqual(['Track']);
    expect(reloaded.playlists[0]!.name).toBe('Noche');
    expect(reloaded.playlists[0]!.trackIds).toEqual([track.id]);
  });

  it('moves tracks within a playlist and keeps a real order', async () => {
    const store = new MemoryStore();
    const lib = new Library(store);
    await lib.init();
    const ids = [];
    for (const title of ['Uno', 'Dos', 'Tres']) {
      ids.push((await lib.addTrack(meta({ title }), new Uint8Array([1]))).id);
    }
    const playlist = await lib.createPlaylist('Set');
    for (const id of ids) await lib.addToPlaylist(playlist.id, id);
    expect(lib.getPlaylist(playlist.id)!.trackIds).toEqual(ids);

    await lib.moveInPlaylist(playlist.id, ids[2]!, -1);
    expect(lib.getPlaylist(playlist.id)!.trackIds).toEqual([ids[0], ids[2], ids[1]]);

    await lib.moveInPlaylist(playlist.id, ids[0]!, -1); // already at top: no-op
    expect(lib.getPlaylist(playlist.id)!.trackIds).toEqual([ids[0], ids[2], ids[1]]);

    await lib.moveInPlaylist(playlist.id, ids[1]!, 1);
    expect(lib.getPlaylist(playlist.id)!.trackIds).toEqual([ids[0], ids[2], ids[1]]);
  });

  it('removes a track from playlists and storage', async () => {
    const store = new MemoryStore();
    const lib = new Library(store);
    await lib.init();
    const track = await lib.addTrack(meta(), new Uint8Array([1]));
    const playlist = await lib.createPlaylist('P');
    await lib.addToPlaylist(playlist.id, track.id);

    await lib.removeTrack(track.id);
    expect(lib.tracks).toHaveLength(0);
    expect(lib.getPlaylist(playlist.id)!.trackIds).toEqual([]);
    expect(await store.getBytes(track.id)).toBeNull();
  });

  it('sets manual BPM and dedupes playlist entries', async () => {
    const store = new MemoryStore();
    const lib = new Library(store);
    await lib.init();
    const track = await lib.addTrack(meta({ bpm: 120, bpmSource: 'estimated' }), new Uint8Array([1]));
    await lib.setBpm(track.id, 161, 'manual');
    expect(lib.getTrack(track.id)!.bpm).toBe(161);
    expect(lib.getTrack(track.id)!.bpmSource).toBe('manual');

    const playlist = await lib.createPlaylist('X');
    expect(await lib.addToPlaylist(playlist.id, track.id)).toBe(true);
    expect(await lib.addToPlaylist(playlist.id, track.id)).toBe(false);
    expect(lib.getPlaylist(playlist.id)!.trackIds).toHaveLength(1);
  });

  it('generates unique ids', () => {
    const seen = new Set(Array.from({ length: 200 }, () => newId()));
    expect(seen.size).toBe(200);
  });
});

describe('validateAudioFile', () => {
  it('accepts audio by extension or mime', () => {
    expect(validateAudioFile('song.mp3', 100, '')).toEqual({ ok: true });
    expect(validateAudioFile('song', 100, 'audio/mpeg')).toEqual({ ok: true });
    expect(validateAudioFile('loop.WAV', 100, 'application/octet-stream')).toEqual({ ok: true });
    expect(validateAudioFile('mix.flac', 100, '')).toEqual({ ok: true });
  });

  it('rejects empty files', () => {
    const result = validateAudioFile('song.mp3', 0, 'audio/mpeg');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('vacío');
  });

  it('rejects non-audio files', () => {
    const result = validateAudioFile('informe.pdf', 500, 'application/pdf');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('audio');
  });
});
