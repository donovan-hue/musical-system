export interface WaveformRegion {
  start: number;
  end: number;
}

/**
 * Canvas overview waveform: symmetric bars from precomputed peaks, played
 * region highlighted, loop region shaded, cue and playhead markers.
 */
export class WaveformView {
  private peaks: number[] = [];
  private duration = 0;
  private position = 0;
  private loop: WaveformRegion | null = null;
  private cue: number | null = null;

  /** Called with the requested fraction (0..1) of the track. */
  onSeek: ((fraction: number) => void) | null = null;

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
  }

  update(positionSec: number, loop: WaveformRegion | null, cue: number | null): void {
    this.position = positionSec;
    this.loop = loop;
    this.cue = cue;
  }

  private handlePointer(e: PointerEvent): void {
    if (this.duration <= 0) return;
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    this.onSeek?.(fraction);
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

    // Background
    ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.fillRect(0, 0, width, height);

    const mid = height / 2;
    const playedFraction = this.duration > 0 ? Math.min(1, this.position / this.duration) : 0;
    const playedX = playedFraction * width;

    // Loop region shading
    if (this.loop && this.duration > 0) {
      const x0 = (this.loop.start / this.duration) * width;
      const x1 = (this.loop.end / this.duration) * width;
      ctx.fillStyle = 'rgba(250, 204, 21, 0.15)';
      ctx.fillRect(x0, 0, Math.max(2, x1 - x0), height);
      ctx.fillStyle = 'rgba(250, 204, 21, 0.8)';
      ctx.fillRect(x0, 0, 2, height);
      ctx.fillRect(x1 - 2, 0, 2, height);
    }

    // Waveform bars
    const n = this.peaks.length;
    if (n > 0) {
      for (let x = 0; x < width; x++) {
        const bucket = Math.min(n - 1, Math.floor((x / width) * n));
        const peak = this.peaks[bucket] ?? 0;
        const barHeight = Math.max(1, peak * (mid - 2));
        ctx.fillStyle = x <= playedX ? this.accent : 'rgba(148, 163, 184, 0.55)';
        ctx.fillRect(x, mid - barHeight, 1, barHeight * 2);
      }
    }

    // Cue marker
    if (this.cue !== null && this.duration > 0) {
      const cx = (this.cue / this.duration) * width;
      ctx.fillStyle = 'rgba(250, 250, 250, 0.9)';
      ctx.fillRect(cx - 1, 0, 2, height * 0.35);
    }

    // Playhead
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(playedX - 1, 0, 2, height);
  }
}
