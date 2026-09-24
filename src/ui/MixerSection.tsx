import { crossfaderGains } from '../audio/CrossfaderLaw'
import { setCrossfader, setMasterVolume, unlockAudio } from '../state/commands'
import { useAppSelector } from '../state/useStore'
import { copy } from './copy'
import { formatPercent } from './formatTime'

export function MixerSection() {
  const crossfader = useAppSelector((state) => state.mixer.crossfader)
  const masterVolume = useAppSelector((state) => state.mixer.masterVolume)
  const playingA = useAppSelector((state) => state.decks.A.playing)
  const playingB = useAppSelector((state) => state.decks.B.playing)
  const gains = crossfaderGains(crossfader)

  return (
    <section className="mixer-bar" id="mixer" aria-label="Mezcla">
      <div className="mix-block">
        <div className="control-head">
          <h2>{copy.crossfader}</h2>
          <p className="readout">
            A {formatPercent(gains.a)} · B {formatPercent(gains.b)}
          </p>
        </div>
        <div className="fader-labels" aria-hidden="true">
          <span>A</span>
          <span>B</span>
        </div>
        <input
          className="crossfader-input"
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={crossfader}
          aria-label={copy.crossfader}
          aria-valuetext={`Deck A ${formatPercent(gains.a)}, Deck B ${formatPercent(gains.b)}`}
          onPointerDown={() => unlockAudio()}
          onChange={(event) => setCrossfader(Number(event.currentTarget.value))}
        />
        <p className="hint">{copy.crossfaderHelp}</p>
        <p className="simultaneous" role="status">
          {playingA && playingB ? copy.bothPlaying : 'Listo para mezclar los dos decks.'}
        </p>
      </div>
      <div className="mix-block master-block">
        <div className="control-head">
          <h2>{copy.master}</h2>
          <p className="readout">{formatPercent(masterVolume)}</p>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={masterVolume}
          aria-label="Volumen master"
          aria-valuetext={formatPercent(masterVolume)}
          onPointerDown={() => unlockAudio()}
          onChange={(event) => setMasterVolume(Number(event.currentTarget.value))}
        />
        <p className="hint">{copy.masterHelp}</p>
      </div>
    </section>
  )
}
