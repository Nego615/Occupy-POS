import { useState } from 'react';
import { useNavigate } from 'react-router';
import './AdminItems.css';
import { Button } from '../components/Button';
import { Money, Mono } from '../components/Mono';
import { Pill, PillRow } from '../components/Pill';
import { StatusChip } from '../components/StatusChip';
import { CATEGORIES, stockState, type CatalogItem, type CategoryId } from '../data/catalog';
import { usePos } from '../lib/store';

/** A category, or `restock`: tracked items that are low or sold out. */
type Filter = CategoryId | 'all' | 'restock';

function needsRestock(item: CatalogItem, lowDefault: number): boolean {
  const state = stockState(item, lowDefault);
  return state === 'low' || state === 'out';
}

/**
 * The catalog list — the way into the item editor. Renders inside
 * AdminLayout's sidebar like every other admin page.
 */
export function AdminItems() {
  const navigate = useNavigate();
  const { catalog, settings } = usePos();
  const restock = (item: CatalogItem) => needsRestock(item, settings.lowStockDefault);
  const [filter, setFilter] = useState<Filter>('all');

  const restockCount = catalog.filter(restock).length;
  const items =
    filter === 'all'
      ? catalog
      : filter === 'restock'
        ? catalog.filter(restock)
        : catalog.filter((i) => i.category === filter);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Items &amp; catalog</h1>
          <div className="page-sub">{settings.locationName} · everything the register can ring up</div>
        </div>
        <div className="head-actions">
          <Button onClick={() => navigate('/items/new')}>New item</Button>
        </div>
      </div>

      <PillRow label="Filter items" className="admin-items__filters">
        <Pill active={filter === 'all'} onClick={() => setFilter('all')}>
          All
        </Pill>
        {CATEGORIES.map((c) => (
          <Pill key={c.id} active={filter === c.id} onClick={() => setFilter(c.id)}>
            {c.label}
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
            {filter === 'restock'
              ? 'Everything tracked is well stocked.'
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
                {CATEGORIES.find((c) => c.id === item.category)!.label}
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
