import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { filterTracks, playlistTracks, sortTracks } from '../library/catalog'
import type { LibrarySort, LibraryTrack } from '../library/types'
import { unlockAudio } from '../state/commands'
import {
  addToPlaylist,
  clearLibrary,
  createPlaylist,
  deletePlaylist,
  importFiles,
  loadLibraryTrack,
  moveInPlaylist,
  removeFromPlaylist,
  removeLibraryTrack,
  renamePlaylist,
  restoreLastTracks,
  setLibraryPlaylist,
  setLibraryQuery,
  setLibrarySort,
  toggleLibrary,
} from '../state/libraryCommands'
import { useAppSelector } from '../state/useStore'
import { copy } from './copy'
import { formatBpm, formatTime } from './formatTime'

const SORTS: LibrarySort[] = ['addedAt', 'title', 'artist', 'bpm', 'duration']

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function bpmLine(track: LibraryTrack): string | null {
  const parts: string[] = []
  if (track.bpmManual !== null) parts.push(`${copy.bpmSources.manual} ${formatBpm(track.bpmManual)}`)
  if (track.bpmDetected !== null) parts.push(`${copy.bpmSources.detected} ${formatBpm(track.bpmDetected)}`)
  if (track.bpmTag !== null) parts.push(`${copy.bpmSources.tag} ${formatBpm(track.bpmTag)}`)
  return parts.length > 0 ? parts.join(' · ') : null
}

function storageSummary(tracks: LibraryTrack[], status: 'loading' | 'ready' | 'unsupported'): string {
  if (status === 'loading') return copy.library.loading
  if (status === 'unsupported') return copy.library.unsupported
  if (tracks.length === 0) return copy.library.emptyStorage
  const kinds = new Set(tracks.map((track) => track.storage))
  if (kinds.size > 1) return copy.library.storageMixed
  return kinds.has('opfs') ? copy.library.storageOpfs : copy.library.storageIdb
}

