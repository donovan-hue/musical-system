import type { DeckId, EqGains } from '../audio/types'

export type Transport = 'empty' | 'loading' | 'ready' | 'playing' | 'error'

export type ContextStatus = 'uninitialized' | AudioContextState

export type PitchRange = 8 | 16 | 50

export type BpmStatus = 'idle' | 'running' | 'done'

export type DeckState = {
  trackName: string | null
  playing: boolean
  currentTime: number
  duration: number
  volume: number
  cueTime: number | null
  eq: EqGains
  transport: Transport
  error: string | null
  notice: string | null
  previewing: boolean
  pitchPercent: number
  pitchRange: PitchRange
  bpmTag: number | null
  bpmDetected: number | null
  bpmManual: number | null
  bpmStatus: BpmStatus
  loopIn: number | null
  loopOut: number | null
  loopEnabled: boolean
  syncLock: boolean
}

export type MixerState = {
  crossfader: number
  masterVolume: number
  masterDeck: DeckId
}

export type AppState = {
  contextStatus: ContextStatus
  contextError: string | null
  focusedDeck: DeckId
  decks: Record<DeckId, DeckState>
  mixer: MixerState
}
