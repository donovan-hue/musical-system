import { useEffect } from 'react'
import { engine } from '../audio/engine'
import { pause, play, unlockAudio } from '../state/commands'
import { toggleLibrary } from '../state/libraryCommands'
import { store } from '../state/store'
import { useAppSelector } from '../state/useStore'
import { copy } from './copy'
import { DeckPanel } from './DeckPanel'
import { LibraryPanel } from './LibraryPanel'
import { MixerSection } from './MixerSection'

export function App() {
  const contextStatus = useAppSelector((state) => state.contextStatus)
  const contextError = useAppSelector((state) => state.contextError)
  const libraryOpen = useAppSelector((state) => state.library.open)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat) return
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      if (target.closest('button, input, textarea, a, label, select')) return
      event.preventDefault()
      const deckId = store.getState().focusedDeck
      const deck = store.getState().decks[deckId]
      engine.unlock()
      if (deck.playing) pause(deckId)
      else play(deckId)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="app">
      <a className="skip" href="#mixer">
        {copy.skipMixer}
      </a>
      <header className="topbar">
        <div className="brand">
          <span className="mark" aria-hidden="true">
            <span className="mark-a" />
            <span className="mark-b" />
          </span>
          <div>
            <p className="eyebrow">{copy.eyebrow}</p>
            <h1>{copy.appName}</h1>
          </div>
        </div>
        <div className="audio-status">
          <button
            type="button"
            className={libraryOpen ? 'is-on' : undefined}
            aria-expanded={libraryOpen}
            aria-controls="library-panel"
            onClick={() => toggleLibrary()}
          >
            {copy.library.toggle}
          </button>
          <p className="status-pill" role="status">
            <span className={contextStatus === 'running' ? 'led is-on' : 'led'} aria-hidden="true" />
            {copy.context[contextStatus]}
          </p>
          {contextStatus !== 'running' ? (
            <button type="button" className="activate" onClick={() => unlockAudio()}>
              {copy.activate}
            </button>
          ) : null}
        </div>
      </header>
      <p className="intro">{copy.intro}</p>
      {contextError ? (
        <p className="banner" role="alert">
          {contextError}
        </p>
      ) : null}
      <LibraryPanel />
      <main className="workspace">
        <div className="deck-grid">
          <DeckPanel deckId="A" />
          <DeckPanel deckId="B" />
        </div>
        <MixerSection />
      </main>
    </div>
  )
}
