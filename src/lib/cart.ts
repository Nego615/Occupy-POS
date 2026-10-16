import { STOCK_SLACK, WHOLE, recipePours, stockFits, type AddOnPick, type CatalogItem, type Portion, type Pour } from '../data/catalog';
import { discounted, type Promotion, type SetMeal } from '../data/deals';
import { formatCurrency, roundMoney } from './currency';

/** One pick inside a set meal line. */
export type CartPart = {
  itemId: string;
  name: string;
  /** The course it was picked for — "Main". */
  course: string;
};

export type CartLine = {
  /**
   * Identifies the line on the tab. A plain item's id; with a promotion, the
   * id and the promotion, so happy-hour and full-price units sit apart; for a
   * portion, the id and the portion; for a set meal, the meal and its picks.
   */
  key: string;
  /** The catalog item — or, for a set meal, the meal's id. */
  itemId: string;
  name: string;
  /** What one is charged at, after any promotion. */
  unitPrice: number;
  qty: number;
  /** What one would cost without the deal. Set only when it's more than `unitPrice`. */
  listPrice?: number;
  /** The promotion that priced it — "Happy Hour". */
  promo?: string;
  /** A set meal's picks, one per course. These are what stock and the kitchen see. */
  parts?: CartPart[];
  /** "No onions" — printed on the kitchen ticket and the receipt. */
  note?: string;
  /** A discount given by hand on this line, on top of any promotion. */
  manual?: LineDiscount;
  /** Stock one of it uses, for a portion — 0.5 for a half. Absent means 1. */
  units?: number;
  /**
   * What one pours off stock, from its recipe as it stood when rung up —
   * stock draws on these instead of the item itself.
   */
  pours?: Pour[];
  /**
   * Sides and extras rung up with it — chips with a main — their prices in
   * `unitPrice`. On a set meal, each names which pick it goes with.
   */
  addOns?: AddOnPick[];
};

/** A discount given by hand — on one line or on the whole tab. */
export type ManualDiscount = {
  kind: 'percent' | 'amount';
  /** A percentage (10 for 10%) or an amount in the business currency. */
  value: number;
  /** Staff id of whoever gave or okayed it. */
  by?: string;
};

/** A line's manual discount, with the pricing it replaced so it can be taken off again. */
export type LineDiscount = ManualDiscount & {
  base: Pick<CartLine, 'unitPrice' | 'listPrice' | 'promo'>;
};

/** Item id that custom-amount lines carry. Never in the catalog, so stock and the kitchen skip it. */
export const CUSTOM_ITEM_ID = 'custom';

let customSeq = 0;

export type CartTotals = {
  /** After discounts — what tax is charged on. */
  subtotal: number;
  /** Taken off by promotions, set meals, and manual discounts. Zero when nothing's discounted. */
  discount: number;
  /** The part of `discount` taken off the whole tab by hand. */
  orderDiscount: number;
  tax: number;
  total: number;
  itemCount: number;
};

/** A line for one of `item`, priced by `promo` if one's running. */
export function itemLine(item: CatalogItem, promo: Promotion | null): Omit<CartLine, 'qty'> {
  return portionLine(item, null, promo);
}

/**
 * A line for one `portion` of `item` — "Roast Chicken (Half)" — priced by
 * `promo` if one's running. A null or whole portion is the plain item. Given
 * the `catalog`, an item with a recipe carries what it pours.
 */
export function portionLine(
  item: CatalogItem,
  portion: Portion | null,
  promo: Promotion | null,
  catalog?: CatalogItem[],
): Omit<CartLine, 'qty'> {
  const whole = !portion || portion.id === WHOLE;
  const listPrice = whole ? item.price : portion.price;
  const pours = item.recipe?.length && catalog ? recipePours(item, catalog) : undefined;
  const base: Omit<CartLine, 'qty'> = {
    ...(whole
      ? { key: item.id, itemId: item.id, name: item.name, unitPrice: item.price }
      : {
          key: `${item.id}#${portion.id}`,
          itemId: item.id,
          name: `${item.name} (${portion.label})`,
          unitPrice: portion.price,
          units: portion.units,
        }),
    ...(pours ? { pours } : {}),
  };
  if (!promo) return base;
  const price = round(discounted(promo, listPrice));
  if (price >= listPrice) return base;
  return {
    ...base,
    key: `${base.key}~${promo.id}`,
    unitPrice: price,
    listPrice,
    promo: promo.name,
  };
}

