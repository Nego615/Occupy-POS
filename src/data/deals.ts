import { formatCurrency } from '../lib/currency';
import type { CatalogItem, CategoryId } from './catalog';

/**
 * An automatic price cut — happy hour, a weekday breakfast deal. The register
 * applies it on its own to matching items rung up while it's running; nobody
 * keys it in. The price is fixed when the item lands on a tab, so a tab opened
 * at 5:55 keeps its happy-hour prices after 6:00.
 */
export type Promotion = {
  id: string;
  name: string;
  /** Switched off promotions never apply, whatever their schedule. */
  active: boolean;
  /** `percent` takes `value` as a fraction (0.2 is 20% off); `amount` takes it off each unit. */
  kind: 'percent' | 'amount';
  value: number;
  /** Categories it covers. With `itemIds` also empty, it covers everything. */
  categories: CategoryId[];
  /** Individual items it covers, on top of `categories`. */
  itemIds: string[];
  /** Days it runs, 0 = Sunday. Empty runs every day. */
  days: number[];
  /**
   * Minutes after midnight it starts and stops; both null runs all day. A
   * window that ends before it starts runs past midnight.
   */
  start: number | null;
  end: number | null;
};

/** One course of a set meal — "Main" — and the items the guest can pick from. */
export type Course = {
  name: string;
  itemIds: string[];
};

/**
 * A full meal sold at one price: one pick from each course. On a tab it's a
 * single line; its picks are what come out of stock and go to the kitchen.
 */
export type SetMeal = {
  id: string;
  name: string;
  price: number;
  /** Tile dot color on the register. Decorative. */
  color: string;
  /** Hidden from the register when false. */
  available: boolean;
  description?: string;
  courses: Course[];
};

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const PROMOTIONS: Promotion[] = [
  {
    id: 'happy-hour',
    name: 'Happy Hour',
    active: true,
    kind: 'percent',
    value: 0.2,
    categories: ['coffee', 'seasonal'],
    itemIds: [],
    days: [1, 2, 3, 4, 5],
    start: 16 * 60,
    end: 18 * 60,
  },
  {
    id: 'pastry-close',
    name: 'Pastries before close',
    active: false,
    kind: 'amount',
    value: 1_500,
    categories: ['pastries'],
    itemIds: [],
    days: [],
    start: 19 * 60,
    end: 21 * 60,
  },
];

export const SET_MEALS: SetMeal[] = [
  {
    id: 'meal-lunch',
    name: 'Three-Course Lunch',
    price: 30_000,
    color: '#121212',
    available: true,
    description: 'Starter, main, dessert, and a drink.',
    courses: [
      { name: 'Starter', itemIds: ['soup-day', 'avo-toast'] },
      { name: 'Main', itemIds: ['turkey-club', 'grain-bowl', 'breakfast-burrito'] },
      { name: 'Dessert', itemIds: ['croissant', 'pain-choc', 'banana-bread', 'scone', 'morning-bun'] },
      { name: 'Drink', itemIds: ['drip', 'americano', 'cortado', 'oat-latte', 'cold-brew'] },
    ],
  },
  {
    id: 'meal-breakfast',
    name: 'Breakfast Set',
    price: 15_000,
    color: '#e0a300',
    available: true,
    courses: [
      { name: 'Pastry', itemIds: ['croissant', 'pain-choc', 'scone'] },
      { name: 'Coffee', itemIds: ['drip', 'americano', 'cortado', 'oat-latte'] },
    ],
  },
];

function minutesOf(at: Date): number {
  return at.getHours() * 60 + at.getMinutes();
}

/** Whether `promo` is switched on and inside its days and hours at `at`. */
export function promoRunning(promo: Promotion, at: Date): boolean {
  if (!promo.active) return false;
  if (promo.days.length > 0 && !promo.days.includes(at.getDay())) return false;
  if (promo.start === null || promo.end === null) return true;
  const t = minutesOf(at);
  return promo.start <= promo.end
    ? t >= promo.start && t < promo.end
    : t >= promo.start || t < promo.end;
}

