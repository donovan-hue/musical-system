import type { DeckId, EqGains } from '../audio/types'

type PitchRange = 8 | 16 | 50

export type StorageKind = 'opfs' | 'idb'

export type LibraryTrack = {
  id: string
  fileName: string
  byteSize: number
  mimeType: string
  durationSec: number
  sampleRate: number
  numberOfChannels: number
  title: string | null
  artist: string | null
  album: string | null
  genre: string | null
  bpmTag: number | null
  bpmDetected: number | null
  bpmManual: number | null
  addedAt: number
  contentHash: string
  storage: StorageKind
}

export type Playlist = {
  id: string
  name: string
  trackIds: string[]
  createdAt: number
  updatedAt: number
}

export type DeckPrefs = {
  volume: number
  eq: EqGains
  pitchPercent: number
  pitchRange: PitchRange
}

export type PersistedSettings = {
  id: 'mixer'
  crossfader: number
  masterVolume: number
  masterDeck: DeckId
  limiterEnabled: boolean
  decks: Record<DeckId, DeckPrefs>
  lastTrackIds: Record<DeckId, string | null>
}

export type LibrarySort = 'addedAt' | 'title' | 'artist' | 'bpm' | 'duration'
