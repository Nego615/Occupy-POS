import type { CatalogItem } from '../data/catalog';
import { byNumber, byText, descending, type SortOption } from './listView';

/** A catalog item and where it sits in the saved catalog — later is more recently added. */
export type ItemRow = { item: CatalogItem; added: number };

/** How the catalog lists can be ordered. Recently added first is the default. */
export const ITEM_SORTS: SortOption<ItemRow>[] = [
  { id: 'newest', label: 'Recently added first', compare: descending(byNumber((r) => r.added)) },
  { id: 'oldest', label: 'First added first', compare: byNumber((r) => r.added) },
  { id: 'name', label: 'Name A to Z', compare: byText((r) => r.item.name) },
  { id: 'name-desc', label: 'Name Z to A', compare: descending(byText((r) => r.item.name)) },
  { id: 'price-desc', label: 'Price high to low', compare: descending(byNumber((r) => r.item.price)) },
  { id: 'price-asc', label: 'Price low to high', compare: byNumber((r) => r.item.price) },
];

/** Items paired with their place in the catalog, ready for ITEM_SORTS. */
export function withAddedOrder(catalog: CatalogItem[]): ItemRow[] {
  return catalog.map((item, added) => ({ item, added }));
}
