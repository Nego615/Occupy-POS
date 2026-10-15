import { describe, expect, it } from 'vitest';
import { hydrateOrder, type OrderRecord } from '../data/orders';
import { matchesStaff } from './orderFilters';
import { byStaff } from './reports';

const staff = [
  { id: 'dev', role: 'server' as const },
  { id: 'leo', role: 'server' as const },
  { id: 'kim', role: 'frontdesk' as const },
  { id: 'sofia', role: 'barista' as const },
];

const order = (over: Partial<OrderRecord>) =>
  hydrateOrder({
    id: 1,
    name: 'Table 1',
    status: 'paid',
    at: new Date().toISOString(),
    lines: [{ name: 'Tea', qty: 1, unitPrice: 1_000 }],
    tax: 0,
    tip: 0,
    payments: [{ method: 'cash', amount: 1_000 }],
    ...over,
  });

describe('filtering sales by staff', () => {
  const served = order({ servedBy: 'dev', staffId: 'kim' });

  it('finds an order under whoever served it and whoever took payment', () => {
    expect(matchesStaff(served, 'dev', staff)).toBe(true);
    expect(matchesStaff(served, 'kim', staff)).toBe(true);
    expect(matchesStaff(served, 'leo', staff)).toBe(false);
  });

  it('takes in a whole role', () => {
    expect(matchesStaff(served, 'role:server', staff)).toBe(true);
    expect(matchesStaff(served, 'role:frontdesk', staff)).toBe(true);
    expect(matchesStaff(served, 'role:barista', staff)).toBe(false);
    expect(matchesStaff(served, 'all', staff)).toBe(true);
  });

  it('credits sales to the server, or the cashier on older orders', () => {
    const rows = byStaff(
      [served, order({ id: 2, staffId: 'sofia' }), order({ id: 3, servedBy: 'dev', staffId: 'kim' })],
      (id) => id ?? 'none',
    );
    expect(rows.map((r) => [r.label, r.orders])).toEqual([
      ['dev', 2],
      ['sofia', 1],
    ]);
  });
});
