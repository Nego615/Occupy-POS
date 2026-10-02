import { stockState, type CatalogItem } from '../data/catalog';
import {
  addDays,
  daysBetween,
  todayIso,
  type MovementReason,
  type PurchaseOrder,
  type PurchaseStatus,
  type StockMovement,
  type SupplierBill,
} from '../data/inventory';
import { round } from './cart';
import { formatTime } from './useClock';

/**
 * Inventory logic, kept pure so the store only wires state to it. Every
 * stock change goes through applyMovements, which is what keeps the ledger
 * and the on-hand numbers in step.
 */

export type StockEntry = {
  itemId: string;
  change: number;
  reason: MovementReason;
  note?: string;
  ref?: string;
  /** What one unit cost, when the entry knows better than the catalog (a delivery's price). */
  unitCost?: number;
};

let movementSeq = 0;

/**
 * Applies stock changes to the catalog and returns the ledger entries for
 * them. Stock never goes below zero — a sale of the last unit twice (say, two
 * registers) logs the change it actually made.
 */
export function applyMovements(
  catalog: CatalogItem[],
  entries: StockEntry[],
  staffId: string | undefined,
): { catalog: CatalogItem[]; movements: StockMovement[] } {
  const stock = new Map(catalog.map((i) => [i.id, i.stock]));
  const names = new Map(catalog.map((i) => [i.id, i.name]));
  const costs = new Map(catalog.map((i) => [i.id, i.cost]));
  const movements: StockMovement[] = [];
  const date = todayIso();
  const time = formatTime(new Date());

  for (const entry of entries) {
    if (!stock.has(entry.itemId) || entry.change === 0) continue;
    const before = stock.get(entry.itemId)!;
    const after = Math.max(0, before + entry.change);
    stock.set(entry.itemId, after);
    movements.push({
      id: `mv-${Date.now().toString(36)}-${++movementSeq}`,
      itemId: entry.itemId,
      itemName: names.get(entry.itemId)!,
      change: after - before,
      stockAfter: after,
      reason: entry.reason,
      note: entry.note,
      ref: entry.ref,
      unitCost: entry.unitCost ?? costs.get(entry.itemId),
      staffId,
      date,
      time,
    });
  }

  return {
    catalog: catalog.map((i) => (stock.get(i.id) === i.stock ? i : { ...i, stock: stock.get(i.id)! })),
    movements,
  };
}

/** Opening balance for every item — where the ledger starts. */
export function openingMovements(catalog: CatalogItem[]): StockMovement[] {
  return catalog.map((item) => ({
    id: `mv-open-${item.id}`,
    itemId: item.id,
    itemName: item.name,
    change: item.stock,
    stockAfter: item.stock,
    reason: 'opening',
    unitCost: item.cost,
    date: todayIso(),
    time: '6:00 AM',
  }));
}

/* ---------- Purchase orders ---------- */

export function purchaseTotal(order: PurchaseOrder): number {
  return round(order.lines.reduce((sum, l) => sum + l.qty * l.unitCost, 0));
}

export function receivedTotal(order: PurchaseOrder): number {
  return round(order.lines.reduce((sum, l) => sum + l.received * l.unitCost, 0));
}

export type Receipt = { itemId: string; qty: number; unitCost: number };

/**
 * Takes a delivery against an order: the order's received counts and status,
 * stock entries for what arrived, and each item's new average cost.
 */
export function receiveAgainst(
  order: PurchaseOrder,
  catalog: CatalogItem[],
  receipts: Receipt[],
): { order: PurchaseOrder; catalog: CatalogItem[]; entries: StockEntry[]; amount: number } {
  const arrived = receipts.filter((r) => r.qty > 0);
  const lines = order.lines.map((line) => {
    const r = arrived.find((x) => x.itemId === line.itemId);
    return r ? { ...line, received: line.received + r.qty, unitCost: r.unitCost } : line;
  });
  const complete = lines.every((l) => l.received >= l.qty);
  const status: PurchaseStatus = complete ? 'received' : 'partial';

  // Weighted average: what's on the shelf at its old cost, plus what arrived at its cost.
  const costed = catalog.map((item) => {
    const r = arrived.find((x) => x.itemId === item.id);
    if (!r) return item;
    const onHand = Math.max(0, item.stock);
    const cost =
      item.cost === undefined || onHand === 0
        ? r.unitCost
        : round((onHand * item.cost + r.qty * r.unitCost) / (onHand + r.qty));
    return { ...item, cost };
  });

  return {
    order: { ...order, lines, status },
    catalog: costed,
    entries: arrived.map((r) => ({
      itemId: r.itemId,
      change: r.qty,
      reason: 'received' as const,
      ref: order.id,
      unitCost: r.unitCost,
    })),
    amount: round(arrived.reduce((sum, r) => sum + r.qty * r.unitCost, 0)),
  };
}

/**
 * Low and sold-out items, grouped by supplier, each topped up to its reorder
 * level. Items already on an open order aren't suggested twice.
 */
export function reorderSuggestions(
  catalog: CatalogItem[],
  lowDefault: number,
  openOrders: PurchaseOrder[],
): Map<string, { item: CatalogItem; qty: number }[]> {
  const onOrder = new Map<string, number>();
  for (const o of openOrders) {
    for (const l of o.lines) onOrder.set(l.itemId, (onOrder.get(l.itemId) ?? 0) + l.qty - l.received);
  }
  const bySupplier = new Map<string, { item: CatalogItem; qty: number }[]>();
  for (const item of catalog) {
    if (!item.supplierId || stockState(item, lowDefault) === 'in') continue;
    const target = item.parLevel ?? Math.max((item.lowStockAt ?? lowDefault) * 3, 10);
    const qty = target - item.stock - (onOrder.get(item.id) ?? 0);
    if (qty <= 0) continue;
    bySupplier.set(item.supplierId, [...(bySupplier.get(item.supplierId) ?? []), { item, qty }]);
  }
  return bySupplier;
}

/* ---------- Bills ---------- */

export type BillState = 'paid' | 'partial' | 'overdue' | 'due';

export type BillStatus = {
  paid: number;
  balance: number;
  state: BillState;
  /** Days past due (positive) or until due (negative). */
  overdueBy: number;
};

export function billStatus(bill: SupplierBill, today = todayIso()): BillStatus {
  const paid = round(bill.payments.reduce((sum, p) => sum + p.amount, 0));
  const balance = round(Math.max(0, bill.amount - paid));
  const overdueBy = daysBetween(bill.dueAt, today);
  const state: BillState =
    balance === 0 ? 'paid' : overdueBy > 0 ? 'overdue' : paid > 0 ? 'partial' : 'due';
  return { paid, balance, state, overdueBy };
}

export function newBill(
  supplierId: string,
  poId: string,
  reference: string,
  amount: number,
  termsDays: number,
  seq: number,
): SupplierBill {
  const issuedAt = todayIso();
  return {
    id: `BILL-${seq}`,
    supplierId,
    poId,
    reference,
    issuedAt,
    dueAt: addDays(issuedAt, termsDays),
    amount,
    payments: [],
  };
}
