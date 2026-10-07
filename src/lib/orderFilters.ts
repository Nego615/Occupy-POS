import { formatMoney } from '../components/Mono';
import { orderTotal, type Order, type OrderStatus } from '../data/orders';

/**
 * Filters shared by every order list — the counter's history and the admin's
 * orders table — so a search or a payment filter means the same thing in both.
 */

export type StatusFilter = OrderStatus | 'all';

export const STATUSES: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'occupied', label: 'Open' },
  { id: 'paid', label: 'Paid' },
  { id: 'refunded', label: 'Refunded' },
];

export type PaymentFilter = 'all' | 'card' | 'cash' | 'mobile' | 'split' | 'unpaid';

export const PAYMENTS: { id: PaymentFilter; label: string }[] = [
  { id: 'all', label: 'Any payment' },
  { id: 'card', label: 'Card' },
  { id: 'cash', label: 'Cash' },
  { id: 'mobile', label: 'Mobile money' },
  { id: 'split', label: 'Split' },
  { id: 'unpaid', label: 'Not yet paid' },
];

/** A split bill matches "Split" and each method it was paid with. */
export function matchesPayment(order: Order, payment: PaymentFilter): boolean {
  if (payment === 'all') return true;
  if (payment === 'unpaid') return order.payments.length === 0;
  if (payment === 'split') return order.payments.length > 1;
  return order.payments.some((p) => p.method === payment);
}

/** Tab name, `#id`, item name, total, or payment method. `q` is already lowercased. */
export function matchesQuery(order: Order, q: string): boolean {
  if (!q) return true;
  return (
    order.name.toLowerCase().includes(q) ||
    `#${order.id}`.includes(q) ||
    order.lines.some((l) => l.name.toLowerCase().includes(q) || (l.note?.toLowerCase().includes(q) ?? false)) ||
    order.payments.some((p) => p.ref?.toLowerCase().includes(q) ?? false) ||
    // Amounts are formatted with a non-breaking space; searches are typed with a plain one.
    formatMoney(orderTotal(order)).replace(/ /g, ' ').toLowerCase().includes(q) ||
    String(orderTotal(order)).includes(q) ||
    (order.method?.toLowerCase().includes(q) ?? false)
  );
}

/** Per-status counts over a list, including `all`, for pill badges. */
export function countByStatus(orders: Order[]): Record<StatusFilter, number> {
  const counts: Record<StatusFilter, number> = {
    all: orders.length,
    occupied: 0,
    paid: 0,
    refunded: 0,
  };
  for (const order of orders) counts[order.status]++;
  return counts;
}
