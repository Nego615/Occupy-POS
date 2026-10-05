import type { RemoteChange } from './records';

/**
 * Where the store's state lives between sessions. The provider only knows
 * this interface, so a server-backed repository can replace the IndexedDB one
 * without the store changing shape.
 */
export interface PosRepository {
  /** Everything saved, by slice key. Empty on first run. */
  load(): Promise<Snapshot>;
  save(key: string, value: unknown): Promise<void>;
  /** Forgets everything — the next load starts from seed data. */
  clear(): Promise<void>;
  /** Changes other devices make, as they arrive. Returns an unsubscribe. Only when shared. */
  subscribe?(listener: (change: RemoteChange) => void): () => void;
  /**
   * A number for `counter` (order numbers, ticket numbers…) that no other
   * device will hand out, at least `floor`. Only when shared.
   */
  nextId?(counter: string, floor: number): number;
}

/** Saved slices by key. A missing key means "use the seed". */
export type Snapshot = Partial<Record<string, unknown>>;

/** Bumped when a saved shape changes incompatibly; older saves are then ignored. */
export const SCHEMA_VERSION = 2;
export const VERSION_KEY = '__version';

const DB_NAME = 'occupy-pos';
const STORE = 'state';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function indexedDbRepository(): PosRepository {
  let db: Promise<IDBDatabase> | null = null;
  const connect = () => (db ??= openDb());

  return {
    async load() {
      const conn = await connect();
      const tx = conn.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      const snapshot: Snapshot = {};
      await new Promise<void>((resolve, reject) => {
        const cursor = store.openCursor();
        cursor.onsuccess = () => {
          const c = cursor.result;
          if (!c) return resolve();
          snapshot[String(c.key)] = c.value;
          c.continue();
        };
        cursor.onerror = () => reject(cursor.error);
      });
      if (snapshot[VERSION_KEY] !== SCHEMA_VERSION) return {};
      delete snapshot[VERSION_KEY];
      return snapshot;
    },
    async save(key, value) {
      const conn = await connect();
      const tx = conn.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      store.put(value, key);
      store.put(SCHEMA_VERSION, VERSION_KEY);
      await done(tx);
    },
    async clear() {
      const conn = await connect();
      const tx = conn.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      await done(tx);
    },
  };
}

/** For environments without IndexedDB (tests, private modes that block it). */
export function memoryRepository(initial: Snapshot = {}): PosRepository {
  const data: Snapshot = { ...initial };
  return {
    load: async () => ({ ...data }),
    save: async (key, value) => {
      data[key] = value;
    },
    clear: async () => {
      for (const key of Object.keys(data)) delete data[key];
    },
  };
}

/**
 * IndexedDB when the browser has it, memory otherwise — wrapped by `cloud`
 * (e.g. Supabase sync) when given. Never throws.
 */
export async function openRepository(
  cloud?: (local: PosRepository) => PosRepository,
): Promise<{ repo: PosRepository; snapshot: Snapshot }> {
  if (typeof indexedDB !== 'undefined') {
    try {
      const local = indexedDbRepository();
      const repo = cloud ? cloud(local) : local;
      return { repo, snapshot: await repo.load() };
    } catch (err) {
      console.warn('Saved data unavailable, running in memory only.', err);
    }
  }
  return { repo: memoryRepository(), snapshot: {} };
}
