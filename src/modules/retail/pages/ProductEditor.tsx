import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import '../../../pages/ItemEditor.css';
import './ProductEditor.css';
import { Button } from '../../../components/Button';
import { ItemTile } from '../../../components/ItemTile';
import { Mono, formatMoney } from '../../../components/Mono';
import { Pill, PillRow } from '../../../components/Pill';
import { categoryPath, categoryTree, type CatalogItem, type CategoryId } from '../../../data/catalog';
import {
  cleanOptions,
  codeOwner,
  combinations,
  isRepeated,
  planVariants,
  repeatedCodes,
  suggestSku,
  variantLabel,
  variantName,
  variantsOf,
  type ProductOption,
} from '../../../data/products';
import { activeCurrency, isAmountText } from '../../../lib/currency';
import { usePos } from '../../../lib/store';
import { RETAIL_SWATCHES as SWATCHES } from '../brand';

/** An option as typed: its name, and its values as one comma-separated line. */
type OptionDraft = { id: string; name: string; values: string };

/** A variant's row as typed. A blank price follows the product's price. */
type RowDraft = { sku: string; barcode: string; price: string; stock: string; available: boolean };

let optionSeq = 0;
const newOptionId = () => `o${Date.now().toString(36)}${++optionSeq}`;

/** Rows are kept by their values, whatever the case, so retyping "black" as "Black" keeps its row. */
const keyOf = (values: string[]) => values.map((v) => v.toLowerCase()).join('\u0000');

const WHOLE_NUMBER = /^\d+$/;

function toOptions(drafts: OptionDraft[]): ProductOption[] {
  return cleanOptions(drafts.map((o) => ({ name: o.name, values: o.values.split(',') })));
}

