import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import './Register.css';
import { AssignTabDialog } from '../components/AssignTabDialog';
import { Button } from '../components/Button';
import { LineDialog, PriceDialog, TabDiscountDialog } from '../components/CounterDialogs';
import { ItemTile } from '../components/ItemTile';
import { MealDialog } from '../components/MealDialog';
import { Money, Mono } from '../components/Mono';
import { Pill, PillRow } from '../components/Pill';
import { ReceiptEdge, SummaryRow } from '../components/Receipt';
import { SearchField } from '../components/SearchField';
import { StatusChip } from '../components/StatusChip';
import { Stepper } from '../components/Stepper';
import {
  CATEGORIES,
  type CatalogItem,
  type CategoryId,
} from '../data/catalog';
import {
  bestPromo,
  clockLabel,
  courseOptions,
  promoAmountLabel,
  promoRunning,
  scopeLabel,
  type Promotion,
  type SetMeal,
} from '../data/deals';
import { ORDER_TYPES, paidAmount } from '../data/orders';
import { discountLabel, itemLine, itemQuantities, lineCap, lineItems, round, type CartLine } from '../lib/cart';
import { usePos } from '../lib/store';
import { useNow } from '../lib/useClock';

/** The register's shelves: a catalog category, or the set meals. */
type Shelf = CategoryId | 'meals';

