import { expenseCategoryLabel, type Expense, type ExpenseCategoryId } from '../data/expenses';
import { isoDaysAgo, type StockMovement } from '../data/inventory';
import type { Order } from '../data/orders';
import type { StaffMember } from '../data/staff';
import { round } from './cart';
import { isoInLastDays, losses, margins } from './costReports';
import type { PayrollRun } from './payroll';
import { ledger } from './reports';

/**
 * Profit and loss over a window:
 *
 *   sales − cost of goods = gross profit
 *   gross profit − stock written off − wages − expenses = net profit (or loss)
 *
 * Sales are item sales after discounts and refunds. Tax is left out (it's
 * owed to the government) and so are tips (they're the staff's). Supplier
 * deliveries aren't costs here — stock is costed when it sells, so counting
 * the delivery too would count it twice.
 *
 * Everything comes out in the sales currency. Wages and expenses are paid in
 * the cost currency, so each is converted at the rate saved with it.
 */

export type ExpenseLine = { category: ExpenseCategoryId; label: string; amount: number; count: number };

export type ProfitLoss = {
  sales: number;
  /** Cost of goods sold, at each item's cost when it sold. */
  cost: number;
  /** Sales with no item cost recorded — their cost is missing from `cost`. */
  uncostedSales: number;
  grossProfit: number;
  /** Stock wasted, found missing at a count, or corrected down — less any found extra. */
  stockLosses: number;
  /** Salaries from payroll marked paid, spread over the days each run covers. */
  wages: number;
  expenses: ExpenseLine[];
  expenseTotal: number;
  /** Below zero is a loss. */
  net: number;
  /** Net over sales; 0 with no sales. */
  netMargin: number;
  /** Days in the window no payroll run covers, while staff are on salaries. */
  unpaidWageDays: number;
  /** Those days at today's salaries — not included in `net`. */
  unpaidWagesEstimate: number;
};

export type ProfitInput = {
  /** Orders already narrowed to the window. */
  orders: Order[];
  /** The window's length; Infinity for all time. */
  days: number;
  /** The window in whole days back to the oldest order — finite even for all time. */
  span: number;
  /** Days ago the window ends; 0, the default, is today. */
  end?: number;
  movements: StockMovement[];
  payrollRuns: PayrollRun[];
  expenses: Expense[];
  staff: StaffMember[];
  /**
   * Today's cost-currency units to one sales unit, when the shop buys in
   * another currency: for wages and expenses saved without a rate, and for
   * the estimate of wages not yet paid.
   */
  rate?: number;
};

/** A cost-currency amount in the sales currency, unrounded — totals round once. */
const inSales = (amount: number, rate?: number) => (rate ? amount / rate : amount);

export function profitAndLoss(input: ProfitInput): ProfitLoss {
  const { orders, days, span, end = 0, movements, payrollRuns, expenses, staff, rate } = input;

  const sales = ledger(orders).itemSales;
  const m = margins(orders);
  const grossProfit = round(sales - m.cost);
  const stockLosses = round(-losses(movements, days, end).net);

  const { wages, covered } = wagesIn(payrollRuns, days, rate, end);
  const lines = expensesByCategory(
    expenses.filter((e) => isoInLastDays(e.date, days, end)),
    rate,
  );
  const expenseTotal = round(lines.reduce((s, l) => s + l.amount, 0));
  const net = round(grossProfit - stockLosses - wages - expenseTotal);

  const unpaid = unpaidWages(covered, Math.min(days, span), staff, rate, end);

  return {
    sales,
    cost: m.cost,
    uncostedSales: m.uncostedSales,
    grossProfit,
    stockLosses,
    wages,
    expenses: lines,
    expenseTotal,
    net,
    netMargin: sales > 0 ? net / sales : 0,
    unpaidWageDays: unpaid.days,
    unpaidWagesEstimate: unpaid.estimate,
  };
}

/**
 * Expenses totalled by category — in the cost currency they were paid in, or
 * given `rate`, in the sales currency, each at the rate saved with it.
 */
export function expensesByCategory(expenses: Expense[], rate?: number): ExpenseLine[] {
  const tally = new Map<ExpenseCategoryId, ExpenseLine>();
  for (const e of expenses) {
    const line = tally.get(e.category) ?? {
      category: e.category,
      label: expenseCategoryLabel(e.category),
      amount: 0,
      count: 0,
    };
    line.amount = round(line.amount + (rate ? inSales(e.amount, e.rate ?? rate) : e.amount));
    line.count += 1;
    tally.set(e.category, line);
  }
  return [...tally.values()].sort((a, b) => b.amount - a.amount);
}

/* ---------- Wages ---------- */

/**
 * The days a payroll run pays for, from its key: "2026-08" is all of August,
 * "2026-08-mid" the 1st–15th, "2026-08-end" the 16th to month end.
 */
export function runDays(key: string): string[] {
  const match = /^(\d{4})-(\d{2})(?:-(mid|end))?$/.exec(key);
  if (!match) return [];
  const [year, month] = [Number(match[1]), Number(match[2])];
  const last = new Date(year, month, 0).getDate();
  const [from, to] = match[3] === 'mid' ? [1, 15] : match[3] === 'end' ? [16, last] : [1, last];
  const out: string[] = [];
  for (let d = from; d <= to; d++) {
    out.push(`${match[1]}-${match[2]}-${String(d).padStart(2, '0')}`);
  }
  return out;
}

/**
 * Wages that fall in the window. Each run's gross is spread evenly over the
 * days it pays for, so a month paid on the 30th still lands across the month
 * it was earned in. Given `rate`, they're in the sales currency, each run at
 * the rate saved with it.
 */
export function wagesIn(
  runs: PayrollRun[],
  days: number,
  rate?: number,
  end = 0,
): { wages: number; covered: Set<string> } {
  let wages = 0;
  const covered = new Set<string>();
  for (const run of runs) {
    const span = runDays(run.key);
    if (span.length === 0) continue;
    const perDay = (rate ? inSales(run.gross, run.rate ?? rate) : run.gross) / span.length;
    for (const day of span) {
      covered.add(day);
      if (isoInLastDays(day, days, end)) wages += perDay;
    }
  }
  return { wages: round(wages), covered };
}

/** Days in the window (`days` ending `end` days ago) no run pays for, priced at today's salaries. */
function unpaidWages(
  covered: Set<string>,
  days: number,
  staff: StaffMember[],
  rate?: number,
  end = 0,
): { days: number; estimate: number } {
  const monthly = staff
    .filter((m) => m.active && !m.deleted && m.monthlySalary)
    .reduce((s, m) => s + m.monthlySalary!, 0);
  if (monthly === 0) return { days: 0, estimate: 0 };

  let count = 0;
  let estimate = 0;
  for (let ago = end; ago < end + days; ago++) {
    const iso = isoDaysAgo(ago);
    if (covered.has(iso)) continue;
    const [y, m] = iso.split('-').map(Number);
    count += 1;
    estimate += monthly / new Date(y, m, 0).getDate();
  }
  return { days: count, estimate: round(inSales(estimate, rate)) };
}
