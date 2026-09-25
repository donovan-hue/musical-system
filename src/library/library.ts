import type { TrackStore } from './storage.js';
import type { KeyInfo } from '../audio/key.js';
import type { QualityInfo } from '../util/quality.js';
import type { SmartPlaylist } from './smart.js';

export type TrackOriginType = 'import' | 'convert' | 'spotify' | 'match';

/** Estado REAL del análisis (nunca se inventan valores). */
export type AnalysisState = 'complete' | 'partial' | 'pending' | 'failed';

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
  /** Número de pista (tag TRCK o metadato Spotify). */
  trackNumber?: string;
  /** Miniatura real de la carátula ID3 (JPEG/PNG a 96 px, data URL). */
  artwork?: string;
  /** Origen real de la pista y su URL de origen cuando existe. */
  origin?: { type: TrackOriginType; sourceUrl?: string };
  favorite?: boolean;
  /** Hot cues 1..8 persistidos (posición en segundos; null = vacío). */
  hotCues?: (number | null)[];
  playCount?: number;
  lastPlayedAt?: string | null;
  /** Calidad real medida (formato, códec, bitrate, sample rate, canales). */
  quality?: QualityInfo;
  /** SHA-256 del archivo original: deduplicación por contenido. */
  contentHash?: string;
  /** Identificación exacta en Spotify (cuando la pista viene de ahí). */
  spotifyId?: string;
  /** false = solo metadatos: necesita una fuente de audio autorizada. */
  hasAudio: boolean;
  analysis: AnalysisState;
  analysisError?: string;
  /** Etiquetas libres del usuario (bases para búsquedas y smart playlists). */
  tags?: string[];
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
  /** Playlists inteligentes: especificaciones evaluadas al vuelo. */
  smartPlaylists: SmartPlaylist[];
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
  private data: LibraryData = { tracks: [], playlists: [], smartPlaylists: [], queue: [], history: { events: [] }, recordings: [] };

  constructor(private readonly store: TrackStore) {}

  async init(): Promise<void> {
    const saved = await this.store.getJson<Partial<LibraryData>>(LIBRARY_KEY);
    if (saved && Array.isArray(saved.tracks)) {
      // Migración: pistas guardadas antes de los campos de análisis/audio.
      for (const track of saved.tracks) {
        if (track.hasAudio === undefined) track.hasAudio = true;
        if (track.analysis === undefined) {
          track.analysis = (track.peaks?.length ?? 0) > 0 ? 'complete' : 'pending';
        }
      }
      this.data = {
        tracks: saved.tracks,
        playlists: Array.isArray(saved.playlists) ? saved.playlists : [],
        smartPlaylists: Array.isArray(saved.smartPlaylists) ? saved.smartPlaylists : [],
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
    const track: TrackMeta = {
      ...meta,
      id: newId(),
      addedAt: new Date().toISOString(),
      hasAudio: meta.hasAudio ?? true,
      analysis: meta.analysis ?? 'complete',
    };
    await this.store.putBytes(track.id, bytes);
    this.data.tracks = [track, ...this.data.tracks];
    await this.persist();
    return track;
  }

  /** Añade una pista SOLO de metadatos (sin bytes): referencia Spotify pendiente de audio. */
  async addMetadataTrack(meta: Omit<TrackMeta, 'id' | 'addedAt' | 'hasAudio' | 'analysis'>): Promise<TrackMeta> {
    const track: TrackMeta = { ...meta, id: newId(), addedAt: new Date().toISOString(), hasAudio: false, analysis: 'pending' };
    this.data.tracks = [track, ...this.data.tracks];
    await this.persist();
    return track;
  }

  /** Adjunta bytes reales a una pista que era solo metadatos (fuente autorizada encontrada). */
  async attachAudio(id: string, bytes: Uint8Array, patch: Partial<TrackMeta>): Promise<TrackMeta | null> {
    const track = this.getTrack(id);
    if (!track) return null;
    await this.store.putBytes(id, bytes);
    Object.assign(track, patch, { hasAudio: true });
    await this.persist();
    return track;
  }

  /** Duplicado por contenido (hash) o por identificación exacta de Spotify. */
  findDuplicate(contentHash?: string, spotifyId?: string): TrackMeta | null {
    if (spotifyId) {
      const bySpotify = this.data.tracks.find((t) => t.spotifyId === spotifyId);
      if (bySpotify) return bySpotify;
    }
    if (contentHash) {
      const byHash = this.data.tracks.find((t) => t.contentHash === contentHash);
      if (byHash) return byHash;
    }
    return null;
  }

  /** Actualiza metadatos editables (título, artista, álbum, género, fecha, nº). */
  async updateMetadata(id: string, patch: Partial<Pick<TrackMeta, 'title' | 'artist' | 'album' | 'genre' | 'date' | 'trackNumber' | 'tags'>>): Promise<TrackMeta | null> {
    const track = this.getTrack(id);
    if (!track) return null;
    Object.assign(track, patch);
    await this.persist();
    return track;
  }

  /** Guarda el resultado real (o el fallo) de un análisis. */
  async setAnalysis(id: string, state: AnalysisState, error?: string): Promise<void> {
    const track = this.getTrack(id);
    if (!track) return;
    track.analysis = state;
    track.analysisError = error;
    await this.persist();
  }

  async setQuality(id: string, quality: QualityInfo): Promise<void> {
    const track = this.getTrack(id);
    if (!track) return;
    track.quality = quality;
    await this.persist();
  }

  /** Guarda el resultado de (re)analizar: picos, BPM y tonalidad reales. */
  async setTrackAnalysisData(
    id: string,
    data: Partial<Pick<TrackMeta, 'peaks' | 'bpm' | 'bpmSource' | 'key' | 'durationSec'>>,
  ): Promise<void> {
    const track = this.getTrack(id);
    if (!track) return;
    Object.assign(track, data);
    await this.persist();
  }

  // ---------- Playlists inteligentes ----------

  get smartPlaylists(): readonly SmartPlaylist[] {
    return this.data.smartPlaylists;
  }

  async addSmartPlaylist(playlist: SmartPlaylist): Promise<void> {
    this.data.smartPlaylists = [...this.data.smartPlaylists, playlist];
    await this.persist();
  }

  async removeSmartPlaylist(id: string): Promise<void> {
    this.data.smartPlaylists = this.data.smartPlaylists.filter((p) => p.id !== id);
    await this.persist();
  }

  // ---------- Portabilidad de metadatos ----------

  /** Documento portátil: pistas + playlists + smart (los bytes no viajan). */
  exportDoc(): LibraryData {
    return structuredClone(this.data);
  }

  /** Fusiona un documento: pistas nuevas por id/hash, sin duplicar físicos. */
  async importDoc(doc: LibraryData): Promise<{ added: number; skipped: number }> {
    let added = 0;
    let skipped = 0;
    for (const track of doc.tracks ?? []) {
      if (this.getTrack(track.id) || this.findDuplicate(track.contentHash, track.spotifyId)) {
        skipped += 1;
        continue;
      }
      this.data.tracks = [track, ...this.data.tracks];
      added += 1;
    }
    for (const playlist of doc.playlists ?? []) {
      if (this.data.playlists.some((p) => p.id === playlist.id)) continue;
      this.data.playlists = [...this.data.playlists, playlist];
    }
    for (const smart of doc.smartPlaylists ?? []) {
      if (this.data.smartPlaylists.some((p) => p.id === smart.id)) continue;
      this.data.smartPlaylists = [...this.data.smartPlaylists, smart];
    }
    await this.persist();
    return { added, skipped };
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
