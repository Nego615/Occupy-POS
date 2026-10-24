import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode, SetStateAction } from 'react';
import {
  CATALOG,
  CATEGORIES,
  categoryLineage,
  inAnyCategory,
  stockFits,
  titleCase,
  withTitleCaseNames,
  withUsedCategories,
  type AddOn,
  type AddOnPick,
  type CatalogItem,
  type Category,
  type CategoryId,
  type Portion,
} from '../data/catalog';
import type { Product } from '../data/products';
import { DEFAULT_SETTINGS, exchangeRate, withSwitchCurrencies, type Settings } from '../data/settings';
import type { Expense } from '../data/expenses';
import { expectedCash, expectedLocalCash, shiftStart, shiftTotals, type CashUp } from '../data/cashup';
import {
  PROMOTIONS,
  SET_MEALS,
  bestPromo,
  type Promotion,
  type SetMeal,
} from '../data/deals';
import {
  LOCATIONS,
  locationName,
  makeLocation,
  type Location,
  type LocationKind,
} from '../data/locations';
import {
  addSent,
  seedTickets,
  startTicket,
  takeVoids,
  ticketLines,
  unsentLines,
  unstartTicket,
  type KitchenTicket,
  type SentLine,
} from '../data/kitchen';
import {
  ORDERS,
  hydrateOrder,
  orderItems,
  orderTotal,
  paidAmount,
  refundValue,
  refundedQty,
  type Order,
  type OrderLine,
  type LocalCash,
  type OrderDeletion,
  type OrderEdit,
  type OrderRecord,
  type Payment,
  type Refund,
} from '../data/orders';
import {
  editBlocker,
  editProblem,
  hasLocalCash,
  heldItems,
  snapshot as orderSnapshot,
  stockDelta,
  withLines,
} from './orderEdits';
import {
  STAFF,
  hashPin,
  hasPermission,
  hasRole,
  hydrateShift,
  isPin,
  minutesNow,
  pinMatches,
  uniquePin,
  type Permission,
  type Shift,
  type ShiftRecord,
  type StaffMember,
} from '../data/staff';
import { isoDate } from '../data/history';
import { todayIso } from '../data/inventory';
import {
  addLine,
  computeTotals,
  customLine,
  discountLabel,
  itemQuantities,
  lineCap,
  lineFits,
  lineItems,
  mealLine,
  addPrinted,
  allPrinted,
  mergeLines,
  openPriceLine,
  portionLine,
  round,
  editLine as withLineEdit,
  setLineQty,
  trimPrinted,
  unprintedLines,
  withAddOns,
  type CartLine,
  type CartTotals,
  type CourseAddOn,
  type ManualDiscount,
  type Printed,
} from './cart';
import { salaried, type PayrollRun } from './payroll';
import { costDue, currencyOf, setActiveCurrency, setCostCurrency, type CurrencyCode } from './currency';
import { convertMenu, convertTab, readOrder, stampRate, switchBlockers } from './currencySwitch';
import { useBusiness } from './business';
import type { PosRepository, Snapshot } from './persist';
import { useInventory, type InventoryStore } from './useInventory';
import { restored, useNextId, usePersist, useRemote } from './usePersist';
import { formatTime } from './useClock';

/** A tab as the store keeps it. Its name isn't stored — it follows the location. */
type StoredTab = {
  orderId: number;
  /** The table or room the tab is assigned to; null for a walk-in. */
  locationId: string | null;
  /** Picked as a walk-in on purpose, so it can be charged without a table or room. */
  walkIn?: true;
  /** ISO timestamp. */
  openedIso: string;
  /** Staff id of whoever opened it — set by the first person to ring anything up on it. */
  openedBy?: string;
  cart: CartLine[];
  /** Lines already on a printed docket. Whatever's on the cart beyond this is the current order. */
  printed?: Printed;
  /** Kitchen items already sent. Whatever's on the cart beyond this is waiting to be sent. */
  sent: SentLine[];
  /** Taken off the whole tab by hand, before tax. */
  discount?: ManualDiscount;
  /**
   * Payments taken so far on a split bill. Kept on the tab so a half-paid
   * bill survives leaving the tender screen or a reload.
   */
  payments: Payment[];
  /** Fixed once the first payment is in, so later payments split the same total. */
  tip?: number;
  /** ISO timestamp the bill was sent to the counter to be paid. */
  billRequestedAt?: string;
  /** Items taken off it from Orders by a manager — joins the order's edit log when it closes. */
  edits?: OrderEdit[];
};

export type OpenTab = StoredTab & {
  /** Tab name — "Table 4", "Walk-in". Renaming the location renames the tab. */
  name: string;
  /** Display time it was opened — "4:41 PM". */
  openedAt: string;
};

/**
 * A change to a closed order. `payments` replaces them all (left out, they stay
 * as they were); `servedBy` set to '' clears it.
 */
export type OrderChange = {
  lines: OrderLine[];
  payments?: Payment[];
  servedBy?: string;
  /** What changed and why — kept with the order. */
  note: string;
};

/** What a refund covers. Leaving out `lines` refunds everything not yet refunded. */
export type RefundRequest = {
  lines?: { index: number; qty: number }[];
  reason: string;
  /** Puts the refunded items back on the shelf through the ledger. */
  restock: boolean;
};

