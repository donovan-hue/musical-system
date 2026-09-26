import type { DeckId } from '../audio/deck.js';
import type { LoopBeats } from '../audio/key.js';
import { formatBpm, formatTimeTenths, clamp } from '../util/format.js';
import { PITCH_RANGE } from '../audio/rate.js';
import { IMPLEMENTED_FX, UNIMPLEMENTED_FX_REASON, type FxKind } from '../audio/fx.js';
import { HOT_CUE_COLORS, WaveformView } from './waveform.js';

export interface DeckCallbacks {
  onPlayPause(): void;
  onStop(): void;
  onCueJump(): void;
  onCueSet(): void;
  onLoopIn(): void;
  onLoopOut(): void;
  onLoopExit(): void;
  onLoopBeats(beats: LoopBeats): void;
  onPitch(rate: number): void;
  onPitchReset(): void;
  onSync(): void;
  /** Búsqueda bajo el mapeo del zoom actual (segundos reales). */
  onWaveSeek(seconds: number): void;
  onJogScrub(deltaSec: number): void;
  onJogNudge(factor: number): void;
  onJogEnd(): void;
  onFx(kind: FxKind | null): void;
  onFxAmount(amount: number): void;
  onHotCue(index: number, action: 'hit' | 'set' | 'clear'): void;
  onBpmSet(bpm: number): void;
  onBpmMultiply(factor: 2 | 0.5): void;
}

export interface DeckTrackInfo {
  title: string;
  artist: string;
  keyLabel: string;
  genre: string;
  bpm: number | null;
  bpmSource: string;
  durationSec: number;
  peaks: number[];
  artwork: string | null;
  hotCues: (number | null)[];
}

export interface DeckVisualState {
  position: number;
  duration: number;
  playing: boolean;
  loop: { start: number; end: number } | null;
  cue: number | null;
  hotCues: (number | null)[];
  beatSec: number | null;
  effectiveBpm: number | null;
}

const SCRUB_SECONDS_PER_PX = 0.004;
const NUDGE_PER_PX = 0.0005;
const LOOP_SIZES: readonly LoopBeats[] = [0.5, 1, 2, 4, 8, 16];

function qs<T extends Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`Missing element: ${selector}`);
  return el;
}

function fmtCueTime(sec: number): string {
  return `${sec.toFixed(1)}s`;
}

export class DeckView {
  readonly el: HTMLElement;
  private readonly wave: WaveformView;
  private readonly cb: DeckCallbacks;

  private readonly artworkEl: HTMLImageElement;
  private readonly artworkFallback: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly artistEl: HTMLElement;
  private readonly keyEl: HTMLElement;
  private readonly genreEl: HTMLElement;
  private readonly elapsedEl: HTMLElement;
  private readonly remainingEl: HTMLElement;
  private readonly bpmValEl: HTMLElement;
  private readonly bpmBadgeEl: HTMLElement;
  private readonly rateValEl: HTMLElement;
  private readonly jogEl: HTMLElement;
  private readonly loopStatusEl: HTMLElement;
  private readonly btnPlay: HTMLButtonElement;
  private readonly btnZoom: HTMLButtonElement;
  private readonly fxSelect: HTMLSelectElement;
  private readonly fxAmount: HTMLInputElement;
  private readonly rateSlider: HTMLInputElement;
  private readonly hotCueButtons: HTMLButtonElement[] = [];
  private readonly loopSizeButtons: HTMLButtonElement[] = [];

  private playing = false;
  private hasTrack = false;
  private jogActive = false;
  private jogLastX = 0;
  private jogOriginX = 0;
  private hotCues: (number | null)[] = new Array<number | null>(8).fill(null);

