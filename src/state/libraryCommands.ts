import { readId3Tags } from '../analysis/id3Bpm'
import { pitchPercentFromRate, rateFromPitchPercent } from '../analysis/tempo'
import { engine } from '../audio/engine'
import type { DeckId } from '../audio/types'
import { AUDIO } from '../config/audio'
import { addTrackId, moveTrack, removeTrackFromPlaylists, removeTrackId } from '../library/catalog'
import { sha256Hex } from '../library/hash'
import { holdSessionFile, takeSessionFile } from '../library/session'
import {
  deletePlaylistStorage,
  deleteTrackStorage,
  hasRoomFor,
  loadLibraryRecords,
  readTrackBytes,
  requestPersistentStorage,
  savePlaylist,
  saveSettings,
  saveTrack,
  saveTrackMeta,
} from '../library/storage'
import type { DeckPrefs, LibrarySort, LibraryTrack, PersistedSettings, Playlist, StorageKind } from '../library/types'
import { validateAudioFile } from '../library/validateAudioFile'
import { copy } from '../ui/copy'
import { loadFile } from './commands'
import { store } from './store'

type ImportOutcome =
  | { status: 'saved'; track: LibraryTrack; notice: null }
  | { status: 'skipped'; track: LibraryTrack; notice: string }
  | { status: 'failed'; notice: string }

let hydrating = true
let persistTimer = 0
let lastSignature = ''

export function toggleLibrary(open?: boolean): void {
  store.patchLibrary({ open: open ?? !store.getState().library.open })
}

export function setLibraryQuery(query: string): void {
  store.patchLibrary({ query })
}

export function setLibrarySort(sort: LibrarySort, sortDir?: 'asc' | 'desc'): void {
  store.patchLibrary({
    sort,
    sortDir: sortDir ?? store.getState().library.sortDir,
  })
}

export function setLibraryPlaylist(playlistId: string | null): void {
  store.patchLibrary({ playlistId })
}

export async function hydrateLibrary(): Promise<void> {
  hydrating = true
  const before = JSON.stringify(currentSettings())
  try {
    const records = await loadLibraryRecords()
    const settings = readSettings(records.settings)
    const untouched = JSON.stringify(currentSettings()) === before
    const currentLast = store.getState().library.lastTrackIds
    store.patchLibrary({
      status: 'ready',
      tracks: records.tracks,
      playlists: records.playlists,
      storageKind: storageKindOf(records.tracks),
      error: null,
      notice: records.settings && !settings ? copy.library.settingsIgnored : null,
      lastTrackIds: {
        A: currentLast.A ?? settings?.lastTrackIds.A ?? null,
        B: currentLast.B ?? settings?.lastTrackIds.B ?? null,
      },
    })
    if (settings && untouched) applySettings(settings)
  } catch {
    store.patchLibrary({
      status: 'unsupported',
      storageKind: 'none',
      error: copy.library.unsupported,
    })
  } finally {
    hydrating = false
  }
}

export function watchLibrarySettings(): void {
  lastSignature = JSON.stringify(currentSettings())
  store.subscribe(() => {
    if (hydrating || store.getState().library.status !== 'ready') return
    const next = JSON.stringify(currentSettings())
    if (next === lastSignature) return
    window.clearTimeout(persistTimer)
    persistTimer = window.setTimeout(() => {
      const payload = currentSettings()
      const signature = JSON.stringify(payload)
      void saveSettings(payload)
        .then(() => {
          lastSignature = signature
        })
        .catch(() => {
          store.patchLibrary({ notice: copy.library.saveSettingsFailed })
        })
    }, 400)
  })
}

function applySettings(settings: PersistedSettings): void {
  const crossfader = engine.setCrossfader(settings.crossfader)
  const masterVolume = engine.setMasterVolume(settings.masterVolume)
  const limiterEnabled = engine.setLimiterEnabled(settings.limiterEnabled)
  for (const deckId of ['A', 'B'] as const) {
    const prefs = settings.decks[deckId]
    const volume = engine.setChannelVolume(deckId, prefs.volume)
    const eq = {
      low: engine.setEq(deckId, 'low', prefs.eq.low),
      mid: engine.setEq(deckId, 'mid', prefs.eq.mid),
      high: engine.setEq(deckId, 'high', prefs.eq.high),
    }
    const rate = engine.setRate(deckId, rateFromPitchPercent(prefs.pitchPercent))
    store.patchDeck(deckId, {
      volume,
      eq,
      pitchPercent: pitchPercentFromRate(rate),
      pitchRange: prefs.pitchRange,
    })
  }
  store.setMixer({
    crossfader,
    masterVolume,
    masterDeck: settings.masterDeck,
    limiterEnabled,
  })
}