/**
 * `line` rung up with `addOns`: their prices on top of its own, and in its
 * key, so the same item with different sides sits on separate lines.
 */
export function withAddOns(line: Omit<CartLine, 'qty'>, addOns: AddOnPick[]): Omit<CartLine, 'qty'> {
  if (addOns.length === 0) return line;
  const extra = addOns.reduce((sum, a) => sum + a.price, 0);
  const ids = addOns.map((a) => (a.part === undefined ? a.itemId : `${a.part}.${a.itemId}`));
  return {
    ...line,
    key: `${line.key}+a:${ids.join(',')}`,
    unitPrice: round(line.unitPrice + extra),
    ...(line.listPrice !== undefined ? { listPrice: round(line.listPrice + extra) } : {}),
    addOns,
  };
}

/** A one-off line at a typed price — "Custom amount", or a named charge. */
export function customLine(name: string, price: number): Omit<CartLine, 'qty'> {
  return {
    key: `custom-${Date.now().toString(36)}-${++customSeq}`,
    itemId: CUSTOM_ITEM_ID,
    name: name.trim() || 'Custom amount',
    unitPrice: round(price),
  };
}

/** A line for an open-price item at the price typed at the counter. */
export function openPriceLine(item: CatalogItem, price: number): Omit<CartLine, 'qty'> {
  return { key: `${item.id}@${round(price)}`, itemId: item.id, name: item.name, unitPrice: round(price) };
}

/** "10% off", "TSh 2,000 off". */
export function discountLabel(d: Pick<ManualDiscount, 'kind' | 'value'>): string {
  return d.kind === 'percent' ? `${d.value}% off` : `${formatCurrency(d.value)} off`;
}

/** What `d` takes off `amount`, never more than all of it. */
export function discountOff(amount: number, d: Pick<ManualDiscount, 'kind' | 'value'>): number {
  const off = d.kind === 'percent' ? (amount * d.value) / 100 : d.value;
  return round(Math.min(Math.max(0, off), amount));
}

/**
 * The line's key from its pricing and its extras: lines only merge when the
 * item, the deal, the note, and any manual discount all match.
 */
function keyed(line: CartLine): CartLine {
  const base = line.key.split('|')[0];
  const note = line.note ? `|n:${line.note}` : '';
  const manual = line.manual ? `|d:${line.manual.kind}${line.manual.value}` : '';
  return { ...line, key: base + note + manual };
}

/** Replaces line `key` with `next`, folding it into a line that now matches. */
function replaceLine(lines: CartLine[], key: string, next: CartLine): CartLine[] {
  const updated = keyed(next);
  const twin = lines.find((l) => l.key === updated.key && l.key !== key);
  if (twin) {
    return lines
      .filter((l) => l.key !== key)
      .map((l) => (l.key === twin.key ? { ...l, qty: l.qty + updated.qty } : l));
  }
  return lines.map((l) => (l.key === key ? updated : l));
}

/** `line` with its note set, or cleared when blank. */
function withNote(line: CartLine, note: string): CartLine {
  const trimmed = note.trim().replace(/\s+/g, ' ');
  const { note: _old, ...rest } = line;
  return trimmed ? { ...rest, note: trimmed } : rest;
}

/** `line` priced with `discount` on top of its deal, replacing any it had; null takes it off. */
function withDiscount(line: CartLine, discount: ManualDiscount | null): CartLine {
  const { manual, ...rest } = line;
  const base = manual?.base ?? { unitPrice: line.unitPrice, listPrice: line.listPrice, promo: line.promo };
  const plain: CartLine = { ...rest, unitPrice: base.unitPrice };
  delete plain.listPrice;
  delete plain.promo;
  if (base.listPrice !== undefined) plain.listPrice = base.listPrice;
  if (base.promo) plain.promo = base.promo;
  if (!discount || discount.value <= 0) return plain;

  const label = discountLabel(discount);
  return {
    ...plain,
    unitPrice: round(base.unitPrice - discountOff(base.unitPrice, discount)),
    listPrice: base.listPrice ?? base.unitPrice,
    promo: base.promo ? `${base.promo} + ${label}` : label,
    manual: { ...discount, base },
  };
}

/** Sets or clears a line's note. */
export function setLineNote(lines: CartLine[], key: string, note: string): CartLine[] {
  const line = lines.find((l) => l.key === key);
  return line ? replaceLine(lines, key, withNote(line, note)) : lines;
}

