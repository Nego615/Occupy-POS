import { useState } from 'react';
import { useNavigate } from 'react-router';
import './AdminItems.css';
import { Button } from '../components/Button';
import { SortSelect } from '../components/ListControls';
import { Money, Mono } from '../components/Mono';
import { Pill, PillRow } from '../components/Pill';
import { SearchField } from '../components/SearchField';
import { StatusChip } from '../components/StatusChip';
import { categoryPath, categoryTree, inCategory, stockState, type CatalogItem, type CategoryId } from '../data/catalog';
import { ITEM_SORTS, withAddedOrder } from '../lib/itemSorts';
import { matchesSearch, sortRows } from '../lib/listView';
import { usePos } from '../lib/store';

/** A category, or `restock`: tracked items that are low or sold out. */
type Filter = CategoryId | 'all' | 'restock';

function needsRestock(item: CatalogItem, lowDefault: number): boolean {
  const state = stockState(item, lowDefault);
  return state === 'low' || state === 'out';
}

/**
 * The catalog list — the way into the item editor. Renders inside
 * AdminLayout's sidebar like every other admin page. The kitchen sees only
 * the categories it's let edit.
 */
export function AdminItems() {
  const navigate = useNavigate();
  const { catalog, categories: allCategories, settings, can, canEditCategory } = usePos();
  const restock = (item: CatalogItem) => needsRestock(item, settings.lowStockDefault);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('newest');

  const wholeMenu = can('catalog');
  const categories = categoryTree(allCategories)
    .map(({ category }) => category)
    .filter((c) => canEditCategory(c.id));
  // Recently added first unless another order is picked, so what was just added is at the top.
  const sorted = sortRows(withAddedOrder(catalog), ITEM_SORTS, sort).map((r) => r.item);
  const mine = wholeMenu ? sorted : sorted.filter((i) => canEditCategory(i.category));
  const restockCount = mine.filter(restock).length;
  const items = (
    filter === 'all'
      ? mine
      : filter === 'restock'
        ? mine.filter(restock)
        : mine.filter((i) => inCategory(allCategories, i.category, filter))
  ).filter((i) => matchesSearch(query, i.name, categoryPath(allCategories, i.category), i.description));

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Items &amp; catalog</h1>
          <div className="page-sub">
            {settings.locationName} ·{' '}
            {wholeMenu
              ? 'everything the register can ring up'
              : `the kitchen’s items${categories.length ? ` — ${categories.map((c) => categoryPath(allCategories, c.id)).join(', ')}` : ''}`}
          </div>
        </div>
        <div className="head-actions">
          {wholeMenu && (
            <Button variant="secondary" onClick={() => navigate('/admin/categories')}>
              Manage categories
            </Button>
          )}
          <Button onClick={() => navigate('/items/new')} disabled={!wholeMenu && categories.length === 0}>
            New item
          </Button>
        </div>
      </div>

      <div className="list-tools">
        <SearchField value={query} onChange={setQuery} placeholder="Search items" label="Search items" />
        <SortSelect value={sort} onChange={setSort} options={ITEM_SORTS} />
      </div>

      <PillRow label="Filter items" className="admin-items__filters">
        <Pill active={filter === 'all'} onClick={() => setFilter('all')}>
          All
        </Pill>
        {categories.map((c) => (
          <Pill key={c.id} active={filter === c.id} onClick={() => setFilter(c.id)}>
            {categoryPath(allCategories, c.id)}
          </Pill>
        ))}
        <Pill active={filter === 'restock'} onClick={() => setFilter('restock')}>
          Needs restock <Mono>{restockCount}</Mono>
        </Pill>
      </PillRow>

      <div className="panel">
        <p className="admin-items__count">
          <Mono>{items.length}</Mono> {items.length === 1 ? 'item' : 'items'}
        </p>

        {items.length === 0 && (
          <p className="admin-items__empty">
            {query.trim()
              ? 'No items match that search.'
              : filter === 'restock'
                ? 'Everything tracked is well stocked.'
                : categories.length === 0 && !wholeMenu
                  ? 'No categories are open to the kitchen yet — a manager can pick them in Settings, under Kitchen menu.'
                  : 'No items here yet — add one with New item.'}
          </p>
        )}

        {items.map((item) => (
          <div className="item-row" key={item.id}>
            <span
              className="item-row__dot"
              style={{ background: item.color }}
              aria-hidden="true"
            />
            <span className="item-row__main">
              <span className="item-row__name">{item.name}</span>
              <span className="item-row__meta">
                {categoryPath(allCategories, item.category)}
                {item.description ? ` · ${item.description}` : ''}
              </span>
            </span>
            <StockCell item={item} />
            {item.available ? (
              <StatusChip status="open" size="sm">
                On the register
              </StatusChip>
            ) : (
              <StatusChip status="occupied" size="sm">
                Hidden
              </StatusChip>
            )}
            <Money value={item.price} className="item-row__price" />
            <Button
              variant="secondary"
              size="sm"
              className="item-row__edit"
              onClick={() => navigate(`/items/${item.id}`)}
            >
              Edit
            </Button>
          </div>
        ))}
      </div>
    </>
  );
}

function StockCell({ item }: { item: CatalogItem }) {
  const { settings } = usePos();
  const state = stockState(item, settings.lowStockDefault);
  if (item.untracked) return <span className="item-row__stock">Stock not tracked</span>;
  return (
    <span className="item-row__stock">
      {state === 'in' && (
        <>
          <Mono>{item.stock}</Mono> in stock
        </>
      )}
      {state === 'low' && (
        <StatusChip status="occupied" size="sm">
          Low · <Mono>{item.stock}</Mono> left
        </StatusChip>
      )}
      {state === 'out' && (
        <StatusChip status="occupied" size="sm">
          Sold out
        </StatusChip>
      )}
    </span>
  );
}
