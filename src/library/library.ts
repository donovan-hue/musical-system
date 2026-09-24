import type { TrackStore } from './storage.js';
import type { KeyInfo } from '../audio/key.js';

export interface TrackMeta {
  id: string;
  fileName: string;
  title: string;
  artist: string;
  album: string;
  bpm: number | null;
  bpmSource: 'tag' | 'estimated' | 'manual';
  durationSec: number;
  sizeBytes: number;
  /** Absolute peak per waveform bucket, values 0..1. */
  peaks: number[];
  addedAt: string;
  /** Tonalidad estimada del audio (análisis de cromas real). */
  key?: KeyInfo | null;
  genre?: string;
  date?: string;
  /** Miniatura real de la carátula ID3 (JPEG/PNG a 96 px, data URL). */
  artwork?: string;
  /** Origen real de la pista. */
  origin?: { type: 'import' | 'convert'; sourceUrl?: string };
  favorite?: boolean;
  /** Hot cues 1..8 persistidos (posición en segundos; null = vacío). */
  hotCues?: (number | null)[];
  playCount?: number;
  lastPlayedAt?: string | null;
}

export interface Playlist {
  id: string;
  name: string;
  trackIds: string[];
}

export type HistoryEvent =
  | { type: 'played'; trackId: string; deck: 'A' | 'B'; at: string; seconds: number }
  | { type: 'conversion'; url: string; title: string; at: string; fileName: string };

export interface RecordingMeta {
  id: string;
  name: string;
  at: string;
  durationSec: number;
  mimeType: string;
  sizeBytes: number;
  trackIds: string[];
}

export interface LibraryData {
  tracks: TrackMeta[];
  playlists: Playlist[];
  /** Cola de reproducción: ids en orden real, persistida. */
  queue: string[];
  history: { events: HistoryEvent[] };
  recordings: RecordingMeta[];
}

const LIBRARY_KEY = 'library.v1';
const MAX_HISTORY = 300;