/** Gives a line a manual discount, replacing any it had; null takes it off. */
export function setLineDiscount(
  lines: CartLine[],
  key: string,
  discount: ManualDiscount | null,
): CartLine[] {
  const line = lines.find((l) => l.key === key);
  return line ? replaceLine(lines, key, withDiscount(line, discount)) : lines;
}

/** Sets a line's note and discount together — both re-key it, so they're applied as one change. */
export function editLine(
  lines: CartLine[],
  key: string,
  note: string,
  discount: ManualDiscount | null,
): CartLine[] {
  const line = lines.find((l) => l.key === key);
  return line ? replaceLine(lines, key, withNote(withDiscount(line, discount), note)) : lines;
}

/** An add-on picked in a set meal, before it's tied to its pick. */
export type CourseAddOn = Omit<AddOnPick, 'part'>;

/**
 * A line for one `meal` made of `picks`, one per course in order — null for a
 * course the guest skipped. It's rung up at the meal's price whatever's picked,
 * or skipped — the picks' own prices don't show as a list price or count as a
 * discount. `addOns` are each course's add-ons, also by course, and cost extra.
 */
export function mealLine(
  meal: SetMeal,
  picks: (CatalogItem | null)[],
  addOns: CourseAddOn[][] = [],
): Omit<CartLine, 'qty'> {
  const parts: CartPart[] = [];
  const extras: AddOnPick[] = [];
  picks.forEach((p, i) => {
    if (!p) return;
    // Tied to the pick by where it sits in `parts`, which skipped courses don't take up.
    for (const a of addOns[i] ?? []) extras.push({ ...a, part: parts.length });
    parts.push({ itemId: p.id, name: p.name, course: meal.courses[i].name });
  });
  return withAddOns(
    {
      // Skipped courses keep their place, so "main, no dessert" and "dessert, no main" sit apart.
      key: `${meal.id}:${picks.map((p) => p?.id ?? '').join('+')}`,
      itemId: meal.id,
      name: meal.name,
      unitPrice: meal.price,
      parts,
    },
    extras,
  );
}

/** Adds one of `line`, incrementing the matching line if there is one. */
export function addLine(lines: CartLine[], line: Omit<CartLine, 'qty'>): CartLine[] {
  const existing = lines.find((l) => l.key === line.key);
  if (existing) {
    return lines.map((l) => (l.key === line.key ? { ...l, qty: l.qty + 1 } : l));
  }
  return [...lines, { ...line, qty: 1 }];
}

/**
 * Folds `incoming` into `lines` — matching lines add their quantities, new
 * ones append. A matched line keeps the receiving line's price.
 */
export function mergeLines(lines: CartLine[], incoming: CartLine[]): CartLine[] {
  const merged = lines.map((l) => ({ ...l }));
  for (const line of incoming) {
    const existing = merged.find((l) => l.key === line.key);
    if (existing) existing.qty += line.qty;
    else merged.push({ ...line });
  }
  return merged;
}

/** How many of each line (by key) have already been on a printed docket. */
export type Printed = Record<string, number>;

/**
 * The current order: what's on the tab beyond what earlier dockets printed,
 * each line at just its new quantity.
 */
export function unprintedLines(lines: CartLine[], printed: Printed = {}): CartLine[] {
  return lines
    .map((l) => ({ ...l, qty: l.qty - Math.min(l.qty, printed[l.key] ?? 0) }))
    .filter((l) => l.qty > 0);
}

/** Everything on the tab counted as printed — the current order ends and the next starts empty. */
export function allPrinted(lines: CartLine[]): Printed {
  return Object.fromEntries(lines.map((l) => [l.key, l.qty]));
}

/** `printed` kept no higher than what's still on the tab, so a re-added item counts as new. */
export function trimPrinted(lines: CartLine[], printed: Printed): Printed {
  const next: Printed = {};
  for (const l of lines) {
    const n = Math.min(l.qty, printed[l.key] ?? 0);
    if (n > 0) next[l.key] = n;
  }
  return next;
}

/** Two tabs' `printed` added together, for when they merge. */
export function addPrinted(a: Printed = {}, b: Printed = {}): Printed {
  const next: Printed = { ...a };
  for (const [key, n] of Object.entries(b)) next[key] = (next[key] ?? 0) + n;
  return next;
}

/** Setting a quantity to 0 drops the line. */
export function setLineQty(lines: CartLine[], key: string, qty: number): CartLine[] {
  return qty <= 0
    ? lines.filter((l) => l.key !== key)
    : lines.map((l) => (l.key === key ? { ...l, qty } : l));
}

