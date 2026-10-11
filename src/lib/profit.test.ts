import { describe, expect, it } from 'vitest';
import type { Expense } from '../data/expenses';
import { dateOfDaysAgo, isoDate } from '../data/history';
import { isoDaysAgo, type StockMovement } from '../data/inventory';
import { hydrateOrder } from '../data/orders';
import type { StaffMember } from '../data/staff';
import type { PayrollRun } from './payroll';
import { profitAndLoss, runDays, wagesIn } from './profit';

/** Today, as a sale of 4 lattes at 10,000 that cost 4,000 each, with tax and a tip. */
const sale = hydrateOrder({
  id: 1,
  name: 'Walk-in',
  status: 'paid',
  at: new Date().toISOString(),
  lines: [{ itemId: 'latte', name: 'Latte', qty: 4, unitPrice: 10_000, unitCost: 4_000 }],
  tax: 7_200,
  tip: 5_000,
  payments: [{ method: 'cash', amount: 52_200 }],
});

const waste: StockMovement = {
  id: 'mv-1',
  itemId: 'milk',
  itemName: 'Milk',
  change: -2,
  stockAfter: 10,
  reason: 'waste',
  unitCost: 1_500,
  date: isoDaysAgo(0),
  time: '9:00 AM',
};

const expense = (amount: number, daysAgo = 0, category: Expense['category'] = 'utilities'): Expense => ({
  id: `exp-${amount}-${daysAgo}`,
  date: isoDaysAgo(daysAgo),
  category,
  description: 'Power',
  amount,
  method: 'cash',
  by: 'Jamie',
});

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

const run = (key: string, gross: number): PayrollRun => ({
  id: `run-${key}`,
  key,
  dates: '',
  paidAt: '',
  paidBy: 'Jamie',
  gross,
  lines: [],
});

describe('payroll days', () => {
  it('reads a whole month and its halves from the run key', () => {
    expect(runDays('2026-02')).toHaveLength(28);
    expect(runDays('2026-09-mid')).toEqual(
      Array.from({ length: 15 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`),
    );
    expect(runDays('2026-09-end')[0]).toBe('2026-09-16');
    expect(runDays('2026-09-end').at(-1)).toBe('2026-09-30');
    expect(runDays('nonsense')).toEqual([]);
  });

  it('spreads a run evenly over the days it pays for', () => {
    const today = dateOfDaysAgo(0);
    const key = monthKey(today);
    const length = runDays(key).length;
    const { wages, covered } = wagesIn([run(key, length * 1_000)], 1);
    expect(wages).toBe(1_000);
    expect(covered.has(isoDate(today))).toBe(true);
    expect(wagesIn([run(key, length * 1_000)], Infinity).wages).toBeLessThanOrEqual(length * 1_000);
  });
});

describe('profit and loss', () => {
  const base = { orders: [sale], days: 1, span: 1, movements: [], payrollRuns: [], expenses: [], staff: [] };

  it('takes cost of goods off sales, leaving tax and tips out', () => {
    const pl = profitAndLoss(base);
    expect(pl.sales).toBe(40_000);
    expect(pl.cost).toBe(16_000);
    expect(pl.grossProfit).toBe(24_000);
    expect(pl.net).toBe(24_000);
  });

  it('takes stock losses, wages, and expenses off gross profit', () => {
    const key = monthKey(dateOfDaysAgo(0));
    const pl = profitAndLoss({
      ...base,
      movements: [waste],
      payrollRuns: [run(key, runDays(key).length * 2_000)],
      expenses: [expense(5_000), expense(9_000, 3, 'rent')],
    });
    expect(pl.stockLosses).toBe(3_000);
    expect(pl.wages).toBe(2_000);
    // Only today's expense is in a one-day window.
    expect(pl.expenseTotal).toBe(5_000);
    expect(pl.expenses).toEqual([{ category: 'utilities', label: 'Utilities', amount: 5_000, count: 1 }]);
    expect(pl.net).toBe(24_000 - 3_000 - 2_000 - 5_000);
  });

  it('goes below zero when costs beat sales', () => {
    const pl = profitAndLoss({ ...base, expenses: [expense(30_000)] });
    expect(pl.net).toBe(-6_000);
    expect(pl.netMargin).toBeCloseTo(-0.15);
  });

  it('estimates wages for days payroll hasn’t covered, without counting them', () => {
    const staff: StaffMember[] = [
      { id: 'a', name: 'A', role: 'barista', pinHash: '', active: true, monthlySalary: 900_000 },
      { id: 'b', name: 'B', role: 'cook', pinHash: '', active: false, monthlySalary: 900_000 },
    ];
    const pl = profitAndLoss({ ...base, staff });
    const [y, m] = isoDaysAgo(0).split('-').map(Number);
    expect(pl.unpaidWageDays).toBe(1);
    expect(pl.unpaidWagesEstimate).toBeCloseTo(900_000 / new Date(y, m, 0).getDate(), 0);
    expect(pl.net).toBe(24_000);
  });
});
