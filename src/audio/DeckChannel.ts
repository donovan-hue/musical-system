import { AUDIO } from '../config/audio'
import { clamp } from '../util/clamp'
import type { LoopWindow } from './PositionClock'
import { PositionClock } from './PositionClock'
import { resolvePlayOffset } from './playback'
import { approach } from './ramp'
import type { CueAction, DeckId, EqBand, EqGains } from './types'
import { EngineError } from './types'

/**
 * source → EQ → analyser tap (no further connection)
 *              → channel gain → crossfader gain → master
 */
export class DeckChannel {
  readonly id: DeckId
  private readonly clock = new PositionClock()
  private readonly eqLow: BiquadFilterNode
  private readonly eqMid: BiquadFilterNode
  private readonly eqHigh: BiquadFilterNode
  private readonly channelGain: GainNode
  private readonly crossfaderGain: GainNode
  private readonly analyser: AnalyserNode
  private buffer: AudioBuffer | null = null
  private source: AudioBufferSourceNode | null = null
  private generation = 0
  private cueSec = 0
  private previewing = false
  private nominalRate = 1
  private rate = 1
  private loopIn: number | null = null
  private loopOut: number | null = null
  private loopEnabled = false
  private readonly eq: EqGains = { low: 0, mid: 0, high: 0 }

  constructor(
    private readonly context: BaseAudioContext,
    master: AudioNode,
    id: DeckId,
    private readonly onNaturalEnd: () => void,
    volume: number,
    crossfaderGainValue: number,
  ) {
    this.id = id
    this.eqLow = context.createBiquadFilter()
    this.eqLow.type = 'lowshelf'
    this.eqLow.frequency.value = AUDIO.eq.lowHz
    this.eqLow.gain.value = 0

    this.eqMid = context.createBiquadFilter()
    this.eqMid.type = 'peaking'
    this.eqMid.frequency.value = AUDIO.eq.midHz
    this.eqMid.Q.value = AUDIO.eq.midQ
    this.eqMid.gain.value = 0

    this.eqHigh = context.createBiquadFilter()
    this.eqHigh.type = 'highshelf'
    this.eqHigh.frequency.value = AUDIO.eq.highHz
    this.eqHigh.gain.value = 0

    this.channelGain = context.createGain()
    this.channelGain.gain.value = volume
    this.crossfaderGain = context.createGain()
    this.crossfaderGain.gain.value = crossfaderGainValue

    this.analyser = context.createAnalyser()
    this.analyser.fftSize = AUDIO.fftSize
    this.analyser.smoothingTimeConstant = AUDIO.analyserSmoothing

    this.eqLow.connect(this.eqMid)
    this.eqMid.connect(this.eqHigh)
    this.eqHigh.connect(this.channelGain)
    this.eqHigh.connect(this.analyser)
    this.channelGain.connect(this.crossfaderGain)
    this.crossfaderGain.connect(master)
  }

  hasBuffer(): boolean {
    return this.buffer !== null
  }

  getDuration(): number {
    return this.buffer?.duration ?? 0
  }

  getPosition(): number {
    return this.clock.getPosition(this.context.currentTime)
  }

  isPlaying(): boolean {
    return this.clock.isPlaying()
  }

  isPreviewing(): boolean {
    return this.previewing
  }

  getCue(): number {
    return this.cueSec
  }

  getEq(): EqGains {
    return { ...this.eq }
  }

  getAnalyser(): AnalyserNode {
    return this.analyser
  }

  getNominalRate(): number {
    return this.nominalRate
  }

  getRate(): number {
    return this.rate
  }

  getLoop(): { inSec: number | null; outSec: number | null; enabled: boolean } {
    return { inSec: this.loopIn, outSec: this.loopOut, enabled: this.loopEnabled }
  }

