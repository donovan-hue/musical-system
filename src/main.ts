import { AudioEngine } from './audio/engine.js';
import type { DeckId } from './audio/deck.js';
import { decodeAudioBytes, computePeaks, estimateBpm, toMono } from './audio/analysis.js';
import { effectiveBpm, syncRate } from './audio/rate.js';
import type { EqBand } from './audio/settings.js';
import type { TrackMeta } from './library/library.js';
import { Library } from './library/library.js';
import { createTrackStore } from './library/storage.js';
import { validateAudioFile } from './library/fileValidate.js';
import { parseId3 } from './util/id3.js';
import { DeckView } from './ui/deckView.js';
import { MixerView } from './ui/mixerView.js';
import { LibraryView } from './ui/libraryView.js';
import { ConverterView } from './ui/converterView.js';
import { showToast } from './ui/toast.js';
import { loadMixerState, saveMixerState } from './ui/mixerStore.js';

const PEAK_BUCKETS = 1400;

type DeckBpmSource = TrackMeta['bpmSource'];

interface AppState {
  baseBpm: Record<DeckId, number | null>;
  bpmSource: Record<DeckId, DeckBpmSource>;
  loadedTrackId: Record<DeckId, string | null>;
}

async function main(): Promise<void> {
  const app = document.getElementById('app');
  if (!app) throw new Error('Missing #app');
  app.innerHTML = `
    <header class="topbar">
      <h1>🎛️ Musical System</h1>
      <span class="subtitle">Mezclador DJ · 2 decks · biblioteca local</span>
    </header>
    <main class="layout"></main>
    <div class="toasts"></div>
  `;
  const layout = app.querySelector('.layout') as HTMLElement;
  const toasts = app.querySelector('.toasts') as HTMLElement;
  const toast = (msg: string, kind: 'info' | 'error' | 'ok' = 'info') => showToast(toasts, msg, kind);

  // ---------- Storage + library ----------
  const store = await createTrackStore();
  if (store.kind === 'memory') {
    toast('Tu navegador no expone OPFS ni IndexedDB: la biblioteca vive solo en memoria.', 'error');
  }
  const library = new Library(store);
  await library.init();

  // ---------- Audio engine (context created on the first gesture) ----------
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
  };

  // ---------- Deck callbacks ----------
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
        const s = d.captureSettings();
        view().setFaders(s.volume, s.eq, s.pitch);
        markMixerDirty();
        toast(`Deck ${id} sincronizado a ${target.toFixed(1)} BPM.`, 'ok');
      },
      onWaveSeek: (fraction: number) => {
        const d = engine.deck(id);
        d.seek(fraction * d.duration);
      },
      onJogScrub: (deltaSec: number) => {
        const d = engine.deck(id);
        d.seek(d.position + deltaSec);
      },
      onJogNudge: (factor: number) => engine.deck(id).setNudge(factor),
      onJogEnd: () => engine.deck(id).clearNudge(),
      onVolume: (position: number) => {
        engine.deck(id).setVolume(position);
        markMixerDirty();
      },
      onEq: (band: EqBand, db: number) => {
        engine.deck(id).setEq(band, db);
        markMixerDirty();
      },
      onBpmSet: (bpm: number) => {
        const trackId = state.loadedTrackId[id];
        if (!trackId) return;
        void library.setBpm(trackId, bpm, 'manual').then(() => {
          state.baseBpm[id] = bpm;
          state.bpmSource[id] = 'manual';
          deckViews[id].refreshBpm(bpm, 'manual');
          refreshLibrary();
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
          deckViews[id].refreshBpm(next, 'manual');
          refreshLibrary();
        });
      },
    };
  }

  // ---------- Views ----------
  const mixerView = new MixerView({
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
  });

  const libraryView = new LibraryView({
    onImportFiles: (files) => void importFiles(files),
    onLoadToDeck: (trackId, deckId) => void loadTrackToDeck(trackId, deckId),
    onSelectTrack: () => {
      /* highlight only — a track loads to a deck exclusively via → A / → B */
    },
    onRemoveTrack: (trackId) => void removeTrack(trackId),
    onCreatePlaylist: (name) => void library.createPlaylist(name).then(refreshLibrary),
    onDeletePlaylist: (playlistId) => void library.deletePlaylist(playlistId).then(refreshLibrary),
    onAddToPlaylist: (playlistId, trackId) =>
      void library.addToPlaylist(playlistId, trackId).then((added) => {
        if (!added) toast('Esa pista ya está en la playlist.', 'info');
        refreshLibrary();
      }),
    onRemoveFromPlaylist: (playlistId, trackId) =>
      void library.removeFromPlaylist(playlistId, trackId).then(refreshLibrary),
    onMove: (playlistId, trackId, delta) =>
      void library.moveInPlaylist(playlistId, trackId, delta).then(refreshLibrary),
  });

  const deckViews: Record<DeckId, DeckView> = {
    A: new DeckView('A', '#22d3ee', deckCallbacks('A')),
    B: new DeckView('B', '#f472b6', deckCallbacks('B')),
  };

  const converterView = new ConverterView(toast, {
    onAddToLibrary: async (blob, info) => {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (bytes.length === 0) throw new Error('El MP3 convertido está vacío.');
      const meta = await importAudioBytes(info.fileName, bytes);
      refreshLibrary();
      toast(`"${meta.title}" añadida a la biblioteca${meta.bpm ? ` · ${meta.bpm.toFixed(1)} BPM` : ''}.`, 'ok');
    },
  });
  layout.append(deckViews.A.el, mixerView.el, deckViews.B.el, libraryView.el, converterView.el);
  libraryView.setBackend(store.kind);

  // Restore persisted faders into the sliders immediately (no context yet —
  // the engine picks the same values up on the first gesture).
  const restored = loadMixerState();
  for (const id of ['A', 'B'] as const) {
    const s = restored.decks[id];
    deckViews[id].setFaders(s.volume, s.eq, s.pitch);
  }
  mixerView.setFaders(restored.master, restored.crossfader, restored.limiterEnabled);

  // ---------- Library actions ----------
  /**
   * Pipeline de importación compartido: decodifica, calcula picos y BPM,
   * lee tags y guarda bytes + metadatos en la biblioteca (OPFS).
   * Lo usan tanto los archivos locales como el MP3 del convertidor.
   */
  async function importAudioBytes(fileName: string, bytes: Uint8Array): Promise<TrackMeta> {
    const ctx = ensureEngine();
    const buffer = await decodeAudioBytes(ctx, bytes.buffer as ArrayBuffer);
    if (!buffer) throw new Error(`No se pudo decodificar "${fileName}".`);
    const mono = toMono((i) => buffer.getChannelData(i), buffer.numberOfChannels, buffer.length);
    const peaks = Array.from(computePeaks(mono, PEAK_BUCKETS));
    const tags = parseId3(bytes);
    const bpm = tags.bpm ? tags.bpm : estimateBpm(mono, buffer.sampleRate);
    const bpmSource: DeckBpmSource = tags.bpm ? 'tag' : 'estimated';
    return library.addTrack(
      {
        fileName,
        title: tags.title || stripExtension(fileName),
        artist: tags.artist || 'Desconocido',
        album: tags.album ?? '',
        bpm,
        bpmSource,
        durationSec: buffer.duration,
        sizeBytes: bytes.byteLength,
        peaks,
      },
      bytes,
    );
  }

  async function importFiles(files: File[]): Promise<void> {
    for (const file of files) {
      const verdict = validateAudioFile(file.name, file.size, file.type);
      if (!verdict.ok) {
        toast(verdict.reason, 'error');
        continue;
      }
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (bytes.length === 0) {
          toast(`"${file.name}" está vacío.`, 'error');
          continue;
        }
        const meta = await importAudioBytes(file.name, bytes);
        toast(`"${meta.title}" importada${meta.bpm ? ` · ${meta.bpm.toFixed(1)} BPM` : ''}.`, 'ok');
        refreshLibrary();
      } catch (error) {
        console.error(error);
        toast(`Error importando "${file.name}".`, 'error');
      }
    }
  }

  async function loadTrackToDeck(trackId: string, deckId: DeckId): Promise<void> {
    const meta = library.getTrack(trackId);
    if (!meta) return;
    const bytes = await store.getBytes(trackId);
    if (!bytes) {
      toast('No encontré los bytes de esa pista (¿se borró el almacenamiento?).', 'error');
      return;
    }
    const ctx = ensureEngine();
    const buffer = await decodeAudioBytes(ctx, bytes.buffer as ArrayBuffer);
    if (!buffer) {
      toast(`No se pudo decodificar "${meta.fileName}" ahora mismo.`, 'error');
      return;
    }
    const deck = engine.deck(deckId);
    deck.load(buffer); // mixer settings survive the load
    state.baseBpm[deckId] = meta.bpm;
    state.bpmSource[deckId] = meta.bpmSource;
    state.loadedTrackId[deckId] = trackId;
    deckViews[deckId].setTrack({
      title: meta.title,
      artist: meta.artist,
      bpm: meta.bpm,
      bpmSource: meta.bpmSource,
      durationSec: buffer.duration,
      peaks: meta.peaks,
    });
    refreshLibrary();
    toast(`"${meta.title}" → Deck ${deckId}`, 'ok');
  }

  async function removeTrack(trackId: string): Promise<void> {
    await library.removeTrack(trackId);
    for (const id of ['A', 'B'] as const) {
      if (state.loadedTrackId[id] === trackId) {
        state.loadedTrackId[id] = null;
        state.baseBpm[id] = null;
        if (engine.booted) engine.deck(id).stop();
        deckViews[id].clearTrack();
      }
    }
    refreshLibrary();
  }

  function refreshLibrary(): void {
    libraryView.render(library.tracks, library.playlists);
    libraryView.setLoadedDecks({ A: state.loadedTrackId.A, B: state.loadedTrackId.B });
  }

  refreshLibrary();

  // ---------- Mixer persistence (debounced) ----------
  let mixerDirty = false;
  let lastSave = 0;
  function markMixerDirty(): void {
    mixerDirty = true;
  }

  // ---------- Render loop ----------
  const frame = (): void => {
    if (engine.booted) {
      for (const id of ['A', 'B'] as const) {
        const deck = engine.peekDeck(id);
        if (!deck || !deck.hasTrack) continue;
        deckViews[id].update({
          position: deck.position,
          duration: deck.duration,
          playing: deck.isPlaying,
          loop: deck.loopRegion,
          cue: deck.cue,
          effectiveBpm: effectiveBpm(state.baseBpm[id], deck.rate),
        });
        deckViews[id].renderWave();
      }
      mixerView.update({ a: engine.deckLevel('A'), b: engine.deckLevel('B') }, engine.limiterReductionDb);
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

  // Keyboard: Q = play/pause A, P = play/pause B, Space = the deck under the crossfader.
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (!engine.booted) return;
    if (e.code === 'KeyQ') deckViews.A.el.querySelector<HTMLButtonElement>('.btn-play')?.click();
    else if (e.code === 'KeyP') deckViews.B.el.querySelector<HTMLButtonElement>('.btn-play')?.click();
    else if (e.code === 'Space') {
      e.preventDefault();
      const id: DeckId = engine.crossfader <= 0.5 ? 'A' : 'B';
      deckViews[id].el.querySelector<HTMLButtonElement>('.btn-play')?.click();
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
