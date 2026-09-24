import { useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { engine } from '../audio/engine'
import type { DeckId } from '../audio/types'
import { jogBend, jogRelease, jogSeek } from '../state/performance'
import { copy } from './copy'

const SEEK_SECONDS_PER_RADIAN = 0.75

export function JogWheel({ deckId, disabled }: { deckId: DeckId; disabled: boolean }) {
  const wheelRef = useRef<HTMLDivElement>(null)
  const lastAngle = useRef<number | null>(null)
  const bend = useRef(0)
  const nudging = useRef(false)
  const rotation = useRef(0)

  const angleOf = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return Math.atan2(event.clientY - (rect.top + rect.height / 2), event.clientX - (rect.left + rect.width / 2))
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return
    event.currentTarget.setPointerCapture(event.pointerId)
    lastAngle.current = angleOf(event)
    bend.current = 0
    nudging.current = engine.isPlaying(deckId)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (lastAngle.current === null || disabled) return
    const next = angleOf(event)
    let delta = next - lastAngle.current
    if (delta > Math.PI) delta -= Math.PI * 2
    if (delta < -Math.PI) delta += Math.PI * 2
    lastAngle.current = next
    rotation.current += delta
    if (wheelRef.current) wheelRef.current.style.transform = `rotate(${rotation.current}rad)`
    if (nudging.current) {
      bend.current = Math.min(0.1, Math.max(-0.1, bend.current + delta * 0.04))
      jogBend(deckId, bend.current)
      event.currentTarget.setAttribute('aria-valuetext', `empuje ${(bend.current * 100).toFixed(1)} por ciento`)
      return
    }
    jogSeek(deckId, delta * SEEK_SECONDS_PER_RADIAN)
    event.currentTarget.setAttribute('aria-valuetext', 'búsqueda')
  }

  const endGesture = () => {
    if (nudging.current) jogRelease(deckId)
    lastAngle.current = null
    bend.current = 0
    nudging.current = false
  }

  return (
    <div className="jog-block">
      <div className="control-head">
        <span>{copy.jog}</span>
      </div>
      <div
        ref={wheelRef}
        className={`jog deck-${deckId.toLowerCase()}${disabled ? ' is-disabled' : ''}`}
        role="slider"
        aria-label={`Jog del deck ${deckId}. ${copy.jogHelp}`}
        aria-disabled={disabled}
        aria-valuemin={-10}
        aria-valuemax={10}
        aria-valuenow={0}
        tabIndex={disabled ? -1 : 0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
      >
        <span className="jog-mark" />
        <span className="jog-label">JOG</span>
      </div>
      <p className="hint">{copy.jogHelp}</p>
    </div>
  )
}
