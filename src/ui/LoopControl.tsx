import { originBpm } from '../analysis/tempo'
import type { DeckId } from '../audio/types'
import { clearLoop, markLoopIn, markLoopOut, setLoopBeats, toggleLoop } from '../state/performance'
import { useAppSelector } from '../state/useStore'
import { copy } from './copy'
import { formatTime } from './formatTime'

const BEATS = [0.5, 1, 2, 4, 8] as const

export function LoopControl({ deckId }: { deckId: DeckId }) {
  const deck = useAppSelector((state) => state.decks[deckId])
  const origin = originBpm(deck)
  const loaded = deck.duration > 0

  return (
    <fieldset className="loop-block">
      <legend>{copy.loop}</legend>
      <p className="readout">
        {deck.loopIn === null ? 'In —' : `In ${formatTime(deck.loopIn)}`}
        {' · '}
        {deck.loopOut === null ? 'Out —' : `Out ${formatTime(deck.loopOut)}`}
        {deck.loopEnabled ? ' · activo' : ''}
      </p>
      <div className="chip-row">
        <button type="button" disabled={!loaded} onClick={() => markLoopIn(deckId)}>
          In
        </button>
        <button type="button" disabled={!loaded} onClick={() => markLoopOut(deckId)}>
          Out
        </button>
        <button
          type="button"
          className={deck.loopEnabled ? 'is-on' : undefined}
          aria-pressed={deck.loopEnabled}
          disabled={!loaded}
          onClick={() => toggleLoop(deckId)}
        >
          {deck.loopEnabled ? 'Loop on' : 'Loop off'}
        </button>
        <button type="button" disabled={!loaded} onClick={() => clearLoop(deckId)}>
          Limpiar
        </button>
      </div>
      <div className="chip-row">
        {BEATS.map((beats) => (
          <button
            key={beats}
            type="button"
            disabled={!loaded || !origin}
            title={origin ? undefined : copy.errors.loopNeedsBpm}
            onClick={() => setLoopBeats(deckId, beats)}
          >
            {beats} beat{beats === 1 ? '' : 's'}
          </button>
        ))}
      </div>
      <p className="hint">{copy.loopHelp}</p>
    </fieldset>
  )
}
