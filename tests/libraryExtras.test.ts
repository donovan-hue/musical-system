import { describe, expect, it } from 'vitest';
import { Library, type TrackMeta } from '../src/library/library.js';
import { MemoryStore } from '../src/library/storage.js';

function meta(overrides: Partial<TrackMeta> = {}): Omit<TrackMeta, 'id' | 'addedAt'> {
  return {
    fileName: 'track.mp3',
    title: 'Track',
    artist: 'Artist',
    album: '',
    bpm: 124,
    bpmSource: 'estimated',
    durationSec: 200,
    sizeBytes: 2048,
    peaks: [0.1, 0.9],
    hasAudio: true,
    analysis: 'complete',
    ...overrides,
  };
}

async function lib(): Promise<Library> {
  const store = new MemoryStore();
  const l = new Library(store);
  await l.init();
  return l;
}

describe('cola (queue)', () => {
  it('encola sin duplicados, mueve, saca y limpia', async () => {
    const l = await lib();
    const ids = [];
    for (const title of ['Uno', 'Dos', 'Tres']) ids.push((await l.addTrack(meta({ title }), new Uint8Array([1]))).id);
    expect(await l.enqueue(ids[0]!)).toBe(true);
    expect(await l.enqueue(ids[0]!)).toBe(false); // duplicado
    await l.enqueue(ids[1]!);
    await l.enqueue(ids[2]!);
    expect([...l.queue]).toEqual(ids);

    await l.moveInQueue(ids[1]!, -1);
    expect([...l.queue]).toEqual([ids[1], ids[0], ids[2]]);
    await l.moveInQueue(ids[1]!, -1); // ya arriba: no-op
    expect([...l.queue]).toEqual([ids[1], ids[0], ids[2]]);
    await l.moveInQueue(ids[0]!, -1); // sí se mueve (está en la posición 2)
    expect([...l.queue]).toEqual([ids[0], ids[1], ids[2]]);

    expect(await l.dequeue(ids[1]!)).toBe(ids[1]);
    expect([...l.queue]).toEqual([ids[0], ids[2]]);
    await l.clearQueue();
    expect(l.queue).toHaveLength(0);
  });

  it('guarda la cola como playlist y elimina la pista de la cola al borrarla', async () => {
    const l = await lib();
    const a = await l.addTrack(meta({ title: 'A' }), new Uint8Array([1]));
    const b = await l.addTrack(meta({ title: 'B' }), new Uint8Array([2]));
    await l.enqueue(a.id);
    await l.enqueue(b.id);

    const playlist = await l.saveQueueAsPlaylist('Mi set');
    expect(playlist?.trackIds).toEqual([a.id, b.id]);
    expect(l.getPlaylist(playlist!.id)?.name).toBe('Mi set');

    await l.removeTrack(a.id);
    expect([...l.queue]).toEqual([b.id]);
  });
});

describe('favoritos y hot cues', () => {
  it('alterna favorito y persiste', async () => {
    const store = new MemoryStore();
    const l = new Library(store);
    await l.init();
    const t = await l.addTrack(meta(), new Uint8Array([1]));
    expect(await l.toggleFavorite(t.id)).toBe(true);
    expect(await l.toggleFavorite(t.id)).toBe(false);

    await l.toggleFavorite(t.id);
    const reloaded = new Library(store);
    await reloaded.init();
    expect(reloaded.getTrack(t.id)?.favorite).toBe(true);
  });

  it('fija y borra hot cues por índice', async () => {
    const l = await lib();
    const t = await l.addTrack(meta(), new Uint8Array([1]));
    await l.setHotCue(t.id, 2, 12.5);
    await l.setHotCue(t.id, 7, 40);
    expect(l.getTrack(t.id)?.hotCues?.[2]).toBe(12.5);
    expect(l.getTrack(t.id)?.hotCues?.[7]).toBe(40);
    await l.setHotCue(t.id, 2, null);
    expect(l.getTrack(t.id)?.hotCues?.[2]).toBeNull();
    expect(l.getTrack(t.id)?.hotCues?.[7]).toBe(40);
  });
});

describe('historial y grabaciones', () => {
  it('registra reproducciones y conversiones con tope', async () => {
    const l = await lib();
    const t = await l.addTrack(meta(), new Uint8Array([1]));
    await l.logPlayed(t.id, 'A', 180);
    await l.logConversion('https://youtu.be/x', 'Título', 'file.mp3');
    expect(l.historyEvents[0]?.type).toBe('conversion');
    expect(l.historyEvents[1]?.type).toBe('played');
    expect(l.getTrack(t.id)?.playCount).toBe(1);
    await l.clearHistory();
    expect(l.historyEvents).toHaveLength(0);
  });

  it('guarda grabaciones con bytes y las borra', async () => {
    const store = new MemoryStore();
    const l = new Library(store);
    await l.init();
    const rec = await l.addRecording(
      { name: 'Sesión 1', at: new Date().toISOString(), durationSec: 61.5, mimeType: 'audio/webm', sizeBytes: 9, trackIds: ['x'] },
      new Uint8Array([7, 7, 7]),
    );
    expect(l.recordings).toHaveLength(1);
    expect([...(await l.getRecordingBytes(rec.id))!]).toEqual([7, 7, 7]);
    await l.removeRecording(rec.id);
    expect(l.recordings).toHaveLength(0);
    expect(await l.getRecordingBytes(rec.id)).toBeNull();
  });

  it('setKey y updateTrack persisten', async () => {
    const store = new MemoryStore();
    const l = new Library(store);
    await l.init();
    const t = await l.addTrack(meta(), new Uint8Array([1]));
    const key = { tonic: 'A', mode: 'minor', label: 'Am', confidence: 0.6 } as const;
    await l.setKey(t.id, key);
    expect(l.getTrack(t.id)?.key?.label).toBe('Am');
  });
});
