import { byNumber, byText, descending, thenBy, type SortOption } from './listView';

/** What the open-tab lists sort and search on. */
export type TabRow = {
  orderId: number;
  name: string;
  openedIso: string;
  billRequestedAt?: string;
  /** What's still to pay on it. */
  total: number;
  /** Item names on it, for search. */
  items: string[];
};

const newest = thenBy<TabRow>(descending(byText((t) => t.openedIso)), descending(byNumber((t) => t.orderId)));

/**
 * The counter's queue order: bills sent over to be paid first, the one
 * waiting longest on top, then tabs still running, longest open first.
 */
const queue = (a: TabRow, b: TabRow) => {
  if (!!a.billRequestedAt !== !!b.billRequestedAt) return a.billRequestedAt ? -1 : 1;
  return (a.billRequestedAt ?? a.openedIso).localeCompare(b.billRequestedAt ?? b.openedIso);
};

export const TAB_SORTS: SortOption<TabRow>[] = [
  { id: 'newest', label: 'Newest first', compare: newest },
  { id: 'oldest', label: 'Open longest first', compare: descending(newest) },
  { id: 'docket-desc', label: 'Docket # high to low', compare: descending(byNumber((t) => t.orderId)) },
  { id: 'docket-asc', label: 'Docket # low to high', compare: byNumber((t) => t.orderId) },
  { id: 'name', label: 'Tab name A to Z', compare: thenBy(byText((t) => t.name), newest) },
  { id: 'total-desc', label: 'Total high to low', compare: descending(byNumber((t) => t.total)) },
];

/** The counter's bills add their queue order, and start on it. */
export const BILL_QUEUE_SORTS: SortOption<TabRow>[] = [
  { id: 'queue', label: 'Bills sent over first', compare: queue },
  ...TAB_SORTS,
];
