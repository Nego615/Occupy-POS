import type { SupabaseClient } from '@supabase/supabase-js';
import { SCHEMA_VERSION, VERSION_KEY, indexedDbRepository, type PosRepository, type Snapshot } from './persist';

const TABLE = 'pos_state';
const RETRY_MS = 30_000;

/** Slice keys saved on this device that haven't reached Supabase yet. Survives reloads. */
const PENDING_KEY = 'occupy-pos:unsynced';
/** Which shop's data this browser's IndexedDB holds, so a different login never sees it. */
const OWNER_KEY = 'occupy-pos:store';

function readList(key: string): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function readString(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage blocked — sync still works for this session, it just won't remember across reloads.
  }
}

/** How many saved slices are still waiting to upload. */
export function unsyncedCount(): number {
  return readList(PENDING_KEY).length;
}

/**
 * Saves to `local` first, so the till keeps working with no connection, then
 * uploads to Supabase in the background. Failed uploads are retried every
 * 30 seconds and whenever the browser comes back online. Last write wins, so
 * two tills editing the same slice will overwrite each other.
 */
export function cloudRepository(client: SupabaseClient, storeId: string, local: PosRepository): PosRepository {
  const pending = new Set(readList(PENDING_KEY));
  /** The newest value of each pending slice. */
  const latest = new Map<string, unknown>();
  let running = false;
  let again = false;
  let retry: number | undefined;

  const remember = () => write(PENDING_KEY, JSON.stringify([...pending]));

  async function flush() {
    if (running) {
      again = true;
      return;
    }
    running = true;
    window.clearTimeout(retry);
    try {
      do {
        again = false;
        const batch = [...pending].filter((k) => latest.has(k)).map((k) => [k, latest.get(k)] as const);
        if (batch.length === 0) break;
        const updatedAt = new Date().toISOString();
        const rows = [...batch, [VERSION_KEY, SCHEMA_VERSION] as const].map(([key, value]) => ({
          store_id: storeId,
          key,
          value,
          updated_at: updatedAt,
        }));
        const { error } = await client.from(TABLE).upsert(rows, { onConflict: 'store_id,key' });
        if (error) throw error;
        // A slice that changed again while uploading stays pending for the next pass.
        for (const [key, value] of batch) {
          if (latest.get(key) === value) {
            pending.delete(key);
            latest.delete(key);
          }
        }
        remember();
      } while (again || pending.size > 0);
    } catch (err) {
      console.warn('Cloud sync failed; will retry.', err);
      retry = window.setTimeout(flush, RETRY_MS);
    } finally {
      running = false;
    }
  }

  window.addEventListener('online', () => void flush());

  return {
    async load() {
      const owner = readString(OWNER_KEY);
      if (owner !== null && owner !== storeId) {
        // Another shop's data is on this device — start clean. (An unlinked
        // device keeps its data, which is uploaded as this shop's.)
        await local.clear().catch(() => undefined);
        pending.clear();
        remember();
      }
      write(OWNER_KEY, storeId);
      const localSnap = await local.load().catch((): Snapshot => ({}));
      for (const key of pending) if (key in localSnap) latest.set(key, localSnap[key]);

      let remote: Snapshot;
      try {
        const { data, error } = await client.from(TABLE).select('key, value').eq('store_id', storeId);
        if (error) throw error;
        remote = Object.fromEntries(data.map((row) => [row.key as string, row.value as unknown]));
      } catch (err) {
        console.warn('Cloud unavailable, starting from this device’s copy.', err);
        return localSnap;
      }

      // Nothing in the cloud yet (or an outdated shape): this device's copy
      // becomes the cloud copy as the store writes each slice on first render.
      if (remote[VERSION_KEY] !== SCHEMA_VERSION) return localSnap;
      delete remote[VERSION_KEY];
      // Edits made offline that never uploaded are newer than the cloud.
      for (const key of pending) if (key in localSnap) remote[key] = localSnap[key];
      void flush();
      return remote;
    },

    async save(key, value) {
      latest.set(key, value);
      pending.add(key);
      remember();
      await local.save(key, value);
      void flush();
    },

    async clear() {
      const { error } = await client.from(TABLE).delete().eq('store_id', storeId);
      if (error) throw error;
      pending.clear();
      latest.clear();
      remember();
      await local.clear();
    },
  };
}

/** Unlinks this device from its shop and wipes the local copy. */
export async function signOutDevice(client: SupabaseClient): Promise<void> {
  await client.auth.signOut();
  await indexedDbRepository().clear().catch(() => undefined);
  write(PENDING_KEY, null);
  write(OWNER_KEY, null);
}
