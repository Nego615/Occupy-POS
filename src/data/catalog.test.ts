import { describe, expect, it } from 'vitest';
import {
  addOnOptions,
  categoryLabel,
  categoryLineage,
  categoryPath,
  categoryTree,
  inAnyCategory,
  inCategory,
  titleCase,
  topCategories,
  withUsedCategories,
  type CatalogItem,
  type Category,
} from './catalog';
import { bestPromo, type Promotion } from './deals';

const item = (category: string): CatalogItem => ({
  id: category + '-item',
  name: 'Item',
  price: 1,
  color: '#000',
  category,
  available: true,
  stock: 1,
});

describe('withUsedCategories', () => {
  it('adds back categories items use but the list lacks', () => {
    // A shop saved before categories were editable has items but no list.
    const result = withUsedCategories([], [item('coffee'), item('food'), item('coffee'), item('juice-bar')]);
    expect(result).toEqual([
      { id: 'coffee', label: 'Coffee' },
      { id: 'food', label: 'Food' },
      { id: 'juice-bar', label: 'Juice-bar' },
    ]);
  });

  it('hands back the same list when nothing is missing', () => {
    const categories = [{ id: 'coffee', label: 'Hot drinks' }];
    expect(withUsedCategories(categories, [item('coffee')])).toBe(categories);
  });
});

describe('titleCase', () => {
  it('capitalises each word, including after slashes and brackets', () => {
    expect(titleCase('fried/choma chicken (kisasa)')).toBe('Fried/Choma Chicken (Kisasa)');
    expect(titleCase('kuku makange/kitunguu/lemon kienyeji')).toBe('Kuku Makange/Kitunguu/Lemon Kienyeji');
  });

  it('leaves letters already in capitals alone', () => {
    expect(titleCase('BBQ wings')).toBe('BBQ Wings');
    expect(titleCase('Coconut Fish')).toBe('Coconut Fish');
  });
});

describe('categoryLabel', () => {
  it('falls back for a category that has gone', () => {
    expect(categoryLabel([{ id: 'a', label: 'A' }], 'a')).toBe('A');
    expect(categoryLabel([], 'a')).toBe('Uncategorized');
  });
});

describe('sub-categories', () => {
  const categories: Category[] = [
    { id: 'drinks', label: 'Drinks', addOns: [{ itemId: 'ice', price: 0 }, { itemId: 'lemon', price: 200 }] },
    { id: 'food', label: 'Food' },
    { id: 'wines', label: 'Wines', parentId: 'drinks' },
    { id: 'sodas', label: 'Sodas', parentId: 'drinks', addOns: [{ itemId: 'lemon', price: 0 }] },
    { id: 'red', label: 'Red', parentId: 'wines' },
  ];

  it('climbs from a category to the top', () => {
    expect(categoryLineage(categories, 'red')).toEqual(['red', 'wines', 'drinks']);
    expect(categoryPath(categories, 'red')).toBe('Drinks › Wines › Red');
    expect(categoryPath(categories, 'gone')).toBe('Uncategorized');
  });

  it('counts an item in a sub-category as in the ones above it', () => {
    expect(inCategory(categories, 'red', 'drinks')).toBe(true);
    expect(inCategory(categories, 'drinks', 'red')).toBe(false);
    expect(inAnyCategory(categories, 'sodas', ['food', 'drinks'])).toBe(true);
    expect(inAnyCategory(categories, 'sodas', [])).toBe(false);
  });

  it('lists each category followed by those inside it', () => {
    expect(topCategories(categories).map((c) => c.id)).toEqual(['drinks', 'food']);
    expect(categoryTree(categories).map(({ category, depth }) => `${depth}:${category.id}`)).toEqual([
      '0:drinks',
      '1:wines',
      '2:red',
      '1:sodas',
      '0:food',
    ]);
  });

  it('survives a parent that has gone, or a loop', () => {
    const orphan: Category[] = [{ id: 'sodas', label: 'Sodas', parentId: 'drinks' }];
    expect(topCategories(orphan).map((c) => c.id)).toEqual(['sodas']);
    const loop: Category[] = [
      { id: 'a', label: 'A', parentId: 'b' },
      { id: 'b', label: 'B', parentId: 'a' },
    ];
    expect(categoryLineage(loop, 'a')).toEqual(['a', 'b']);
    expect(categoryTree(loop).map(({ category }) => category.id).sort()).toEqual(['a', 'b']);
  });

  it('offers the add-ons of the categories above, at the nearest price', () => {
    const side = (id: string): CatalogItem => ({ ...item('sides'), id, name: id });
    const catalog = [side('ice'), side('lemon')];
    const options = addOnOptions({ id: 'cola', category: 'sodas' }, categories, catalog);
    expect(options.map((o) => [o.item.id, o.price])).toEqual([
      ['lemon', 0],
      ['ice', 0],
    ]);
  });

  it('lets a promotion on a category cover those inside it', () => {
    const promo: Promotion = {
      id: 'p',
      name: 'Happy hour',
      active: true,
      kind: 'percent',
      value: 0.5,
      categories: ['drinks'],
      itemIds: [],
      days: [],
      start: null,
      end: null,
    };
    const wine = { id: 'merlot', category: 'red', price: 100 };
    expect(bestPromo([promo], wine, new Date(), categories)?.id).toBe('p');
    expect(bestPromo([promo], { ...wine, category: 'food' }, new Date(), categories)).toBeNull();
  });
});
