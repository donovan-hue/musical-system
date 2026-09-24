import { useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { getDeckPeaks, subscribePeaks } from '../analysis/peaksCache'
import { engine } from '../audio/engine'
import type { DeckId } from '../audio/types'
import { seek } from '../state/commands'
import { useAppSelector } from '../state/useStore'
import { copy } from './copy'

export function Waveform({ deckId }: { deckId: DeckId }) {
  const duration = useAppSelector((state) => state.decks[deckId].duration)
  const cueTime = useAppSelector((state) => state.decks[deckId].cueTime)
  const loopIn = useAppSelector((state) => state.decks[deckId].loopIn)
  const loopOut = useAppSelector((state) => state.decks[deckId].loopOut)
  const loopEnabled = useAppSelector((state) => state.decks[deckId].loopEnabled)
  const transport = useAppSelector((state) => state.decks[deckId].transport)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const peaks = useSyncExternalStore(subscribePeaks, () => getDeckPeaks(deckId), () => null)
  const accent = deckId === 'A' ? '#e8a04a' : '#3cb4d6'

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let frame = 0
    const draw = () => {
      paintWaveform(canvas, {
        peaks: getDeckPeaks(deckId),
        duration,
        position: duration > 0 ? engine.getPosition(deckId) : 0,
        cueTime,
        loopIn,
        loopOut,
        loopEnabled,
        accent,
      })
      frame = requestAnimationFrame(draw)
    }
    draw()
    const unsubscribe = subscribePeaks(() => paintWaveform(canvas, {
      peaks: getDeckPeaks(deckId),
      duration,
      position: duration > 0 ? engine.getPosition(deckId) : 0,
      cueTime,
      loopIn,
      loopOut,
      loopEnabled,
      accent,
    }))
    return () => {
      cancelAnimationFrame(frame)
      unsubscribe()
    }
  }, [accent, cueTime, deckId, duration, loopEnabled, loopIn, loopOut])

  const scrub = (clientX: number) => {
    const canvas = canvasRef.current
    if (!canvas || duration <= 0) return
    const rect = canvas.getBoundingClientRect()
    if (rect.width <= 0) return
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    seek(deckId, ratio * duration)
  }

  return (
    <div className="waveform-wrap">
      <div className="control-head">
        <span>{copy.waveform}</span>
        <span className="hint">
          {duration <= 0 ? copy.waveformEmpty : peaks ? 'PCM decodificado' : copy.waveformWorking}
        </span>
      </div>
      <canvas
        ref={canvasRef}
        className="waveform"
        role="img"
        aria-label={`Waveform del deck ${deckId}. Pulsa para buscar.`}
        onPointerDown={(event) => {
          if (transport === 'loading' || duration <= 0) return
          event.currentTarget.setPointerCapture(event.pointerId)
          scrub(event.clientX)
        }}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
          scrub(event.clientX)
        }}
      />
    </div>
  )
}

function paintWaveform(
  canvas: HTMLCanvasElement,
  view: {
    peaks: Float32Array | null
    duration: number
    position: number
    cueTime: number | null
    loopIn: number | null
    loopOut: number | null
    loopEnabled: boolean
    accent: string
  },
): void {
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  if (width <= 0 || height <= 0) return
  const ratio = window.devicePixelRatio || 1
  const nextWidth = Math.floor(width * ratio)
  const nextHeight = Math.floor(height * ratio)
  if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
    canvas.width = nextWidth
    canvas.height = nextHeight
  }
  const context = canvas.getContext('2d')
  if (!context) return
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.clearRect(0, 0, width, height)
  context.fillStyle = '#090c10'
  context.fillRect(0, 0, width, height)
  const mid = height / 2

  if (view.duration > 0 && view.loopIn !== null && view.loopOut !== null && view.loopOut > view.loopIn) {
    const x = (view.loopIn / view.duration) * width
    const w = ((view.loopOut - view.loopIn) / view.duration) * width
    context.fillStyle = view.loopEnabled ? 'rgba(47, 206, 134, 0.22)' : 'rgba(147, 160, 179, 0.16)'
    context.fillRect(x, 0, w, height)
  }

  const peaks = view.peaks
  if (peaks && peaks.length >= 2) {
    const buckets = peaks.length / 2
    context.strokeStyle = view.accent
    context.lineWidth = 1
    context.beginPath()
    for (let bucket = 0; bucket < buckets; bucket += 1) {
      const min = peaks[bucket * 2] ?? 0
      const max = peaks[bucket * 2 + 1] ?? 0
      const x = (bucket / buckets) * width
      context.moveTo(x, mid - max * (height * 0.46))
      context.lineTo(x, mid - min * (height * 0.46))
    }
    context.stroke()
  }

  if (view.duration > 0 && view.cueTime !== null) {
    const x = (view.cueTime / view.duration) * width
    context.strokeStyle = '#f4f7fb'
    context.setLineDash([3, 3])
    context.beginPath()
    context.moveTo(x, 0)
    context.lineTo(x, height)
    context.stroke()
    context.setLineDash([])
  }

  if (view.duration > 0) {
    const x = Math.min(width, Math.max(0, (view.position / view.duration) * width))
    context.strokeStyle = '#f4f7fb'
    context.lineWidth = 2
    context.beginPath()
    context.moveTo(x, 0)
    context.lineTo(x, height)
    context.stroke()
  }
}
