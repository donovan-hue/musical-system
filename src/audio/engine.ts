import { crossfadeGains } from './crossfade.js';
import { Deck, type DeckId } from './deck.js';
import type { MixerState } from './settings.js';
import { DEFAULT_MIXER_STATE } from './settings.js';
import { Sampler } from './sampler.js';

/**
 * Dueño del único AudioContext. Topología:
 *
 *   deck.analyser ×2 ──► masterIn ──► masterGain ──► [limitador] ──► masterAnalyser
 *                                                          │
 * deck.channelGain ─► cueSend ─► cueBus ───────────────────┼──► masterOut ──► destination
 *                                                          └──► recTap (MediaStream)
 * sampler.bus ─────────────────────────────────────────────────► masterOut
 *
 * CUE MIX mezcla master vs bus de cue con ley de potencia constante.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterIn: GainNode | null = null;
  private masterGain: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private masterAnalyser: AnalyserNode | null = null;
  private masterOut: GainNode | null = null;
  private cueBus: GainNode | null = null;
  private recTap: MediaStreamAudioDestinationNode | null = null;

  private _sampler: Sampler | null = null;

  private _limiterEnabled = DEFAULT_MIXER_STATE.limiterEnabled;
  private _crossfader = DEFAULT_MIXER_STATE.crossfader;
  private _cueMix = DEFAULT_MIXER_STATE.cueMix;

  private _deckA: Deck | null = null;
  private _deckB: Deck | null = null;

  /** Crea el contexto dentro de un gesto del usuario; seguro llamarlo varias veces. */
  ensure(): AudioContext {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;

    this.masterIn = ctx.createGain();
    this.masterGain = ctx.createGain();
    this.masterAnalyser = ctx.createAnalyser();
    this.masterAnalyser.fftSize = 2048;
    this.masterAnalyser.smoothingTimeConstant = 0.75;
    this.masterOut = ctx.createGain();
    this.cueBus = ctx.createGain();
    this.cueBus.gain.value = 0;

    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -6;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.25;

    try {
      this.recTap = ctx.createMediaStreamDestination();
    } catch {
      this.recTap = null; // Navegador sin MediaStreamAudioDestinationNode.
    }

    this._deckA = new Deck('A', ctx, this.masterIn, this.cueBus);
    this._deckB = new Deck('B', ctx, this.masterIn, this.cueBus);
    this._sampler = new Sampler(ctx, this.masterOut);

    this.wireMaster();
    this.applyCrossfader(this._crossfader);
    this.applyCueMix(this._cueMix);
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  }

  get deckA(): Deck {
    if (!this._deckA) this.ensure();
    return this._deckA!;
  }

  get deckB(): Deck {
    if (!this._deckB) this.ensure();
    return this._deckB!;
  }

  get sampler(): Sampler {
    if (!this._sampler) this.ensure();
    return this._sampler!;
  }

  deck(id: DeckId): Deck {
    return id === 'A' ? this.deckA : this.deckB;
  }

  /** True once the context exists (first user gesture happened). */
  get booted(): boolean {
    return this.ctx !== null;
  }

  /** Deck without creating the context — safe from the rAF loop before boot. */
  peekDeck(id: DeckId): Deck | null {
    return id === 'A' ? this._deckA : this._deckB;
  }

  // ---------- Master ----------

  setMasterVolume(position: number): void {
    this.ensure();
    const v = Math.min(1, Math.max(0, position));
    this.masterGain!.gain.setTargetAtTime(v * v, this.ctx!.currentTime, 0.02);
  }

  get limiterEnabled(): boolean {
    return this._limiterEnabled;
  }

  setLimiterEnabled(enabled: boolean): void {
    this.ensure();
    if (this._limiterEnabled === enabled) return;
    this._limiterEnabled = enabled;
    this.wireMaster();
  }

  /** Current gain reduction of the limiter, in dB (≤ 0). */
  get limiterReductionDb(): number {
    return this.limiter?.reduction ?? 0;
  }

  get crossfader(): number {
    return this._crossfader;
  }

  setCrossfader(position: number): void {
    this.ensure();
    this._crossfader = Math.min(1, Math.max(0, position));
    this.applyCrossfader(this._crossfader);
  }

  private applyCrossfader(position: number): void {
    const { a, b } = crossfadeGains(position);
    this._deckA?.setCrossfadeGain(a);
    this._deckB?.setCrossfadeGain(b);
  }

  /** 0 = solo master, 1 = solo canales marcados con CUE. */
  get cueMix(): number {
    return this._cueMix;
  }

  setCueMix(mix: number): void {
    this.ensure();
    this._cueMix = Math.min(1, Math.max(0, mix));
    this.applyCueMix(this._cueMix);
  }

  private applyCueMix(mix: number): void {
    const now = this.ctx?.currentTime ?? 0;
    this.masterOut?.gain.setTargetAtTime(Math.cos((mix * Math.PI) / 2), now, 0.02);
    this.cueBus?.gain.setTargetAtTime(Math.sin((mix * Math.PI) / 2), now, 0.02);
  }

  /** Bypass = rewire the limiter out of the chain. */
  private wireMaster(): void {
    const ctx = this.ctx!;
    this.masterIn!.disconnect();
    this.masterGain!.disconnect();
    this.limiter?.disconnect();
    this.masterAnalyser!.disconnect();

    this.masterIn!.connect(this.masterGain!);
    if (this._limiterEnabled) {
      this.masterGain!.connect(this.limiter!);
      this.limiter!.connect(this.masterAnalyser!);
    } else {
      this.masterGain!.connect(this.masterAnalyser!);
    }
    this.masterAnalyser!.connect(this.masterOut!);
    this.masterOut!.connect(ctx.destination);
    if (this.recTap) {
      this.masterAnalyser!.connect(this.recTap); // la grabación escucha el bus post-límite
    }
  }

  /** Stream real del bus master para MediaRecorder (null si el navegador no lo ofrece). */
  get recordStream(): MediaStream | null {
    this.ensure();
    return this.recTap?.stream ?? null;
  }

  // ---------- Metering ----------

  private deckMeterScratch: Float32Array<ArrayBuffer> | null = null;

  /** Peak amplitude (0..1) read from a deck's post-fader analyser. */
  deckLevel(id: DeckId): number {
    const deck = this.deck(id);
    const size = deck.analyser.fftSize;
    if (!this.deckMeterScratch || this.deckMeterScratch.length !== size) {
      this.deckMeterScratch = new Float32Array(size);
    }
    const data = this.deckMeterScratch;
    deck.analyser.getFloatTimeDomainData(data);
    let peak = 0;
    for (let i = 0; i < data.length; i++) {
      const abs = Math.abs(data[i]!);
      if (abs > peak) peak = abs;
    }
    return peak;
  }

  /** FFT magnitudes (0..255) of the master bus, for the spectrum display. */
  masterSpectrum(target: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
    this.ensure();
    this.masterAnalyser!.getByteFrequencyData(target);
    return target;
  }

  // ---------- Persistence ----------

  captureState(): MixerState {
    this.ensure();
    return {
      master: Math.sqrt(Math.min(1, Math.max(0, this.masterGain!.gain.value))),
      limiterEnabled: this._limiterEnabled,
      crossfader: this._crossfader,
      cueMix: this._cueMix,
      decks: {
        A: this.deckA.captureSettings(),
        B: this.deckB.captureSettings(),
      },
    };
  }

  applyState(state: MixerState): void {
    this.ensure();
    this.setMasterVolume(state.master);
    this._limiterEnabled = state.limiterEnabled;
    this.wireMaster();
    this.applyCrossfader(state.crossfader);
    this._crossfader = state.crossfader;
    this.applyCueMix(state.cueMix ?? 0);
    this._cueMix = state.cueMix ?? 0;
    this.deckA.applySettings(state.decks.A);
    this.deckB.applySettings(state.decks.B);
  }
}
