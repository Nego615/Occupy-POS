import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useNavigate } from 'react-router';
import '../../../pages/Register.css';
import './RetailRegister.css';
import { Button } from '../../../components/Button';
import { LineDialog, PriceDialog } from '../../../components/CounterDialogs';
import { ItemTile } from '../../../components/ItemTile';
import { BigMoney, Money, Mono } from '../../../components/Mono';
import { OpenTabsDialog } from '../../../components/OpenTabsDialog';
import { Pill, PillRow } from '../../../components/Pill';
import { SummaryRow } from '../../../components/Receipt';
import { Stepper } from '../../../components/Stepper';
import {
  categoryLineage,
  categoryPath,
  inCategory,
  roundStock,
  STOCK_SLACK,
  stockFits,
  subCategories,
  topCategories,
  type CatalogItem,
  type CategoryId,
} from '../../../data/catalog';
import { bestPromo } from '../../../data/deals';
import { paidAmount } from '../../../data/orders';
import { findByCode, priceRange, variantsOf, type Product } from '../../../data/products';
import { itemLine, itemQuantities, lineCap, round, type CartLine } from '../../../lib/cart';
import { rowInOut, snap } from '../../../lib/motion';
import { orderNo, usePos } from '../../../lib/store';
import { useNow } from '../../../lib/useClock';
import { ScanField } from '../components/ScanField';
import { VariantDialog } from '../components/VariantDialog';
import { useScanner } from '../useScanner';

/** What a till tile stands for: one item, or a product with one tile for all its variants. */
type Tile = { kind: 'item'; item: CatalogItem } | { kind: 'product'; product: Product };

/**
 * Retail's till. Goods are scanned or tapped onto the sale and paid for on the
 * spot — no tables, no kitchen, no dockets. A cashier who can't take payment
 * sends the sale to the counter instead.
 */
