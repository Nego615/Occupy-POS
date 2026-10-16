import { describe, expect, it } from 'vitest';
import { addOnOptions, lineContents, type AddOnPick, type CatalogItem, type Category } from '../data/catalog';
import type { SetMeal } from '../data/deals';
import { unsentLines } from '../data/kitchen';
import { orderItems, type OrderRecord } from '../data/orders';
import { addLine, itemQuantities, lineFits, lineItems, mealLine, portionLine, withAddOns } from './cart';

const item = (id: string, price: number, over: Partial<CatalogItem> = {}): CatalogItem => ({
  id,
  name: id.charAt(0).toUpperCase() + id.slice(1),
  price,
  color: '#000',
  category: 'food',
  available: true,
  stock: 10,
  ...over,
});

const chicken = item('chicken', 15_000);
const chips = item('chips', 3_000, { category: 'sides' });
const rice = item('rice', 2_500, { category: 'sides' });
const catalog = [chicken, chips, rice];
const side = (i: CatalogItem, price: number): AddOnPick => ({ itemId: i.id, name: i.name, price });

describe('add-on options', () => {
  const categories: Category[] = [
    { id: 'food', label: 'Food', addOns: [{ itemId: 'chips', price: 0 }, { itemId: 'rice', price: 1_000 }, { itemId: 'gone', price: 0 }] },
    { id: 'sides', label: 'Sides' },
  ];

  it('offers the category’s add-ons still on sale, at their add-on prices', () => {
    expect(addOnOptions(chicken, categories, catalog).map((o) => [o.item.id, o.price])).toEqual([
      ['chips', 0],
      ['rice', 1_000],
    ]);
    const offSale = catalog.map((i) => (i.id === 'rice' ? { ...i, available: false } : i));
    expect(addOnOptions(chicken, categories, offSale).map((o) => o.item.id)).toEqual(['chips']);
  });

  it('never offers an item with itself, and nothing where the category has none', () => {
    const own = [{ ...categories[0], addOns: [{ itemId: 'chicken', price: 0 }] }];
    expect(addOnOptions(chicken, own, catalog)).toEqual([]);
    expect(addOnOptions(chips, categories, catalog)).toEqual([]);
  });
});

describe('items with add-ons', () => {
  it('adds the add-ons’ prices, and keeps different sides on separate lines', () => {
    const withChips = withAddOns(portionLine(chicken, null, null), [side(chips, 0)]);
    const withRice = withAddOns(portionLine(chicken, null, null), [side(rice, 1_000)]);
    expect(withChips.unitPrice).toBe(15_000);
    expect(withRice.unitPrice).toBe(16_000);

    let lines = addLine([], withChips);
    lines = addLine(lines, withRice);
    lines = addLine(lines, withChips);
    expect(lines.map((l) => l.qty)).toEqual([2, 1]);
  });

  it('a plain item stays its own line, and its key is unchanged', () => {
    expect(withAddOns(portionLine(chicken, null, null), []).key).toBe('chicken');
  });

  it('draws down the sides’ stock along with the dish', () => {
    const line = { ...withAddOns(portionLine(chicken, null, null), [side(chips, 0), side(rice, 0)]), qty: 2 };
    expect(lineItems(line).map((i) => i.itemId)).toEqual(['chicken', 'chips', 'rice']);
    expect(Object.fromEntries(itemQuantities([line]))).toEqual({ chicken: 2, chips: 2, rice: 2 });
  });

  it('won’t ring up a dish whose side is out', () => {
    const outOfChips = [chicken, { ...chips, stock: 0 }, rice];
    const line = withAddOns(portionLine(chicken, null, null), [side(chips, 0)]);
    expect(lineFits([], line, outOfChips)).toBe(false);
    expect(lineFits([], portionLine(chicken, null, null), outOfChips)).toBe(true);
  });

  it('reads as the dish with its sides', () => {
    expect(lineContents({ addOns: [side(chips, 0), side(rice, 0)] })).toEqual(['with Chips, Rice']);
    expect(lineContents({})).toEqual([]);
  });
});