export function newId(): string {
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Estado de la biblioteca: pistas, playlists, cola, historial y grabaciones,
 * persistido como documentos JSON. Los bytes viven en el store (OPFS);
 * quitar una pista quita sus bytes, hot cues y referencias.
 */
export class Library {
  private data: LibraryData = { tracks: [], playlists: [], queue: [], history: { events: [] }, recordings: [] };

  constructor(private readonly store: TrackStore) {}

  async init(): Promise<void> {
    const saved = await this.store.getJson<Partial<LibraryData>>(LIBRARY_KEY);
    if (saved && Array.isArray(saved.tracks)) {
      this.data = {
        tracks: saved.tracks,
        playlists: Array.isArray(saved.playlists) ? saved.playlists : [],
        queue: Array.isArray(saved.queue) ? saved.queue : [],
        history: saved.history && Array.isArray(saved.history.events) ? saved.history : { events: [] },
        recordings: Array.isArray(saved.recordings) ? saved.recordings : [],
      };
    }
  }

  get tracks(): readonly TrackMeta[] {
    return this.data.tracks;
  }

  get playlists(): readonly Playlist[] {
    return this.data.playlists;
  }

  get queue(): readonly string[] {
    return this.data.queue;
  }

  get historyEvents(): readonly HistoryEvent[] {
    return this.data.history.events;
  }

  get recordings(): readonly RecordingMeta[] {
    return this.data.recordings;
  }

  getTrack(id: string): TrackMeta | null {
    return this.data.tracks.find((t) => t.id === id) ?? null;
  }

  async addTrack(meta: Omit<TrackMeta, 'id' | 'addedAt'>, bytes: Uint8Array): Promise<TrackMeta> {
    const track: TrackMeta = { ...meta, id: newId(), addedAt: new Date().toISOString() };
    await this.store.putBytes(track.id, bytes);
    this.data.tracks = [track, ...this.data.tracks];
    await this.persist();
    return track;
  }

  async removeTrack(id: string): Promise<void> {
    this.data.tracks = this.data.tracks.filter((t) => t.id !== id);
    for (const playlist of this.data.playlists) {
      playlist.trackIds = playlist.trackIds.filter((tid) => tid !== id);
    }
    this.data.queue = this.data.queue.filter((tid) => tid !== id);
    await this.store.deleteBytes(id);
    await this.persist();
  }

  async updateTrack(id: string, patch: Partial<TrackMeta>): Promise<void> {
    const track = this.getTrack(id);
    if (!track) return;
    Object.assign(track, patch);
    await this.persist();
  }

  /** Manual BPM entry (or ×2 / ÷2 fixes on an estimate). */
  async setBpm(id: string, bpm: number | null, source: TrackMeta['bpmSource']): Promise<void> {
    await this.updateTrack(id, { bpm, bpmSource: source });
  }

  async toggleFavorite(id: string): Promise<boolean> {
    const track = this.getTrack(id);
    if (!track) return false;
    track.favorite = !track.favorite;
    await this.persist();
    return track.favorite;
  }

  async setHotCue(id: string, index: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7, position: number | null): Promise<void> {
    const track = this.getTrack(id);
    if (!track) return;
    const cues = [...(track.hotCues ?? new Array<number | null>(8).fill(null))];
    cues[index] = position;
    await this.updateTrack(id, { hotCues: cues });
  }

  async setKey(id: string, key: KeyInfo | null): Promise<void> {
    await this.updateTrack(id, { key });
  }

  /** Registra una reproducción (historial + contador por pista). */
  async logPlayed(trackId: string, deck: 'A' | 'B', seconds: number): Promise<void> {
    const track = this.getTrack(trackId);
    if (track) {
      track.playCount = (track.playCount ?? 0) + 1;
      track.lastPlayedAt = new Date().toISOString();
    }
    this.pushEvent({ type: 'played', trackId, deck, at: new Date().toISOString(), seconds });
    await this.persist();
  }

  async logConversion(url: string, title: string, fileName: string): Promise<void> {
    this.pushEvent({ type: 'conversion', url, title, at: new Date().toISOString(), fileName });
    await this.persist();
  }

  private pushEvent(event: HistoryEvent): void {
    this.data.history.events = [event, ...this.data.history.events].slice(0, MAX_HISTORY);
  }

  async clearHistory(): Promise<void> {
    this.data.history = { events: [] };
    await this.persist();
  }

  // ---------- Cola ----------

  async enqueue(trackId: string): Promise<boolean> {
    if (!this.getTrack(trackId) || this.data.queue.includes(trackId)) return false;
    this.data.queue = [...this.data.queue, trackId];
    await this.persist();
    return true;
  }

  async dequeue(trackId: string): Promise<string | null> {
    const index = this.data.queue.indexOf(trackId);
    if (index === -1) return null;
    const queue = [...this.data.queue];
    const [head] = queue.splice(index, 1);
    this.data.queue = queue;
    await this.persist();
    return head ?? null;
  }

  async clearQueue(): Promise<void> {
    this.data.queue = [];
    await this.persist();
  }

  async moveInQueue(trackId: string, delta: -1 | 1): Promise<boolean> {
    return this.moveInList(this.data.queue, trackId, delta, (next) => {
      this.data.queue = next;
    });
  }

  async saveQueueAsPlaylist(name: string): Promise<Playlist | null> {
    if (this.data.queue.length === 0) return null;
    const playlist = await this.createPlaylist(name);
    playlist.trackIds = [...this.data.queue];
    await this.persist();
    return playlist;
  }

  // ---------- Grabaciones ----------

  async addRecording(meta: Omit<RecordingMeta, 'id'>, bytes: Uint8Array): Promise<RecordingMeta> {
    const recording: RecordingMeta = { ...meta, id: newId() };
    await this.store.putBytes(`rec:${recording.id}`, bytes);
    this.data.recordings = [recording, ...this.data.recordings];
    await this.persist();
    return recording;
  }

  getRecordingBytes(id: string): Promise<Uint8Array | null> {
    return this.store.getBytes(`rec:${id}`);
  }

  async removeRecording(id: string): Promise<void> {
    this.data.recordings = this.data.recordings.filter((r) => r.id !== id);
    await this.store.deleteBytes(`rec:${id}`);
    await this.persist();
  }

  // ---------- Playlists ----------

  async createPlaylist(name: string): Promise<Playlist> {
    const playlist: Playlist = { id: newId(), name, trackIds: [] };
    this.data.playlists = [...this.data.playlists, playlist];
    await this.persist();
    return playlist;
  }

  async deletePlaylist(id: string): Promise<void> {
    this.data.playlists = this.data.playlists.filter((p) => p.id !== id);
    await this.persist();
  }

  getPlaylist(id: string): Playlist | null {
    return this.data.playlists.find((p) => p.id === id) ?? null;
  }

  async addToPlaylist(playlistId: string, trackId: string): Promise<boolean> {
    const playlist = this.getPlaylist(playlistId);
    if (!playlist || !this.getTrack(trackId)) return false;
    if (playlist.trackIds.includes(trackId)) return false;
    playlist.trackIds = [...playlist.trackIds, trackId];
    await this.persist();
    return true;
  }

  async removeFromPlaylist(playlistId: string, trackId: string): Promise<void> {
    const playlist = this.getPlaylist(playlistId);
    if (!playlist) return;
    playlist.trackIds = playlist.trackIds.filter((id) => id !== trackId);
    await this.persist();
  }

  /**
   * Move a track inside a playlist by -1 (up) or +1 (down). The playlist order
   * is real, explicit and persisted.
   */
  async moveInPlaylist(playlistId: string, trackId: string, delta: -1 | 1): Promise<boolean> {
    const playlist = this.getPlaylist(playlistId);
    if (!playlist) return false;
    return this.moveInList(playlist.trackIds, trackId, delta, (next) => {
      playlist.trackIds = next;
    });
  }

  private async moveInList(
    list: readonly string[],
    trackId: string,
    delta: -1 | 1,
    commit: (next: string[]) => void,
  ): Promise<boolean> {
    const index = list.indexOf(trackId);
    const target = index + delta;
    if (index === -1 || target < 0 || target >= list.length) return false;
    const ids = [...list];
    const [moved] = ids.splice(index, 1);
    ids.splice(target, 0, moved!);
    commit(ids);
    await this.persist();
    return true;
  }

  async persist(): Promise<void> {
    await this.store.putJson(LIBRARY_KEY, this.data);
  }
}
