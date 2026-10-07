export type CatalogItem = {
  id: string;
  name: string;
  price: number;
  /** Category-differentiation color for the tile dot. Decorative, not signal. */
  color: string;
  category: CategoryId;
  /** Hidden from the register grid when false. */
  available: boolean;
  description?: string;
  /**
   * Units on hand. Changed only through the stock ledger — sales, refunds,
   * deliveries, and logged adjustments — never overwritten directly.
   */
  stock: number;
  /** Warn once stock falls to this many or fewer. Unset follows the low-stock default in Settings. */
  lowStockAt?: number;
  /** What one unit costs to buy in — a weighted average, updated as deliveries arrive. */
  cost?: number;
  /** Who it's usually bought from. */
  supplierId?: string;
  /** Reorder up to this many. Low-stock reorders suggest the difference. */
  parLevel?: number;
  /** Priced at the counter each time it's sold — `price` is only a guide. */
  openPrice?: boolean;
  /**
   * Servings sold besides the whole one at `price` — a half chicken, a
   * quarter cake. Unset sells only whole.
   */
  portions?: Portion[];
};

/** A serving of an item sold at its own price, drawing `units` of its stock. */
export type Portion = {
  id: string;
  /** "Half", "Quarter", "Slice". */
  label: string;
  price: number;
  /** How much of one stock unit it uses — 0.5 for a half, 0.25 for a quarter. */
  units: number;
};

export const LOW_STOCK_DEFAULT = 5;

export type StockState = 'in' | 'low' | 'out';

/** `lowDefault` is the Settings low-stock threshold, for items that don't set their own. */
export function stockState(
  item: Pick<CatalogItem, 'stock' | 'lowStockAt'>,
  lowDefault = LOW_STOCK_DEFAULT,
): StockState {
  if (item.stock <= 0) return 'out';
  if (item.stock <= (item.lowStockAt ?? lowDefault)) return 'low';
  return 'in';
}

/**
 * Item names with each word capitalised — "fried/choma chicken (kisasa)" →
 * "Fried/Choma Chicken (Kisasa)". Only first letters change, so "BBQ" stays.
 */
