import { describe, expect, it } from 'vitest';
import { dateOfDaysAgo, isoDate } from '../data/history';
import { hydrateOrder, type OrderRecord } from '../data/orders';
import { statCards, topItems } from './analytics';
import { byDay, byMonth, customWindow, daysSpanned, inLastDays } from './reports';

/** A paid 10,000 latte order, `daysAgo` days back. */
function paidOn(daysAgo: number, id = daysAgo): ReturnType<typeof hydrateOrder> {
  const record: OrderRecord = {
    id,
    name: 'Walk-in',
    status: 'paid',
    at: dateOfDaysAgo(daysAgo).toISOString(),
    lines: [{ itemId: 'latte', name: 'Latte', qty: 1, unitPrice: 10_000 }],
    tax: 0,
    tip: 0,
    payments: [{ method: 'cash', amount: 10_000 }],
  };
  return hydrateOrder(record);
}

describe('All time', () => {
  const orders = [paidOn(0), paidOn(40), paidOn(190)];

  it('keeps every order when there is no cutoff', () => {
    expect(inLastDays(orders, Infinity)).toHaveLength(3);
    expect(inLastDays(orders, 30)).toHaveLength(1);
  });

  it('spans back to the oldest order', () => {
    expect(daysSpanned(orders)).toBe(191);
    expect(daysSpanned([])).toBe(1);
  });

  it('rolls a long span up into calendar months, quiet ones included', () => {
    const months = byMonth(orders, daysSpanned(orders));
    // ~6 months back through this one.
    expect(months.length).toBeGreaterThanOrEqual(7);
    expect(months.length).toBeLessThanOrEqual(8);
    expect(months.reduce((sum, m) => sum + m.orders, 0)).toBe(3);
    expect(months.at(-1)!.orders).toBeGreaterThanOrEqual(1);
    expect(months.some((m) => m.orders === 0)).toBe(true);
  });

  it('totals everything on the overview, with no prior period to compare', () => {
    const [net, count] = statCards(orders, 'all');
    expect(count.value).toBe('3');
    expect(net.delta).toBeUndefined();
    expect(topItems(orders, 'all')[0]).toMatchObject({ name: 'Latte', sold: 3 });
  });
});

describe('Picked dates', () => {
  const orders = [paidOn(0), paidOn(3), paidOn(5), paidOn(9)];
  const day = (ago: number) => isoDate(dateOfDaysAgo(ago));

  it('reads a from–to range as a window ending on the last day, both days included', () => {
    expect(customWindow(day(9), day(3))).toEqual({ days: 7, end: 3 });
    // Picked backwards, it's the same range.
    expect(customWindow(day(3), day(9))).toEqual({ days: 7, end: 3 });
    expect(customWindow(day(5), day(5))).toEqual({ days: 1, end: 5 });
  });

  it('cuts off days after today, and refuses a range wholly ahead or unreadable', () => {
    expect(customWindow(day(2), day(-4))).toEqual({ days: 3, end: 0 });
    expect(customWindow(day(-2), day(-4))).toBeNull();
    expect(customWindow('2026-13', day(0))).toBeNull();
    expect(customWindow(null, day(0))).toBeNull();
  });

  it('keeps only orders inside the picked days, and charts just those days', () => {
    const w = customWindow(day(9), day(3))!;
    expect(inLastDays(orders, w.days, w.end).map((o) => o.daysAgo)).toEqual([3, 5, 9]);
    const days = byDay(orders, w.days, w.end);
    expect(days.map((d) => d.daysAgo)).toEqual([9, 8, 7, 6, 5, 4, 3]);
    expect(days.reduce((sum, d) => sum + d.orders, 0)).toBe(3);
  });
});
