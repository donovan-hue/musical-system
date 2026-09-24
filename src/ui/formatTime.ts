export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00.0'
  const clamped = Math.min(seconds, 99 * 3600)
  const totalTenths = Math.floor(clamped * 10 + 1e-6)
  const tenths = totalTenths % 10
  const totalSeconds = Math.floor(totalTenths / 10)
  const secs = totalSeconds % 60
  const mins = Math.floor(totalSeconds / 60) % 60
  const hours = Math.floor(totalSeconds / 3600)
  const ss = String(secs).padStart(2, '0')
  if (hours > 0) return `${hours}:${String(mins).padStart(2, '0')}:${ss}.${tenths}`
  return `${mins}:${ss}.${tenths}`
}

export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '0%'
  return `${Math.round(value * 100)}%`
}

export function formatDb(value: number): string {
  if (!Number.isFinite(value)) return '0 dB'
  const rounded = Math.round(value)
  return `${rounded > 0 ? '+' : ''}${rounded} dB`
}
