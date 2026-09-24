import { useLayoutEffect, useRef, useState } from 'react'
import type { DragEvent, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { AUDIO } from '../config/audio'
import { engine } from '../audio/engine'
import type { DeckId, EqBand } from '../audio/types'
import { cueDown, cueUp, focusDeck, pause, play, seek, selectFile, setEq, setVolume, stop } from '../state/commands'
import { useAppSelector } from '../state/useStore'
import type { DeckState } from '../state/types'
import { copy } from './copy'
import { formatDb, formatPercent, formatTime } from './formatTime'

const EQ_BANDS: { band: EqBand; label: string }[] = [
  { band: 'low', label: 'Graves' },
  { band: 'mid', label: 'Medios' },
  { band: 'high', label: 'Agudos' },
]

function statusText(deck: DeckState): string {
  if (deck.transport === 'loading') return copy.transport.loading
  if (deck.previewing) return copy.transport.preview
  if (deck.playing || deck.transport === 'playing') return copy.transport.playing
  if (deck.transport === 'ready') return copy.transport.ready
  if (deck.transport === 'error' && !deck.trackName) return copy.transport.error
  return copy.transport.empty
}

export function DeckPanel({ deckId }: { deckId: DeckId }) {
  const deck = useAppSelector((state) => state.decks[deckId])
  const focused = useAppSelector((state) => state.focusedDeck === deckId)
  const [dragOver, setDragOver] = useState(false)
  const timeRef = useRef<HTMLSpanElement>(null)
  const progressRef = useRef<HTMLInputElement>(null)
  const dragging = useRef(false)
  const lastSeekAt = useRef(0)
  const lastAnnounced = useRef(-1)
  const loaded = deck.duration > 0
  const busy = deck.transport === 'loading'

  useLayoutEffect(() => {
    const paint = () => {
      if (dragging.current) return
      const position = engine.getPosition(deckId)
      if (timeRef.current) timeRef.current.textContent = formatTime(position)
      const slider = progressRef.current
      if (!slider || document.activeElement === slider) return
      slider.value = String(position)
      if (!engine.isPlaying(deckId)) {
        slider.setAttribute('aria-valuetext', formatTime(position))
        lastAnnounced.current = position
        return
      }
      if (Math.abs(position - lastAnnounced.current) >= 1) {
        slider.setAttribute('aria-valuetext', formatTime(position))
        lastAnnounced.current = position
      }
    }
    paint()
    let frame = 0
    const tick = () => {
      paint()
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [deckId, deck.duration, deck.trackName, deck.transport])

  const commitSeek = (seconds: number) => {
    if (!engine.hasBuffer(deckId)) return
    seek(deckId, seconds)
    if (timeRef.current) timeRef.current.textContent = formatTime(engine.getPosition(deckId))
  }

  const onSeekInput = (value: number) => {
    if (timeRef.current) timeRef.current.textContent = formatTime(value)
    const now = performance.now()
    if (!engine.isPlaying(deckId) || now - lastSeekAt.current >= AUDIO.seekThrottleMs) {
      lastSeekAt.current = now
      commitSeek(value)
    }
  }

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    setDragOver(false)
    const file = event.dataTransfer.files[0]
    if (file) selectFile(deckId, file)
  }

  const seekBy = (delta: number) => {
    if (!engine.hasBuffer(deckId)) return
    commitSeek(engine.getPosition(deckId) + delta)
  }

  const onDeckKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.target instanceof HTMLInputElement && event.target.type === 'range') return
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      seekBy(2)
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      seekBy(-2)
    }
  }

  const onCuePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    focusDeck(deckId)
    cueDown(deckId)
  }

  return (
    <section
      className={`deck deck-${deckId.toLowerCase()}${focused ? ' is-focused' : ''}${dragOver ? ' is-drop' : ''}`}
      aria-label={`Deck ${deckId}`}
      onPointerDown={() => focusDeck(deckId)}
      onFocusCapture={() => focusDeck(deckId)}
      onKeyDown={onDeckKeyDown}
      onDragEnter={(event) => {
        event.preventDefault()
        setDragOver(true)
      }}
      onDragOver={(event) => {
        event.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
        setDragOver(false)
      }}
      onDrop={onDrop}
    >
      <div className="deck-head">
        <h2>Deck {deckId}</h2>
        <p className="status" role="status">
          {statusText(deck)}
        </p>
      </div>

      <div className="track-row">
        <label className="file-button">
          {copy.load}
          <input
            type="file"
            accept="audio/mpeg,audio/mp3,.mp3,audio/*,.wav,.m4a,.aac,.flac,.ogg,.opus"
            disabled={busy}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ''
              if (file) selectFile(deckId, file)
            }}
          />
        </label>
        <p className="track-name" title={deck.trackName ?? undefined}>
          {deck.trackName ?? copy.noTrack}
        </p>
      </div>

      {deck.error ? (
        <p className="deck-error" role="alert">
          {deck.error}
        </p>
      ) : null}

      <div className="time-well">
        <span ref={timeRef} className="time-current" />
        <span className="time-duration">{formatTime(deck.duration)}</span>
      </div>
      <p className="time-caption">
        <span>{copy.position}</span>
        <span>
          {copy.duration} {formatTime(deck.duration)}
        </span>
      </p>

      <input
        ref={progressRef}
        className="progress"
        type="range"
        min={0}
        max={deck.duration > 0 ? deck.duration : 0}
        step={0.01}
        defaultValue={0}
        disabled={!loaded}
        aria-label={`Posición del deck ${deckId}`}
        onPointerDown={() => {
          dragging.current = true
          focusDeck(deckId)
        }}
        onInput={(event) => onSeekInput(Number(event.currentTarget.value))}
        onPointerUp={(event) => {
          dragging.current = false
          commitSeek(Number(event.currentTarget.value))
        }}
        onBlur={(event) => {
          dragging.current = false
          if (engine.hasBuffer(deckId)) commitSeek(Number(event.currentTarget.value))
        }}
        onChange={(event) => {
          dragging.current = false
          commitSeek(Number(event.currentTarget.value))
        }}
      />

      <div className="transport-row">
        <button
          type="button"
          className={deck.playing && !deck.previewing ? 'is-on' : undefined}
          aria-pressed={deck.playing && !deck.previewing}
          disabled={!loaded}
          onClick={() => play(deckId)}
        >
          Play
        </button>
        <button type="button" disabled={!loaded || !deck.playing} onClick={() => pause(deckId)}>
          Pausa
        </button>
        <button type="button" disabled={!loaded} onClick={() => stop(deckId)}>
          Stop
        </button>
        <button
          type="button"
          className={deck.previewing ? 'is-on' : undefined}
          aria-pressed={deck.previewing}
          disabled={!loaded}
          onPointerDown={onCuePointerDown}
          onPointerUp={() => cueUp(deckId)}
          onPointerCancel={() => cueUp(deckId)}
          onKeyDown={(event) => {
            if (event.repeat) return
            if (event.key !== ' ' && event.key !== 'Enter') return
            event.preventDefault()
            cueDown(deckId)
          }}
          onKeyUp={(event) => {
            if (event.key === ' ' || event.key === 'Enter') cueUp(deckId)
          }}
        >
          Cue
        </button>
      </div>
      <p className="hint">{copy.cueHint}</p>
      <p className="cue-readout">
        Cue {deck.cueTime === null ? '—' : formatTime(deck.cueTime)}
      </p>

      <label className="slider-field">
        <span className="control-head">
          <span>{copy.volume}</span>
          <span className="readout">{formatPercent(deck.volume)}</span>
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={deck.volume}
          aria-label={`Volumen del deck ${deckId}`}
          aria-valuetext={formatPercent(deck.volume)}
          onPointerDown={() => unlockFromDeck(deckId)}
          onChange={(event) => setVolume(deckId, Number(event.currentTarget.value))}
        />
      </label>

      <fieldset className="eq">
        <legend>{copy.eq}</legend>
        <div className="eq-grid">
          {EQ_BANDS.map((item) => (
            <label key={item.band} className="slider-field">
              <span className="control-head">
                <span>{item.label}</span>
                <span className="readout">{formatDb(deck.eq[item.band])}</span>
              </span>
              <input
                type="range"
                min={AUDIO.eq.minDb}
                max={AUDIO.eq.maxDb}
                step={1}
                value={deck.eq[item.band]}
                aria-label={`EQ ${item.label} del deck ${deckId}`}
                aria-valuetext={formatDb(deck.eq[item.band])}
                onPointerDown={() => unlockFromDeck(deckId)}
                onChange={(event) => setEq(deckId, item.band, Number(event.currentTarget.value))}
              />
            </label>
          ))}
        </div>
        <p className="hint">{copy.eqHelp}</p>
      </fieldset>
    </section>
  )
}

function unlockFromDeck(deckId: DeckId): void {
  focusDeck(deckId)
  engine.unlock()
}
