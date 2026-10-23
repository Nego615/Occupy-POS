import { describe, expect, it } from 'vitest';
import type { CatalogItem } from './catalog';
import {
  cleanOptions,
  codeOwner,
  combinations,
  findByCode,
  isRepeated,
  planVariants,
  priceRange,
  repeatedCodes,
  suggestSku,
  variantName,
} from './products';

const item = (id: string, extra: Partial<CatalogItem> = {}): CatalogItem => ({
  id,
  name: id,
  price: 1000,
  color: '#000',
  category: 'apparel',
  available: true,
  stock: 0,
  ...extra,
});

describe('combinations', () => {
  it('crosses every option, the first changing slowest', () => {
    expect(
      combinations([
        { name: 'Size', values: ['S', 'M'] },
        { name: 'Colour', values: ['Black', 'White'] },
      ]),
    ).toEqual([
      ['S', 'Black'],
      ['S', 'White'],
      ['M', 'Black'],
      ['M', 'White'],
    ]);
  });

  it('gives one per value for a single option', () => {
    expect(combinations([{ name: 'Size', values: ['S', 'M', 'L'] }])).toEqual([['S'], ['M'], ['L']]);
  });
});

describe('cleanOptions', () => {
  it('trims, drops blanks and repeats, and options left empty', () => {
    expect(
      cleanOptions([
        { name: ' Size ', values: [' S', 'M', '', 'M '] },
        { name: 'Colour', values: ['  '] },
        { name: '', values: ['x'] },
      ]),
    ).toEqual([{ name: 'Size', values: ['S', 'M'] }]);
  });
});

describe('planVariants', () => {
  const options = [
    { name: 'Size', values: ['S', 'M'] },
    { name: 'Colour', values: ['Black'] },
  ];

  it('keeps variants still covered, matching values whatever the case', () => {
    const s = item('s', { variant: ['s', 'black'] });
    const plan = planVariants(options, [s]);
    expect(plan.keep).toEqual([{ item: s, values: ['S', 'Black'] }]);
    expect(plan.add).toEqual([['M', 'Black']]);
    expect(plan.drop).toEqual([]);
  });

  it('drops variants no combination covers any more', () => {
    const xl = item('xl', { variant: ['XL', 'Black'] });
    expect(planVariants(options, [xl]).drop).toEqual([xl]);
  });
});

describe('codes', () => {
  const catalog = [
    item('tee', { sku: 'TEE-M', barcode: '6001234567890' }),
    item('cap', { sku: '6001234567890' }),
    item('mug', { sku: 'mug-1' }),
  ];

  it('finds by barcode before SKU', () => {
    expect(findByCode(catalog, ' 6001234567890 ')?.id).toBe('tee');
  });

  it('matches SKUs whatever their case', () => {
    expect(findByCode(catalog, 'MUG-1')?.id).toBe('mug');
    expect(findByCode(catalog, 'nope')).toBeUndefined();
    expect(findByCode(catalog, '  ')).toBeUndefined();
  });

  it('names the item already holding a code, leaving out those being edited', () => {
    expect(codeOwner(catalog, 'tee-m')?.id).toBe('tee');
    expect(codeOwner(catalog, 'tee-m', ['tee'])).toBeUndefined();
  });

  it('spots codes typed twice among a product’s variants', () => {
    const repeats = repeatedCodes(['A1', '', 'a1 ', 'B2', '']);
    expect(isRepeated(repeats, 'A1')).toBe(true);
    expect(isRepeated(repeats, 'B2')).toBe(false);
    expect(isRepeated(repeats, '')).toBe(false);
  });
});

describe('naming', () => {
  it('names a variant after its product and values', () => {
    expect(variantName('Classic Tee', ['M', 'Black'])).toBe('Classic Tee · M / Black');
  });

  it('suggests a SKU from the name and values', () => {
    expect(suggestSku('Classic Tee', ['M', 'Black'])).toBe('CLAS-M-BLAC');
  });

  it('gives the price range of the variants', () => {
    expect(priceRange([item('a', { price: 900 }), item('b', { price: 1200 })])).toEqual({ low: 900, high: 1200 });
    expect(priceRange([])).toBeNull();
  });
});
