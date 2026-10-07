import { describe, expect, it } from 'vitest';
import { expectedCash, shiftStart, shiftTotals, type CashUp } from './cashup';
import type { OrderRecord } from './orders';

const order = (patch: Partial<OrderRecord>): OrderRecord => ({
  id: 1,
  name: 'Table 1',
  status: 'paid',
  at: '2026-10-07T10:00:00.000Z',
  lines: [{ name: 'Tea', qty: 1, unitPrice: 10_000 }],
  tax: 0,
  tip: 0,
  payments: [],
  ...patch,
});

const FROM = '2026-10-07T08:00:00.000Z';
const TO = '2026-10-07T18:00:00.000Z';

describe('shiftTotals', () => {
  it('adds up payments in the shift by method, and leaves out the ones before it', () => {
    const orders = [
      order({ id: 1, payments: [{ method: 'cash', amount: 10_000, tendered: 20_000, at: '2026-10-07T09:00:00.000Z' }] }),
      order({ id: 2, payments: [{ method: 'card', amount: 6_000, at: '2026-10-07T12:00:00.000Z' }] }),
      order({ id: 3, payments: [{ method: 'cash', amount: 4_000, at: '2026-10-07T07:59:00.000Z' }] }),
    ];
    const totals = shiftTotals(orders, [], FROM, TO);
    // Cash is what went toward bills — change handed back never stayed in the drawer.
    expect(totals.taken).toEqual({ cash: 10_000, card: 6_000, mobile: 0 });
    expect(totals.payments).toBe(2);
  });

  it('dates older payments by when their order closed or its room settled', () => {
    const orders = [
      order({ id: 1, at: '2026-10-07T09:00:00.000Z', payments: [{ method: 'mobile', amount: 5_000 }] }),
      order({
        id: 2,
        at: '2026-10-06T20:00:00.000Z',
        settledAt: '2026-10-07T11:00:00.000Z',
        payments: [{ method: 'card', amount: 8_000 }],
      }),
    ];
    expect(shiftTotals(orders, [], FROM, TO).taken).toEqual({ cash: 0, card: 8_000, mobile: 5_000 });
  });

  it('counts part-payments on bills still open', () => {
    const totals = shiftTotals([], [{ method: 'cash', amount: 3_000, at: '2026-10-07T13:00:00.000Z' }], FROM, TO);
    expect(totals.taken.cash).toBe(3_000);
  });

  it('gives a refund back the way the order was paid, shared across a split', () => {
    const orders = [
      order({
        payments: [
          { method: 'cash', amount: 6_000, at: '2026-10-07T09:00:00.000Z' },
          { method: 'card', amount: 4_000, at: '2026-10-07T09:00:00.000Z' },
        ],
        refunds: [
          {
            id: 'R1-1',
            at: '2026-10-07T10:00:00.000Z',
            lines: [{ index: 0, qty: 1 }],
            subtotal: 5_000,
            tax: 0,
            amount: 5_000,
            reason: 'Wrong item',
            by: 'staff-1',
            restocked: false,
          },
        ],
      }),
    ];
    expect(shiftTotals(orders, [], FROM, TO).refunded).toEqual({ cash: 3_000, card: 2_000, mobile: 0 });
  });
});

describe('expectedCash', () => {
  it('is the float plus cash taken, less cash refunded', () => {
    const totals = { taken: { cash: 50_000, card: 0, mobile: 0 }, refunded: { cash: 5_000, card: 0, mobile: 0 }, payments: 3 };
    expect(expectedCash(20_000, totals)).toBe(65_000);
  });
});

describe('shiftStart', () => {
  it('starts after the last cash-up, or at midnight when there is none', () => {
    const now = new Date('2026-10-07T15:00:00');
    expect(shiftStart([], now)).toBe(new Date('2026-10-07T00:00:00').toISOString());
    const done = [{ closedAt: '2026-10-07T09:00:00.000Z' }, { closedAt: '2026-10-07T12:00:00.000Z' }] as CashUp[];
    expect(shiftStart(done, now)).toBe('2026-10-07T12:00:00.000Z');
  });
});
