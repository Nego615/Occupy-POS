import { costCurrency, roundMoney, toSales } from '../lib/currency';
import { orderOwed } from './clients';
import type { Expense, ExpenseCategoryId } from './expenses';
import { orderDiscount, orderTotal, paidAmount, type OrderRecord } from './orders';

/**
 * What a shift came to, worked out as it closes and kept with its cash-up:
 * sales, what went on account, what came in on old debts, expenses, and
 * what was still open or owing when it closed. Frozen so it reads the same
 * however the orders change afterwards.
 */
export type ShiftReport = {
  sales: {
    /** Bills closed in the shift — paid, put on account, or charged to a room. */
    bills: number;
    items: number;
    /** What those bills came to, tax and tips included. */
    gross: number;
    discounts: number;
    tax: number;
    tips: number;
    /** Given back in the shift, on any order. */
    refunds: number;
    /** gross − refunds. */
    net: number;
    /** Best sellers by quantity. */
    top: { name: string; qty: number; total: number }[];
  };
  /** Bills from this shift left owing on a client's account. */
  onAccount: { bills: number; amount: number };
  /** Bills from this shift left on a room's bill. */
  toRooms: { bills: number; amount: number };
  /** Paid in the shift toward bills put on account earlier. */
  debtsCollected: number;
  /** Paid in the shift toward room bills charged earlier. */
  roomsSettled: number;
  /** Everything owed on clients' accounts as it closed. */
  owing: { clients: number; amount: number };
  /** Room bills still waiting for checkout as it closed. */
  roomsOwing: { bills: number; amount: number };
  /** Tabs still open as it closed. */
  openTabs: { count: number; total: number; paid: number; tabs: { name: string; total: number }[] };
  /** Logged in the shift. Amounts in the cost currency. */
  expenses: {
    id: string;
    description: string;
    category: ExpenseCategoryId;
    amount: number;
    fromTill: boolean;
  }[];
  /** All of them, in the cost currency. */
  expensesTotal: number;
  /** All of them, in the sales currency. */
  expensesValue: number;
  /** net sales − expenses, in the sales currency. */
  netAfterExpenses: number;
};

const CLOSED = new Set(['paid', 'charged', 'refunded']);

/**
 * The report for a shift running from `from` (exclusive) to `to`
 * (inclusive). `orders` are live orders with open tabs among them as
 * `occupied`; deleted ones are left out.
 */
export function shiftReport(
  orders: OrderRecord[],
  expenses: Expense[],
  from: string,
  to: string,
): ShiftReport {
  const start = Date.parse(from);
  const end = Date.parse(to);
  const inShift = (iso: string | undefined) => {
    if (!iso) return false;
    const t = Date.parse(iso);
    return t > start && t <= end;
  };
  const live = orders.filter((o) => !o.deleted);
  const closed = live.filter((o) => CLOSED.has(o.status) && inShift(o.at));

  // What was still owing on a bill right after it closed: anything paid then is a part payment.
  const owedAtClose = (o: OrderRecord) =>
    roundMoney(
      Math.max(
        0,
        orderTotal(o) - paidAmount(o.payments.filter((p) => !p.at || Date.parse(p.at) <= Date.parse(o.at))),
      ),
    );
  // Paid in the shift on a bill closed before this payment — a debt or room bill paid off.
  const paidLater = (o: OrderRecord) =>
    o.payments
      .filter((p) => p.at && inShift(p.at) && Date.parse(p.at) > Date.parse(o.at))
      .reduce((sum, p) => sum + p.amount, 0);

  const items = new Map<string, { name: string; qty: number; total: number }>();
  for (const o of closed) {
    for (const l of o.lines) {
      const row = items.get(l.name) ?? { name: l.name, qty: 0, total: 0 };
      row.qty += l.qty;
      row.total += l.unitPrice * l.qty;
      items.set(l.name, row);
    }
  }

  let refunds = 0;
  for (const o of live) {
    for (const r of o.refunds ?? []) if (inShift(r.at)) refunds += r.amount;
    // A full refund from before refunds were itemised: all of it, when it closed.
    if (o.status === 'refunded' && !o.refunds?.length && inShift(o.at)) refunds += orderTotal(o);
  }

  const gross = roundMoney(closed.reduce((s, o) => s + orderTotal(o), 0));
  const sum = (list: OrderRecord[], f: (o: OrderRecord) => number) => roundMoney(list.reduce((s, o) => s + f(o), 0));

  const onAccount = closed.filter((o) => o.clientId && owedAtClose(o) > 0);
  const toRooms = closed.filter((o) => o.roomId && !o.clientId && owedAtClose(o) > 0);
  const clientDebts = live.filter((o) => o.status === 'charged' && o.clientId);
  const roomDebts = live.filter((o) => o.status === 'charged' && !o.clientId);
  const open = live.filter((o) => o.status === 'occupied');

  const logged = expenses.filter((e) => inShift(e.at));
  const expensesTotal = roundMoney(logged.reduce((s, e) => s + e.amount, 0), costCurrency());
  const expensesValue = roundMoney(logged.reduce((s, e) => s + toSales(e.amount, e.rate), 0));
  const net = roundMoney(gross - refunds);

  return {
    sales: {
      bills: closed.length,
      items: closed.reduce((s, o) => s + o.lines.reduce((n, l) => n + l.qty, 0), 0),
      gross,
      discounts: sum(closed, orderDiscount),
      tax: sum(closed, (o) => o.tax),
      tips: sum(closed, (o) => o.tip),
      refunds: roundMoney(refunds),
      net,
      top: [...items.values()]
        .sort((a, b) => b.qty - a.qty || b.total - a.total)
        .slice(0, 10)
        .map((r) => ({ ...r, total: roundMoney(r.total) })),
    },
    onAccount: { bills: onAccount.length, amount: sum(onAccount, owedAtClose) },
    toRooms: { bills: toRooms.length, amount: sum(toRooms, owedAtClose) },
    debtsCollected: sum(live.filter((o) => o.clientId), paidLater),
    roomsSettled: sum(live.filter((o) => o.roomId && !o.clientId), paidLater),
    owing: { clients: new Set(clientDebts.map((o) => o.clientId)).size, amount: sum(clientDebts, orderOwed) },
    roomsOwing: { bills: roomDebts.length, amount: sum(roomDebts, orderOwed) },
    openTabs: {
      count: open.length,
      total: sum(open, orderTotal),
      paid: sum(open, (o) => paidAmount(o.payments)),
      tabs: open.map((o) => ({ name: o.name, total: orderTotal(o) })),
    },
    expenses: logged.map((e) => ({
      id: e.id,
      description: e.description,
      category: e.category,
      amount: e.amount,
      fromTill: !!e.fromTill,
    })),
    expensesTotal,
    expensesValue,
    netAfterExpenses: roundMoney(net - expensesValue),
  };
}

/** Cash paid out of the till for expenses in the shift, in the cost currency. */
export function tillPaidOut(expenses: Expense[], from: string, to: string): number {
  const start = Date.parse(from);
  const end = Date.parse(to);
  return roundMoney(
    expenses
      .filter((e) => e.fromTill && e.at && Date.parse(e.at) > start && Date.parse(e.at) <= end)
      .reduce((s, e) => s + e.amount, 0),
    costCurrency(),
  );
}
