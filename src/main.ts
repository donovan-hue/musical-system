import { AudioEngine } from './audio/engine.js';
import type { DeckId } from './audio/deck.js';
import { decodeAudioBytes, computePeaks, estimateBpm, toMono } from './audio/analysis.js';
import { effectiveBpm, syncRate } from './audio/rate.js';
import type { LoopBeats } from './audio/key.js';
import { beatLoop, beatSeconds, estimateKey, formatKey } from './audio/key.js';
import type { FxKind } from './audio/fx.js';
import type { EqBand } from './audio/settings.js';
import { MasterRecorder } from './audio/recorder.js';
import { SAMPLER_PADS, type SamplerPad } from './audio/sampler.js';
import type { TrackMeta } from './library/library.js';
import { Library } from './library/library.js';
import { createTrackStore } from './library/storage.js';
import { validateAudioFile } from './library/fileValidate.js';
import { parseId3 } from './util/id3.js';
import { DeckView } from './ui/deckView.js';
import { MixerView } from './ui/mixerView.js';
import { LibraryView } from './ui/libraryView.js';
import { QueueView } from './ui/queueView.js';
import { SamplerView } from './ui/samplerView.js';
import { RecorderView } from './ui/recorderView.js';
import { HistoryView } from './ui/historyView.js';
import { ConverterView } from './ui/converterView.js';
import { installThemeToggle } from './ui/theme.js';
import { showToast } from './ui/toast.js';
import { loadMixerState, saveMixerState } from './ui/mixerStore.js';
import { ImportQueueView } from './ui/importQueue.js';
import { sha256Hex } from './util/hash.js';
import { computeQuality, type QualityInfo } from './util/quality.js';
import { parseSpotifyPlaylistUrl } from './library/spotify.js';
import { requestAudio, matchCandidates, fetchSpotifyPlaylist, downloadJson } from './ui/convertApi.js';
import type { SmartPlaylist } from './library/smart.js';

const PEAK_BUCKETS = 1400;

type DeckBpmSource = TrackMeta['bpmSource'];

interface AppState {
  baseBpm: Record<DeckId, number | null>;
  bpmSource: Record<DeckId, DeckBpmSource>;
  loadedTrackId: Record<DeckId, string | null>;
  loadedMeta: Record<DeckId, TrackMeta | null>;
}