export function promoCovers(promo: Promotion, item: Pick<CatalogItem, 'id' | 'category'>): boolean {
  if (promo.categories.length === 0 && promo.itemIds.length === 0) return true;
  return promo.categories.includes(item.category) || promo.itemIds.includes(item.id);
}

/** `price` with `promo` taken off — never below zero. Rounding is the caller's. */
export function discounted(promo: Promotion, price: number): number {
  return promo.kind === 'percent'
    ? price * (1 - promo.value)
    : Math.max(0, price - promo.value);
}

/** The running promotion that takes the most off `item` at `at`, if any. */
export function bestPromo(
  promos: Promotion[],
  item: Pick<CatalogItem, 'id' | 'category' | 'price'>,
  at: Date,
): Promotion | null {
  let best: Promotion | null = null;
  for (const p of promos) {
    if (!promoRunning(p, at) || !promoCovers(p, item)) continue;
    if (!best || discounted(p, item.price) < discounted(best, item.price)) best = p;
  }
  return best;
}

/** "20% off", "TSh 1,500 off". */
export function promoAmountLabel(promo: Pick<Promotion, 'kind' | 'value'>): string {
  return promo.kind === 'percent'
    ? `${Math.round(promo.value * 100)}% off`
    : `${formatCurrency(promo.value)} off`;
}

/** "4:00 PM" from minutes after midnight. */
export function clockLabel(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

/** "Mon–Fri · 4:00 PM – 6:00 PM", "Every day · all day". */
export function scheduleLabel(promo: Pick<Promotion, 'days' | 'start' | 'end'>): string {
  return `${daysLabel(promo.days)} · ${
    promo.start === null || promo.end === null
      ? 'all day'
      : `${clockLabel(promo.start)} – ${clockLabel(promo.end)}`
  }`;
}

function daysLabel(days: number[]): string {
  if (days.length === 0 || days.length === 7) return 'Every day';
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.join() === '1,2,3,4,5') return 'Mon–Fri';
  if (sorted.join() === '0,6') return 'Weekends';
  // A single unbroken run reads as a range — "Tue–Thu".
  const run = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
  if (run && sorted.length > 2) return `${WEEKDAYS[sorted[0]]}–${WEEKDAYS[sorted[sorted.length - 1]]}`;
  return sorted.map((d) => WEEKDAYS[d]).join(', ');
}

/** What the scope reads as — "Coffee, Seasonal", "Everything", "Coffee + 2 items". */
export function scopeLabel(
  promo: Pick<Promotion, 'categories' | 'itemIds'>,
  categoryLabel: (id: CategoryId) => string,
): string {
  if (promo.categories.length === 0 && promo.itemIds.length === 0) return 'Everything';
  const parts = promo.categories.map(categoryLabel);
  const n = promo.itemIds.length;
  if (n > 0) parts.push(`${n} ${n === 1 ? 'item' : 'items'}`);
  return parts.join(' + ');
}

/** A course's options that are still in the catalog. Deleted items drop out. */
export function courseOptions(course: Course, catalog: CatalogItem[]): CatalogItem[] {
  return course.itemIds
    .map((id) => catalog.find((i) => i.id === id))
    .filter((i): i is CatalogItem => !!i);
}

/**
 * The cheapest and dearest the picks could cost bought separately — what the
 * meal is "worth". Null while a course has nothing to pick.
 */
export function mealWorth(meal: SetMeal, catalog: CatalogItem[]): [number, number] | null {
  let low = 0;
  let high = 0;
  for (const course of meal.courses) {
    const prices = courseOptions(course, catalog).map((i) => i.price);
    if (prices.length === 0) return null;
    low += Math.min(...prices);
    high += Math.max(...prices);
  }
  return [low, high];
}
