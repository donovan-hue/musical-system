import { engine } from '../audio/engine'
import type { DeckId } from '../audio/types'
import {
  effectiveBpm,
  fitsPitchRange,
  loopBoundsFromBeats,
  originBpm,
  pitchPercentFromRate,
  rateFromPitchPercent,
  scaleBpm,
  syncRate,
} from '../analysis/tempo'
import { copy } from '../ui/copy'
import { store } from './store'
import type { PitchRange } from './types'

export function setPitch(deckId: DeckId, percent: number): void {
  const range = store.getState().decks[deckId].pitchRange
  const clamped = Math.min(range, Math.max(-range, percent))
  const rate = engine.setRate(deckId, rateFromPitchPercent(clamped))
  store.patchDeck(deckId, {
    pitchPercent: pitchPercentFromRate(rate),
    syncLock: false,
    notice: null,
  })
  followSlaves(deckId)
}

export function setPitchRange(deckId: DeckId, range: PitchRange): void {
  const current = store.getState().decks[deckId].pitchPercent
  const clamped = Math.min(range, Math.max(-range, current))
  const rate = engine.setRate(deckId, rateFromPitchPercent(clamped))
  store.patchDeck(deckId, {
    pitchRange: range,
    pitchPercent: pitchPercentFromRate(rate),
  })
  if (store.getState().mixer.masterDeck === deckId) followSlaves(deckId)
  else if (store.getState().decks[deckId].syncLock) syncDeck(deckId)
}

export function setMasterDeck(deckId: DeckId): void {
  store.setMixer({ masterDeck: deckId })
  store.patchDeck(deckId, { syncLock: false })
  followSlaves(deckId)
}

export function syncDeck(deckId: DeckId): boolean {
  const state = store.getState()
  const masterId = state.mixer.masterDeck
  if (deckId === masterId) {
    store.patchDeck(deckId, { notice: copy.errors.syncIsMaster, syncLock: false })
    return false
  }
  const masterOrigin = originBpm(state.decks[masterId])
  const slaveOrigin = originBpm(state.decks[deckId])
  if (!masterOrigin || !slaveOrigin) {
    store.patchDeck(deckId, { notice: copy.errors.needBpm, syncLock: false })
    return false
  }
  const rate = syncRate(masterOrigin.value, engine.getNominalRate(masterId), slaveOrigin.value)
  if (rate === null) {
    store.patchDeck(deckId, { notice: copy.errors.needBpm, syncLock: false })
    return false
  }
  const percent = pitchPercentFromRate(rate)
  const range = state.decks[deckId].pitchRange
  if (!fitsPitchRange(percent, range)) {
    store.patchDeck(deckId, { notice: copy.errors.syncOutOfRange, syncLock: false })
    return false
  }
  const applied = engine.setRate(deckId, rate)
  store.patchDeck(deckId, {
    pitchPercent: pitchPercentFromRate(applied),
    notice: null,
  })
  return true
}

export function toggleSyncLock(deckId: DeckId): void {
  const enabled = !store.getState().decks[deckId].syncLock
  if (!enabled) {
    store.patchDeck(deckId, { syncLock: false, notice: null })
    return
  }
  store.patchDeck(deckId, { syncLock: true })
  if (!syncDeck(deckId)) store.patchDeck(deckId, { syncLock: false })
}

export function followSlaves(masterId: DeckId): void {
  if (store.getState().mixer.masterDeck !== masterId) return
  for (const deckId of ['A', 'B'] as const) {
    if (deckId !== masterId && store.getState().decks[deckId].syncLock) syncDeck(deckId)
  }
}

export function setManualBpm(deckId: DeckId, value: number): void {
  if (!Number.isFinite(value) || value < 40 || value > 240) {
    store.patchDeck(deckId, { notice: copy.errors.bpmRange })
    return
  }
  store.patchDeck(deckId, {
    bpmManual: Math.round(value * 10) / 10,
    notice: null,
  })
  if (store.getState().mixer.masterDeck === deckId) followSlaves(deckId)
  else if (store.getState().decks[deckId].syncLock) syncDeck(deckId)
}

export function clearManualBpm(deckId: DeckId): void {
  store.patchDeck(deckId, { bpmManual: null, notice: null })
  if (store.getState().mixer.masterDeck === deckId) followSlaves(deckId)
  else if (store.getState().decks[deckId].syncLock) syncDeck(deckId)
}

