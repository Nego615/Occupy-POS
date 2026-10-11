import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CatalogItem } from '../data/catalog';
import type { Expense } from '../data/expenses';
import { isoDaysAgo, type PurchaseOrder } from '../data/inventory';
import { exchangeRate } from '../data/settings';
import { costCurrency, costDue, setActiveCurrency, setCostCurrency, toCost, toSales } from './currency';
import { lastPaid, receiveAgainst } from './inventory';
import type { PayrollRun } from './payroll';
import { expensesByCategory, wagesIn } from './profit';

/** A shop selling in dollars and buying in shillings, at TSh 2,500 to $1. */
const RATE = 2_500;

beforeEach(() => {
  setActiveCurrency('USD');
  setCostCurrency('TZS');
});

afterEach(() => {
  setActiveCurrency('TZS');
  setCostCurrency(null);
});

describe('currencies', () => {
  it('converts both ways, rounding to each side’s smallest unit', () => {
    expect(toSales(10_000, RATE)).toBe(4);
    expect(toSales(1_234, RATE)).toBe(0.49);
    expect(toCost(4.99, RATE)).toBe(12_475);
    expect(toCost(0.333, RATE)).toBe(833);
  });

  it('rounds cash due in the cost currency up, so it always covers the bill', () => {
    expect(costDue(40, 2_650)).toBe(106_000);
    expect(costDue(40.01, 2_650)).toBe(106_027);
    expect(costDue(4.1, 2_650)).toBe(10_865);
  });

  it('is a no-op without a rate', () => {
    expect(toSales(1_234)).toBe(1_234);
    expect(toCost(4.99)).toBe(4.99);
  });

  it('buys in what it sells in unless told otherwise', () => {
    setCostCurrency(null);
    expect(costCurrency().code).toBe('USD');
    setCostCurrency('USD');
    expect(costCurrency().code).toBe('USD');
    setCostCurrency('TZS');
    expect(costCurrency().code).toBe('TZS');
  });

  it('has a rate only when buying in another currency', () => {
    expect(exchangeRate({ currency: 'USD', costCurrency: 'TZS', exchangeRate: RATE })).toBe(RATE);
    expect(exchangeRate({ currency: 'USD', costCurrency: 'USD', exchangeRate: RATE })).toBeUndefined();
    expect(exchangeRate({ currency: 'USD', exchangeRate: RATE })).toBeUndefined();
  });
});

describe('deliveries in the cost currency', () => {
  const soda: CatalogItem = {
    id: 'soda',
    name: 'Soda',
    price: 2,
    color: '#000',
    category: 'drinks',
    available: true,
    stock: 10,
    cost: 0.4,
  };
  const order: PurchaseOrder = {
    id: 'PO-1',
    supplierId: 'sup',
    status: 'ordered',
    lines: [{ itemId: 'soda', name: 'Soda', qty: 10, unitCost: 1_500, received: 0 }],
    createdAt: isoDaysAgo(1),
    createdBy: 'Jamie',
    orderedAt: isoDaysAgo(1),
  };

  it('averages item costs in dollars and bills in shillings', () => {
    const result = receiveAgainst(order, [soda], [{ itemId: 'soda', qty: 10, unitCost: 1_500 }], RATE);
    // 10 on hand at $0.40, 10 in at TSh 1,500 = $0.60.
    expect(result.catalog[0].cost).toBe(0.5);
    expect(result.entries[0].unitCost).toBe(0.6);
    expect(result.amount).toBe(15_000);
    expect(result.order.lines[0].unitCost).toBe(1_500);
  });

  it('remembers what an item last cost in the cost currency', () => {
    const received = { ...order, status: 'received' as const, lines: [{ ...order.lines[0], received: 10 }] };
    expect(lastPaid([order, received], 'soda')).toBe(1_500);
    expect(lastPaid([order], 'soda')).toBeUndefined();
  });
});

describe('profit in the sales currency', () => {
  const expense = (amount: number, rate?: number): Expense => ({
    id: `exp-${amount}`,
    date: isoDaysAgo(0),
    category: 'rent',
    description: 'Rent',
    amount,
    method: 'bank',
    by: 'Jamie',
    ...(rate ? { rate } : {}),
  });

  it('converts each expense at the rate saved with it, else today’s', () => {
    const [rent] = expensesByCategory([expense(250_000, 2_500), expense(260_000)], 2_600);
    expect(rent.amount).toBe(200);
    // Without a rate, the totals stay in shillings for the Expenses page.
    expect(expensesByCategory([expense(250_000, 2_500)])[0].amount).toBe(250_000);
  });

  it('converts wages at the rate the run was paid at', () => {
    // Last month, so every day it pays for is already past.
    const now = new Date();
    const last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const key = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}`;
    const run: PayrollRun = { id: 'run', key, dates: '', paidAt: '', paidBy: 'Jamie', gross: 3_000_000, rate: 2_500, lines: [] };
    expect(wagesIn([run], Infinity, 2_000).wages).toBe(1_200);
  });
});
