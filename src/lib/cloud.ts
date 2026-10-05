import type { SupabaseClient } from '@supabase/supabase-js';
import { SCHEMA_VERSION, VERSION_KEY, indexedDbRepository, type PosRepository, type Snapshot } from './persist';
import {
  COUNTERS,
  SLICES,
  applyChange,
  recordsOf,
  stableJson,
  type RemoteChange,
} from './records';

const RECORDS = 'pos_records';
/** The whole-slice table synced before records — read once to carry a shop over. */
const LEGACY = 'pos_state';
const PAGE = 1000;
const UPLOAD_BATCH = 500;
const RETRY_MS = 15_000;
/** How often to look for changes realtime might have missed (a sleeping tablet, a dropped socket). */
const CATCH_UP_MS = 60_000;
/** Numbers reserved per trip to the shared counter. */
const ID_BLOCK = 10;

/** Record changes not yet uploaded. Survives reloads, so offline sales aren't lost. */
const QUEUE_KEY = 'occupy-pos:queue';
/** Numbers this device has reserved but not used yet. */
const IDS_KEY = 'occupy-pos:ids';
/** The newest server change this device has seen, to catch up from after being offline. */
const SEEN_KEY = 'occupy-pos:seen';
/** Which shop's data this browser's IndexedDB holds, so a different login never sees it. */
const OWNER_KEY = 'occupy-pos:store';
/** Left by the whole-slice sync; cleared on the way. */
const OLD_PENDING_KEY = 'occupy-pos:unsynced';

type Row = {
  collection: string;
  id: string;
  value: unknown;
  deleted: boolean;
  updated_at: string;
};
type Pending = { collection: string; id: string; value: unknown; deleted: boolean };
type Known = { ref: unknown; json: string };

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
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

/** A Postgres timestamp as microseconds, so writes in the same millisecond still order. */
function micros(ts: string): number {
  const m = /^(.*?)(?:\.(\d+))?(Z|[+-]\d\d:?\d\d)?$/.exec(ts.replace(' ', 'T'));
  if (!m) return 0;
  const zone = m[3] && m[3] !== 'Z' && !m[3].includes(':') ? `${m[3].slice(0, 3)}:${m[3].slice(3)}` : m[3];
  return Date.parse(m[1] + (zone ?? 'Z')) * 1000 + Number((m[2] ?? '').padEnd(6, '0').slice(0, 6));
}

const recordKey = (collection: string, id: string) => `${collection}/${id}`;

/** How many record changes are still waiting to upload. */
export function unsyncedCount(): number {
  return Object.keys(readJson<Record<string, Pending>>(QUEUE_KEY, {})).length;
}

/**
 * Shares the shop between every device signed in to it. Each record (an
 * order, a tab, a menu item, a shift…) is its own row, so screens editing
 * different records never overwrite each other, and changes from other
 * devices arrive live through Supabase Realtime.
 *
 * Saves land in `local` first, so a till keeps working offline; record
 * changes queue up and upload when the connection is back. Two devices
 * editing the same record at once: the later write wins.
 */
