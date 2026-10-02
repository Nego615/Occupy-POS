import { CATEGORIES, type CatalogItem } from '../data/catalog';
import {
  TENDER_LABEL,
  orderNetSubtotal,
  orderNetTax,
  orderNetTotal,
  orderRefundTotal,
  orderTotal,
  refundedQty,
  type Order,
} from '../data/orders';
import { round } from './cart';

/**
 * Report math. Sales count paid orders only — open tabs haven't been
 * collected yet. Refunds come out of sales (a fully refunded order drops out,
 * a partial refund comes off its order) and are also tallied on their own.
 */

export type ReportRangeId = 'today' | 'week' | 'month';

export const REPORT_RANGES: { id: ReportRangeId; label: string; days: number }[] = [
  { id: 'today', label: 'Today', days: 1 },
  { id: 'week', label: '7 days', days: 7 },
  { id: 'month', label: '30 days', days: 30 },
];

export function inLastDays(orders: Order[], days: number): Order[] {
  return orders.filter((o) => o.daysAgo < days);
}

const paidOnly = (orders: Order[]) => orders.filter((o) => o.status === 'paid');

/** "Today", "Yesterday", or "Sep 21". */
export function dayLabel(daysAgo: number): string {
  if (daysAgo === 0) return 'Today';
  if (daysAgo === 1) return 'Yesterday';
  return new Date(Date.now() - daysAgo * 86_400_000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

/* ---------- Sales summary ---------- */

export type Ledger = {
  /** Paid orders. */
  orders: number;
  /** Line items before tax and tip, net of refunds. */
  itemSales: number;
  tax: number;
  tips: number;
  /** Everything kept on paid orders: items + tax + tips, less partial refunds. */
  collected: number;
  avgTicket: number;
  /** Everything given back, full and partial. */
  refunds: number;
  /** Orders with any refund. */
  refundCount: number;
};

export function ledger(orders: Order[]): Ledger {
  const paid = paidOnly(orders);
  const refunded = orders.filter((o) => orderRefundTotal(o) > 0);
  const collected = round(paid.reduce((sum, o) => sum + orderNetTotal(o), 0));
  return {
    orders: paid.length,
    itemSales: round(paid.reduce((sum, o) => sum + orderNetSubtotal(o), 0)),
    tax: round(paid.reduce((sum, o) => sum + orderNetTax(o), 0)),
    tips: round(paid.reduce((sum, o) => sum + o.tip, 0)),
    collected,
    avgTicket: paid.length ? round(collected / paid.length) : 0,
    refunds: round(refunded.reduce((sum, o) => sum + orderRefundTotal(o), 0)),
    refundCount: refunded.length,
  };
}

export type DayRow = Ledger & { daysAgo: number; label: string };

/** One ledger per day in the window, oldest first. */
export function byDay(orders: Order[], days: number): DayRow[] {
  const rows: DayRow[] = [];
  for (let daysAgo = days - 1; daysAgo >= 0; daysAgo--) {
    rows.push({
      daysAgo,
      label: dayLabel(daysAgo),
      ...ledger(orders.filter((o) => o.daysAgo === daysAgo)),
    });
  }
  return rows;
}

/* ---------- Items & categories ---------- */

export type ItemRow = {
  name: string;
  category: string;
  /** Tile color from the catalog, so rows match the register. */
  color?: string;
  qty: number;
  sales: number;
  /** Fraction of all item sales in the window, 0–1. */
  share: number;
};

/** Items that have since left the catalog still report, under "Other". */
export function byItem(orders: Order[], catalog: CatalogItem[]): ItemRow[] {
  const byName = new Map(catalog.map((i) => [i.name, i]));
  const tally = new Map<string, ItemRow>();

  for (const order of paidOnly(orders)) {
    order.lines.forEach((line, index) => {
      const qty = line.qty - refundedQty(order, index);
      if (qty <= 0) return;
      const item = byName.get(line.name);
      const row = tally.get(line.name) ?? {
        name: line.name,
        category: CATEGORIES.find((c) => c.id === item?.category)?.label ?? 'Other',
        color: item?.color,
        qty: 0,
        sales: 0,
        share: 0,
      };
      row.qty += qty;
      row.sales = round(row.sales + line.unitPrice * qty);
      tally.set(line.name, row);
    });
  }

  return withShares([...tally.values()]);
}

export type CategoryRow = { label: string; items: number; qty: number; sales: number; share: number };

export function byCategory(items: ItemRow[]): CategoryRow[] {
  const tally = new Map<string, CategoryRow>();
  for (const item of items) {
    const row = tally.get(item.category) ?? {
      label: item.category,
      items: 0,
      qty: 0,
      sales: 0,
      share: 0,
    };
    row.items += 1;
    row.qty += item.qty;
    row.sales = round(row.sales + item.sales);
    tally.set(item.category, row);
  }
  return withShares([...tally.values()]);
}

/* ---------- Payments & tabs ---------- */

export type GroupRow = {
  label: string;
  orders: number;
  collected: number;
  tips: number;
  avgTicket: number;
  /** Tips as a fraction of item sales, 0–1. */
  tipRate: number;
  /** Fraction of everything collected, 0–1. */
  share: number;
};

function groupOrders(orders: Order[], keyOf: (o: Order) => string): GroupRow[] {
  const groups = new Map<string, Order[]>();
  for (const order of paidOnly(orders)) {
    const key = keyOf(order);
    groups.set(key, [...(groups.get(key) ?? []), order]);
  }

  const rows = [...groups.entries()].map(([label, members]) => {
    const l = ledger(members);
    return {
      label,
      orders: l.orders,
      collected: l.collected,
      tips: l.tips,
      avgTicket: l.avgTicket,
      tipRate: l.itemSales ? l.tips / l.itemSales : 0,
      share: 0,
    };
  });
  const total = rows.reduce((sum, r) => sum + r.collected, 0);
  return rows
    .map((r) => ({ ...r, share: total ? r.collected / total : 0 }))
    .sort((a, b) => b.collected - a.collected);
}

/**
 * By how the money came in. A split bill counts toward each of its methods,
 * by the share each one paid — tips and refunds follow the same shares.
 */
export function byPayment(orders: Order[]): GroupRow[] {
  const tally = new Map<string, { orders: number; collected: number; tips: number; itemSales: number }>();
  for (const order of paidOnly(orders)) {
    const net = orderNetTotal(order);
    const payments = order.payments.length
      ? order.payments
      : [{ method: 'card' as const, amount: orderTotal(order) }];
    const paidIn = payments.reduce((sum, p) => sum + p.amount, 0) || 1;
    for (const p of payments) {
      const share = p.amount / paidIn;
      const label = TENDER_LABEL[p.method];
      const row = tally.get(label) ?? { orders: 0, collected: 0, tips: 0, itemSales: 0 };
      row.orders += 1;
      row.collected += net * share;
      row.tips += order.tip * share;
      row.itemSales += orderNetSubtotal(order) * share;
      tally.set(label, row);
    }
  }
  const total = [...tally.values()].reduce((sum, r) => sum + r.collected, 0);
  return [...tally.entries()]
    .map(([label, r]) => ({
      label,
      orders: r.orders,
      collected: round(r.collected),
      tips: round(r.tips),
      avgTicket: r.orders ? round(r.collected / r.orders) : 0,
      tipRate: r.itemSales ? r.tips / r.itemSales : 0,
      share: total ? r.collected / total : 0,
    }))
    .sort((a, b) => b.collected - a.collected);
}

export function byTab(orders: Order[]): GroupRow[] {
  return groupOrders(orders, (o) => o.name);
}

/* ---------- Time of day ---------- */

export type HourRow = { hour: number; label: string; orders: number; sales: number };

/** Reads the hour out of "4:38 PM" or "Thu 2:14 PM". */
function hourOf(order: Order): number | null {
  const match = /(\d{1,2}):\d{2}\s*(AM|PM)/.exec(order.time);
  if (!match) return null;
  const h = Number(match[1]) % 12;
  return match[2] === 'PM' ? h + 12 : h;
}

function hourLabel(hour: number): string {
  const h = hour % 12 || 12;
  return `${h}${hour < 12 ? 'a' : 'p'}`;
}

/**
 * Paid sales bucketed by the hour they closed. The span covers the earliest to
 * latest trading hour seen, so quiet hours inside the day still show as gaps.
 */
export function byHour(orders: Order[]): HourRow[] {
  const buckets = new Map<number, { orders: number; sales: number }>();
  for (const order of paidOnly(orders)) {
    const hour = hourOf(order);
    if (hour === null) continue;
    const b = buckets.get(hour) ?? { orders: 0, sales: 0 };
    b.orders += 1;
    b.sales = round(b.sales + orderNetTotal(order));
    buckets.set(hour, b);
  }
  if (buckets.size === 0) return [];

  const hours = [...buckets.keys()];
  const rows: HourRow[] = [];
  for (let hour = Math.min(...hours); hour <= Math.max(...hours); hour++) {
    rows.push({ hour, label: hourLabel(hour), ...(buckets.get(hour) ?? { orders: 0, sales: 0 }) });
  }
  return rows;
}

function withShares<T extends { sales: number; share: number }>(rows: T[]): T[] {
  const total = rows.reduce((sum, r) => sum + r.sales, 0);
  return rows
    .map((r) => ({ ...r, share: total ? r.sales / total : 0 }))
    .sort((a, b) => b.sales - a.sales);
}

/* ---------- Export ---------- */

/** Rows of plain cells, header first, as CSV. */
export function toCsv(rows: (string | number)[][]): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\n');
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
