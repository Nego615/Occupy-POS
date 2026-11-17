import { describe, expect, it } from 'vitest';
import { expectedCash, shiftTotals } from './cashup';
import type { Expense } from './expenses';
import type { OrderRecord } from './orders';
import { shiftReport, tillPaidOut } from './shiftReport';

const order = (id: number, at: string, total: number, extra: Partial<OrderRecord> = {}): OrderRecord => ({
  id,
  name: `Table ${id}`,
  status: 'paid',
  at,
  lines: [{ name: 'Beer', qty: 2, unitPrice: total / 2 }],
  tax: 0,
  tip: 0,
  payments: [{ method: 'cash', amount: total, at }],
  ...extra,
});

const expense = (id: string, at: string, amount: number, fromTill = false): Expense => ({
  id,
  date: at.slice(0, 10),
  category: 'supplies',
  description: `Ice ${id}`,
  amount,
  method: 'cash',
  by: 'Asha',
  at,
  ...(fromTill ? { fromTill: true as const } : {}),
});

const FROM = '2026-11-17T08:00:00.000Z';
const TO = '2026-11-17T16:00:00.000Z';

describe('shift report', () => {
  const orders: OrderRecord[] = [
    order(1, '2026-11-17T09:00:00.000Z', 10_000),
    // Before the shift: not its sale.
    order(2, '2026-11-17T07:00:00.000Z', 6_000),
    // Part paid, the rest on account.
    order(3, '2026-11-17T10:00:00.000Z', 8_000, {
      status: 'charged',
      clientId: 'juma',
      payments: [{ method: 'cash', amount: 3_000, at: '2026-11-17T09:59:00.000Z' }],
    }),
    // An older debt, part paid off in the shift.
    order(4, '2026-11-15T20:00:00.000Z', 5_000, {
      status: 'charged',
      clientId: 'amina',
      payments: [{ method: 'mobile', amount: 2_000, at: '2026-11-17T12:00:00.000Z' }],
    }),
    // Still open.
    order(5, '2026-11-17T15:00:00.000Z', 4_000, { status: 'occupied', payments: [] }),
  ];
  const expenses = [
    expense('a', '2026-11-17T11:00:00.000Z', 1_500, true),
    expense('b', '2026-11-17T12:00:00.000Z', 2_000),
    expense('c', '2026-11-16T12:00:00.000Z', 9_000, true),
  ];
  const report = shiftReport(orders, expenses, FROM, TO);

  it('counts only bills closed in the chosen hours', () => {
    expect(report.sales.bills).toBe(2);
    expect(report.sales.gross).toBe(18_000);
    expect(report.sales.items).toBe(4);
    expect(report.sales.top[0]).toMatchObject({ name: 'Beer', qty: 4 });
  });

  it('reports new debts, debts paid off and what is owed', () => {
    expect(report.onAccount).toEqual({ bills: 1, amount: 5_000 });
    expect(report.debtsCollected).toBe(2_000);
    expect(report.owing).toEqual({ clients: 2, amount: 8_000 });
  });

  it('lists open tabs and expenses', () => {
    expect(report.openTabs).toMatchObject({ count: 1, total: 4_000, paid: 0 });
    expect(report.expenses.map((e) => e.id)).toEqual(['a', 'b']);
    expect(report.expensesTotal).toBe(3_500);
    expect(report.netAfterExpenses).toBe(14_500);
  });

  it('takes cash paid out of the till off the cash expected', () => {
    const paidOut = tillPaidOut(expenses, FROM, TO);
    expect(paidOut).toBe(1_500);
    const totals = shiftTotals(orders.filter((o) => o.status !== 'occupied'), [], FROM, TO);
    // 10,000 + 3,000 cash taken, from a 1,000 float, less 1,500 paid out.
    expect(expectedCash(1_000, totals, paidOut)).toBe(12_500);
  });
});
