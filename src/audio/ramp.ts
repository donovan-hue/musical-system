import { AUDIO } from '../config/audio'

export function approach(param: AudioParam, value: number, when: number): void {
  try {
    param.cancelScheduledValues(when)
    param.setValueAtTime(param.value, when)
    param.linearRampToValueAtTime(value, when + AUDIO.gainSmoothSeconds)
  } catch {
    param.value = value
  }
}
