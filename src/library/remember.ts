import type { DeckId } from '../audio/types'
import { store } from '../state/store'
import { copy } from '../ui/copy'
import type { LibraryTrack } from './types'
import { saveTrackMeta } from './storage'

export async function rememberDetectedBpm(deckId: DeckId, bpm: number | null): Promise<void> {
  await rememberLibraryFields(deckId, { bpmDetected: bpm })
}

export async function rememberManualBpm(deckId: DeckId, bpm: number | null): Promise<void> {
  await rememberLibraryFields(deckId, { bpmManual: bpm })
}

async function rememberLibraryFields(
  deckId: DeckId,
  patch: Partial<Pick<LibraryTrack, 'bpmDetected' | 'bpmManual'>>,
): Promise<void> {
  const trackId = store.getState().decks[deckId].libraryTrackId
  if (!trackId) return
  const current = store.getState().library.tracks.find((track) => track.id === trackId)
  if (!current) return
  const next = { ...current, ...patch }
  if (next.bpmDetected === current.bpmDetected && next.bpmManual === current.bpmManual) return
  store.patchLibrary({
    tracks: store.getState().library.tracks.map((track) => (track.id === trackId ? next : track)),
  })
  if (store.getState().library.status !== 'ready') return
  try {
    await saveTrackMeta(next)
  } catch {
    store.patchLibrary({ notice: copy.library.bpmSaveFailed })
  }
}
