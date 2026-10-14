import { describe, expect, it } from 'vitest';
import { addPrinted, allPrinted, trimPrinted, unprintedLines, type CartLine } from './cart';

const line = (key: string, qty: number): CartLine => ({ key, itemId: key, name: key, unitPrice: 1_000, qty });

describe('current order', () => {
  it('is the whole tab before any docket', () => {
    const cart = [line('tea', 2), line('cake', 1)];
    expect(unprintedLines(cart)).toEqual(cart);
  });

  it('leaves out what earlier dockets printed, keeping just the new quantity', () => {
    const cart = [line('tea', 3), line('cake', 1), line('soda', 1)];
    expect(unprintedLines(cart, { tea: 2, cake: 1 })).toEqual([line('tea', 1), line('soda', 1)]);
  });

  it('counts an item taken off and rung up again as new', () => {
    const printed = trimPrinted([line('tea', 1)], { tea: 2 });
    expect(printed).toEqual({ tea: 1 });
    expect(unprintedLines([line('tea', 2)], printed)).toEqual([line('tea', 1)]);
  });

  it('adds both tabs’ printed counts on a merge', () => {
    expect(addPrinted({ tea: 1 }, { tea: 2, cake: 1 })).toEqual({ tea: 3, cake: 1 });
    expect(addPrinted(undefined, { cake: 1 })).toEqual({ cake: 1 });
  });
});

describe('leaving a tab', () => {
  it('ends its current order, so only items added on return are new', () => {
    const printed = allPrinted([line('soda', 1)]);
    expect(unprintedLines([line('soda', 3)], printed)).toEqual([line('soda', 2)]);
  });
});
