import { describe, expect, it } from 'vitest';
import { categoryLabel, withUsedCategories, type CatalogItem } from './catalog';

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

describe('categoryLabel', () => {
  it('falls back for a category that has gone', () => {
    expect(categoryLabel([{ id: 'a', label: 'A' }], 'a')).toBe('A');
    expect(categoryLabel([], 'a')).toBe('Uncategorized');
  });
});
