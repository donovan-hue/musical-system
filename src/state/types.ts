import type { DeckId, EqGains } from '../audio/types'

export type Transport = 'empty' | 'loading' | 'ready' | 'playing' | 'error'

export type ContextStatus = 'uninitialized' | AudioContextState

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
  previewing: boolean
}

export type MixerState = {
  crossfader: number
  masterVolume: number
}

export type AppState = {
  contextStatus: ContextStatus
  contextError: string | null
  focusedDeck: DeckId
  decks: Record<DeckId, DeckState>
  mixer: MixerState
}