/** Today at `hour`:`minute`, as an ISO timestamp. */
function todayAt(hour: number, minute: number): string {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

/** Tabs already running when the register first opens, matching the mockups. */
const INITIAL_TABS = (): StoredTab[] => [
  {
    orderId: 1045,
    locationId: 't2',
    openedIso: todayAt(16, 41),
    cart: [
      { key: 'cold-brew', itemId: 'cold-brew', name: 'Cold Brew', unitPrice: 6_000, qty: 1 },
      { key: 'turkey-club', itemId: 'turkey-club', name: 'Turkey Club', unitPrice: 15_000, qty: 1 },
    ],
    // Its seed ticket is already on the kitchen screen.
    sent: [{ itemId: 'turkey-club', name: 'Turkey Club', qty: 1 }],
    payments: [],
  },
  {
    orderId: 1046,
    locationId: 't4',
    openedIso: todayAt(15, 58),
    cart: [
      { key: 'oat-latte', itemId: 'oat-latte', name: 'Oat Latte', unitPrice: 6_500, qty: 2 },
      { key: 'cortado', itemId: 'cortado', name: 'Cortado', unitPrice: 5_500, qty: 1 },
      { key: 'espresso', itemId: 'espresso', name: 'Espresso Shot', unitPrice: 3_500, qty: 1 },
    ],
    sent: [],
    payments: [],
  },
];

type PosStore = {
  /** The item catalog. Edits from the item editor land here. */
  catalog: CatalogItem[];
  updateItem: (id: string, patch: Partial<CatalogItem>) => void;
  /** Adds an item to the catalog and returns it with its new id. */
  createItem: (item: Omit<CatalogItem, 'id'>) => CatalogItem;
  /** The categories items are sorted into, in the order the register shows them. */
  categories: Category[];
  /** Adds a category at the end of the list — inside `parentId` when given — and returns it. */
  createCategory: (label: string, parentId?: CategoryId) => Category;
  renameCategory: (id: string, label: string) => void;
  /**
   * Moves a category inside `parentId`, or to the top level for null.
   * Refused (false) when that would put it inside itself.
   */
  moveCategory: (id: string, parentId: CategoryId | null) => boolean;
  /** Sets the sides and extras offered with every item in a category. */
  setCategoryAddOns: (id: string, addOns: AddOn[]) => void;
  /**
   * Removes a category, and drops it from promotions and kitchen routing.
   * Refused (false) while any item or category is still in it.
   */
  deleteCategory: (id: string) => boolean;
  /** Removes an item from the catalog. Tabs already holding it keep their lines. */
  deleteItem: (id: string) => void;
  /** Products sold in sizes or colours. Their variants are catalog items carrying the product's id. */
  products: Product[];
  /** Adds a product, or replaces the one with its id. Its variants are saved as items, separately. */
  saveProduct: (product: Omit<Product, 'id'> & { id?: string }) => Product;
  /** Removes a product and every variant of it. */
  deleteProduct: (id: string) => void;
  /** The tables and rooms tabs can be assigned to. */
  locations: Location[];
  /** Adds a table or room with a default name, and returns it. */
  addLocation: (kind: LocationKind) => Location;
  updateLocation: (id: string, patch: Partial<Omit<Location, 'id'>>) => void;
  /** Removes a location. Refused while a tab is open there. */
  removeLocation: (id: string) => boolean;
  /** Every tab still open, across all tables, rooms, and walk-ins. */
  tabs: OpenTab[];
  /** The tab currently on the register. */
  tab: OpenTab;
  cart: CartLine[];
  totals: CartTotals;
  /** Open tabs (as occupied orders) followed by closed ones, newest first. */
  orders: Order[];
  /**
   * Rings up one of `item` — or one `portion` of it — at its promotion price
   * if one's running now, with any `addOns` at their add-on prices. Refused
   * (false) if it or an add-on isn't on hand.
   */
  addItem: (item: CatalogItem, portion?: Portion, addOns?: AddOnPick[]) => boolean;
  /** Rings up one of an open-price item at the price typed in. */
  addOpenPriceItem: (item: CatalogItem, price: number) => void;
  /** Rings up a one-off amount that isn't in the catalog. */
  addCustomAmount: (name: string, price: number) => void;
  /**
   * Rings up one set meal made of `picks`, one entry per course — a pick,
   * several, or null for a course the guest skipped — with each course's
   * `addOns`, shaped like its picks (see `mealLine`). Refused if nothing's
   * picked, or the picks or add-ons aren't on hand.
   */
  addMeal: (
    meal: SetMeal,
    picks: (CatalogItem | CatalogItem[] | null)[],
    addOns?: (CourseAddOn[] | CourseAddOn[][])[],
  ) => boolean;
  /** `key` is the cart line's. */
  setQty: (key: string, qty: number) => void;
  /** Sets a line's note (blank clears it) and manual discount (null takes it off). */
  editLine: (key: string, note: string, discount: ManualDiscount | null) => void;
  /** Takes a discount off the whole tab; null takes it off. */
  setTabDiscount: (discount: ManualDiscount | null) => void;
  /** Automatic discounts — happy hour and the like. */
  promotions: Promotion[];
  savePromotion: (promo: Promotion) => void;
  /** Adds a promotion with a fresh id, and returns it. */
  createPromotion: (promo: Omit<Promotion, 'id'>) => Promotion;
  deletePromotion: (id: string) => void;
  /** Full meals sold at one price. */
  setMeals: SetMeal[];
  saveSetMeal: (meal: SetMeal) => void;
  /** Adds a set meal with a fresh id, and returns it. */
  createSetMeal: (meal: Omit<SetMeal, 'id'>) => SetMeal;
  /** Tabs already holding the meal keep their lines. */
  deleteSetMeal: (id: string) => void;
  /** Empties the register's tab. Refused once part of it has been paid. */
  clearTab: () => boolean;
  /**
   * Deletes any open tab outright, with `reason` — an admin's call (`editOrders`).
   * It's kept as a deleted order for the record. Returns why it was refused —
   * a part-paid tab, say — or null once it's gone.
   */
  deleteTab: (orderId: number, reason: string) => string | null;
  /**
   * Takes items off any open tab — `qty` is what each line (by key) comes
   * down to, 0 to drop it — with `reason`. An admin's call (`editOrders`),
   * for tabs the register no longer lets anyone change. Sent kitchen items
   * are voided. Only lowers: adding stays on the register. Returns why it
   * was refused, or null once done.
   */
  removeFromTab: (orderId: number, qty: Record<string, number>, reason: string) => string | null;
  /**
   * Puts a location's tab on the register — its open tab if it has one,
   * otherwise a fresh one. `null` starts a new walk-in.
   */
  openTab: (locationId: string | null) => void;
  /** Puts an existing open tab on the register. Refused for a tab the signed-in person can't see. */
  switchTab: (orderId: number) => void;
  /**
   * Whether the signed-in person sees `tab`: their own, one nobody has
   * claimed yet, or any tab at all with `allTabs`. Servers see only theirs.
   */
  canSeeTab: (tab: Pick<OpenTab, 'openedBy'>) => boolean;
  /**
   * Moves the register's tab to a table or room (or back to walk-in).
   * A location holds one tab at a time, so an occupied one is refused.
   */
  assignTab: (locationId: string | null) => boolean;
  /**
   * Folds the register's tab into another open tab — its items join that
   * tab's, it closes, and the other tab takes over the register. Refused
   * when either tab is part-paid.
   */
  mergeTab: (targetOrderId: number) => boolean;
  /**
   * Takes one payment toward the register's tab. `tip` is fixed by the first
   * payment. Once payments cover the total the tab closes as a paid order
   * and a fresh walk-in takes the register. Returns the closed order's id,
   * or null while there's still a balance.
   */
  takePayment: (payment: Payment, tip: number) => number | null;
  /** Takes back a payment from a part-paid tab — a mistake, or a card that bounced. */
  removePayment: (index: number) => void;
  /** Sends the register's tab to the counter to be paid. */
  requestBill: () => void;
  /**
   * The current order on the register's tab — what's been added since its
   * last docket — as an order to print, and marks it printed so it joins the
   * rest of the tab. Null when nothing's new.
   */
  printDocket: () => Order | null;
  /**
   * Closes an open tab onto a room's bill, to be paid when the room settles
   * up. Refused for an empty or part-paid tab, or a location that isn't a room.
   */
  chargeToRoom: (orderId: number, roomId: string) => boolean;
  /**
   * Pays off everything charged to a room in one payment (`amount` is worked
   * out per bill). Cash in the cost currency gives `local` its currency and
   * rate; each bill's share is worked out in it too. Returns how much was
   * settled; 0 if nothing was owed.
   */
  settleRoom: (
    roomId: string,
    payment: Pick<Payment, 'method' | 'ref'> & { local?: Pick<LocalCash, 'currency' | 'rate'> },
  ) => number;
  /** Closed counter shifts, newest first. */
  cashUps: CashUp[];
  /** Closes the current shift with the drawer count, and starts the next. */
  /**
   * `local` counts the drawer of cash taken in the cost currency, when the shop takes it.
   * `stock` is what was counted on the shelf, by item id — posted as a stock count before it closes.
   */
  closeShift: (count: {
    float: number;
    countedCash: number;
    note?: string;
    local?: { float: number; counted: number };
    stock?: Record<string, number>;
  }) => CashUp;
  /** Whether `itemId` is made in the kitchen, per Settings' kitchen categories. */
  isKitchenItem: (itemId: string) => boolean;
  /** Kitchen items on the register's tab the kitchen hasn't been sent yet. */
  unsent: SentLine[];
  /**
   * Sends the register's unsent kitchen items as a ticket. Paying a tab sends
   * anything left over too, and taking a sent item off a tab voids it at once.
   */
  sendToKitchen: () => void;
  /** Every kitchen ticket, oldest first — up on the screen and already bumped. */
  kitchenTickets: KitchenTicket[];
  /** Clears a ticket off the kitchen screen. */
  bumpTicket: (ticketId: number) => void;
  /** Puts a bumped ticket back up. */
  recallTicket: (ticketId: number) => void;
  /** Crosses a line off a ticket, or back on. Crossing one off starts the ticket. */
  toggleTicketLine: (ticketId: number, lineIndex: number) => void;
  /** Marks a ticket as being worked on — or, tapped again, not started after all. */
  toggleTicketStarted: (ticketId: number) => void;
  /**
   * Refunds some or all of a paid order. `byStaffId` is who issued or
   * approved it. Refunding the last of it marks the whole order refunded.
   */
  refundOrder: (orderId: number, byStaffId: string, request: RefundRequest) => void;
  /**
   * Changes a closed order — its lines, payments, or who served it — and
   * moves stock for the difference. Returns why it was refused, or null once saved.
   */
  editOrder: (orderId: number, change: OrderChange) => string | null;
  /**
   * Takes a closed order out of sales, reports, and cash-ups, optionally
   * putting what's left of its items back in stock. It can be restored.
   */
  deleteOrder: (orderId: number, request: { reason: string; restock: boolean }) => string | null;
  /** Brings a deleted order back, drawing down again any stock its deletion put back. */
  restoreOrder: (orderId: number) => void;
  /** Deleted orders, newest first. */
  deletedOrders: Order[];
  /** Who's signed in. Null before sign-in, or once their account is deactivated. */
  me: StaffMember | null;
  /** Signs in by PIN. Returns who signed in, or null for a wrong or inactive PIN. */
  signIn: (pin: string) => StaffMember | null;
  signOut: () => void;
  /** Whether the signed-in person's role grants `permission`. */
  can: (permission: Permission) => boolean;
  /**
   * Whether the signed-in person can add and edit items in `category`: any,
   * for the whole menu; the kitchen's categories, for the kitchen.
   */
  canEditCategory: (category: CategoryId) => boolean;
  /**
   * Checks someone else's PIN for a one-off approval — a manager okaying a
   * refund. Returns them if they're active and hold `permission`.
   */
  approve: (pin: string, permission: Permission) => StaffMember | null;
  /** Pay periods marked as paid, newest first. */
  payrollRuns: PayrollRun[];
  /** Records a paid month. Refused if that month was already recorded. */
  recordPayrollRun: (run: Omit<PayrollRun, 'id'>) => boolean;
  /** Running costs that aren't stock or wages, newest first. */
  expenses: Expense[];
  addExpense: (expense: Omit<Expense, 'id'>) => Expense;
  updateExpense: (id: string, patch: Partial<Omit<Expense, 'id'>>) => void;
  deleteExpense: (id: string) => void;
  /** Business-wide settings. */
  settings: Settings;
  updateSettings: (next: Settings) => void;
  /**
   * Starts selling in `to` at `rate` of today's currency to one of it, and
   * buying in today's: menu prices and item costs are converted (prices to
   * `step`), and everything bought or paid out stays as it was. Refused —
   * with what's in the way — while anything is open; else the new settings.
   */
  switchSalesCurrency: (to: CurrencyCode, rate: number, step?: number) => { blockers: string[] } | { settings: Settings };
  /** Everyone on the team, active or not. Deleted people are left out. */
  staff: StaffMember[];
  /** Everyone ever on the team, deleted people included — for names on old orders. */
  allStaff: StaffMember[];
  /** Adds a staff member with a fresh PIN. The PIN is returned once and never stored in the clear. */
  addStaff: (member: Omit<StaffMember, 'id' | 'pinHash'>) => { member: StaffMember; pin: string };
  updateStaff: (id: string, patch: Partial<Omit<StaffMember, 'id' | 'pinHash'>>) => void;
  /** Sets a PIN chosen by an admin. Returns why it was refused, or null once it's set. */
  setPin: (id: string, pin: string) => string | null;
  /**
   * Removes someone from the team. Their past orders keep their
   * name. Refused for whoever is signed in and for the last active owner.
   */
  deleteStaff: (id: string) => boolean;
  /** Every shift on record, newest first. */
  shifts: Shift[];
  /** Starts a shift now. Refused if they're inactive or already on the clock. */
  clockIn: (staffId: string) => boolean;
  /** Ends their open shift now, if they have one. */
  clockOut: (staffId: string) => void;
  /** Manager correction — times, break, or a missed clock-out. */
  updateShift: (id: string, patch: Partial<Omit<ShiftRecord, 'id' | 'staffId' | 'date'>>) => void;
  removeShift: (id: string) => void;
  /** Wipes everything saved and starts again from the new-shop setup. */
  resetAllData: () => Promise<void>;
} & InventoryStore;

const PosContext = createContext<PosStore | null>(null);

/**
 * An empty walk-in tab carries nothing worth keeping, so it's dropped as soon
 * as the register moves off it. Empty tabs on a table stay — someone's seated.
 */
function pruneIdle(tabs: StoredTab[], keepOrderId: number): StoredTab[] {
  return tabs.filter(
    (t) => t.orderId === keepOrderId || t.locationId !== null || t.cart.length > 0,
  );
}

/**
 * What a brand-new shop starts from: its owner and settings, and every other
 * slice saved empty so none of the demo data is seeded. Includes the
 * inventory slices that useInventory restores.
 */
export function newShopSnapshot(
  owner: { name: string; pin: string },
  settings: Partial<Settings>,
): Snapshot {
  const first = freshTab(draftId(), null);
  const id = `staff-${Date.now().toString(36)}`;
  const member: StaffMember = { id, name: owner.name, role: 'owner', pinHash: hashPin(id, owner.pin), active: true };
  return {
    tabs: [first],
    activeTab: first.orderId,
    orders: [],
    catalog: [],
    products: [],
    categories: [],
    locations: [],
    promotions: [],
    setMeals: [],
    staff: [member],
    payrollRuns: [],
    expenses: [],
    shifts: [],
    settings,
    kitchenTickets: [],
    cashUps: [],
    movements: [],
    suppliers: [],
    purchaseOrders: [],
    bills: [],
    countDraft: null,
    stockCounts: [],
  };
}

/** Stands in for the active tab for the one render before a fresh one replaces it. */
function placeholderTab(orderId: number): OpenTab {
  return { ...freshTab(orderId, null), name: 'Walk-in', openedAt: '' };
}

let lastDraftId = 0;

/**
 * An id for a tab with nothing on it yet. Order numbers count only tabs with
 * a bill, so an empty tab holds this negative stand-in and takes the next
 * order number with its first item. Time-based, so two tills don't clash.
 */
function draftId(): number {
  lastDraftId = Math.min(lastDraftId - 1, -Date.now());
  return lastDraftId;
}

/** Whether `orderId` is an empty tab's stand-in rather than an order number. */
export function isDraftId(orderId: number): boolean {
  return orderId < 0;
}

/** "#42" for a numbered tab; null for an empty one, which has no number yet. */
export function orderNo(orderId: number): string | null {
  return isDraftId(orderId) ? null : `#${orderId}`;
}

function freshTab(orderId: number, locationId: string | null, openedBy?: string): StoredTab {
  return {
    orderId,
    locationId,
    openedIso: new Date().toISOString(),
    ...(openedBy ? { openedBy } : {}),
    cart: [],
    sent: [],
    payments: [],
  };
}

/**
 * A tab's lines as an order records them. Given the catalog, each line also
 * freezes its unit cost (a set meal's picks added up), for margins; a line
 * with any uncosted item gets none.
 */
function toOrderLines(cart: CartLine[], catalog?: CatalogItem[]): OrderLine[] {
  const costOf = (itemId: string) => catalog?.find((i) => i.id === itemId)?.cost;
  return cart.map((l) => {
    const parts = lineItems(l);
    const costs = parts.map((p) => costOf(p.itemId));
    const unitCost = costs.every((c) => c !== undefined)
      ? round(costs.reduce((sum: number, c, i) => sum + c! * parts[i].units, 0))
      : undefined;
    return {
      itemId: l.itemId,
      name: l.name,
      qty: l.qty,
      unitPrice: l.unitPrice,
      ...(l.listPrice !== undefined ? { listPrice: l.listPrice } : {}),
      ...(l.promo ? { promo: l.promo } : {}),
      ...(l.parts
        ? { parts: l.parts.map((p) => p.name), partIds: l.parts.map((p) => p.itemId) }
        : {}),
      ...(l.note ? { note: l.note } : {}),
      ...(l.units !== undefined ? { units: l.units } : {}),
      ...(l.pours ? { pours: l.pours } : {}),
      ...(l.addOns ? { addOns: l.addOns } : {}),
      ...(catalog && unitCost !== undefined ? { unitCost } : {}),
    };
  });
}

/** A readable id from a name, unique among `taken` — "happy-hour-2". */
function slugId(name: string, fallback: string, taken: Set<string>): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || fallback;
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

/** One bill's share of cash taken in the cost currency, with its change already handed back. */
function localShare(local: Pick<LocalCash, 'currency' | 'rate'>, amount: number): LocalCash {
  const due = costDue(amount, local.rate);
  return { ...local, amount: due, tendered: due };
}

function tabAsOrder(tab: OpenTab, taxRate: number): Order {
  const totals = computeTotals(tab.cart, taxRate, tab.discount);
  return hydrateOrder({
    id: tab.orderId,
    name: tab.name,
    locationId: tab.locationId ?? undefined,
    status: 'occupied',
    at: tab.openedIso,
    ...(tab.openedBy ? { servedBy: tab.openedBy } : {}),
    lines: toOrderLines(tab.cart),
    ...(totals.orderDiscount > 0 && tab.discount
      ? { discount: totals.orderDiscount, discountLabel: discountLabel(tab.discount) }
      : {}),
    tax: totals.tax,
    tip: 0,
    payments: tab.payments,
    ...(tab.edits?.length ? { edits: tab.edits } : {}),
  });
}

/** Today's date, refreshed at midnight so "today" filters roll over on a register left running. */
function useToday(): string {
  const [today, setToday] = useState(() => isoDate(new Date()));
  useEffect(() => {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const timer = setTimeout(() => setToday(isoDate(new Date())), midnight.getTime() - now.getTime() + 1000);
    return () => clearTimeout(timer);
  }, [today]);
  return today;
}

/**
 * Single source of truth for the counter flow. State is restored from
 * `snapshot` and written back through `repo` as it changes — a server-backed
 * repository can replace the on-device one without this shape changing.
 */
export function PosProvider({
  children,
  repo,
  snapshot,
}: {
  children: ReactNode;
  repo: PosRepository;
  snapshot: Snapshot;
}) {
  const { retail } = useBusiness();
  const [storedTabs, setTabs] = useState<StoredTab[]>(() => restored(snapshot, 'tabs', INITIAL_TABS));
  const [activeId, setActiveId] = useState<number>(() => restored(snapshot, 'activeTab', 1046));
  const [closedRecords, setClosedOrders] = useState<OrderRecord[]>(() =>
    restored(snapshot, 'orders', ORDERS),
  );
  // Names are title-cased however they arrive — saved before, typed in, or synced.
  const [catalog, setCatalog] = useState<CatalogItem[]>(() =>
    withTitleCaseNames(restored(snapshot, 'catalog', CATALOG)),
  );
  const setSyncedCatalog = useCallback(
    (action: SetStateAction<CatalogItem[]>) =>
      setCatalog((prev) => withTitleCaseNames(typeof action === 'function' ? action(prev) : action)),
    [],
  );
  const [products, setProducts] = useState<Product[]>(() => restored(snapshot, 'products', []));
  const [categories, setCategories] = useState<Category[]>(() =>
    withUsedCategories(restored(snapshot, 'categories', CATEGORIES), catalog),
  );
  const [locations, setLocations] = useState<Location[]>(() =>
    restored(snapshot, 'locations', LOCATIONS),
  );
  const [promotions, setPromotions] = useState<Promotion[]>(() =>
    restored(snapshot, 'promotions', PROMOTIONS),
  );
  const [setMeals, setSetMeals] = useState<SetMeal[]>(() => restored(snapshot, 'setMeals', SET_MEALS));
  const [staff, setRawStaff] = useState<StaffMember[]>(() => salaried(restored(snapshot, 'staff', STAFF)));
  // Staff from before everyone was salaried — saved here, or sent by another screen — are converted as they arrive.
  const setStaff = useCallback(
    (next: SetStateAction<StaffMember[]>) =>
      setRawStaff((prev) => salaried(typeof next === 'function' ? next(prev) : next)),
    [],
  );
  const [signedInId, setSignedInId] = useState<string | null>(null);
  const [payrollRuns, setPayrollRuns] = useState<PayrollRun[]>(() =>
    restored(snapshot, 'payrollRuns', []),
  );
  // Never seeded: a shop saved before expenses existed has none, not the demo's.
  const [expenses, setExpenses] = useState<Expense[]>(() => restored(snapshot, 'expenses', []));
  const [shiftRecords, setShifts] = useState<ShiftRecord[]>(() => restored(snapshot, 'shifts', []));
  const [settings, setSettings] = useState<Settings>(() =>
    withSwitchCurrencies({
      ...DEFAULT_SETTINGS,
      ...restored<Partial<Settings>>(snapshot, 'settings', {}),
    }),
  );
  // Set during render, ahead of every child, so formatters never lag a switch.
  setActiveCurrency(settings.currency);
  setCostCurrency(exchangeRate(settings) ? settings.costCurrency! : null);
  // Today's rate, stamped on whatever's bought or paid out in the cost currency.
  const rate = exchangeRate(settings);
  const [cashUps, setCashUps] = useState<CashUp[]>(() => restored(snapshot, 'cashUps', []));
  const [kitchenTickets, setKitchenTickets] = useState<KitchenTicket[]>(() =>
    restored(snapshot, 'kitchenTickets', () => seedTickets().sort((a, b) => a.sentAt - b.sentAt)),
  );
  // Order and ticket numbers carry on from the highest saved — shared with
  // the other screens when synced, so two tills never hand out the same one.
  const nextOrderId = useNextId(
    repo,
    'order',
    Math.max(0, ...storedTabs.map((t) => t.orderId), ...closedRecords.map((o) => o.id)) + 1,
  );
  const nextTicketId = useNextId(repo, 'ticket', Math.max(0, ...kitchenTickets.map((k) => k.id)) + 1);

  usePersist(repo, 'tabs', storedTabs);
  usePersist(repo, 'activeTab', activeId);
  usePersist(repo, 'orders', closedRecords);
  usePersist(repo, 'catalog', catalog);
  usePersist(repo, 'products', products);
  usePersist(repo, 'categories', categories);
  usePersist(repo, 'locations', locations);
  usePersist(repo, 'promotions', promotions);
  usePersist(repo, 'setMeals', setMeals);
  usePersist(repo, 'staff', staff);
  usePersist(repo, 'payrollRuns', payrollRuns);
  usePersist(repo, 'expenses', expenses);
  usePersist(repo, 'shifts', shiftRecords);
  usePersist(repo, 'settings', settings);
  usePersist(repo, 'kitchenTickets', kitchenTickets);
  usePersist(repo, 'cashUps', cashUps);

  // Changes from the other screens signed in to this shop.
  useRemote(repo, 'tabs', setTabs);
  useRemote(repo, 'orders', setClosedOrders);
  useRemote(repo, 'catalog', setSyncedCatalog);
  useRemote(repo, 'products', setProducts);
  useRemote(repo, 'categories', setCategories);
  useRemote(repo, 'locations', setLocations);
  useRemote(repo, 'promotions', setPromotions);
  useRemote(repo, 'setMeals', setSetMeals);
  useRemote(repo, 'staff', setStaff);
  useRemote(repo, 'payrollRuns', setPayrollRuns);
  useRemote(repo, 'expenses', setExpenses);
  useRemote(repo, 'shifts', setShifts);
  // Settings from another device get the same repair as saved ones.
  const setRemoteSettings = useCallback(
    (action: SetStateAction<Settings>) =>
      setSettings((prev) => withSwitchCurrencies(typeof action === 'function' ? action(prev) : action)),
    [],
  );
  useRemote(repo, 'settings', setRemoteSettings);
  useRemote(repo, 'kitchenTickets', setKitchenTickets);
  useRemote(repo, 'cashUps', setCashUps);

  // The tab on this register was closed or paid on another screen: start a
  // fresh walk-in rather than jumping to someone else's tab.
  useEffect(() => {
    if (storedTabs.some((t) => t.orderId === activeId)) return;
    const fresh = freshTab(draftId(), null);
    setTabs((prev) => [...prev, fresh]);
    setActiveId(fresh.orderId);
  }, [storedTabs, activeId, nextOrderId]);

  // Day counts ("today", "3 days ago") are worked out from saved dates, and
  // re-worked when the date rolls over.
  const today = useToday();
  const shifts = useMemo(
    () => shiftRecords.map(hydrateShift),
    // `today` is a dependency so day counts are redone at midnight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shiftRecords, today],
  );
  // Orders from before a switch of sales currency are read back converted.
  const readOrders = useMemo(
    () => closedRecords.map((r) => readOrder(r, settings.currencySwitch, currencyOf(settings.currency))),
    // `today` is a dependency so day counts are redone at midnight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [closedRecords, today, settings.currencySwitch, settings.currency],
  );
  // Deleted orders leave sales, reports, room bills, and cash-ups; they're
  // kept apart so they can be looked up or restored.
  const closedOrders = useMemo(() => readOrders.filter((o) => !o.deleted), [readOrders]);
  const deletedOrders = useMemo(() => readOrders.filter((o) => o.deleted), [readOrders]);
  const liveRecords = useMemo(() => closedRecords.filter((o) => !o.deleted), [closedRecords]);

  // Derived each render, so a role change or deactivation applies at once —
  // a deactivated account drops straight back to the sign-in screen.
  const me = useMemo(
    () => staff.find((m) => m.id === signedInId && m.active) ?? null,
    [staff, signedInId],
  );

  const canSeeTab = useCallback(
    (t: Pick<StoredTab, 'openedBy'>) =>
      !t.openedBy || t.openedBy === me?.id || hasPermission(me, 'allTabs', settings),
    [me, settings],
  );

  // Someone who can't see the register's tab (a server signing in after
  // another) gets a fresh walk-in of their own instead.
  useEffect(() => {
    if (!me) return;
    const active = storedTabs.find((t) => t.orderId === activeId);
    if (!active || canSeeTab(active)) return;
    const fresh = freshTab(draftId(), null, me.id);
    setTabs((prev) => [...pruneIdle(prev, fresh.orderId), fresh]);
    setActiveId(fresh.orderId);
  }, [me, storedTabs, activeId, canSeeTab, nextOrderId]);

  // Suppliers, purchases, bills, and the stock ledger. Stock moves only through it.
  const inventory = useInventory(catalog, setCatalog, me, repo, snapshot);
  const { logStock, logNewItem } = inventory;

  const tabs = useMemo<OpenTab[]>(
    () =>
      storedTabs.map((t) => ({
        ...t,
        name: locationName(locations, t.locationId),
        openedAt: formatTime(new Date(t.openedIso)),
      })),
    [storedTabs, locations],
  );

  // There is always an active tab; fall back defensively rather than crash.
  const tab = tabs.find((t) => t.orderId === activeId) ?? tabs[0] ?? placeholderTab(activeId);
  const cart = tab.cart;
  const totals = useMemo(
    () => computeTotals(cart, settings.taxRate, tab.discount),
    [cart, settings.taxRate, tab.discount],
  );

  const orders = useMemo(
    () => [
      ...tabs
        .filter((t) => t.cart.length > 0 || (t.locationId && !isDraftId(t.orderId)))
        .map((t) => tabAsOrder(t, settings.taxRate))
        .reverse(),
      ...closedOrders,
    ],
    [tabs, closedOrders, settings.taxRate],
  );

  // Empty tabs numbered since the last render, so a second update in the same
  // tick still finds the tab under its new number.
  const numbered = useRef(new Map<number, number>());

  const updateActiveTab = useCallback(
    (update: (tab: StoredTab) => StoredTab) => {
      // Whoever first puts something on an unclaimed tab owns it.
      const claim = (t: StoredTab) => (t.openedBy || !me ? t : { ...t, openedBy: me.id });
      const id = numbered.current.get(activeId) ?? activeId;
      // An empty tab takes the next order number with its first item.
      const current = storedTabs.find((t) => t.orderId === id);
      const number =
        isDraftId(id) && current && update(claim(current)).cart.length > 0 ? nextOrderId() : null;
      setTabs((prev) =>
        prev.map((t) => {
          if (t.orderId !== id) return t;
          const next = update(claim(t));
          return number !== null && next.cart.length > 0 ? { ...next, orderId: number } : next;
        }),
      );
      if (number !== null) {
        numbered.current.set(id, number);
        setActiveId(number);
      }
    },
    [activeId, me, storedTabs, nextOrderId],
  );

  const updateActiveCart = useCallback(
    (update: (lines: CartLine[]) => CartLine[]) => {
      updateActiveTab((t) => {
        const cart = update(t.cart);
        return t.printed ? { ...t, cart, printed: trimPrinted(cart, t.printed) } : { ...t, cart };
      });
    },
    [updateActiveTab],
  );

  // Items can't be rung up past what's on hand — counting any in set meals,
  // portions by their share, and add-ons, which draw down stock of their own.
  const addItem = useCallback(
    (item: CatalogItem, portion?: Portion, addOns: AddOnPick[] = []) => {
      const promo = bestPromo(promotions, item, new Date(), categories);
      const line = withAddOns(portionLine(item, portion ?? null, promo, catalog), addOns);
      if (!lineFits(cart, line, catalog)) return false;
      updateActiveCart((lines) => (lineFits(lines, line, catalog) ? addLine(lines, line) : lines));
      return true;
    },
    [updateActiveCart, promotions, categories, cart, catalog],
  );

  const addOpenPriceItem = useCallback(
    (item: CatalogItem, price: number) => {
      if (!(price > 0)) return;
      updateActiveCart((lines) => {
        const inCart = itemQuantities(lines).get(item.id) ?? 0;
        return stockFits(item, inCart) ? addLine(lines, openPriceLine(item, price)) : lines;
      });
    },
    [updateActiveCart],
  );

  const addCustomAmount = useCallback(
    (name: string, price: number) => {
      if (!(price > 0)) return;
      updateActiveCart((lines) => addLine(lines, customLine(name, price)));
    },
    [updateActiveCart],
  );

  const addMeal = useCallback(
    (
      meal: SetMeal,
      picks: (CatalogItem | CatalogItem[] | null)[],
      addOns: (CourseAddOn[] | CourseAddOn[][])[] = [],
    ) => {
      const anyPicked = picks.some((p) => (Array.isArray(p) ? p.length > 0 : !!p));
      if (picks.length !== meal.courses.length || !anyPicked) return false;
      const line = mealLine(meal, picks, addOns);
      if (!lineFits(cart, line, catalog)) return false;
      updateActiveCart((lines) => addLine(lines, line));
      return true;
    },
    [cart, catalog, updateActiveCart],
  );

  // A retail shop has no kitchen, so nothing it sells is sent to one.
  const isKitchenItem = useCallback(
    (itemId: string) => {
      if (retail) return false;
      const item = catalog.find((i) => i.id === itemId);
      return !!item && inAnyCategory(categories, item.category, settings.kitchenCategories);
    },
    [retail, catalog, categories, settings.kitchenCategories],
  );

  const unsent = useMemo(
    () => unsentLines(cart, tab.sent, isKitchenItem),
    [cart, tab.sent, isKitchenItem],
  );

  const fireTicket = useCallback(
    (
      from: { orderId: number; name: string },
      lines: SentLine[],
      kind: KitchenTicket['kind'],
    ) => {
      const id = nextTicketId();
      const sentAt = Date.now();
      setKitchenTickets((prev) => [
        ...prev,
        {
          id,
          orderId: from.orderId,
          tabName: from.name,
          sentAt,
          fire:
            kind === 'void'
              ? 0
              : prev.filter((k) => k.orderId === from.orderId && k.kind === 'order').length + 1,
          kind,
          lines: ticketLines(lines),
          bumpedAt: null,
        },
      ]);
    },
    [],
  );

  /**
   * Swaps in the register tab's new lines. Any sent kitchen item that comes
   * off the tab is voided straight away — the kitchen shouldn't keep cooking it.
   */
  const replaceActiveCart = useCallback(
    (next: CartLine[]) => {
      const { sent, voids } = takeVoids(next, tab.sent);
      setTabs((prev) =>
        prev.map((t) =>
          t.orderId === tab.orderId
            ? { ...t, cart: next, sent, ...(t.printed ? { printed: trimPrinted(next, t.printed) } : {}) }
            : t,
        ),
      );
      if (voids.length > 0) fireTicket(tab, voids, 'void');
    },
    [tab, fireTicket],
  );

  const setQty = useCallback(
    (key: string, qty: number) => {
      const current = cart.find((l) => l.key === key)?.qty ?? 0;
      // Only increases are capped — stepping down always works, even if the
      // line already holds more than is now on hand.
      const next =
        qty > current ? Math.min(qty, Math.max(current, lineCap(cart, key, catalog))) : qty;
      replaceActiveCart(setLineQty(cart, key, next));
    },
    [replaceActiveCart, cart, catalog],
  );

  // A note changes what the kitchen makes, so a sent line that gains or
  // changes its note is voided and goes again as the new dish.
  const editLine = useCallback(
    (key: string, note: string, discount: ManualDiscount | null) =>
      replaceActiveCart(withLineEdit(cart, key, note, discount)),
    [replaceActiveCart, cart],
  );

  const setTabDiscount = useCallback(
    (discount: ManualDiscount | null) =>
      updateActiveTab((t) => {
        const { discount: _old, ...rest } = t;
        return discount && discount.value > 0 ? { ...rest, discount } : rest;
      }),
    [updateActiveTab],
  );

  const clearTab = useCallback(() => {
    if (tab.payments.length > 0) return false;
    replaceActiveCart([]);
    setTabDiscount(null);
    return true;
  }, [tab.payments.length, replaceActiveCart, setTabDiscount]);

  /**
   * The register moving off its tab ends that tab's current order: whatever
   * was rung up joins the rest, so reopening it later to add more puts only
   * the new items on the next docket.
   */
  const leaveActive = useCallback(
    (prev: StoredTab[], nextId: number) =>
      activeId === nextId
        ? prev
        : prev.map((t) => (t.orderId === activeId && t.cart.length > 0 ? { ...t, printed: allPrinted(t.cart) } : t)),
    [activeId],
  );

  const switchTab = useCallback(
    (orderId: number) => {
      const target = storedTabs.find((t) => t.orderId === orderId);
      if (target && !canSeeTab(target)) return;
      setTabs((prev) => pruneIdle(leaveActive(prev, orderId), orderId));
      setActiveId(orderId);
    },
    [storedTabs, canSeeTab, leaveActive],
  );

  const openTab = useCallback(
    (locationId: string | null) => {
      const existing = locationId
        ? storedTabs.find((t) => t.locationId === locationId)
        : undefined;
      if (existing) {
        switchTab(existing.orderId);
        return;
      }
      // Already on an empty walk-in: that's the new tab.
      const active = storedTabs.find((t) => t.orderId === activeId);
      if (locationId === null && active && active.locationId === null && active.cart.length === 0) return;
      const fresh = freshTab(draftId(), locationId, me?.id);
      setTabs((prev) => [...pruneIdle(leaveActive(prev, fresh.orderId), fresh.orderId), fresh]);
      setActiveId(fresh.orderId);
    },
    [storedTabs, switchTab, me, leaveActive, activeId],
  );

  const assignTab = useCallback(
    (locationId: string | null) => {
      const taken =
        locationId !== null &&
        storedTabs.some((t) => t.locationId === locationId && t.orderId !== activeId);
      if (taken) return false;
      setTabs((prev) =>
        prev.map((t) => {
          if (t.orderId !== activeId) return t;
          // Null here is a walk-in picked on purpose; a table or room clears it.
          const { walkIn: _, ...rest } = t;
          const moved = { ...rest, locationId, openedBy: t.openedBy ?? me?.id };
          return locationId === null ? { ...moved, walkIn: true as const } : moved;
        }),
      );
      return true;
    },
    [storedTabs, activeId, me],
  );

  const mergeTab = useCallback(
    (targetOrderId: number) => {
      if (targetOrderId === activeId) return false;
      const source = storedTabs.find((t) => t.orderId === activeId);
      const target = storedTabs.find((t) => t.orderId === targetOrderId);
      // Payments belong to the bill they were taken against.
      if (!source || !target || source.payments.length > 0 || !canSeeTab(target)) return false;
      if (target.payments.length > 0 && source.cart.length > 0) return false;
      // An empty table taking items in needs an order number: the incoming
      // tab's, when it has one, as that tab closes.
      const mergedId =
        isDraftId(targetOrderId) && source.cart.length > 0
          ? isDraftId(source.orderId)
            ? nextOrderId()
            : source.orderId
          : targetOrderId;
      setTabs((prev) =>
        prev
          .filter((t) => t.orderId !== activeId)
          .map((t) =>
            t.orderId === targetOrderId
              ? {
                  ...t,
                  orderId: mergedId,
                  cart: mergeLines(t.cart, source.cart),
                  // What the kitchen already has from either tab stays sent.
                  sent: addSent(t.sent, source.sent),
                  printed: addPrinted(t.printed, source.printed),
                  ...(t.edits || source.edits ? { edits: [...(t.edits ?? []), ...(source.edits ?? [])] } : {}),
                }
              : t,
          ),
      );
      setActiveId(mergedId);
      return true;
    },
    [activeId, storedTabs, canSeeTab, nextOrderId],
  );

  /**
   * Closes open tab `orderId` — paid with `payments`, or onto a room's bill.
   * If it was this register's tab, a fresh walk-in takes its place.
   */
  const closeTab = useCallback(
    (orderId: number, close: { payments: Payment[]; tip: number } | { roomId: string }) => {
      const closing = tabs.find((t) => t.orderId === orderId);
      if (!closing) return;
      const closingTotals = computeTotals(closing.cart, settings.taxRate, closing.discount);
      const lines = toOrderLines(closing.cart, catalog);

      // Counter orders are paid before anything's made — paying sends whatever
      // the kitchen hasn't had yet.
      const unsentNow = unsentLines(closing.cart, closing.sent, isKitchenItem);
      if (unsentNow.length > 0) fireTicket(closing, unsentNow, 'order');

      // Stock is drawn down when the bill closes, not when an item lands on a
      // tab. A set meal draws down each of its picks.
      logStock(
        [...itemQuantities(closing.cart)].map(([itemId, qty]) => ({
          itemId,
          change: -qty,
          reason: 'sale' as const,
          ref: `Order #${orderId}`,
        })),
      );

      const onRoom = 'roomId' in close;
      const record: OrderRecord = {
        id: orderId,
        name: closing.name,
        locationId: closing.locationId ?? undefined,
        status: onRoom ? 'charged' : 'paid',
        at: new Date().toISOString(),
        staffId: me?.id,
        ...(closing.openedBy ? { servedBy: closing.openedBy } : {}),
        lines,
        ...(closingTotals.orderDiscount > 0 && closing.discount
          ? {
              discount: closingTotals.orderDiscount,
              discountLabel: discountLabel(closing.discount),
              discountBy: closing.discount.by,
            }
          : {}),
        tax: closingTotals.tax,
        tip: onRoom ? 0 : close.tip,
        payments: onRoom ? [] : close.payments,
        ...(onRoom ? { roomId: close.roomId } : {}),
        ...(closing.edits?.length ? { edits: closing.edits } : {}),
      };
      setClosedOrders((prev) => [record, ...prev]);

      if (orderId !== activeId) {
        setTabs((prev) => prev.filter((t) => t.orderId !== orderId));
        return;
      }
      const fresh = freshTab(draftId(), null);
      setTabs((prev) => [
        ...pruneIdle(
          prev.filter((t) => t.orderId !== orderId),
          fresh.orderId,
        ),
        fresh,
      ]);
      setActiveId(fresh.orderId);
    },
    [tabs, activeId, settings.taxRate, isKitchenItem, fireTicket, logStock, catalog, me],
  );

  const deleteTab = useCallback(
    (orderId: number, reason: string) => {
      if (!me || !hasPermission(me, 'editOrders', settings)) return 'You can’t delete tabs.';
      const doomed = tabs.find((t) => t.orderId === orderId);
      if (!doomed) return 'That tab isn’t open any more.';
      if (doomed.payments.length > 0) return 'Part of this tab is paid — take those payments back first.';
      if (!reason.trim()) return 'Say why it’s being deleted.';

      // Kept as a deleted order, so who deleted what, and why, can be looked up.
      // Nothing was drawn from stock while it was open, so none goes back.
      const totalsHere = computeTotals(doomed.cart, settings.taxRate, doomed.discount);
      const record: OrderRecord = {
        id: orderId,
        name: doomed.name,
        locationId: doomed.locationId ?? undefined,
        status: 'occupied',
        at: doomed.openedIso,
        ...(doomed.openedBy ? { servedBy: doomed.openedBy } : {}),
        lines: toOrderLines(doomed.cart, catalog),
        tax: totalsHere.tax,
        tip: 0,
        payments: [],
        deleted: { at: new Date().toISOString(), by: me.id, reason: reason.trim(), restocked: false },
        ...(doomed.edits?.length ? { edits: doomed.edits } : {}),
      };
      if (doomed.cart.length > 0) setClosedOrders((prev) => [record, ...prev]);

      if (orderId !== activeId) {
        setTabs((prev) => prev.filter((t) => t.orderId !== orderId));
        return null;
      }
      const fresh = freshTab(draftId(), null);
      setTabs((prev) => [...pruneIdle(prev.filter((t) => t.orderId !== orderId), fresh.orderId), fresh]);
      setActiveId(fresh.orderId);
      return null;
    },
    [me, settings, tabs, activeId, catalog],
  );

  const removeFromTab = useCallback(
    (orderId: number, qty: Record<string, number>, reason: string) => {
      if (!me || !hasPermission(me, 'editOrders', settings)) return 'You can’t change tabs.';
      const target = tabs.find((t) => t.orderId === orderId);
      if (!target) return 'That tab isn’t open any more.';
      if (target.payments.length > 0) return 'Part of this tab is paid — take those payments back first.';
      if (!reason.trim()) return 'Say why they’re coming off.';
      const taken: string[] = [];
      let cart = target.cart;
      for (const line of target.cart) {
        const to = qty[line.key] ?? line.qty;
        if (!Number.isInteger(to) || to < 0 || to > line.qty) return 'Items can only come off here — add on the register.';
        if (to === line.qty) continue;
        taken.push(`${line.qty - to} × ${line.name}`);
        cart = setLineQty(cart, line.key, to);
      }
      if (taken.length === 0) return 'Nothing’s been taken off.';

      const entry: OrderEdit = {
        at: new Date().toISOString(),
        by: me.id,
        note: `Took off ${taken.join(', ')} · ${reason.trim()}`,
        before: orderSnapshot(tabAsOrder(target, settings.taxRate)),
      };
      // The kitchen stops on anything it was sent that's no longer on the tab.
      const { sent, voids } = takeVoids(cart, target.sent);
      setTabs((prev) =>
        prev.map((t) =>
          t.orderId === orderId
            ? {
                ...t,
                cart,
                sent,
                ...(t.printed ? { printed: trimPrinted(cart, t.printed) } : {}),
                edits: [...(t.edits ?? []), entry],
              }
            : t,
        ),
      );
      if (voids.length > 0) fireTicket(target, voids, 'void');
      return null;
    },
    [me, settings, tabs, fireTicket],
  );

  const takePayment = useCallback(
    (payment: Payment, tipIfFirst: number) => {
      if (cart.length === 0 || !(payment.amount > 0)) return null;
      const tip = tab.tip ?? tipIfFirst;
      const due = round(totals.total + tip);
      // Stamped for the cash-up: when it came in, and who took it.
      const stamped: Payment = { ...payment, at: new Date().toISOString(), ...(me ? { by: me.id } : {}) };
      const payments = [...tab.payments, stamped];
      if (paidAmount(payments) >= due) {
        const orderId = tab.orderId;
        closeTab(orderId, { payments, tip });
        return orderId;
      }
      updateActiveTab((t) => ({ ...t, payments, tip }));
      return null;
    },
    [cart.length, tab, totals.total, closeTab, updateActiveTab, me],
  );

  const requestBill = useCallback(() => {
    if (cart.length === 0) return;
    const at = new Date().toISOString();
    updateActiveTab((t) => ({ ...t, billRequestedAt: t.billRequestedAt ?? at }));
  }, [cart.length, updateActiveTab]);

  const printDocket = useCallback(() => {
    const current = unprintedLines(tab.cart, tab.printed);
    if (current.length === 0) return null;
    updateActiveTab((t) => ({ ...t, printed: allPrinted(t.cart) }));
    // The tab's discount and payments belong to the whole bill, not one order.
    return tabAsOrder({ ...tab, cart: current, discount: undefined, payments: [] }, settings.taxRate);
  }, [tab, settings.taxRate, updateActiveTab]);

  const chargeToRoom = useCallback(
    (orderId: number, roomId: string) => {
      const charging = storedTabs.find((t) => t.orderId === orderId);
      const room = locations.find((l) => l.id === roomId && l.kind === 'room');
      // Payments belong to the bill they were taken against, so a part-paid tab is paid off instead.
      if (!charging || !room || charging.cart.length === 0 || charging.payments.length > 0) return false;
      closeTab(orderId, { roomId });
      return true;
    },
    [storedTabs, locations, closeTab],
  );

  const settleRoom = useCallback(
    (roomId: string, payment: Pick<Payment, 'method' | 'ref'> & { local?: Pick<LocalCash, 'currency' | 'rate'> }) => {
      const owing = liveRecords.filter((o) => o.status === 'charged' && o.roomId === roomId);
      if (owing.length === 0) return 0;
      const at = new Date().toISOString();
      const ids = new Set(owing.map((o) => o.id));
      setClosedOrders((prev) =>
        prev.map((o) =>
          ids.has(o.id) && o.status === 'charged'
            ? {
                ...o,
                status: 'paid',
                settledAt: at,
                payments: [
                  {
                    method: payment.method,
                    ...(payment.ref ? { ref: payment.ref } : {}),
                    amount: orderTotal(o),
                    at,
                    ...(me ? { by: me.id } : {}),
                    ...(payment.local ? { local: localShare(payment.local, orderTotal(o)) } : {}),
                  },
                ],
              }
            : o,
        ),
      );
      return round(owing.reduce((sum, o) => sum + orderTotal(o), 0));
    },
    [liveRecords, me],
  );

  const closeShift = useCallback(
    (count: {
      float: number;
      countedCash: number;
      note?: string;
      local?: { float: number; counted: number };
      stock?: Record<string, number>;
    }) => {
      const openedAt = shiftStart(cashUps);
      // The count goes in first, so its corrections fall inside the shift it closes.
      const stockCount = count.stock ? inventory.postShiftCount(count.stock) : null;
      const closedAt = new Date().toISOString();
      // What's on the shelf as the next shift opens: the count where there was one.
      const closingStock = Object.fromEntries(
        catalog.filter((i) => !i.untracked).map((i) => [i.id, count.stock?.[i.id] ?? i.stock]),
      );
      const totals = shiftTotals(
        liveRecords,
        storedTabs.flatMap((t) => t.payments),
        openedAt,
        closedAt,
      );
      const cashUp: CashUp = {
        id: `cashup-${Date.now().toString(36)}`,
        openedAt,
        closedAt,
        by: me?.id ?? '',
        float: count.float,
        taken: totals.taken,
        refunded: totals.refunded,
        payments: totals.payments,
        expectedCash: expectedCash(count.float, totals),
        countedCash: count.countedCash,
        ...(count.local && rate
          ? {
              local: {
                currency: settings.costCurrency!,
                float: count.local.float,
                taken: totals.local.taken,
                refunded: totals.local.refunded,
                expected: expectedLocalCash(count.local.float, totals),
                counted: count.local.counted,
              },
            }
          : {}),
        ...(count.note?.trim() ? { note: count.note.trim() } : {}),
        closingStock,
        ...(stockCount ? { countId: stockCount.id } : {}),
      };
      setCashUps((prev) => [cashUp, ...prev]);
      return cashUp;
    },
    [cashUps, liveRecords, storedTabs, me, rate, settings.costCurrency, inventory, catalog],
  );

  const removePayment = useCallback(
    (index: number) =>
      updateActiveTab((t) => {
        const payments = t.payments.filter((_, i) => i !== index);
        // With nothing paid, the tip can be changed again.
        return payments.length > 0 ? { ...t, payments } : { ...t, payments, tip: undefined };
      }),
    [updateActiveTab],
  );

  const sendToKitchen = useCallback(() => {
    if (unsent.length === 0) return;
    fireTicket(tab, unsent, 'order');
    setTabs((prev) =>
      prev.map((t) => (t.orderId === tab.orderId ? { ...t, sent: addSent(t.sent, unsent) } : t)),
    );
  }, [tab, unsent, fireTicket]);

  const bumpTicket = useCallback((ticketId: number) => {
    const at = Date.now();
    setKitchenTickets((prev) => prev.map((k) => (k.id === ticketId ? { ...k, bumpedAt: at } : k)));
  }, []);

  const recallTicket = useCallback((ticketId: number) => {
    setKitchenTickets((prev) =>
      prev.map((k) => (k.id === ticketId ? { ...k, bumpedAt: null } : k)),
    );
  }, []);

  const toggleTicketLine = useCallback(
    (ticketId: number, lineIndex: number) => {
      setKitchenTickets((prev) =>
        prev.map((k) => {
          if (k.id !== ticketId) return k;
          const next = {
            ...k,
            lines: k.lines.map((l, i) => (i === lineIndex ? { ...l, done: !l.done } : l)),
          };
          // Something crossed off means someone's on it.
          return next.kind === 'order' && next.lines[lineIndex]?.done ? startTicket(next, me?.name) : next;
        }),
      );
    },
    [me],
  );

  const toggleTicketStarted = useCallback(
    (ticketId: number) => {
      setKitchenTickets((prev) =>
        prev.map((k) =>
          k.id !== ticketId ? k : k.startedAt !== undefined ? unstartTicket(k) : startTicket(k, me?.name),
        ),
      );
    },
    [me],
  );

  const addLocation = useCallback(
    (kind: LocationKind) => {
      const location = makeLocation(locations, kind);
      setLocations((prev) => [...prev, location]);
      return location;
    },
    [locations],
  );

  const updateLocation = useCallback(
    (id: string, patch: Partial<Omit<Location, 'id'>>) => {
      setLocations((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    },
    [],
  );

  const removeLocation = useCallback(
    (id: string) => {
      if (storedTabs.some((t) => t.locationId === id)) return false;
      setLocations((prev) => prev.filter((l) => l.id !== id));
      return true;
    },
    [storedTabs],
  );

  const updateItem = useCallback((id: string, patch: Partial<CatalogItem>) => {
    setSyncedCatalog((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }, [setSyncedCatalog]);

  const createItem = useCallback(
    (data: Omit<CatalogItem, 'id'>) => {
      // Set meals share item ids' space on a tab, so neither reuses the other's.
      const taken = new Set([...catalog, ...setMeals].map((i) => i.id));
      const item: CatalogItem = { ...data, name: titleCase(data.name), id: slugId(data.name, 'item', taken) };
      setCatalog((prev) => [...prev, item]);
      logNewItem(item);
      return item;
    },
    [catalog, setMeals, logNewItem],
  );

  const deleteItem = useCallback((id: string) => {
    setCatalog((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const saveProduct = useCallback(
    (data: Omit<Product, 'id'> & { id?: string }) => {
      const id = data.id ?? slugId(data.name, 'product', new Set(products.map((p) => p.id)));
      const product: Product = { ...data, id };
      setProducts((prev) =>
        prev.some((p) => p.id === id) ? prev.map((p) => (p.id === id ? product : p)) : [...prev, product],
      );
      return product;
    },
    [products],
  );

  const deleteProduct = useCallback((id: string) => {
    setProducts((prev) => prev.filter((p) => p.id !== id));
    setCatalog((prev) => prev.filter((i) => i.productId !== id));
  }, []);

  const createCategory = useCallback(
    (label: string, parentId?: CategoryId) => {
      // 'meals', 'all' and 'restock' are shelves and filters of their own, so no category takes them.
      const taken = new Set(['meals', 'all', 'restock', ...categories.map((c) => c.id)]);
      const id = slugId(label, 'category', taken);
      const category: Category = parentId ? { id, label, parentId } : { id, label };
      setCategories((prev) => [...prev, category]);
      return category;
    },
    [categories],
  );

  const renameCategory = useCallback((id: string, label: string) => {
    setCategories((prev) => prev.map((c) => (c.id === id ? { ...c, label } : c)));
  }, []);

  const moveCategory = useCallback(
    (id: string, parentId: CategoryId | null) => {
      if (parentId !== null && categoryLineage(categories, parentId).includes(id)) return false;
      setCategories((prev) =>
        prev.map((c) => {
          if (c.id !== id) return c;
          const { parentId: _old, ...rest } = c;
          return parentId ? { ...rest, parentId } : rest;
        }),
      );
      return true;
    },
    [categories],
  );

  const setCategoryAddOns = useCallback((id: string, addOns: AddOn[]) => {
    setCategories((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        const { addOns: _old, ...rest } = c;
        return addOns.length > 0 ? { ...rest, addOns } : rest;
      }),
    );
  }, []);

  const deleteCategory = useCallback(
    (id: string) => {
      if (catalog.some((i) => i.category === id) || categories.some((c) => c.parentId === id)) return false;
      setCategories((prev) => prev.filter((c) => c.id !== id));
      setPromotions((prev) =>
        prev.map((p) => (p.categories.includes(id) ? { ...p, categories: p.categories.filter((c) => c !== id) } : p)),
      );
      setSettings((prev) =>
        prev.kitchenCategories.includes(id) || prev.kitchenMenuCategories.includes(id)
          ? {
              ...prev,
              kitchenCategories: prev.kitchenCategories.filter((c) => c !== id),
              kitchenMenuCategories: prev.kitchenMenuCategories.filter((c) => c !== id),
            }
          : prev,
      );
      return true;
    },
    [catalog, categories],
  );

  const savePromotion = useCallback((promo: Promotion) => {
    setPromotions((prev) => prev.map((p) => (p.id === promo.id ? promo : p)));
  }, []);

  const createPromotion = useCallback(
    (data: Omit<Promotion, 'id'>) => {
      const promo: Promotion = {
        ...data,
        id: slugId(data.name, 'promo', new Set(promotions.map((p) => p.id))),
      };
      setPromotions((prev) => [...prev, promo]);
      return promo;
    },
    [promotions],
  );

  const deletePromotion = useCallback((id: string) => {
    setPromotions((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const saveSetMeal = useCallback((meal: SetMeal) => {
    setSetMeals((prev) => prev.map((m) => (m.id === meal.id ? meal : m)));
  }, []);

  const createSetMeal = useCallback(
    (data: Omit<SetMeal, 'id'>) => {
      const taken = new Set([...catalog, ...setMeals].map((i) => i.id));
      const meal: SetMeal = { ...data, id: slugId(`meal ${data.name}`, 'meal', taken) };
      setSetMeals((prev) => [...prev, meal]);
      return meal;
    },
    [catalog, setMeals],
  );

  const deleteSetMeal = useCallback((id: string) => {
    setSetMeals((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const refundOrder = useCallback(
    (orderId: number, byStaffId: string, request: RefundRequest) => {
      const order = closedRecords.find((o) => o.id === orderId);
      if (!order || order.status !== 'paid') return;

      // Never more of a line than is left unrefunded.
      const remaining = (index: number) => order.lines[index].qty - refundedQty(order, index);
      const lines = (request.lines ?? order.lines.map((_, index) => ({ index, qty: remaining(index) })))
        .map((l) => ({ index: l.index, qty: Math.min(l.qty, remaining(l.index)) }))
        .filter((l) => l.qty > 0);
      if (lines.length === 0) return;

      const left = order.lines.reduce(
        (sum, _, i) => sum + remaining(i) - (lines.find((l) => l.index === i)?.qty ?? 0),
        0,
      );
      const value = refundValue(order, lines);
      const refund: Refund = {
        id: `R${orderId}-${(order.refunds?.length ?? 0) + 1}`,
        at: new Date().toISOString(),
        lines,
        ...value,
        // The tip goes back with the last of the order.
        amount: left === 0 ? round(value.amount + order.tip) : value.amount,
        reason: request.reason,
        by: byStaffId,
        restocked: request.restock,
      };

      setClosedOrders((prev) =>
        prev.map((o) => {
          if (o.id !== orderId) return o;
          const refunds = [...(o.refunds ?? []), refund];
          // Refunding the last of it closes the order out as refunded. The tip
          // goes back too; earlier partial refunds stay on record.
          return left === 0
            ? { ...o, refunds, status: 'refunded', tip: 0, refundedBy: byStaffId }
            : { ...o, refunds };
        }),
      );

      if (request.restock) {
        const qtyOf = (i: number) => lines.find((l) => l.index === i)?.qty ?? 0;
        const ids = new Set(catalog.map((i) => i.id));
        // Older orders carry names only — match those to what's in the catalog now.
        const byName = new Map(catalog.map((i) => [i.name, i.id]));
        logStock(
          orderItems(order, qtyOf)
            .map((l) => ({ ...l, itemId: l.itemId && ids.has(l.itemId) ? l.itemId : byName.get(l.name) }))
            .filter((l): l is typeof l & { itemId: string } => l.itemId !== undefined)
            .map((l) => ({
              itemId: l.itemId,
              change: l.qty,
              reason: 'refund' as const,
              ref: `Order #${orderId}`,
            })),
        );
      }
    },
    [closedRecords, catalog, logStock],
  );

  /** Stock movements for items an order moved, matched to the catalog by id or — for older orders — name. */
  const orderStock = useCallback(
    (
      items: { itemId?: string; name: string; change: number }[],
      reason: 'sale' | 'refund',
      ref: string,
    ) => {
      const ids = new Set(catalog.map((i) => i.id));
      const byName = new Map(catalog.map((i) => [i.name, i.id]));
      logStock(
        items
          .map((l) => ({ ...l, itemId: l.itemId && ids.has(l.itemId) ? l.itemId : byName.get(l.name) }))
          .filter((l): l is typeof l & { itemId: string } => l.itemId !== undefined && l.change !== 0)
          .map((l) => ({ itemId: l.itemId, change: l.change, reason, ref })),
      );
    },
    [catalog, logStock],
  );

  const editOrder = useCallback(
    (orderId: number, change: OrderChange) => {
      if (!me || !hasPermission(me, 'editOrders', settings)) return 'You can’t edit orders.';
      const record = closedRecords.find((o) => o.id === orderId);
      const read = closedOrders.find((o) => o.id === orderId);
      if (!record || !read) return 'That order isn’t here any more.';
      const blocked = editBlocker(read);
      if (blocked) return blocked;
      let next = withLines(record, change.lines, settings.taxRate);
      // Cost-currency cash was counted in its own drawer, so it stays as taken.
      if (change.payments && !hasLocalCash(record)) next = { ...next, payments: change.payments };
      if (change.servedBy !== undefined) {
        next = change.servedBy ? { ...next, servedBy: change.servedBy } : { ...next, servedBy: undefined };
      }
      const problem = editProblem(next, change.note);
      if (problem) return problem;
      const entry: OrderEdit = { at: new Date().toISOString(), by: me.id, note: change.note.trim(), before: orderSnapshot(record) };
      next = { ...next, edits: [...(record.edits ?? []), entry] };
      setClosedOrders((prev) => prev.map((o) => (o.id === orderId ? next : o)));
      // More sold draws stock down; less puts it back.
      const delta = stockDelta(record, next);
      orderStock(delta.filter((d) => d.change < 0), 'sale', `Order #${orderId} · edited`);
      orderStock(delta.filter((d) => d.change > 0), 'refund', `Order #${orderId} · edited`);
      return null;
    },
    [me, settings, closedRecords, closedOrders, orderStock],
  );

  const deleteOrder = useCallback(
    (orderId: number, request: { reason: string; restock: boolean }) => {
      if (!me || !hasPermission(me, 'editOrders', settings)) return 'You can’t delete orders.';
      const record = closedRecords.find((o) => o.id === orderId);
      if (!record || record.deleted) return 'That order isn’t here any more.';
      if (record.status === 'occupied') return 'Open tabs are cleared on the register.';
      if (!request.reason.trim()) return 'Say why it’s being deleted.';
      const deleted: OrderDeletion = {
        at: new Date().toISOString(),
        by: me.id,
        reason: request.reason.trim(),
        restocked: request.restock,
      };
      setClosedOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, deleted } : o)));
      if (request.restock) {
        orderStock(
          heldItems(record).map((i) => ({ ...i, change: i.qty })),
          'refund',
          `Order #${orderId} · deleted`,
        );
      }
      return null;
    },
    [me, settings, closedRecords, orderStock],
  );

  const restoreOrder = useCallback(
    (orderId: number) => {
      if (!me || !hasPermission(me, 'editOrders', settings)) return;
      const record = closedRecords.find((o) => o.id === orderId);
      if (!record?.deleted) return;
      setClosedOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, deleted: undefined } : o)));
      if (record.deleted.restocked) {
        orderStock(
          heldItems(record).map((i) => ({ ...i, change: -i.qty })),
          'sale',
          `Order #${orderId} · restored`,
        );
      }
    },
    [me, settings, closedRecords, orderStock],
  );

  const signIn = useCallback(
    (pin: string) => {
      const member = staff.find((m) => m.active && pinMatches(m, pin)) ?? null;
      if (member) setSignedInId(member.id);
      return member;
    },
    [staff],
  );

  const signOut = useCallback(() => setSignedInId(null), []);

  const can = useCallback(
    (permission: Permission) => !(retail && permission === 'kitchen') && hasPermission(me, permission, settings),
    [retail, me, settings],
  );

  const canEditCategory = useCallback(
    (category: CategoryId) =>
      can('catalog') || (can('menu') && inAnyCategory(categories, category, settings.kitchenMenuCategories)),
    [can, categories, settings.kitchenMenuCategories],
  );

  const approve = useCallback(
    (pin: string, permission: Permission) => {
      const member = staff.find((m) => m.active && pinMatches(m, pin)) ?? null;
      return hasPermission(member, permission, settings) ? member : null;
    },
    [staff, settings],
  );

  const addStaff = useCallback(
    (data: Omit<StaffMember, 'id' | 'pinHash'>) => {
      // PINs are how people sign in, so no two staff share one.
      const pin = uniquePin(staff);
      const id = `staff-${Date.now().toString(36)}`;
      const member: StaffMember = { ...data, id, pinHash: hashPin(id, pin) };
      setStaff((prev) => [...prev, member]);
      return { member, pin };
    },
    [staff],
  );

  const setPin = useCallback(
    (id: string, pin: string) => {
      if (!isPin(pin)) return 'A PIN is 4 digits.';
      // PINs are how people sign in, so no two staff share one.
      if (staff.some((m) => m.id !== id && pinMatches(m, pin))) return 'Someone else already uses that PIN.';
      setStaff((prev) => prev.map((m) => (m.id === id ? { ...m, pinHash: hashPin(id, pin) } : m)));
      return null;
    },
    [staff],
  );

  /**
   * Ends `staffId`'s open shift now. A shift left running past midnight ends
   * at the end of the day it started on.
   */
  const clockOut = useCallback((staffId: string) => {
    const day = isoDate(new Date());
    const now = minutesNow();
    setShifts((prev) =>
      prev.map((s) =>
        s.staffId === staffId && s.clockOut === null
          ? { ...s, clockOut: s.date === day ? Math.max(now, s.clockIn) : 24 * 60 - 1 }
          : s,
      ),
    );
  }, []);

  const deleteStaff = useCallback(
    (id: string) => {
      const member = staff.find((m) => m.id === id);
      const owners = staff.filter((m) => hasRole(m, 'owner') && m.active && !m.deleted);
      if (!member || id === signedInId) return false;
      if (hasRole(member, 'owner') && member.active && owners.length === 1) return false;
      // Kept, inactive and with no PIN, so history can still show their name.
      setStaff((prev) =>
        prev.map((m) => (m.id === id ? { ...m, active: false, deleted: true, pinHash: '' } : m)),
      );
      clockOut(id);
      return true;
    },
    [staff, signedInId, clockOut],
  );

  const visibleStaff = useMemo(() => staff.filter((m) => !m.deleted), [staff]);

  const updateStaff = useCallback(
    (id: string, patch: Partial<Omit<StaffMember, 'id' | 'pinHash'>>) => {
      setStaff((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
      // Deactivating someone mid-shift clocks them out rather than leaving it running.
      if (patch.active === false) clockOut(id);
    },
    [setStaff, clockOut],
  );

  const clockIn = useCallback(
    (staffId: string) => {
      const member = staff.find((m) => m.id === staffId);
      const onClock = shiftRecords.some((s) => s.staffId === staffId && s.clockOut === null);
      if (!member?.active || onClock) return false;
      const shift: ShiftRecord = {
        id: `shift-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        staffId,
        date: isoDate(new Date()),
        clockIn: minutesNow(),
        clockOut: null,
        breakMinutes: 0,
      };
      setShifts((prev) => [shift, ...prev]);
      return true;
    },
    [staff, shiftRecords],
  );

  const updateShift = useCallback(
    (id: string, patch: Partial<Omit<ShiftRecord, 'id' | 'staffId' | 'date'>>) => {
      setShifts((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    },
    [],
  );

  const removeShift = useCallback((id: string) => {
    setShifts((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const recordPayrollRun = useCallback(
    (run: Omit<PayrollRun, 'id'>) => {
      if (payrollRuns.some((r) => r.key === run.key)) return false;
      setPayrollRuns((prev) => [{ ...run, id: `run-${run.key}`, ...(rate ? { rate } : {}) }, ...prev]);
      return true;
    },
    [payrollRuns, rate],
  );

  const addExpense = useCallback((data: Omit<Expense, 'id'>) => {
    // Time plus a random tail, so two devices logging at once never collide.
    const expense = {
      ...data,
      id: `exp-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      ...(rate ? { rate } : {}),
    };
    // Newest day first; same-day entries keep the latest on top.
    setExpenses((prev) => [expense, ...prev].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)));
    return expense;
  }, [rate]);

  const updateExpense = useCallback((id: string, patch: Partial<Omit<Expense, 'id'>>) => {
    setExpenses((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }, []);

  const deleteExpense = useCallback((id: string) => {
    setExpenses((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const { convertForSwitch } = inventory;
  const switchSalesCurrency = useCallback(
    (to: CurrencyCode, rate: number, step?: number) => {
      const blockers = switchBlockers({ tabs, orders: liveRecords, cashUps });
      if (settings.costCurrency || settings.currencySwitch) blockers.push('This shop has already switched currencies.');
      if (to === settings.currency || !(rate > 0)) blockers.push('Pick another currency and a rate above zero.');
      if (blockers.length > 0) return { blockers };

      const target = currencyOf(to);
      const menu = convertMenu({ catalog, setMeals, promotions }, rate, target, step);
      setSyncedCatalog(menu.catalog);
      setSetMeals(menu.setMeals);
      setPromotions(menu.promotions);
      setTabs((prev) => prev.map((t) => convertTab(t, rate, target, step)));
      convertForSwitch(rate, target);
      setExpenses((prev) => stampRate(prev, rate));
      setPayrollRuns((prev) => stampRate(prev, rate));
      const next: Settings = {
        ...settings,
        currency: to,
        costCurrency: settings.currency,
        exchangeRate: rate,
        rateUpdatedAt: todayIso(),
        currencySwitch: { from: settings.currency, rate, at: new Date().toISOString() },
      };
      setSettings(next);
      return { settings: next };
    },
    [tabs, liveRecords, cashUps, settings, catalog, setMeals, promotions, setSyncedCatalog, convertForSwitch],
  );

  const resetAllData = useCallback(async () => {
    try {
      await repo.clear();
    } catch (err) {
      console.warn('Reset failed.', err);
      window.alert('Couldn’t delete the saved data. Check the connection and try again.');
      return;
    }
    window.location.reload();
  }, [repo]);

  const value = useMemo(
    () => ({
      tabs,
      tab,
      cart,
      totals,
      orders,
      catalog,
      locations,
      addItem,
      addOpenPriceItem,
      addCustomAmount,
      addMeal,
      setQty,
      editLine,
      setTabDiscount,
      promotions,
      savePromotion,
      createPromotion,
      deletePromotion,
      setMeals,
      saveSetMeal,
      createSetMeal,
      deleteSetMeal,
      clearTab,
      deleteTab,
      removeFromTab,
      openTab,
      switchTab,
      canSeeTab,
      assignTab,
      mergeTab,
      takePayment,
      removePayment,
      requestBill,
      printDocket,
      chargeToRoom,
      settleRoom,
      cashUps,
      closeShift,
      isKitchenItem,
      unsent,
      sendToKitchen,
      kitchenTickets,
      bumpTicket,
      recallTicket,
      toggleTicketLine,
      toggleTicketStarted,
      refundOrder,
      editOrder,
      deleteOrder,
      restoreOrder,
      deletedOrders,
      updateItem,
      createItem,
      deleteItem,
      products,
      saveProduct,
      deleteProduct,
      categories,
      createCategory,
      renameCategory,
      moveCategory,
      setCategoryAddOns,
      deleteCategory,
      addLocation,
      updateLocation,
      removeLocation,
      staff: visibleStaff,
      allStaff: staff,
      addStaff,
      updateStaff,
      setPin,
      deleteStaff,
      shifts,
      clockIn,
      clockOut,
      updateShift,
      removeShift,
      me,
      signIn,
      signOut,
      can,
      canEditCategory,
      approve,
      payrollRuns,
      recordPayrollRun,
      expenses,
      addExpense,
      updateExpense,
      deleteExpense,
      settings,
      updateSettings: setSettings,
      switchSalesCurrency,
      resetAllData,
      ...inventory,
    }),
    [
      tabs,
      tab,
      cart,
      totals,
      orders,
      catalog,
      locations,
      addItem,
      addOpenPriceItem,
      addCustomAmount,
      addMeal,
      setQty,
      editLine,
      setTabDiscount,
      promotions,
      savePromotion,
      createPromotion,
      deletePromotion,
      setMeals,
      saveSetMeal,
      createSetMeal,
      deleteSetMeal,
      clearTab,
      deleteTab,
      removeFromTab,
      openTab,
      switchTab,
      canSeeTab,
      assignTab,
      mergeTab,
      takePayment,
      removePayment,
      requestBill,
      printDocket,
      chargeToRoom,
      settleRoom,
      cashUps,
      closeShift,
      isKitchenItem,
      unsent,
      sendToKitchen,
      kitchenTickets,
      bumpTicket,
      recallTicket,
      toggleTicketLine,
      toggleTicketStarted,
      refundOrder,
      editOrder,
      deleteOrder,
      restoreOrder,
      deletedOrders,
      updateItem,
      createItem,
      deleteItem,
      products,
      saveProduct,
      deleteProduct,
      categories,
      createCategory,
      renameCategory,
      moveCategory,
      setCategoryAddOns,
      deleteCategory,
      addLocation,
      updateLocation,
      removeLocation,
      visibleStaff,
      staff,
      addStaff,
      updateStaff,
      setPin,
      deleteStaff,
      shifts,
      clockIn,
      clockOut,
      updateShift,
      removeShift,
      me,
      signIn,
      signOut,
      can,
      canEditCategory,
      approve,
      payrollRuns,
      recordPayrollRun,
      expenses,
      addExpense,
      updateExpense,
      deleteExpense,
      settings,
      switchSalesCurrency,
      resetAllData,
      inventory,
    ],
  );

  return <PosContext.Provider value={value}>{children}</PosContext.Provider>;
}

export function usePos(): PosStore {
  const store = useContext(PosContext);
  if (!store) throw new Error('usePos must be used inside <PosProvider>');
  return store;
}