describe('kitchen tickets', () => {
  it('sends sides with their dish, not as dishes of their own', () => {
    const withChips = { ...withAddOns(portionLine(chicken, null, null), [side(chips, 0)]), qty: 2 };
    const withRice = { ...withAddOns(portionLine(chicken, null, null), [side(rice, 0)]), qty: 1 };
    const unsent = unsentLines([withChips, withRice], [], (id) => id === 'chicken');
    expect(unsent).toEqual([
      { itemId: 'chicken', name: 'Chicken', qty: 2, addOns: ['Chips'] },
      { itemId: 'chicken', name: 'Chicken', qty: 1, addOns: ['Rice'] },
    ]);
  });
});

describe('set meals with add-ons and skipped courses', () => {
  const soup = item('soup', 5_000);
  const cake = item('cake', 4_000);
  const lunch: SetMeal = {
    id: 'lunch',
    name: 'Lunch',
    price: 20_000,
    color: '#000',
    available: true,
    courses: [
      { name: 'Starter', itemIds: ['soup'] },
      { name: 'Main', itemIds: ['chicken'] },
      { name: 'Dessert', itemIds: ['cake'] },
    ],
  };

  it('keeps the full meal’s key as it was', () => {
    expect(mealLine(lunch, [soup, chicken, cake]).key).toBe('lunch:soup+chicken+cake');
  });

  it('leaves skipped courses out of the picks, at the set price', () => {
    const line = mealLine(lunch, [null, chicken, null]);
    expect(line.parts?.map((p) => p.course)).toEqual(['Main']);
    expect(line.unitPrice).toBe(20_000);
    // A different skip is a different meal.
    expect(line.key).not.toBe(mealLine(lunch, [soup, null, null]).key);
  });

  it('ties each add-on to its pick, even after a skipped course', () => {
    const line = { ...mealLine(lunch, [null, chicken, cake], [[], [side(chips, 0), side(rice, 1_000)], []]), qty: 1 };
    expect(line.unitPrice).toBe(21_000);
    expect(line.addOns?.map((a) => a.part)).toEqual([0, 0]);
    expect(lineContents(line)).toEqual(['Chicken with Chips, Rice', 'Cake']);
    expect(Object.fromEntries(itemQuantities([line]))).toEqual({ chicken: 1, chips: 1, rice: 1, cake: 1 });
  });

  it('takes several picks from one course, each with its own add-ons', () => {
    const line = {
      ...mealLine(lunch, [null, [chicken, cake], null], [[], [[side(chips, 0)], [side(rice, 1_000)]], []]),
      qty: 1,
    };
    expect(line.parts?.map((p) => [p.itemId, p.course])).toEqual([
      ['chicken', 'Main'],
      ['cake', 'Main'],
    ]);
    expect(line.addOns?.map((a) => a.part)).toEqual([0, 1]);
    expect(line.unitPrice).toBe(21_000);
    // The same picks tapped in another order are the same meal.
    expect(mealLine(lunch, [null, [chicken, cake], null]).key).toBe(
      mealLine(lunch, [null, [cake, chicken], null]).key,
    );
  });

  it('sends a meal’s main to the kitchen with its sides', () => {
    const line = { ...mealLine(lunch, [null, chicken, cake], [[], [side(chips, 0)], []]), qty: 1 };
    expect(unsentLines([line], [], (id) => id === 'chicken')).toEqual([
      { itemId: 'chicken', name: 'Chicken', qty: 1, addOns: ['Chips'] },
    ]);
  });
});

describe('refunds', () => {
  it('put the sides back on the shelf with the dish', () => {
    const order: OrderRecord = {
      id: 1,
      name: 'Walk-in',
      status: 'paid',
      at: new Date().toISOString(),
      lines: [{ itemId: 'chicken', name: 'Chicken', qty: 2, unitPrice: 16_000, addOns: [side(chips, 0), side(rice, 1_000)] }],
      tax: 0,
      tip: 0,
      payments: [{ method: 'cash', amount: 32_000 }],
    };
    expect(orderItems(order).map((i) => [i.itemId, i.qty])).toEqual([
      ['chicken', 2],
      ['chips', 2],
      ['rice', 2],
    ]);
  });
});