  constructor(id: DeckId, accent: string, canvasAccent: string, cb: DeckCallbacks) {
    this.cb = cb;
    this.el = document.createElement('section');
    this.el.className = `deck deck-${id.toLowerCase()}`;
    this.el.innerHTML = `
      <div class="deck-head">
        <div class="deck-artwork" aria-hidden="true">
          <img class="deck-artwork-img" alt="" hidden>
          <span class="deck-artwork-fallback"></span>
        </div>
        <div class="deck-track">
          <h2>Deck ${id}</h2>
          <span class="deck-title">Sin pista</span>
          <span class="deck-artist"></span>
          <span class="deck-tags">
            <span class="tag tag-key" title="Tonalidad">—</span>
            <span class="tag tag-genre" title="Género"></span>
          </span>
        </div>
        <div class="deck-bpm">
          <span class="bpm-val">—</span><small>BPM</small>
          <span class="bpm-badge"></span>
          <span class="bpm-tools">
            <button class="btn btn-mini bpm-mult" data-factor="2" title="Duplicar BPM" aria-label="Duplicar BPM">×2</button>
            <button class="btn btn-mini bpm-mult" data-factor="0.5" title="BPM entre dos" aria-label="Mitad del BPM">½</button>
            <input class="bpm-input" type="number" min="20" max="300" step="0.1" placeholder="BPM" aria-label="BPM manual">
            <button class="btn btn-mini bpm-set" aria-label="Fijar BPM manual">Fijar</button>
          </span>
        </div>
      </div>
      <div class="wave-wrap">
        <canvas class="wave" aria-label="Forma de onda del Deck ${id}: clic para buscar"></canvas>
        <button class="btn btn-mini btn-zoom" title="Zoom de la forma de onda" aria-label="Cambiar zoom">🔍 1×</button>
      </div>
      <div class="deck-times">
        <span class="time-elapsed">0:00.0</span>
        <span class="loop-status" role="status"></span>
        <span class="time-remaining">-0:00.0</span>
      </div>
      <div class="deck-transport">
        <button class="btn btn-play" aria-label="Reproducir o pausar">▶ Play</button>
        <button class="btn btn-stop" aria-label="Detener">⏹</button>
        <button class="btn btn-cue" aria-label="Volver al cue">↩ Cue</button>
        <button class="btn btn-cue-set" aria-label="Fijar cue aquí">⌖ Set</button>
        <button class="btn btn-sync" aria-label="Sincronizar BPM con el otro deck">Sync</button>
      </div>
      <div class="deck-loop">
        <span class="loop-label">Loop</span>
        ${LOOP_SIZES.map((b) => `<button class="btn btn-mini btn-loop-beats" data-beats="${b}" aria-label="Loop de ${b} beats">${b < 1 ? '½' : b}</button>`).join('')}
        <button class="btn btn-mini btn-loop-in" aria-label="Entrada del loop">In</button>
        <button class="btn btn-mini btn-loop-out" aria-label="Salida del loop">Out</button>
        <button class="btn btn-mini btn-loop-exit" aria-label="Salir del loop">✕</button>
      </div>
      <div class="deck-hotcues" role="group" aria-label="Hot cues del Deck ${id}">
        ${HOT_CUE_COLORS.map((_, i) => `<button class="btn btn-mini hot-cue" data-index="${i}" style="--hc:${HOT_CUE_COLORS[i]}"><i>${i + 1}</i><em></em></button>`).join('')}
      </div>
      <div class="deck-fx">
        <label class="fx-row">
          <span class="fx-label">FX</span>
          <select class="fx-select" aria-label="Efecto del deck">
            <option value="">FX off</option>
            ${IMPLEMENTED_FX.map((k) => `<option value="${k}">${k}</option>`).join('')}
            <option value="reverse" disabled title="${UNIMPLEMENTED_FX_REASON['reverse']}">reverse (requiere worklet)</option>
            <option value="beatrepeat" disabled title="${UNIMPLEMENTED_FX_REASON['beatrepeat']}">beat repeat (requiere worklet)</option>
          </select>
        </label>
        <label class="fx-row">Amt <input class="fx-amount" type="range" min="0" max="1" step="0.01" value="0.5" aria-label="Intensidad del FX"></label>
      </div>
      <div class="deck-bottom">
        <div class="jog" title="Arrastra: nudge (sonando) · buscar (pausado)" role="slider" aria-label="Jog del Deck ${id}"></div>
        <div class="deck-rate">
          <span class="rate-label">Pitch <span class="rate-val">+0.0%</span></span>
          <input class="rate" type="range" min="${(1 - PITCH_RANGE).toFixed(3)}" max="${(1 + PITCH_RANGE).toFixed(3)}" step="0.001" value="1" aria-label="Pitch del Deck ${id}">
          <button class="btn btn-mini btn-rate-reset" aria-label="Reiniciar pitch">Reset</button>
        </div>
      </div>
    `;
    this.el.style.setProperty('--accent', accent);

    this.wave = new WaveformView(qs(this.el, '.wave'), canvasAccent);
    this.wave.onSeek = (seconds) => this.cb.onWaveSeek(seconds);
    this.btnZoom = qs(this.el, '.btn-zoom');
    this.btnZoom.addEventListener('click', () => this.wave.cycleZoom());
    this.wave.onZoomChange = (zoom) => {
      this.btnZoom.textContent = `🔍 ${zoom}×`;
    };

    this.artworkEl = qs(this.el, '.deck-artwork-img');
    this.artworkFallback = qs(this.el, '.deck-artwork-fallback');
    this.titleEl = qs(this.el, '.deck-title');
    this.artistEl = qs(this.el, '.deck-artist');
    this.keyEl = qs(this.el, '.tag-key');
    this.genreEl = qs(this.el, '.tag-genre');
    this.elapsedEl = qs(this.el, '.time-elapsed');
    this.remainingEl = qs(this.el, '.time-remaining');
    this.bpmValEl = qs(this.el, '.bpm-val');
    this.bpmBadgeEl = qs(this.el, '.bpm-badge');
    this.rateValEl = qs(this.el, '.rate-val');
    this.jogEl = qs(this.el, '.jog');
    this.loopStatusEl = qs(this.el, '.loop-status');
    this.btnPlay = qs(this.el, '.btn-play');
    this.fxSelect = qs(this.el, '.fx-select');
    this.fxAmount = qs(this.el, '.fx-amount');
    this.rateSlider = qs(this.el, '.rate');

    qs(this.el, '.btn-stop').addEventListener('click', () => this.cb.onStop());
    qs(this.el, '.btn-cue').addEventListener('click', () => this.cb.onCueJump());
    qs(this.el, '.btn-cue-set').addEventListener('click', () => this.cb.onCueSet());
    qs(this.el, '.btn-sync').addEventListener('click', () => this.cb.onSync());
    qs(this.el, '.btn-loop-in').addEventListener('click', () => this.cb.onLoopIn());
    qs(this.el, '.btn-loop-out').addEventListener('click', () => this.cb.onLoopOut());
    qs(this.el, '.btn-loop-exit').addEventListener('click', () => this.cb.onLoopExit());
    qs(this.el, '.btn-rate-reset').addEventListener('click', () => {
      this.rateSlider.value = '1';
      this.rateValEl.textContent = formatPitch(1);
      this.cb.onPitchReset();
    });
    qs(this.el, '.bpm-set').addEventListener('click', () => {
      const value = parseFloat((qs(this.el, '.bpm-input') as HTMLInputElement).value);
      if (Number.isFinite(value) && value > 0) this.cb.onBpmSet(value);
    });
    for (const btn of [...this.el.querySelectorAll<HTMLButtonElement>('.bpm-mult')]) {
      btn.addEventListener('click', () => {
        const factor = parseFloat(btn.dataset.factor ?? '2') === 0.5 ? 0.5 : 2;
        this.cb.onBpmMultiply(factor as 2 | 0.5);
      });
    }

    for (const btn of [...this.el.querySelectorAll<HTMLButtonElement>('.btn-loop-beats')]) {
      this.loopSizeButtons.push(btn);
      btn.addEventListener('click', () => this.cb.onLoopBeats(parseFloat(btn.dataset.beats ?? '4') as LoopBeats));
    }

    for (const btn of [...this.el.querySelectorAll<HTMLButtonElement>('.hot-cue')]) {
      this.hotCueButtons.push(btn);
      const index = parseInt(btn.dataset.index ?? '0', 10);
      btn.addEventListener('click', (e) => {
        if (e.altKey || e.shiftKey) this.cb.onHotCue(index, 'clear');
        else this.cb.onHotCue(index, this.hotCues[index] == null ? 'set' : 'hit');
      });
      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.cb.onHotCue(index, 'clear');
      });
    }

    this.fxSelect.addEventListener('change', () => {
      const value = this.fxSelect.value;
      this.cb.onFx(value === '' ? null : (value as FxKind));
    });
    this.fxAmount.addEventListener('input', () => this.cb.onFxAmount(parseFloat(this.fxAmount.value)));

    this.rateSlider.addEventListener('input', () => {
      this.rateValEl.textContent = formatPitch(parseFloat(this.rateSlider.value));
      this.cb.onPitch(parseFloat(this.rateSlider.value));
    });

    this.wireJog();
    this.update(this.emptyState());
  }

  private emptyState(): DeckVisualState {
    return { position: 0, duration: 0, playing: false, loop: null, cue: null, hotCues: this.hotCues, beatSec: null, effectiveBpm: null };
  }

  private wireJog(): void {
    this.jogEl.addEventListener('pointerdown', (e) => {
      if (!this.hasTrack) return;
      e.preventDefault();
      this.jogEl.setPointerCapture(e.pointerId);
      this.jogActive = true;
      this.jogLastX = e.clientX;
      this.jogOriginX = e.clientX;
    });
    this.jogEl.addEventListener('pointermove', (e) => {
      if (!this.jogActive) return;
      if (this.playing) {
        const dx = e.clientX - this.jogOriginX;
        const factor = clamp(1 + dx * NUDGE_PER_PX, 1 - PITCH_RANGE * 0.75, 1 + PITCH_RANGE * 0.75);
        this.cb.onJogNudge(factor);
      } else {
        const dx = e.clientX - this.jogLastX;
        this.jogLastX = e.clientX;
        this.cb.onJogScrub(dx * SCRUB_SECONDS_PER_PX);
      }
    });
    const release = () => {
      if (!this.jogActive) return;
      this.jogActive = false;
      this.cb.onJogEnd();
    };
    this.jogEl.addEventListener('pointerup', release);
    this.jogEl.addEventListener('pointercancel', release);
    this.jogEl.addEventListener('wheel', (e) => {
      if (!this.hasTrack) return;
      e.preventDefault();
      if (this.playing) {
        this.cb.onJogNudge(clamp(1 - e.deltaY * NUDGE_PER_PX, 0.94, 1.06));
        window.setTimeout(() => this.cb.onJogEnd(), 220);
      } else {
        this.cb.onJogScrub(-e.deltaY * SCRUB_SECONDS_PER_PX);
      }
    }, { passive: false });
  }

  /** Instala la info de pista + waveform; los faders del mezclador no se tocan. */
  setTrack(info: DeckTrackInfo): void {
    this.hasTrack = true;
    this.titleEl.textContent = info.title;
    this.artistEl.textContent = info.artist;
    this.keyEl.textContent = info.keyLabel || '—';
    this.genreEl.textContent = info.genre || '';
    this.hotCues = info.hotCues;
    this.wave.setPeaks(info.peaks, info.durationSec);
    this.refreshBpm(info.bpm, info.bpmSource);
    this.refreshHotCues(info.hotCues);
    if (info.artwork) {
      this.artworkEl.src = info.artwork;
      this.artworkEl.hidden = false;
      this.artworkFallback.hidden = true;
    } else {
      this.artworkEl.hidden = true;
      this.artworkFallback.hidden = false;
      this.artworkFallback.textContent = (info.title || '?').charAt(0).toUpperCase();
    }
  }

  clearTrack(): void {
    this.hasTrack = false;
    this.titleEl.textContent = 'Sin pista';
    this.artistEl.textContent = '';
    this.keyEl.textContent = '—';
    this.genreEl.textContent = '';
    this.hotCues = new Array<number | null>(8).fill(null);
    this.wave.setPeaks([], 0);
    this.refreshBpm(null, 'none');
    this.refreshHotCues(this.hotCues);
    this.artworkEl.hidden = true;
    this.artworkFallback.hidden = false;
    this.artworkFallback.textContent = '?';
    this.update(this.emptyState());
  }

  refreshBpm(bpm: number | null, source: string): void {
    this.bpmValEl.textContent = formatBpm(bpm);
    const badge = { tag: 'TAG', estimated: 'EST', manual: 'MAN', none: '' }[source] ?? '';
    this.bpmBadgeEl.textContent = badge;
  }

  refreshHotCues(cues: (number | null)[]): void {
    this.hotCues = cues;
    cues.forEach((pos, index) => {
      const btn = this.hotCueButtons[index];
      if (!btn) return;
      const filled = pos !== null;
      btn.classList.toggle('filled', filled);
      btn.style.setProperty('--hc', HOT_CUE_COLORS[index % HOT_CUE_COLORS.length]!);
      btn.title = filled
        ? `Hot cue ${index + 1} · ${fmtCueTime(pos!)} — clic: saltar · Alt+clic: borrar`
        : `Hot cue ${index + 1} — clic: fijar aquí`;
      const em = btn.querySelector('em');
      if (em) em.textContent = filled ? fmtCueTime(pos!) : '·';
    });
  }

  /** Pitch fader desde el estado persistido o tras sync (sin disparar eventos). */
  setPitchDisplay(rate: number): void {
    this.rateSlider.value = String(rate);
    this.rateValEl.textContent = formatPitch(rate);
  }

  update(state: DeckVisualState): void {
    this.playing = state.playing;
    this.btnPlay.textContent = state.playing ? '⏸ Pausa' : '▶ Play';
    this.btnPlay.classList.toggle('playing', state.playing);

    const disabled = !this.hasTrack;
    for (const btn of [
      this.btnPlay,
      qs(this.el, '.btn-stop'),
      qs(this.el, '.btn-cue'),
      qs(this.el, '.btn-cue-set'),
      qs(this.el, '.btn-sync'),
      ...this.loopSizeButtons,
      qs(this.el, '.btn-loop-in'),
      qs(this.el, '.btn-loop-out'),
      qs(this.el, '.btn-loop-exit'),
    ]) {
      (btn as HTMLButtonElement).disabled = disabled;
    }

    const remaining = Math.max(0, state.duration - state.position);
    this.elapsedEl.textContent = formatTimeTenths(state.position);
    this.remainingEl.textContent = `-${formatTimeTenths(remaining)}`;

    this.loopStatusEl.textContent =
      state.loop && state.duration > 0
        ? `⟳ ${state.loop.start.toFixed(1)}s → ${state.loop.end.toFixed(1)}s`
        : '';
    qs(this.el, '.btn-loop-exit').classList.toggle('active', state.loop !== null);

    if (state.duration > 0) {
      this.wave.update({
        position: state.position,
        loop: state.loop,
        cue: state.cue,
        hotCues: state.hotCues,
        beatSec: state.beatSec,
      });
    }
    if (!this.jogActive) {
      this.bpmValEl.textContent = formatBpm(state.effectiveBpm);
    }
  }

  renderWave(): void {
    this.wave.render();
  }
}

function formatPitch(rate: number): string {
  const percent = (rate - 1) * 100;
  return `${percent >= 0 ? '+' : ''}${percent.toFixed(1)}%`;
}
