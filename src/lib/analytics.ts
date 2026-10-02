import {
  orderDiscount,
  orderItemCount,
  orderNetTotal,
  orderRefundTotal,
  orderSubtotal,
  orderTotal,
  refundedQty,
  type Order,
  type OrderStatus,
} from '../data/orders';
import { round } from './cart';
import { formatCurrency } from './currency';
import { toCsv } from './reports';

export type RangeId = 'today' | 'week' | 'month';

export const RANGES: { id: RangeId; label: string; days: number }[] = [
  { id: 'today', label: 'Today', days: 1 },
  { id: 'week', label: 'Week', days: 7 },
  { id: 'month', label: 'Month', days: 30 },
];

export type Totals = {
  netSales: number;
  transactions: number;
  avgTicket: number;
  refunds: number;
};

/** Orders inside a window of `days`, offset by `days` for the prior period. */
function inWindow(orders: Order[], days: number, offset = 0): Order[] {
  const from = offset * days;
  const to = from + days;
  return orders.filter((o) => o.daysAgo >= from && o.daysAgo < to);
}

function totalsFor(orders: Order[]): Totals {
  const paid = orders.filter((o) => o.status === 'paid');
  const netSales = round(paid.reduce((sum, o) => sum + orderNetTotal(o), 0));
  return {
    netSales,
    transactions: paid.length,
    avgTicket: paid.length ? round(netSales / paid.length) : 0,
    refunds: round(orders.reduce((sum, o) => sum + orderRefundTotal(o), 0)),
  };
}

export type StatCard = {
  label: string;
  value: string;
  /** Absent when the prior period has nothing to compare against. */
  delta?: { text: string; direction: 'up' | 'down' };
};

export function statCards(orders: Order[], range: RangeId): StatCard[] {
  const { days, label } = RANGES.find((r) => r.id === range)!;
  const current = totalsFor(inWindow(orders, days));
  const previous = totalsFor(inWindow(orders, days, 1));
  const priorLabel = range === 'today' ? 'vs yesterday' : `vs last ${label.toLowerCase()}`;

  const card = (label: string, value: string, now: number, before: number): StatCard => ({
    label,
    value,
    delta: delta(now, before, priorLabel),
  });

  return [
    card('Net sales', money(current.netSales), current.netSales, previous.netSales),
    card(
      'Transactions',
      String(current.transactions),
      current.transactions,
      previous.transactions,
    ),
    card('Avg. ticket', money(current.avgTicket), current.avgTicket, previous.avgTicket),
    card('Refunds', money(current.refunds), current.refunds, previous.refunds),
  ];
}

function delta(now: number, before: number, priorLabel: string): StatCard['delta'] {
  if (before === 0) return undefined;
  const pct = ((now - before) / before) * 100;
  return {
    text: `${Math.abs(pct).toFixed(1)}% ${priorLabel}`,
    direction: pct >= 0 ? 'up' : 'down',
  };
}

export type DayBar = { day: string; value: number };

/** Last seven days of paid sales, oldest first. */
export function salesByDay(orders: Order[]): DayBar[] {
  const bars: DayBar[] = [];
  for (let daysAgo = 6; daysAgo >= 0; daysAgo--) {
    const day = new Date(Date.now() - daysAgo * 86_400_000).toLocaleDateString('en-US', {
      weekday: 'short',
    });
    const value = orders
      .filter((o) => o.daysAgo === daysAgo && o.status === 'paid')
      .reduce((sum, o) => sum + orderNetTotal(o), 0);
    bars.push({ day, value: round(value) });
  }
  return bars;
}

export type TopItem = { name: string; sold: number; amount: number };

export function topItems(orders: Order[], range: RangeId, limit = 5): TopItem[] {
  const { days } = RANGES.find((r) => r.id === range)!;
  const tally = new Map<string, TopItem>();

  for (const order of inWindow(orders, days)) {
    if (order.status !== 'paid') continue;
    order.lines.forEach((line, index) => {
      const qty = line.qty - refundedQty(order, index);
      if (qty <= 0) return;
      const entry = tally.get(line.name) ?? { name: line.name, sold: 0, amount: 0 };
      entry.sold += qty;
      entry.amount = round(entry.amount + line.unitPrice * qty);
      tally.set(line.name, entry);
    });
  }

  return [...tally.values()].sort((a, b) => b.sold - a.sold).slice(0, limit);
}

export type ActivityEntry = {
  kind: OrderStatus;
  subject: string;
  detail: string;
  time: string;
};

/** The most recent orders, phrased as a feed. */
export function recentActivity(orders: Order[], limit = 5): ActivityEntry[] {
  return orders.slice(0, limit).map((order) => ({
    kind: order.status,
    subject: `${order.name} #${order.id}`,
    detail: describe(order),
    time: order.time,
  }));
}

function describe(order: Order): string {
  if (order.status === 'refunded') return `refunded ${money(orderRefundTotal(order))}`;
  if (order.status === 'occupied') {
    const count = orderItemCount(order);
    return `tab open · ${count} ${count === 1 ? 'item' : 'items'}`;
  }
  return `closed out · ${order.method ?? 'Card'}`;
}

/** Business-currency amount, e.g. "TSh 1,284,500". Same as formatMoney, named for analytics code. */
export function money(value: number): string {
  return formatCurrency(value);
}

/** One row per order in the range, for the Export report button. */
export function ordersToCsv(orders: Order[], range: RangeId): string {
  const { days } = RANGES.find((r) => r.id === range)!;
  return ordersCsv(inWindow(orders, days));
}

/** One row per order, exactly as given — callers do their own filtering. */
export function ordersCsv(orders: Order[]): string {
  const header = [
    'order_id',
    'tab',
    'status',
    'closed_at',
    'order_type',
    'cashier_id',
    'payment_method',
    'items',
    'discount',
    'subtotal',
    'tax',
    'tip',
    'total',
    'refunded',
  ];

  const rows = orders.map((o) => [
    o.id,
    o.name,
    o.status,
    o.at,
    o.orderType ?? '',
    o.staffId ?? '',
    o.method ?? '',
    o.lines.map((l) => `${l.qty}× ${l.name}${l.note ? ` (${l.note})` : ''}`).join('; '),
    orderDiscount(o).toFixed(2),
    orderSubtotal(o).toFixed(2),
    o.tax.toFixed(2),
    o.tip.toFixed(2),
    orderTotal(o).toFixed(2),
    orderRefundTotal(o).toFixed(2),
  ]);

  return toCsv([header, ...rows]);
}

/** Saves a CSV string as a download — no server round trip needed. */
export function downloadCsv(csv: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
