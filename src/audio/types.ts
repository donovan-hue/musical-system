export type DeckId = 'A' | 'B'

export type EqBand = 'low' | 'mid' | 'high'

export type EqGains = {
  low: number
  mid: number
  high: number
}

export type CueAction = 'returned' | 'set' | 'preview'

export class EngineError extends Error {
  readonly code: 'empty' | 'playback' | 'unsupported' | 'blocked' | 'decode'

  constructor(code: EngineError['code']) {
    super(code)
    this.name = 'EngineError'
    this.code = code
  }
}
