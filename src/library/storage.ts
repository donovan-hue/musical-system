/**
 * Byte + metadata storage. Primary backend is the Origin Private File System
 * (OPFS); if the browser lacks it we fall back to IndexedDB; headless/test
 * environments get an in-memory store with the same interface.
 */
export interface TrackStore {
  readonly kind: 'opfs' | 'indexeddb' | 'memory';
  putBytes(id: string, bytes: Uint8Array): Promise<void>;
  getBytes(id: string): Promise<Uint8Array | null>;
  deleteBytes(id: string): Promise<void>;
  putJson(key: string, value: unknown): Promise<void>;
  getJson<T>(key: string): Promise<T | null>;
}

const BYTES_DIR = 'tracks';
const META_DIR = 'meta';

// ---------- OPFS ----------

class OpfsStore implements TrackStore {
  readonly kind = 'opfs' as const;

  constructor(private readonly root: FileSystemDirectoryHandle) {}

  private async bytesDir(): Promise<FileSystemDirectoryHandle> {
    return this.root.getDirectoryHandle(BYTES_DIR, { create: true });
  }

  private async metaDir(): Promise<FileSystemDirectoryHandle> {
    return this.root.getDirectoryHandle(META_DIR, { create: true });
  }

  async putBytes(id: string, bytes: Uint8Array): Promise<void> {
    const dir = await this.bytesDir();
    const handle = await dir.getFileHandle(id, { create: true });
    const writable = await handle.createWritable();
    try {
      await writable.write(bytes as unknown as BufferSource);
    } finally {
      await writable.close();
    }
  }

  async getBytes(id: string): Promise<Uint8Array | null> {
    try {
      const dir = await this.bytesDir();
      const handle = await dir.getFileHandle(id);
      const file = await handle.getFile();
      return new Uint8Array(await file.arrayBuffer());
    } catch {
      return null;
    }
  }

  async deleteBytes(id: string): Promise<void> {
    try {
      const dir = await this.bytesDir();
      await dir.removeEntry(id);
    } catch {
      /* already gone */
    }
  }

  async putJson(key: string, value: unknown): Promise<void> {
    const dir = await this.metaDir();
    const handle = await dir.getFileHandle(`${key}.json`, { create: true });
    const writable = await handle.createWritable();
    try {
      await writable.write(JSON.stringify(value));
    } finally {
      await writable.close();
    }
  }

  async getJson<T>(key: string): Promise<T | null> {
    try {
      const dir = await this.metaDir();
      const handle = await dir.getFileHandle(`${key}.json`);
      const file = await handle.getFile();
      const text = await file.text();
      return text.length === 0 ? null : (JSON.parse(text) as T);
    } catch {
      return null;
    }
  }
}

// ---------- IndexedDB ----------

class IdbStore implements TrackStore {
  readonly kind = 'indexeddb' as const;

  constructor(private readonly db: IDBDatabase) {}

  private tx<T>(store: string, mode: IDBTransactionMode, run: (os: IDBObjectStore) => IDBRequest): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const tx = this.db.transaction(store, mode);
      const request = run(tx.objectStore(store));
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error);
    });
  }

  putBytes(id: string, bytes: Uint8Array): Promise<void> {
    return this.tx('bytes', 'readwrite', (os) => os.put(bytes as unknown as BufferSource, id)).then(() => undefined);
  }

  async getBytes(id: string): Promise<Uint8Array | null> {
    const result = await this.tx<Uint8Array | undefined>('bytes', 'readonly', (os) => os.get(id));
    return result ?? null;
  }

  deleteBytes(id: string): Promise<void> {
    return this.tx('bytes', 'readwrite', (os) => os.delete(id)).then(() => undefined);
  }

  putJson(key: string, value: unknown): Promise<void> {
    return this.tx('meta', 'readwrite', (os) => os.put(value, key)).then(() => undefined);
  }

  async getJson<T>(key: string): Promise<T | null> {
    const result = await this.tx<T | undefined>('meta', 'readonly', (os) => os.get(key));
    return result ?? null;
  }
}

// ---------- Memory (tests / degraded browsers) ----------

export class MemoryStore implements TrackStore {
  readonly kind = 'memory' as const;
  private readonly bytes = new Map<string, Uint8Array>();
  private readonly meta = new Map<string, unknown>();

  async putBytes(id: string, bytes: Uint8Array): Promise<void> {
    this.bytes.set(id, bytes.slice());
  }

  async getBytes(id: string): Promise<Uint8Array | null> {
    return this.bytes.get(id) ?? null;
  }

  async deleteBytes(id: string): Promise<void> {
    this.bytes.delete(id);
  }

  async putJson(key: string, value: unknown): Promise<void> {
    this.meta.set(key, structuredClone(value));
  }

  async getJson<T>(key: string): Promise<T | null> {
    const value = this.meta.get(key);
    return value === undefined ? null : (structuredClone(value) as T);
  }
}

// ---------- Factory ----------

function openIndexedDb(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('bytes')) db.createObjectStore('bytes');
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Pick the best available backend: OPFS first, then IndexedDB. Never throws —
 * degrades to memory (callers can inspect `.kind` to warn the user).
 */
export async function createTrackStore(): Promise<TrackStore> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.getDirectory) {
      const root = await navigator.storage.getDirectory();
      return new OpfsStore(root);
    }
  } catch {
    /* fall through */
  }
  try {
    if (typeof indexedDB !== 'undefined') {
      const db = await openIndexedDb('musical-system');
      return new IdbStore(db);
    }
  } catch {
    /* fall through */
  }
  return new MemoryStore();
}