export function RetailRegister() {
  const navigate = useNavigate();
  const {
    tab,
    cart,
    totals,
    catalog,
    products,
    categories,
    promotions,
    settings,
    tabs,
    me,
    can,
    canSeeTab,
    addItem,
    addOpenPriceItem,
    addCustomAmount,
    setQty,
    clearTab,
    requestBill,
    openTab,
  } = usePos();
  const [chosenShelf, setShelf] = useState<CategoryId | null>(null);
  const [query, setQuery] = useState('');
  const [pricing, setPricing] = useState<CatalogItem | 'custom' | null>(null);
  const [choosing, setChoosing] = useState<Product | null>(null);
  const [editingLine, setEditingLine] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  /** Why the last scan rang nothing up, until the next one or a keystroke. */
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [sentToCounter, setSentToCounter] = useState<string | null>(null);

  // A shelf deleted on another screen falls back to the first one.
  const shelves = topCategories(categories);
  const shelf = chosenShelf && categories.some((c) => c.id === chosenShelf) ? chosenShelf : (shelves[0]?.id ?? null);
  const path = shelf ? categoryLineage(categories, shelf).reverse() : [];
  const at = new Date(useNow(30_000));
  const onTab = itemQuantities(cart);
  const q = query.trim().toLowerCase();

  // A search looks across every category, by name and by code.
  const visible = useMemo(
    () =>
      catalog.filter(
        (item) =>
          item.available &&
          (q
            ? item.name.toLowerCase().includes(q) ||
              !!item.sku?.toLowerCase().includes(q) ||
              !!item.barcode?.includes(q)
            : shelf !== null && inCategory(categories, item.category, shelf)),
      ),
    [catalog, categories, shelf, q],
  );
  // A product's variants share one tile, standing where its first variant would.
  const tiles = useMemo(() => {
    const byId = new Map(products.map((p) => [p.id, p]));
    const shown = new Set<string>();
    return visible.flatMap((item): Tile[] => {
      const product = item.productId ? byId.get(item.productId) : undefined;
      if (!product) return [{ kind: 'item', item }];
      if (shown.has(product.id)) return [];
      shown.add(product.id);
      return [{ kind: 'product', product }];
    });
  }, [visible, products]);

  const hasItems = cart.length > 0;
  const paid = paidAmount(tab.payments);
  const partPaid = tab.payments.length > 0;
  const due = round(totals.total + (tab.tip ?? 0) - paid);
  const paysHere = can('payments');
  // Lines come off a sale only on one this cashier opened.
  const editsSale = cart.length === 0 || (!!me && tab.openedBy === me.id);
  const parked = tabs.filter((t) => t.orderId !== tab.orderId && t.cart.length > 0 && canSeeTab(t)).length;

  /** Rings up one item as tapping its tile does — asking for its price first if it's priced at the till. */
  function ring(item: CatalogItem): boolean {
    if (item.openPrice && settings.openPriceEnabled) {
      setPricing(item);
      return true;
    }
    return addItem(item);
  }

  /** Rings up the item with this barcode or SKU. False when no item has it. */
  function scan(code: string): boolean {
    const item = findByCode(catalog, code);
    if (!item) {
      setScanNote(`Nothing has the code “${code.trim()}”.`);
      return false;
    }
    if (!item.available) setScanNote(`${item.name} isn’t for sale right now.`);
    else setScanNote(ring(item) ? null : `No more ${item.name} left to sell.`);
    return true;
  }

  /** Enter in the search box: a code rings its item up; a name stays a search. */
  function searchEnter(text: string) {
    if (!text.trim()) return;
    if (scan(text)) setQuery('');
  }

  /** Pays here, or — for a cashier who can't take payment — sends the sale to the counter. */
  function charge() {
    if (!hasItems) return;
    if (paysHere) {
      navigate('/counter/tender', { state: { from: '/counter/register' } });
      return;
    }
    requestBill();
    setSentToCounter(orderNo(tab.orderId) ? `Sale ${orderNo(tab.orderId)}` : 'The sale');
    openTab(null);
  }

  useScanner(scan, charge);

  function clear() {
    if (!confirmingClear) {
      setConfirmingClear(true);
      return;
    }
    clearTab();
    setConfirmingClear(false);
  }

  function changeQty(line: CartLine, qty: number) {
    if (qty >= line.qty || editsSale) setQty(line.key, qty);
  }

  return (
    <div className="register__body">
      <main className="catalog">
        <div className="catalog__head">
          <div className="catalog__toolbar">
            <ScanField
              value={query}
              onChange={(text) => {
                setQuery(text);
                setScanNote(null);
              }}
              onEnter={searchEnter}
            />
            <Button variant="secondary" onClick={() => setPricing('custom')}>
              Custom amount
            </Button>
          </div>
          {scanNote && (
            <p className="retail-till__note" role="status">
              {scanNote}
            </p>
          )}

          {!q && (
            <PillRow label="Categories" className="catalog__tabs">
              {shelves.map((c) => (
                <Pill key={c.id} active={c.id === path[0]} onClick={() => setShelf(c.id)}>
                  {c.label}
                </Pill>
              ))}
            </PillRow>
          )}
          {!q &&
            path.map((id, depth) => {
              const subs = subCategories(categories, id);
              if (subs.length === 0) return null;
              return (
                <PillRow key={id} label={`Inside ${categoryPath(categories, id)}`} className="catalog__tabs catalog__tabs--sub">
                  <Pill active={shelf === id} onClick={() => setShelf(id)}>
                    All
                  </Pill>
                  {subs.map((c) => (
                    <Pill key={c.id} active={c.id === path[depth + 1]} onClick={() => setShelf(c.id)}>
                      {c.label}
                    </Pill>
                  ))}
                </PillRow>
              );
            })}
        </div>

        <div className="catalog__grid">
          {tiles.length === 0 && (
            <p className="catalog__empty">
              {q
                ? `Nothing matches “${query.trim()}”.`
                : shelves.length === 0
                  ? 'No products yet — add them in Admin, under Products.'
                  : 'Nothing in this category yet.'}
            </p>
          )}
          {tiles.map((tile) => {
            if (tile.kind === 'product') {
              const { product } = tile;
              const variants = variantsOf(catalog, product.id).filter((v) => v.available);
              const range = priceRange(variants);
              const open = variants.some((v) => stockFits(v, onTab.get(v.id) ?? 0));
              return (
                <ItemTile
                  key={`product-${product.id}`}
                  name={product.name}
                  price={range?.low ?? 0}
                  deal={`${range && range.high > range.low ? 'From · ' : ''}${variants.length} options`}
                  color={product.color}
                  note={open ? undefined : 'Sold out'}
                  disabled={!open}
                  count={variants.reduce((sum, v) => sum + (onTab.get(v.id) ?? 0), 0)}
                  onClick={() => setChoosing(product)}
                />
              );
            }
            const { item } = tile;
            const stock = tileStock(item, onTab.get(item.id) ?? 0, settings.lowStockDefault);
            const promo = bestPromo(promotions, item, at, categories);
            const price = promo ? itemLine(item, promo).unitPrice : item.price;
            return (
              <ItemTile
                key={item.id}
                name={item.name}
                price={price}
                wasPrice={price < item.price ? item.price : undefined}
                deal={promo && price < item.price ? promo.name : undefined}
                color={item.color}
                note={stock.note}
                disabled={stock.soldOut}
                count={onTab.get(item.id) ?? 0}
                onClick={() => ring(item)}
              />
            );
          })}
        </div>

        <PriceDialog
          open={pricing !== null}
          itemName={pricing && pricing !== 'custom' ? pricing.name : undefined}
          onSubmit={(name, price) =>
            pricing === 'custom' ? addCustomAmount(name, price) : pricing && addOpenPriceItem(pricing, price)
          }
          onClose={() => setPricing(null)}
        />
        <VariantDialog product={choosing} onPick={ring} onClose={() => setChoosing(null)} />
        <LineDialog lineKey={editingLine} onClose={() => setEditingLine(null)} />
      </main>

      <aside className="cart" aria-label="Current sale">
        <div className="cart__head">
          <h2 className="cart__heading">
            <button
              type="button"
              className="cart__tabs"
              onClick={() => setBrowsing(true)}
              aria-label={`Parked sales (${parked}) — switch to one`}
            >
              Parked sales
              {parked > 0 && <Mono className="cart__tab-count">{parked}</Mono>}
              <span className="cart__tabs-caret" aria-hidden="true">
                ▾
              </span>
            </button>
          </h2>
          <button type="button" className="cart__new" onClick={() => openTab(null)}>
            <span aria-hidden="true">+</span> New sale
          </button>
        </div>
        <OpenTabsDialog open={browsing} onClose={() => setBrowsing(false)} />

        <div className="retail-sale">
          <div className="retail-sale__top">
            <span className="retail-sale__name">{orderNo(tab.orderId) ? `Sale ${orderNo(tab.orderId)}` : 'New sale'}</span>
            <span className="retail-sale__count">
              <Mono>{totals.itemCount}</Mono> {totals.itemCount === 1 ? 'item' : 'items'}
            </span>
          </div>
          <BigMoney value={partPaid ? due : totals.total} className="retail-sale__amount" />
          {hasItems && !partPaid && editsSale && (
            <button
              type="button"
              className={confirmingClear ? 'retail-sale__clear retail-sale__clear--confirm' : 'retail-sale__clear'}
              onClick={clear}
              onBlur={() => setConfirmingClear(false)}
            >
              {confirmingClear ? 'Confirm clear' : 'Clear sale'}
            </button>
          )}
        </div>

        <div className="cart__items">
          <AnimatePresence key={tab.orderId} initial={false} mode="popLayout">
            {cart.map((line) => (
              <motion.div className="cart-line" key={line.key} layout="position" transition={snap} {...rowInOut}>
                <button
                  type="button"
                  className="cart-line__info"
                  onClick={() => setEditingLine(line.key)}
                  aria-label={`${line.name} — add a note`}
                >
                  <div className="cart-line__name">{line.name}</div>
                  {line.note && <div className="cart-line__note">“{line.note}”</div>}
                  <div className="cart-line__unit">
                    <Money value={line.unitPrice} /> each
                    {line.listPrice !== undefined && (
                      <>
                        {' '}
                        <s>
                          <Money value={line.listPrice} />
                        </s>
                      </>
                    )}
                    {line.promo && <span className="cart-line__promo"> · {line.promo}</span>}
                  </div>
                </button>
                <Stepper
                  value={line.qty}
                  onChange={(next) => changeQty(line, next)}
                  label={line.name}
                  min={0}
                  max={Math.max(line.qty, Math.min(99, lineCap(cart, line.key, catalog)))}
                  canDecrease={editsSale}
                />
                <Money value={line.unitPrice * line.qty} className="cart-line__price" />
                {editsSale && (
                  <button
                    type="button"
                    className="cart-line__remove"
                    onClick={() => changeQty(line, 0)}
                    aria-label={`Remove ${line.name} from the sale`}
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
          {!hasItems && (
            <p className="cart__empty" role="status">
              {sentToCounter
                ? `${sentToCounter} is waiting at the counter to be paid. Scan the next customer’s first item.`
                : 'No items yet — scan a barcode or tap a product.'}
            </p>
          )}
        </div>

        <div className="cart__summary">
          <SummaryRow label="Subtotal" value={totals.subtotal + totals.discount} />
          {totals.discount > 0 && <SummaryRow label="Discounts" value={-totals.discount} />}
          <SummaryRow label="Tax" value={totals.tax} />
          <SummaryRow label="Total" value={totals.total} total />
          {partPaid && <SummaryRow label="Paid so far" value={-paid} />}

          <Button size="lg" block className="cart__charge" disabled={!hasItems} onClick={charge}>
            {paysHere ? 'Charge' : 'Send to counter'} <Money value={partPaid ? due : totals.total} />
          </Button>
          <p className="cart__charge-sub">
            {!hasItems
              ? 'Scan or tap a product to start a sale'
              : paysHere
                ? 'Take payment now · or press Enter'
                : 'Paid at the counter · or press Enter'}
          </p>
        </div>
      </aside>
    </div>
  );
}

/**
 * What a tile says about stock, counting what's already on this sale: nothing
 * while there's plenty, "3 left" once low, "Sold out" at zero.
 */
function tileStock(item: CatalogItem, onTab: number, lowDefault: number): { note?: string; soldOut: boolean } {
  if (item.untracked) return { soldOut: false };
  const remaining = roundStock(item.stock - onTab);
  if (remaining + STOCK_SLACK < 1) return { note: onTab > 0 ? 'All on this sale' : 'Sold out', soldOut: true };
  if (remaining <= (item.lowStockAt ?? lowDefault)) return { note: `${remaining} left`, soldOut: false };
  return { soldOut: false };
}
