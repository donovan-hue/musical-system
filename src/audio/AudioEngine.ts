import { AUDIO } from '../config/audio'
import { clamp, clamp01 } from '../util/clamp'
import { crossfaderGains } from './CrossfaderLaw'
import { DeckChannel } from './DeckChannel'
import { meterFromRms, rms } from '../analysis/levels'
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
  private masterAnalyser: AnalyserNode | null = null
  private readonly meterBuffer = new Float32Array(AUDIO.fftSize)
  private readonly spectrumBuffer = new Uint8Array(new ArrayBuffer(AUDIO.fftSize / 2))
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
  private readonly rates: Record<DeckId, number> = { A: 1, B: 1 }
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

  setRate(deckId: DeckId, rate: number): number {
    const next = clamp(rate, AUDIO.minRate, AUDIO.maxRate)
    this.rates[deckId] = next
    this.channels.get(deckId)?.setNominalRate(next)
    return this.channels.get(deckId)?.getNominalRate() ?? next
  }

  getNominalRate(deckId: DeckId): number {
    return this.channels.get(deckId)?.getNominalRate() ?? this.rates[deckId]
  }

  getRate(deckId: DeckId): number {
    return this.channels.get(deckId)?.getRate() ?? this.rates[deckId]
  }

  setBend(deckId: DeckId, amount: number): void {
    this.channel(deckId).setBend(amount)
  }

  releaseBend(deckId: DeckId): void {
    this.channels.get(deckId)?.releaseBend()
  }

  setLoopIn(deckId: DeckId): number {
    return this.channel(deckId).setLoopIn(this.getPosition(deckId))
  }

  setLoopOut(deckId: DeckId): number {
    return this.channel(deckId).setLoopOut(this.getPosition(deckId))
  }

  setLoopRegion(deckId: DeckId, inSec: number, outSec: number, enabled: boolean): void {
    this.channel(deckId).setLoopRegion(inSec, outSec, enabled)
  }

  setLoopEnabled(deckId: DeckId, enabled: boolean): boolean {
    return this.channel(deckId).setLoopEnabled(enabled)
  }

  clearLoop(deckId: DeckId): void {
    this.channels.get(deckId)?.clearLoop()
  }

  getLoop(deckId: DeckId): { inSec: number | null; outSec: number | null; enabled: boolean } {
    return this.channels.get(deckId)?.getLoop() ?? { inSec: null, outSec: null, enabled: false }
  }

  readMeter(deckId: DeckId): number | null {
    const analyser = this.channels.get(deckId)?.getAnalyser()
    if (!analyser) return null
    analyser.getFloatTimeDomainData(this.meterBuffer)
    return meterFromRms(rms(this.meterBuffer))
  }

  readMasterMeter(): number | null {
    if (!this.masterAnalyser) return null
    this.masterAnalyser.getFloatTimeDomainData(this.meterBuffer)
    return meterFromRms(rms(this.meterBuffer))
  }

  fillMasterSpectrum(target: Uint8Array): boolean {
    if (!this.masterAnalyser) return false
    this.masterAnalyser.getByteFrequencyData(this.spectrumBuffer)
    target.set(this.spectrumBuffer.subarray(0, Math.min(target.length, this.spectrumBuffer.length)))
    return true
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
    const masterAnalyser = context.createAnalyser()
    masterAnalyser.fftSize = AUDIO.fftSize
    masterAnalyser.smoothingTimeConstant = AUDIO.analyserSmoothing
    master.connect(context.destination)
    master.connect(masterAnalyser)
    this.context = context
    this.masterGain = master
    this.masterAnalyser = masterAnalyser
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
