import { clamp } from '../util/clamp'

export type LoopWindow = {
  enabled: boolean
  inSec: number
  outSec: number
}

/**
 * AudioBufferSourceNode does not expose a playback position.
 * This clock follows AudioContext.currentTime and the current playback rate.
 */
export class PositionClock {
  private anchorContextTime = 0
  private anchorOffsetSec = 0
  private playing = false
  private durationSec = 0
  private rate = 1
  private loop: LoopWindow | null = null

  setDuration(durationSec: number): void {
    this.durationSec = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0
    this.anchorOffsetSec = Math.min(this.anchorOffsetSec, this.durationSec)
  }

  getDuration(): number {
    return this.durationSec
  }

  getRate(): number {
    return this.rate
  }

  isPlaying(): boolean {
    return this.playing
  }

  setLoop(loop: LoopWindow | null): void {
    if (!loop || !(loop.outSec > loop.inSec)) {
      this.loop = null
      return
    }
    this.loop = loop
  }

  setRate(rate: number, contextTime: number): void {
    const next = Number.isFinite(rate) && rate > 0 ? rate : 1
    if (this.playing) {
      this.anchorOffsetSec = this.getPosition(contextTime)
      this.anchorContextTime = contextTime
    }
    this.rate = next
  }

  getPosition(contextTime: number): number {
    if (!this.playing) return this.anchorOffsetSec
    const elapsed = Number.isFinite(contextTime) ? contextTime - this.anchorContextTime : 0
    const raw = this.anchorOffsetSec + Math.max(0, elapsed) * this.rate
    return this.project(raw)
  }

  play(contextTime: number, offsetSec: number): void {
    this.anchorOffsetSec = clamp(offsetSec, 0, this.durationSec)
    this.anchorContextTime = contextTime
    this.playing = true
  }

  pause(contextTime: number): number {
    this.anchorOffsetSec = this.getPosition(contextTime)
    this.playing = false
    return this.anchorOffsetSec
  }

  seek(offsetSec: number, contextTime: number): number {
    const next = clamp(offsetSec, 0, this.durationSec)
    this.anchorOffsetSec = next
    if (this.playing) this.anchorContextTime = contextTime
    return next
  }

  markPausedAt(offsetSec: number): void {
    this.anchorOffsetSec = clamp(offsetSec, 0, this.durationSec)
    this.playing = false
  }

  private project(raw: number): number {
    const loop = this.loop
    if (loop?.enabled && raw >= loop.outSec) {
      const span = loop.outSec - loop.inSec
      const into = (raw - loop.inSec) % span
      return loop.inSec + into
    }
    return clamp(raw, 0, this.durationSec)
  }
}
