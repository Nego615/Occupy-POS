import { describe, expect, it } from 'vitest';
import type { CatalogItem } from '../data/catalog';
import type { CashUp } from '../data/cashup';
import type { StockCount, StockMovement } from '../data/inventory';
import { cashUpStock, countResult, movementTime, shiftStock, shiftWindows } from './shiftStock';

const item = (id: string, stock: number, extra: Partial<CatalogItem> = {}): CatalogItem => ({
  id,
  name: id,
  price: 10,
  color: '#000',
  category: 'drinks',
  available: true,
  stock,
  cost: 4,
  ...extra,
});

const mv = (itemId: string, change: number, at: string, extra: Partial<StockMovement> = {}): StockMovement => ({
  id: `mv-${itemId}-${at}-${change}`,
  itemId,
  itemName: itemId,
  change,
  stockAfter: 0,
  reason: 'sale',
  date: at.slice(0, 10),
  time: '',
  at,
  ...extra,
});

const cashUp = (id: string, openedAt: string, closedAt: string, extra: Partial<CashUp> = {}): CashUp => ({
  id,
  openedAt,
  closedAt,
  by: 'staff-1',
  float: 0,
  taken: { cash: 0, card: 0, mobile: 0 },
  refunded: { cash: 0, card: 0, mobile: 0 },
  payments: 0,
  expectedCash: 0,
  countedCash: 0,
  ...extra,
});

describe('when a movement happened', () => {
  it('reads the timestamp when there is one', () => {
    expect(movementTime({ at: '2026-10-19T10:00:00.000Z', date: '2026-10-19', time: '' })).toBe(
      Date.parse('2026-10-19T10:00:00.000Z'),
    );
  });

  it('falls back to the day and the 12-hour time older movements kept', () => {
    expect(movementTime({ date: '2026-10-19', time: '2:05 PM' })).toBe(new Date(2026, 9, 19, 14, 5).getTime());
    expect(movementTime({ date: '2026-10-19', time: '12:30 AM' })).toBe(new Date(2026, 9, 19, 0, 30).getTime());
    // toLocaleTimeString puts a narrow no-break space before AM/PM.
    expect(movementTime({ date: '2026-10-19', time: '9:15 AM' })).toBe(new Date(2026, 9, 19, 9, 15).getTime());
  });
});

describe('stock across a shift', () => {
  const from = '2026-10-19T08:00:00.000Z';
  const to = '2026-10-19T16:00:00.000Z';

  it('works opening stock back from what is on hand, without snapshots', () => {
    // 20 on hand now: 10 delivered and 4 sold in the shift, 2 sold after it.
    const rows = shiftStock(
      [item('beer', 20)],
      [
        mv('beer', 10, '2026-10-19T09:00:00.000Z', { reason: 'received' }),
        mv('beer', -4, '2026-10-19T12:00:00.000Z'),
        mv('beer', -2, '2026-10-19T17:00:00.000Z'),
        mv('beer', -1, '2026-10-19T07:00:00.000Z'),
      ],
      [],
      { id: 'c1', from, to },
    );
    expect(rows).toEqual([
      expect.objectContaining({ opening: 16, received: 10, sold: -4, expected: 22, closing: 22, variance: 0 }),
    ]);
  });

  it('takes opening and closing from the snapshots, and the closing count as the variance', () => {
    const count: StockCount = {
      id: 'COUNT-7',
      scope: 'Shift close',
      date: '2026-10-19',
      time: '',
      by: 'Amina',
      lines: [{ itemId: 'gin', name: 'gin', expected: 6.5, counted: 6, unitCost: 30 }],
      skipped: 0,
    };
    const rows = shiftStock(
      [item('gin', 6), item('cocktail', 0, { untracked: true })],
      [
        mv('gin', -1.5, '2026-10-19T12:00:00.000Z'),
        mv('gin', 0.5, '2026-10-19T13:00:00.000Z', { reason: 'refund' }),
        mv('gin', -0.5, '2026-10-19T14:00:00.000Z', { reason: 'waste' }),
        mv('gin', -0.5, '2026-10-19T15:59:59.000Z', { reason: 'count', ref: 'COUNT-7' }),
      ],
      [count],
      { id: 'c1', from, to, opening: { gin: 8 }, closing: { gin: 6 }, countId: 'COUNT-7' },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      opening: 8,
      sold: -1,
      wasted: -0.5,
      adjusted: 0,
      expected: 6.5,
      counted: 6,
      variance: -0.5,
      varianceValue: -15,
      closing: 6,
    });
    expect(countResult(rows)).toEqual({ counted: 1, off: 1, value: -15 });
  });
});

describe('shift windows', () => {
  it('chains each cash-up to the one before for its opening stock', () => {
    const older = cashUp('c1', '2026-10-18T08:00:00.000Z', '2026-10-18T20:00:00.000Z', { closingStock: { gin: 9 } });
    const newer = cashUp('c2', '2026-10-18T20:00:00.000Z', '2026-10-19T08:00:00.000Z', { closingStock: { gin: 7 } });
    const windows = shiftWindows([older, newer], newer.closedAt, '2026-10-19T09:00:00.000Z');
    expect(windows.map((w) => [w.id, w.opening, w.closing])).toEqual([
      ['current', { gin: 7 }, undefined],
      ['c2', { gin: 9 }, { gin: 7 }],
      ['c1', undefined, { gin: 9 }],
    ]);
  });

  it('reads one closed shift for its cash-up', () => {
    const c = cashUp('c1', '2026-10-19T08:00:00.000Z', '2026-10-19T16:00:00.000Z', { closingStock: { beer: 3 } });
    const rows = cashUpStock(c, [c], [item('beer', 1)], [mv('beer', -2, '2026-10-19T10:00:00.000Z')], []);
    expect(rows[0]).toMatchObject({ opening: 5, sold: -2, closing: 3 });
  });
});