function currentSettings(): PersistedSettings {
  const state = store.getState()
  return {
    id: 'mixer',
    crossfader: state.mixer.crossfader,
    masterVolume: state.mixer.masterVolume,
    masterDeck: state.mixer.masterDeck,
    limiterEnabled: state.mixer.limiterEnabled,
    decks: {
      A: deckPrefs('A'),
      B: deckPrefs('B'),
    },
    lastTrackIds: state.library.lastTrackIds,
  }
}

function deckPrefs(deckId: DeckId): PersistedSettings['decks'][DeckId] {
  const deck = store.getState().decks[deckId]
  return {
    volume: deck.volume,
    eq: deck.eq,
    pitchPercent: deck.pitchPercent,
    pitchRange: deck.pitchRange,
  }
}

function storageKindOf(tracks: LibraryTrack[]): StorageKind | 'none' {
  if (tracks.some((track) => track.storage === 'opfs')) return 'opfs'
  if (tracks.length > 0) return 'idb'
  return 'none'
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function readDeckPrefs(value: DeckPrefs | undefined): DeckPrefs | null {
  if (!value) return null
  if (!isFiniteNumber(value.volume) || !isFiniteNumber(value.pitchPercent)) return null
  if (value.pitchRange !== 8 && value.pitchRange !== 16 && value.pitchRange !== 50) return null
  if (!value.eq || !isFiniteNumber(value.eq.low) || !isFiniteNumber(value.eq.mid) || !isFiniteNumber(value.eq.high)) {
    return null
  }
  return value
}

function readSettings(value: PersistedSettings | null): PersistedSettings | null {
  if (!value || value.id !== 'mixer') return null
  if (value.masterDeck !== 'A' && value.masterDeck !== 'B') return null
  if (!isFiniteNumber(value.crossfader) || !isFiniteNumber(value.masterVolume)) return null
  const deckA = readDeckPrefs(value.decks?.A)
  const deckB = readDeckPrefs(value.decks?.B)
  if (!deckA || !deckB) return null
  return {
    id: 'mixer',
    crossfader: value.crossfader,
    masterVolume: value.masterVolume,
    masterDeck: value.masterDeck,
    limiterEnabled: value.limiterEnabled !== false,
    decks: { A: deckA, B: deckB },
    lastTrackIds: {
      A: typeof value.lastTrackIds?.A === 'string' ? value.lastTrackIds.A : null,
      B: typeof value.lastTrackIds?.B === 'string' ? value.lastTrackIds.B : null,
    },
  }
}

export async function importFiles(files: File[]): Promise<void> {
  if (store.getState().library.status !== 'ready') {
    store.patchLibrary({ notice: copy.library.unsupported })
    return
  }
  const persisted = await requestPersistentStorage()
  let imported = 0
  const problems: string[] = []
  for (const file of files) {
    const result = await importOne(file)
    if (result.status === 'saved') imported += 1
    if (result.notice) problems.push(result.notice)
  }
  if (imported > 0 && !persisted) problems.unshift(copy.library.persistDenied)
  store.patchLibrary({ notice: problems.length > 0 ? problems.join(' ') : null })
}

async function importOne(file: File): Promise<ImportOutcome> {
  if (file.size <= 0) return fail(copy.errors.empty)
  if (file.size > AUDIO.maxBytes) return fail(copy.errors['too-large'])
  const header = new Uint8Array(await file.slice(0, AUDIO.headerBytes).arrayBuffer())
  const validation = validateAudioFile(file, header)
  if (!validation.ok) return fail(copy.errors[validation.code])
  const bytes = await file.arrayBuffer()
  const contentHash = await sha256Hex(bytes)
  const existing = store.getState().library.tracks.find((track) => track.contentHash === contentHash)
  if (existing) return skip(existing, `${copy.library.duplicate} ${existing.fileName}`)
  if (!(await hasRoomFor(bytes.byteLength))) return fail(copy.library.quota)
  let decoded: AudioBuffer
  try {
    decoded = await engine.decode(bytes.slice(0))
  } catch {
    return fail(copy.errors.decode)
  }
  const tags = readId3Tags(new Uint8Array(bytes))
  const track: LibraryTrack = {
    id: crypto.randomUUID(),
    fileName: file.name.trim() || 'Archivo sin nombre',
    byteSize: file.size,
    mimeType: file.type || 'application/octet-stream',
    durationSec: decoded.duration,
    sampleRate: decoded.sampleRate,
    numberOfChannels: decoded.numberOfChannels,
    title: tags.title,
    artist: tags.artist,
    album: tags.album,
    genre: tags.genre,
    bpmTag: tags.bpm,
    bpmDetected: null,
    bpmManual: null,
    addedAt: Date.now(),
    contentHash,
    storage: 'idb',
  }
  try {
    const saved = await saveTrack(track, bytes)
    store.patchLibrary({
      tracks: [saved, ...store.getState().library.tracks],
      storageKind: saved.storage,
      error: null,
    })
    return { status: 'saved', track: saved, notice: null }
  } catch {
    return fail(copy.library.quota)
  }
}

function fail(notice: string): ImportOutcome {
  store.patchLibrary({ notice })
  return { status: 'failed', notice }
}

function skip(track: LibraryTrack, notice: string): ImportOutcome {
  store.patchLibrary({ notice })
  return { status: 'skipped', track, notice }
}

export async function saveDeckToLibrary(deckId: DeckId): Promise<void> {
  if (store.getState().library.status !== 'ready') {
    store.patchLibrary({ open: true, notice: copy.library.unsupported })
    return
  }
  const file = takeSessionFile(deckId)
  if (!file) {
    store.patchLibrary({ open: true, notice: copy.library.needFile })
    return
  }
  const deck = store.getState().decks[deckId]
  const result = await importOne(file)
  if (result.status === 'failed') return
  let track = result.track
  if (deck.bpmManual !== null || deck.bpmDetected !== null) {
    track = { ...track, bpmManual: deck.bpmManual, bpmDetected: deck.bpmDetected }
    try {
      await saveTrackMeta(track)
      store.patchLibrary({
        tracks: store.getState().library.tracks.map((item) => (item.id === track.id ? track : item)),
      })
    } catch {
      store.patchLibrary({ notice: copy.library.bpmSaveFailed })
    }
  }
  store.patchDeck(deckId, { libraryTrackId: track.id, hasSessionFile: false })
  holdSessionFile(deckId, null)
  await rememberLast(deckId, track.id)
}

export async function loadLibraryTrack(deckId: DeckId, trackId: string): Promise<void> {
  const track = store.getState().library.tracks.find((item) => item.id === trackId)
  if (!track) {
    store.patchLibrary({ notice: copy.library.missing })
    return
  }
  try {
    const bytes = await readTrackBytes(track)
    const file = new File([bytes], track.fileName, { type: track.mimeType || 'audio/mpeg' })
    const loaded = await loadFile(deckId, file, {
      libraryTrackId: track.id,
      displayName: track.title?.trim() || track.fileName,
      bpmManual: track.bpmManual,
      bpmDetected: track.bpmDetected,
    })
    if (!loaded) return
    await rememberLast(deckId, track.id)
  } catch {
    store.patchLibrary({ notice: copy.library.missing })
  }
}

export async function restoreLastTracks(): Promise<void> {
  const ids = store.getState().library.lastTrackIds
  if (!ids.A && !ids.B) {
    store.patchLibrary({ notice: copy.library.noLast })
    return
  }
  if (ids.A) await loadLibraryTrack('A', ids.A)
  if (ids.B) await loadLibraryTrack('B', ids.B)
}

async function rememberLast(deckId: DeckId, trackId: string): Promise<void> {
  const lastTrackIds = { ...store.getState().library.lastTrackIds, [deckId]: trackId }
  store.patchLibrary({ lastTrackIds })
  if (store.getState().library.status !== 'ready') return
  try {
    const payload = currentSettings()
    await saveSettings(payload)
    lastSignature = JSON.stringify(payload)
  } catch {
    store.patchLibrary({ notice: copy.library.saveSettingsFailed })
  }
}

export async function removeLibraryTrack(trackId: string): Promise<void> {
  const track = store.getState().library.tracks.find((item) => item.id === trackId)
  if (!track) return
  const before = store.getState().library.playlists
  const playlists = removeTrackFromPlaylists(before, trackId)
  try {
    await deleteTrackStorage(track)
    for (const playlist of playlists) {
      const previous = before.find((item) => item.id === playlist.id)
      if (previous && previous.trackIds.length !== playlist.trackIds.length) await savePlaylist(playlist)
    }
  } catch {
    store.patchLibrary({ notice: copy.library.deleteFailed })
    return
  }
  const lastTrackIds = { ...store.getState().library.lastTrackIds }
  if (lastTrackIds.A === trackId) lastTrackIds.A = null
  if (lastTrackIds.B === trackId) lastTrackIds.B = null
  store.patchLibrary({
    tracks: store.getState().library.tracks.filter((item) => item.id !== trackId),
    playlists,
    lastTrackIds,
    storageKind: storageKindOf(store.getState().library.tracks.filter((item) => item.id !== trackId)),
    notice: null,
  })
}

export async function createPlaylist(name: string): Promise<boolean> {
  const trimmed = name.trim()
  if (!trimmed) {
    store.patchLibrary({ notice: copy.library.emptyName })
    return false
  }
  const playlist: Playlist = {
    id: crypto.randomUUID(),
    name: trimmed,
    trackIds: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  if (!(await writePlaylist(playlist))) return false
  store.patchLibrary({
    playlists: [...store.getState().library.playlists, playlist],
    playlistId: playlist.id,
    notice: null,
  })
  return true
}

export async function renamePlaylist(playlistId: string, name: string): Promise<void> {
  const trimmed = name.trim()
  if (!trimmed) {
    store.patchLibrary({ notice: copy.library.emptyName })
    return
  }
  const current = store.getState().library.playlists.find((playlist) => playlist.id === playlistId)
  if (!current) return
  const next = { ...current, name: trimmed, updatedAt: Date.now() }
  if (!(await writePlaylist(next))) return
  replacePlaylist(next)
}

export async function deletePlaylist(playlistId: string): Promise<void> {
  try {
    await deletePlaylistStorage(playlistId)
  } catch {
    store.patchLibrary({ notice: copy.library.deleteFailed })
    return
  }
  store.patchLibrary({
    playlists: store.getState().library.playlists.filter((playlist) => playlist.id !== playlistId),
    playlistId: store.getState().library.playlistId === playlistId ? null : store.getState().library.playlistId,
    notice: null,
  })
}

export async function addToPlaylist(playlistId: string, trackId: string): Promise<void> {
  const current = store.getState().library.playlists.find((playlist) => playlist.id === playlistId)
  if (!current) {
    store.patchLibrary({ notice: copy.library.pickPlaylist })
    return
  }
  const trackIds = addTrackId(current.trackIds, trackId)
  if (trackIds === current.trackIds) {
    store.patchLibrary({ notice: copy.library.alreadyInPlaylist })
    return
  }
  const next = { ...current, trackIds, updatedAt: Date.now() }
  if (!(await writePlaylist(next))) return
  replacePlaylist(next)
}

export async function removeFromPlaylist(playlistId: string, trackId: string): Promise<void> {
  const current = store.getState().library.playlists.find((playlist) => playlist.id === playlistId)
  if (!current) return
  const next = { ...current, trackIds: removeTrackId(current.trackIds, trackId), updatedAt: Date.now() }
  if (!(await writePlaylist(next))) return
  replacePlaylist(next)
}

export async function moveInPlaylist(playlistId: string, index: number, direction: -1 | 1): Promise<void> {
  const current = store.getState().library.playlists.find((playlist) => playlist.id === playlistId)
  if (!current) return
  const trackIds = moveTrack(current.trackIds, index, direction)
  if (trackIds === current.trackIds) return
  const next = { ...current, trackIds, updatedAt: Date.now() }
  if (!(await writePlaylist(next))) return
  replacePlaylist(next)
}

async function writePlaylist(playlist: Playlist): Promise<boolean> {
  try {
    await savePlaylist(playlist)
    return true
  } catch {
    store.patchLibrary({ notice: copy.library.saveSettingsFailed })
    return false
  }
}

function replacePlaylist(next: Playlist): void {
  store.patchLibrary({
    playlists: store.getState().library.playlists.map((playlist) => (playlist.id === next.id ? next : playlist)),
    notice: null,
  })
}

export async function clearLibrary(): Promise<void> {
  const tracks = store.getState().library.tracks.slice()
  const playlists = store.getState().library.playlists.slice()
  const removedTracks = new Set<string>()
  const removedPlaylists = new Set<string>()
  try {
    for (const track of tracks) {
      await deleteTrackStorage(track)
      removedTracks.add(track.id)
    }
    for (const playlist of playlists) {
      await deletePlaylistStorage(playlist.id)
      removedPlaylists.add(playlist.id)
    }
  } catch {
    const remaining = store.getState().library.tracks.filter((track) => !removedTracks.has(track.id))
    store.patchLibrary({
      tracks: remaining,
      playlists: store.getState().library.playlists.filter((playlist) => !removedPlaylists.has(playlist.id)),
      storageKind: storageKindOf(remaining),
      notice: copy.library.deleteFailed,
    })
    return
  }
  store.patchLibrary({
    tracks: [],
    playlists: [],
    playlistId: null,
    storageKind: 'none',
    lastTrackIds: { A: null, B: null },
    notice: null,
  })
}
