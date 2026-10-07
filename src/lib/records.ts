import { nextSeq } from './usePersist';
import type { Snapshot } from './persist';

/**
 * How each saved slice is shared between devices. A list is stored one row
 * per record, so two screens editing different records never overwrite each
 * other; a single is stored as one row. Slices not listed (the active tab)
 * stay on the device.
 */
type ListSpec = {
  kind: 'list';
  idOf: (record: any) => string;
  /** Which end of the array new records go on. */
  newest: 'first' | 'last';
  /** Records that stay on this device — an empty walk-in tab is just someone's blank register. */
  local?: (record: any) => boolean;
};
type SingleSpec = { kind: 'single' };
export type SliceSpec = ListSpec | SingleSpec;

const byId = (r: { id: string | number }) => String(r.id);
const list = (newest: 'first' | 'last', extra: Partial<ListSpec> = {}): ListSpec => ({
  kind: 'list',
  idOf: byId,
  newest,
  ...extra,
});

export const SLICES: Record<string, SliceSpec> = {
  tabs: list('last', {
    idOf: (t) => String(t.orderId),
    local: (t) => t.locationId === null && t.cart.length === 0 && t.payments.length === 0,
  }),
  orders: list('first'),
  catalog: list('last'),
  locations: list('last'),
  promotions: list('last'),
  setMeals: list('last'),
  staff: list('last'),
  payrollRuns: list('first'),
  kitchenTickets: list('last'),
  movements: list('first'),
  suppliers: list('last'),
  purchaseOrders: list('first'),
  bills: list('first'),
  stockCounts: list('first'),
  settings: { kind: 'single' },
  countDraft: { kind: 'single' },
};

/** The one row a single slice is stored as. */
export const SINGLE_ID = '_';

/** A record that changed on another device. */
export type RemoteChange = { key: string; id: string; value: unknown; deleted: boolean };

/** A slice's records by id, leaving out the ones that stay on this device. */
export function recordsOf(spec: SliceSpec, value: unknown): Map<string, unknown> {
  if (spec.kind === 'single') return new Map([[SINGLE_ID, value]]);
  const out = new Map<string, unknown>();
  for (const record of (value as unknown[]) ?? []) {
    if (!spec.local?.(record)) out.set(spec.idOf(record), record);
  }
  return out;
}

/** `prev` with one remote change applied: replaced in place, removed, or added at the newest end. */
export function applyChange<T>(prev: T, change: RemoteChange): T {
  const spec = SLICES[change.key];
  if (!spec) return prev;
  if (spec.kind === 'single') return change.value as T;
  const records = (prev as unknown[]) ?? [];
  const at = records.findIndex((r) => spec.idOf(r) === change.id);
  if (change.deleted) return (at === -1 ? records : records.filter((_, i) => i !== at)) as T;
  if (at !== -1) return records.map((r, i) => (i === at ? change.value : r)) as T;
  return (spec.newest === 'first' ? [change.value, ...records] : [...records, change.value]) as T;
}

/** JSON with object keys sorted, so a record round-tripped through Postgres compares equal. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

/**
 * Numbered records two devices could both create. Each counter's floor is one
 * past the highest number already saved, so a shared counter starts above
 * existing data.
 */
type Numbered = { id: string | number };
const ids = (snapshot: Snapshot, key: string) => ((snapshot[key] as Numbered[] | undefined) ?? []).map((r) => r.id);

export const COUNTERS: Record<string, (snapshot: Snapshot) => number> = {
  order: (s) =>
    Math.max(
      0,
      ...((s.tabs as { orderId: number }[] | undefined) ?? []).map((t) => t.orderId),
      ...(ids(s, 'orders') as number[]),
    ) + 1,
  ticket: (s) => Math.max(0, ...(ids(s, 'kitchenTickets') as number[])) + 1,
  po: (s) => nextSeq(ids(s, 'purchaseOrders') as string[], 'PO-', 1),
  bill: (s) => nextSeq(ids(s, 'bills') as string[], 'BILL-', 1),
  payment: (s) =>
    nextSeq(
      ((s.bills as { payments: Numbered[] }[] | undefined) ?? []).flatMap((b) => b.payments.map((p) => String(p.id))),
      'PAY-',
      1,
    ),
  count: (s) => nextSeq(ids(s, 'stockCounts') as string[], 'COUNT-', 1),
};