/** The price most of the variants sell at — the product's own, which the rest are set against. */
function commonPrice(variants: CatalogItem[]): number | null {
  const counts = new Map<number, number>();
  for (const v of variants) counts.set(v.price, (counts.get(v.price) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** A variant's row; at the product's price, its own is left blank so it follows the product's. */
function rowOf(item: CatalogItem, common: number | null): RowDraft {
  return {
    sku: item.sku ?? '',
    barcode: item.barcode ?? '',
    price: item.price === common ? '' : item.price.toFixed(activeCurrency().decimals),
    stock: String(item.stock),
    available: item.available,
  };
}

const BLANK_ROW: RowDraft = { sku: '', barcode: '', price: '', stock: '', available: true };

/**
 * Where a retail product and all its sizes and colours are set up. Each
 * combination of the options is a catalog item of its own — its variant —
 * so this page writes those items as well as the product.
 */
export function ProductEditor() {
  const { productId } = useParams();
  const navigate = useNavigate();
  const { products, catalog, categories, saveProduct, deleteProduct, createItem, updateItem, deleteItem, canEditCategory } =
    usePos();
  const creating = productId === 'new';
  const product = creating ? undefined : products.find((p) => p.id === productId);
  const existing = useMemo(() => (product ? variantsOf(catalog, product.id) : []), [catalog, product]);
  const editable = categoryTree(categories)
    .map(({ category }) => category)
    .filter((c) => canEditCategory(c.id));

  const [name, setName] = useState(product?.name ?? '');
  const [category, setCategory] = useState<CategoryId>(product?.category ?? editable[0]?.id ?? '');
  const [color, setColor] = useState(product?.color ?? SWATCHES[0]);
  const [price, setPrice] = useState(() => commonPrice(existing)?.toFixed(activeCurrency().decimals) ?? '');
  const [options, setOptions] = useState<OptionDraft[]>(() =>
    product
      ? product.options.map((o) => ({ id: newOptionId(), name: o.name, values: o.values.join(', ') }))
      : [
          { id: newOptionId(), name: 'Size', values: '' },
          { id: newOptionId(), name: 'Colour', values: '' },
        ],
  );
  const [rows, setRows] = useState<Record<string, RowDraft>>(() =>
    Object.fromEntries(existing.map((v) => [keyOf(v.variant ?? []), rowOf(v, commonPrice(existing))])),
  );
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [touched, setTouched] = useState(false);

  const cleaned = toOptions(options);
  const plan = planVariants(cleaned, existing);
  const kept = new Map(plan.keep.map(({ item, values }) => [keyOf(values), item]));
  const combos = cleaned.length > 0 ? combinations(cleaned) : [];
  const rowFor = (values: string[]) => rows[keyOf(values)] ?? BLANK_ROW;
  const setRow = (values: string[], patch: Partial<RowDraft>) => {
    setTouched(true);
    setRows((prev) => ({ ...prev, [keyOf(values)]: { ...(prev[keyOf(values)] ?? BLANK_ROW), ...patch } }));
  };

  const priceValue = Number.parseFloat(price);
  const priceValid = isAmountText(price) && priceValue > 0;
  const rowPrice = (row: RowDraft) => (row.price.trim() === '' ? priceValue : Number.parseFloat(row.price));
  const rowPriceValid = (row: RowDraft) =>
    row.price.trim() === '' ? priceValid : isAmountText(row.price) && Number.parseFloat(row.price) > 0;

  // Codes can't repeat between this product's variants, or belong to any other item.
  const ownIds = existing.map((v) => v.id);
  const rowCodes = (row: RowDraft) => [...new Set([row.sku.trim().toLowerCase(), row.barcode.trim().toLowerCase()])];
  const repeats = repeatedCodes(combos.flatMap((values) => rowCodes(rowFor(values))));
  const codeError = (code: string): string | null => {
    if (!code.trim()) return null;
    if (isRepeated(repeats, code)) return 'Used twice here';
    const owner = codeOwner(catalog, code, ownIds);
    return owner ? `On ${owner.name}` : null;
  };

  const nameValid = name.trim().length > 0;
  const categoryValid = editable.some((c) => c.id === category);
  const optionsValid = cleaned.length > 0;
  const rowsValid = combos.every((values) => {
    const row = rowFor(values);
    const isNew = !kept.has(keyOf(values));
    return (
      rowPriceValid(row) &&
      (!isNew || row.stock.trim() === '' || WHOLE_NUMBER.test(row.stock.trim())) &&
      !codeError(row.sku) &&
      !codeError(row.barcode)
    );
  });
  const canSave = nameValid && categoryValid && optionsValid && rowsValid;
  const stockLost = plan.drop.reduce((sum, v) => sum + (v.untracked ? 0 : Math.max(0, v.stock)), 0);

  if (!creating && !product) {
    return (
      <div className="editor">
        <EditorBar title="Product not found" onBack={() => navigate('/admin/items')} />
        <div className="editor__missing">
          <p>This product isn’t in the catalog any more — it may have been deleted.</p>
          <Button onClick={() => navigate('/admin/items')}>Back to items</Button>
        </div>
      </div>
    );
  }

  if (creating && editable.length === 0) {
    return (
      <div className="editor">
        <EditorBar title="New product" onBack={() => navigate('/admin/items')} />
        <div className="editor__missing">
          <p>Products are sorted into categories, and there aren’t any yet. Create one first.</p>
          <Button onClick={() => navigate('/admin/categories')}>Create a category</Button>
        </div>
      </div>
    );
  }

  function setOption(id: string, patch: Partial<OptionDraft>) {
    setTouched(true);
    setOptions((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  }

  /** Gives every variant without a SKU one made from the name and its values. */
  function fillSkus() {
    setTouched(true);
    setRows((prev) => {
      const next = { ...prev };
      for (const values of combos) {
        const row = next[keyOf(values)] ?? BLANK_ROW;
        if (!row.sku.trim()) next[keyOf(values)] = { ...row, sku: suggestSku(name, values) };
      }
      return next;
    });
  }

  function save() {
    if (!canSave) return;
    const productName = name.trim();
    const saved = saveProduct({ id: product?.id, name: productName, category, color, options: cleaned });
    for (const values of combos) {
      const row = rowFor(values);
      const fields = {
        name: variantName(productName, values),
        price: rowPrice(row),
        category,
        color,
        available: row.available,
        sku: row.sku.trim() || undefined,
        barcode: row.barcode.trim() || undefined,
        productId: saved.id,
        variant: values,
      };
      const item = kept.get(keyOf(values));
      // An existing variant's stock changes through the ledger, on the Stock page — only new ones set it here.
      if (item) updateItem(item.id, fields);
      else createItem({ ...fields, stock: Number.parseInt(row.stock, 10) || 0 });
    }
    for (const item of plan.drop) deleteItem(item.id);
    navigate('/admin/items');
  }

  function remove() {
    if (!product) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    deleteProduct(product.id);
    navigate('/admin/items');
  }

  const forSale = combos.filter((values) => rowFor(values).available);
  const prices = forSale.filter((values) => rowPriceValid(rowFor(values))).map((values) => rowPrice(rowFor(values)));
  const low = prices.length ? Math.min(...prices) : 0;
  const high = prices.length ? Math.max(...prices) : 0;

  return (
    <div className="editor">
      <EditorBar
        title={creating ? 'New product' : 'Edit product'}
        sub={`${categoryPath(categories, category)} catalog · sold in sizes and colours`}
        onBack={() => navigate(-1)}
      >
        {product && (
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
        <Button size="sm" onClick={save} disabled={!canSave || (!creating && !touched)}>
          {creating ? 'Create product' : 'Save product'}
        </Button>
      </EditorBar>

      <div className="editor__body">
        <form className="editor__form editor__form--wide" onSubmit={(e) => e.preventDefault()}>
          <div className="product-editor__pair">
            <div className="field">
              <label className="field__label" htmlFor="product-name">
                Product name
              </label>
              <input
                id="product-name"
                type="text"
                value={name}
                placeholder="Classic Tee"
                onChange={(e) => {
                  setName(e.target.value);
                  setTouched(true);
                }}
              />
              {!nameValid && touched && <p className="field__error">Give the product a name before saving.</p>}
            </div>

            <div className="field">
              <label className="field__label" htmlFor="product-price">
                Price
              </label>
              <div className="price-input">
                <span className="price-input__symbol mono" aria-hidden="true">
                  {activeCurrency().symbol}
                </span>
                <input
                  id="product-price"
                  className="mono"
                  type="text"
                  inputMode="decimal"
                  value={price}
                  onChange={(e) => {
                    setPrice(e.target.value);
                    setTouched(true);
                  }}
                />
              </div>
              <p className="portions__help">Every variant sells at this unless you give it its own price below.</p>
            </div>
          </div>

          <div className="field">
            <span className="field__label">Options</span>
            <p className="portions__help">
              What the product comes in. Separate values with commas. Each combination becomes a variant with its own
              code, price and stock.
            </p>
            <div className="product-options">
              {options.map((o) => (
                <div className="product-options__row" key={o.id}>
                  <input
                    type="text"
                    value={o.name}
                    placeholder="Size"
                    aria-label="Option name"
                    onChange={(e) => setOption(o.id, { name: e.target.value })}
                  />
                  <input
                    type="text"
                    value={o.values}
                    placeholder="S, M, L, XL"
                    aria-label={`${o.name || 'Option'} values`}
                    onChange={(e) => setOption(o.id, { values: e.target.value })}
                  />
                  <button
                    type="button"
                    className="product-options__remove"
                    onClick={() => {
                      setTouched(true);
                      setOptions((prev) => prev.filter((x) => x.id !== o.id));
                    }}
                    aria-label={`Remove ${o.name || 'this option'}`}
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                </div>
              ))}
            </div>
            {options.length < 3 && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setOptions((prev) => [...prev, { id: newOptionId(), name: '', values: '' }])}
              >
                Add an option
              </Button>
            )}
            {!optionsValid && touched && <p className="field__error">Give at least one option a value.</p>}
          </div>

          {combos.length > 0 && (
            <div className="field">
              <div className="product-variants__head">
                <span className="field__label">
                  Variants <Mono>{combos.length}</Mono>
                </span>
                <Button variant="secondary" size="sm" onClick={fillSkus} disabled={!nameValid}>
                  Fill blank SKUs
                </Button>
              </div>
              <div className="product-variants__wrap">
                <table className="product-variants">
                  <thead>
                    <tr>
                      <th scope="col">Variant</th>
                      <th scope="col">SKU</th>
                      <th scope="col">Barcode</th>
                      <th scope="col">Price</th>
                      <th scope="col">Stock</th>
                      <th scope="col">For sale</th>
                    </tr>
                  </thead>
                  <tbody>
                    {combos.map((values) => {
                      const row = rowFor(values);
                      const item = kept.get(keyOf(values));
                      const label = variantLabel(values);
                      const skuError = codeError(row.sku);
                      const barcodeError = codeError(row.barcode);
                      const stockError = !item && row.stock.trim() !== '' && !WHOLE_NUMBER.test(row.stock.trim());
                      return (
                        <tr key={keyOf(values)}>
                          <th scope="row">
                            {label}
                            {!item && !creating && <span className="product-variants__new"> · new</span>}
                          </th>
                          <td>
                            <input
                              className="mono"
                              type="text"
                              value={row.sku}
                              onChange={(e) => setRow(values, { sku: e.target.value })}
                              aria-label={`SKU for ${label}`}
                              aria-invalid={!!skuError}
                            />
                            {skuError && <span className="product-variants__error">{skuError}</span>}
                          </td>
                          <td>
                            <input
                              className="mono"
                              type="text"
                              inputMode="numeric"
                              value={row.barcode}
                              onChange={(e) => setRow(values, { barcode: e.target.value })}
                              // A scanner's Enter would otherwise submit the form.
                              onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
                              aria-label={`Barcode for ${label}`}
                              aria-invalid={!!barcodeError}
                            />
                            {barcodeError && <span className="product-variants__error">{barcodeError}</span>}
                          </td>
                          <td>
                            <input
                              className="mono"
                              type="text"
                              inputMode="decimal"
                              value={row.price}
                              placeholder={priceValid ? price : ''}
                              onChange={(e) => setRow(values, { price: e.target.value })}
                              aria-label={`Price for ${label}`}
                              aria-invalid={!rowPriceValid(row)}
                            />
                          </td>
                          <td>
                            {item ? (
                              <Mono>{item.stock}</Mono>
                            ) : (
                              <input
                                className="mono product-variants__stock"
                                type="text"
                                inputMode="numeric"
                                value={row.stock}
                                placeholder="0"
                                onChange={(e) => setRow(values, { stock: e.target.value })}
                                aria-label={`Opening stock for ${label}`}
                                aria-invalid={stockError}
                              />
                            )}
                          </td>
                          <td>
                            <input
                              type="checkbox"
                              checked={row.available}
                              onChange={(e) => setRow(values, { available: e.target.checked })}
                              aria-label={`${label} for sale`}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {!rowsValid && (
                <p className="field__error">
                  {priceValid
                    ? 'Fix the marked fields — prices above zero, whole-number stock, and codes no other item uses.'
                    : `Set the price above, or give every variant its own — above ${formatMoney(0)}.`}
                </p>
              )}
              <p className="portions__help">
                {creating
                  ? 'Stock is what you have of each right now. After this it changes through sales, deliveries and the Stock page.'
                  : 'Existing variants’ stock changes through sales, deliveries and the Stock page. New ones start from what you enter.'}
              </p>
            </div>
          )}

          {plan.drop.length > 0 && (
            <p className="product-editor__drop" role="status">
              Saving removes {plan.drop.map((v) => variantLabel(v.variant ?? [])).join(', ')}
              {stockLost > 0 && (
                <>
                  {' '}
                  — with <Mono>{stockLost}</Mono> still in stock
                </>
              )}
              . Past sales keep their lines.
            </p>
          )}

          <div className="field">
            <span className="field__label">Category</span>
            <PillRow label="Category">
              {editable.map((c) => (
                <Pill
                  key={c.id}
                  active={c.id === category}
                  onClick={() => {
                    setCategory(c.id);
                    setTouched(true);
                  }}
                >
                  {categoryPath(categories, c.id)}
                </Pill>
              ))}
            </PillRow>
          </div>

          <div className="field">
            <span className="field__label">Tile color</span>
            <div className="swatch-row" role="group" aria-label="Tile color">
              {SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={c === color ? 'swatch swatch--active' : 'swatch'}
                  style={{ background: c }}
                  onClick={() => {
                    setColor(c);
                    setTouched(true);
                  }}
                  aria-pressed={c === color}
                  aria-label={`Tile color ${c}`}
                />
              ))}
            </div>
          </div>
        </form>

        <aside className="editor__preview" aria-label="Live preview">
          <div className="editor__preview-label">Live preview</div>
          <ItemTile
            name={name.trim() || 'Untitled product'}
            price={low}
            deal={`${high > low ? 'From · ' : ''}${forSale.length} options`}
            color={color}
            interactive={false}
            tone="paper"
            className="editor__preview-tile"
          />
          <p className="editor__preview-note">
            One tile on the register for the whole product. Tapping it asks which variant; scanning a variant’s barcode
            or SKU rings that one up straight away.
          </p>
        </aside>
      </div>
    </div>
  );
}

function EditorBar({
  title,
  sub,
  onBack,
  children,
}: {
  title: string;
  sub?: string;
  onBack: () => void;
  children?: ReactNode;
}) {
  return (
    <header className="editor__bar">
      <div className="editor__bar-left">
        <button type="button" className="editor__back" onClick={onBack} aria-label="Back">
          <span aria-hidden="true">&larr;</span>
        </button>
        <div>
          <div className="editor__title">{title}</div>
          {sub && <div className="editor__sub">{sub}</div>}
        </div>
      </div>
      {children && <div className="editor__actions">{children}</div>}
    </header>
  );
}
