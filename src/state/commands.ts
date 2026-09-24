import { AUDIO } from '../config/audio'
import { detectBpm } from '../analysis/bpm'
import { readId3Bpm } from '../analysis/id3Bpm'
import { computePeaks, mixAudioBuffer } from '../analysis/peaks'
import { setDeckPeaks } from '../analysis/peaksCache'
import { engine } from '../audio/engine'
import type { DeckId, EqBand } from '../audio/types'
import { EngineError } from '../audio/types'
import { validateAudioFile } from '../library/validateAudioFile'
import { copy } from '../ui/copy'
import { followSlaves } from './performance'
import { store } from './store'
import type { DeckState } from './types'

const loadTokens = new Map<DeckId, number>()

function nextLoadToken(deckId: DeckId): number {
  const token = (loadTokens.get(deckId) ?? 0) + 1
  loadTokens.set(deckId, token)
  return token
}

function isCurrentLoad(deckId: DeckId, token: number): boolean {
  return loadTokens.get(deckId) === token
}

export function unlockAudio(): void {
  try {
    engine.unlock()
    const status = engine.getContextStatus()
    if (status === 'running') store.setContext(status, null)
    else if (status !== 'uninitialized') store.setContext(status, store.getState().contextError)
    void confirmRunning()
  } catch (error) {
    store.setContext(engine.getContextStatus(), messageFromEngine(error))
  }
}

async function confirmRunning(): Promise<void> {
  try {
    await engine.resume()
    store.setContext(engine.getContextStatus(), null)
  } catch (error) {
    store.setContext(engine.getContextStatus(), messageFromEngine(error))
  }
}

export function focusDeck(deckId: DeckId): void {
  store.setFocused(deckId)
}

export function selectFile(deckId: DeckId, file: File): void {
  unlockAudio()
  void loadFile(deckId, file)
}

async function loadFile(deckId: DeckId, file: File): Promise<void> {
  const token = nextLoadToken(deckId)
  const previous = store.getState().decks[deckId]
  const pendingName = file.name.trim() || 'Archivo sin nombre'
  store.patchDeck(deckId, {
    transport: 'loading',
    error: null,
    trackName: pendingName,
  })

  if (file.size <= 0) {
    restoreDeck(deckId, previous, copy.errors.empty)
    return
  }
  if (file.size > AUDIO.maxBytes) {
    restoreDeck(deckId, previous, copy.errors['too-large'])
    return
  }

  try {
    const headerBytes = await file.slice(0, AUDIO.headerBytes).arrayBuffer()
    if (!isCurrentLoad(deckId, token)) return
    const header = new Uint8Array(headerBytes)
    const validation = validateAudioFile(file, header)
    if (!validation.ok) {
      restoreDeck(deckId, previous, copy.errors[validation.code])
      return
    }
    const bytes = await file.arrayBuffer()
    if (!isCurrentLoad(deckId, token)) return
    const audioBuffer = await engine.decode(bytes)
    if (!isCurrentLoad(deckId, token)) return
    engine.load(deckId, audioBuffer)
    const tagBpm = readId3Bpm(new Uint8Array(bytes))
    const mixed = mixAudioBuffer(audioBuffer)
    setDeckPeaks(deckId, computePeaks(mixed, AUDIO.waveformBuckets))
    store.patchDeck(deckId, {
      trackName: pendingName,
      playing: false,
      previewing: false,
      currentTime: 0,
      duration: audioBuffer.duration,
      cueTime: 0,
      transport: 'ready',
      error: null,
      notice: null,
      bpmTag: tagBpm,
      bpmDetected: null,
      bpmManual: null,
      bpmStatus: 'running',
      loopIn: null,
      loopOut: null,
      loopEnabled: false,
      syncLock: false,
    })
    scheduleBpm(deckId, token, mixed, audioBuffer.sampleRate)
  } catch (error) {
    if (!isCurrentLoad(deckId, token)) return
    restoreDeck(deckId, previous, messageFromEngine(error))
  }
}

function scheduleBpm(deckId: DeckId, token: number, mixed: Float32Array, sampleRate: number): void {
  setTimeout(() => {
    if (!isCurrentLoad(deckId, token)) return
    const estimate = detectBpm(mixed, sampleRate)
    if (!isCurrentLoad(deckId, token)) return
    store.patchDeck(deckId, {
      bpmDetected: estimate?.bpm ?? null,
      bpmStatus: 'done',
    })
    if (store.getState().mixer.masterDeck === deckId) followSlaves(deckId)
    else if (store.getState().decks[deckId].syncLock) followSlaves(store.getState().mixer.masterDeck)
  }, 0)
}