export function LibraryPanel() {
  const library = useAppSelector((state) => state.library)
  const selected = library.playlists.find((playlist) => playlist.id === library.playlistId) ?? null
  const visible = selected
    ? filterTracks(playlistTracks(library.tracks, selected), library.query)
    : sortTracks(filterTracks(library.tracks, library.query), library.sort, library.sortDir)
  const available = selected
    ? filterTracks(
        library.tracks.filter((track) => !selected.trackIds.includes(track.id)),
        library.query,
      )
    : []
  const [playlistName, setPlaylistName] = useState('')
  const [rename, setRename] = useState(selected?.name ?? '')
  const ready = library.status === 'ready'
  const hasLast = Boolean(library.lastTrackIds.A || library.lastTrackIds.B)

  useEffect(() => {
    setRename(selected?.name ?? '')
  }, [selected?.id, selected?.name])

  const onCreate = (event: FormEvent) => {
    event.preventDefault()
    void createPlaylist(playlistName).then((created) => {
      if (created) setPlaylistName('')
    })
  }

  return (
    <section id="library-panel" className="library-panel" hidden={!library.open} aria-labelledby="library-title">
      <div className="control-head">
        <h2 id="library-title">{copy.library.title}</h2>
        <button type="button" onClick={() => toggleLibrary(false)}>
          {copy.library.close}
        </button>
      </div>
      <p className="hint">{copy.library.help}</p>
      <p className="library-meta" role="status">
        {storageSummary(library.tracks, library.status)}
      </p>
      {library.error ? (
        <p className="deck-error" role="alert">
          {library.error}
        </p>
      ) : null}
      {library.notice ? (
        <p className="deck-error" role="status">
          {library.notice}
        </p>
      ) : null}

      <div className="library-actions">
        <label className="file-button">
          {copy.library.import}
          <input
            type="file"
            multiple
            accept="audio/mpeg,audio/mp3,.mp3,audio/*,.wav,.m4a,.aac,.flac,.ogg,.opus"
            disabled={!ready}
            onChange={(event) => {
              const files = [...(event.currentTarget.files ?? [])]
              event.currentTarget.value = ''
              if (files.length === 0) return
              unlockAudio()
              void importFiles(files)
            }}
          />
        </label>
        <button
          type="button"
          disabled={!ready || !hasLast}
          onClick={() => {
            unlockAudio()
            void restoreLastTracks()
          }}
        >
          {copy.library.restore}
        </button>
        <button
          type="button"
          disabled={!ready || (library.tracks.length === 0 && library.playlists.length === 0)}
          onClick={() => {
            if (!window.confirm(copy.library.clearConfirm)) return
            void clearLibrary()
          }}
        >
          {copy.library.clear}
        </button>
      </div>
      <p className="hint">{copy.library.restoreHelp}</p>

      <div className="library-form">
        <label>
          {copy.library.search}
          <input
            type="search"
            value={library.query}
            onChange={(event) => setLibraryQuery(event.currentTarget.value)}
          />
        </label>
        <label>
          {copy.library.sort}
          <select
            value={library.sort}
            disabled={selected !== null}
            onChange={(event) => setLibrarySort(event.currentTarget.value as LibrarySort)}
          >
            {SORTS.map((sort) => (
              <option key={sort} value={sort}>
                {copy.library.sorts[sort]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={selected !== null}
          aria-label={copy.library.direction}
          onClick={() => setLibrarySort(library.sort, library.sortDir === 'asc' ? 'desc' : 'asc')}
        >
          {library.sortDir === 'asc' ? copy.library.ascending : copy.library.descending}
        </button>
      </div>

      <form className="library-form" onSubmit={onCreate}>
        <label>
          {copy.library.playlist}
          <select
            value={library.playlistId ?? ''}
            onChange={(event) => setLibraryPlaylist(event.currentTarget.value || null)}
          >
            <option value="">{copy.library.allTracks}</option>
            {library.playlists.map((playlist) => (
              <option key={playlist.id} value={playlist.id}>
                {playlist.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {copy.library.newPlaylist}
          <input value={playlistName} onChange={(event) => setPlaylistName(event.currentTarget.value)} />
        </label>
        <button type="submit" disabled={!ready}>
          {copy.library.create}
        </button>
      </form>

      {selected ? (
        <form
          className="library-form"
          onSubmit={(event) => {
            event.preventDefault()
            void renamePlaylist(selected.id, rename)
          }}
        >
          <label>
            {copy.library.renameLabel}
            <input value={rename} onChange={(event) => setRename(event.currentTarget.value)} />
          </label>
          <button type="submit">{copy.library.rename}</button>
          <button type="button" onClick={() => void deletePlaylist(selected.id)}>
            {copy.library.deletePlaylist}
          </button>
        </form>
      ) : null}
      {selected ? <p className="hint">{copy.library.playlistOrder}</p> : null}

      {!selected && library.tracks.length === 0 ? <p className="library-meta">{copy.library.empty}</p> : null}
      {selected && visible.length === 0 && !library.query.trim() ? (
        <p className="library-meta">{copy.library.emptyPlaylist}</p>
      ) : null}
      {visible.length === 0 && library.query.trim() ? <p className="library-meta">{copy.library.noMatches}</p> : null}

      <ul className="library-list">
        {visible.map((track) => {
          const playlistIndex = selected ? selected.trackIds.indexOf(track.id) : -1
          const bpm = bpmLine(track)
          return (
            <li key={track.id} className="library-item">
              <div>
                <p className="track-name">{track.title?.trim() || track.fileName}</p>
                <p className="library-meta">
                  {track.fileName} · {formatTime(track.durationSec)} · {formatBytes(track.byteSize)} ·{' '}
                  {track.storage === 'opfs' ? copy.library.storedOpfs : copy.library.storedIdb}
                </p>
                {track.artist?.trim() ? <p className="library-meta">{track.artist}</p> : null}
                {track.album?.trim() ? <p className="library-meta">{track.album}</p> : null}
                {track.genre?.trim() ? <p className="library-meta">{track.genre}</p> : null}
                <p className="library-meta">{bpm ?? copy.bpmMissing}</p>
              </div>
              <div className="library-actions">
                <button
                  type="button"
                  onClick={() => {
                    unlockAudio()
                    void loadLibraryTrack('A', track.id)
                  }}
                >
                  {copy.library.loadA}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    unlockAudio()
                    void loadLibraryTrack('B', track.id)
                  }}
                >
                  {copy.library.loadB}
                </button>
                {selected ? (
                  <>
                    <button type="button" disabled={playlistIndex <= 0} onClick={() => void moveInPlaylist(selected.id, playlistIndex, -1)}>
                      {copy.library.up}
                    </button>
                    <button
                      type="button"
                      disabled={playlistIndex < 0 || playlistIndex >= selected.trackIds.length - 1}
                      onClick={() => void moveInPlaylist(selected.id, playlistIndex, 1)}
                    >
                      {copy.library.down}
                    </button>
                    <button type="button" onClick={() => void removeFromPlaylist(selected.id, track.id)}>
                      {copy.library.remove}
                    </button>
                  </>
                ) : null}
                <button type="button" onClick={() => void removeLibraryTrack(track.id)}>
                  {copy.library.deleteTrack}
                </button>
              </div>
            </li>
          )
        })}
      </ul>
      {selected && library.tracks.some((track) => !selected.trackIds.includes(track.id)) ? (
        <>
          <h3 className="library-subhead">{copy.library.add}</h3>
          {available.length === 0 ? <p className="library-meta">{copy.library.noMatches}</p> : null}
          <ul className="library-list">
            {available.map((track) => (
              <li key={track.id} className="library-item">
                <p className="track-name">{track.title?.trim() || track.fileName}</p>
                <div className="library-actions">
                  <button type="button" onClick={() => void addToPlaylist(selected.id, track.id)}>
                    {copy.library.add}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  )
}
