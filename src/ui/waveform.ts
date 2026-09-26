export interface WaveformRegion {
  start: number;
  end: number;
}

export interface WaveformMarker {
  position: number;
  color: string;
  label?: string;
}

export const HOT_CUE_COLORS = [
  '#f87171', '#fb923c', '#facc15', '#4ade80',
  '#2dd4bf', '#60a5fa', '#a78bfa', '#f472b6',
] as const;

/**
 * Waveform de overview en canvas: barras simétricas desde picos reales del
 * PCM, región reproducida resaltada, loop sombreado, beat grid (cuando hay
 * BPM), hot cues, cue principal y playhead. Zoom real (ventana centrada en el
 * playhead) y búsqueda por clic/arrastre bajo el mapeo del zoom actual.
 */
export class WaveformView {
  private peaks: number[] = [];
  private duration = 0;
  private position = 0;
  private loop: WaveformRegion | null = null;
  private cue: number | null = null;
  private hotCues: (number | null)[] = [];
  private beatSec: number | null = null;
  private zoom: 1 | 4 | 16 = 1;

  /** Called with the requested time (seconds) under the current zoom. */
  onSeek: ((seconds: number) => void) | null = null;
  onZoomChange: ((zoom: 1 | 4 | 16) => void) | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly accent: string,
  ) {
    canvas.addEventListener('pointerdown', (e) => this.handlePointer(e));
    canvas.addEventListener('pointermove', (e) => {
      if (e.buttons & 1) this.handlePointer(e);
    });
  }

  setPeaks(peaks: number[], durationSec: number): void {
    this.peaks = peaks;
    this.duration = durationSec;
    this.position = 0;
    this.loop = null;
    this.cue = null;
    this.hotCues = [];
    this.beatSec = null;
    this.zoom = 1;
  }

  update(state: {
    position: number;
    loop: WaveformRegion | null;
    cue: number | null;
    hotCues: (number | null)[];
    beatSec: number | null;
  }): void {
    this.position = state.position;
    this.loop = state.loop;
    this.cue = state.cue;
    this.hotCues = state.hotCues;
    this.beatSec = state.beatSec;
  }

  setZoom(zoom: 1 | 4 | 16): void {
    this.zoom = zoom;
    this.onZoomChange?.(zoom);
  }

  cycleZoom(): void {
    this.setZoom(this.zoom === 1 ? 4 : this.zoom === 4 ? 16 : 1);
  }

  /** Ventana visible [from, to] en segundos según zoom y playhead. */
  private window(): { from: number; to: number } {
    if (this.zoom === 1 || this.duration <= 0) return { from: 0, to: this.duration };
    const span = this.duration / this.zoom;
    const from = Math.min(Math.max(0, this.position - span / 2), Math.max(0, this.duration - span));
    return { from, to: Math.min(this.duration, from + span) };
  }

  /** Convierte x (px) a tiempo bajo la ventana actual. */
  private xToTime(px: number, width: number): number {
    const { from, to } = this.window();
    return from + (px / width) * (to - from);
  }

  private handlePointer(e: PointerEvent): void {
    if (this.duration <= 0) return;
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const time = this.xToTime(e.clientX - rect.left, rect.width);
    this.onSeek?.(Math.min(this.duration, Math.max(0, time)));
  }

  render(): void {
    const canvas = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(50, Math.floor(canvas.clientWidth));
    const height = Math.max(24, Math.floor(canvas.clientHeight));
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = 'rgba(127, 127, 127, 0.08)';
    ctx.fillRect(0, 0, width, height);

    if (this.duration <= 0) return;
    const { from, to } = this.window();
    const span = Math.max(0.0001, to - from);
    const timeToX = (t: number): number => ((t - from) / span) * width;
    const mid = height / 2;

    // Loop region
    if (this.loop) {
      const x0 = timeToX(this.loop.start);
      const x1 = timeToX(this.loop.end);
      ctx.fillStyle = 'rgba(250, 204, 21, 0.15)';
      ctx.fillRect(x0, 0, Math.max(2, x1 - x0), height);
      ctx.fillStyle = 'rgba(250, 204, 21, 0.85)';
      ctx.fillRect(x0, 0, 2, height);
      ctx.fillRect(x1 - 2, 0, 2, height);
    }

    // Beat grid (cuando el beat es lo bastante visible: ≥ 9 px por beat).
    if (this.beatSec && this.beatSec > 0) {
      const pxPerBeat = (this.beatSec / span) * width;
      if (pxPerBeat >= 9) {
        const every = pxPerBeat >= 28 ? 1 : 4;
        const firstBeat = Math.ceil(from / this.beatSec) * this.beatSec;
        ctx.fillStyle = 'rgba(148, 163, 184, 0.28)';
        for (let t = firstBeat, i = 0; t <= to && i < 600; t += this.beatSec * every, i++) {
          const x = Math.round(timeToX(t));
          ctx.fillRect(x, mid - 3, 1, 6);
        }
      }
    }

    // Waveform bars (mapeadas a la ventana visible).
    const n = this.peaks.length;
    if (n > 0) {
      const playedT = this.position;
      for (let x = 0; x < width; x++) {
        const t0 = from + (x / width) * span;
        const t1 = from + ((x + 1) / width) * span;
        const b0 = Math.min(n - 1, Math.max(0, Math.floor((t0 / this.duration) * n)));
        const b1 = Math.min(n - 1, Math.max(0, Math.floor((t1 / this.duration) * n)));
        let peak = 0;
        for (let b = b0; b <= b1; b++) {
          const p = this.peaks[b] ?? 0;
          if (p > peak) peak = p;
        }
        const barHeight = Math.max(1, peak * (mid - 2));
        ctx.fillStyle = t0 <= playedT ? this.accent : 'rgba(148, 163, 184, 0.55)';
        ctx.fillRect(x, mid - barHeight, 1, barHeight * 2);
      }
    }

    // Hot cues
    this.hotCues.forEach((pos, index) => {
      if (pos === null) return;
      const x = timeToX(pos);
      if (x < -6 || x > width + 6) return;
      ctx.fillStyle = HOT_CUE_COLORS[index % HOT_CUE_COLORS.length]!;
      ctx.fillRect(x - 1, 0, 3, height * 0.32);
      ctx.fillRect(x - 4, 0, 10, 10);
    });

    // Cue principal
    if (this.cue !== null) {
      const cx = timeToX(this.cue);
      ctx.fillStyle = 'rgba(250, 250, 250, 0.9)';
      ctx.fillRect(cx - 1, 0, 2, height * 0.35);
    }

    // Playhead
    const playedX = timeToX(this.position);
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(playedX - 1, 0, 2, height);
  }
}
