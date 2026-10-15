import {
  orderItemCount,
  orderItems,
  orderSubtotal,
  orderTotal,
  paidAmount,
  refundedQty,
  type Order,
  type OrderLine,
  type OrderRecord,
  type Payment,
} from '../data/orders';
import { roundMoney } from './currency';

/**
 * Why an order can't be edited, or null when it can. Open tabs change on the
 * register; refunds point at lines by position, so a refunded order is fixed
 * by refunding or deleting it; and an order from before a currency switch is
 * kept exactly as it was taken.
 */
export function editBlocker(order: Order): string | null {
  if (order.status === 'occupied') return 'Open tabs are changed on the register.';
  if ((order.refunds?.length ?? 0) > 0)
    return 'This order has refunds, so it can’t be edited. Refund or delete it instead.';
  if (order.recordedIn) return 'This order was taken before the currency switch, so it can’t be edited.';
  return null;
}

/** Payments on it that were taken as cost-currency cash — kept as they are, since they were counted in their own drawer. */
export function hasLocalCash(order: OrderRecord): boolean {
  return order.payments.some((p) => p.local);
}

/**
 * `order` with new lines. The order discount stays, but never more than the
 * lines come to, and tax is worked out again at the rate the order was taken
 * at — today's rate only if it had nothing to go on.
 */
export function withLines(order: OrderRecord, lines: OrderLine[], fallbackTaxRate: number): OrderRecord {
  const before = orderSubtotal(order);
  const rate = before > 0 ? order.tax / before : fallbackTaxRate;
  const linesTotal = roundMoney(lines.reduce((sum, l) => sum + l.unitPrice * l.qty, 0));
  const discount = Math.min(order.discount ?? 0, linesTotal);
  const next: OrderRecord = { ...order, lines, ...(order.discount !== undefined ? { discount } : {}) };
  return { ...next, tax: roundMoney(orderSubtotal(next) * rate) };
}

/**
 * Why an edit can't be saved, or null when it can. A paid order's payments
 * have to add up to its new total; a room charge has none until the room
 * settles.
 */
export function editProblem(next: OrderRecord, note: string): string | null {
  if (next.lines.length === 0) return 'An order needs at least one item — delete it instead.';
  if (next.lines.some((l) => !Number.isInteger(l.qty) || l.qty <= 0)) return 'Quantities are whole numbers above 0.';
  if (next.lines.some((l) => !(l.unitPrice >= 0))) return 'Prices can’t be below 0.';
  if (next.status === 'paid') {
    if (next.payments.length === 0) return 'A paid order needs a payment.';
    if (next.payments.some((p) => !(p.amount > 0))) return 'Each payment needs an amount above 0.';
    const diff = roundMoney(paidAmount(next.payments) - orderTotal(next));
    if (diff !== 0) return 'Payments have to add up to the new total.';
  }
  if (!note.trim()) return 'Say what changed and why.';
  return null;
}

/**
 * A payment as edited: a changed amount or method drops the cash handed over,
 * since the change worked out from it no longer applies.
 */
export function editedPayment(before: Payment | undefined, method: Payment['method'], amount: number): Payment {
  if (before && before.method === method && before.amount === amount) return before;
  const { tendered: _tendered, ...rest } = before ?? { method, amount };
  return { ...rest, method, amount };
}

/** Units of each item an order still holds — what's left after refunds. */
export function heldItems(order: OrderRecord): { itemId?: string; name: string; qty: number }[] {
  return orderItems(order, (i) => order.lines[i].qty - refundedQty(order, i));
}

/**
 * Stock to move when an order's lines change: more of an item draws stock
 * down, fewer puts it back. Keyed by catalog id, or name for items without one.
 */
export function stockDelta(
  before: OrderRecord,
  after: OrderRecord,
): { itemId?: string; name: string; change: number }[] {
  const tally = new Map<string, { itemId?: string; name: string; change: number }>();
  const add = (items: { itemId?: string; name: string; qty: number }[], sign: number) => {
    for (const i of items) {
      const key = i.itemId ?? `name:${i.name}`;
      const row = tally.get(key) ?? { itemId: i.itemId, name: i.name, change: 0 };
      row.change += sign * i.qty;
      tally.set(key, row);
    }
  };
  // Sold more is stock out (negative); sold less comes back.
  add(orderItems(before), 1);
  add(orderItems(after), -1);
  return [...tally.values()].filter((r) => Math.abs(r.change) > 1e-9);
}

/** The order's total and item count, kept on each edit. */
export function snapshot(order: OrderRecord): { total: number; items: number } {
  return { total: orderTotal(order), items: orderItemCount(order) };
}
