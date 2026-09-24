import type { DeckSettings, EqBand } from './settings.js';
import { EQ_MAX_DB, EQ_MIN_DB } from './settings.js';

export type DeckId = 'A' | 'B';

export interface LoopRegion {
  start: number;
  end: number;
}

/**
 * One playback channel. Graph:
 *   source → eqLow → eqMid → eqHigh → channelGain → crossfadeGain → analyser → (engine master)
 *
 * The deck keeps its own transport state (position derives from the audio
 * clock, wrapped inside an active loop) and never touches other decks.
 */
export class Deck {
  readonly id: DeckId;

  private readonly ctx: AudioContext;
  private readonly eqLow: BiquadFilterNode;
  private readonly eqMid: BiquadFilterNode;
  private readonly eqHigh: BiquadFilterNode;
  private readonly channelGain: GainNode;
  private readonly crossfadeGain: GainNode;
  readonly analyser: AnalyserNode;

  /** Sources stopped on purpose; their `onended` must not trigger natural-end logic. */
  private readonly stoppedIntents = new WeakSet<AudioBufferSourceNode>();

  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;

  private _playing = false;
  private startCtxTime = 0;
  private startOffset = 0;
  private _rate = 1;
  private nudgeFactor = 1;

  private cuePoint: number | null = null;
  private loop: LoopRegion | null = null;
  private _duration = 0;

  onEnded: (() => void) | null = null;

  constructor(id: DeckId, ctx: AudioContext, destination: AudioNode) {
    this.id = id;
    this.ctx = ctx;

    this.eqLow = ctx.createBiquadFilter();
    this.eqLow.type = 'lowshelf';
    this.eqLow.frequency.value = 200;

    this.eqMid = ctx.createBiquadFilter();
    this.eqMid.type = 'peaking';
    this.eqMid.frequency.value = 1000;
    this.eqMid.Q.value = 0.8;

    this.eqHigh = ctx.createBiquadFilter();
    this.eqHigh.type = 'highshelf';
    this.eqHigh.frequency.value = 4000;

    this.channelGain = ctx.createGain();
    this.crossfadeGain = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;

    this.eqLow.connect(this.eqMid);
    this.eqMid.connect(this.eqHigh);
    this.eqHigh.connect(this.channelGain);
    this.channelGain.connect(this.crossfadeGain);
    this.crossfadeGain.connect(this.analyser);
    this.analyser.connect(destination);
  }

  // ---------- Loading ----------

  get hasTrack(): boolean {
    return this.buffer !== null;
  }

  get duration(): number {
    return this._duration;
  }

  /** Install a decoded buffer. Mixer-side settings (volume/EQ/pitch) are untouched. */
  load(buffer: AudioBuffer): void {
    this.stopSource();
    this._playing = false;
    this.buffer = buffer;
    this._duration = buffer.duration;
    this.startOffset = 0;
    this.cuePoint = null;
    this.loop = null;
  }

  // ---------- Transport state ----------

  get isPlaying(): boolean {
    return this._playing;
  }

  get rate(): number {
    return this._rate;
  }

  get cue(): number | null {
    return this.cuePoint;
  }

  get loopRegion(): LoopRegion | null {
    return this.loop;
  }

  private effectiveRate(): number {
    return this._rate * this.nudgeFactor;
  }

  /** Current playback position in seconds, wrapped inside an active loop. */
  get position(): number {
    if (!this.buffer) return 0;
    let pos = this._playing
      ? this.startOffset + (this.ctx.currentTime - this.startCtxTime) * this.effectiveRate()
      : this.startOffset;
    if (this.loop) {
      const len = this.loop.end - this.loop.start;
      if (len > 0 && pos > this.loop.end) {
        pos = this.loop.start + ((pos - this.loop.start) % len);
      }
    }
    return Math.min(Math.max(0, pos), this._duration);
  }

  // ---------- Transport controls ----------

  play(): void {
    if (!this.buffer || this._playing) return;
    let offset = this.startOffset;
    if (offset >= this._duration - 0.01) offset = this.cuePoint ?? 0;
    this._playing = true;
    this.startOffset = offset;
    this.startCtxTime = this.ctx.currentTime;
    this.spawnSource(offset);
  }

  pause(): void {
    if (!this._playing) return;
    const pos = this.position;
    this.stopSource();
    this._playing = false;
    this.startOffset = pos;
  }

  /** CDJ-style stop: halt and return to the top. */
  stop(): void {
    this.stopSource();
    this._playing = false;
    this.startOffset = 0;
  }