function restoreDeck(deckId: DeckId, previous: DeckState, message: string): void {
  store.replaceDeck(deckId, {
    ...previous,
    error: message,
    transport: previous.trackName ? previous.transport : 'error',
    playing: previous.playing && previous.trackName !== null,
  })
}

export function play(deckId: DeckId): void {
  unlockAudio()
  if (!engine.hasBuffer(deckId)) {
    store.patchDeck(deckId, { error: copy.errors.needTrack })
    return
  }
  try {
    engine.play(deckId)
    store.patchDeck(deckId, {
      playing: true,
      previewing: false,
      transport: 'playing',
      error: null,
      currentTime: engine.getPosition(deckId),
    })
    watchResume(deckId)
  } catch (error) {
    store.patchDeck(deckId, {
      playing: false,
      previewing: false,
      transport: engine.hasBuffer(deckId) ? 'ready' : 'error',
      error: messageFromEngine(error),
    })
  }
}

export function pause(deckId: DeckId): void {
  if (!engine.hasBuffer(deckId)) return
  const position = engine.pause(deckId)
  store.patchDeck(deckId, {
    playing: false,
    previewing: false,
    transport: 'ready',
    currentTime: position,
  })
}

export function stop(deckId: DeckId): void {
  if (!engine.hasBuffer(deckId)) return
  engine.stop(deckId)
  store.patchDeck(deckId, {
    playing: false,
    previewing: false,
    transport: 'ready',
    currentTime: 0,
  })
}

export function seek(deckId: DeckId, seconds: number): void {
  if (!engine.hasBuffer(deckId)) return
  try {
    const position = engine.seek(deckId, seconds)
    const playing = engine.isPlaying(deckId)
    store.patchDeck(deckId, {
      currentTime: position,
      playing,
      previewing: false,
      transport: playing ? 'playing' : 'ready',
      error: null,
    })
  } catch (error) {
    store.patchDeck(deckId, { error: messageFromEngine(error) })
  }
}

export function cueDown(deckId: DeckId): void {
  unlockAudio()
  if (!engine.hasBuffer(deckId)) {
    store.patchDeck(deckId, { error: copy.errors.needTrack })
    return
  }
  try {
    const action = engine.cueDown(deckId)
    const playing = engine.isPlaying(deckId)
    store.patchDeck(deckId, {
      playing,
      previewing: action === 'preview',
      transport: playing ? 'playing' : 'ready',
      currentTime: engine.getPosition(deckId),
      cueTime: engine.getCue(deckId),
      error: null,
    })
    if (playing) watchResume(deckId)
  } catch (error) {
    store.patchDeck(deckId, { error: messageFromEngine(error) })
  }
}

export function cueUp(deckId: DeckId): void {
  if (!engine.isPreviewing(deckId)) return
  engine.cueUp(deckId)
  store.patchDeck(deckId, {
    playing: false,
    previewing: false,
    transport: 'ready',
    currentTime: engine.getPosition(deckId),
    cueTime: engine.getCue(deckId),
  })
}

export function setVolume(deckId: DeckId, value: number): void {
  const volume = engine.setChannelVolume(deckId, value)
  store.patchDeck(deckId, { volume })
}

export function setEq(deckId: DeckId, band: EqBand, value: number): void {
  const applied = engine.setEq(deckId, band, value)
  store.patchDeck(deckId, {
    eq: { ...store.getState().decks[deckId].eq, [band]: applied },
  })
}

export function setCrossfader(value: number): void {
  const crossfader = engine.setCrossfader(value)
  store.setMixer({ crossfader })
}

export function setMasterVolume(value: number): void {
  const masterVolume = engine.setMasterVolume(value)
  store.setMixer({ masterVolume })
}

function watchResume(deckId: DeckId): void {
  void engine.resume().catch(() => {
    const message = copy.errors.blocked
    store.setContext(engine.getContextStatus(), message)
    if (!engine.isPlaying(deckId)) {
      store.patchDeck(deckId, { error: message })
      return
    }
    const position = engine.pause(deckId)
    store.patchDeck(deckId, {
      playing: false,
      previewing: false,
      transport: 'ready',
      currentTime: position,
      error: message,
    })
  })
}

function messageFromEngine(error: unknown): string {
  if (error instanceof EngineError) {
    if (error.code === 'empty') return copy.errors.needTrack
    if (error.code === 'blocked') return copy.errors.blocked
    if (error.code === 'unsupported') return copy.errors.unsupportedContext
    if (error.code === 'decode') return copy.errors.decode
    return copy.errors.playback
  }
  if (error instanceof DOMException && error.name === 'NotSupportedError') return copy.errors.decode
  return copy.errors.read
}
