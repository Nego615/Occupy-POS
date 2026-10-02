import { CATEGORIES, type CatalogItem } from '../data/catalog';
import {
  daysBetween,
  todayIso,
  type StockMovement,
  type Supplier,
  type SupplierBill,
} from '../data/inventory';
import { refundedQty, type Order } from '../data/orders';
import { round } from './cart';
import { billStatus } from './inventory';

/**
 * Cost-side reports: margins on what sold, what stock is worth and what went
 * missing, and what's been bought and owed. Sales figures here are item sales
 * before tax and tips — the part cost of goods is set against.
 */

/** Whether an ISO day falls in the last `days` days, today included. */
export function isoInLastDays(iso: string, days: number): boolean {
  const ago = daysBetween(iso, todayIso());
  return ago >= 0 && ago < days;
}

/* ---------- Margins ---------- */

export type MarginRow = {
  /** The line's name — an item, or a set meal by its own name. */
  name: string;
  qty: number;
  sales: number;
  /** Null when no sale of it carried a cost. */
  cost: number | null;
  profit: number | null;
  /** Profit over costed sales, 0–1. */
  margin: number | null;
};

export type Margins = {
  rows: MarginRow[];
  sales: number;
  /** Sales that had a cost recorded — what the margin is measured on. */
  costedSales: number;
  cost: number;
  profit: number;
  margin: number;
  /** Sales with no cost recorded, left out of the margin. */
  uncostedSales: number;
};

/** Gross margin by line, over paid orders. Refunded orders aren't sales. */
export function margins(orders: Order[]): Margins {
  const tally = new Map<string, { qty: number; sales: number; costedSales: number; cost: number; costed: boolean }>();
  for (const order of orders) {
    if (order.status !== 'paid') continue;
    order.lines.forEach((line, index) => {
      // Units refunded since aren't sales.
      const qty = line.qty - refundedQty(order, index);
      if (qty <= 0) return;
      const row = tally.get(line.name) ?? { qty: 0, sales: 0, costedSales: 0, cost: 0, costed: false };
      const sales = line.unitPrice * qty;
      row.qty += qty;
      row.sales += sales;
      if (line.unitCost !== undefined) {
        row.costed = true;
        row.costedSales += sales;
        row.cost += line.unitCost * qty;
      }
      tally.set(line.name, row);
    });
  }

  const rows: MarginRow[] = [...tally.entries()].map(([name, r]) => {
    const profit = r.costed ? round(r.costedSales - r.cost) : null;
    return {
      name,
      qty: r.qty,
      sales: round(r.sales),
      cost: r.costed ? round(r.cost) : null,
      profit,
      margin: r.costed && r.costedSales > 0 ? (r.costedSales - r.cost) / r.costedSales : null,
    };
  });
  // Biggest earners first; uncosted lines sink to the bottom.
  rows.sort((a, b) => (b.profit ?? -Infinity) - (a.profit ?? -Infinity));

  const sales = round(rows.reduce((s, r) => s + r.sales, 0));
  const costedSales = round([...tally.values()].reduce((s, r) => s + r.costedSales, 0));
  const cost = round([...tally.values()].reduce((s, r) => s + r.cost, 0));
  const profit = round(costedSales - cost);
  return {
    rows,
    sales,
    costedSales,
    cost,
    profit,
    margin: costedSales > 0 ? profit / costedSales : 0,
    uncostedSales: round(sales - costedSales),
  };
}

/* ---------- Stock value and losses ---------- */

export type ValuationRow = { label: string; items: number; units: number; value: number; uncosted: number };

/** What's on the shelf now, at cost, by category. */
export function valuation(catalog: CatalogItem[]): ValuationRow[] {
  return CATEGORIES.map((c) => {
    const items = catalog.filter((i) => i.category === c.id);
    return {
      label: c.label,
      items: items.length,
      units: items.reduce((s, i) => s + i.stock, 0),
      value: round(items.reduce((s, i) => s + i.stock * (i.cost ?? 0), 0)),
      uncosted: items.filter((i) => i.cost === undefined).length,
    };
  }).filter((r) => r.items > 0);
}

