import { CATALOG, TAX_RATE } from './catalog';
import { HISTORY_DAYS, dateOfDaysAgo, daysAgoOf } from './history';
import { roundMoney } from '../lib/currency';

/** `charged` is closed onto a room's bill, to be paid when the room settles up. */
export type OrderStatus = 'paid' | 'occupied' | 'refunded' | 'charged';

/** How money was taken. Card is a standalone terminal; mobile is M-Pesa, Tigo Pesa, Airtel Money and the like. */
export type TenderMethod = 'card' | 'cash' | 'mobile';

export const TENDER_LABEL: Record<TenderMethod, string> = {
  card: 'Card',
  cash: 'Cash',
  mobile: 'Mobile money',
};

export type Payment = {
  method: TenderMethod;
  /** What this payment put toward the order. */
  amount: number;
  /** Cash only: what the customer handed over. Change is `tendered - amount`. */
  tendered?: number;
  /** Card last four or approval code, or the mobile-money transaction id. */
  ref?: string;
  /** ISO timestamp it was taken. Absent on payments from before shifts were cashed up. */
  at?: string;
  /** Staff id of whoever took it. */
  by?: string;
};

export const REFUND_REASONS = [
  'Customer changed mind',
  'Wrong item',
  'Quality issue',
  'Overcharged',
  'Other',
] as const;

export type Refund = {
  id: string;
  /** ISO timestamp. */
  at: string;
  /** Which lines, by index into the order's lines, and how many of each. */
  lines: { index: number; qty: number }[];
  /** Items' share, after discounts and before tax. */
  subtotal: number;
  tax: number;
  /** subtotal + tax — what went back to the customer. */
  amount: number;
  reason: string;
  /** Staff id of whoever issued or approved it. */
  by: string;
  restocked: boolean;
};

export type OrderLine = {
  /** The catalog item, or a set meal's id. Absent for custom amounts and very old orders. */
  itemId?: string;
  name: string;
  qty: number;
  /** What one was charged at, after any deal. */
  unitPrice: number;
  /** What one would have cost without the deal. Absent when it wasn't discounted. */
  listPrice?: number;
  /** The promotion or manual discount that priced it — "Happy Hour", "10% off". */
  promo?: string;
  /** A set meal's picks, by name, one per course. */
  parts?: string[];
  /** A set meal's picks, by catalog id, matching `parts`. */
  partIds?: string[];
  /** "No onions", "extra hot". */
  note?: string;
  /** Stock one of it used, for a portion — 0.5 for a half. Absent means 1. */
  units?: number;
  /**
   * What one cost to buy in when it sold — a set meal's is its picks' costs
   * added up. Frozen at sale so margins don't move when costs change later.
   * Absent when an item had no cost set.
   */
  unitCost?: number;
};

/** An order as it's saved. Day and time labels are worked out from `at` when read. */
export type OrderRecord = {
  id: number;
  /** Tab name — "Table 4", "Walk-in". */
  name: string;
  /** The table or room the tab was assigned to. Absent for walk-ins. */
  locationId?: string;
  status: OrderStatus;
  /** ISO timestamp the tab was closed (or opened, while it's still open). */
  at: string;
  /** Staff id of whoever took payment. */
  staffId?: string;
  lines: OrderLine[];
  /** Taken off the whole order by hand, before tax. Line deals are on the lines. */
  discount?: number;
  /** "10% off", "TSh 2,000 off". */
  discountLabel?: string;
  /** Staff id of whoever okayed the order discount. */
  discountBy?: string;
  tax: number;
  tip: number;
  /** Empty while a tab is open. */
  payments: Payment[];
  /** Partial refunds, oldest first. A full refund also flips the status. */
  refunds?: Refund[];
  /** Staff id of whoever issued (or approved) the full refund. */
  refundedBy?: string;
  /** The room it was charged to, when it went on a room's bill instead of being paid on the spot. */
  roomId?: string;
  /** ISO timestamp a room charge was paid off with the rest of the room's bill. */
  settledAt?: string;
};

export type Order = OrderRecord & {
  /** 0 = today. Drives the Today / This week / All time filters. */
  daysAgo: number;
  /** "4:38 PM" today, "Thu 2:14 PM" this week, "Aug 21 · 1:47 PM" before that. */
  time: string;
  /** "Card ·4471", "Cash", "Split · Card + Cash". Absent while a tab is still open. */
  method?: string;
};

/** Fills in the labels an order is read with. */
export function hydrateOrder(record: OrderRecord): Order {
  const at = new Date(record.at);
  const daysAgo = daysAgoOf(at);
  const method = paymentLabel(record.payments);
  return { ...record, daysAgo, time: whenLabel(at, daysAgo), ...(method ? { method } : {}) };
}

