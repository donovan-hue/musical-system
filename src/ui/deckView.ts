import type { DeckId } from '../audio/deck.js';
import type { EqBand } from '../audio/settings.js';
import { EQ_MAX_DB, EQ_MIN_DB } from '../audio/settings.js';
import { PITCH_RANGE } from '../audio/rate.js';
import { formatBpm, formatTimeTenths, clamp } from '../util/format.js';
import { WaveformView } from './waveform.js';

export interface DeckCallbacks {
  onPlayPause(): void;
  onStop(): void;
  onCueJump(): void;
  onCueSet(): void;
  onLoopIn(): void;
  onLoopOut(): void;
  onLoopExit(): void;
  onPitch(rate: number): void;
  onPitchReset(): void;
  onSync(): void;
  onWaveSeek(fraction: number): void;
  /** Paused jog: relative scrub in seconds. */
  onJogScrub(deltaSec: number): void;
  /** Playing jog: cumulative tempo-bend factor from the press origin. */
  onJogNudge(factor: number): void;
  onJogEnd(): void;
  onVolume(position: number): void;
  onEq(band: EqBand, db: number): void;
  onBpmSet(bpm: number): void;
  onBpmMultiply(factor: 2 | 0.5): void;
}

export interface DeckTrackInfo {
  title: string;
  artist: string;
  bpm: number | null;
  bpmSource: string;
  durationSec: number;
  peaks: number[];
}

export interface DeckVisualState {
  position: number;
  duration: number;
  playing: boolean;
  loop: { start: number; end: number } | null;
  cue: number | null;
  effectiveBpm: number | null;
}

const SCRUB_SECONDS_PER_PX = 0.004;
const NUDGE_PER_PX = 0.0005;

function qs<T extends Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`Missing element: ${selector}`);
  return el;
}

export class DeckView {
  readonly el: HTMLElement;
  private readonly wave: WaveformView;
  private readonly cb: DeckCallbacks;

  private readonly btnPlay: HTMLButtonElement;
  private readonly btnStop: HTMLButtonElement;
  private readonly btnCue: HTMLButtonElement;
  private readonly btnCueSet: HTMLButtonElement;
  private readonly btnLoopIn: HTMLButtonElement;
  private readonly btnLoopOut: HTMLButtonElement;
  private readonly btnLoopExit: HTMLButtonElement;
  private readonly btnSync: HTMLButtonElement;
  private readonly btnRateReset: HTMLButtonElement;
  private readonly btnBpmSet: HTMLButtonElement;
  private readonly bpmMultButtons: HTMLButtonElement[];
  private readonly rateSlider: HTMLInputElement;
  private readonly volSlider: HTMLInputElement;
  private readonly eqSliders: Record<EqBand, HTMLInputElement>;
  private readonly bpmInput: HTMLInputElement;
  private readonly titleEl: HTMLElement;
  private readonly artistEl: HTMLElement;
  private readonly elapsedEl: HTMLElement;
  private readonly remainingEl: HTMLElement;
  private readonly bpmValEl: HTMLElement;
  private readonly bpmBadgeEl: HTMLElement;
  private readonly rateValEl: HTMLElement;
  private readonly jogEl: HTMLElement;
  private readonly loopStatusEl: HTMLElement;

  private playing = false;
  private hasTrack = false;
  private jogActive = false;
  private jogLastX = 0;
  private jogOriginX = 0;

