export interface MixerCallbacks {
  onMaster(position: number): void;
  onLimiterToggle(enabled: boolean): void;
  onCrossfader(position: number): void;
}

function qs<T extends Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`Missing element: ${selector}`);
  return el;
}

/** Vertical level meter with peak-hold, dB-scaled (-48..0 dB). */
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
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(0, 0, width, height);

    // Slow-decay peak hold above the instantaneous level.
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

/** Master section: volume, limiter (+ gain-reduction meter), spectrum, crossfader. */
export class MixerView {
  readonly el: HTMLElement;
  private readonly deckMeters: Record<'A' | 'B', MeterView>;
  private readonly grFill: HTMLElement;
  private readonly limiterCheckbox: HTMLInputElement;
  private readonly spectrumBins = 56;
  private readonly fftData: Uint8Array<ArrayBuffer>;

  constructor(cb: MixerCallbacks) {
    this.el = document.createElement('section');
    this.el.className = 'mixer';
    this.el.innerHTML = `
      <h2>Master</h2>
      <div class="mixer-meters">
        <canvas class="meter meter-a" title="Nivel Deck A"></canvas>
        <div class="mixer-center">
          <label class="ch-row master-row">Vol <input class="master" type="range" min="0" max="1" step="0.01" value="0.8"></label>
          <label class="limiter-row">
            <input class="limiter-toggle" type="checkbox" checked>
            <span>Limitador</span>
            <span class="gr-meter" title="Reducción de ganancia"><span class="gr-fill"></span></span>
          </label>
          <canvas class="spectrum" title="Espectro del bus master"></canvas>
          <label class="xfader-row">Crossfader <input class="xfader" type="range" min="0" max="1" step="0.01" value="0.5"></label>
          <div class="xfader-labels"><span>A</span><span>B</span></div>
        </div>
        <canvas class="meter meter-b" title="Nivel Deck B"></canvas>
      </div>
    `;
    this.grFill = qs(this.el, '.gr-fill');
    this.limiterCheckbox = qs(this.el, '.limiter-toggle');
    this.fftData = new Uint8Array(this.spectrumBins);

    const masterSlider = qs<HTMLInputElement>(this.el, '.master');
    masterSlider.addEventListener('input', () => cb.onMaster(parseFloat(masterSlider.value)));
    this.limiterCheckbox.addEventListener('change', () => cb.onLimiterToggle(this.limiterCheckbox.checked));
    const xfader = qs<HTMLInputElement>(this.el, '.xfader');
    xfader.addEventListener('input', () => cb.onCrossfader(parseFloat(xfader.value)));

    this.deckMeters = {
      A: new MeterView(qs(this.el, '.meter.meter-a')),
      B: new MeterView(qs(this.el, '.meter.meter-b')),
    };
  }

  /** Sync sliders from persisted state without firing events. */
  setFaders(master: number, crossfader: number, limiterEnabled: boolean): void {
    const masterSlider = qs(this.el, '.master') as HTMLInputElement;
    const xfader = qs(this.el, '.xfader') as HTMLInputElement;
    masterSlider.value = String(master);
    xfader.value = String(crossfader);
    this.limiterCheckbox.checked = limiterEnabled;
  }

  update(levels: { a: number; b: number }, limiterReductionDb: number): void {
    this.deckMeters.A.render(levels.a);
    this.deckMeters.B.render(levels.b);
    // Gain-reduction meter: full scale at -20 dB.
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
