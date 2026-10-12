import { describe, expect, it } from 'vitest';
import { dateOfDaysAgo } from '../data/history';
import { hydrateOrder, type OrderRecord } from '../data/orders';
import { statCards, topItems } from './analytics';
import { brandTokens, contrast, parseHex, textOn, tooLight } from './brand';
import { byMonth, daysSpanned, inLastDays } from './reports';

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

describe('brand colors', () => {
  it('reads hex the way people type it', () => {
    expect(parseHex('#1D5FA8')).toBe('#1d5fa8');
    expect(parseHex(' 1d5fa8 ')).toBe('#1d5fa8');
    expect(parseHex('#abc')).toBe('#aabbcc');
    expect(parseHex('navy')).toBeNull();
    expect(parseHex('#12345')).toBeNull();
  });

  it('puts paper on dark brands and cocoa ink on light ones', () => {
    expect(textOn('#1f3a8a')).toBe('#fff9ee');
    expect(textOn('#f5d90a')).toBe('#2b1810');
    expect(contrast('#2b1810', '#fff9ee')).toBeGreaterThan(15);
  });

  it('flags colors too faint against the page', () => {
    expect(tooLight('#f5d90a')).toBe(true);
    expect(tooLight('#1d5fa8')).toBe(false);
  });

  it('leaves tokens at their stock values when unset', () => {
    expect(brandTokens(null, null)).toEqual({
      '--brand': null,
      '--on-brand': null,
      '--on-brand-soft': null,
      '--accent': null,
    });
    expect(brandTokens('#0f766e', undefined)).toMatchObject({
      '--brand': '#0f766e',
      '--on-brand': '#fff9ee',
      '--accent': null,
    });
  });
});
