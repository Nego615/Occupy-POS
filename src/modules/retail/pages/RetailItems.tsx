import { useState } from 'react';
import { useNavigate } from 'react-router';
import '../../../pages/AdminItems.css';
import { Button } from '../../../components/Button';
import { Money, Mono } from '../../../components/Mono';
import { Pill, PillRow } from '../../../components/Pill';
import { StatusChip } from '../../../components/StatusChip';
import { categoryPath, categoryTree, inCategory, stockState, type CatalogItem, type CategoryId } from '../../../data/catalog';
import { priceRange, variantsOf, type Product } from '../../../data/products';
import { usePos } from '../../../lib/store';

/** A category, or `restock`: tracked items that are low or sold out. */
type Filter = CategoryId | 'all' | 'restock';

/** One row of the list: a plain item, or a product standing for all its variants. */
type Row = { kind: 'item'; item: CatalogItem } | { kind: 'product'; product: Product; variants: CatalogItem[] };

/**
 * Retail's catalog: products in sizes and colours, one row each, and plain
 * items alongside them. The way into both editors.
 */
export function RetailItems() {
  const navigate = useNavigate();
  const { catalog, products, categories, settings } = usePos();
  const [filter, setFilter] = useState<Filter>('all');
  const restock = (item: CatalogItem) => stockState(item, settings.lowStockDefault) !== 'in';

  const shown = catalog.filter((i) =>
    filter === 'all' ? true : filter === 'restock' ? restock(i) : inCategory(categories, i.category, filter),
  );
  // Each product is listed once, where its first matching variant falls.
  const seen = new Set<string>();
  const rows = shown.flatMap((item): Row[] => {
    const product = item.productId ? products.find((p) => p.id === item.productId) : undefined;
    if (!product) return [{ kind: 'item', item }];
    if (seen.has(product.id)) return [];
    seen.add(product.id);
    return [{ kind: 'product', product, variants: variantsOf(catalog, product.id) }];
  });
  const restockCount = catalog.filter(restock).length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Products</h1>
          <div className="page-sub">{settings.locationName} · everything the till can sell</div>
        </div>
        <div className="head-actions">
          <Button variant="secondary" onClick={() => navigate('/admin/categories')}>
            Manage categories
          </Button>
          <Button variant="secondary" onClick={() => navigate('/items/new')}>
            New item
          </Button>
          <Button onClick={() => navigate('/products/new')}>New product with variants</Button>
        </div>
      </div>

      <PillRow label="Filter products" className="admin-items__filters">
        <Pill active={filter === 'all'} onClick={() => setFilter('all')}>
          All
        </Pill>
        {categoryTree(categories).map(({ category: c }) => (
          <Pill key={c.id} active={filter === c.id} onClick={() => setFilter(c.id)}>
            {categoryPath(categories, c.id)}
          </Pill>
        ))}
        <Pill active={filter === 'restock'} onClick={() => setFilter('restock')}>
          Needs restock <Mono>{restockCount}</Mono>
        </Pill>
      </PillRow>

      <div className="panel">
        <p className="admin-items__count">
          <Mono>{rows.length}</Mono> {rows.length === 1 ? 'entry' : 'entries'}
        </p>

        {rows.length === 0 && (
          <p className="admin-items__empty">
            {filter === 'restock'
              ? 'Everything tracked is well stocked.'
              : categories.length === 0
                ? 'Products are sorted into categories — create one under Manage categories first.'
                : 'Nothing here yet — add a product or an item.'}
          </p>
        )}

        {rows.map((row) =>
          row.kind === 'product' ? (
            <ProductRow key={`product-${row.product.id}`} product={row.product} variants={row.variants} />
          ) : (
            <div className="item-row" key={row.item.id}>
              <span className="item-row__dot" style={{ background: row.item.color }} aria-hidden="true" />
              <span className="item-row__main">
                <span className="item-row__name">{row.item.name}</span>
                <span className="item-row__meta">
                  {categoryPath(categories, row.item.category)}
                  {row.item.sku ? ` · ${row.item.sku}` : ''}
                  {row.item.barcode ? ` · ${row.item.barcode}` : ''}
                </span>
              </span>
              <StockCell item={row.item} />
              <SaleChip on={row.item.available} />
              <Money value={row.item.price} className="item-row__price" />
              <Button
                variant="secondary"
                size="sm"
                className="item-row__edit"
                onClick={() => navigate(`/items/${row.item.id}`)}
              >
                Edit
              </Button>
            </div>
          ),
        )}
      </div>
    </>
  );
}

function ProductRow({ product, variants }: { product: Product; variants: CatalogItem[] }) {
  const navigate = useNavigate();
  const { categories, settings } = usePos();
  const range = priceRange(variants);
  const stock = variants.reduce((sum, v) => sum + (v.untracked ? 0 : v.stock), 0);
  const low = variants.filter((v) => stockState(v, settings.lowStockDefault) !== 'in').length;
  return (
    <div className="item-row">
      <span className="item-row__dot" style={{ background: product.color }} aria-hidden="true" />
      <span className="item-row__main">
        <span className="item-row__name">{product.name}</span>
        <span className="item-row__meta">
          {categoryPath(categories, product.category)} · <Mono>{variants.length}</Mono> variants (
          {product.options.map((o) => o.name).join(' × ')})
        </span>
      </span>
      <span className="item-row__stock">
        {low > 0 ? (
          <StatusChip status="occupied" size="sm">
            <Mono>{low}</Mono> low or out
          </StatusChip>
        ) : (
          <>
            <Mono>{stock}</Mono> in stock
          </>
        )}
      </span>
      <SaleChip on={variants.some((v) => v.available)} />
      <span className="item-row__price">
        {range && range.high > range.low ? (
          <>
            <Money value={range.low} />–<Money value={range.high} />
          </>
        ) : (
          <Money value={range?.low ?? 0} />
        )}
      </span>
      <Button
        variant="secondary"
        size="sm"
        className="item-row__edit"
        onClick={() => navigate(`/products/${product.id}`)}
      >
        Edit
      </Button>
    </div>
  );
}

function SaleChip({ on }: { on: boolean }) {
  return on ? (
    <StatusChip status="open" size="sm">
      On the till
    </StatusChip>
  ) : (
    <StatusChip status="occupied" size="sm">
      Hidden
    </StatusChip>
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
