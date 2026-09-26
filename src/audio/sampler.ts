/**
 * Sampler con sonidos SINTETIZADOS en tiempo real (osciladores + ruido +
 * envolventes): nada de archivos ficticios ni reproducciones simuladas.
 * Cada pad dispara nodos Web Audio reales hacia su bus de salida.
 */
export type SamplerPad = 'kick' | 'snare' | 'clap' | 'hat' | 'tom' | 'zap';

export const SAMPLER_PADS: readonly { id: SamplerPad; label: string }[] = [
  { id: 'kick', label: 'Kick' },
  { id: 'snare', label: 'Snare' },
  { id: 'clap', label: 'Clap' },
  { id: 'hat', label: 'Hat' },
  { id: 'tom', label: 'Tom' },
  { id: 'zap', label: 'Zap' },
];

export class Sampler {
  readonly bus: GainNode;
  private readonly noise: AudioBuffer;

  constructor(private readonly ctx: BaseAudioContext, destination: AudioNode) {
    this.bus = ctx.createGain();
    this.bus.gain.value = 0.9;
    this.bus.connect(destination);
    this.noise = makeNoise(ctx, 1);
  }

  /** Dispara un pad. Devuelve la duración del gesto (para el estado visual). */
  play(pad: SamplerPad): number {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    switch (pad) {
      case 'kick':
        this.tone(t, 150, 48, 0.32, 0.9);
        return 0.35;
      case 'tom':
        this.tone(t, 220, 92, 0.28, 0.75);
        return 0.3;
      case 'snare':
        this.noiseBurst(t, 0.18, 1800, 0.8);
        this.tone(t, 190, 120, 0.12, 0.5);
        return 0.2;
      case 'clap':
        for (const [offset, gain] of [[0, 0.7], [0.012, 0.55], [0.026, 0.85]] as const) {
          this.noiseBurst(t + offset, 0.11, 1150, gain);
        }
        return 0.22;
      case 'hat':
        this.noiseBurst(t, 0.06, 7800, 0.55, 'highpass');
        return 0.08;
      case 'zap': {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(1100, t);
        osc.frequency.exponentialRampToValueAtTime(90, t + 0.16);
        gain.gain.setValueAtTime(0.5, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
        osc.connect(gain);
        gain.connect(this.bus);
        osc.start(t);
        osc.stop(t + 0.2);
        return 0.2;
      }
    }
  }

  private tone(t: number, from: number, to: number, dur: number, peak: number): void {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    gain.gain.setValueAtTime(peak, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain);
    gain.connect(this.bus);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noiseBurst(
    t: number,
    dur: number,
    freq: number,
    peak: number,
    type: BiquadFilterType = 'bandpass',
  ): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 1;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = type === 'bandpass' ? 0.9 : 0.7;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(peak, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.bus);
    const offset = Math.random() * Math.max(0, this.noise.duration - dur - 0.01);
    src.start(t, offset, dur + 0.02);
  }
}

function makeNoise(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}
