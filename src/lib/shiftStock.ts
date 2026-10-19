import { roundStock, type CatalogItem } from '../data/catalog';
import type { CashUp } from '../data/cashup';
import type { StockCount, StockMovement } from '../data/inventory';
import { round } from './cart';

/**
 * Stock over one counter shift: what was on hand when it opened, what came
 * in and went out through the ledger, and what was counted when it closed.
 * Pure, so the cash-up screen, its printout, and the report all agree.
 */

/** When a movement happened, in ms. Older movements only kept the day and a "2:05 PM" time. */
export function movementTime(m: Pick<StockMovement, 'at' | 'date' | 'time'>): number {
  if (m.at) return Date.parse(m.at);
  const [y, mo, d] = m.date.split('-').map(Number);
  const t = /(\d{1,2}):(\d{2})\s*([AP])M/i.exec(m.time);
  if (!t) return new Date(y, mo - 1, d).getTime();
  const hours = (Number(t[1]) % 12) + (t[3].toUpperCase() === 'P' ? 12 : 0);
  return new Date(y, mo - 1, d, hours, Number(t[2])).getTime();
}

/** One shift, open or closed, as the stock report reads it. */
export type ShiftWindow = {
  /** The cash-up's id, or `current` for the shift still open. */
  id: string;
  /** ISO timestamps; a movement belongs to the shift when from < it ≤ to. */
  from: string;
  to: string;
  /** On hand when it opened — the previous cash-up's closing stock, when that was kept. */
  opening?: Record<string, number>;
  /** On hand when it closed, when that was kept. */
  closing?: Record<string, number>;
  /** The count taken as it closed. */
  countId?: string;
  /** Absent for the shift still open. */
  cashUp?: CashUp;
};

/** Every shift, newest first: the one still open, then each cash-up. */
export function shiftWindows(cashUps: CashUp[], from: string, now: string): ShiftWindow[] {
  const sorted = [...cashUps].sort((a, b) => (a.closedAt < b.closedAt ? 1 : -1));
  return [
    { id: 'current', from, to: now, opening: sorted[0]?.closingStock },
    ...sorted.map((c, i) => ({
      id: c.id,
      from: c.openedAt,
      to: c.closedAt,
      opening: sorted[i + 1]?.closingStock,
      closing: c.closingStock,
      countId: c.countId,
      cashUp: c,
    })),
  ];
}

export type ShiftStockRow = {
  itemId: string;
  name: string;
  opening: number;
  /** Deliveries and stock received by hand, plus new items' starting counts. */
  received: number;
  /** Sales less refunds back to stock — negative when more went out. */
  sold: number;
  /** Waste and damage, as a negative. */
  wasted: number;
  /** Corrections and counts during the shift, not the one that closed it. */
  adjusted: number;
  /** Opening plus everything above: what should be on the shelf. */
  expected: number;
  /** What the closing count found, when this item was counted. */
  counted?: number;
  /** Counted less expected; 0 when not counted. */
  variance: number;
  /** The variance at the item's cost. */
  varianceValue: number;
  /** On hand once the shift closed — after its count. */
  closing: number;
};

/**
 * Each tracked item's stock across `shift`, from the ledger. Opening and
 * closing come from the cash-ups' snapshots when they have them, and are
 * worked back from stock on hand when they don't (shifts closed before
 * snapshots were kept, and the shift still open).
 */
export function shiftStock(
  catalog: CatalogItem[],
  movements: StockMovement[],
  counts: StockCount[],
  shift: ShiftWindow,
): ShiftStockRow[] {
  const from = Date.parse(shift.from);
  const to = Date.parse(shift.to);
  const count = shift.countId ? counts.find((c) => c.id === shift.countId) : undefined;
  const lines = new Map((count?.lines ?? []).map((l) => [l.itemId, l]));

  type Tally = { name: string; window: number; later: number } & Pick<
    ShiftStockRow,
    'received' | 'sold' | 'wasted' | 'adjusted'
  >;
  const tallies = new Map<string, Tally>();
  const tally = (itemId: string, name: string) => {
    let t = tallies.get(itemId);
    if (!t) {
      t = { name, window: 0, later: 0, received: 0, sold: 0, wasted: 0, adjusted: 0 };
      tallies.set(itemId, t);
    }
    return t;
  };
  for (const item of catalog) if (!item.untracked) tally(item.id, item.name);

  for (const m of movements) {
    const at = movementTime(m);
    // The closing count's own movements are its variance, not part of what was expected.
    const closingCount = !!count && m.ref === count.id;
    if (at > to && !closingCount) {
      if (tallies.has(m.itemId)) tallies.get(m.itemId)!.later += m.change;
      continue;
    }
    if (at <= from && !closingCount) continue;
    const t = tally(m.itemId, m.itemName);
    t.window += m.change;
    if (closingCount) continue;
    if (m.reason === 'sale' || m.reason === 'refund') t.sold += m.change;
    else if (m.reason === 'waste') t.wasted += m.change;
    else if (m.reason === 'correction' || m.reason === 'count') t.adjusted += m.change;
    else t.received += m.change;
  }

  const items = new Map(catalog.map((i) => [i.id, i]));
  for (const l of lines.values()) tally(l.itemId, l.name);

  return [...tallies.entries()].map(([itemId, t]) => {
    const item = items.get(itemId);
    const closing = roundStock(shift.closing?.[itemId] ?? (item?.stock ?? 0) - t.later);
    const opening = roundStock(shift.opening?.[itemId] ?? closing - t.window);
    const expected = roundStock(opening + t.received + t.sold + t.wasted + t.adjusted);
    const line = lines.get(itemId);
    const variance = line ? roundStock(line.counted - expected) : 0;
    return {
      itemId,
      name: item?.name ?? t.name,
      opening,
      received: roundStock(t.received),
      sold: roundStock(t.sold),
      wasted: roundStock(t.wasted),
      adjusted: roundStock(t.adjusted),
      expected,
      ...(line ? { counted: line.counted } : {}),
      variance,
      varianceValue: round(variance * (line?.unitCost ?? item?.cost ?? 0)),
      closing,
    };
  });
}

/** The stock across one closed shift — what its cash-up screen and slip show. */
export function cashUpStock(
  cashUp: CashUp,
  cashUps: CashUp[],
  catalog: CatalogItem[],
  movements: StockMovement[],
  counts: StockCount[],
): ShiftStockRow[] {
  const shift = shiftWindows(cashUps, cashUp.closedAt, cashUp.closedAt).find((w) => w.id === cashUp.id);
  return shift ? shiftStock(catalog, movements, counts, shift) : [];
}

/** What the closing count found: how many items were off, and what that's worth at cost. */
export function countResult(rows: ShiftStockRow[]): { counted: number; off: number; value: number } {
  const counted = rows.filter((r) => r.counted !== undefined);
  return {
    counted: counted.length,
    off: counted.filter((r) => r.variance !== 0).length,
    value: round(counted.reduce((s, r) => s + r.varianceValue, 0)),
  };
}

/** Whether anything happened to the row's item in the shift, or it was counted. */
export function rowMoved(row: ShiftStockRow): boolean {
  return row.received !== 0 || row.sold !== 0 || row.wasted !== 0 || row.adjusted !== 0 || row.counted !== undefined;
}

/** Stock is fractional for poured drinks — two places is plenty to read. */
export function formatUnits(n: number, signed = false): string {
  const v = Math.round(n * 100) / 100;
  return `${signed && v > 0 ? '+' : ''}${v}`;
}