  constructor(id: DeckId, accent: string, cb: DeckCallbacks) {
    this.cb = cb;
    this.el = document.createElement('section');
    this.el.className = `deck deck-${id.toLowerCase()}`;
    this.el.innerHTML = `
      <div class="deck-head">
        <h2>Deck ${id}</h2>
        <div class="deck-track">
          <span class="deck-title">Sin pista</span>
          <span class="deck-artist"></span>
        </div>
      </div>
      <canvas class="wave" title="Clic o arrastre para buscar"></canvas>
      <div class="deck-times">
        <span class="time-elapsed">0:00.0</span>
        <span class="deck-bpm">
          <span class="bpm-val">—</span><small>BPM</small>
          <span class="bpm-badge"></span>
          <button class="btn btn-mini bpm-mult" data-factor="2" title="Duplicar BPM">×2</button>
          <button class="btn btn-mini bpm-mult" data-factor="0.5" title="BPM entre dos">½</button>
          <input class="bpm-input" type="number" min="20" max="300" step="0.1" placeholder="BPM">
          <button class="btn btn-mini bpm-set">Fijar</button>
        </span>
        <span class="time-remaining">-0:00.0</span>
      </div>
      <div class="deck-transport">
        <button class="btn btn-play">▶ Play</button>
        <button class="btn btn-stop">⏹ Stop</button>
        <button class="btn btn-cue">↩ Cue</button>
        <button class="btn btn-cue-set">⌖ Set Cue</button>
      </div>
      <div class="deck-loop">
        <span class="loop-label">Loop</span>
        <button class="btn btn-loop-in">In</button>
        <button class="btn btn-loop-out">Out</button>
        <button class="btn btn-loop-exit">✕</button>
        <span class="loop-status"></span>
      </div>
      <div class="deck-rate">
        <span class="rate-label">Pitch <span class="rate-val">+0.0%</span></span>
        <input class="rate" type="range" min="${(1 - PITCH_RANGE).toFixed(3)}" max="${(1 + PITCH_RANGE).toFixed(3)}" step="0.001" value="1">
        <button class="btn btn-mini btn-rate-reset">Reset</button>
        <button class="btn btn-mini btn-sync" title="Igualar tempo al otro deck">Sync</button>
      </div>
      <div class="deck-bottom">
        <div class="jog" title="Arrastra: nudge (sonando) · buscar (pausado)"></div>
        <div class="channel">
          <h3>Canal ${id}</h3>
          <label class="ch-row">Vol <input class="ch-vol" type="range" min="0" max="1" step="0.01" value="0.8"></label>
          <label class="ch-row">Low <input class="eq eq-low" type="range" min="${EQ_MIN_DB}" max="${EQ_MAX_DB}" step="1" value="0"></label>
          <label class="ch-row">Mid <input class="eq eq-mid" type="range" min="${EQ_MIN_DB}" max="${EQ_MAX_DB}" step="1" value="0"></label>
          <label class="ch-row">High <input class="eq eq-high" type="range" min="${EQ_MIN_DB}" max="${EQ_MAX_DB}" step="1" value="0"></label>
        </div>
      </div>
    `;
    this.el.style.setProperty('--accent', accent);

    this.wave = new WaveformView(qs(this.el, '.wave'), accent);
    this.wave.onSeek = (fraction) => this.cb.onWaveSeek(fraction);

    this.btnPlay = qs(this.el, '.btn-play');
    this.btnStop = qs(this.el, '.btn-stop');
    this.btnCue = qs(this.el, '.btn-cue');
    this.btnCueSet = qs(this.el, '.btn-cue-set');
    this.btnLoopIn = qs(this.el, '.btn-loop-in');
    this.btnLoopOut = qs(this.el, '.btn-loop-out');
    this.btnLoopExit = qs(this.el, '.btn-loop-exit');
    this.btnSync = qs(this.el, '.btn-sync');
    this.btnRateReset = qs(this.el, '.btn-rate-reset');
    this.btnBpmSet = qs(this.el, '.bpm-set');
    this.bpmMultButtons = [...this.el.querySelectorAll<HTMLButtonElement>('.bpm-mult')];
    this.rateSlider = qs(this.el, '.rate');
    this.volSlider = qs(this.el, '.ch-vol');
    this.eqSliders = {
      low: qs(this.el, '.eq-low'),
      mid: qs(this.el, '.eq-mid'),
      high: qs(this.el, '.eq-high'),
    };
    this.bpmInput = qs(this.el, '.bpm-input');
    this.titleEl = qs(this.el, '.deck-title');
    this.artistEl = qs(this.el, '.deck-artist');
    this.elapsedEl = qs(this.el, '.time-elapsed');
    this.remainingEl = qs(this.el, '.time-remaining');
    this.bpmValEl = qs(this.el, '.bpm-val');
    this.bpmBadgeEl = qs(this.el, '.bpm-badge');
    this.rateValEl = qs(this.el, '.rate-val');
    this.jogEl = qs(this.el, '.jog');
    this.loopStatusEl = qs(this.el, '.loop-status');

    this.btnPlay.addEventListener('click', () => this.cb.onPlayPause());
    this.btnStop.addEventListener('click', () => this.cb.onStop());
    this.btnCue.addEventListener('click', () => this.cb.onCueJump());
    this.btnCueSet.addEventListener('click', () => this.cb.onCueSet());
    this.btnLoopIn.addEventListener('click', () => this.cb.onLoopIn());
    this.btnLoopOut.addEventListener('click', () => this.cb.onLoopOut());
    this.btnLoopExit.addEventListener('click', () => this.cb.onLoopExit());
    this.btnSync.addEventListener('click', () => this.cb.onSync());
    this.btnRateReset.addEventListener('click', () => {
      this.rateSlider.value = '1';
      this.cb.onPitchReset();
    });
    this.btnBpmSet.addEventListener('click', () => {
      const value = parseFloat(this.bpmInput.value);
      if (Number.isFinite(value) && value > 0) this.cb.onBpmSet(value);
    });
    for (const btn of this.bpmMultButtons) {
      btn.addEventListener('click', () => {
        this.cb.onBpmMultiply(parseFloat(btn.dataset.factor ?? '2') === 0.5 ? 0.5 : 2);
      });
    }

    this.rateSlider.addEventListener('input', () => {
      this.cb.onPitch(parseFloat(this.rateSlider.value));
    });
    this.volSlider.addEventListener('input', () => {
      this.cb.onVolume(parseFloat(this.volSlider.value));
    });
    this.eqSliders.low.addEventListener('input', () => this.cb.onEq('low', parseFloat(this.eqSliders.low.value)));
    this.eqSliders.mid.addEventListener('input', () => this.cb.onEq('mid', parseFloat(this.eqSliders.mid.value)));
    this.eqSliders.high.addEventListener('input', () => this.cb.onEq('high', parseFloat(this.eqSliders.high.value)));

    this.wireJog();
    this.update({ position: 0, duration: 0, playing: false, loop: null, cue: null, effectiveBpm: null });
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

  /** Install track info + waveform; mixer faders are untouched. */
  setTrack(info: DeckTrackInfo): void {
    this.hasTrack = true;
    this.titleEl.textContent = info.title;
    this.artistEl.textContent = info.artist;
    this.wave.setPeaks(info.peaks, info.durationSec);
    this.refreshBpm(info.bpm, info.bpmSource);
  }

  clearTrack(): void {
    this.hasTrack = false;
    this.titleEl.textContent = 'Sin pista';
    this.artistEl.textContent = '';
    this.wave.setPeaks([], 0);
    this.refreshBpm(null, 'none');
    this.update({ position: 0, duration: 0, playing: false, loop: null, cue: null, effectiveBpm: null });
  }

  refreshBpm(bpm: number | null, source: string): void {
    this.bpmValEl.textContent = formatBpm(bpm);
    const badge = { tag: 'TAG', estimated: 'EST', manual: 'MAN', none: '' }[source] ?? '';
    this.bpmBadgeEl.textContent = badge;
  }

  /** Push mixer-side values into the sliders (boot restore — no events fired). */
  setFaders(volume: number, eq: { low: number; mid: number; high: number }, pitch: number): void {
    this.volSlider.value = String(volume);
    this.eqSliders.low.value = String(eq.low);
    this.eqSliders.mid.value = String(eq.mid);
    this.eqSliders.high.value = String(eq.high);
    this.rateSlider.value = String(pitch);
    this.rateValEl.textContent = formatPitch(pitch);
  }

  update(state: DeckVisualState): void {
    this.playing = state.playing;
    this.btnPlay.textContent = state.playing ? '⏸ Pausa' : '▶ Play';
    this.btnPlay.classList.toggle('playing', state.playing);

    const disabled = !this.hasTrack;
    for (const btn of [this.btnPlay, this.btnStop, this.btnCue, this.btnCueSet, this.btnLoopIn, this.btnLoopOut, this.btnLoopExit, this.btnSync]) {
      btn.disabled = disabled;
    }

    const remaining = Math.max(0, state.duration - state.position);
    this.elapsedEl.textContent = formatTimeTenths(state.position);
    this.remainingEl.textContent = `-${formatTimeTenths(remaining)}`;

    this.loopStatusEl.textContent =
      state.loop && state.duration > 0
        ? `${state.loop.start.toFixed(1)}s → ${state.loop.end.toFixed(1)}s`
        : '';
    this.btnLoopExit.classList.toggle('active', state.loop !== null);

    if (state.duration > 0) {
      this.wave.update(state.position, state.loop, state.cue);
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
