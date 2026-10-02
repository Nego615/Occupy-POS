import { useEffect } from 'react';
import type { PosRepository, Snapshot } from './persist';

/** How long a slice sits unchanged before it's written — typing in a field doesn't write per key. */
const SAVE_DELAY_MS = 250;

/**
 * Writes `value` under `key` whenever it changes. The first render writes too,
 * so seed data (and its timestamps) is frozen on first run instead of being
 * regenerated relative to "now" on every reload.
 */
export function usePersist(repo: PosRepository, key: string, value: unknown): void {
  useEffect(() => {
    const timer = setTimeout(() => {
      repo.save(key, value).catch((err) => console.warn(`Couldn't save ${key}.`, err));
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [repo, key, value]);
}

/** A saved slice, or `fallback` when there isn't one. */
export function restored<T>(snapshot: Snapshot, key: string, fallback: T | (() => T)): T {
  if (key in snapshot) return snapshot[key] as T;
  return typeof fallback === 'function' ? (fallback as () => T)() : fallback;
}

/** The next number after the highest "PREFIX-n" in `ids` — or `floor` if there's none higher. */
export function nextSeq(ids: string[], prefix: string, floor = 1): number {
  let max = floor - 1;
  for (const id of ids) {
    if (!id.startsWith(prefix)) continue;
    const n = Number(id.slice(prefix.length));
    if (Number.isFinite(n)) max = Math.max(max, n);
  }
  return max + 1;
}
