import { describe, expect, it } from 'vitest';
import { sortRows } from './listView';
import { BILL_QUEUE_SORTS, TAB_SORTS, type TabRow } from './tabSorts';

const tab = (orderId: number, openedIso: string, billRequestedAt?: string): TabRow => ({
  orderId,
  name: `Table ${orderId}`,
  openedIso,
  billRequestedAt,
  total: orderId,
  items: [],
});

const rows = [
  tab(1, '2026-11-17T10:00:00Z'),
  tab(2, '2026-11-17T12:00:00Z', '2026-11-17T13:30:00Z'),
  tab(3, '2026-11-17T11:00:00Z', '2026-11-17T13:00:00Z'),
  tab(4, '2026-11-17T14:00:00Z'),
];

describe('tab sorts', () => {
  it('puts bills sent over first, waiting longest on top, then running tabs oldest first', () => {
    expect(sortRows(rows, BILL_QUEUE_SORTS, 'queue').map((t) => t.orderId)).toEqual([3, 2, 1, 4]);
  });

  it('lists newest opened first', () => {
    expect(sortRows(rows, TAB_SORTS, 'newest').map((t) => t.orderId)).toEqual([4, 2, 3, 1]);
  });
});