export type LossRow = {
  itemId: string;
  name: string;
  wasteUnits: number;
  wasteValue: number;
  /** Count differences — negative is stock that went missing. */
  countUnits: number;
  countValue: number;
  /** Hand corrections, either way. */
  correctionUnits: number;
  correctionValue: number;
  /** Everything above together; negative is a loss. */
  net: number;
};

export type Losses = {
  rows: LossRow[];
  waste: number;
  counts: number;
  corrections: number;
  net: number;
};

/**
 * Shrinkage over the window, from the stock ledger: waste written off, what
 * counts found missing (or extra), and hand corrections — each valued at the
 * cost when it was logged.
 */
export function losses(movements: StockMovement[], days: number): Losses {
  const rows = new Map<string, LossRow>();
  for (const m of movements) {
    if (!['waste', 'count', 'correction'].includes(m.reason) || !isoInLastDays(m.date, days)) continue;
    const row =
      rows.get(m.itemId) ??
      {
        itemId: m.itemId,
        name: m.itemName,
        wasteUnits: 0,
        wasteValue: 0,
        countUnits: 0,
        countValue: 0,
        correctionUnits: 0,
        correctionValue: 0,
        net: 0,
      };
    const value = m.change * (m.unitCost ?? 0);
    if (m.reason === 'waste') {
      row.wasteUnits += m.change;
      row.wasteValue += value;
    } else if (m.reason === 'count') {
      row.countUnits += m.change;
      row.countValue += value;
    } else {
      row.correctionUnits += m.change;
      row.correctionValue += value;
    }
    row.net += value;
    rows.set(m.itemId, row);
  }
  const list = [...rows.values()]
    .map((r) => ({
      ...r,
      wasteValue: round(r.wasteValue),
      countValue: round(r.countValue),
      correctionValue: round(r.correctionValue),
      net: round(r.net),
    }))
    // Worst losses first.
    .sort((a, b) => a.net - b.net);
  const sum = (pick: (r: LossRow) => number) => round(list.reduce((s, r) => s + pick(r), 0));
  return {
    rows: list,
    waste: sum((r) => r.wasteValue),
    counts: sum((r) => r.countValue),
    corrections: sum((r) => r.correctionValue),
    net: sum((r) => r.net),
  };
}

/* ---------- Purchasing ---------- */

export type SupplierSpendRow = {
  supplierId: string;
  name: string;
  /** Deliveries received in the window, by the bills they raised. */
  received: number;
  deliveries: number;
  /** Paid to them in the window. */
  paid: number;
  /** Owed now, whenever it was billed. */
  owed: number;
  overdue: number;
};

export function supplierSpend(
  bills: SupplierBill[],
  suppliers: Supplier[],
  days: number,
): SupplierSpendRow[] {
  return suppliers
    .map((s) => {
      const mine = bills.filter((b) => b.supplierId === s.id);
      const inWindow = mine.filter((b) => isoInLastDays(b.issuedAt, days));
      const status = mine.map((b) => billStatus(b));
      return {
        supplierId: s.id,
        name: s.name,
        received: round(inWindow.reduce((sum, b) => sum + b.amount, 0)),
        deliveries: inWindow.length,
        paid: round(
          mine
            .flatMap((b) => b.payments)
            .filter((p) => isoInLastDays(p.date, days))
            .reduce((sum, p) => sum + p.amount, 0),
        ),
        owed: round(status.reduce((sum, st) => sum + st.balance, 0)),
        overdue: round(
          status.filter((st) => st.state === 'overdue').reduce((sum, st) => sum + st.balance, 0),
        ),
      };
    })
    .filter((r) => r.received > 0 || r.paid > 0 || r.owed > 0)
    .sort((a, b) => b.received - a.received);
}
