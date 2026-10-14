import { describe, expect, it } from 'vitest';
import { stockFits, stockState, type CatalogItem } from '../data/catalog';
import { lineCap } from './cart';
import { applyMovements } from './inventory';

const item = (over: Partial<CatalogItem> = {}): CatalogItem => ({
  id: 'makange',
  name: 'Chicken Makange',
  price: 15_000,
  color: '#000',
  category: 'food',
  available: true,
  stock: 0,
  ...over,
});

describe('items sold without counting stock', () => {
  it('always fit on a tab and never show as low or sold out', () => {
    const makange = item({ untracked: true });
    expect(stockFits(makange, 40)).toBe(true);
    expect(stockState(makange)).toBe('in');
    expect(lineCap([{ key: 'makange', itemId: 'makange', name: 'Chicken Makange', unitPrice: 15_000, qty: 3 }], 'makange', [makange])).toBe(Infinity);
  });

  it('leave stock alone on a sale or refund, but take adjustments', () => {
    const catalog = [item({ untracked: true, stock: 2 })];
    const sold = applyMovements(catalog, [{ itemId: 'makange', change: -3, reason: 'sale' }], undefined);
    expect(sold.movements).toEqual([]);
    expect(sold.catalog[0].stock).toBe(2);
    const fixed = applyMovements(catalog, [{ itemId: 'makange', change: 1, reason: 'correction', note: 'x' }], undefined);
    expect(fixed.catalog[0].stock).toBe(3);
  });

  it('still count when tracked', () => {
    expect(stockFits(item(), 0)).toBe(false);
  });
});
