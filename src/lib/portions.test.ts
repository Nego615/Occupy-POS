import { describe, expect, it } from 'vitest';
import { parseUnits, parseVolume, servings, shareLabel, stockFits, unitsLabel, type CatalogItem } from '../data/catalog';
import { unsentLines } from '../data/kitchen';
import { orderItems, type OrderRecord } from '../data/orders';
import { applyMovements } from './inventory';
import { addLine, itemQuantities, lineCap, portionLine, type CartLine } from './cart';

const chicken: CatalogItem = {
  id: 'chicken',
  name: 'Roast Chicken',
  price: 20_000,
  color: '#000',
  category: 'food',
  available: true,
  stock: 2,
  cost: 8_000,
  portions: [
    { id: 'half', label: 'Half', price: 11_000, units: 0.5 },
    { id: 'third', label: 'Third', price: 8_000, units: 1 / 3 },
  ],
};
const [whole, half, third] = servings(chicken);

describe('portions', () => {
  it('rings a half up on its own line, apart from the whole', () => {
    let cart: CartLine[] = [];
    cart = addLine(cart, portionLine(chicken, whole, null));
    cart = addLine(cart, portionLine(chicken, half, null));
    cart = addLine(cart, portionLine(chicken, half, null));
    expect(cart.map((l) => [l.name, l.qty, l.unitPrice])).toEqual([
      ['Roast Chicken', 1, 20_000],
      ['Roast Chicken (Half)', 2, 11_000],
    ]);
    // One whole and two halves use two birds.
    expect(itemQuantities(cart).get('chicken')).toBe(2);
  });

  it('caps a portion line by what stock is left', () => {
    const cart = addLine([], portionLine(chicken, half, null));
    expect(lineCap(cart, 'chicken#half', [chicken])).toBe(4);
    const withWhole = addLine(cart, portionLine(chicken, whole, null));
    expect(lineCap(withWhole, 'chicken#half', [chicken])).toBe(2);
  });

  it('sells the last third even though thirds don’t add up exactly', () => {
    const one = { ...chicken, stock: 1 };
    const cart = [{ ...portionLine(one, third, null), qty: 2 }];
    expect(stockFits(one, itemQuantities(cart).get('chicken')!, third.units)).toBe(true);
    expect(lineCap(cart, 'chicken#third', [one])).toBe(3);
  });

  it('draws stock down by the share and lands on whole numbers', () => {
    const sold = [{ itemId: 'chicken', change: -3 * (1 / 3), reason: 'sale' as const }];
    const { catalog } = applyMovements([{ ...chicken, stock: 1 }], sold, undefined);
    expect(catalog[0].stock).toBe(0);
  });

  it('keeps halves and wholes apart for the kitchen', () => {
    const cart = [
      { ...portionLine(chicken, whole, null), qty: 1 },
      { ...portionLine(chicken, half, null), qty: 1 },
    ];
    const sent = [{ itemId: 'chicken', name: 'Roast Chicken', qty: 1 }];
    expect(unsentLines(cart, sent, () => true)).toEqual([
      { itemId: 'chicken', name: 'Roast Chicken (Half)', qty: 1 },
    ]);
  });

  it('restocks a refunded half as half a unit', () => {
    const order = {
      lines: [{ itemId: 'chicken', name: 'Roast Chicken (Half)', qty: 3, unitPrice: 11_000, units: 0.5 }],
    } as OrderRecord;
    expect(orderItems(order)).toEqual([{ itemId: 'chicken', name: 'Roast Chicken (Half)', qty: 1.5 }]);
  });

  it('reads and writes shares as fractions', () => {
    expect(parseUnits('1/2')).toBe(0.5);
    expect(parseUnits(' 3 / 4 ')).toBe(0.75);
    expect(parseUnits('0.25')).toBe(0.25);
    expect(parseUnits('0')).toBeNull();
    expect(parseUnits('1/0')).toBeNull();
    expect(parseUnits('half')).toBeNull();
    expect(unitsLabel(0.5)).toBe('1/2');
    expect(unitsLabel(1 / 3)).toBe('1/3');
    expect(unitsLabel(0.75)).toBe('3/4');
    expect(unitsLabel(0.123)).toBe('0.123');
  });

  it('reads volumes and shows a drink’s portions in ml', () => {
    expect(parseVolume('25 ml')).toBe(25);
    expect(parseVolume('0.375l')).toBe(375);
    expect(parseVolume('5cl')).toBe(50);
    expect(parseVolume('1/2')).toBeNull();
    expect(shareLabel(1 / 30, 750)).toBe('25 ml');
    expect(shareLabel(0.5)).toBe('1/2');
  });

  it('sells thirty tots from a bottle', () => {
    const whisky = { ...chicken, id: 'whisky', stock: 1, unitSize: 750 };
    const tot = { id: 'tot', label: 'Tot', price: 300, units: 25 / 750 };
    const cart = [{ ...portionLine(whisky, tot, null), qty: 29 }];
    expect(lineCap(cart, 'whisky#tot', [whisky])).toBe(30);
  });
});
