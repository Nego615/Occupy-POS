import type { CatalogItem, CategoryId } from './catalog';

/** One way a product varies — "Size", with S, M and L. */
export type ProductOption = { name: string; values: string[] };

/**
 * Something a retail shop sells in sizes or colours — a t-shirt. Each
 * combination of its options is a catalog item of its own (its variant), with
 * its own code, price and stock, so stock, purchases, counts and reports treat
 * variants like any other item. The product only groups them: one tile on the
 * register, one editor in the back office.
 */
export type Product = {
  id: string;
  name: string;
  category: CategoryId;
  color: string;
  /** In the order the variant's values are listed. */
  options: ProductOption[];
};

/** "M / Black". */
export function variantLabel(values: string[]): string {
  return values.join(' / ');
}

/** The name a variant goes by on tabs, receipts and reports — "Classic Tee · M / Black". */
export function variantName(productName: string, values: string[]): string {
  return values.length > 0 ? `${productName} · ${variantLabel(values)}` : productName;
}

/** Options with their blanks and repeats dropped, leaving out any with no values. */
export function cleanOptions(options: ProductOption[]): ProductOption[] {
  return options
    .map((o) => ({
      name: o.name.trim(),
      values: [...new Set(o.values.map((v) => v.trim()).filter(Boolean))],
    }))
    .filter((o) => o.name && o.values.length > 0);
}

/** Every combination of the options' values, the first option changing slowest. */
export function combinations(options: ProductOption[]): string[][] {
  return options.reduce<string[][]>(
    (combos, option) => combos.flatMap((combo) => option.values.map((v) => [...combo, v])),
    [[]],
  );
}

/** Two variants are the same when their values match, whatever the case. */
export function sameVariant(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v.toLowerCase() === b[i].toLowerCase());
}

/** The product's variants, in the catalog's order. */
export function variantsOf(catalog: CatalogItem[], productId: string): CatalogItem[] {
  return catalog.filter((i) => i.productId === productId);
}

/**
 * A product's variants against its options: which items to keep (matched to
 * a combination, by their values), which combinations need a new item, and
 * which items no combination covers any more.
 */
export function planVariants(
  options: ProductOption[],
  existing: CatalogItem[],
): { keep: { item: CatalogItem; values: string[] }[]; add: string[][]; drop: CatalogItem[] } {
  const keep: { item: CatalogItem; values: string[] }[] = [];
  const add: string[][] = [];
  const left = [...existing];
  for (const values of combinations(options)) {
    const at = left.findIndex((i) => sameVariant(i.variant ?? [], values));
    if (at === -1) add.push(values);
    else keep.push({ item: left.splice(at, 1)[0], values });
  }
  return { keep, add, drop: left };
}

/** The lowest and highest price among `variants`, or null with none. */
export function priceRange(variants: CatalogItem[]): { low: number; high: number } | null {
  if (variants.length === 0) return null;
  const prices = variants.map((v) => v.price);
  return { low: Math.min(...prices), high: Math.max(...prices) };
}

/** A code with its surrounding space dropped; SKUs match whatever their case. */
function normal(code: string): string {
  return code.trim().toLowerCase();
}

/** The item whose barcode or SKU is exactly `code`, if any — barcodes first. */
export function findByCode(catalog: CatalogItem[], code: string): CatalogItem | undefined {
  const c = normal(code);
  if (!c) return undefined;
  return catalog.find((i) => i.barcode && normal(i.barcode) === c) ?? catalog.find((i) => i.sku && normal(i.sku) === c);
}

/**
 * Another item already using `code` as its barcode or SKU — a code can only
 * ring up one thing. `ignore` are the items being edited, which may swap codes
 * between themselves.
 */
export function codeOwner(catalog: CatalogItem[], code: string, ignore: string[] = []): CatalogItem | undefined {
  const c = normal(code);
  if (!c) return undefined;
  return catalog.find(
    (i) => !ignore.includes(i.id) && ((i.barcode && normal(i.barcode) === c) || (i.sku && normal(i.sku) === c)),
  );
}

/**
 * Codes repeated among `codes` (one entry per field, blanks allowed), in the
 * form they were typed — a product's variants can't share one either.
 */
export function repeatedCodes(codes: string[]): Set<string> {
  const seen = new Set<string>();
  const repeats = new Set<string>();
  for (const code of codes) {
    const c = normal(code);
    if (!c) continue;
    if (seen.has(c)) repeats.add(c);
    seen.add(c);
  }
  return repeats;
}

/** Whether `code` is one of `repeats`, as repeatedCodes returned them. */
export function isRepeated(repeats: Set<string>, code: string): boolean {
  return repeats.has(normal(code));
}

/**
 * A SKU suggested from the product's name and the variant's values —
 * "Classic Tee", ["M", "Black"] → "CLAS-M-BLAC". Only a starting point.
 */
export function suggestSku(productName: string, values: string[]): string {
  const part = (s: string) =>
    s
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '')
      .slice(0, 4);
  return [part(productName), ...values.map(part)].filter(Boolean).join('-');
}
