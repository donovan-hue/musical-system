import { useLayoutEffect, useRef } from 'react'
import { AUDIO } from '../config/audio'
import { logBands } from '../analysis/levels'
import { engine } from '../audio/engine'
import { copy } from './copy'

export function Spectrum() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const bins = new Uint8Array(AUDIO.fftSize / 2)
    let frame = 0
    const draw = () => {
      const ready = engine.fillMasterSpectrum(bins)
      paintSpectrum(canvas, ready ? logBands(bins, AUDIO.spectrumBars) : null)
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <div className="spectrum-wrap">
      <div className="control-head">
        <h2>{copy.spectrum}</h2>
      </div>
      <canvas ref={canvasRef} className="spectrum" role="img" aria-label={copy.spectrum} />
    </div>
  )
}

function paintSpectrum(canvas: HTMLCanvasElement, bars: number[] | null): void {
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
  if (!bars) return
  const gap = 2
  const barWidth = Math.max(1, (width - gap * (bars.length - 1)) / bars.length)
  bars.forEach((level, index) => {
    const barHeight = Math.max(1, level * (height - 4))
    context.fillStyle = '#d7dee8'
    context.fillRect(index * (barWidth + gap), height - barHeight, barWidth, barHeight)
  })
}
