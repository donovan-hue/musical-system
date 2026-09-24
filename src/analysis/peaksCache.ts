import type { DeckId } from '../audio/types'

const peaks = new Map<DeckId, Float32Array>()
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function setDeckPeaks(deckId: DeckId, next: Float32Array): void {
  peaks.set(deckId, next)
  emit()
}

export function clearDeckPeaks(deckId: DeckId): void {
  if (!peaks.has(deckId)) return
  peaks.delete(deckId)
  emit()
}

export function getDeckPeaks(deckId: DeckId): Float32Array | null {
  return peaks.get(deckId) ?? null
}

export function subscribePeaks(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
