import { clamp } from '../util/clamp'

/**
 * AudioBufferSourceNode does not expose a playback position.
 * This clock follows AudioContext.currentTime, not Date.now().
 */
export class PositionClock {
  private anchorContextTime = 0
  private anchorOffsetSec = 0
  private playing = false
  private durationSec = 0

  setDuration(durationSec: number): void {
    this.durationSec = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0
    this.anchorOffsetSec = Math.min(this.anchorOffsetSec, this.durationSec)
  }

  getDuration(): number {
    return this.durationSec
  }

  isPlaying(): boolean {
    return this.playing
  }

  getPosition(contextTime: number): number {
    if (!this.playing) return this.anchorOffsetSec
    const elapsed = Number.isFinite(contextTime) ? contextTime - this.anchorContextTime : 0
    return clamp(this.anchorOffsetSec + Math.max(0, elapsed), 0, this.durationSec)
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
}
