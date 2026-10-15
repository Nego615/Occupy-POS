import { describe, expect, it } from 'vitest';
import { hydrateOrder, orderTotal, type OrderRecord } from '../data/orders';
import { editBlocker, editProblem, editedPayment, stockDelta, withLines } from './orderEdits';

const soda = { itemId: 'soda', name: 'Soda', qty: 3, unitPrice: 1_000 };
const chips = { itemId: 'chips', name: 'Chips', qty: 1, unitPrice: 3_000 };
// 6,000 of items at 18% tax = 1,080.
const record: OrderRecord = {
  id: 7,
  name: 'Table 2',
  status: 'paid',
  at: new Date().toISOString(),
  lines: [soda, chips],
  tax: 1_080,
  tip: 0,
  payments: [{ method: 'cash', amount: 7_080, tendered: 10_000 }],
};

describe('editing a closed order', () => {
  it('works tax out again at the rate the order was taken at', () => {
    const next = withLines(record, [{ ...soda, qty: 2 }, chips], 0);
    expect(next.tax).toBe(900); // 5,000 × 18%
    expect(orderTotal(next)).toBe(5_900);
  });

  it('never leaves the order discount above what the lines come to', () => {
    const discounted = { ...record, discount: 4_000 };
    expect(withLines(discounted, [chips], 0.18).discount).toBe(3_000);
  });

  it('needs payments to add up to the new total, and a reason', () => {
    const next = withLines(record, [{ ...soda, qty: 2 }, chips], 0);
    expect(editProblem(next, 'Customer had 2 sodas')).toBe('Payments have to add up to the new total.');
    const repaid = { ...next, payments: [editedPayment(record.payments[0], 'cash', 5_900)] };
    expect(editProblem(repaid, '')).toBe('Say what changed and why.');
    expect(editProblem(repaid, 'Customer had 2 sodas')).toBeNull();
    // The cash handed over no longer matches, so it's dropped.
    expect(repaid.payments[0].tendered).toBeUndefined();
  });

  it('refuses an order with no items left', () => {
    expect(editProblem({ ...record, lines: [] }, 'x')).toMatch(/delete it instead/);
  });

  it('moves stock only for the difference', () => {
    const next = withLines(record, [{ ...soda, qty: 2 }, { ...chips, qty: 2 }], 0);
    const delta = stockDelta(record, next);
    expect(delta).toEqual([
      { itemId: 'soda', name: 'Soda', change: 1 }, // one fewer sold, back on the shelf
      { itemId: 'chips', name: 'Chips', change: -1 }, // one more sold
    ]);
  });

  it('is blocked for refunded orders and open tabs', () => {
    expect(editBlocker(hydrateOrder(record))).toBeNull();
    expect(editBlocker(hydrateOrder({ ...record, status: 'occupied' }))).toMatch(/register/);
    const refunded = {
      ...record,
      refunds: [{ id: 'R7-1', at: record.at, lines: [], subtotal: 0, tax: 0, amount: 0, reason: 'x', by: 'a', restocked: false }],
    };
    expect(editBlocker(hydrateOrder(refunded))).toMatch(/refunds/);
  });
});