  load(buffer: AudioBuffer): void {
    this.stopSource()
    this.previewing = false
    this.buffer = buffer
    this.clock.setDuration(buffer.duration)
    this.clock.markPausedAt(0)
    this.clock.setLoop(null)
    this.cueSec = 0
    this.loopIn = null
    this.loopOut = null
    this.loopEnabled = false
    this.applyRate(this.nominalRate)
  }

  eject(): void {
    this.stopSource()
    this.previewing = false
    this.buffer = null
    this.clock.setDuration(0)
    this.clock.markPausedAt(0)
    this.clock.setLoop(null)
    this.cueSec = 0
    this.loopIn = null
    this.loopOut = null
    this.loopEnabled = false
  }

  play(): void {
    if (!this.buffer) throw new EngineError('empty')
    this.previewing = false
    if (this.clock.isPlaying()) return
    const offset = resolvePlayOffset(this.clock.getPosition(this.context.currentTime), this.buffer.duration)
    this.startSource(offset)
  }

  pause(): number {
    this.previewing = false
    const position = this.clock.pause(this.context.currentTime)
    this.stopSource()
    return position
  }

  stop(): void {
    this.previewing = false
    this.clock.markPausedAt(0)
    this.stopSource()
  }

  seek(seconds: number): number {
    if (!this.buffer) throw new EngineError('empty')
    const wasPlaying = this.clock.isPlaying()
    this.previewing = false
    const next = this.clock.seek(seconds, this.context.currentTime)
    if (wasPlaying) this.startSource(next)
    return this.clock.getPosition(this.context.currentTime)
  }

  cueDown(): CueAction {
    if (!this.buffer) throw new EngineError('empty')
    if (this.previewing) return 'preview'
    const position = this.clock.getPosition(this.context.currentTime)
    if (this.clock.isPlaying() && !this.previewing) {
      this.pause()
      this.clock.markPausedAt(this.cueSec)
      return 'returned'
    }
    if (Math.abs(position - this.cueSec) >= AUDIO.cueToleranceSec) {
      this.cueSec = position
      return 'set'
    }
    this.clock.markPausedAt(this.cueSec)
    this.startSource(this.cueSec)
    this.previewing = true
    return 'preview'
  }

  cueUp(): number | null {
    if (!this.previewing) return null
    this.previewing = false
    this.pause()
    this.clock.markPausedAt(this.cueSec)
    return this.cueSec
  }

  setNominalRate(rate: number): number {
    const next = clamp(rate, AUDIO.minRate, AUDIO.maxRate)
    this.nominalRate = next
    this.applyRate(next)
    return next
  }

  setBend(amount: number): number {
    const bend = clamp(amount, -AUDIO.maxBend, AUDIO.maxBend)
    this.applyRate(this.nominalRate * (1 + bend))
    return bend
  }

  releaseBend(): void {
    this.applyRate(this.nominalRate)
  }

  setLoopIn(seconds: number): number {
    if (!this.buffer) throw new EngineError('empty')
    this.loopIn = clamp(seconds, 0, this.buffer.duration)
    if (this.loopOut !== null && this.loopOut <= this.loopIn) this.loopEnabled = false
    this.applyLoop()
    return this.loopIn
  }

  setLoopOut(seconds: number): number {
    if (!this.buffer) throw new EngineError('empty')
    this.loopOut = clamp(seconds, 0, this.buffer.duration)
    if (this.loopIn !== null && this.loopOut <= this.loopIn) this.loopEnabled = false
    this.applyLoop()
    return this.loopOut
  }

  setLoopRegion(inSec: number, outSec: number, enabled: boolean): void {
    if (!this.buffer) throw new EngineError('empty')
    this.loopIn = clamp(inSec, 0, this.buffer.duration)
    this.loopOut = clamp(outSec, 0, this.buffer.duration)
    this.loopEnabled = enabled && this.loopOut > this.loopIn
    this.applyLoop()
    if (this.loopEnabled && this.loopIn !== null && this.loopOut !== null) {
      const position = this.getPosition()
      if (position < this.loopIn || position >= this.loopOut) this.seek(this.loopIn)
    }
  }

