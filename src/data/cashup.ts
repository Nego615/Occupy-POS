import { costCurrency, roundMoney, type CurrencyCode } from '../lib/currency';
import type { OrderRecord, Payment, TenderMethod } from './orders';

export const TENDER_METHODS: TenderMethod[] = ['cash', 'card', 'mobile'];

/** Money by how it was taken. */
export type ByMethod = Record<TenderMethod, number>;

/** A closed counter shift: what came in, what went back, and the drawer count. */
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
  /** The drawer of cash taken in the cost currency, when the shop takes it — counted on its own. */
  local?: LocalDrawer;
  note?: string;
};

/** Cash in the cost currency, in its own drawer: amounts in that currency. */
export type LocalDrawer = {
  currency: CurrencyCode;
  float: number;
  taken: number;
  refunded: number;
  /** float + taken − refunded. */
  expected: number;
  counted: number;
};

export type ShiftTotals = {
  taken: ByMethod;
  refunded: ByMethod;
  payments: number;
  /**
   * Cash taken and given back in the cost currency, in that currency. What it
   * came to in the sales currency (`value`) is part of `taken.cash` and
   * `refunded.cash` — but sits in the other drawer.
   */
  local: { taken: number; refunded: number; value: { taken: number; refunded: number } };
};

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
  const totals: ShiftTotals = {
    taken: zero(),
    refunded: zero(),
    payments: 0,
    local: { taken: 0, refunded: 0, value: { taken: 0, refunded: 0 } },
  };

  const count = (p: Payment, fallback?: string) => {
    if (!inShift(p.at ?? fallback)) return;
    totals.taken[p.method] += p.amount;
    totals.payments++;
    if (p.local) {
      totals.local.taken += p.local.amount;
      totals.local.value.taken += p.amount;
    }
  };
  for (const order of orders) {
    // Older payments carry no time of their own: they came in when the order closed or settled.
    for (const p of order.payments) count(p, order.settledAt ?? order.at);
    const paid = order.payments.reduce((sum, p) => sum + p.amount, 0);
    for (const refund of order.refunds ?? []) {
      if (!inShift(refund.at) || paid <= 0) continue;
      for (const p of order.payments) {
        const share = refund.amount * (p.amount / paid);
        totals.refunded[p.method] += share;
        // A share of cash taken in the cost currency goes back in it, at that payment's rate.
        if (p.local) {
          totals.local.refunded += share * p.local.rate;
          totals.local.value.refunded += share;
        }
      }
    }
  }
  for (const p of openPayments) count(p);

  for (const m of TENDER_METHODS) {
    totals.taken[m] = roundMoney(totals.taken[m]);
    totals.refunded[m] = roundMoney(totals.refunded[m]);
  }
  totals.local.refunded = roundMoney(totals.local.refunded, costCurrency());
  return totals;
}

/**
 * What should be in the drawer: the float plus cash taken, less cash handed
 * back — leaving out cash in the cost currency, which has its own drawer.
 */
export function expectedCash(float: number, totals: ShiftTotals): number {
  const { value } = totals.local;
  return roundMoney(float + totals.taken.cash - value.taken - (totals.refunded.cash - value.refunded));
}

/** What should be in the cost-currency drawer, in that currency. */
export function expectedLocalCash(float: number, totals: ShiftTotals): number {
  return roundMoney(float + totals.local.taken - totals.local.refunded, costCurrency());
}

/** Where the current shift began: the last cash-up's close, or the start of today. */
export function shiftStart(cashUps: CashUp[], now = new Date()): string {
  const last = cashUps.reduce<string | null>((latest, c) => (!latest || c.closedAt > latest ? c.closedAt : latest), null);
  if (last) return last;
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  return midnight.toISOString();
}
