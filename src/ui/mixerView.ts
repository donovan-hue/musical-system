import type { DeckId } from '../audio/deck.js';
import type { EqBand } from '../audio/settings.js';
import { EQ_MAX_DB, EQ_MIN_DB } from '../audio/settings.js';

export interface ChannelCallbacks {
  onTrim(deck: DeckId, gain: number): void;
  onEq(deck: DeckId, band: EqBand, db: number): void;
  onFilter(deck: DeckId, position: number): void;
  onVolume(deck: DeckId, position: number): void;
  onCueToggle(deck: DeckId, on: boolean): void;
  onMaster(position: number): void;
  onLimiterToggle(enabled: boolean): void;
  onCrossfader(position: number): void;
  onCueMix(mix: number): void;
}

function qs<T extends Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`Missing element: ${selector}`);
  return el;
}

const EQ_MIN = String(EQ_MIN_DB);
const EQ_MAX = String(EQ_MAX_DB);

/** Medidor vertical con peak-hold, escala dB (−48..0). */
class MeterView {
  private peakHold = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {}

  render(level: number): void {
    const canvas = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(8, Math.floor(canvas.clientWidth));
    const height = Math.max(20, Math.floor(canvas.clientHeight));
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = 'rgba(127,127,127,0.08)';
    ctx.fillRect(0, 0, width, height);

    const db = level > 0.0001 ? 20 * Math.log10(level) : -60;
    const frac = Math.min(1, Math.max(0, (db + 48) / 48));
    this.peakHold = Math.max(frac, this.peakHold - 0.008);

    const barHeight = frac * height;
    const gradient = ctx.createLinearGradient(0, height, 0, 0);
    gradient.addColorStop(0, '#22c55e');
    gradient.addColorStop(0.7, '#eab308');
    gradient.addColorStop(1, '#ef4444');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, height - barHeight, width, barHeight);

    const peakY = height - this.peakHold * height;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(0, Math.max(0, peakY - 1), width, 2);
  }
}

interface ChannelStrip {
  trim: HTMLInputElement;
  high: HTMLInputElement;
  mid: HTMLInputElement;
  low: HTMLInputElement;
  filter: HTMLInputElement;
  volume: HTMLInputElement;
  cue: HTMLButtonElement;
  meter: MeterView;
}

export class MixerView {
  readonly el: HTMLElement;
  private readonly channels: Record<DeckId, ChannelStrip>;
  private readonly grFill: HTMLElement;
  private readonly limiterCheckbox: HTMLInputElement;
  private readonly spectrumBins = 56;
  private readonly fftData: Uint8Array<ArrayBuffer>;

