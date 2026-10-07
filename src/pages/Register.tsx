import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useNavigate } from 'react-router';
import './Register.css';
import { ApprovalDialog } from '../components/ApprovalDialog';
import { AssignTabDialog } from '../components/AssignTabDialog';
import { Button } from '../components/Button';
import { DocketDialog, LineDialog, PortionDialog, PriceDialog, TabDiscountDialog } from '../components/CounterDialogs';
import { PrintableDocket, type DocketKind } from '../components/PrintableSlip';
import { ItemTile } from '../components/ItemTile';
import { MealDialog } from '../components/MealDialog';
import { Money, Mono } from '../components/Mono';
import { Pill, PillRow } from '../components/Pill';
import { ReceiptEdge, SummaryRow } from '../components/Receipt';
import { SearchField } from '../components/SearchField';
import { StatusChip } from '../components/StatusChip';
import { Stepper } from '../components/Stepper';
import {
  categoryLabel,
  roundStock,
  STOCK_SLACK,
  stockFits,
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
import { paidAmount, type Order } from '../data/orders';
import { discountLabel, itemLine, itemQuantities, lineCap, lineItems, round, type CartLine } from '../lib/cart';
import { rowInOut, snap } from '../lib/motion';
import { usePos } from '../lib/store';
import { useNow } from '../lib/useClock';

/** The register's shelves: a catalog category, or the set meals. */
type Shelf = CategoryId | 'meals';

export function Register() {
  const navigate = useNavigate();
  // Null until someone picks a shelf: the first category, else set meals.
  const [chosenShelf, setCategory] = useState<Shelf | null>(null);
  const [meal, setMeal] = useState<SetMeal | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  // Something being taken off the tab that's waiting on a manager's PIN: a line
  // brought down to `qty`, or — with no `key` — the whole tab cleared.
  const [removal, setRemoval] = useState<{ action: string; key: string | null; qty: number } | null>(null);
  const [query, setQuery] = useState('');
  // The open-price item being priced, or 'custom' for a custom amount.
  const [pricing, setPricing] = useState<CatalogItem | 'custom' | null>(null);
  // The item whose serving — whole or a portion — is being picked.
  const [portioning, setPortioning] = useState<CatalogItem | null>(null);
  const [editingLine, setEditingLine] = useState<string | null>(null);
  const [discounting, setDiscounting] = useState(false);
  const [choosingDocket, setChoosingDocket] = useState(false);
  // The docket being printed — on the page only while the print dialog is up. It keeps
  // its own copy of the tab, so a bill sent to the front desk still prints once it's gone.
  const [docket, setDocket] = useState<{ order: Order; kind: DocketKind } | null>(null);
  // The tab whose bill was just sent to the front desk, for the note on the empty register.
  const [billSent, setBillSent] = useState<string | null>(null);
  const {
    tab,
    cart,
    totals,
    catalog,
    addItem,
    addOpenPriceItem,
    addCustomAmount,
    setQty,
    clearTab,
    settings,
    isKitchenItem,
    unsent,
    sendToKitchen,
    requestBill,
    openTab,
    can,
    promotions,
    setMeals,
    categories,
    orders,
  } = usePos();
  const tabOrder = orders.find((o) => o.id === tab.orderId && o.status === 'occupied');

  // Prints once the docket is on the page, then takes it off again.
  useEffect(() => {
    if (!docket) return;
    window.print();
    setDocket(null);
  }, [docket]);
  // A shelf deleted on another screen falls back to the first one.
  const category: Shelf =
    chosenShelf === 'meals' || categories.some((c) => c.id === chosenShelf)
      ? chosenShelf!
      : (categories[0]?.id ?? 'meals');
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
        Math.min(line.qty, unsent.find((l) => l.itemId === i.itemId && l.name === i.name)?.qty ?? 0),
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
    takeOff({ action: `Clear ${tab.name}`, key: null, qty: 0 });
    setConfirmingClear(false);
  }

  // Anyone on the register can add to a tab; taking things off needs the right
  // role, or a manager's PIN for whoever's signed in.
  const editsTab = can('editTabs');

  function takeOff(r: NonNullable<typeof removal>) {
    if (editsTab) applyRemoval(r);
    else setRemoval(r);
  }

  function applyRemoval(r: NonNullable<typeof removal>) {
    if (r.key === null) clearTab();
    else setQty(r.key, r.qty);
  }

  /** The stepper and the × — going up always works, coming down is a removal. */
  function changeQty(line: CartLine, qty: number) {
    if (qty >= line.qty) return setQty(line.key, qty);
    const action =
      qty === 0
        ? `Remove ${line.qty} × ${line.name} from ${tab.name}`
        : `Take ${line.qty - qty} × ${line.name} off ${tab.name}`;
    takeOff({ action, key: line.key, qty });
  }

  // Only the front desk (and owners and managers) take payment; everyone else sends the bill there.
  const takesPayment = can('payments');

  // "Or press Enter to take payment" — wired, not decorative.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Not while a dialog is up — a manager's PIN, say — on top of the register.
      if (e.key !== 'Enter' || !hasItems || document.querySelector('dialog[open]')) return;
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
    // Re-bound every render, so the bill it sends and prints is the tab as it is now.
  });

  // The note about a sent bill goes once something new is rung up.
  useEffect(() => {
    if (hasItems) setBillSent(null);
  }, [hasItems]);

  /** Hands the open tab over to the tender screen, or sends it to the front desk to be paid. */
  function charge() {
    if (takesPayment) {
      navigate('/counter/tender', { state: { from: '/counter/register' } });
      return;
    }
    requestBill();
    setBillSent(tab.name);
    // The order docket goes with the bill — up for printing straight away.
    if (tabOrder) setDocket({ order: tabOrder, kind: 'bill' });
    // The bill waits at the front desk; the register moves on to the next customer.
    openTab(null);
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
          {categories.map((c) => (
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
                {scopeLabel(p, (id) => categoryLabel(categories, id)).toLowerCase()}
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
                    (i) => i.available && stockFits(i, onTab.get(i.id) ?? 0),
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
                const openPrice = item.openPrice && settings.openPriceEnabled;
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
                    onClick={() =>
                      openPrice
                        ? setPricing(item)
                        : item.portions?.length
                          ? setPortioning(item)
                          : addItem(item)
                    }
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
        <PortionDialog item={portioning} onClose={() => setPortioning(null)} />
        <LineDialog lineKey={editingLine} onClose={() => setEditingLine(null)} />
        <TabDiscountDialog open={discounting} onClose={() => setDiscounting(false)} />
        <DocketDialog
          open={choosingDocket}
          onPick={(kind) => tabOrder && setDocket({ order: tabOrder, kind })}
          onClose={() => setChoosingDocket(false)}
        />
        {docket && <PrintableDocket order={docket.order} kind={docket.kind} />}
        <ApprovalDialog
          open={removal !== null}
          permission="editTabs"
          action={removal?.action ?? ''}
          onApproved={() => {
            if (removal) applyRemoval(removal);
            setRemoval(null);
          }}
          onClose={() => setRemoval(null)}
        />
      </main>

      <aside className="cart" aria-label="Current tab">
        <ReceiptEdge />

        <div className="cart__status">
          {tab.billRequestedAt ? (
            <StatusChip status="occupied">Bill at front desk</StatusChip>
          ) : hasItems ? (
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
            <span className="cart__assign-name">{tab.name}</span>
            {tab.locationId === null && (
              <span className="cart__assign-hint" aria-hidden="true">
                Assign table
              </span>
            )}
            <span className="cart__assign-caret" aria-hidden="true">
              ▾
            </span>
          </button>
          <span className="cart__title-meta" title={`Order #${tab.orderId}, opened ${tab.openedAt}`}>
            <Mono>{`#${tab.orderId}`}</Mono> · <Mono>{tab.openedAt}</Mono>
          </span>
        </div>

        <AssignTabDialog open={assigning} onClose={() => setAssigning(false)} />

        <div className="cart__items">
          {/* Lines slide in when added and out when removed, and the rest close
              the gap. Keyed by tab, so switching tabs swaps the list without
              replaying every line. */}
          <AnimatePresence key={tab.orderId} initial={false} mode="popLayout">
            {cart.map((line) => {
              const waiting = lineUnsent(line);
              return (
                <motion.div
                  className="cart-line"
                  key={line.key}
                  layout="position"
                  transition={snap}
                  {...rowInOut}
                >
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
                    onChange={(next) => changeQty(line, next)}
                    label={line.name}
                    min={0}
                    max={lineMax(line)}
                  />
                  <Money value={line.unitPrice * line.qty} className="cart-line__price" />
                  <button
                    type="button"
                    className="cart-line__remove"
                    onClick={() => changeQty(line, 0)}
                    aria-label={`Remove ${line.name} from tab`}
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                </motion.div>
              );
            })}
          </AnimatePresence>
          {!hasItems && (
            <p className="cart__empty" role="status">
              {billSent
                ? `${billSent}’s bill is at the front desk. Tap a category to start the next tab.`
                : 'No items yet — tap a category to start a tab.'}
            </p>
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
            <div className="cart__links">
              <button type="button" className="cart__discount" onClick={() => setChoosingDocket(true)}>
                Print docket
              </button>
              <button type="button" className="cart__discount" onClick={() => setDiscounting(true)}>
                {tab.discount ? 'Change tab discount' : 'Discount the tab'}
              </button>
            </div>
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
            {takesPayment ? (
              <>
                {partPaid ? 'Charge the rest' : 'Charge'} <Money value={partPaid ? dueNow : totals.total} />
              </>
            ) : (
              <>
                Send bill to front desk <Money value={partPaid ? dueNow : totals.total} />
              </>
            )}
          </Button>

          <p className="cart__charge-sub">
            {!hasItems
              ? 'Add an item to start charging'
              : takesPayment
                ? 'Or press Enter to take payment'
                : 'Payment is taken at the front desk · or press Enter'}
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
  const remaining = roundStock(item.stock - onTab);
  // Sold out once not even the smallest serving fits.
  const smallest = Math.min(1, ...(item.portions ?? []).map((p) => p.units));
  if (remaining + STOCK_SLACK < smallest) {
    return { note: onTab > 0 ? 'All on this tab' : 'Sold out', soldOut: true };
  }
  if (remaining <= (item.lowStockAt ?? lowDefault)) {
    return { note: `${remaining} left`, soldOut: false };
  }
  return { soldOut: false };
}
