import { useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import '../../../pages/ItemEditor.css';
import './RetailItemEditor.css';
import { Button } from '../../../components/Button';
import { ItemTile } from '../../../components/ItemTile';
import { Mono, formatMoney } from '../../../components/Mono';
import { Pill, PillRow } from '../../../components/Pill';
import { Switch } from '../../../components/Switch';
import { categoryPath, categoryTree, titleCase, type CategoryId } from '../../../data/catalog';
import { codeOwner } from '../../../data/products';
import { activeCurrency, isAmountText } from '../../../lib/currency';
import { usePos } from '../../../lib/store';
import { RETAIL_SWATCHES } from '../brand';

/** The form as typed — numbers kept as strings so fields can hold partial input. */
type Draft = {
  name: string;
  price: string;
  sku: string;
  barcode: string;
  category: CategoryId;
  color: string;
  available: boolean;
  openPrice: boolean;
  stock: string;
  lowStockAt: string;
  cost: string;
  parLevel: string;
  supplierId: string;
};

const WHOLE_NUMBER = /^\d+$/;

/**
 * Retail's editor for one item sold on its own — no sizes or colours (those
 * are products), no portions or recipes. `/items/new` creates one.
 */
export function RetailItemEditor() {
  const { itemId } = useParams();
  const navigate = useNavigate();
  const { catalog, categories, suppliers, settings, can, createItem, updateItem, deleteItem } = usePos();
  const creating = itemId === 'new';
  const item = creating ? undefined : catalog.find((i) => i.id === itemId);
  const shelves = categoryTree(categories).map(({ category }) => category);

  const saved: Draft = useMemo(
    () => ({
      name: item?.name ?? '',
      price: item ? item.price.toFixed(activeCurrency().decimals) : '',
      sku: item?.sku ?? '',
      barcode: item?.barcode ?? '',
      category: item?.category ?? shelves[0]?.id ?? '',
      color: item?.color ?? RETAIL_SWATCHES[0],
      available: item?.available ?? true,
      openPrice: item?.openPrice ?? false,
      stock: item ? String(item.stock) : '',
      lowStockAt: String(item?.lowStockAt ?? settings.lowStockDefault),
      cost: item?.cost !== undefined ? String(item.cost) : '',
      parLevel: item?.parLevel !== undefined ? String(item.parLevel) : '',
      supplierId: item?.supplierId ?? '',
    }),
    // Categories are read once, for a new item's starting pick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [item, settings.lowStockDefault],
  );
  const [draft, setDraft] = useState<Draft>(saved);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const priceValue = Number.parseFloat(draft.price);
  const priceValid = isAmountText(draft.price) && priceValue > 0;
  const nameValid = draft.name.trim().length > 0;
  const categoryValid = categories.some((c) => c.id === draft.category);
  // An existing item's stock changes through the ledger, on the Stock page — only new items set it here.
  const stockValid = !creating || draft.stock === '' || WHOLE_NUMBER.test(draft.stock);
  const lowValid = WHOLE_NUMBER.test(draft.lowStockAt);
  const costValid = draft.cost === '' || isAmountText(draft.cost);
  const parValid = draft.parLevel === '' || WHOLE_NUMBER.test(draft.parLevel);
  // A code rings up one thing only, so no other item may hold it.
  const skuTaken = codeOwner(catalog, draft.sku, item ? [item.id] : []);
  const barcodeTaken = codeOwner(catalog, draft.barcode, item ? [item.id] : []);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const canSave =
    (creating || dirty) &&
    nameValid &&
    priceValid &&
    categoryValid &&
    stockValid &&
    lowValid &&
    costValid &&
    parValid &&
    !skuTaken &&
    !barcodeTaken;

  // A size or colour of a product is edited with the product, alongside the others.
  if (item?.productId) return <Navigate to={`/products/${item.productId}`} replace />;

  if (!creating && !item) {
    return (
      <Missing
        title="Item not found"
        text="This item isn’t in the catalog any more — it may have been deleted."
        action="Back to products"
        onAction={() => navigate('/admin/items')}
      />
    );
  }
  if (creating && categories.length === 0) {
    return (
      <Missing
        title="New item"
        text="Items are sorted into categories, and there aren’t any yet. Create one first."
        action="Create a category"
        onAction={() => navigate('/admin/categories')}
      />
    );
  }

  function save() {
    const lowValue = Number.parseInt(draft.lowStockAt, 10);
    const fields = {
      name: draft.name.trim(),
      price: priceValue,
      category: draft.category,
      color: draft.color,
      available: draft.available,
      openPrice: draft.openPrice || undefined,
      sku: draft.sku.trim() || undefined,
      barcode: draft.barcode.trim() || undefined,
      cost: draft.cost === '' ? undefined : Number(draft.cost),
      parLevel: draft.parLevel === '' ? undefined : Number(draft.parLevel),
      supplierId: draft.supplierId || undefined,
      // Left at the Settings default, it stays unset so it keeps following the default.
      lowStockAt: item?.lowStockAt === undefined && lowValue === settings.lowStockDefault ? undefined : lowValue,
    };
    if (item) updateItem(item.id, fields);
    else createItem({ ...fields, stock: Number.parseInt(draft.stock, 10) || 0 });
    navigate('/admin/items');
  }

  function remove() {
    if (!item) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    deleteItem(item.id);
    navigate('/admin/items');
  }

  return (
    <div className="editor">
      <header className="editor__bar">
        <div className="editor__bar-left">
          <button type="button" className="editor__back" onClick={() => navigate(-1)} aria-label="Back">
            <span aria-hidden="true">&larr;</span>
          </button>
          <div>
            <div className="editor__title">{creating ? 'New item' : 'Edit item'}</div>
            <div className="editor__sub">{categoryPath(categories, draft.category)} catalog</div>
          </div>
        </div>
        <div className="editor__actions">
          {item && (
            <Button
              variant="secondary"
              size="sm"
              className={confirmingDelete ? 'editor__delete--confirm' : undefined}
              onClick={remove}
              onBlur={() => setConfirmingDelete(false)}
            >
              {confirmingDelete ? 'Confirm delete' : 'Delete'}
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => setDraft(saved)} disabled={!dirty}>
            Discard
          </Button>
          <Button size="sm" onClick={save} disabled={!canSave}>
            {creating ? 'Create item' : 'Save item'}
          </Button>
        </div>
      </header>

      <div className="editor__body">
        <form className="editor__form" onSubmit={(e) => e.preventDefault()}>
          <div className="field">
            <label className="field__label" htmlFor="item-name">
              Item name
            </label>
            <input id="item-name" type="text" value={draft.name} onChange={(e) => set('name', e.target.value)} />
            {!nameValid && <p className="field__error">Give the item a name before saving.</p>}
          </div>

          <div className="field">
            <label className="field__label" htmlFor="item-price">
              Price
            </label>
            <div className="price-input">
              <span className="price-input__symbol mono" aria-hidden="true">
                {activeCurrency().symbol}
              </span>
              <input
                id="item-price"
                className="mono"
                type="text"
                inputMode="decimal"
                value={draft.price}
                onChange={(e) => set('price', e.target.value)}
              />
            </div>
            {!priceValid && <p className="field__error">Enter a price above {formatMoney(0)}.</p>}
          </div>

          <div className="field">
            <span className="field__label">
              Codes <span className="field__optional">(optional)</span>
            </span>
            <div className="retail-codes">
              <label className="retail-codes__field">
                SKU
                <input
                  className="mono"
                  type="text"
                  value={draft.sku}
                  placeholder="Your stock code"
                  onChange={(e) => set('sku', e.target.value)}
                  aria-invalid={!!skuTaken}
                />
              </label>
              <label className="retail-codes__field">
                Barcode
                <input
                  className="mono"
                  type="text"
                  inputMode="numeric"
                  value={draft.barcode}
                  placeholder="Scan it here"
                  onChange={(e) => set('barcode', e.target.value)}
                  // A scanner's Enter would otherwise submit the form.
                  onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
                  aria-invalid={!!barcodeTaken}
                />
              </label>
            </div>
            {(skuTaken || barcodeTaken) && (
              <p className="field__error">
                {skuTaken ? 'That SKU' : 'That barcode'} is already on {(skuTaken ?? barcodeTaken)!.name}. A code rings up
                one item only.
              </p>
            )}
            <p className="portions__help">Scan or type either one at the till to ring this item up.</p>
          </div>

          <section className="stock-panel" aria-labelledby="stock-heading">
            <div className="stock-panel__head">
              <label className="stock-panel__label" id="stock-heading" htmlFor="item-stock">
                On hand
              </label>
            </div>
            <div className="stock-panel__count">
              {creating ? (
                <input
                  id="item-stock"
                  className="mono stock-panel__input"
                  type="text"
                  inputMode="numeric"
                  value={draft.stock}
                  placeholder="0"
                  onChange={(e) => set('stock', e.target.value.trim())}
                />
              ) : (
                <output id="item-stock" className="mono stock-panel__input stock-panel__readout">
                  {item?.stock}
                </output>
              )}
              <span className="stock-panel__unit">units</span>
            </div>
            <p className="stock-panel__help">
              {creating ? (
                'How many you have right now. After this, stock changes through sales, deliveries and logged adjustments.'
              ) : (
                <>
                  Sales, refunds and deliveries change this. To correct it,{' '}
                  {can('inventory') ? (
                    <Link to={`/admin/stock?item=${item?.id}`}>adjust it on the Stock page</Link>
                  ) : (
                    'ask a manager to adjust it'
                  )}
                  .
                </>
              )}
            </p>
            {!stockValid && <p className="field__error">Stock is a whole number of units.</p>}

            <div className="stock-panel__buying">
              <label className="stock-panel__buy-field">
                Warn when
                <input
                  className="mono stock-panel__par"
                  type="text"
                  inputMode="numeric"
                  value={draft.lowStockAt}
                  onChange={(e) => set('lowStockAt', e.target.value.trim())}
                  aria-invalid={!lowValid}
                />
              </label>
              <label className="stock-panel__buy-field">
                Unit cost
                <input
                  className="mono stock-panel__par"
                  type="text"
                  inputMode="decimal"
                  value={draft.cost}
                  placeholder="Not set"
                  onChange={(e) => set('cost', e.target.value.trim())}
                  aria-invalid={!costValid}
                />
              </label>
              <label className="stock-panel__buy-field">
                Reorder up to
                <input
                  className="mono stock-panel__par"
                  type="text"
                  inputMode="numeric"
                  value={draft.parLevel}
                  placeholder="Not set"
                  onChange={(e) => set('parLevel', e.target.value.trim())}
                  aria-invalid={!parValid}
                />
              </label>
              <label className="stock-panel__buy-field">
                Supplier
                <select
                  className="stock-panel__par"
                  value={draft.supplierId}
                  onChange={(e) => set('supplierId', e.target.value)}
                >
                  <option value="">None</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {(!lowValid || !costValid || !parValid) && (
              <p className="field__error">Warning level and reorder level are whole numbers; cost is a plain amount.</p>
            )}
          </section>

          <div className="field">
            <span className="field__label">Category</span>
            <PillRow label="Category">
              {shelves.map((c) => (
                <Pill key={c.id} active={c.id === draft.category} onClick={() => set('category', c.id)}>
                  {categoryPath(categories, c.id)}
                </Pill>
              ))}
            </PillRow>
          </div>

          <div className="field">
            <span className="field__label">Tile color</span>
            <div className="swatch-row" role="group" aria-label="Tile color">
              {RETAIL_SWATCHES.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={color === draft.color ? 'swatch swatch--active' : 'swatch'}
                  style={{ background: color }}
                  onClick={() => set('color', color)}
                  aria-pressed={color === draft.color}
                  aria-label={`Tile color ${color}`}
                />
              ))}
            </div>
          </div>

          <div className="toggle-row">
            <div>
              <div className="toggle-row__label">For sale</div>
              <div className="toggle-row__sub" id="available-sub">
                Shows on the till straight away
              </div>
            </div>
            <Switch
              checked={draft.available}
              onChange={(v) => set('available', v)}
              label="For sale"
              describedBy="available-sub"
            />
          </div>

          <div className="toggle-row">
            <div>
              <div className="toggle-row__label">Price set at the till</div>
              <div className="toggle-row__sub" id="open-price-sub">
                Asks for the price each time it’s rung up — for goods sold by weight, say.
                {!settings.openPriceEnabled && ' Turned off for the whole shop in Settings.'}
              </div>
            </div>
            <Switch
              checked={draft.openPrice && settings.openPriceEnabled}
              onChange={(v) => set('openPrice', v)}
              label="Price set at the till"
              describedBy="open-price-sub"
              disabled={!settings.openPriceEnabled}
            />
          </div>
        </form>

        <aside className="editor__preview" aria-label="Live preview">
          <div className="editor__preview-label">Live preview</div>
          <ItemTile
            name={titleCase(draft.name.trim()) || 'Untitled item'}
            price={priceValid ? priceValue : 0}
            color={draft.color}
            interactive={false}
            tone="paper"
            className="editor__preview-tile"
          />
          <p className="editor__preview-note">How the item will appear on the till.</p>
          {!creating && item && (
            <p className="editor__preview-note">
              <Mono>{item.stock}</Mono> {item.stock === 1 ? 'unit' : 'units'} on hand.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}

function Missing({
  title,
  text,
  action,
  onAction,
}: {
  title: string;
  text: string;
  action: string;
  onAction: () => void;
}) {
  const navigate = useNavigate();
  return (
    <div className="editor">
      <header className="editor__bar">
        <div className="editor__bar-left">
          <button type="button" className="editor__back" onClick={() => navigate('/admin/items')} aria-label="Back">
            <span aria-hidden="true">&larr;</span>
          </button>
          <div className="editor__title">{title}</div>
        </div>
      </header>
      <div className="editor__missing">
        <p>{text}</p>
        <Button onClick={onAction}>{action}</Button>
      </div>
    </div>
  );
}
