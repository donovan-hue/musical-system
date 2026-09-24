import { AUDIO } from '../config/audio'
import { clamp } from '../util/clamp'
import { PositionClock } from './PositionClock'
import { resolvePlayOffset } from './playback'
import { approach } from './ramp'
import type { CueAction, DeckId, EqBand, EqGains } from './types'
import { EngineError } from './types'

/**
 * One deck branch:
 * source → EQ low → EQ mid → EQ high → channel gain → crossfader gain → master
 */
export class DeckChannel {
  readonly id: DeckId
  private readonly clock = new PositionClock()
  private readonly eqLow: BiquadFilterNode
  private readonly eqMid: BiquadFilterNode
  private readonly eqHigh: BiquadFilterNode
  private readonly channelGain: GainNode
  private readonly crossfaderGain: GainNode
  private buffer: AudioBuffer | null = null
  private source: AudioBufferSourceNode | null = null
  private generation = 0
  private cueSec = 0
  private previewing = false
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

    this.eqLow.connect(this.eqMid)
    this.eqMid.connect(this.eqHigh)
    this.eqHigh.connect(this.channelGain)
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

  load(buffer: AudioBuffer): void {
    this.stopSource()
    this.previewing = false
    this.buffer = buffer
    this.clock.setDuration(buffer.duration)
    this.clock.markPausedAt(0)
    this.cueSec = 0
  }

  eject(): void {
    this.stopSource()
    this.previewing = false
    this.buffer = null
    this.clock.setDuration(0)
    this.clock.markPausedAt(0)
    this.cueSec = 0
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

  private startSource(offset: number): void {
    if (!this.buffer) throw new EngineError('empty')
    this.stopSource()
    const generation = ++this.generation
    const node = this.context.createBufferSource()
    node.buffer = this.buffer
    node.connect(this.eqLow)
    node.onended = () => {
      if (generation !== this.generation) return
      this.generation += 1
      this.source = null
      this.previewing = false
      this.clock.markPausedAt(this.buffer?.duration ?? 0)
      this.onNaturalEnd()
    }
    const duration = this.buffer.duration
    const safeOffset = Math.min(Math.max(0, offset), Math.max(0, duration - 0.001))
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
