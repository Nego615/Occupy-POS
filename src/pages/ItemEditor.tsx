import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import './ItemEditor.css';
import { Button } from '../components/Button';
import { ItemTile } from '../components/ItemTile';
import { Mono, formatMoney } from '../components/Mono';
import { Pill, PillRow } from '../components/Pill';
import { StatusChip } from '../components/StatusChip';
import { Switch } from '../components/Switch';
import {
  categoryLabel,
  stockState,
  type CategoryId,
  type StockState,
} from '../data/catalog';
import { activeCurrency, isAmountText } from '../lib/currency';
import { usePos } from '../lib/store';

/** Tile colors offered in the editor, matching the mockup's swatch row. */
const SWATCHES = ['#ff4b2e', '#8a5cf6', '#1fae5c', '#0e7bd6', '#e0a300', '#121212'];

type ItemDraft = {
  name: string;
  /** Kept as a string so the field can hold partial input while typing. */
  price: string;
  category: CategoryId;
  color: string;
  description: string;
  available: boolean;
  openPrice: boolean;
  /** Strings for the same reason as price. */
  stock: string;
  lowStockAt: string;
  /** Buying-in details; blank means not set. */
  cost: string;
  supplierId: string;
  parLevel: string;
};

const BLANK: ItemDraft = {
  name: '',
  price: '',
  // Filled with the first category when the editor opens.
  category: '',
  color: SWATCHES[0],
  description: '',
  available: true,
  openPrice: false,
  // Blank, not 0 — a new item's count has to be entered, never assumed.
  stock: '',
  // Filled from the Settings low-stock default when the editor opens.
  lowStockAt: '',
  cost: '',
  supplierId: '',
  parLevel: '',
};

/** Stock counts: whole units, no sign, up to 9999. */
const WHOLE_NUMBER = /^\d{1,4}$/;

const STOCK_CHIP: Record<StockState, { status: 'open' | 'occupied'; label: string }> = {
  in: { status: 'open', label: 'In stock' },
  low: { status: 'occupied', label: 'Low' },
  out: { status: 'occupied', label: 'Sold out' },
};