  setLoopEnabled(enabled: boolean): boolean {
    if (!this.buffer) throw new EngineError('empty')
    if (enabled && (this.loopIn === null || this.loopOut === null || this.loopOut <= this.loopIn)) {
      this.loopEnabled = false
      this.applyLoop()
      return false
    }
    this.loopEnabled = enabled
    this.applyLoop()
    if (this.loopEnabled && this.loopIn !== null && this.loopOut !== null) {
      const position = this.getPosition()
      if (position < this.loopIn || position >= this.loopOut) this.seek(this.loopIn)
    }
    return this.loopEnabled
  }

  clearLoop(): void {
    this.loopIn = null
    this.loopOut = null
    this.loopEnabled = false
    this.applyLoop()
  }

  setVolume(value: number): void {
    approach(this.channelGain.gain, clamp(value, 0, 1), this.context.currentTime)
  }

  setCrossfaderGain(value: number): void {
    approach(this.crossfaderGain.gain, clamp(value, 0, 1), this.context.currentTime)
  }

  setEq(band: EqBand, db: number): void {
    const gain = clamp(db, AUDIO.eq.minDb, AUDIO.eq.maxDb)
    this.eq[band] = gain
    const node = band === 'low' ? this.eqLow : band === 'mid' ? this.eqMid : this.eqHigh
    approach(node.gain, gain, this.context.currentTime)
  }

  private applyRate(rate: number): void {
    this.rate = rate
    this.clock.setRate(rate, this.context.currentTime)
    if (this.source) this.source.playbackRate.setValueAtTime(rate, this.context.currentTime)
  }

  private applyLoop(): void {
    const window = this.loopWindow()
    this.clock.setLoop(window)
    const node = this.source
    if (!node) return
    if (window?.enabled) {
      node.loopStart = window.inSec
      node.loopEnd = window.outSec
      node.loop = true
      return
    }
    node.loop = false
  }

  private loopWindow(): LoopWindow | null {
    if (this.loopIn === null || this.loopOut === null || !(this.loopOut > this.loopIn)) return null
    return { enabled: this.loopEnabled, inSec: this.loopIn, outSec: this.loopOut }
  }

  private startSource(offset: number): void {
    if (!this.buffer) throw new EngineError('empty')
    this.stopSource()
    const generation = ++this.generation
    const node = this.context.createBufferSource()
    node.buffer = this.buffer
    node.playbackRate.value = this.rate
    const window = this.loopWindow()
    if (window?.enabled) {
      node.loop = true
      node.loopStart = window.inSec
      node.loopEnd = window.outSec
    }
    node.connect(this.eqLow)
    node.onended = () => {
      if (generation !== this.generation) return
      if (this.loopEnabled && this.loopIn !== null && this.loopOut !== null && this.loopOut - this.loopIn > 0.05) {
        this.startSource(this.loopIn)
        return
      }
      this.generation += 1
      this.source = null
      this.previewing = false
      this.clock.markPausedAt(this.buffer?.duration ?? 0)
      this.onNaturalEnd()
    }
    const duration = this.buffer.duration
    let safeOffset = Math.min(Math.max(0, offset), Math.max(0, duration - 0.001))
    if (window?.enabled && safeOffset >= window.outSec) safeOffset = window.inSec
    const when = this.context.currentTime
    try {
      node.start(when, safeOffset)
    } catch {
      this.generation += 1
      node.onended = null
      try {
        node.disconnect()
      } catch {
        // The node never joined the graph.
      }
      throw new EngineError('playback')
    }
    this.source = node
    this.clock.play(when, safeOffset)
  }

  private stopSource(): void {
    const node = this.source
    if (!node) return
    this.generation += 1
    this.source = null
    node.onended = null
    try {
      node.stop()
    } catch {
      // stop() throws if the source already ended.
    }
    try {
      node.disconnect()
    } catch {
      // Already disconnected.
    }
  }
}