export function shiftBpmOctave(deckId: DeckId, factor: number): void {
  const origin = originBpm(store.getState().decks[deckId])
  if (!origin) {
    store.patchDeck(deckId, { notice: copy.errors.needBpm })
    return
  }
  const next = scaleBpm(origin.value, factor)
  if (next === null) {
    store.patchDeck(deckId, { notice: copy.errors.bpmRange })
    return
  }
  setManualBpm(deckId, next)
}

export function markLoopIn(deckId: DeckId): void {
  if (!engine.hasBuffer(deckId)) return
  const inSec = engine.setLoopIn(deckId)
  const loop = engine.getLoop(deckId)
  store.patchDeck(deckId, { loopIn: inSec, loopEnabled: loop.enabled, notice: null })
}

export function markLoopOut(deckId: DeckId): void {
  if (!engine.hasBuffer(deckId)) return
  const outSec = engine.setLoopOut(deckId)
  const loop = engine.getLoop(deckId)
  store.patchDeck(deckId, {
    loopOut: outSec,
    loopEnabled: loop.enabled,
    notice: loop.enabled || outSec > (loop.inSec ?? outSec) ? null : copy.errors.loopOrder,
  })
}

export function toggleLoop(deckId: DeckId): void {
  if (!engine.hasBuffer(deckId)) return
  const loop = engine.getLoop(deckId)
  const next = !loop.enabled
  if (next && (loop.inSec === null || loop.outSec === null || loop.outSec <= loop.inSec)) {
    store.patchDeck(deckId, { notice: copy.errors.loopNeedsPoints, loopEnabled: false })
    return
  }
  const enabled = engine.setLoopEnabled(deckId, next)
  const applied = engine.getLoop(deckId)
  store.patchDeck(deckId, {
    loopEnabled: enabled,
    loopIn: applied.inSec,
    loopOut: applied.outSec,
    currentTime: engine.getPosition(deckId),
    playing: engine.isPlaying(deckId),
    transport: engine.isPlaying(deckId) ? 'playing' : 'ready',
    notice: null,
  })
}

export function clearLoop(deckId: DeckId): void {
  engine.clearLoop(deckId)
  store.patchDeck(deckId, { loopIn: null, loopOut: null, loopEnabled: false, notice: null })
}

export function setLoopBeats(deckId: DeckId, beats: number): void {
  if (!engine.hasBuffer(deckId)) return
  const deck = store.getState().decks[deckId]
  const origin = originBpm(deck)
  if (!origin) {
    store.patchDeck(deckId, { notice: copy.errors.loopNeedsBpm })
    return
  }
  const bounds = loopBoundsFromBeats(engine.getPosition(deckId), beats, origin.value, deck.duration)
  if (!bounds) {
    store.patchDeck(deckId, { notice: copy.errors.loopNoFit })
    return
  }
  engine.setLoopRegion(deckId, bounds.inSec, bounds.outSec, true)
  const applied = engine.getLoop(deckId)
  store.patchDeck(deckId, {
    loopIn: applied.inSec,
    loopOut: applied.outSec,
    loopEnabled: applied.enabled,
    currentTime: engine.getPosition(deckId),
    playing: engine.isPlaying(deckId),
    transport: engine.isPlaying(deckId) ? 'playing' : 'ready',
    notice: null,
  })
}

export function jogSeek(deckId: DeckId, deltaSeconds: number): void {
  if (!engine.hasBuffer(deckId) || engine.isPlaying(deckId)) return
  const position = engine.getPosition(deckId) + deltaSeconds
  engine.seek(deckId, position)
  store.patchDeck(deckId, {
    currentTime: engine.getPosition(deckId),
    playing: false,
    previewing: false,
    transport: 'ready',
  })
}

export function jogBend(deckId: DeckId, amount: number): void {
  if (!engine.hasBuffer(deckId) || !engine.isPlaying(deckId)) return
  engine.setBend(deckId, amount)
}

export function jogRelease(deckId: DeckId): void {
  engine.releaseBend(deckId)
}

export function audibleBpm(deckId: DeckId): number | null {
  const origin = originBpm(store.getState().decks[deckId])
  return effectiveBpm(origin?.value ?? null, engine.getNominalRate(deckId))
}