async function main(): Promise<void> {
  const app = document.getElementById('app');
  if (!app) throw new Error('Missing #app');
  app.innerHTML = `
    <header class="topbar">
      <div class="brand">
        <h1>🎛️ Musical System</h1>
        <span class="subtitle">Cabina DJ digital · 2 decks · biblioteca local · convertidor</span>
      </div>
      <span class="spacer"></span>
      <button class="btn btn-mini theme-toggle" aria-label="Cambiar tema"></button>
    </header>
    <main class="layout"></main>
    <div class="dock-wrap">
      <nav class="dock-tabs" role="tablist" aria-label="Paneles"></nav>
      <div class="dock-panel"></div>
    </div>
    <div class="toasts"></div>
  `;
  const layout = app.querySelector('.layout') as HTMLElement;
  const dockTabs = app.querySelector('.dock-tabs') as HTMLElement;
  const dockPanel = app.querySelector('.dock-panel') as HTMLElement;
  const toasts = app.querySelector('.toasts') as HTMLElement;
  const toast = (msg: string, kind: 'info' | 'error' | 'ok' = 'info') => showToast(toasts, msg, kind);
  installThemeToggle(app.querySelector('.theme-toggle') as HTMLButtonElement, toast);

  // ---------- Storage + biblioteca ----------
  const store = await createTrackStore();
  if (store.kind === 'memory') {
    toast('Tu navegador no expone OPFS ni IndexedDB: la biblioteca vive solo en memoria.', 'error');
  }
  const library = new Library(store);
  await library.init();

  // ---------- Motor de audio (contexto en el primer gesto) ----------
  const engine = new AudioEngine();
  let mixerApplied = false;
  const ensureEngine = (): AudioContext => {
    const ctx = engine.ensure();
    if (!mixerApplied) {
      engine.applyState(loadMixerState());
      mixerApplied = true;
    }
    return ctx;
  };

  const state: AppState = {
    baseBpm: { A: null, B: null },
    bpmSource: { A: 'estimated', B: 'estimated' },
    loadedTrackId: { A: null, B: null },
    loadedMeta: { A: null, B: null },
  };
  let queueAuto = true;
  let recorder: MasterRecorder | null = null;
  let sessionTracks = new Set<string>();

  // ---------- Acciones de biblioteca ----------
  async function artworkThumb(data: Uint8Array, mime: string): Promise<string | null> {
    try {
      const blob = new Blob([data.slice().buffer as ArrayBuffer], { type: mime });
      const bitmap = await createImageBitmap(blob);
      const size = 96;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx2d = canvas.getContext('2d');
      if (!ctx2d) return null;
      const scale = Math.max(size / bitmap.width, size / bitmap.height);
      const w = bitmap.width * scale;
      const h = bitmap.height * scale;
      ctx2d.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h);
      bitmap.close();
      return canvas.toDataURL('image/jpeg', 0.8);
    } catch {
      return null;
    }
  }

  /** Análisis REAL: decodifica y calcula picos, BPM y tonalidad. Falla honesto. */
  async function analyzeBytes(bytes: Uint8Array): Promise<{
    buffer: AudioBuffer;
    peaks: number[];
    tags: ReturnType<typeof parseId3>;
    bpm: number | null;
    bpmSource: DeckBpmSource;
    key: ReturnType<typeof estimateKey>;
  }> {
    const ctx = ensureEngine();
    const buffer = await decodeAudioBytes(ctx, bytes.buffer as ArrayBuffer);
    if (!buffer) throw new Error('No se pudo decodificar el audio (archivo corrupto o formato incompatible).');
    const mono = toMono((i) => buffer.getChannelData(i), buffer.numberOfChannels, buffer.length);
    const peaks = Array.from(computePeaks(mono, PEAK_BUCKETS));
    const tags = parseId3(bytes);
    const bpm = tags.bpm ? tags.bpm : estimateBpm(mono, buffer.sampleRate);
    const bpmSource: DeckBpmSource = tags.bpm ? 'tag' : 'estimated';
    const key = estimateKey(mono, buffer.sampleRate);
    return { buffer, peaks, tags, bpm, bpmSource, key };
  }

  function analysisState(bpm: number | null, key: unknown): 'complete' | 'partial' {
    return bpm !== null && key !== null && key !== undefined ? 'complete' : 'partial';
  }

  /**
   * Pipeline real de importación: hash (dedup por contenido) → análisis →
   * metadatos → OPFS. Devuelve la pista y si era un duplicado físico.
   */
  async function importAudioBytes(
    fileName: string,
    bytes: Uint8Array,
    origin: TrackMeta['origin'],
    qualityHint?: QualityInfo,
  ): Promise<{ track: TrackMeta; duplicate: boolean }> {
    const hash = await sha256Hex(bytes);
    const existing = library.findDuplicate(hash);
    if (existing) return { track: existing, duplicate: true };

    const a = await analyzeBytes(bytes);
    const artwork = a.tags.artwork ? await artworkThumb(a.tags.artwork.data, a.tags.artwork.mime) : null;
    const quality: QualityInfo =
      qualityHint ??
      computeQuality(fileName, bytes.byteLength, {
        sampleRate: a.buffer.sampleRate,
        channels: a.buffer.numberOfChannels,
        durationSec: a.buffer.duration,
      });
    const track = await library.addTrack(
      {
        fileName,
        title: a.tags.title || stripExtension(fileName),
        artist: a.tags.artist || 'Desconocido',
        album: a.tags.album ?? '',
        bpm: a.bpm,
        bpmSource: a.bpmSource,
        durationSec: a.buffer.duration,
        sizeBytes: bytes.byteLength,
        peaks: a.peaks,
        key: a.key,
        genre: a.tags.genre ?? '',
        date: a.tags.date ?? '',
        trackNumber: a.tags.trackNumber,
        artwork: artwork ?? undefined,
        origin,
        favorite: false,
        hotCues: new Array<number | null>(8).fill(null),
        playCount: 0,
        lastPlayedAt: null,
        contentHash: hash,
        quality,
        hasAudio: true,
        analysis: analysisState(a.bpm, a.key),
      },
      bytes,
    );
    return { track, duplicate: false };
  }

  /** Re-análisis real de una pista existente (BPM, tonalidad, picos, calidad). */
  async function reanalyzeTrack(trackId: string): Promise<void> {
    const meta = library.getTrack(trackId);
    if (!meta || !meta.hasAudio) return;
    const qid = importQueue.push(`Re-análisis: ${meta.title}`, 'procesando');
    const bytes = await store.getBytes(trackId);
    if (!bytes) {
      await library.setAnalysis(trackId, 'failed', 'No se encontraron los bytes de la pista.');
      importQueue.set(qid, 'error', 'bytes no encontrados');
      refreshAll();
      return;
    }
    try {
      const a = await analyzeBytes(bytes);
      await library.setTrackAnalysisData(trackId, {
        peaks: a.peaks,
        bpm: a.bpm,
        bpmSource: a.bpmSource,
        key: a.key,
        durationSec: a.buffer.duration,
      });
      await library.setQuality(
        trackId,
        computeQuality(meta.fileName, bytes.byteLength, {
          sampleRate: a.buffer.sampleRate,
          channels: a.buffer.numberOfChannels,
          durationSec: a.buffer.duration,
        }),
      );
      await library.setAnalysis(trackId, analysisState(a.bpm, a.key));
      importQueue.set(qid, 'completada');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await library.setAnalysis(trackId, 'failed', message);
      importQueue.set(qid, 'error', message);
    }
    refreshAll();
  }

  async function importFiles(files: File[]): Promise<void> {
    if (files.length > 1) {
      importQueue.begin(files.map((f) => f.name));
      switchTab('lotes');
    }
    let index = 0;
    for (const file of files) {
      const qid = files.length > 1 ? String(index) : null;
      index += 1;
      const verdict = validateAudioFile(file.name, file.size, file.type);
      if (!verdict.ok) {
        toast(verdict.reason, 'error');
        if (qid) importQueue.set(qid, 'error', verdict.reason);
        continue;
      }
      importQueue.set(qid ?? '_', 'procesando');
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (bytes.length === 0) {
          toast(`"${file.name}" está vacío.`, 'error');
          if (qid) importQueue.set(qid, 'error', 'archivo vacío');
          continue;
        }
        const { track, duplicate } = await importAudioBytes(file.name, bytes, { type: 'import' });
        if (duplicate) {
          toast(`"${track.title}" ya está en la biblioteca (duplicado por contenido): no se copió de nuevo.`, 'info');
          if (qid) importQueue.set(qid, 'completada', 'duplicado: referencia existente');
        } else {
          toast(
            `"${track.title}" importada · ${track.bpm ? `${track.bpm.toFixed(1)} BPM · ` : ''}${formatKey(track.key)}`,
            'ok',
          );
          if (qid) importQueue.set(qid, 'completada');
        }
        refreshAll();
      } catch (error) {
        console.error(error);
        const quota = error instanceof DOMException && error.name === 'QuotaExceededError';
        const message = quota
          ? 'Espacio insuficiente en el almacenamiento del navegador para este archivo.'
          : error instanceof Error
            ? error.message
            : String(error);
        toast(`Error importando "${file.name}": ${message}`, 'error');
        if (qid) importQueue.set(qid, 'error', message.slice(0, 120));
      }
    }
  }

  async function loadTrackToDeck(trackId: string, deckId: DeckId): Promise<boolean> {
    const meta = library.getTrack(trackId);
    if (!meta) return false;
    if (!meta.hasAudio) {
      toast('Esa pista es solo metadatos: busca una fuente de audio autorizada primero (🔎 Fuente…).', 'error');
      return false;
    }
    const bytes = await store.getBytes(trackId);
    if (!bytes) {
      toast('No encontré los bytes de esa pista (¿se borró el almacenamiento?).', 'error');
      return false;
    }
    const ctx = ensureEngine();
    const buffer = await decodeAudioBytes(ctx, bytes.buffer as ArrayBuffer);
    if (!buffer) {
      toast(`No se pudo decodificar "${meta.fileName}" ahora mismo.`, 'error');
      return false;
    }
    const deck = engine.deck(deckId);
    deck.load(buffer); // el estado del mezclador sobrevive a la carga
    deck.onEnded = () => void handleDeckEnded(deckId);
    state.baseBpm[deckId] = meta.bpm;
    state.bpmSource[deckId] = meta.bpmSource;
    state.loadedTrackId[deckId] = trackId;
    state.loadedMeta[deckId] = meta;
    deckViews[deckId].setTrack({
      title: meta.title,
      artist: meta.artist,
      keyLabel: formatKey(meta.key),
      genre: meta.genre ?? '',
      bpm: meta.bpm,
      bpmSource: meta.bpmSource,
      durationSec: buffer.duration,
      peaks: meta.peaks,
      artwork: meta.artwork ?? null,
      hotCues: meta.hotCues ?? new Array<number | null>(8).fill(null),
    });
    if (recorder && recorder.state !== 'idle') sessionTracks.add(trackId);
    refreshAll();
    return true;
  }

  async function removeTrack(trackId: string): Promise<void> {
    await library.removeTrack(trackId);
    for (const id of ['A', 'B'] as const) {
      if (state.loadedTrackId[id] === trackId) {
        state.loadedTrackId[id] = null;
        state.loadedMeta[id] = null;
        state.baseBpm[id] = null;
        if (engine.booted) engine.deck(id).stop();
        deckViews[id].clearTrack();
      }
    }
    refreshAll();
  }

  /** Carga la siguiente pista de la cola en un deck (auto-DJ o manual). */
  async function loadNextInto(deckId: DeckId, autoplay: boolean): Promise<void> {
    const head = library.queue[0];
    if (!head) {
      toast('La cola está vacía.', 'info');
      return;
    }
    const ok = await loadTrackToDeck(head, deckId);
    if (!ok) {
      await library.dequeue(head); // pista rota: fuera de la cola
      refreshAll();
      return;
    }
    await library.dequeue(head);
    refreshAll();
    if (autoplay) engine.deck(deckId).play();
  }

  function idleDeckId(): DeckId {
    if (engine.booted) {
      if (!engine.deck('A').isPlaying) return 'A';
      if (!engine.deck('B').isPlaying) return 'B';
    }
    return 'A';
  }

  async function handleDeckEnded(deckId: DeckId): Promise<void> {
    const trackId = state.loadedTrackId[deckId];
    if (trackId) await library.logPlayed(trackId, deckId, engine.deck(deckId).duration);
    if (queueAuto && library.queue.length > 0) {
      toast(`Deck ${deckId}: siguiente de la cola…`, 'info');
      await loadNextInto(deckId, true);
    }
    refreshAll();
  }

  // ---------- Callbacks de deck ----------
  function deckCallbacks(id: DeckId) {
    const view = () => deckViews[id];
    return {
      onPlayPause: () => {
        const d = engine.deck(id);
        if (!d.hasTrack) return;
        if (d.isPlaying) d.pause();
        else d.play();
      },
      onStop: () => engine.deck(id).stop(),
      onCueJump: () => engine.deck(id).cueJump(),
      onCueSet: () => {
        const d = engine.deck(id);
        d.setCue();
        toast(`Cue ${id} fijado en ${d.position.toFixed(1)}s`, 'ok');
      },
      onLoopIn: () => engine.deck(id).loopIn(),
      onLoopOut: () => engine.deck(id).loopOut(),
      onLoopExit: () => engine.deck(id).setLoop(null),
      onLoopBeats: (beats: LoopBeats) => {
        const d = engine.deck(id);
        const bpm = state.baseBpm[id];
        const beatSec = beatSeconds(bpm ?? NaN, d.rate);
        if (!beatSec) {
          toast('Los loops por beat necesitan BPM conocido (fija o ajusta el BPM).', 'error');
          return;
        }
        const region = beatLoop(d.position, beatSec, beats, d.duration);
        if (!region) {
          toast('Ese loop no cabe desde esta posición.', 'error');
          return;
        }
        d.setLoop(region);
      },
      onPitch: (rate: number) => {
        engine.deck(id).setRate(rate);
        markMixerDirty();
      },
      onPitchReset: () => {
        engine.deck(id).setRate(1);
        markMixerDirty();
      },
      onSync: () => {
        const otherId: DeckId = id === 'A' ? 'B' : 'A';
        const target = effectiveBpm(state.baseBpm[otherId], engine.deck(otherId).rate);
        const base = state.baseBpm[id];
        if (!base || !target) {
          toast('Sync necesita BPM conocidos en ambos decks.', 'error');
          return;
        }
        const rate = syncRate(base, target);
        if (rate === null) {
          toast(`Fuera de rango de pitch (±8%): ${base.toFixed(1)} → ${target.toFixed(1)} BPM.`, 'error');
          return;
        }
        const d = engine.deck(id);
        d.setRate(rate);
        view().setPitchDisplay(rate);
        markMixerDirty();
        toast(`Deck ${id} sincronizado a ${target.toFixed(1)} BPM.`, 'ok');
      },
      onWaveSeek: (seconds: number) => engine.deck(id).seek(seconds),
      onJogScrub: (deltaSec: number) => {
        const d = engine.deck(id);
        d.seek(d.position + deltaSec);
      },
      onJogNudge: (factor: number) => engine.deck(id).setNudge(factor),
      onJogEnd: () => engine.deck(id).clearNudge(),
      onFx: (kind: FxKind | null) => {
        const d = engine.deck(id);
        d.setFx(kind);
        if (kind === 'echo') {
          const beatSec = beatSeconds(state.baseBpm[id] ?? NaN, d.rate);
          if (beatSec) d.setFxTime(beatSec * 0.75); // echo sincronizado (dotted ⅛)
        }
      },
      onFxAmount: (amount: number) => engine.deck(id).setFxAmount(amount),
      onHotCue: (index: number, action: 'hit' | 'set' | 'clear') => {
        const trackId = state.loadedTrackId[id];
        if (!trackId) {
          toast(`Deck ${id} no tiene pista.`, 'error');
          return;
        }
        const d = engine.deck(id);
        const meta = library.getTrack(trackId);
        const cues = meta?.hotCues ?? new Array<number | null>(8).fill(null);
        if (action === 'set' || (action === 'hit' && cues[index] == null)) {
          const pos = d.position;
          void library.setHotCue(trackId, index as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7, pos).then(() => {
            const updated = library.getTrack(trackId)?.hotCues ?? cues;
            view().refreshHotCues(updated);
            state.loadedMeta[id] = library.getTrack(trackId);
            toast(`Hot cue ${index + 1} fijado en ${pos.toFixed(1)}s.`, 'ok');
          });
          return;
        }
        if (action === 'clear') {
          void library.setHotCue(trackId, index as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7, null).then(() => {
            const updated = library.getTrack(trackId)?.hotCues ?? cues;
            view().refreshHotCues(updated);
            state.loadedMeta[id] = library.getTrack(trackId);
          });
          return;
        }
        const pos = cues[index];
        if (pos != null) d.seek(pos);
      },
      onBpmSet: (bpm: number) => {
        const trackId = state.loadedTrackId[id];
        if (!trackId) return;
        void library.setBpm(trackId, bpm, 'manual').then(() => {
          state.baseBpm[id] = bpm;
          state.bpmSource[id] = 'manual';
          state.loadedMeta[id] = library.getTrack(trackId);
          deckViews[id].refreshBpm(bpm, 'manual');
          refreshAll();
        });
      },
      onBpmMultiply: (factor: 2 | 0.5) => {
        const trackId = state.loadedTrackId[id];
        const base = state.baseBpm[id];
        if (!trackId || !base) return;
        const next = Math.round(base * factor * 10) / 10;
        void library.setBpm(trackId, next, 'manual').then(() => {
          state.baseBpm[id] = next;
          state.bpmSource[id] = 'manual';
          state.loadedMeta[id] = library.getTrack(trackId);
          deckViews[id].refreshBpm(next, 'manual');
          refreshAll();
        });
      },
    };
  }

  // ---------- Vistas ----------
  const mixerView = new MixerView({
    onTrim: (deck, gain) => {
      engine.deck(deck).setTrim(gain);
      markMixerDirty();
    },
    onEq: (deck, band: EqBand, db) => {
      engine.deck(deck).setEq(band, db);
      markMixerDirty();
    },
    onFilter: (deck, position) => {
      engine.deck(deck).setFilter(position);
      markMixerDirty();
    },
    onVolume: (deck, position) => {
      engine.deck(deck).setVolume(position);
      markMixerDirty();
    },
    onCueToggle: (deck, on) => engine.deck(deck).setCueSend(on),
    onMaster: (pos) => {
      engine.setMasterVolume(pos);
      markMixerDirty();
    },
    onLimiterToggle: (enabled) => {
      engine.setLimiterEnabled(enabled);
      markMixerDirty();
    },
    onCrossfader: (pos) => {
      engine.setCrossfader(pos);
      markMixerDirty();
    },
    onCueMix: (mix) => {
      engine.setCueMix(mix);
      markMixerDirty();
    },
  });

  // ---------- Reproducción previa real (HTMLAudio independiente de los decks) ----------
  const previewAudio = new Audio();
  previewAudio.volume = 0.9;
  let previewTrackId: string | null = null;
  let previewUrl: string | null = null;

  async function togglePreview(trackId: string): Promise<void> {
    if (previewTrackId === trackId && !previewAudio.paused) {
      previewAudio.pause();
      libraryView.setPreview(null);
      previewTrackId = null;
      return;
    }
    const bytes = await store.getBytes(trackId);
    if (!bytes) {
      toast('No encontré los bytes de esa pista.', 'error');
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer]));
    previewAudio.src = previewUrl;
    previewAudio.onended = () => {
      libraryView.setPreview(null);
      previewTrackId = null;
    };
    previewTrackId = trackId;
    libraryView.setPreview(trackId);
    try {
      await previewAudio.play();
    } catch {
      toast('El navegador bloqueó la reproducción: interactúa con la página y repite.', 'error');
    }
  }

  // ---------- Spotify (metadatos oficiales; sin audio protegido) ----------
  async function importSpotifyPlaylist(rawUrl: string): Promise<void> {
    const check = parseSpotifyPlaylistUrl(rawUrl);
    if (!check.ok) {
      toast(check.reason, 'error');
      return;
    }
    toast('Pidiendo metadatos a la API de Spotify…');
    const result = await fetchSpotifyPlaylist(rawUrl);
    if (!result.ok) {
      toast(result.error, 'error');
      if (result.detail) console.warn('Detalle Spotify:', result.detail);
      return;
    }
    const { playlist } = result;
    const created = await library.createPlaylist(playlist.name);
    importQueue.begin(playlist.tracks.map((t) => `${t.artists} — ${t.title}`));
    switchTab('lotes');
    for (const t of playlist.tracks) {
      const dup = library.findDuplicate(undefined, t.spotifyId);
      if (dup) {
        await library.addToPlaylist(created.id, dup.id);
        importQueue.set(t.spotifyId, 'completada', 'referencia (ya en biblioteca)');
        continue;
      }
      const createdTrack = await library.addMetadataTrack({
        fileName: `${t.artists} - ${t.title}.spotify`,
        title: t.title,
        artist: t.artists || 'Desconocido',
        album: t.album,
        bpm: null,
        bpmSource: 'estimated',
        durationSec: t.durationMs / 1000,
        sizeBytes: 0,
        peaks: [],
        key: null,
        genre: '',
        date: t.releaseDate,
        trackNumber: t.trackNumber !== null ? String(t.trackNumber) : undefined,
        artwork: t.coverUrl ?? undefined,
        origin: { type: 'spotify', sourceUrl: t.spotifyUrl },
        spotifyId: t.spotifyId,
        favorite: false,
        hotCues: new Array<number | null>(8).fill(null),
        playCount: 0,
        lastPlayedAt: null,
      });
      await library.addToPlaylist(created.id, createdTrack.id);
      importQueue.set(t.spotifyId, 'pendiente', 'requiere fuente de audio autorizada');
    }
    refreshAll();
    toast(
      `Playlist "${playlist.name}" de ${playlist.owner}: ${playlist.tracks.length} referencias creadas, pendientes de fuente de audio autorizada.`,
      'ok',
    );
  }

  /** Busca candidatos REALES (yt-dlp) para una pista solo-metadatos. */
  async function findSources(trackId: string): Promise<void> {
    const meta = library.getTrack(trackId);
    if (!meta) return;
    const query = [meta.artist !== 'Desconocido' ? meta.artist : '', meta.title].filter(Boolean).join(' ').trim();
    toast(`Buscando fuentes para "${meta.title}"…`);
    const result = await matchCandidates(query);
    if (!result.ok) {
      libraryView.showMatchError(result.error, result.detail);
      toast(result.error, 'error');
      return;
    }
    libraryView.showCandidates(trackId, result.candidates);
    if (result.candidates.length === 0) toast('Sin resultados para esa búsqueda.', 'info');
  }

  /** Trae el audio EXACTO elegido por el usuario (sin sustituir versiones). */
  async function pickSource(trackId: string, url: string): Promise<void> {
    const meta = library.getTrack(trackId);
    if (!meta) return;
    toast(`Trayendo audio elegido para "${meta.title}"…`);
    const result = await requestAudio(url, 'original');
    if (!result.ok) {
      toast(result.error, 'error');
      return;
    }
    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    const hash = await sha256Hex(bytes);
    if (library.findDuplicate(hash)) {
      toast('Ese audio ya está en la biblioteca (duplicado por contenido).', 'info');
      return;
    }
    let analysis: Awaited<ReturnType<typeof analyzeBytes>>;
    try {
      analysis = await analyzeBytes(bytes);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await library.setAnalysis(trackId, 'failed', message);
      refreshAll();
      toast(`El audio llegó pero no se pudo analizar: ${message}`, 'error');
      return;
    }
    await library.attachAudio(trackId, bytes, {
      fileName: result.fileName,
      durationSec: analysis.buffer.duration,
      sizeBytes: bytes.byteLength,
      peaks: analysis.peaks,
      bpm: analysis.bpm,
      bpmSource: analysis.bpmSource,
      key: analysis.key,
      contentHash: hash,
      quality: result.quality,
      origin: { type: 'match', sourceUrl: url },
      analysis: analysisState(analysis.bpm, analysis.key),
      analysisError: undefined,
    });
    refreshAll();
    const q = result.quality;
    toast(
      `"${meta.title}" tiene audio: ${q.format}${q.bitrateKbps != null ? ` · ${q.bitrateKbps} kbps` : ''} (fuente elegida por ti).`,
      'ok',
    );
  }

  // ---------- Acciones por lotes ----------
  async function batchToDeck(deckId: DeckId, trackIds: string[]): Promise<void> {
    const first = trackIds.map((id) => library.getTrack(id)).find((t) => t?.hasAudio);
    if (!first) {
      toast('Ninguna de las pistas elegidas tiene audio todavía.', 'error');
      return;
    }
    const ok = await loadTrackToDeck(first.id, deckId);
    if (ok) toast(`"${first.title}" → Deck ${deckId} (primera de ${trackIds.length} elegidas).`, 'ok');
  }

  async function batchReanalyze(trackIds: string[]): Promise<void> {
    importQueue.begin(trackIds.map((id) => library.getTrack(id)?.title ?? id));
    switchTab('lotes');
    let index = 0;
    for (const id of trackIds) {
      await reanalyzeTrack(id);
      importQueue.set(String(index), library.getTrack(id)?.analysis === 'failed' ? 'error' : 'completada');
      index += 1;
    }
  }

  async function batchRemove(trackIds: string[]): Promise<void> {
    if (!window.confirm(`¿Quitar ${trackIds.length} pistas de la biblioteca? Los archivos se borran del almacenamiento.`)) return;
    for (const id of trackIds) await removeTrack(id);
    checkedClear();
    refreshAll();
  }

  function checkedClear(): void {
    // La vista limpia su propia selección al re-renderizar la barra.
  }

  const libraryView = new LibraryView({
    onImportFiles: (files) => void importFiles(files),
    onLoadToDeck: (trackId, deckId) => void loadTrackToDeck(trackId, deckId),
    onPreview: (trackId) => void togglePreview(trackId),
    onRemoveTrack: (trackId) => void removeTrack(trackId),
    onToggleFavorite: (trackId) =>
      void library.toggleFavorite(trackId).then(() => refreshAll()),
    onEnqueue: (trackId) =>
      void library.enqueue(trackId).then((added) => {
        if (!added) toast('Esa pista ya está en la cola.', 'info');
        refreshAll();
      }),
    onCreatePlaylist: (name) => void library.createPlaylist(name).then(refreshAll),
    onDeletePlaylist: (playlistId) => void library.deletePlaylist(playlistId).then(refreshAll),
    onAddToPlaylist: (playlistId, trackId) =>
      void library.addToPlaylist(playlistId, trackId).then((added) => {
        if (!added) toast('Esa referencia ya está en la playlist.', 'info');
        refreshAll();
      }),
    onRemoveFromPlaylist: (playlistId, trackId) =>
      void library.removeFromPlaylist(playlistId, trackId).then(refreshAll),
    onMove: (playlistId, trackId, delta) =>
      void library.moveInPlaylist(playlistId, trackId, delta).then(refreshAll),
    onUpdateMetadata: (trackId, patch) =>
      void library.updateMetadata(trackId, patch).then((updated) => {
        if (updated) toast('Metadatos actualizados.', 'ok');
        refreshAll();
      }),
    onReanalyze: (trackId) => void reanalyzeTrack(trackId),
    onBatchToDeck: (deckId, ids) => void batchToDeck(deckId, ids),
    onBatchToPlaylist: (playlistId, ids) => {
      let added = 0;
      const chain = ids.reduce<Promise<unknown>>((acc, id) => acc.then(() => library.addToPlaylist(playlistId, id).then((ok) => { if (ok) added += 1; })), Promise.resolve());
      void chain.then(() => {
        toast(`${added} referencias añadidas a la playlist.`, 'ok');
        refreshAll();
      });
    },
    onBatchReanalyze: (ids) => void batchReanalyze(ids),
    onBatchRemove: (ids) => void batchRemove(ids),
    onImportSpotify: (url) => void importSpotifyPlaylist(url),
    onFindSources: (trackId) => void findSources(trackId),
    onPickSource: (trackId, url) => void pickSource(trackId, url),
    onExportLibrary: () => {
      const doc = { app: 'musical-system', kind: 'library-metadata', version: 1, exportedAt: new Date().toISOString(), data: library.exportDoc() };
      downloadJson(`musical-system-biblioteca-${new Date().toISOString().slice(0, 10)}.json`, doc);
      toast('Metadatos exportados (los archivos de audio no viajan en el JSON).', 'ok');
    },
    onImportLibraryJson: (file) => {
      void file
        .text()
        .then((text) => {
          const parsed = JSON.parse(text) as { data?: Parameters<Library['importDoc']>[0] };
          const doc = parsed?.data ?? (parsed as Parameters<Library['importDoc']>[0]);
          if (!doc || !Array.isArray(doc.tracks)) throw new Error('El JSON no contiene pistas.');
          return library.importDoc(doc).then(({ added, skipped }) => {
            toast(`Metadatos importados: ${added} nuevas, ${skipped} duplicadas/omitidas.`, 'ok');
            refreshAll();
          });
        })
        .catch((error) => {
          console.error(error);
          toast(`JSON inválido: ${error instanceof Error ? error.message : String(error)}`, 'error');
        });
    },
    onCreateSmart: (spec: SmartPlaylist) => void library.addSmartPlaylist(spec).then(refreshAll),
    onDeleteSmart: (id) => void library.removeSmartPlaylist(id).then(refreshAll),
  });
  libraryView.el.addEventListener('libtoast', (event) => {
    const detail = (event as CustomEvent<string>).detail;
    if (detail) toast(detail, 'info');
  });

  const importQueue = new ImportQueueView();

  const queueView = new QueueView(
    {
      onNext: () => void loadNextInto(idleDeckId(), true),
      onRemove: (trackId) => void library.dequeue(trackId).then(refreshAll),
      onMove: (trackId, delta) => void library.moveInQueue(trackId, delta).then(refreshAll),
      onClear: () => void library.clearQueue().then(refreshAll),
      onSaveAsPlaylist: (name) =>
        void library.saveQueueAsPlaylist(name).then((playlist) => {
          if (playlist) toast(`Cola guardada como playlist "${name}".`, 'ok');
          refreshAll();
        }),
      onAutoToggle: (auto) => {
        queueAuto = auto;
      },
    },
    toast,
  );

  const samplerView = new SamplerView(
    {
      onTrigger: (pad) => {
        ensureEngine();
        return engine.sampler.play(pad);
      },
      onVolume: (position) => {
        ensureEngine();
        engine.sampler.bus.gain.setTargetAtTime(Math.max(0, Math.min(1, position)), engine.sampler.bus.context.currentTime, 0.02);
      },
    },
    toast,
  );

  const recorderView = new RecorderView(
    {
      onRecordStart: () => {
        ensureEngine();
        const stream = engine.recordStream;
        if (!stream) throw new Error('Este navegador no expone el stream de audio para grabar.');
        recorder = new MasterRecorder(stream);
        recorder.start(); // lanza si MediaRecorder no soporta audio
        sessionTracks = new Set(Object.values(state.loadedTrackId).filter((v): v is string => v !== null));
      },
      onRecordPause: () => recorder?.pause(),
      onRecordResume: () => recorder?.resume(),
      onRecordStopAndSave: async (name) => {
        if (!recorder) throw new Error('No hay grabación activa.');
        const result = await recorder.stop();
        recorder = null;
        if (!result) throw new Error('La grabación quedó vacía.');
        // Pistas cargadas durante la sesión completa.
        for (const id of ['A', 'B'] as const) {
          const tid = state.loadedTrackId[id];
          if (tid) sessionTracks.add(tid);
        }
        const bytes = new Uint8Array(await result.blob.arrayBuffer());
        return library.addRecording(
          {
            name,
            at: new Date().toISOString(),
            durationSec: result.durationSec,
            mimeType: result.mimeType,
            sizeBytes: bytes.byteLength,
            trackIds: [...sessionTracks],
          },
          bytes,
        );
      },
      onDiscard: async () => {
        if (recorder) {
          await recorder.stop();
          recorder = null;
        }
      },
      onDelete: (recordingId) => void library.removeRecording(recordingId).then(refreshAll),
    },
    toast,
    MasterRecorder.available(),
  );
  recorderView.setBytesProvider((id) => library.getRecordingBytes(id));

  const historyView = new HistoryView({
    onClear: () => void library.clearHistory().then(refreshAll),
  });

  const converterView = new ConverterView(toast, {
    onAddToLibrary: async (blob, info) => {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (bytes.length === 0) throw new Error('El audio traído está vacío.');
      const { track, duplicate } = await importAudioBytes(info.fileName, bytes, { type: 'convert', sourceUrl: info.sourceUrl }, info.quality);
      await library.logConversion(info.sourceUrl ?? '', track.title, track.fileName);
      refreshAll();
      if (duplicate) throw new Error(`ya estaba en la biblioteca como "${track.title}" (deduplicado por contenido)`);
      toast(
        `"${track.title}" añadida a la biblioteca · ${track.quality ? `${track.quality.format}${track.quality.bitrateKbps != null ? ` · ${track.quality.bitrateKbps} kbps` : ''}` : 'calidad registrada'}.`,
        'ok',
      );
    },
  });

  const deckCbs = { A: deckCallbacks('A'), B: deckCallbacks('B') };
  // Acento CSS (var) para la UI + color concreto para el canvas de la waveform.
  const deckViews: Record<DeckId, DeckView> = {
    A: new DeckView('A', 'var(--accent-a)', '#22d3ee', deckCbs.A),
    B: new DeckView('B', 'var(--accent-b)', '#f472b6', deckCbs.B),
  };

  layout.append(deckViews.A.el, mixerView.el, deckViews.B.el);
  for (const view of [libraryView.el, queueView.el, samplerView.el, recorderView.el, historyView.el, converterView.el, importQueue.el]) {
    dockPanel.appendChild(view);
    view.hidden = true;
  }

  // Pestañas del panel inferior
  const tabs: { id: string; label: string; el: HTMLElement }[] = [
    { id: 'library', label: '📚 Biblioteca', el: libraryView.el },
    { id: 'queue', label: '⏭ Cola', el: queueView.el },
    { id: 'sampler', label: '🥁 Sampler', el: samplerView.el },
    { id: 'recorder', label: '⏺ Grabadora', el: recorderView.el },
    { id: 'history', label: '🕘 Historial', el: historyView.el },
    { id: 'converter', label: '⤓ Fuentes (URL)', el: converterView.el },
    { id: 'lotes', label: '⇪ Lotes', el: importQueue.el },
  ];
  const tabButtons = tabs.map((tab) => {
    const btn = document.createElement('button');
    btn.className = 'dock-tab';
    btn.role = 'tab';
    btn.textContent = tab.label;
    btn.setAttribute('aria-selected', 'false');
    btn.addEventListener('click', () => switchTab(tab.id));
    dockTabs.appendChild(btn);
    return btn;
  });
  function switchTab(id: string): void {
    tabs.forEach((tab, index) => {
      const active = tab.id === id;
      tab.el.hidden = !active;
      tabButtons[index]!.setAttribute('aria-selected', String(active));
    });
  }
  switchTab('library');
  libraryView.setBackend(store.kind);

  // Restaurar faders persistidos en la UI (el motor aplica lo mismo al primer gesto).
  const restored = loadMixerState();
  for (const id of ['A', 'B'] as const) {
    const s = restored.decks[id];
    deckViews[id].setPitchDisplay(s.pitch);
  }
  mixerView.setFaders(restored);

  // ---------- Refresco global ----------
  function refreshAll(): void {
    libraryView.render(library.tracks, library.playlists, library.smartPlaylists);
    libraryView.setLoadedDecks({ A: state.loadedTrackId.A, B: state.loadedTrackId.B });
    libraryView.setQueue(library.queue);
    queueView.render(library.tracks, library.queue, { A: state.loadedTrackId.A, B: state.loadedTrackId.B });
    historyView.render(library.historyEvents, library.tracks, library.recordings);
    recorderView.renderRecordings(library.recordings);
  }
  refreshAll();

  // ---------- Persistencia del mezclador (con debounce) ----------
  let mixerDirty = false;
  let lastSave = 0;
  function markMixerDirty(): void {
    mixerDirty = true;
  }

  // ---------- Bucle de render ----------
  const frame = (): void => {
    if (engine.booted) {
      for (const id of ['A', 'B'] as const) {
        const deck = engine.peekDeck(id);
        if (!deck || !deck.hasTrack) continue;
        const meta = state.loadedMeta[id];
        const beatSec = beatSeconds(state.baseBpm[id] ?? NaN, deck.rate);
        deckViews[id].update({
          position: deck.position,
          duration: deck.duration,
          playing: deck.isPlaying,
          loop: deck.loopRegion,
          cue: deck.cue,
          hotCues: meta?.hotCues ?? new Array<number | null>(8).fill(null),
          beatSec: beatSec ?? null,
          effectiveBpm: effectiveBpm(state.baseBpm[id], deck.rate),
        });
        deckViews[id].renderWave();
      }
      mixerView.update({ A: engine.deckLevel('A'), B: engine.deckLevel('B') }, engine.limiterReductionDb);
      mixerView.renderSpectrum((target) => engine.masterSpectrum(target));

      if (mixerDirty && performance.now() - lastSave > 300) {
        saveMixerState(engine.captureState());
        mixerDirty = false;
        lastSave = performance.now();
      }
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // ---------- Teclado ----------
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
    const activeDeck: DeckId = engine.crossfader <= 0.5 ? 'A' : 'B';
    const hotIndex = parseInt(e.key, 10);
    if (hotIndex >= 1 && hotIndex <= 8 && engine.booted) {
      deckCbs[activeDeck].onHotCue(hotIndex - 1, 'hit');
      return;
    }
    if (e.code === 'KeyQ') deckViews.A.el.querySelector<HTMLButtonElement>('.btn-play')?.click();
    else if (e.code === 'KeyP') deckViews.B.el.querySelector<HTMLButtonElement>('.btn-play')?.click();
    else if (e.code === 'Space') {
      e.preventDefault();
      deckViews[activeDeck].el.querySelector<HTMLButtonElement>('.btn-play')?.click();
    } else {
      const samplerIndex = 'asdfgh'.indexOf(e.key.toLowerCase());
      if (samplerIndex >= 0) {
        const pad = SAMPLER_PADS[samplerIndex]!.id as SamplerPad;
        ensureEngine();
        const duration = engine.sampler.play(pad);
        samplerView.triggerFromKeyboard(pad, duration);
      }
    }
  });
}

function stripExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

void main().catch((error) => {
  console.error(error);
  document.body.textContent = `Error al iniciar: ${error instanceof Error ? error.message : String(error)}`;
});
