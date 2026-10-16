import { describe, expect, it } from 'vitest';
import { recipePours, type CatalogItem } from '../data/catalog';
import { orderItems, type OrderRecord } from '../data/orders';
import { addLine, itemQuantities, lineCap, lineFits, portionLine } from './cart';

const item = (id: string, price: number, over: Partial<CatalogItem> = {}): CatalogItem => ({
  id,
  name: id.charAt(0).toUpperCase() + id.slice(1),
  price,
  color: '#000',
  category: 'drinks',
  available: true,
  stock: 10,
  ...over,
});

const rum = item('rum', 40, { unitSize: 750, stock: 2 });
const cola = item('cola', 1, { stock: 24 });
const cubaLibre = item('cuba', 12, {
  stock: 0,
  untracked: true,
  recipe: [
    { itemId: 'rum', amount: 60 },
    { itemId: 'cola', amount: 1 },
    { itemId: 'gone', amount: 30 },
  ],
});
const catalog = [rum, cola, cubaLibre];

describe('recipes', () => {
  it('pour ml off sized bottles and whole units off the rest, skipping ingredients that are gone', () => {
    expect(recipePours(cubaLibre, catalog)).toEqual([
      { itemId: 'rum', name: 'Rum', units: 0.08 },
      { itemId: 'cola', name: 'Cola', units: 1 },
    ]);
  });

  it('draw stock from the ingredients, not the cocktail', () => {
    const line = portionLine(cubaLibre, null, null, catalog);
    const lines = addLine(addLine([], line), line);
    expect([...itemQuantities(lines)]).toEqual([
      ['rum', 0.16],
      ['cola', 2],
    ]);
  });

  it('stop selling once an ingredient runs out', () => {
    const lowCola = catalog.map((i) => (i.id === 'cola' ? { ...i, stock: 3 } : i));
    const line = portionLine(cubaLibre, null, null, lowCola);
    let lines = addLine([], line);
    lines = addLine(lines, line);
    lines = addLine(lines, line);
    expect(lineFits(lines, line, lowCola)).toBe(false);
    expect(lineCap(lines, line.key, lowCola)).toBe(3);
  });

  it('put the pours back on a refund', () => {
    const line = portionLine(cubaLibre, null, null, catalog);
    const order: OrderRecord = {
      id: 1,
      name: 'Walk-in',
      status: 'paid',
      at: new Date().toISOString(),
      lines: [{ itemId: 'cuba', name: 'Cuba', qty: 2, unitPrice: 12, pours: line.pours }],
      tax: 0,
      tip: 0,
      payments: [{ method: 'cash', amount: 24 }],
    };
    expect(orderItems(order).map((i) => [i.itemId, i.qty])).toEqual([
      ['rum', 0.16],
      ['cola', 2],
    ]);
  });
});