  /** Seek; cancels an active loop, like a real CDJ jog does. */
  seek(seconds: number): void {
    if (!this.buffer) return;
    const target = Math.min(Math.max(0, seconds), this._duration);
    if (this.loop) this.setLoop(null);
    if (this._playing) {
      this.stopSource();
      this.startOffset = target;
      this.startCtxTime = this.ctx.currentTime;
      this.spawnSource(target);
    } else {
      this.startOffset = target;
    }
  }

  /** Set the cue point at the current position. */
  setCue(): void {
    if (!this.buffer) return;
    this.cuePoint = this.position;
  }

  /** Jump to the cue point (or the top when none), keeping play state. */
  cueJump(): void {
    this.seek(this.cuePoint ?? 0);
  }

  // ---------- Loop ----------

  setLoop(region: LoopRegion | null): void {
    if (region && region.end - region.start < 0.05) return; // Too short to be musical.
    this.loop = region;
    const src = this.source;
    if (src) {
      if (region) {
        src.loop = true;
        src.loopStart = region.start;
        src.loopEnd = region.end;
      } else {
        src.loop = false;
      }
    }
  }

  loopIn(): void {
    if (!this.buffer) return;
    const pos = this.position;
    const end = this.loop && this.loop.end > pos ? this.loop.end : this._duration;
    this.setLoop({ start: pos, end });
  }

  loopOut(): void {
    if (!this.buffer) return;
    const pos = this.position;
    if (this.loop && pos > this.loop.start + 0.05) {
      this.setLoop({ start: this.loop.start, end: pos });
    } else if (!this.loop) {
      this.setLoop({ start: 0, end: pos });
    }
  }

  // ---------- Pitch, nudge, sync ----------

  /** Coupled pitch+tempo: one fader drives both, vinyl-style. */
  setRate(rate: number): void {
    const clamped = Math.min(1.5, Math.max(0.5, rate));
    const pos = this.position;
    this._rate = clamped;
    if (this._playing) {
      this.startOffset = pos;
      this.startCtxTime = this.ctx.currentTime;
      this.source?.playbackRate.setValueAtTime(this.effectiveRate(), this.ctx.currentTime);
    }
  }

  /** Jog while playing: temporary tempo bend (e.g. 1.06). */
  setNudge(factor: number): void {
    const pos = this.position;
    this.nudgeFactor = Math.min(1.5, Math.max(0.5, factor));
    if (this._playing) {
      this.startOffset = pos;
      this.startCtxTime = this.ctx.currentTime;
      this.source?.playbackRate.setValueAtTime(this.effectiveRate(), this.ctx.currentTime);
    }
  }

  clearNudge(): void {
    this.setNudge(1);
  }

  // ---------- Mixer side ----------

  setVolume(position: number): void {
    const v = Math.min(1, Math.max(0, position));
    this.channelGain.gain.setTargetAtTime(v * v, this.ctx.currentTime, 0.02);
  }

  setEq(band: EqBand, db: number): void {
    const g = Math.min(EQ_MAX_DB, Math.max(EQ_MIN_DB, db));
    const node = band === 'low' ? this.eqLow : band === 'mid' ? this.eqMid : this.eqHigh;
    node.gain.setTargetAtTime(g, this.ctx.currentTime, 0.02);
  }

  setCrossfadeGain(gain: number): void {
    this.crossfadeGain.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.02);
  }

  /** Snapshot of the mixer-relevant settings, for persistence. */
  captureSettings(): DeckSettings {
    return {
      volume: Math.sqrt(Math.min(1, Math.max(0, this.channelGain.gain.value))),
      eq: {
        low: this.eqLow.gain.value,
        mid: this.eqMid.gain.value,
        high: this.eqHigh.gain.value,
      },
      pitch: this._rate,
    };
  }

  applySettings(settings: DeckSettings): void {
    this.setVolume(settings.volume);
    this.setEq('low', settings.eq.low);
    this.setEq('mid', settings.eq.mid);
    this.setEq('high', settings.eq.high);
    this.setRate(settings.pitch);
  }

  // ---------- Internals ----------

  private spawnSource(offset: number): void {
    const buffer = this.buffer;
    if (!buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = this.effectiveRate();
    if (this.loop) {
      src.loop = true;
      src.loopStart = this.loop.start;
      src.loopEnd = this.loop.end;
    }
    src.onended = () => {
      src.disconnect();
      if (this.source === src) this.source = null;
      if (!this.stoppedIntents.has(src) && this._playing) {
        this._playing = false;
        this.startOffset = this._duration;
        this.onEnded?.();
      }
    };
    src.connect(this.eqLow);
    src.start(0, Math.max(0, Math.min(offset, this._duration)));
    this.source = src;
  }

  private stopSource(): void {
    const src = this.source;
    if (!src) return;
    this.source = null;
    this.stoppedIntents.add(src);
    try {
      src.stop();
    } catch {
      /* already stopped */
    }
    src.disconnect();
  }
}
