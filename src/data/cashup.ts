import { roundMoney } from '../lib/currency';
import type { OrderRecord, Payment, TenderMethod } from './orders';

export const TENDER_METHODS: TenderMethod[] = ['cash', 'card', 'mobile'];

/** Money by how it was taken. */
export type ByMethod = Record<TenderMethod, number>;

/** A closed front-desk shift: what came in, what went back, and the drawer count. */
export type CashUp = {
  id: string;
  /** ISO timestamp the shift began — the previous cash-up's close, or the start of that day. */
  openedAt: string;
  /** ISO timestamp it was closed. */
  closedAt: string;
  /** Staff id of whoever closed it. */
  by: string;
  /** Cash in the drawer when the shift began. */
  float: number;
  taken: ByMethod;
  refunded: ByMethod;
  /** How many payments were taken. */
  payments: number;
  /** float + cash taken − cash refunded. */
  expectedCash: number;
  countedCash: number;
  note?: string;
};

export type ShiftTotals = { taken: ByMethod; refunded: ByMethod; payments: number };

const zero = (): ByMethod => ({ cash: 0, card: 0, mobile: 0 });

/**
 * Everything taken and given back between `from` (exclusive) and `to`
 * (inclusive) — closed orders' payments, room bills settled, part-payments
 * on bills still open, and refunds. A refund goes back the way the order was
 * paid; a split order's refund is shared across its methods.
 */
export function shiftTotals(
  orders: OrderRecord[],
  openPayments: Payment[],
  from: string,
  to: string,
): ShiftTotals {
  const start = Date.parse(from);
  const end = Date.parse(to);
  const inShift = (iso: string | undefined) => {
    if (!iso) return false;
    const t = Date.parse(iso);
    return t > start && t <= end;
  };
  const totals: ShiftTotals = { taken: zero(), refunded: zero(), payments: 0 };

  const count = (p: Payment, fallback?: string) => {
    if (!inShift(p.at ?? fallback)) return;
    totals.taken[p.method] += p.amount;
    totals.payments++;
  };
  for (const order of orders) {
    // Older payments carry no time of their own: they came in when the order closed or settled.
    for (const p of order.payments) count(p, order.settledAt ?? order.at);
    const paid = order.payments.reduce((sum, p) => sum + p.amount, 0);
    for (const refund of order.refunds ?? []) {
      if (!inShift(refund.at) || paid <= 0) continue;
      for (const p of order.payments) totals.refunded[p.method] += refund.amount * (p.amount / paid);
    }
  }
  for (const p of openPayments) count(p);

  for (const m of TENDER_METHODS) {
    totals.taken[m] = roundMoney(totals.taken[m]);
    totals.refunded[m] = roundMoney(totals.refunded[m]);
  }
  return totals;
}

/** What should be in the drawer: the float plus cash taken, less cash handed back. */
export function expectedCash(float: number, totals: ShiftTotals): number {
  return roundMoney(float + totals.taken.cash - totals.refunded.cash);
}

/** Where the current shift began: the last cash-up's close, or the start of today. */
export function shiftStart(cashUps: CashUp[], now = new Date()): string {
  const last = cashUps.reduce<string | null>((latest, c) => (!latest || c.closedAt > latest ? c.closedAt : latest), null);
  if (last) return last;
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  return midnight.toISOString();
}