export function ItemEditor() {
  const { itemId } = useParams();
  const navigate = useNavigate();

  const { catalog, categories, updateItem, createItem, deleteItem, settings, suppliers, can } = usePos();
  const creating = itemId === 'new';
  const item = creating ? undefined : catalog.find((i) => i.id === itemId);

  const saved: ItemDraft = useMemo(
    () =>
      item
        ? {
            name: item.name,
            // In the currency's own precision — "6500" in shillings, "6.50" in dollars.
            price: item.price.toFixed(activeCurrency().decimals),
            category: item.category,
            color: item.color,
            description: item.description ?? '',
            available: item.available,
            openPrice: item.openPrice ?? false,
            stock: String(item.stock),
            lowStockAt: String(item.lowStockAt ?? settings.lowStockDefault),
            cost: item.cost !== undefined ? String(item.cost) : '',
            supplierId: item.supplierId ?? '',
            parLevel: item.parLevel !== undefined ? String(item.parLevel) : '',
          }
        : { ...BLANK, category: categories[0]?.id ?? '', lowStockAt: String(settings.lowStockDefault) },
    // Categories are read once, for a new item's starting pick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [item, settings.lowStockDefault],
  );

  const [draft, setDraft] = useState<ItemDraft>(saved);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const set = <K extends keyof ItemDraft>(key: K, value: ItemDraft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const priceValue = Number.parseFloat(draft.price);
  const priceValid = isAmountText(draft.price) && priceValue > 0;
  const nameValid = draft.name.trim().length > 0;
  const categoryValid = categories.some((c) => c.id === draft.category);
  // An existing item's stock is changed on the Stock page, through the ledger — only new items set it here.
  const stockValid = !creating || WHOLE_NUMBER.test(draft.stock);
  const costValid = draft.cost === '' || isAmountText(draft.cost);
  const parValid = draft.parLevel === '' || WHOLE_NUMBER.test(draft.parLevel);
  const lowValid = WHOLE_NUMBER.test(draft.lowStockAt);
  const stockValue = creating ? Number.parseInt(draft.stock, 10) || 0 : item?.stock ?? 0;
  const lowValue = Number.parseInt(draft.lowStockAt, 10) || 0;
  const draftStock = stockValid && lowValid ? stockState({ stock: stockValue, lowStockAt: lowValue }, settings.lowStockDefault) : null;
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const canSave =
    (creating || dirty) && priceValid && nameValid && categoryValid && stockValid && lowValid && costValid && parValid;
  const draftCategory = categoryLabel(categories, draft.category);

  // A stale link to a deleted item lands here rather than on someone else's item.
  // Every item belongs to a category, so a new shop makes one first.
  if (creating && categories.length === 0) {
    return (
      <div className="editor">
        <header className="editor__bar">
          <div className="editor__bar-left">
            <button
              type="button"
              className="editor__back"
              onClick={() => navigate('/admin/items')}
              aria-label="Back to items"
            >
              <span aria-hidden="true">&larr;</span>
            </button>
            <div className="editor__title">New item</div>
          </div>
        </header>
        <div className="editor__missing">
          <p>Items are sorted into categories, and there aren’t any yet. Create one first.</p>
          <Button onClick={() => navigate('/admin/categories')}>Create a category</Button>
        </div>
      </div>
    );
  }

  if (!creating && !item) {
    return (
      <div className="editor">
        <header className="editor__bar">
          <div className="editor__bar-left">
            <button
              type="button"
              className="editor__back"
              onClick={() => navigate('/admin/items')}
              aria-label="Back to items"
            >
              <span aria-hidden="true">&larr;</span>
            </button>
            <div className="editor__title">Item not found</div>
          </div>
        </header>
        <div className="editor__missing">
          <p>This item isn’t in the catalog any more — it may have been deleted.</p>
          <Button onClick={() => navigate('/admin/items')}>Back to items</Button>
        </div>
      </div>
    );
  }

  function save() {
    const fields = {
      name: draft.name.trim(),
      price: priceValue,
      category: draft.category,
      color: draft.color,
      description: draft.description.trim() || undefined,
      available: draft.available,
      openPrice: draft.openPrice || undefined,
      cost: draft.cost === '' ? undefined : Number(draft.cost),
      supplierId: draft.supplierId || undefined,
      parLevel: draft.parLevel === '' ? undefined : Number(draft.parLevel),
      // Left at the Settings default, it stays unset so it keeps following the default.
      lowStockAt:
        item?.lowStockAt === undefined && lowValue === settings.lowStockDefault
          ? undefined
          : lowValue,
    };
    if (item) updateItem(item.id, fields);
    else createItem({ ...fields, stock: stockValue });
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
          <button
            type="button"
            className="editor__back"
            onClick={() => navigate(-1)}
            aria-label="Back"
          >
            <span aria-hidden="true">&larr;</span>
          </button>
          <div>
            <div className="editor__title">{creating ? 'New item' : 'Edit item'}</div>
            <div className="editor__sub">{draftCategory} catalog</div>
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
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setDraft(saved)}
            disabled={!dirty}
          >
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
            <input
              id="item-name"
              type="text"
              value={draft.name}
              onChange={(e) => set('name', e.target.value)}
            />
            {!nameValid && (
              <p className="field__error">Give the item a name before saving.</p>
            )}
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
                aria-describedby={priceValid ? undefined : 'price-error'}
              />
            </div>
            {!priceValid && (
              <p className="field__error" id="price-error">
                Enter a price above {formatMoney(0)}
                {activeCurrency().decimals === 0 ? ' — whole amounts only' : ''}.
              </p>
            )}
          </div>

          {/* Stock is the number staff come back to most, so it gets its own
              panel and the largest figure on the form. */}
          <section className="stock-panel" aria-labelledby="stock-heading">
            <div className="stock-panel__head">
              <label className="stock-panel__label" id="stock-heading" htmlFor="item-stock">
                On hand
              </label>
              {draftStock && (
                <StatusChip status={STOCK_CHIP[draftStock].status} size="sm">
                  {STOCK_CHIP[draftStock].label}
                </StatusChip>
              )}
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
                  aria-describedby={stockValid ? 'stock-help' : 'stock-error'}
                />
              ) : (
                <output id="item-stock" className="mono stock-panel__input stock-panel__readout">
                  {item?.stock}
                </output>
              )}
              <span className="stock-panel__unit">units</span>
            </div>

            {!creating ? (
              <p className="stock-panel__help" id="stock-help">
                Sales, refunds, and deliveries change this. To correct it or log waste,{' '}
                {can('inventory') ? (
                  <Link to={`/admin/stock?item=${item?.id}`}>adjust it on the Stock page</Link>
                ) : (
                  'ask a manager to adjust it'
                )}{' '}
                — every change is logged.
              </p>
            ) : stockValid ? (
              <p className="stock-panel__help" id="stock-help">
                How many you have right now. After this, stock only changes through sales,
                deliveries, and logged adjustments.
              </p>
            ) : draft.stock === '' ? (
              <p className="stock-panel__help" id="stock-error">
                Enter how many you have right now.
              </p>
            ) : (
              <p className="field__error" id="stock-error">
                Enter a whole number of units, like 24.
              </p>
            )}

            <div className="stock-panel__low">
              <label htmlFor="item-low">Warn when</label>
              <input
                id="item-low"
                className="mono"
                type="text"
                inputMode="numeric"
                value={draft.lowStockAt}
                onChange={(e) => set('lowStockAt', e.target.value.trim())}
                aria-describedby={lowValid ? undefined : 'low-error'}
              />
              <span>or fewer remain</span>
            </div>
            {!lowValid && (
              <p className="field__error" id="low-error">
                Enter a whole number, like 5.
              </p>
            )}

            <div className="stock-panel__buying">
              <label className="stock-panel__buy-field">
                Unit cost
                <span className="price-input">
                  <span className="price-input__symbol mono" aria-hidden="true">
                    {activeCurrency().symbol}
                  </span>
                  <input
                    className="mono"
                    type="text"
                    inputMode="decimal"
                    value={draft.cost}
                    placeholder="Not set"
                    onChange={(e) => set('cost', e.target.value.trim())}
                    aria-invalid={!costValid}
                  />
                </span>
              </label>
              <label className="stock-panel__buy-field">
                Reorder up to
                <input
                  className="mono stock-panel__par"
                  type="text"
                  inputMode="numeric"
                  value={draft.parLevel}
                  placeholder="—"
                  onChange={(e) => set('parLevel', e.target.value.trim())}
                  aria-invalid={!parValid}
                />
              </label>
              <label className="stock-panel__buy-field stock-panel__buy-field--wide">
                Supplier
                <select
                  className="stock-panel__select"
                  value={draft.supplierId}
                  onChange={(e) => set('supplierId', e.target.value)}
                >
                  <option value="">None</option>
                  {suppliers
                    .filter((s) => s.active || s.id === draft.supplierId)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            {(!costValid || !parValid) && (
              <p className="field__error">
                {!costValid ? 'Enter the unit cost as a plain amount.' : 'Reorder level is a whole number of units.'}
              </p>
            )}
            <p className="stock-panel__help">
              Cost updates itself as deliveries are received. Low-stock reorders top up to the
              reorder level.
            </p>
          </section>

          <div className="field">
            <span className="field__label">Category</span>
            <PillRow label="Category">
              {categories.map((c) => (
                <Pill
                  key={c.id}
                  active={c.id === draft.category}
                  onClick={() => set('category', c.id)}
                >
                  {c.label}
                </Pill>
              ))}
            </PillRow>
          </div>

          <div className="field">
            <span className="field__label">Tile color</span>
            <div className="swatch-row" role="group" aria-label="Tile color">
              {SWATCHES.map((color) => (
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

          <div className="field">
            <label className="field__label" htmlFor="item-desc">
              Description <span className="field__optional">(optional)</span>
            </label>
            <textarea
              id="item-desc"
              value={draft.description}
              onChange={(e) => set('description', e.target.value)}
            />
          </div>

          <div className="toggle-row">
            <div>
              <div className="toggle-row__label">Available for sale</div>
              <div className="toggle-row__sub" id="available-sub">
                Shows on the register grid immediately
              </div>
            </div>
            <Switch
              checked={draft.available}
              onChange={(v) => set('available', v)}
              label="Available for sale"
              describedBy="available-sub"
            />
          </div>

          <div className="toggle-row">
            <div>
              <div className="toggle-row__label">Price set at the counter</div>
              <div className="toggle-row__sub" id="open-price-sub">
                Asks for the price each time it’s rung up — for market-price fish, by-weight produce, or
                deposits. The price above is just a guide.
              </div>
            </div>
            <Switch
              checked={draft.openPrice}
              onChange={(v) => set('openPrice', v)}
              label="Price set at the counter"
              describedBy="open-price-sub"
            />
          </div>
        </form>

        <aside className="editor__preview" aria-label="Live preview">
          <div className="editor__preview-label">Live preview</div>
          {/* The same tile component the register grid renders. */}
          <ItemTile
            name={draft.name || 'Untitled item'}
            price={priceValid ? priceValue : 0}
            color={draft.color}
            note={
              draftStock === 'out'
                ? 'Sold out'
                : draftStock === 'low'
                  ? `${stockValue} left`
                  : undefined
            }
            interactive={false}
            tone="paper"
            className="editor__preview-tile"
          />
          <p className="editor__preview-note">
            This is exactly how the item will appear on the register grid — changes
            update here as you type.
          </p>
          {stockValid && (
            <p className="editor__preview-note">
              <Mono>{stockValue}</Mono> {stockValue === 1 ? 'unit' : 'units'} on hand.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
