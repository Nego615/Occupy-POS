import { afterEach, describe, expect, it } from 'vitest';
import type { CatalogItem } from '../data/catalog';
import type { Promotion, SetMeal } from '../data/deals';
import type { OrderRecord } from '../data/orders';
import { currencyOf, setActiveCurrency } from './currency';
import { convertMenu, convertPrice, readOrder, stampRate, switchBlockers } from './currencySwitch';

const USD = currencyOf('USD');
const RATE = 2_650;

afterEach(() => setActiveCurrency('TZS'));

describe('converting prices', () => {
  it('converts exactly, or to the nearest step without rounding to nothing', () => {
    expect(convertPrice(12_000, RATE, USD)).toBe(4.53);
    expect(convertPrice(12_000, RATE, USD, 0.5)).toBe(4.5);
    expect(convertPrice(13_000, RATE, USD, 0.5)).toBe(5);
    expect(convertPrice(300, RATE, USD, 0.5)).toBe(0.5);
    expect(convertPrice(0, RATE, USD, 0.5)).toBe(0);
  });

  it('converts the whole menu: prices to the step, costs and amount-offs exactly', () => {
    const chicken: CatalogItem = {
      id: 'chicken',
      name: 'Chicken',
      price: 26_500,
      cost: 10_600,
      color: '#000',
      category: 'food',
      available: true,
      stock: 4,
      portions: [{ id: 'half', label: 'Half', price: 14_000, units: 0.5 }],
    };
    const lunch = { id: 'lunch', name: 'Lunch', price: 30_000, color: '#000', available: true, courses: [] } as SetMeal;
    const off = { id: 'p1', kind: 'amount', value: 1_000 } as Promotion;
    const pct = { id: 'p2', kind: 'percent', value: 0.2 } as Promotion;

    const menu = convertMenu({ catalog: [chicken], setMeals: [lunch], promotions: [off, pct] }, RATE, USD, 0.5);
    expect(menu.catalog[0].price).toBe(10);
    expect(menu.catalog[0].cost).toBe(4);
    expect(menu.catalog[0].portions![0].price).toBe(5.5);
    expect(menu.setMeals[0].price).toBe(11.5);
    expect(menu.promotions[0].value).toBe(0.38);
    expect(menu.promotions[1].value).toBe(0.2);
  });

  it('stamps the rate only where none was saved', () => {
    expect(stampRate([{ id: 'a' }, { id: 'b', rate: 2_500 }], RATE)).toEqual([
      { id: 'a', rate: RATE },
      { id: 'b', rate: 2_500 },
    ]);
  });
});

describe('orders from before the switch', () => {
  const sw = { from: 'TZS' as const, rate: RATE, at: '2026-10-01T00:00:00.000Z' };
  const record = (at: string): OrderRecord => ({
    id: 7,
    name: 'Walk-in',
    status: 'paid',
    at,
    lines: [{ itemId: 'beer', name: 'Beer', qty: 2, unitPrice: 5_300, unitCost: 2_650 }],
    tax: 1_908,
    tip: 0,
    payments: [{ method: 'cash', amount: 12_508, tendered: 20_000 }],
  });

  it('reads back converted, keeping the order as it was taken', () => {
    setActiveCurrency('USD');
    const order = readOrder(record('2026-09-30T18:00:00.000Z'), sw, USD);
    expect(order.lines[0].unitPrice).toBe(2);
    expect(order.lines[0].unitCost).toBe(1);
    expect(order.tax).toBe(0.72);
    expect(order.payments[0]).toMatchObject({ amount: 4.72, tendered: 7.55 });
    expect(order.recordedIn).toMatchObject({ currency: 'TZS', rate: RATE });
    expect(order.recordedIn!.original.lines[0].unitPrice).toBe(5_300);
  });

  it('leaves orders after the switch alone', () => {
    const order = readOrder(record('2026-10-02T09:00:00.000Z'), sw, USD);
    expect(order.lines[0].unitPrice).toBe(5_300);
    expect(order.recordedIn).toBeUndefined();
  });
});

describe('what has to be settled before switching', () => {
  const tab = (name: string, items: number, paid = 0) => ({
    name,
    cart: Array.from({ length: items }),
    payments: paid ? [{ method: 'cash' as const, amount: paid, at: new Date().toISOString() }] : [],
  });

  it('is nothing when the shop is quiet', () => {
    expect(switchBlockers({ tabs: [tab('Walk-in', 0)], orders: [], cashUps: [] })).toEqual([]);
  });

  it('names open tabs, unsettled rooms, and money taken since the cash-up', () => {
    const roomCharge: OrderRecord = {
      id: 3,
      name: 'Room 2',
      status: 'charged',
      roomId: 'r2',
      at: new Date().toISOString(),
      lines: [],
      tax: 0,
      tip: 0,
      payments: [],
    };
    const out = switchBlockers({ tabs: [tab('Table 4', 2, 5_000)], orders: [roomCharge], cashUps: [] });
    expect(out).toHaveLength(3);
    expect(out[0]).toMatch(/Table 4 has an open tab/);
    expect(out[1]).toMatch(/1 room has a bill/);
    expect(out[2]).toMatch(/1 payment has come in/);
  });
});
