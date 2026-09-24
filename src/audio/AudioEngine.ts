import { AUDIO } from '../config/audio'
import { clamp, clamp01 } from '../util/clamp'
import { crossfaderGains } from './CrossfaderLaw'
import { DeckChannel } from './DeckChannel'
import { approach } from './ramp'
import type { CueAction, DeckId, EqBand, EqGains } from './types'
import { EngineError } from './types'

export type ContextListener = (status: AudioContextState) => void
export type EndedListener = (deckId: DeckId) => void

/**
 * Single AudioContext.
 * Deck A and Deck B are two DeckChannel instances summed at the master gain.
 * Master connects only to context.destination.
 */
export class AudioEngine {
  private context: AudioContext | null = null
  private masterGain: GainNode | null = null
  private readonly channels = new Map<DeckId, DeckChannel>()
  private masterVolume: number = AUDIO.defaultMasterVolume
  private crossfader: number = AUDIO.defaultCrossfader
  private readonly volumes: Record<DeckId, number> = {
    A: AUDIO.defaultChannelVolume,
    B: AUDIO.defaultChannelVolume,
  }
  private readonly eq: Record<DeckId, EqGains> = {
    A: { low: 0, mid: 0, high: 0 },
    B: { low: 0, mid: 0, high: 0 },
  }
  private contextListener: ContextListener | null = null
  private endedListener: EndedListener | null = null

  setContextListener(listener: ContextListener | null): void {
    this.contextListener = listener
  }

  setEndedListener(listener: EndedListener | null): void {
    this.endedListener = listener
  }

  getContextStatus(): 'uninitialized' | AudioContextState {
    return this.context?.state ?? 'uninitialized'
  }

  unlock(): void {
    const context = this.ensureContext()
    if (context.state === 'suspended') {
      void context.resume()
    }
  }

  async resume(): Promise<void> {
    const context = this.ensureContext()
    if (context.state !== 'running') {
      try {
        await context.resume()
      } catch {
        throw new EngineError('blocked')
      }
    }
    if (context.state !== 'running') throw new EngineError('blocked')
  }

  async decode(bytes: ArrayBuffer): Promise<AudioBuffer> {
    const context = this.ensureContext()
    try {
      const audioBuffer = await context.decodeAudioData(bytes.slice(0))
      if (!Number.isFinite(audioBuffer.duration) || audioBuffer.duration <= 0) {
        throw new EngineError('decode')
      }
      return audioBuffer
    } catch (error) {
      if (error instanceof EngineError) throw error
      throw new EngineError('decode')
    }
  }

  load(deckId: DeckId, buffer: AudioBuffer): void {
    this.channel(deckId).load(buffer)
  }

  hasBuffer(deckId: DeckId): boolean {
    return this.channels.get(deckId)?.hasBuffer() ?? false
  }

  getDuration(deckId: DeckId): number {
    return this.channels.get(deckId)?.getDuration() ?? 0
  }

  getPosition(deckId: DeckId): number {
    return this.channels.get(deckId)?.getPosition() ?? 0
  }

  isPlaying(deckId: DeckId): boolean {
    return this.channels.get(deckId)?.isPlaying() ?? false
  }

  isPreviewing(deckId: DeckId): boolean {
    return this.channels.get(deckId)?.isPreviewing() ?? false
  }

  getCue(deckId: DeckId): number {
    return this.channels.get(deckId)?.getCue() ?? 0
  }

  play(deckId: DeckId): void {
    this.channel(deckId).play()
  }

  pause(deckId: DeckId): number {
    return this.channel(deckId).pause()
  }

  stop(deckId: DeckId): void {
    this.channel(deckId).stop()
  }

  seek(deckId: DeckId, seconds: number): number {
    return this.channel(deckId).seek(seconds)
  }

  cueDown(deckId: DeckId): CueAction {
    return this.channel(deckId).cueDown()
  }

  cueUp(deckId: DeckId): number | null {
    return this.channel(deckId).cueUp()
  }

  setChannelVolume(deckId: DeckId, value: number): number {
    const next = clamp01(value)
    this.volumes[deckId] = next
    this.channels.get(deckId)?.setVolume(next)
    return next
  }

  getChannelVolume(deckId: DeckId): number {
    return this.volumes[deckId]
  }

  setEq(deckId: DeckId, band: EqBand, db: number): number {
    const next = clamp(db, AUDIO.eq.minDb, AUDIO.eq.maxDb)
    this.eq[deckId][band] = next
    this.channels.get(deckId)?.setEq(band, next)
    return next
  }

  getEq(deckId: DeckId): EqGains {
    return { ...this.eq[deckId] }
  }

  setCrossfader(position: number): number {
    this.crossfader = clamp01(position)
    this.applyCrossfader()
    return this.crossfader
  }

  getCrossfader(): number {
    return this.crossfader
  }

  setMasterVolume(value: number): number {
    this.masterVolume = clamp01(value)
    if (this.masterGain && this.context) {
      approach(this.masterGain.gain, this.masterVolume, this.context.currentTime)
    }
    return this.masterVolume
  }

  getMasterVolume(): number {
    return this.masterVolume
  }

  private applyCrossfader(): void {
    const gains = crossfaderGains(this.crossfader)
    this.channels.get('A')?.setCrossfaderGain(gains.a)
    this.channels.get('B')?.setCrossfaderGain(gains.b)
  }

  private channel(deckId: DeckId): DeckChannel {
    this.ensureContext()
    const found = this.channels.get(deckId)
    if (!found) throw new EngineError('unsupported')
    return found
  }

  private ensureContext(): AudioContext {
    if (this.context && this.masterGain) return this.context
    if (typeof AudioContext === 'undefined') throw new EngineError('unsupported')
    let context: AudioContext
    try {
      context = new AudioContext()
    } catch {
      throw new EngineError('unsupported')
    }
    const master = context.createGain()
    master.gain.value = this.masterVolume
    master.connect(context.destination)
    this.context = context
    this.masterGain = master
    const gains = crossfaderGains(this.crossfader)
    for (const id of ['A', 'B'] as const) {
      const deck = new DeckChannel(
        context,
        master,
        id,
        () => this.endedListener?.(id),
        this.volumes[id],
        id === 'A' ? gains.a : gains.b,
      )
      deck.setEq('low', this.eq[id].low)
      deck.setEq('mid', this.eq[id].mid)
      deck.setEq('high', this.eq[id].high)
      this.channels.set(id, deck)
    }
    context.onstatechange = () => {
      this.contextListener?.(context.state)
    }
    this.contextListener?.(context.state)
    return context
  }
}
