import type { TrackStore } from './storage.js';

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
}

export interface Playlist {
  id: string;
  name: string;
  trackIds: string[];
}

export interface LibraryData {
  tracks: TrackMeta[];
  playlists: Playlist[];
}

const LIBRARY_KEY = 'library.v1';

export function newId(): string {
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Library state: tracks + playlists, persisted as one JSON document. Byte
 * payloads live in the store; removing a track removes its bytes too.
 */
export class Library {
  private data: LibraryData = { tracks: [], playlists: [] };

  constructor(private readonly store: TrackStore) {}

  async init(): Promise<void> {
    const saved = await this.store.getJson<LibraryData>(LIBRARY_KEY);
    if (saved && Array.isArray(saved.tracks) && Array.isArray(saved.playlists)) {
      this.data = { tracks: saved.tracks, playlists: saved.playlists };
    }
  }

  get tracks(): readonly TrackMeta[] {
    return this.data.tracks;
  }

  get playlists(): readonly Playlist[] {
    return this.data.playlists;
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
    await this.store.deleteBytes(id);
    await this.persist();
  }

  /** Manual BPM entry (or ×2 / ÷2 fixes on an estimate). */
  async setBpm(id: string, bpm: number | null, source: TrackMeta['bpmSource']): Promise<void> {
    const track = this.getTrack(id);
    if (!track) return;
    track.bpm = bpm;
    track.bpmSource = source;
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
    const index = playlist.trackIds.indexOf(trackId);
    const target = index + delta;
    if (index === -1 || target < 0 || target >= playlist.trackIds.length) return false;
    const ids = [...playlist.trackIds];
    const [moved] = ids.splice(index, 1);
    ids.splice(target, 0, moved!);
    playlist.trackIds = ids;
    await this.persist();
    return true;
  }

  async persist(): Promise<void> {
    await this.store.putJson(LIBRARY_KEY, this.data);
  }
}