export function Register() {
  const navigate = useNavigate();
  const [category, setCategory] = useState<Shelf>('coffee');
  const [meal, setMeal] = useState<SetMeal | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [query, setQuery] = useState('');
  // The open-price item being priced, or 'custom' for a custom amount.
  const [pricing, setPricing] = useState<CatalogItem | 'custom' | null>(null);
  const [editingLine, setEditingLine] = useState<string | null>(null);
  const [discounting, setDiscounting] = useState(false);
  const {
    tab,
    cart,
    totals,
    catalog,
    addItem,
    addOpenPriceItem,
    addCustomAmount,
    setOrderType,
    setQty,
    clearTab,
    settings,
    isKitchenItem,
    unsent,
    sendToKitchen,
    promotions,
    setMeals,
  } = usePos();
  // Re-read every 30s so tiles pick up a promotion starting or ending.
  const at = new Date(useNow(30_000));
  const running = promotions.filter((p) => promoRunning(p, at));
  const onTab = itemQuantities(cart);
  const q = query.trim().toLowerCase();
  const searching = q.length > 0;
  const meals = setMeals.filter((m) => m.available && (!searching || m.name.toLowerCase().includes(q)));
  const unsentCount = unsent.reduce((sum, l) => sum + l.qty, 0);

  // Unavailable items are hidden from the register, per the editor's toggle.
  // A search looks across every category at once.
  const visibleItems = useMemo(
    () =>
      catalog.filter(
        (item) =>
          item.available &&
          (q ? item.name.toLowerCase().includes(q) : item.category === category),
      ),
    [catalog, category, q],
  );
  const showMeals = searching || category === 'meals';
  const showItems = searching || category !== 'meals';

  const hasItems = cart.length > 0;
  const paid = paidAmount(tab.payments);
  const partPaid = tab.payments.length > 0;
  const dueNow = round(totals.total + (tab.tip ?? 0) - paid);

  /** The stepper's ceiling: what's on hand, but never below what's already on the line. */
  function lineMax(line: CartLine): number {
    // Lines whose items were deleted from the catalog keep the stepper default.
    return Math.max(line.qty, Math.min(99, lineCap(cart, line.key, catalog)));
  }

  /** Kitchen items on the line still waiting to go, or null if it has none. */
  function lineUnsent(line: CartLine): number | null {
    const kitchen = lineItems(line).filter((i) => isKitchenItem(i.itemId));
    if (kitchen.length === 0) return null;
    return Math.max(
      ...kitchen.map((i) =>
        Math.min(line.qty, unsent.find((l) => l.itemId === i.itemId)?.qty ?? 0),
      ),
    );
  }

  // A pending "Confirm clear" never carries over to a different tab.
  useEffect(() => setConfirmingClear(false), [tab.orderId]);

  function clear() {
    if (!confirmingClear) {
      setConfirmingClear(true);
      return;
    }
    clearTab();
    setConfirmingClear(false);
  }

  // "Or press Enter to take payment" — wired, not decorative.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Enter' || !hasItems) return;
      const el = document.activeElement;
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement ||
        el instanceof HTMLButtonElement;
      if (typing) return;
      charge();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hasItems]);

  /** Hands the open tab over to the tender screen. */
  function charge() {
    navigate('/counter/tender');
  }

  return (
    <div className="register__body">
      <main className="catalog">
        <div className="catalog__toolbar">
          <SearchField value={query} onChange={setQuery} placeholder="Search items" label="Search items" />
          <Button variant="secondary" onClick={() => setPricing('custom')}>
            Custom amount
          </Button>
        </div>

        {!searching && (
        <PillRow label="Item categories" className="catalog__tabs">
          {CATEGORIES.map((c) => (
            <Pill key={c.id} active={c.id === category} onClick={() => setCategory(c.id)}>
              {c.label}
            </Pill>
          ))}
          {meals.length > 0 && (
            <Pill active={category === 'meals'} onClick={() => setCategory('meals')}>
              Set meals
            </Pill>
          )}
        </PillRow>
        )}

        {running.length > 0 && (
          <div className="catalog__deals" role="status">
            {running.map((p) => (
              <span key={p.id} className="catalog__deal">
                <strong>{p.name}</strong> · {promoAmountLabel(p)}{' '}
                {scopeLabel(p, categoryLabel).toLowerCase()}
                {p.start !== null && p.end !== null && (
                  <>
                    {' '}
                    · until <Mono>{clockLabel(p.end)}</Mono>
                  </>
                )}
              </span>
            ))}
          </div>
        )}

        <div className="catalog__grid">
          {searching && visibleItems.length === 0 && meals.length === 0 && (
            <p className="catalog__empty">Nothing matches “{query.trim()}”.</p>
          )}
          {showMeals &&
            meals.map((m) => {
                const ready = m.courses.every((c) =>
                  courseOptions(c, catalog).some(
                    (i) => i.available && i.stock - (onTab.get(i.id) ?? 0) > 0,
                  ),
                );
                return (
                  <ItemTile
                    key={m.id}
                    name={m.name}
                    price={m.price}
                    color={m.color}
                    deal={`${m.courses.length} courses`}
                    note={ready ? undefined : 'A course is sold out'}
                    disabled={!ready}
                    onClick={() => setMeal(m)}
                  />
                );
              })}
          {showItems &&
            visibleItems.map((item) => {
                const stock = tileStock(item, onTab.get(item.id) ?? 0, settings.lowStockDefault);
                const promo = bestPromo(promotions, item, at);
                const price = promo ? itemPrice(item, promo) : item.price;
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
                    onClick={() => (item.openPrice ? setPricing(item) : addItem(item))}
                  />
                );
              })}
        </div>

        <MealDialog meal={meal} onClose={() => setMeal(null)} />
        <PriceDialog
          open={pricing !== null}
          itemName={pricing && pricing !== 'custom' ? pricing.name : undefined}
          onSubmit={(name, price) =>
            pricing === 'custom' ? addCustomAmount(name, price) : pricing && addOpenPriceItem(pricing, price)
          }
          onClose={() => setPricing(null)}
        />
        <LineDialog lineKey={editingLine} onClose={() => setEditingLine(null)} />
        <TabDiscountDialog open={discounting} onClose={() => setDiscounting(false)} />
      </main>

      <aside className="cart" aria-label="Current tab">
        <ReceiptEdge />

        <div className="cart__status">
          {hasItems ? (
            <StatusChip status="occupied">Tab occupied</StatusChip>
          ) : (
            <StatusChip status="open">Tab open</StatusChip>
          )}
          <span className="cart__count">
            <Mono>{totals.itemCount}</Mono> {totals.itemCount === 1 ? 'item' : 'items'}
            {hasItems && !partPaid && (
              <button
                type="button"
                className={confirmingClear ? 'cart__clear cart__clear--confirm' : 'cart__clear'}
                onClick={clear}
                onBlur={() => setConfirmingClear(false)}
              >
                {confirmingClear ? 'Confirm clear' : 'Clear tab'}
              </button>
            )}
          </span>
        </div>

        <div className="cart__title">
          <button
            type="button"
            className="cart__assign"
            onClick={() => setAssigning(true)}
            aria-label={`${tab.name} — change table or room`}
          >
            {tab.name}
            {tab.locationId === null && (
              <span className="cart__assign-hint" aria-hidden="true">
                Assign table
              </span>
            )}
            <span className="cart__assign-caret" aria-hidden="true">
              ▾
            </span>
          </button>
          <span>
            <Mono>{`#${tab.orderId}`}</Mono> · opened <Mono>{tab.openedAt}</Mono>
          </span>
        </div>

        <div className="cart__type" role="group" aria-label="Order type">
          {ORDER_TYPES.map((t) => (
            <button
              key={t.id}
              type="button"
              className={tab.orderType === t.id ? 'cart__type-btn cart__type-btn--active' : 'cart__type-btn'}
              aria-pressed={tab.orderType === t.id}
              onClick={() => setOrderType(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <AssignTabDialog open={assigning} onClose={() => setAssigning(false)} />

        <div className="cart__items">
          {hasItems ? (
            cart.map((line) => {
              const waiting = lineUnsent(line);
              return (
                <div className="cart-line" key={line.key}>
                  <button
                    type="button"
                    className="cart-line__info"
                    onClick={() => setEditingLine(line.key)}
                    aria-label={`${line.name} — add a note or discount`}
                  >
                    <div className="cart-line__name">{line.name}</div>
                    {line.note && <div className="cart-line__note">“{line.note}”</div>}
                    {line.parts && (
                      <div className="cart-line__parts">
                        {line.parts.map((p) => p.name).join(' · ')}
                      </div>
                    )}
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
                      {waiting !== null && <KitchenNote qty={waiting} />}
                    </div>
                  </button>
                  <Stepper
                    value={line.qty}
                    onChange={(next) => setQty(line.key, next)}
                    label={line.name}
                    min={0}
                    max={lineMax(line)}
                  />
                  <Money value={line.unitPrice * line.qty} className="cart-line__price" />
                  <button
                    type="button"
                    className="cart-line__remove"
                    onClick={() => setQty(line.key, 0)}
                    aria-label={`Remove ${line.name} from tab`}
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                </div>
              );
            })
          ) : (
            <p className="cart__empty">No items yet — tap a category to start a tab.</p>
          )}
        </div>

        <div className="cart__summary">
          <SummaryRow label="Subtotal" value={totals.subtotal + totals.discount} />
          {totals.discount > 0 && (
            <SummaryRow
              label={tab.discount ? `Discounts · ${discountLabel(tab.discount)} tab` : 'Discounts'}
              value={-totals.discount}
            />
          )}
          <SummaryRow label="Tax" value={totals.tax} />
          <SummaryRow label="Total" value={totals.total} total />
          {partPaid && (
            <>
              {(tab.tip ?? 0) > 0 && <SummaryRow label="Tip" value={tab.tip!} />}
              <SummaryRow label="Paid so far" value={-paid} />
            </>
          )}

          {hasItems && (
            <button type="button" className="cart__discount" onClick={() => setDiscounting(true)}>
              {tab.discount ? 'Change tab discount' : 'Discount the tab'}
            </button>
          )}

          {unsentCount > 0 && (
            <Button variant="secondary" block className="cart__send" onClick={sendToKitchen}>
              <span>
                Send <Mono>{unsentCount}</Mono> to kitchen
              </span>
            </Button>
          )}

          <Button
            size="lg"
            block
            className="cart__charge"
            disabled={!hasItems}
            onClick={charge}
          >
            {partPaid ? 'Charge the rest' : 'Charge'} <Money value={partPaid ? dueNow : totals.total} />
          </Button>

          <p className="cart__charge-sub">
            {hasItems ? 'Or press Enter to take payment' : 'Add an item to start charging'}
          </p>
        </div>
      </aside>
    </div>
  );
}

/** Where a kitchen item on the tab stands: all sent, or how many are still to send. */
function KitchenNote({ qty }: { qty: number }) {
  return qty > 0 ? (
    <span className="cart-line__kitchen cart-line__kitchen--unsent">
      {' '}
      · <Mono>{qty}</Mono> not sent
    </span>
  ) : (
    <span className="cart-line__kitchen"> · sent to kitchen</span>
  );
}

function categoryLabel(id: CategoryId): string {
  return CATEGORIES.find((c) => c.id === id)!.label;
}

/** `item`'s price under `promo`, rounded as the cart will ring it up. */
function itemPrice(item: CatalogItem, promo: Promotion): number {
  return itemLine(item, promo).unitPrice;
}

/**
 * What a register tile says about stock, counting what's already on this tab:
 * nothing while there's plenty, "3 left" once low, "Sold out" at zero.
 */
function tileStock(
  item: CatalogItem,
  onTab: number,
  lowDefault: number,
): { note?: string; soldOut: boolean } {
  const remaining = item.stock - onTab;
  if (remaining <= 0) {
    return { note: onTab > 0 ? 'All on this tab' : 'Sold out', soldOut: true };
  }
  if (remaining <= (item.lowStockAt ?? lowDefault)) {
    return { note: `${remaining} left`, soldOut: false };
  }
  return { soldOut: false };
}
