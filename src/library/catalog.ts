import type { LibrarySort, LibraryTrack, Playlist } from './types'

export function trackTitle(track: LibraryTrack): string {
  return track.title?.trim() || track.fileName || 'Archivo sin nombre'
}

export function trackBpm(track: LibraryTrack): number | null {
  if (track.bpmManual !== null && track.bpmManual > 0) return track.bpmManual
  if (track.bpmDetected !== null && track.bpmDetected > 0) return track.bpmDetected
  if (track.bpmTag !== null && track.bpmTag > 0) return track.bpmTag
  return null
}

export function filterTracks(tracks: LibraryTrack[], query: string): LibraryTrack[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return tracks
  return tracks.filter((track) => {
    const haystack = [track.fileName, track.title, track.artist, track.album, track.genre]
      .filter((part): part is string => Boolean(part))
      .join(' ')
      .toLowerCase()
    return haystack.includes(needle)
  })
}

export function sortTracks(tracks: LibraryTrack[], sort: LibrarySort, direction: 'asc' | 'desc'): LibraryTrack[] {
  const factor = direction === 'asc' ? 1 : -1
  const copy = tracks.slice()
  copy.sort((left, right) => {
    if (sort === 'bpm') {
      const leftBpm = trackBpm(left)
      const rightBpm = trackBpm(right)
      if (leftBpm === null && rightBpm === null) return left.addedAt - right.addedAt
      if (leftBpm === null) return 1
      if (rightBpm === null) return -1
      return (leftBpm - rightBpm) * factor
    }
    if (sort === 'duration') return (left.durationSec - right.durationSec) * factor
    if (sort === 'addedAt') return (left.addedAt - right.addedAt) * factor
    const leftText = (sort === 'artist' ? left.artist ?? '' : trackTitle(left)).toLowerCase()
    const rightText = (sort === 'artist' ? right.artist ?? '' : trackTitle(right)).toLowerCase()
    const compared = leftText.localeCompare(rightText)
    if (compared !== 0) return compared * factor
    return left.addedAt - right.addedAt
  })
  return copy
}

export function addTrackId(ids: string[], trackId: string): string[] {
  if (ids.includes(trackId)) return ids
  return [...ids, trackId]
}

export function removeTrackId(ids: string[], trackId: string): string[] {
  return ids.filter((id) => id !== trackId)
}

export function moveTrack(ids: string[], index: number, direction: -1 | 1): string[] {
  const target = index + direction
  if (index < 0 || target < 0 || index >= ids.length || target >= ids.length) return ids
  const next = ids.slice()
  const [item] = next.splice(index, 1)
  if (!item) return ids
  next.splice(target, 0, item)
  return next
}

export function playlistTracks(tracks: LibraryTrack[], playlist: Playlist | null): LibraryTrack[] {
  if (!playlist) return tracks
  const byId = new Map(tracks.map((track) => [track.id, track]))
  return playlist.trackIds.flatMap((id) => {
    const track = byId.get(id)
    return track ? [track] : []
  })
}

export function removeTrackFromPlaylists(playlists: Playlist[], trackId: string): Playlist[] {
  return playlists.map((playlist) => ({
    ...playlist,
    trackIds: removeTrackId(playlist.trackIds, trackId),
    updatedAt: playlist.trackIds.includes(trackId) ? Date.now() : playlist.updatedAt,
  }))
}
