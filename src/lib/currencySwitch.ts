import { shiftStart, shiftTotals, type CashUp } from '../data/cashup';
import type { CatalogItem } from '../data/catalog';
import type { Promotion, SetMeal } from '../data/deals';
import type { StockCount, StockMovement } from '../data/inventory';
import { hydrateOrder, type Order, type OrderRecord, type Payment } from '../data/orders';
import type { CurrencySwitch } from '../data/settings';
import { currencyOf, roundMoney, type Currency } from './currency';

/*
 * Moving a shop from selling in one currency to another — a shilling shop
 * that starts pricing in dollars and keeps buying in shillings. The menu and
 * item costs are converted once, when it switches. Orders keep the amounts
 * they were taken in; ones from before the switch are read back converted,
 * so reports never add shillings to dollars, and their receipts can still
 * show what was actually paid.
 */

export type Menu = { catalog: CatalogItem[]; setMeals: SetMeal[]; promotions: Promotion[] };

/**
 * `amount` over `rate`, to `to`'s smallest unit — or with `step`, to the
 * nearest step, so a menu comes out at $4.50 rather than $4.47. A price never
 * rounds down to nothing.
 */
export function convertPrice(amount: number, rate: number, to: Currency, step?: number): number {
  const exact = amount / rate;
  if (!step || amount <= 0) return roundMoney(exact, to);
  return roundMoney(Math.max(step, Math.round(exact / step) * step), to);
}

/**
 * Every price on the menu in the new currency: items and their portions and
 * set meals to `step`, item costs and amount-off promotions exactly.
 */
export function convertMenu(menu: Menu, rate: number, to: Currency, step?: number): Menu {
  const price = (n: number) => convertPrice(n, rate, to, step);
  const exact = (n: number) => convertPrice(n, rate, to);
  return {
    catalog: menu.catalog.map((item) => ({
      ...item,
      price: price(item.price),
      ...(item.cost !== undefined ? { cost: exact(item.cost) } : {}),
      ...(item.portions ? { portions: item.portions.map((p) => ({ ...p, price: price(p.price) })) } : {}),
    })),
    setMeals: menu.setMeals.map((m) => ({ ...m, price: price(m.price) })),
    promotions: menu.promotions.map((p) => (p.kind === 'amount' ? { ...p, value: exact(p.value) } : p)),
  };
}

/** The stock ledger valued in the new currency, like the item costs it was valued at. */
export function convertMovements(movements: StockMovement[], rate: number, to: Currency): StockMovement[] {
  return movements.map((m) => (m.unitCost === undefined ? m : { ...m, unitCost: convertPrice(m.unitCost, rate, to) }));
}

export function convertCounts(counts: StockCount[], rate: number, to: Currency): StockCount[] {
  return counts.map((c) => ({
    ...c,
    lines: c.lines.map((l) => (l.unitCost === undefined ? l : { ...l, unitCost: convertPrice(l.unitCost, rate, to) })),
  }));
}

/**
 * Bills, expenses, and payroll runs stay in what was paid — now the cost
 * currency — and take the switch's rate if they don't carry one already.
 */
export function stampRate<T extends { rate?: number }>(records: T[], rate: number): T[] {
  return records.map((r) => (r.rate ? r : { ...r, rate }));
}

/** An order's amounts over `rate`, to `to`'s smallest unit. */
export function orderInCurrency(record: OrderRecord, rate: number, to: Currency): OrderRecord {
  const c = (n: number) => convertPrice(n, rate, to);
  return {
    ...record,
    lines: record.lines.map((l) => ({
      ...l,
      unitPrice: c(l.unitPrice),
      ...(l.listPrice !== undefined ? { listPrice: c(l.listPrice) } : {}),
      ...(l.unitCost !== undefined ? { unitCost: c(l.unitCost) } : {}),
    })),
    ...(record.discount !== undefined ? { discount: c(record.discount) } : {}),
    tax: c(record.tax),
    tip: c(record.tip),
    payments: record.payments.map((p) => ({
      ...p,
      amount: c(p.amount),
      ...(p.tendered !== undefined ? { tendered: c(p.tendered) } : {}),
    })),
    ...(record.refunds
      ? { refunds: record.refunds.map((r) => ({ ...r, subtotal: c(r.subtotal), tax: c(r.tax), amount: c(r.amount) })) }
      : {}),
  };
}

/**
 * What has to be settled before switching, so nothing open straddles both
 * currencies: tabs with items on, room bills not paid, and money taken since
 * the last cash-up. Empty when the shop can switch.
 */
export function switchBlockers(input: {
  tabs: { name: string; cart: unknown[]; payments: Payment[] }[];
  orders: OrderRecord[];
  cashUps: CashUp[];
  now?: Date;
}): string[] {
  const { tabs, orders, cashUps, now = new Date() } = input;
  const out: string[] = [];
  const open = tabs.filter((t) => t.cart.length > 0).map((t) => t.name);
  if (open.length > 0) {
    out.push(`${listNames(open)} ${open.length === 1 ? 'has an open tab' : 'have open tabs'} — clear or pay ${open.length === 1 ? 'it' : 'them'} first.`);
  }
  const rooms = new Set(orders.filter((o) => o.status === 'charged').map((o) => o.roomId)).size;
  if (rooms > 0) {
    out.push(`${rooms} ${rooms === 1 ? 'room has a bill' : 'rooms have bills'} not yet settled — settle at the counter first.`);
  }
  const taken = shiftTotals(orders, tabs.flatMap((t) => t.payments), shiftStart(cashUps, now), now.toISOString()).payments;
  if (taken > 0) {
    out.push(`${taken} ${taken === 1 ? 'payment has' : 'payments have'} come in since the last cash-up — close the shift at the counter first.`);
  }
  return out;
}

/** "Table 4", "Table 4 and Room 2", "Table 4, Room 2 and 3 more". */
function listNames(names: string[]): string {
  if (names.length <= 2) return names.join(' and ');
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
}

/** Whether something stamped `iso` happened before the shop switched what it sells in. */
export function beforeSwitch(iso: string, sw: CurrencySwitch | undefined): sw is CurrencySwitch {
  return !!sw && iso < sw.at;
}

/**
 * A saved order as the app reads it. One closed before the switch comes back
 * in the sales currency, holding the order as it was recorded for its receipt.
 */
export function readOrder(record: OrderRecord, sw: CurrencySwitch | undefined, to: Currency): Order {
  if (!beforeSwitch(record.at, sw)) return hydrateOrder(record);
  return {
    ...hydrateOrder(orderInCurrency(record, sw.rate, to)),
    recordedIn: { currency: sw.from, rate: sw.rate, original: hydrateOrder(record) },
  };
}

/** The currency an order's receipt shows: what it was recorded in, if that's not today's. */
export function receiptCurrency(order: Order): Currency | undefined {
  return order.recordedIn ? currencyOf(order.recordedIn.currency) : undefined;
}
