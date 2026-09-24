import { AUDIO } from '../config/audio'
import type { DeckId } from '../audio/types'
import type { AppState, ContextStatus, DeckState, MixerState } from './types'

function emptyDeck(): DeckState {
  return {
    trackName: null,
    playing: false,
    currentTime: 0,
    duration: 0,
    volume: AUDIO.defaultChannelVolume,
    cueTime: null,
    eq: { low: 0, mid: 0, high: 0 },
    transport: 'empty',
    error: null,
    previewing: false,
  }
}

function createState(): AppState {
  return {
    contextStatus: 'uninitialized',
    contextError: null,
    focusedDeck: 'A',
    decks: {
      A: emptyDeck(),
      B: emptyDeck(),
    },
    mixer: {
      crossfader: AUDIO.defaultCrossfader,
      masterVolume: AUDIO.defaultMasterVolume,
    },
  }
}

type Listener = () => void

let state = createState()
const listeners = new Set<Listener>()

function emit(): void {
  for (const listener of listeners) listener()
}

export const store = {
  getState(): AppState {
    return state
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  patchDeck(deckId: DeckId, patch: Partial<DeckState>): void {
    state = {
      ...state,
      decks: {
        ...state.decks,
        [deckId]: { ...state.decks[deckId], ...patch },
      },
    }
    emit()
  },
  replaceDeck(deckId: DeckId, deck: DeckState): void {
    state = {
      ...state,
      decks: {
        ...state.decks,
        [deckId]: deck,
      },
    }
    emit()
  },
  setMixer(patch: Partial<MixerState>): void {
    state = {
      ...state,
      mixer: { ...state.mixer, ...patch },
    }
    emit()
  },
  setContext(contextStatus: ContextStatus, contextError: string | null): void {
    if (state.contextStatus === contextStatus && state.contextError === contextError) return
    state = { ...state, contextStatus, contextError }
    emit()
  },
  setFocused(focusedDeck: DeckId): void {
    if (state.focusedDeck === focusedDeck) return
    state = { ...state, focusedDeck }
    emit()
  },
}

export function resetStoreForTests(): void {
  state = createState()
  emit()
}
