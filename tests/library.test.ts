import { describe, expect, it } from 'vitest'
import { addTrackId, filterTracks, moveTrack, playlistTracks, removeTrackFromPlaylists, sortTracks } from '../src/library/catalog'
import { sha256Hex } from '../src/library/hash'
import type { LibraryTrack, Playlist } from '../src/library/types'

function track(partial: Partial<LibraryTrack> & Pick<LibraryTrack, 'id'>): LibraryTrack {
  return {
    fileName: `${partial.id}.mp3`,
    byteSize: 128,
    mimeType: 'audio/mpeg',
    durationSec: 10,
    sampleRate: 44100,
    numberOfChannels: 2,
    title: null,
    artist: null,
    album: null,
    genre: null,
    bpmTag: null,
    bpmDetected: null,
    bpmManual: null,
    addedAt: 1,
    contentHash: partial.id,
    storage: 'idb',
    ...partial,
  }
}

describe('library catalog', () => {
  it('filters by real text and does not invent a match', () => {
    const tracks = [
      track({ id: 'a', title: 'Noche', artist: 'Luna' }),
      track({ id: 'b', fileName: 'tarde.mp3', title: null }),
    ]
    expect(filterTracks(tracks, 'luna').map((item) => item.id)).toEqual(['a'])
    expect(filterTracks(tracks, 'tarde').map((item) => item.id)).toEqual(['b'])
    expect(filterTracks(tracks, 'inventado')).toEqual([])
  })

  it('sorts BPM with missing values last and keeps playlist order', () => {
    const tracks = [
      track({ id: 'late', addedAt: 3, title: 'C', bpmDetected: 90 }),
      track({ id: 'none', addedAt: 2, title: 'A' }),
      track({ id: 'fast', addedAt: 1, title: 'B', bpmManual: 140 }),
    ]
    expect(sortTracks(tracks, 'bpm', 'asc').map((item) => item.id)).toEqual(['late', 'fast', 'none'])
    expect(sortTracks(tracks, 'title', 'asc').map((item) => item.id)).toEqual(['none', 'fast', 'late'])
    const playlist: Playlist = {
      id: 'p',
      name: 'Cierre',
      trackIds: ['fast', 'missing', 'late'],
      createdAt: 1,
      updatedAt: 1,
    }
    expect(playlistTracks(tracks, playlist).map((item) => item.id)).toEqual(['fast', 'late'])
  })

  it('moves playlist ids and drops a deleted track from every playlist', () => {
    expect(addTrackId(['a'], 'a')).toEqual(['a'])
    expect(moveTrack(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c'])
    expect(moveTrack(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c'])
    const untouched: Playlist = {
      id: 'keep',
      name: 'Keep',
      trackIds: ['z'],
      createdAt: 4,
      updatedAt: 4,
    }
    const changed: Playlist = {
      id: 'drop',
      name: 'Drop',
      trackIds: ['z', 'gone'],
      createdAt: 4,
      updatedAt: 4,
    }
    const next = removeTrackFromPlaylists([untouched, changed], 'gone')
    expect(next[0]).toEqual(untouched)
    expect(next[1]?.trackIds).toEqual(['z'])
    expect(next[1]?.updatedAt).not.toBe(4)
  })
})

describe('sha256Hex', () => {
  it('hashes the original bytes', async () => {
    const digest = await sha256Hex(new TextEncoder().encode('abc'))
    expect(digest).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})