type LineShape = Pick<CartLine, 'itemId' | 'name' | 'parts' | 'units' | 'addOns' | 'pours'>;

/**
 * What one of `line` is made of — itself, or a set meal's picks — each with
 * the add-ons that go with it, and its share of stock: a portion's, otherwise 1.
 */
export function lineDishes(
  line: LineShape,
): { itemId: string; name: string; units: number; addOns: AddOnPick[] }[] {
  const addOns = line.addOns ?? [];
  return line.parts
    ? line.parts.map((p, i) => ({ itemId: p.itemId, name: p.name, units: 1, addOns: addOns.filter((a) => a.part === i) }))
    : [{ itemId: line.itemId, name: line.name, units: line.units ?? 1, addOns }];
}

/**
 * Catalog items one of `line` uses — itself or a set meal's picks, and their
 * add-ons — and how much stock of each: a portion's share, otherwise 1. An
 * item with a recipe uses its ingredients instead, a portion pouring its share.
 */
export function lineItems(line: LineShape): { itemId: string; name: string; units: number }[] {
  return lineDishes(line).flatMap((d) => [
    ...(line.pours && !line.parts
      ? line.pours.map((p) => ({ itemId: p.itemId, name: p.name, units: p.units * d.units }))
      : [{ itemId: d.itemId, name: d.name, units: d.units }]),
    ...d.addOns.map((a) => ({ itemId: a.itemId, name: a.name, units: 1 })),
  ]);
}

/** Whether one more of `line` fits in what's on hand, counting what `lines` already hold. */
export function lineFits(lines: CartLine[], line: LineShape, catalog: CatalogItem[]): boolean {
  const counts = itemQuantities(lines);
  const uses = lineItems(line);
  for (const { itemId, units } of uses) counts.set(itemId, (counts.get(itemId) ?? 0) + units);
  // Items that have left the catalog aren't held back.
  return uses.every(({ itemId }) => {
    const item = catalog.find((i) => i.id === itemId);
    return !item || stockFits(item, counts.get(itemId) ?? 0, 0);
  });
}

/**
 * How much stock of each catalog item `lines` use, counting set meals' picks
 * and portions by their share — two halves are 1.
 */
export function itemQuantities(lines: CartLine[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of lines) {
    for (const item of lineItems(line)) {
      counts.set(item.itemId, (counts.get(item.itemId) ?? 0) + line.qty * item.units);
    }
  }
  return counts;
}

/**
 * The most `key`'s line can go up to with what's on hand, counting the rest
 * of the tab. Lines whose items left the catalog aren't capped.
 */
export function lineCap(lines: CartLine[], key: string, catalog: CatalogItem[]): number {
  const line = lines.find((l) => l.key === key);
  if (!line) return 0;
  const counts = itemQuantities(lines);
  let cap = Infinity;
  const perUnit = new Map<string, number>();
  for (const item of lineItems(line)) perUnit.set(item.itemId, (perUnit.get(item.itemId) ?? 0) + item.units);
  for (const [itemId, each] of perUnit) {
    const item = catalog.find((i) => i.id === itemId);
    if (!item || item.untracked) continue;
    const elsewhere = (counts.get(itemId) ?? 0) - each * line.qty;
    cap = Math.min(cap, Math.floor((Math.max(0, item.stock) - elsewhere + STOCK_SLACK) / each));
  }
  return Math.max(0, cap);
}

/**
 * `taxRate` comes from settings — a fraction, 0.18 for 18%. A tab-wide
 * discount comes off after line deals and before tax.
 */
export function computeTotals(
  lines: CartLine[],
  taxRate: number,
  tabDiscount?: ManualDiscount | null,
): CartTotals {
  const linesTotal = lines.reduce((sum, l) => sum + l.unitPrice * l.qty, 0);
  const orderDiscount = tabDiscount ? discountOff(linesTotal, tabDiscount) : 0;
  const subtotal = linesTotal - orderDiscount;
  const discount =
    lines.reduce((sum, l) => sum + ((l.listPrice ?? l.unitPrice) - l.unitPrice) * l.qty, 0) +
    orderDiscount;
  const tax = round(subtotal * taxRate);
  return {
    subtotal: round(subtotal),
    discount: round(discount),
    orderDiscount,
    tax,
    total: round(subtotal + tax),
    itemCount: lines.reduce((sum, l) => sum + l.qty, 0),
  };
}

/** Money rounding, to the business currency's smallest unit (cents, or whole shillings). */
export function round(n: number): number {
  return roundMoney(n);
}
