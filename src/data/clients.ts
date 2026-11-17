import { roundMoney } from '../lib/currency';
import { orderTotal, paidAmount, type OrderRecord, type Payment } from './orders';

/**
 * A regular: someone the shop knows by name, who can run up a debt — bills
 * put on their account to be paid later, in one go or a bit at a time.
 */
export type Client = {
  id: string;
  name: string;
  phone?: string;
  /** Anything worth remembering — where they work, who vouches for them. */
  note?: string;
  /** The most they may owe at once, in the sales currency. Absent means no limit. */
  creditLimit?: number;
  /** ISO timestamp they were added. */
  createdAt: string;
  /** Kept for their history, but no longer offered for new debts. */
  archived?: true;
};

/** What's still owed on an order: its total less anything already paid toward it. */
export function orderOwed(order: OrderRecord): number {
  if (order.status !== 'charged') return 0;
  return roundMoney(Math.max(0, orderTotal(order) - paidAmount(order.payments)));
}

/** A client's unpaid bills, oldest first — the order they're paid off in. */
export function debtsOf(orders: OrderRecord[], clientId: string): OrderRecord[] {
  return orders
    .filter((o) => o.clientId === clientId && o.status === 'charged' && !o.deleted)
    .sort((a, b) => a.at.localeCompare(b.at));
}

/** Everything a client owes right now. */
export function clientBalance(orders: OrderRecord[], clientId: string): number {
  return roundMoney(debtsOf(orders, clientId).reduce((sum, o) => sum + orderOwed(o), 0));
}

/** Whether putting `amount` more on a client's account keeps them within their limit. */
export function withinLimit(client: Client, owing: number, amount: number): boolean {
  return client.creditLimit === undefined || roundMoney(owing + amount) <= client.creditLimit;
}

/**
 * Shares one payment from a client across their unpaid bills, oldest first.
 * Each bill gets its part as a payment of its own; bills it pays off are
 * returned settled. Never more than is owed — the rest is `left`.
 */
export function allocatePayment(
  debts: OrderRecord[],
  payment: Payment,
  settledAt: string,
): { orders: Map<number, OrderRecord>; applied: number; left: number } {
  const out = new Map<number, OrderRecord>();
  let left = payment.amount;
  for (const order of debts) {
    if (left <= 0) break;
    const owed = orderOwed(order);
    if (owed <= 0) continue;
    const part = roundMoney(Math.min(owed, left));
    left = roundMoney(left - part);
    // The cash itself, when it was in the cost currency, is shared in proportion.
    const local = payment.local && {
      ...payment.local,
      amount: payment.local.amount * (part / payment.amount),
      tendered: payment.local.amount * (part / payment.amount),
    };
    const { tendered: _tendered, ...rest } = payment;
    const share: Payment = { ...rest, amount: part, ...(local ? { local } : {}) };
    const payments = [...order.payments, share];
    const done = paidAmount(payments) >= orderTotal(order);
    out.set(order.id, {
      ...order,
      payments,
      ...(done ? { status: 'paid' as const, settledAt } : {}),
    });
  }
  return { orders: out, applied: roundMoney(payment.amount - left), left };
}
