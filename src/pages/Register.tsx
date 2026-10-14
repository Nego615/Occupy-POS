import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import './Register.css';
import { AddOnDialog } from '../components/AddOnDialog';
import { ApprovalDialog } from '../components/ApprovalDialog';
import { AssignTabDialog } from '../components/AssignTabDialog';
import { Button } from '../components/Button';
import { DocketDialog, LineDialog, PortionDialog, PriceDialog } from '../components/CounterDialogs';
import { PrintableDocket, type DocketKind } from '../components/PrintableSlip';
import { ItemTile } from '../components/ItemTile';
import { MealDialog } from '../components/MealDialog';
import { OpenTabsDialog } from '../components/OpenTabsDialog';
import { BigMoney, Money, Mono } from '../components/Mono';
import { Pill, PillRow } from '../components/Pill';
import { SummaryRow } from '../components/Receipt';
import { SearchField } from '../components/SearchField';
import { Stepper } from '../components/Stepper';
import {
  addOnOptions,
  categoryLineage,
  categoryPath,
  inCategory,
  lineContents,
  roundStock,
  STOCK_SLACK,
  stockFits,
  subCategories,
  topCategories,
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
import { sameDish } from '../data/kitchen';
import { paidAmount, type Order } from '../data/orders';
import {
  discountLabel,
  itemLine,
  itemQuantities,
  lineCap,
  lineDishes,
  round,
  unprintedLines,
  type CartLine,
} from '../lib/cart';
import { rowInOut, snap } from '../lib/motion';
import { orderNo, usePos } from '../lib/store';
import { useNow } from '../lib/useClock';

/**
 * The register's shelves: a catalog category, or the set meals. A category
 * with others inside it shows them all, with a row to narrow to just one.
 */
type Shelf = CategoryId | 'meals';

export function Register() {
  // Null until someone picks a shelf: the first category, else set meals.
  const [chosenShelf, setCategory] = useState<Shelf | null>(null);
  const [meal, setMeal] = useState<SetMeal | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [browsingTabs, setBrowsingTabs] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  // Something being taken off the tab that's waiting on a manager's PIN: a line
  // brought down to `qty`, or — with no `key` — the whole tab cleared.
  const [removal, setRemoval] = useState<{ action: string; key: string | null; qty: number } | null>(null);
  const [query, setQuery] = useState('');
  // The open-price item being priced, or 'custom' for a custom amount.
  const [pricing, setPricing] = useState<CatalogItem | 'custom' | null>(null);
  // The item whose serving — whole or a portion — is being picked.
  const [portioning, setPortioning] = useState<CatalogItem | null>(null);
  // The item whose sides and extras are being picked.
  const [addingTo, setAddingTo] = useState<CatalogItem | null>(null);
  const [editingLine, setEditingLine] = useState<string | null>(null);
  const [choosingDocket, setChoosingDocket] = useState(false);
  // Print docket was tapped on a tab with no table or room yet — it carries on once one's picked.
  const [printAfterAssign, setPrintAfterAssign] = useState(false);
  // The docket being printed — on the page only while the print dialog is up. It keeps
  // its own copy of the tab, so a bill sent to the counter still prints once it's gone.
  const [docket, setDocket] = useState<{ order: Order; kind: DocketKind } | null>(null);
  // The tab whose bill was just sent to the counter, for the note on the empty register.
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
    printDocket,
    openTab,
    can,
    promotions,
    setMeals,
    categories,
    locations,
    tabs,
    canSeeTab,
  } = usePos();

  // Prints once the docket is on the page, then takes it off again.
  useEffect(() => {
    if (!docket) return;
    window.print();
    setDocket(null);
  }, [docket]);
  // A shelf deleted on another screen falls back to the first one.
  const shelves = topCategories(categories);
  const category: Shelf =
    chosenShelf === 'meals' || categories.some((c) => c.id === chosenShelf)
      ? chosenShelf!
      : (shelves[0]?.id ?? 'meals');
  // The shelf picked and those it sits inside, outermost first — each with
  // categories inside it gets a row of its own to narrow down.
  const path = category === 'meals' ? [] : categoryLineage(categories, category).reverse();
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
          (q ? item.name.toLowerCase().includes(q) : inCategory(categories, item.category, category)),
      ),
    [catalog, categories, category, q],
  );
  const showMeals = searching || category === 'meals';
  const showItems = searching || category !== 'meals';

  const hasItems = cart.length > 0;
  const paid = paidAmount(tab.payments);
  const partPaid = tab.payments.length > 0;
  const dueNow = round(totals.total + (tab.tip ?? 0) - paid);

  // The current order: what's been added since the tab's last docket.
  const newCount = unprintedLines(cart, tab.printed).reduce((sum, l) => sum + l.qty, 0);
  const printedBefore = newCount < totals.itemCount;

  // How many tabs are running, this one included — the count beside "Open tabs".
  const openCount =
    tabs.filter((t) => t.orderId !== tab.orderId && t.cart.length > 0 && canSeeTab(t)).length + (hasItems ? 1 : 0);

  /** The stepper's ceiling: what's on hand, but never below what's already on the line. */
  function lineMax(line: CartLine): number {
    // Lines whose items were deleted from the catalog keep the stepper default.
    return Math.max(line.qty, Math.min(99, lineCap(cart, line.key, catalog)));
  }

  /** Kitchen items on the line still waiting to go, or null if it has none. */
  function lineUnsent(line: CartLine): number | null {
    const kitchen = lineDishes(line).filter((d) => isKitchenItem(d.itemId));
    if (kitchen.length === 0) return null;
    return Math.max(
      ...kitchen.map((d) => {
        // The kitchen counts a dish by its note and sides too, so match on them.
        const dish = { ...d, note: line.note, addOns: d.addOns.length > 0 ? d.addOns.map((a) => a.name) : undefined };
        return Math.min(line.qty, unsent.find((l) => sameDish(l, dish))?.qty ?? 0);
      }),
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

  // The register never takes payment or gives discounts — that's the counter's job.
  // It charges each tab to its table or room — a required pick, unless the shop
  // has none to pick from.
  const placed = tab.locationId !== null || locations.length === 0;

  /** Sends the tab's new kitchen items — once it has a table or room to send them for. */
  function send() {
    if (!placed) {
      setAssigning(true);
      return;
    }
    sendToKitchen();
  }

  // "Or press Enter" — wired, not decorative.
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

  /**
   * Prints the current order on its own. Once printed it joins the rest of the
   * tab, so the next docket starts fresh. A tab with no table or room is
   * placed first — onto a table that already has a tab, it merges in.
   */
  function startDocket() {
    if (!placed) {
      setPrintAfterAssign(true);
      setAssigning(true);
      return;
    }
    setChoosingDocket(true);
  }

  // Back from placing the tab for a docket: carry on to printing if it's placed now.
  useEffect(() => {
    if (assigning || !printAfterAssign) return;
    setPrintAfterAssign(false);
    if (placed && newCount > 0) setChoosingDocket(true);
  }, [assigning, printAfterAssign, placed, newCount]);

  /** Charges the open tab to its table or room, which sends its bill to the counter to be paid. */
  function charge() {
    if (!placed) {
      setAssigning(true);
      return;
    }
    // The current order's docket goes with the bill — up for printing straight
    // away, with only what's been added since the last docket.
    const order = printDocket();
    if (order) setDocket({ order, kind: 'bill' });
    requestBill();
    setBillSent(tab.name);
    // The bill waits at the counter; the register moves on to the next customer.
    openTab(null);
  }

  return (
    <div className="register__body">
      <main className="catalog">
        {/* Search and the category menus stay in view while the items scroll. */}
        <div className="catalog__head">
          <div className="catalog__toolbar">
            <SearchField value={query} onChange={setQuery} placeholder="Search items" label="Search items" />
            <Button variant="secondary" onClick={() => setPricing('custom')}>
              Custom amount
            </Button>
          </div>

          {!searching && (
          <PillRow label="Item categories" className="catalog__tabs">
            {shelves.map((c) => (
              <Pill key={c.id} active={c.id === path[0]} onClick={() => setCategory(c.id)}>
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

          {!searching &&
            path.map((id, depth) => {
              const subs = subCategories(categories, id);
              if (subs.length === 0) return null;
              return (
                <PillRow
                  key={id}
                  label={`Inside ${categoryPath(categories, id)}`}
                  className="catalog__tabs catalog__tabs--sub"
                >
                  <Pill active={category === id} onClick={() => setCategory(id)}>
                    All
                  </Pill>
                  {subs.map((c) => (
                    <Pill key={c.id} active={c.id === path[depth + 1]} onClick={() => setCategory(c.id)}>
                      {c.label}
                    </Pill>
                  ))}
                </PillRow>
              );
            })}
        </div>

        {running.length > 0 && (
          <div className="catalog__deals" role="status">
            {running.map((p) => (
              <span key={p.id} className="catalog__deal">
                <strong>{p.name}</strong> · {promoAmountLabel(p)}{' '}
                {scopeLabel(p, (id) => categoryPath(categories, id)).toLowerCase()}
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
                // Courses can be skipped, so the meal sells while any course has something left.
                const open = m.courses.map((c) =>
                  courseOptions(c, catalog).some(
                    (i) => i.available && stockFits(i, onTab.get(i.id) ?? 0),
                  ),
                );
                const any = open.some(Boolean);
                return (
                  <ItemTile
                    key={m.id}
                    name={m.name}
                    price={m.price}
                    color={m.color}
                    deal={`${m.courses.length} courses`}
                    note={open.every(Boolean) ? undefined : any ? 'A course is sold out' : 'Sold out'}
                    disabled={!any}
                    onClick={() => setMeal(m)}
                  />
                );
              })}
          {showItems &&
            visibleItems.map((item) => {
                const stock = tileStock(item, onTab.get(item.id) ?? 0, settings.lowStockDefault);
                const openPrice = item.openPrice && settings.openPriceEnabled;
                const promo = bestPromo(promotions, item, at, categories);
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
                    count={onTab.get(item.id) ?? 0}
                    onClick={() =>
                      openPrice
                        ? setPricing(item)
                        : addOnOptions(item, categories, catalog).length > 0
                          ? setAddingTo(item)
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
        <AddOnDialog item={addingTo} onClose={() => setAddingTo(null)} />
        <LineDialog lineKey={editingLine} onClose={() => setEditingLine(null)} />
        <DocketDialog
          open={choosingDocket}
          onPick={(kind) => {
            const order = printDocket();
            if (order) setDocket({ order, kind });
          }}
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
        <div className="cart__head">
          {/* Any open tab can be brought back onto the register to add to. */}
          <h2 className="cart__heading">
            <button
              type="button"
              className="cart__tabs"
              onClick={() => setBrowsingTabs(true)}
              aria-label={`Open tabs (${openCount}) — switch to one`}
            >
              Open tabs
              {openCount > 0 && <Mono className="cart__tab-count">{openCount}</Mono>}
              <span className="cart__tabs-caret" aria-hidden="true">
                ▾
              </span>
            </button>
          </h2>
          <button type="button" className="cart__new" onClick={() => openTab(null)}>
            <span aria-hidden="true">+</span> New tab
          </button>
        </div>

        <div className="tab-stack">
          <div className="tab-card tab-card--gold tab-card--front">
            <div className="tab-card__top">
              {/* Required: a tab starts with no table or room, and can't be charged
                  or sent to the kitchen until it has one. */}
              <button
                type="button"
                className={[
                  'tab-card__assign',
                  !placed && hasItems ? 'tab-card__assign--invalid' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => setAssigning(true)}
                aria-label={placed ? `${tab.name} — change table or room` : 'Assign a table or room (required)'}
                aria-invalid={!placed && hasItems ? true : undefined}
              >
                {placed ? (
                  <span className="tab-card__name">{tab.name}</span>
                ) : (
                  <span className="tab-card__name tab-card__placeholder" aria-hidden="true">
                    Assign table <span className="tab-card__required">*</span>
                  </span>
                )}
                <span className="tab-card__caret" aria-hidden="true">
                  ▾
                </span>
              </button>
              <span className="tab-chip tab-chip--dark">
                {tab.billRequestedAt ? (
                  'Bill at counter'
                ) : (
                  <>
                    <Mono>{totals.itemCount}</Mono> {totals.itemCount === 1 ? 'item' : 'items'}
                  </>
                )}
              </span>
            </div>
            <BigMoney value={partPaid ? dueNow : totals.total} className="tab-card__amount" />
            <div className="tab-card__meta">
              {/* A tab takes its order number with its first item. */}
              {orderNo(tab.orderId) ? (
                <span title={`Order ${orderNo(tab.orderId)}, opened ${tab.openedAt}`}>
                  {partPaid ? 'Still to pay, ' : ''}
                  <Mono>{orderNo(tab.orderId)}</Mono>, opened <Mono>{tab.openedAt}</Mono>
                </span>
              ) : (
                <span>New tab</span>
              )}
              {hasItems && !partPaid && (
                <button
                  type="button"
                  className={confirmingClear ? 'tab-card__clear tab-card__clear--confirm' : 'tab-card__clear'}
                  onClick={clear}
                  onBlur={() => setConfirmingClear(false)}
                >
                  {confirmingClear ? 'Confirm clear' : 'Clear tab'}
                </button>
              )}
            </div>
            {/* A short saying along the bottom edge, as on a kanga. */}
            <span className="tab-card__saying" aria-hidden="true">
              {SAYINGS[Math.abs(tab.orderId) % SAYINGS.length]}
            </span>
          </div>
        </div>

        <AssignTabDialog open={assigning} onClose={() => setAssigning(false)} />
        <OpenTabsDialog open={browsingTabs} onClose={() => setBrowsingTabs(false)} />

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
                    aria-label={`${line.name} — add a note`}
                  >
                    <div className="cart-line__name">{line.name}</div>
                    {line.note && <div className="cart-line__note">“{line.note}”</div>}
                    {(line.parts || line.addOns) && (
                      <div className="cart-line__parts">{lineContents(line).join(' · ')}</div>
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
                ? `${billSent}’s bill is at the counter. Tap a category to start the next tab.`
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

          {unsentCount > 0 && (
            <Button variant="accent" block className="cart__send" onClick={send}>
              <span>
                Send <Mono>{unsentCount}</Mono> to kitchen
              </span>
            </Button>
          )}

          {newCount > 0 && (
            <button type="button" className="cart__docket" onClick={startDocket}>
              {printedBefore ? (
                <>
                  Print docket · <Mono>{newCount}</Mono> new
                </>
              ) : (
                'Print docket'
              )}
            </button>
          )}

          <Button
            size="lg"
            block
            className="cart__charge"
            disabled={!hasItems}
            onClick={charge}
          >
            {tab.locationId !== null
              ? `Charge to ${tab.name}`
              : placed
                ? 'Send bill to counter'
                : 'Charge to a table or room'}{' '}
            <Money value={partPaid ? dueNow : totals.total} />
          </Button>

          <p className="cart__charge-sub">
            {!hasItems
              ? 'Add an item to start charging'
              : !placed
                ? 'Assign a table or room to charge or send to the kitchen'
                : 'Paid and discounted at the counter · or press Enter'}
          </p>
        </div>
      </aside>
    </div>
  );
}

/**
 * The saying along the bottom of each tab card, as on a kanga. Decorative only —
 * never an instruction — and picked by order number so a tab keeps its own.
 */
const SAYINGS = ['Karibu tena', 'Tuko pamoja', 'Pole pole ndio mwendo', 'Asante kwa kuja'];

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
  if (item.untracked) return { soldOut: false };
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
