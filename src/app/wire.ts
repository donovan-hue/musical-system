import { engine } from '../audio/engine'
import { hydrateLibrary, watchLibrarySettings } from '../state/libraryCommands'
import { store } from '../state/store'
import { copy } from '../ui/copy'

const WIRED = '__musicalSystemWired__'

type WiredGlobal = typeof globalThis & {
  [WIRED]?: boolean
}

export function wireEngine(): void {
  const scope = globalThis as WiredGlobal
  if (scope[WIRED]) return
  scope[WIRED] = true

  engine.setEndedListener((deckId) => {
    store.patchDeck(deckId, {
      playing: false,
      previewing: false,
      transport: engine.hasBuffer(deckId) ? 'ready' : 'empty',
      currentTime: engine.getPosition(deckId),
    })
  })

  engine.setContextListener((status) => {
    const previous = store.getState().contextStatus
    if (status === 'running') {
      store.setContext(status, null)
      return
    }
    if (previous === 'running' && (status === 'suspended' || status === 'interrupted')) {
      store.setContext(status, copy.errors.interrupted)
      return
    }
    store.setContext(status, store.getState().contextError)
  })

  void hydrateLibrary().then(() => {
    watchLibrarySettings()
  })
}