export function cloudRepository(client: SupabaseClient, storeId: string, local: PosRepository): PosRepository {
  /** What the server has (or will have once the queue drains), per slice and record id. */
  const known = new Map<string, Map<string, Known>>();
  /** Server timestamp of each record's newest version seen, to drop stale echoes. */
  const versions = new Map<string, number>();
  const queue = new Map<string, Pending>(Object.entries(readJson<Record<string, Pending>>(QUEUE_KEY, {})));
  const pools: Record<string, number[]> = readJson(IDS_KEY, {});
  const refilling = new Set<string>();
  const listeners = new Set<(change: RemoteChange) => void>();
  let seen = readJson<string | null>(SEEN_KEY, null);
  let uploading = false;
  let again = false;
  let retry: number | undefined;

  const saveQueue = () => write(QUEUE_KEY, JSON.stringify(Object.fromEntries(queue)));
  const savePools = () => write(IDS_KEY, JSON.stringify(pools));
  const markSeen = (ts: string) => {
    if (seen === null || micros(ts) > micros(seen)) {
      seen = ts;
      write(SEEN_KEY, JSON.stringify(ts));
    }
  };

  function enqueue(changes: Pending[]) {
    for (const c of changes) {
      const rk = recordKey(c.collection, c.id);
      // Re-queued at the back, so uploads keep the order changes were made in.
      queue.delete(rk);
      queue.set(rk, c);
    }
    saveQueue();
    void upload();
  }

  async function upload() {
    if (uploading) {
      again = true;
      return;
    }
    uploading = true;
    window.clearTimeout(retry);
    try {
      do {
        again = false;
        const batch = [...queue.entries()].slice(0, UPLOAD_BATCH);
        if (batch.length === 0) break;
        const rows = batch.map(([, c]) => ({ store_id: storeId, ...c }));
        const { data, error } = await client
          .from(RECORDS)
          .upsert(rows, { onConflict: 'store_id,collection,id' })
          .select('collection, id, updated_at');
        if (error) throw error;
        for (const row of data as Pick<Row, 'collection' | 'id' | 'updated_at'>[]) {
          versions.set(recordKey(row.collection, row.id), micros(row.updated_at));
        }
        // A record changed again while uploading stays queued for the next pass.
        for (const [rk, sent] of batch) if (queue.get(rk) === sent) queue.delete(rk);
        saveQueue();
      } while (again || queue.size > 0);
    } catch (err) {
      console.warn('Cloud sync failed; will retry.', err);
      retry = window.setTimeout(() => void upload(), RETRY_MS);
    } finally {
      uploading = false;
    }
  }

  /** A row from another device (or our own, echoed back). */
  function receive(row: Row) {
    markSeen(row.updated_at);
    const rk = recordKey(row.collection, row.id);
    const at = micros(row.updated_at);
    // This device has a newer edit on its way up.
    if (queue.has(rk)) return;
    if ((versions.get(rk) ?? -1) >= at) return;
    versions.set(rk, at);
    if (!SLICES[row.collection]) return;

    const slice = known.get(row.collection) ?? new Map<string, Known>();
    known.set(row.collection, slice);
    if (row.deleted) {
      if (!slice.delete(row.id)) return;
    } else {
      const json = stableJson(row.value);
      if (slice.get(row.id)?.json === json) return;
      slice.set(row.id, { ref: row.value, json });
    }
    const change: RemoteChange = { key: row.collection, id: row.id, value: row.value, deleted: row.deleted };
    for (const listener of listeners) listener(change);

    // The shop was reset on another screen: start over here too.
    if (row.collection === 'staff' && row.deleted && slice.size === 0) window.location.reload();
  }

  async function fetchRows(since: string | null): Promise<Row[]> {
    const rows: Row[] = [];
    for (let from = 0; ; from += PAGE) {
      let query = client
        .from(RECORDS)
        .select('collection, id, value, deleted, updated_at')
        .eq('store_id', storeId);
      query = since === null ? query.order('seq') : query.gt('updated_at', since).order('updated_at');
      const { data, error } = await query.range(from, from + PAGE - 1);
      if (error) throw error;
      rows.push(...(data as Row[]));
      if (data.length < PAGE) return rows;
    }
  }

  let catchingUp = false;
  async function catchUp() {
    if (catchingUp || seen === null) return;
    catchingUp = true;
    try {
      for (const row of await fetchRows(seen)) receive(row);
    } catch (err) {
      console.warn('Couldn’t check for changes from other screens.', err);
    } finally {
      catchingUp = false;
    }
  }

  function listen() {
    client
      .channel(`pos-${storeId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: RECORDS, filter: `store_id=eq.${storeId}` },
        (payload) => {
          if (payload.new && 'collection' in payload.new) receive(payload.new as Row);
        },
      )
      // Also fires on reconnect — pick up whatever changed while the socket was down.
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') void catchUp();
      });
    window.addEventListener('online', () => {
      void upload();
      void catchUp();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void catchUp();
    });
    window.setInterval(() => void catchUp(), CATCH_UP_MS);
  }

  async function refill(counter: string, floor: number) {
    if (refilling.has(counter)) return;
    refilling.add(counter);
    try {
      const { data, error } = await client.rpc('reserve_ids', {
        counter,
        how_many: ID_BLOCK,
        floor,
      });
      if (error) throw error;
      const start = Number(data);
      pools[counter] = [...(pools[counter] ?? []), ...Array.from({ length: ID_BLOCK }, (_, i) => start + i)];
      savePools();
    } catch (err) {
      console.warn(`Couldn’t reserve ${counter} numbers.`, err);
    } finally {
      refilling.delete(counter);
    }
  }

  /** Records as the server has them, so the first save after load uploads only real changes. */
  function remember(snapshot: Snapshot) {
    for (const [key, spec] of Object.entries(SLICES)) {
      if (!(key in snapshot)) continue;
      const slice = new Map<string, Known>();
      for (const [id, ref] of recordsOf(spec, snapshot[key])) slice.set(id, { ref, json: stableJson(ref) });
      known.set(key, slice);
    }
  }

  return {
    async load() {
      write(OLD_PENDING_KEY, null);
      const owner = readJson<string | null>(OWNER_KEY, null);
      if (owner !== null && owner !== storeId) {
        // Another shop's data is on this device — start clean. (An unlinked
        // device keeps its data, which is uploaded as this shop's.)
        await local.clear().catch(() => undefined);
        queue.clear();
        saveQueue();
        for (const k of Object.keys(pools)) delete pools[k];
        savePools();
        seen = null;
        write(SEEN_KEY, null);
      }
      write(OWNER_KEY, JSON.stringify(storeId));
      const localSnap = await local.load().catch((): Snapshot => ({}));

      let rows: Row[];
      try {
        rows = await fetchRows(null);
      } catch (err) {
        console.warn('Cloud unavailable, starting from this device’s copy.', err);
        // The local copy already includes this device's queued edits.
        remember(localSnap);
        listen();
        return localSnap;
      }

      let snapshot: Snapshot;
      if (rows.length === 0) {
        // A shop that has never synced records: carry over the old whole-slice
        // copy if there is one, else this device's. Nothing is remembered as
        // uploaded, so the first save sends every record.
        snapshot = localSnap;
        try {
          const { data } = await client.from(LEGACY).select('key, value').eq('store_id', storeId);
          const legacy = Object.fromEntries((data ?? []).map((r) => [r.key as string, r.value as unknown]));
          if (legacy[VERSION_KEY] === SCHEMA_VERSION) {
            delete legacy[VERSION_KEY];
            snapshot = { ...legacy, activeTab: localSnap.activeTab };
          }
        } catch {
          // No legacy table — fine.
        }
      } else {
        snapshot = { activeTab: localSnap.activeTab };
        const lists = new Map<string, unknown[]>();
        for (const row of rows) {
          markSeen(row.updated_at);
          versions.set(recordKey(row.collection, row.id), micros(row.updated_at));
          const spec = SLICES[row.collection];
          if (row.deleted || !spec) continue;
          if (spec.kind === 'single') snapshot[row.collection] = row.value;
          else lists.set(row.collection, [...(lists.get(row.collection) ?? []), row.value]);
        }
        for (const [key, spec] of Object.entries(SLICES)) {
          if (spec.kind !== 'list') continue;
          // Rows come oldest first; lists that keep the newest first are flipped.
          const records = lists.get(key) ?? [];
          snapshot[key] = spec.newest === 'first' ? records.reverse() : records;
        }
        remember(snapshot);
        // Edits made here offline that never uploaded are newer than the server's.
        for (const c of queue.values()) {
          snapshot[c.collection] = applyChange(snapshot[c.collection], {
            key: c.collection,
            id: c.id,
            value: c.value,
            deleted: c.deleted,
          });
        }
        // A shop with every record deleted (reset) starts at owner setup.
        if (!rows.some((r) => r.collection === 'staff' && !r.deleted)) delete snapshot.staff;
      }

      await Promise.all(
        Object.entries(COUNTERS).map(([counter, floorOf]) =>
          (pools[counter]?.length ?? 0) < 3 ? refill(counter, floorOf(snapshot)) : undefined,
        ),
      );
      listen();
      void upload();
      return snapshot;
    },

    async save(key, value) {
      await local.save(key, value);
      const spec = SLICES[key];
      if (!spec) return;
      const slice = known.get(key) ?? new Map<string, Known>();
      known.set(key, slice);
      const next = recordsOf(spec, value);
      const changes: Pending[] = [];
      for (const [id, ref] of next) {
        const before = slice.get(id);
        if (before?.ref === ref) continue;
        const json = stableJson(ref);
        slice.set(id, { ref, json });
        if (before?.json !== json) changes.push({ collection: key, id, value: ref, deleted: false });
      }
      for (const id of [...slice.keys()]) {
        if (next.has(id)) continue;
        slice.delete(id);
        changes.push({ collection: key, id, value: null, deleted: true });
      }
      // Newest-first lists are walked newest first; upload oldest first so
      // other screens add them in the right order.
      if (spec.kind === 'list' && spec.newest === 'first') changes.reverse();
      if (changes.length > 0) enqueue(changes);
    },

    async clear() {
      // Marked deleted rather than removed, so every other screen hears about it.
      const { error } = await client
        .from(RECORDS)
        .update({ deleted: true, value: null })
        .eq('store_id', storeId)
        .eq('deleted', false);
      if (error) throw error;
      // Counters carry on, so numbers other screens already reserved can't repeat.
      await client.from(LEGACY).delete().eq('store_id', storeId);
      queue.clear();
      saveQueue();
      for (const k of Object.keys(pools)) delete pools[k];
      savePools();
      await local.clear();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    nextId(counter, floor) {
      // Reserved numbers are this device's alone, so they're used even when
      // another screen has since gone higher — order numbers interleave by block.
      const pool = pools[counter] ?? [];
      const id = pool.shift();
      pools[counter] = pool;
      savePools();
      if (pool.length < 3) void refill(counter, Math.max(floor, (id ?? floor) + 1));
      // Offline with nothing reserved: the next free number here. Only then can two tills clash.
      return id ?? floor;
    },
  };
}

/** Unlinks this device from its shop and wipes the local copy. */
export async function signOutDevice(client: SupabaseClient): Promise<void> {
  await client.auth.signOut();
  await indexedDbRepository().clear().catch(() => undefined);
  for (const key of [QUEUE_KEY, IDS_KEY, SEEN_KEY, OWNER_KEY, OLD_PENDING_KEY]) write(key, null);
}
