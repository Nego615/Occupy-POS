import { describe, expect, it } from 'vitest';
import { allocatePayment, clientBalance, debtsOf, orderOwed, withinLimit, type Client } from './clients';
import { shiftTotals } from './cashup';
import type { OrderRecord } from './orders';

const debt = (id: number, at: string, total: number, extra: Partial<OrderRecord> = {}): OrderRecord => ({
  id,
  name: 'Walk-in',
  status: 'charged',
  at,
  clientId: 'juma',
  lines: [{ name: 'Beer', qty: 1, unitPrice: total }],
  tax: 0,
  tip: 0,
  payments: [],
  ...extra,
});

const juma: Client = { id: 'juma', name: 'Juma', createdAt: '2026-11-01T00:00:00.000Z' };

describe('client debts', () => {
  const orders = [
    debt(2, '2026-11-10T20:00:00.000Z', 5_000),
    debt(1, '2026-11-09T20:00:00.000Z', 8_000, {
      // Paid 3,000 at the till before the rest went on account.
      payments: [{ method: 'cash', amount: 3_000, at: '2026-11-09T19:59:00.000Z' }],
    }),
    debt(3, '2026-11-11T20:00:00.000Z', 4_000, { clientId: 'other' }),
    { ...debt(4, '2026-11-08T20:00:00.000Z', 9_000), status: 'paid' as const },
  ];

  it('counts what each unpaid bill still owes', () => {
    expect(orderOwed(orders[1])).toBe(5_000);
    expect(debtsOf(orders, 'juma').map((o) => o.id)).toEqual([1, 2]);
    expect(clientBalance(orders, 'juma')).toBe(10_000);
  });

  it('pays the oldest bill off first and keeps the rest owing', () => {
    const at = '2026-11-12T10:00:00.000Z';
    const { orders: paid, applied, left } = allocatePayment(
      debtsOf(orders, 'juma'),
      { method: 'mobile', amount: 7_000, at, ref: 'QK1' },
      at,
    );
    expect(applied).toBe(7_000);
    expect(left).toBe(0);
    expect(paid.get(1)).toMatchObject({ status: 'paid', settledAt: at });
    expect(paid.get(1)!.payments.at(-1)).toMatchObject({ method: 'mobile', amount: 5_000, ref: 'QK1' });
    expect(paid.get(2)).toMatchObject({ status: 'charged' });
    expect(orderOwed(paid.get(2)!)).toBe(3_000);
  });

  it('never takes more than is owed', () => {
    const at = '2026-11-12T10:00:00.000Z';
    const { applied, left } = allocatePayment(debtsOf(orders, 'juma'), { method: 'cash', amount: 12_000, tendered: 12_000 }, at);
    expect(applied).toBe(10_000);
    expect(left).toBe(2_000);
  });

  it('puts debt payments in the shift they came in', () => {
    const at = '2026-11-12T10:00:00.000Z';
    const { orders: paid } = allocatePayment(debtsOf(orders, 'juma'), { method: 'cash', amount: 6_000, at }, at);
    const after = orders.map((o) => paid.get(o.id) ?? o);
    const totals = shiftTotals(after, [], '2026-11-12T00:00:00.000Z', '2026-11-12T23:59:00.000Z');
    expect(totals.taken.cash).toBe(6_000);
  });

  it('keeps clients within their limit', () => {
    expect(withinLimit(juma, 10_000, 50_000)).toBe(true);
    expect(withinLimit({ ...juma, creditLimit: 15_000 }, 10_000, 5_000)).toBe(true);
    expect(withinLimit({ ...juma, creditLimit: 15_000 }, 10_000, 5_001)).toBe(false);
  });
});
