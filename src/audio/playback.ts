import { AUDIO } from '../config/audio'
import { clamp } from '../util/clamp'

export function resolvePlayOffset(positionSec: number, durationSec: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 0
  const position = Number.isFinite(positionSec) ? positionSec : 0
  if (durationSec - position <= AUDIO.endRestartSec) return 0
  return clamp(position, 0, durationSec)
}