  constructor(cb: ChannelCallbacks) {
    this.el = document.createElement('section');
    this.el.className = 'mixer';
    const strip = (id: DeckId): string => `
      <div class="chstrip" data-deck="${id}">
        <h3>Ch ${id}</h3>
        <label class="mk-row">Trim <input class="mk-trim" type="range" min="0" max="2" step="0.01" value="1" aria-label="Ganancia canal ${id}"></label>
        <label class="mk-row">High <input class="mk-high" type="range" min="${EQ_MIN}" max="${EQ_MAX}" step="1" value="0" aria-label="Agudos canal ${id}"></label>
        <label class="mk-row">Mid <input class="mk-mid" type="range" min="${EQ_MIN}" max="${EQ_MAX}" step="1" value="0" aria-label="Medios canal ${id}"></label>
        <label class="mk-row">Low <input class="mk-low" type="range" min="${EQ_MIN}" max="${EQ_MAX}" step="1" value="0" aria-label="Graves canal ${id}"></label>
        <label class="mk-row mk-filter">Filter <input class="mk-filter" type="range" min="-1" max="1" step="0.01" value="0" aria-label="Filtro canal ${id}"></label>
        <label class="mk-row">Vol <input class="mk-vol" type="range" min="0" max="1" step="0.01" value="0.8" aria-label="Volumen canal ${id}"></label>
        <canvas class="mk-meter" aria-label="Medidor de nivel canal ${id}"></canvas>
        <button class="btn btn-mini mk-cue" aria-pressed="false" aria-label="CUE de monitorización canal ${id}">CUE</button>
      </div>`;

    this.el.innerHTML = `
      <div class="mixer-grid">
        ${strip('A')}
        <div class="mixer-center">
          <h3>Master</h3>
          <label class="mk-row master-row">Vol <input class="mk-master" type="range" min="0" max="1" step="0.01" value="0.8" aria-label="Volumen master"></label>
          <label class="limiter-row">
            <input class="limiter-toggle" type="checkbox" checked aria-label="Limitador master">
            <span>Limitador</span>
            <span class="gr-meter" title="Reducción de ganancia"><span class="gr-fill"></span></span>
          </label>
          <canvas class="spectrum" aria-label="Espectro del bus master"></canvas>
          <label class="mk-row">Cue&nbsp;Mix <input class="mk-cuemix" type="range" min="0" max="1" step="0.01" value="0" aria-label="Mezcla de monitorización master/cue"></label>
          <label class="mk-row xfader-row">A ── XFader ── B <input class="mk-xfader" type="range" min="0" max="1" step="0.01" value="0.5" aria-label="Crossfader"></label>
        </div>
        ${strip('B')}
      </div>
    `;

    const wireChannel = (id: DeckId): ChannelStrip => {
      const root = qs(this.el, `.chstrip[data-deck="${id}"]`);
      const s: ChannelStrip = {
        trim: qs(root, '.mk-trim'),
        high: qs(root, '.mk-high'),
        mid: qs(root, '.mk-mid'),
        low: qs(root, '.mk-low'),
        filter: qs(root, '.mk-filter'),
        volume: qs(root, '.mk-vol'),
        cue: qs(root, '.mk-cue'),
        meter: new MeterView(qs(root, '.mk-meter')),
      };
      s.trim.addEventListener('input', () => cb.onTrim(id, parseFloat(s.trim.value)));
      s.high.addEventListener('input', () => cb.onEq(id, 'high', parseFloat(s.high.value)));
      s.mid.addEventListener('input', () => cb.onEq(id, 'mid', parseFloat(s.mid.value)));
      s.low.addEventListener('input', () => cb.onEq(id, 'low', parseFloat(s.low.value)));
      s.filter.addEventListener('input', () => cb.onFilter(id, parseFloat(s.filter.value)));
      s.volume.addEventListener('input', () => cb.onVolume(id, parseFloat(s.volume.value)));
      s.cue.addEventListener('click', () => {
        const on = s.cue.getAttribute('aria-pressed') !== 'true';
        s.cue.setAttribute('aria-pressed', String(on));
        s.cue.classList.toggle('active', on);
        cb.onCueToggle(id, on);
      });
      return s;
    };

    this.channels = { A: wireChannel('A'), B: wireChannel('B') };

    this.grFill = qs(this.el, '.gr-fill');
    this.limiterCheckbox = qs(this.el, '.limiter-toggle');
    this.fftData = new Uint8Array(this.spectrumBins);

    const master = qs<HTMLInputElement>(this.el, '.mk-master');
    master.addEventListener('input', () => cb.onMaster(parseFloat(master.value)));
    this.limiterCheckbox.addEventListener('change', () => cb.onLimiterToggle(this.limiterCheckbox.checked));
    const xfader = qs<HTMLInputElement>(this.el, '.mk-xfader');
    xfader.addEventListener('input', () => cb.onCrossfader(parseFloat(xfader.value)));
    const cueMix = qs<HTMLInputElement>(this.el, '.mk-cuemix');
    cueMix.addEventListener('input', () => cb.onCueMix(parseFloat(cueMix.value)));
  }

  /** Sync de todos los faders desde el estado persistido, sin disparar eventos. */
  setFaders(state: {
    master: number;
    crossfader: number;
    limiterEnabled: boolean;
    cueMix: number;
    decks: Record<DeckId, { volume: number; eq: { low: number; mid: number; high: number }; trim?: number; filter?: number; cueEnabled?: boolean }>;
  }): void {
    (qs(this.el, '.mk-master') as HTMLInputElement).value = String(state.master);
    (qs(this.el, '.mk-xfader') as HTMLInputElement).value = String(state.crossfader);
    (qs(this.el, '.mk-cuemix') as HTMLInputElement).value = String(state.cueMix);
    this.limiterCheckbox.checked = state.limiterEnabled;
    for (const id of ['A', 'B'] as const) {
      const strip = this.channels[id];
      const deck = state.decks[id];
      strip.volume.value = String(deck.volume);
      strip.trim.value = String(deck.trim ?? 1);
      strip.filter.value = String(deck.filter ?? 0);
      strip.low.value = String(deck.eq.low);
      strip.mid.value = String(deck.eq.mid);
      strip.high.value = String(deck.eq.high);
      const cueOn = deck.cueEnabled ?? false;
      strip.cue.setAttribute('aria-pressed', String(cueOn));
      strip.cue.classList.toggle('active', cueOn);
    }
  }

  update(levels: Record<DeckId, number>, limiterReductionDb: number): void {
    this.channels.A.meter.render(levels.A);
    this.channels.B.meter.render(levels.B);
    const reduction = Math.min(100, Math.max(0, (-limiterReductionDb / 20) * 100));
    this.grFill.style.width = `${reduction}%`;
  }

  renderSpectrum(getFft: (target: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>): void {
    const data = getFft(this.fftData);
    const canvas = qs<HTMLCanvasElement>(this.el, '.spectrum');
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(40, Math.floor(canvas.clientWidth));
    const height = Math.max(24, Math.floor(canvas.clientHeight));
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const barWidth = width / this.spectrumBins;
    for (let i = 0; i < this.spectrumBins; i++) {
      const v = (data[i] ?? 0) / 255;
      const barHeight = v * height;
      ctx.fillStyle = `rgba(34, 211, 238, ${0.35 + v * 0.65})`;
      ctx.fillRect(i * barWidth + 1, height - barHeight, Math.max(1, barWidth - 2), barHeight);
    }
  }
}
