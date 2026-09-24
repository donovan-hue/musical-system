import { AUDIO } from '../config/audio'
import { originBpm, effectiveBpm, rateFromPitchPercent } from '../analysis/tempo'
import type { DeckId } from '../audio/types'
import { setPitch, setPitchRange } from '../state/performance'
import { useAppSelector } from '../state/useStore'
import type { PitchRange } from '../state/types'
import { copy } from './copy'
import { formatBpm } from './formatTime'

export function PitchControl({ deckId }: { deckId: DeckId }) {
  const pitchPercent = useAppSelector((state) => state.decks[deckId].pitchPercent)
  const pitchRange = useAppSelector((state) => state.decks[deckId].pitchRange)
  const bpmManual = useAppSelector((state) => state.decks[deckId].bpmManual)
  const bpmDetected = useAppSelector((state) => state.decks[deckId].bpmDetected)
  const bpmTag = useAppSelector((state) => state.decks[deckId].bpmTag)
  const origin = originBpm({ bpmManual, bpmDetected, bpmTag })
  const effective = effectiveBpm(origin?.value ?? null, rateFromPitchPercent(pitchPercent))

  return (
    <div className="pitch-block">
      <div className="control-head">
        <span>{copy.pitch}</span>
        <span className="readout">
          {pitchPercent > 0 ? '+' : ''}
          {pitchPercent.toFixed(1)}% · {rateFromPitchPercent(pitchPercent).toFixed(3)}×
        </span>
      </div>
      <input
        type="range"
        min={-pitchRange}
        max={pitchRange}
        step={0.1}
        value={pitchPercent}
        aria-label={`Pitch y tempo del deck ${deckId}`}
        aria-valuetext={`${pitchPercent.toFixed(1)} por ciento`}
        onChange={(event) => setPitch(deckId, Number(event.currentTarget.value))}
      />
      <div className="chip-row">
        {AUDIO.pitchRanges.map((range) => (
          <button
            key={range}
            type="button"
            className={pitchRange === range ? 'is-on' : undefined}
            aria-pressed={pitchRange === range}
            onClick={() => setPitchRange(deckId, range as PitchRange)}
          >
            ±{range}%
          </button>
        ))}
      </div>
      <p className="hint">
        {copy.pitchHelp}{' '}
        {effective === null ? 'Sin BPM de origen no hay BPM efectivo.' : `Efectivo ${formatBpm(effective)}, calculado.`}
      </p>
    </div>
  )
}
