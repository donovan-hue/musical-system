import type { LibraryTrack, PersistedSettings, Playlist, StorageKind } from './types'

const DB_NAME = 'musical-system'
const DB_VERSION = 1

type DbStores = {
  tracks: LibraryTrack
  playlists: Playlist
  settings: PersistedSettings
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('indexedDB missing'))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('tracks')) db.createObjectStore('tracks', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('playlists')) db.createObjectStore('playlists', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('indexedDB open failed'))
  })
}

function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('indexedDB transaction failed'))
    transaction.onabort = () => reject(transaction.error ?? new Error('indexedDB transaction aborted'))
  })
}

function requestOf<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('indexedDB request failed'))
  })
}

async function getAll<K extends keyof DbStores>(storeName: K): Promise<DbStores[K][]> {
  const db = await openDb()
  const transaction = db.transaction(storeName, 'readonly')
  const rows = await requestOf(transaction.objectStore(storeName).getAll() as IDBRequest<DbStores[K][]>)
  await done(transaction)
  return rows
}

async function putRow<K extends keyof DbStores>(storeName: K, value: DbStores[K]): Promise<void> {
  const db = await openDb()
  const transaction = db.transaction(storeName, 'readwrite')
  transaction.objectStore(storeName).put(value)
  await done(transaction)
}

async function deleteRow(storeName: 'tracks' | 'playlists', id: string): Promise<void> {
  const db = await openDb()
  const transaction = db.transaction(storeName, 'readwrite')
  transaction.objectStore(storeName).delete(id)
  await done(transaction)
}

export function canUseOpfs(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function'
}

async function tracksDir(create: boolean): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle('tracks', { create })
}

async function writeOpfs(id: string, bytes: ArrayBuffer): Promise<void> {
  const dir = await tracksDir(true)
  const handle = await dir.getFileHandle(`${id}.audio`, { create: true })
  const writable = await handle.createWritable()
  await writable.write(bytes.slice(0))
  await writable.close()
}

async function readOpfs(id: string): Promise<ArrayBuffer> {
  const dir = await tracksDir(false)
  const handle = await dir.getFileHandle(`${id}.audio`)
  const file = await handle.getFile()
  return file.arrayBuffer()
}

async function deleteOpfs(id: string): Promise<void> {
  const dir = await tracksDir(false)
  await dir.removeEntry(`${id}.audio`)
}

async function writeIdbBlob(id: string, bytes: ArrayBuffer): Promise<void> {
  const db = await openDb()
  const transaction = db.transaction('blobs', 'readwrite')
  transaction.objectStore('blobs').put(bytes.slice(0), id)
  await done(transaction)
}

async function readIdbBlob(id: string): Promise<ArrayBuffer> {
  const db = await openDb()
  const transaction = db.transaction('blobs', 'readonly')
  const result = await requestOf(transaction.objectStore('blobs').get(id) as IDBRequest<unknown>)
  await done(transaction)
  if (result instanceof ArrayBuffer) return result
  if (result instanceof Blob) return result.arrayBuffer()
  throw new Error('missing blob')
}

async function deleteIdbBlob(id: string): Promise<void> {
  const db = await openDb()
  const transaction = db.transaction('blobs', 'readwrite')
  transaction.objectStore('blobs').delete(id)
  await done(transaction)
}

export async function hasRoomFor(bytes: number): Promise<boolean> {
  if (!navigator.storage?.estimate) return true
  const estimate = await navigator.storage.estimate()
  if (estimate.quota == null || estimate.usage == null) return true
  return estimate.quota - estimate.usage > bytes + 1024 * 1024
}

export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false
  try {
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

export async function loadLibraryRecords(): Promise<{
  tracks: LibraryTrack[]
  playlists: Playlist[]
  settings: PersistedSettings | null
}> {
  const [tracks, playlists, settingsRows] = await Promise.all([
    getAll('tracks'),
    getAll('playlists'),
    getAll('settings'),
  ])
  return {
    tracks,
    playlists,
    settings: settingsRows.find((row) => row.id === 'mixer') ?? null,
  }
}

export async function saveTrack(track: LibraryTrack, bytes: ArrayBuffer): Promise<LibraryTrack> {
  let storage: StorageKind = 'idb'
  if (canUseOpfs()) {
    try {
      await writeOpfs(track.id, bytes)
      storage = 'opfs'
    } catch {
      await writeIdbBlob(track.id, bytes)
      storage = 'idb'
    }
  } else {
    await writeIdbBlob(track.id, bytes)
  }
  const saved = { ...track, storage }
  try {
    await putRow('tracks', saved)
  } catch (error) {
    try {
      if (storage === 'opfs') await deleteOpfs(track.id)
      else await deleteIdbBlob(track.id)
    } catch {
      // The metadata write already failed. Leave the quota error as the result.
    }
    throw error
  }
  return saved
}

export async function saveTrackMeta(track: LibraryTrack): Promise<void> {
  await putRow('tracks', track)
}

export async function readTrackBytes(track: LibraryTrack): Promise<ArrayBuffer> {
  if (track.storage === 'opfs') return readOpfs(track.id)
  return readIdbBlob(track.id)
}

export async function deleteTrackStorage(track: LibraryTrack): Promise<void> {
  await deleteRow('tracks', track.id)
  try {
    if (track.storage === 'opfs') await deleteOpfs(track.id)
    else await deleteIdbBlob(track.id)
  } catch {
    // The metadata is already gone. A missing blob is not a second copy of the track.
  }
}

export async function savePlaylist(playlist: Playlist): Promise<void> {
  await putRow('playlists', playlist)
}

export async function deletePlaylistStorage(id: string): Promise<void> {
  await deleteRow('playlists', id)
}

export async function saveSettings(settings: PersistedSettings): Promise<void> {
  await putRow('settings', settings)
}