export function titleCase(name: string): string {
  return name.replace(/(^|[\s/(])(\p{Ll})/gu, (_, before: string, letter: string) => before + letter.toUpperCase());
}

/** `catalog` with every name title-cased, keeping items whose names already are. */
export function withTitleCaseNames(catalog: CatalogItem[]): CatalogItem[] {
  return catalog.map((i) => {
    const name = titleCase(i.name);
    return name === i.name ? i : { ...i, name };
  });
}

/** How many of `item` can be rung up. */
export function stockLimit(item: CatalogItem): number {
  return Math.max(0, item.stock);
}

/**
 * Stock is kept to 4 decimal places, so portions like thirds add back up to
 * whole units instead of drifting.
 */
export function roundStock(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/** Slack when checking portions against stock, so the last third still sells after rounding. */
export const STOCK_SLACK = 1e-3;

/** Whether `units` more of `item` can be rung up with `inCart` already on the tab. */
export function stockFits(item: CatalogItem, inCart: number, units = 1): boolean {
  return inCart + units <= stockLimit(item) + STOCK_SLACK;
}

/** The whole item first, then its portions — what the register offers when it has any. */
export function servings(item: CatalogItem): Portion[] {
  return [{ id: WHOLE, label: 'Whole', price: item.price, units: 1 }, ...(item.portions ?? [])];
}

/** The id `servings` gives the whole item. */
export const WHOLE = 'whole';

/** "1/2", "3/4", "0.3" — a portion's share of a stock unit, as admins type and read it. */
export function unitsLabel(units: number): string {
  for (let den = 2; den <= 12; den++) {
    const num = Math.round(units * den);
    if (num > 0 && Math.abs(num / den - units) < STOCK_SLACK) return num === den ? '1' : `${num}/${den}`;
  }
  return String(roundStock(units));
}

/** "1/2", "0.5", "3/4" → the number; null unless it's above 0. */
export function parseUnits(text: string): number | null {
  const t = text.trim();
  const frac = /^(\d+)\s*\/\s*(\d+)$/.exec(t);
  const n = frac ? Number(frac[1]) / Number(frac[2]) : /^\d*\.?\d+$/.test(t) ? Number(t) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

export type CategoryId = string;

/** A shelf on the register and a heading in reports. Created and managed under Admin → Categories. */
export type Category = { id: CategoryId; label: string };

/** The demo shop's categories. A new shop starts with none. */
export const CATEGORIES: Category[] = [
  { id: 'coffee', label: 'Coffee' },
  { id: 'food', label: 'Food' },
  { id: 'pastries', label: 'Pastries' },
  { id: 'retail', label: 'Retail' },
  { id: 'seasonal', label: 'Seasonal' },
];

/** Shown for an item whose category has gone — only possible through a sync race. */
export const NO_CATEGORY = 'Uncategorized';

export function categoryLabel(categories: Category[], id: CategoryId): string {
  return categories.find((c) => c.id === id)?.label ?? NO_CATEGORY;
}

/**
 * `categories`, plus any the catalog uses that it lacks — for shops saved
 * before categories were editable, whose items name the old built-in ones.
 * Hands back `categories` itself when nothing was missing.
 */
export function withUsedCategories(categories: Category[], catalog: CatalogItem[]): Category[] {
  const known = new Set(categories.map((c) => c.id));
  const missing: Category[] = [];
  for (const { category: id } of catalog) {
    if (known.has(id)) continue;
    known.add(id);
    const label = CATEGORIES.find((c) => c.id === id)?.label ?? id.charAt(0).toUpperCase() + id.slice(1);
    missing.push({ id, label });
  }
  return missing.length > 0 ? [...categories, ...missing] : categories;
}

const CATALOG_ITEMS: CatalogItem[] = [
  // Coffee — the set shown in the register mockup.
  { id: 'cortado', name: 'Cortado', price: 5_500, color: '#ff4b2e', category: 'coffee', available: true, stock: 60, description: 'Equal parts espresso and warm milk.' },
  { id: 'drip', name: 'Drip Coffee', price: 4_000, color: '#8a5cf6', category: 'coffee', available: true, stock: 120 },
  { id: 'oat-latte', name: 'Oat Latte', price: 6_500, color: '#1fae5c', category: 'coffee', available: true, stock: 48, description: 'Espresso, steamed oat milk, light foam.' },
  { id: 'cold-brew', name: 'Cold Brew', price: 6_000, color: '#0e7bd6', category: 'coffee', available: true, stock: 30, description: 'Steeped 18 hours, served over ice.' },
  { id: 'americano', name: 'Americano', price: 4_500, color: '#e0a300', category: 'coffee', available: true, stock: 80 },
  { id: 'matcha', name: 'Matcha Latte', price: 7_000, color: '#2f9e44', category: 'coffee', available: true, stock: 25 },
  { id: 'espresso', name: 'Espresso Shot', price: 3_500, color: '#121212', category: 'coffee', available: true, stock: 150 },
  { id: 'hot-choc', name: 'Hot Chocolate', price: 5_000, color: '#8a5a2b', category: 'coffee', available: true, stock: 40 },

  { id: 'avo-toast', name: 'Avocado Toast', price: 12_000, color: '#2f9e44', category: 'food', available: true, stock: 16 },
  { id: 'breakfast-burrito', name: 'Breakfast Burrito', price: 13_000, color: '#e0a300', category: 'food', available: true, stock: 14 },
  { id: 'turkey-club', name: 'Turkey Club', price: 15_000, color: '#8a5a2b', category: 'food', available: true, stock: 10 },
  { id: 'soup-day', name: 'Soup of the Day', price: 8_000, color: '#ff4b2e', category: 'food', available: true, stock: 20 },
  { id: 'grain-bowl', name: 'Grain Bowl', price: 15_000, color: '#0e7bd6', category: 'food', available: true, stock: 12 },

  { id: 'croissant', name: 'Butter Croissant', price: 5_000, color: '#e0a300', category: 'pastries', available: true, stock: 12 },
  { id: 'pain-choc', name: 'Pain au Chocolat', price: 6_000, color: '#8a5a2b', category: 'pastries', available: true, stock: 4 },
  { id: 'morning-bun', name: 'Morning Bun', price: 5_500, color: '#ff4b2e', category: 'pastries', available: true, stock: 0 },
  { id: 'banana-bread', name: 'Banana Bread', price: 4_500, color: '#8a5cf6', category: 'pastries', available: true, stock: 9 },
  { id: 'scone', name: 'Blueberry Scone', price: 5_000, color: '#0e7bd6', category: 'pastries', available: true, stock: 6 },

  { id: 'beans-12', name: 'Whole Bean 12oz', price: 25_000, color: '#8a5a2b', category: 'retail', available: true, stock: 14 },
  { id: 'tumbler', name: 'Occupy Tumbler', price: 35_000, color: '#121212', category: 'retail', available: true, stock: 3, lowStockAt: 2 },
  { id: 'tote', name: 'Canvas Tote', price: 28_000, color: '#1fae5c', category: 'retail', available: true, stock: 8 },
  { id: 'filters', name: 'Paper Filters', price: 10_000, color: '#63615c', category: 'retail', available: true, stock: 22 },

  { id: 'pumpkin-latte', name: 'Pumpkin Latte', price: 8_000, color: '#ff4b2e', category: 'seasonal', available: true, stock: 35 },
  { id: 'maple-cold-brew', name: 'Maple Cold Brew', price: 7_500, color: '#e0a300', category: 'seasonal', available: true, stock: 24 },
  { id: 'spiced-cider', name: 'Spiced Cider', price: 7_000, color: '#8a5a2b', category: 'seasonal', available: true, stock: 18 },
];

/** Buying-in details for the seed catalog: unit cost, supplier, reorder-up-to level. */
const SUPPLY: Record<string, [cost: number, supplierId: string, parLevel: number]> = {
  cortado: [1_800, 'kilimanjaro', 80],
  drip: [1_200, 'kilimanjaro', 150],
  'oat-latte': [2_300, 'kilimanjaro', 80],
  'cold-brew': [1_900, 'kilimanjaro', 50],
  americano: [1_300, 'kilimanjaro', 100],
  matcha: [2_600, 'kilimanjaro', 40],
  espresso: [1_000, 'kilimanjaro', 180],
  'hot-choc': [1_700, 'kilimanjaro', 60],
  'avo-toast': [5_000, 'coastal-kitchen', 24],
  'breakfast-burrito': [5_500, 'coastal-kitchen', 24],
  'turkey-club': [6_500, 'coastal-kitchen', 16],
  'soup-day': [3_000, 'coastal-kitchen', 30],
  'grain-bowl': [6_500, 'coastal-kitchen', 20],
  croissant: [2_200, 'dar-bakery', 24],
  'pain-choc': [2_700, 'dar-bakery', 20],
  'morning-bun': [2_400, 'dar-bakery', 20],
  'banana-bread': [1_800, 'dar-bakery', 16],
  scone: [2_100, 'dar-bakery', 16],
  'beans-12': [14_000, 'kilimanjaro', 24],
  tumbler: [18_000, 'mzuri', 10],
  tote: [14_000, 'mzuri', 12],
  filters: [5_000, 'mzuri', 30],
  'pumpkin-latte': [3_000, 'kilimanjaro', 50],
  'maple-cold-brew': [2_800, 'kilimanjaro', 36],
  'spiced-cider': [2_600, 'kilimanjaro', 30],
};

export const CATALOG: CatalogItem[] = CATALOG_ITEMS.map((item) => {
  const supply = SUPPLY[item.id];
  return supply
    ? { ...item, cost: supply[0], supplierId: supply[1], parLevel: supply[2] }
    : item;
});

/** Default sales tax until Settings changes it. Seed prices are in Tanzanian shillings. */
export const TAX_RATE = 0.18;
