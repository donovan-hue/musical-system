import { useRef, useState } from 'react'
import { originBpm } from '../analysis/tempo'
import type { DeckId } from '../audio/types'
import { clearManualBpm, setManualBpm, shiftBpmOctave, syncDeck, toggleSyncLock } from '../state/performance'
import { useAppSelector } from '../state/useStore'
import { copy } from './copy'
import { formatBpm } from './formatTime'

export function BpmControl({ deckId }: { deckId: DeckId }) {
  const deck = useAppSelector((state) => state.decks[deckId])
  const masterDeck = useAppSelector((state) => state.mixer.masterDeck)
  const origin = originBpm(deck)
  const taps = useRef<number[]>([])
  const [tapHint, setTapHint] = useState('')
  const loaded = deck.duration > 0

  const tap = () => {
    const now = performance.now()
    const recent = taps.current.filter((time) => now - time < 2000)
    recent.push(now)
    taps.current = recent.slice(-6)
    if (taps.current.length < 2) {
      setTapHint('Falta otro toque para calcular el BPM.')
      return
    }
    const intervals: number[] = []
    for (let index = 1; index < taps.current.length; index += 1) {
      intervals.push((taps.current[index] ?? 0) - (taps.current[index - 1] ?? 0))
    }
    const average = intervals.reduce((sum, value) => sum + value, 0) / intervals.length
    if (average <= 0) return
    setManualBpm(deckId, 60000 / average)
    setTapHint('')
  }

  return (
    <fieldset className="bpm-block">
      <legend>{copy.bpm}</legend>
      <p className="bpm-value" role="status">
        {deck.bpmStatus === 'running' && !origin
          ? copy.bpmAnalyzing
          : origin
            ? `${formatBpm(origin.value)} · ${copy.bpmSources[origin.source]}`
            : copy.bpmMissing}
      </p>
      <div className="chip-row">
        <button type="button" disabled={!loaded} onClick={tap}>
          Tap
        </button>
        <button type="button" disabled={!origin} onClick={() => shiftBpmOctave(deckId, 0.5)}>
          ÷2
        </button>
        <button type="button" disabled={!origin} onClick={() => shiftBpmOctave(deckId, 2)}>
          ×2
        </button>
        <button type="button" disabled={deck.bpmManual === null} onClick={() => clearManualBpm(deckId)}>
          Quitar manual
        </button>
      </div>
      <label className="manual-bpm">
        BPM manual
        <input
          type="number"
          min={40}
          max={240}
          step={0.1}
          value={deck.bpmManual ?? ''}
          disabled={!loaded}
          aria-label={`BPM manual del deck ${deckId}`}
          onChange={(event) => {
            if (event.currentTarget.value === '') {
              clearManualBpm(deckId)
              return
            }
            setManualBpm(deckId, Number(event.currentTarget.value))
          }}
        />
      </label>
      <div className="chip-row">
        <button type="button" disabled={!loaded || deckId === masterDeck} onClick={() => syncDeck(deckId)}>
          {copy.sync}
        </button>
        <button
          type="button"
          className={deck.syncLock ? 'is-on' : undefined}
          aria-pressed={deck.syncLock}
          disabled={!loaded || deckId === masterDeck}
          onClick={() => toggleSyncLock(deckId)}
        >
          {copy.syncLock}
        </button>
      </div>
      <p className="hint">{tapHint || copy.bpmHelp}</p>
    </fieldset>
  )
}
