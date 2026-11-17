import { describe, expect, it } from 'vitest';
import { hydrateOrder } from '../data/orders';
import { matchesQuery } from './orderFilters';

const order = hydrateOrder({
  id: 1207,
  name: 'Table 4',
  status: 'paid',
  at: new Date().toISOString(),
  customerId: 'asha-m',
  customerName: 'Asha Mwakyusa',
  lines: [{ name: 'Pilau', qty: 1, unitPrice: 12_000 }],
  tax: 0,
  tip: 0,
  payments: [{ method: 'cash', amount: 12_000 }],
});

describe('order search', () => {
  it('finds an order by the customer it was for', () => {
    expect(matchesQuery(order, 'asha')).toBe(true);
    expect(matchesQuery(order, 'mwakyusa')).toBe(true);
  });

  it('still finds it by docket number', () => {
    expect(matchesQuery(order, '1207')).toBe(true);
    expect(matchesQuery(order, 'juma')).toBe(false);
  });
});
