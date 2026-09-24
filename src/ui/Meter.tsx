import { useLayoutEffect, useRef } from 'react'
import { engine } from '../audio/engine'
import type { DeckId } from '../audio/types'

export function Meter({ deckId, label }: { deckId: DeckId | 'master'; label: string }) {
  const fillRef = useRef<HTMLSpanElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const announced = useRef(-1)

  useLayoutEffect(() => {
    let frame = 0
    let lastAnnounce = 0
    const tick = (now: number) => {
      const level = deckId === 'master' ? engine.readMasterMeter() : engine.readMeter(deckId)
      const shown = level ?? 0
      if (fillRef.current) fillRef.current.style.transform = `scaleY(${shown})`
      if (rootRef.current && now - lastAnnounce > 400) {
        const next = Math.round(shown * 100)
        if (next !== announced.current) {
          rootRef.current.setAttribute('aria-valuenow', String(next))
          rootRef.current.setAttribute('aria-valuetext', level === null ? 'sin señal' : `${next} por ciento`)
          announced.current = next
        }
        lastAnnounce = now
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [deckId])

  return (
    <div
      ref={rootRef}
      className="meter"
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={0}
      aria-valuetext="sin señal"
    >
      <span ref={fillRef} className={deckId === 'B' ? 'meter-fill is-b' : 'meter-fill'} />
    </div>
  )
}