function whenLabel(at: Date, daysAgo: number): string {
  const clock = at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (daysAgo <= 0) return clock;
  if (daysAgo < 7) return `${at.toLocaleDateString('en-US', { weekday: 'short' })} ${clock}`;
  return `${at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${clock}`;
}

export function paymentLabel(payments: Payment[]): string | undefined {
  if (payments.length === 0) return undefined;
  if (payments.length === 1) {
    const p = payments[0];
    return p.ref ? `${TENDER_LABEL[p.method]} ·${p.ref}` : TENDER_LABEL[p.method];
  }
  const methods = [...new Set(payments.map((p) => TENDER_LABEL[p.method]))];
  return `Split · ${methods.join(' + ')}`;
}

/* ---------- Money ---------- */

/** Lines as rung up, after line deals and before the order discount. */
function linesTotal(order: OrderRecord): number {
  return round(order.lines.reduce((sum, l) => sum + l.unitPrice * l.qty, 0));
}

/** What tax was charged on: lines after every discount. */
export function orderSubtotal(order: OrderRecord): number {
  return round(linesTotal(order) - (order.discount ?? 0));
}

/** Taken off by promotions, set meals, and manual discounts, against list prices. */
export function orderDiscount(order: OrderRecord): number {
  return round(
    order.lines.reduce((sum, l) => sum + ((l.listPrice ?? l.unitPrice) - l.unitPrice) * l.qty, 0) +
      (order.discount ?? 0),
  );
}

export function orderTotal(order: OrderRecord): number {
  return round(orderSubtotal(order) + order.tax + order.tip);
}

export function orderItemCount(order: OrderRecord): number {
  return order.lines.reduce((sum, l) => sum + l.qty, 0);
}

export function paidAmount(payments: Payment[]): number {
  return round(payments.reduce((sum, p) => sum + p.amount, 0));
}

/** Cash handed back across all payments. */
export function changeGiven(payments: Payment[]): number {
  return round(payments.reduce((sum, p) => sum + Math.max(0, (p.tendered ?? p.amount) - p.amount), 0));
}

/* ---------- Refunds ---------- */

export function refundedAmount(order: OrderRecord): number {
  return round((order.refunds ?? []).reduce((sum, r) => sum + r.amount, 0));
}

export function refundedSubtotal(order: OrderRecord): number {
  return round((order.refunds ?? []).reduce((sum, r) => sum + r.subtotal, 0));
}

export function refundedTax(order: OrderRecord): number {
  return round((order.refunds ?? []).reduce((sum, r) => sum + r.tax, 0));
}

/** Units of line `index` already refunded. */
export function refundedQty(order: OrderRecord, index: number): number {
  return (order.refunds ?? []).reduce(
    (sum, r) => sum + r.lines.filter((l) => l.index === index).reduce((s, l) => s + l.qty, 0),
    0,
  );
}

/**
 * Everything given back on an order. Fully refunded orders from before
 * line-level refunds carry no refund records — all of it went back.
 */
export function orderRefundTotal(order: OrderRecord): number {
  if (order.refunds?.length) return refundedAmount(order);
  return order.status === 'refunded' ? orderTotal(order) : 0;
}

/** What a paid order still counts for once partial refunds are taken out. Zero once fully refunded. */
export function orderNetTotal(order: OrderRecord): number {
  if (order.status !== 'paid') return 0;
  return round(orderTotal(order) - refundedAmount(order));
}

/** Items' share still standing after partial refunds — net sales before tax and tip. */
export function orderNetSubtotal(order: OrderRecord): number {
  if (order.status !== 'paid') return 0;
  return round(orderSubtotal(order) - refundedSubtotal(order));
}

/** Tax still standing after partial refunds. */
export function orderNetTax(order: OrderRecord): number {
  if (order.status !== 'paid') return 0;
  return round(order.tax - refundedTax(order));
}

/**
 * What refunding `lines` gives back: each unit at what it was charged after
 * the order discount, plus the tax charged on it. Tips aren't refunded.
 */
export function refundValue(
  order: OrderRecord,
  lines: { index: number; qty: number }[],
): { subtotal: number; tax: number; amount: number } {
  const gross = linesTotal(order);
  const share = gross > 0 ? orderSubtotal(order) / gross : 0;
  const taxRate = orderSubtotal(order) > 0 ? order.tax / orderSubtotal(order) : 0;
  const raw = lines.reduce((sum, l) => sum + (order.lines[l.index]?.unitPrice ?? 0) * l.qty * share, 0);
  const subtotal = round(raw);
  const tax = round(raw * taxRate);
  return { subtotal, tax, amount: round(subtotal + tax) };
}

/**
 * The catalog items lines went out with — set meals counted by their picks,
 * portions by their share of a unit. What a refund puts back on the shelf. `qtyOf` overrides each line's count.
 */
