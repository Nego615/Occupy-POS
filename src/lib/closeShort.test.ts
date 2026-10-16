import { describe, expect, it } from 'vitest';
import type { PurchaseOrder } from '../data/inventory';
import { closeShort, receiveAgainst, reorderSuggestions, shortLines } from './inventory';

const order: PurchaseOrder = {
  id: 'PO-2001',
  supplierId: 'acme',
  status: 'ordered',
  createdAt: '2026-10-01',
  createdBy: 'Asha',
  orderedAt: '2026-10-01',
  lines: [
    { itemId: 'milk', name: 'Milk', qty: 10, unitCost: 1_000, received: 0 },
    { itemId: 'beans', name: 'Beans', qty: 5, unitCost: 8_000, received: 0 },
  ],
};

const catalog = [
  { id: 'milk', name: 'Milk', stock: 0, cost: 1_000, supplierId: 'acme', lowStockAt: 5, parLevel: 10 },
  { id: 'beans', name: 'Beans', stock: 0, cost: 8_000, supplierId: 'acme', lowStockAt: 2, parLevel: 5 },
] as unknown as Parameters<typeof receiveAgainst>[1];

describe('a delivery that comes up short', () => {
  const part = receiveAgainst(order, catalog, [
    { itemId: 'milk', qty: 6, unitCost: 1_000 },
    { itemId: 'beans', qty: 5, unitCost: 8_000 },
  ]);

  it('bills only what arrived and leaves the order part received', () => {
    expect(part.order.status).toBe('partial');
    expect(part.amount).toBe(6 * 1_000 + 5 * 8_000);
    expect(shortLines(part.order)).toEqual([{ itemId: 'milk', name: 'Milk', qty: 4, unitCost: 1_000 }]);
  });

  it('closes short with who, when, and why — lines kept as they were', () => {
    const closed = closeShort(part.order, '2026-10-16', 'Asha', '  Out of stock ');
    expect(closed).toMatchObject({
      status: 'closed',
      closedAt: '2026-10-16',
      closedBy: 'Asha',
      closeReason: 'Out of stock',
    });
    expect(closed!.lines).toEqual(part.order.lines);
  });

  it('only closes an order that is part received', () => {
    expect(closeShort(order, '2026-10-16', 'Asha')).toBeNull();
    const full = receiveAgainst(order, catalog, [
      { itemId: 'milk', qty: 10, unitCost: 1_000 },
      { itemId: 'beans', qty: 5, unitCost: 8_000 },
    ]);
    expect(closeShort(full.order, '2026-10-16', 'Asha')).toBeNull();
  });

  it('stops counting the shortfall as on order once closed', () => {
    // 4 milk on the shelf, par 10; the 4 still on the open order leave 2 to suggest.
    const shelf = catalog.map((i) => (i.id === 'milk' ? { ...i, stock: 4 } : i));
    expect(reorderSuggestions(shelf, 5, [part.order]).get('acme')?.find((s) => s.item.id === 'milk')?.qty).toBe(2);
    // Closed, it's no longer an open order, so the full top-up comes back.
    expect(reorderSuggestions(shelf, 5, []).get('acme')?.find((s) => s.item.id === 'milk')?.qty).toBe(6);
  });
});
