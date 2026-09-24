import type { DeckId } from '../audio/types'

const sessionFiles = new Map<DeckId, File>()

export function holdSessionFile(deckId: DeckId, file: File | null): void {
  if (file) sessionFiles.set(deckId, file)
  else sessionFiles.delete(deckId)
}

export function takeSessionFile(deckId: DeckId): File | null {
  return sessionFiles.get(deckId) ?? null
}
