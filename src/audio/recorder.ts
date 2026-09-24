/**
 * Grabación REAL del bus master con MediaRecorder. Sin simulaciones: si el
 * navegador no soporta ningún MIME de audio, se informa cuál se probó.
 * La fuente es el stream interno de Web Audio (no necesita micrófono).
 */
export interface RecorderSnapshot {
  state: 'idle' | 'recording' | 'paused';
  elapsedSec: number;
  mimeType: string;
}

export class MasterRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private pausedTotal = 0;
  private pausedAt: number | null = null;
  private mime: string | null = null;

  constructor(private readonly stream: MediaStream) {}

  static supportedMime(): string | null {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    return candidates.find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) ?? null;
  }

  static available(): boolean {
    return typeof MediaRecorder !== 'undefined' && MasterRecorder.supportedMime() !== null;
  }

  get state(): RecorderSnapshot['state'] {
    if (!this.recorder) return 'idle';
    if (this.recorder.state === 'recording') return 'recording';
    if (this.recorder.state === 'paused') return 'paused';
    return 'idle';
  }

  get mimeType(): string {
    return this.mime ?? '';
  }

  get elapsedSec(): number {
    const now = this.pausedAt ?? performance.now();
    return Math.max(0, (now - this.startedAt - this.pausedTotal) / 1000);
  }

  start(): void {
    if (this.recorder) return;
    const mime = MasterRecorder.supportedMime();
    if (!mime) {
      throw new Error('Este navegador no soporta MediaRecorder con audio (se probó webm/opus, mp4 y ogg).');
    }
    this.mime = mime;
    this.chunks = [];
    this.recorder = new MediaRecorder(this.stream, { mimeType: mime });
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start(1000);
    this.startedAt = performance.now();
    this.pausedTotal = 0;
    this.pausedAt = null;
  }

  pause(): void {
    if (this.recorder?.state === 'recording') {
      this.recorder.pause();
      this.pausedAt = performance.now();
    }
  }

  resume(): void {
    if (this.recorder?.state === 'paused' && this.pausedAt !== null) {
      this.pausedTotal += performance.now() - this.pausedAt;
      this.pausedAt = null;
      this.recorder.resume();
    }
  }

  /** Detén y devuelve el blob real grabado (webm/opus, mp4 u ogg según navegador). */
  stop(): Promise<{ blob: Blob; mimeType: string; durationSec: number } | null> {
    const recorder = this.recorder;
    if (!recorder) return Promise.resolve(null);
    const durationSec = this.elapsedSec;
    return new Promise((resolve) => {
      recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: this.mime ?? 'audio/webm' });
        this.recorder = null;
        this.chunks = [];
        resolve(blob.size > 0 ? { blob, mimeType: blob.type, durationSec } : null);
      };
      recorder.stop();
    });
  }
}