export function orderItems(
  order: OrderRecord,
  qtyOf: (index: number) => number = (i) => order.lines[i].qty,
): { itemId?: string; name: string; qty: number }[] {
  const items: { itemId?: string; name: string; qty: number }[] = [];
  order.lines.forEach((line, index) => {
    const qty = qtyOf(index);
    if (qty <= 0) return;
    const picks = line.parts
      ? line.parts.map((name, j) => ({ itemId: line.partIds?.[j], name, units: 1 }))
      : [{ itemId: line.itemId, name: line.name, units: line.units ?? 1 }];
    for (const { units, ...pick } of picks) {
      const existing = items.find((i) => (pick.itemId ? i.itemId === pick.itemId : i.name === pick.name));
      if (existing) existing.qty += qty * units;
      else items.push({ ...pick, qty: qty * units });
    }
  });
  return items;
}

function round(n: number): number {
  return roundMoney(n);
}

/* -------------------------------------------------------------------------
   Seed orders. Curated ones for today and the last few days, then a
   deterministic backfill to the start of last month — a fixed seed, so the
   numbers are stable rather than jittering between first runs.
   ------------------------------------------------------------------------- */

const BY_NAME = new Map(CATALOG.map((i) => [i.name, i]));

/** An ISO timestamp `daysAgo` days back, at `hour`:`minute` local time. */
function atOf(daysAgo: number, hour: number, minute: number): string {
  const d = dateOfDaysAgo(daysAgo);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

/** "4:38 PM" → [16, 38]. */
function parseClock(text: string): [number, number] {
  const [, h, m, ampm] = /(\d{1,2}):(\d{2})\s*(AM|PM)/.exec(text)!;
  return [(Number(h) % 12) + (ampm === 'PM' ? 12 : 0), Number(m)];
}

function seedLine(name: string, qty: number): OrderLine {
  const item = BY_NAME.get(name)!;
  return { itemId: item.id, name, qty, unitPrice: item.price, unitCost: item.cost };
}

function seedPayment(method: string, amount: number): Payment {
  if (method === 'Cash') return { method: 'cash', amount, tendered: amount };
  return { method: 'card', amount, ref: method.split('·')[1] };
}

/** A curated seed order: lines by name and quantity, tax at the default rate, and a tip as a share of the items. */
function seed(order: {
  id: number;
  name: string;
  status: OrderStatus;
  time: string;
  daysAgo: number;
  method: string;
  staffId: string;
  lines: [name: string, qty: number][];
  tipPct?: number;
}): OrderRecord {
  const lines = order.lines.map(([name, qty]) => seedLine(name, qty));
  const subtotal = lines.reduce((sum, l) => sum + l.unitPrice * l.qty, 0);
  // Refunds were recorded with their tax and tip cleared.
  const refunded = order.status === 'refunded';
  const tax = refunded ? 0 : Math.round(subtotal * TAX_RATE);
  const tip = refunded ? 0 : Math.round(subtotal * (order.tipPct ?? 0));
  const [hour, minute] = parseClock(order.time);
  return {
    id: order.id,
    name: order.name,
    status: order.status,
    at: atOf(order.daysAgo, hour, minute),
    staffId: order.staffId,
    lines,
    tax,
    tip,
    payments: [seedPayment(order.method, subtotal + tax + tip)],
    ...(refunded ? { refundedBy: 'priya' } : {}),
  };
}

/**
 * Curated recent orders — these are the ones the history mockup shows. Tabs
 * that are still open (Table 2, Table 4) live in the store, not here.
 */
const RECENT_ORDERS: OrderRecord[] = [
  seed({ id: 1044, name: 'Walk-in', status: 'paid', time: '4:38 PM', daysAgo: 0, method: 'Cash', staffId: 'marcus', lines: [['Cold Brew', 1]] }),
  seed({
    id: 1043,
    name: 'Table 7',
    status: 'paid',
    time: '4:33 PM',
    daysAgo: 0,
    method: 'Card ·4471',
    staffId: 'dev',
    lines: [
      ['Oat Latte', 2],
      ['Avocado Toast', 1],
      ['Butter Croissant', 1],
      ['Drip Coffee', 1],
    ],
    tipPct: 0.15,
  }),
  seed({
    id: 1042,
    name: 'Table 4',
    status: 'paid',
    time: '4:26 PM',
    daysAgo: 0,
    method: 'Card ·4471',
    staffId: 'dev',
    lines: [
      ['Oat Latte', 2],
      ['Cortado', 1],
      ['Espresso Shot', 1],
    ],
    tipPct: 0.2,
  }),
  seed({ id: 1041, name: 'Walk-in', status: 'refunded', time: '4:15 PM', daysAgo: 0, method: 'Card ·9021', staffId: 'marcus', lines: [['Oat Latte', 1]] }),
  seed({
    id: 1040,
    name: 'Table 1',
    status: 'paid',
    time: '4:02 PM',
    daysAgo: 0,
    method: 'Card ·1188',
    staffId: 'marcus',
    lines: [
      ['Matcha Latte', 1],
      ['Grain Bowl', 1],
    ],
  }),
  seed({
    id: 1038,
    name: 'Table 5',
    status: 'paid',
    time: '2:14 PM',
    daysAgo: 2,
    method: 'Card ·3320',
    staffId: 'dev',
    lines: [
      ['Breakfast Burrito', 2],
      ['Americano', 2],
    ],
    tipPct: 0.18,
  }),
  seed({ id: 1035, name: 'Walk-in', status: 'refunded', time: '11:02 AM', daysAgo: 3, method: 'Card ·7714', staffId: 'sofia', lines: [['Occupy Tumbler', 1]] }),
  seed({
    id: 1021,
    name: 'Table 3',
    status: 'paid',
    time: '1:47 PM',
    daysAgo: 16,
    method: 'Card ·4471',
    staffId: 'hannah',
    lines: [
      ['Whole Bean 12oz', 2],
      ['Canvas Tote', 1],
    ],
  }),
];

/** mulberry32 — small, fast, seeded PRNG. */
function makeRandom(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CARD_ENDINGS = ['4471', '9021', '1188', '3320', '7714', '2205'];
const TAB_NAMES = ['Walk-in', 'Table 1', 'Table 2', 'Table 3', 'Table 5', 'Table 7'];
const CASHIERS = ['marcus', 'sofia', 'hannah', 'dev', 'priya'];

/** Items the generator draws from — a slice of the real catalog, at catalog prices. */
const SAMPLE_NAMES = [
  'Oat Latte',
  'Cortado',
  'Drip Coffee',
  'Cold Brew',
  'Americano',
  'Espresso Shot',
  'Matcha Latte',
  'Butter Croissant',
  'Pain au Chocolat',
  'Avocado Toast',
  'Breakfast Burrito',
  'Grain Bowl',
  'Whole Bean 12oz',
];

function generateHistory(): OrderRecord[] {
  const random = makeRandom(20260830);
  const pick = <T,>(list: T[]) => list[Math.floor(random() * list.length)];
  const orders: OrderRecord[] = [];
  let id = 1039;

  // Today is covered by the curated orders; backfill back to the start of last month.
  for (let daysAgo = HISTORY_DAYS; daysAgo >= 1; daysAgo--) {
    const weekday = dateOfDaysAgo(daysAgo).getDay();
    // Weekends run busier than midweek.
    const busy = weekday === 0 || weekday === 6 ? 1.35 : weekday === 3 ? 0.78 : 1;
    const count = Math.round((38 + random() * 14) * busy);

    for (let n = 0; n < count; n++) {
      // Most tickets are one or two items — a counter, not a restaurant.
      const lineCount = random() > 0.62 ? 2 : 1;
      const lines: OrderLine[] = [];
      for (let l = 0; l < lineCount; l++) {
        const name = pick(SAMPLE_NAMES);
        const existing = lines.find((line) => line.name === name);
        if (existing) existing.qty += 1;
        else lines.push(seedLine(name, random() > 0.88 ? 2 : 1));
      }

      const subtotal = lines.reduce((sum, l) => sum + l.unitPrice * l.qty, 0);
      const roll = random();
      const method: TenderMethod = roll > 0.45 ? 'card' : roll > 0.2 ? 'cash' : 'mobile';
      // Roughly one order in forty comes back as a refund.
      const refunded = random() > 0.975;
      const hour = 7 + Math.floor(random() * 11);
      const minute = Math.floor(random() * 60);
      const name = pick(TAB_NAMES);
      const tax = Math.round(subtotal * TAX_RATE);
      const tip = refunded || method === 'cash' ? 0 : Math.round(subtotal * (random() > 0.45 ? 0.18 : 0));
      const amount = subtotal + tax + tip;

      orders.push({
        id: id++,
        name,
        status: refunded ? 'refunded' : 'paid',
        at: atOf(daysAgo, hour, minute),
        staffId: pick(CASHIERS),
        lines,
        tax,
        tip,
        payments: [
          method === 'card'
            ? { method, amount, ref: pick(CARD_ENDINGS) }
            : method === 'cash'
              ? { method, amount, tendered: Math.ceil(amount / 5_000) * 5_000 }
              : { method, amount, ref: `QK${Math.floor(random() * 1e8).toString(36).toUpperCase()}` },
        ],
        ...(refunded ? { refundedBy: 'priya' } : {}),
      });
    }
  }

  // Newest first, matching how the history list reads.
  return orders.reverse();
}

export const ORDERS: OrderRecord[] = [...RECENT_ORDERS, ...generateHistory()];
