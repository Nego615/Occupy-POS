import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode, SetStateAction } from 'react';
import {
  CATALOG,
  CATEGORIES,
  stockFits,
  titleCase,
  withTitleCaseNames,
  withUsedCategories,
  type CatalogItem,
  type Category,
  type Portion,
} from '../data/catalog';
import { DEFAULT_SETTINGS, type Settings } from '../data/settings';
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
  takeVoids,
  ticketLines,
  unsentLines,
  type KitchenTicket,
  type SentLine,
} from '../data/kitchen';
import {
  ORDERS,
  hydrateOrder,
  orderItems,
  paidAmount,
  refundValue,
  refundedQty,
  type Order,
  type OrderLine,
  type OrderRecord,
  type Payment,
  type Refund,
} from '../data/orders';
import {
  STAFF,
  hashPin,
  hasPermission,
  isPin,
  pinMatches,
  uniquePin,
  type Permission,
  type StaffMember,
} from '../data/staff';
import { isoDate } from '../data/history';
import {
  addLine,
  computeTotals,
  customLine,
  discountLabel,
  itemQuantities,
  lineCap,
  lineItems,
  mealLine,
  mergeLines,
  openPriceLine,
  portionLine,
  round,
  editLine as withLineEdit,
  setLineQty,
  type CartLine,
  type CartTotals,
  type ManualDiscount,
} from './cart';
import { salaried, type PayrollRun } from './payroll';
import { setActiveCurrency } from './currency';
import type { PosRepository, Snapshot } from './persist';
import { useInventory, type InventoryStore } from './useInventory';
import { restored, useNextId, usePersist, useRemote } from './usePersist';
import { formatTime } from './useClock';

/** A tab as the store keeps it. Its name isn't stored — it follows the location. */
type StoredTab = {
  orderId: number;
  /** The table or room the tab is assigned to; null for a walk-in. */
  locationId: string | null;
  /** ISO timestamp. */
  openedIso: string;
  cart: CartLine[];
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
};

export type OpenTab = StoredTab & {
  /** Tab name — "Table 4", "Walk-in". Renaming the location renames the tab. */
  name: string;
  /** Display time it was opened — "4:41 PM". */
  openedAt: string;
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
  /** Adds a category at the end of the list and returns it. */
  createCategory: (label: string) => Category;
  renameCategory: (id: string, label: string) => void;
  /**
   * Removes a category, and drops it from promotions and kitchen routing.
   * Refused (false) while any item is still in it.
   */
  deleteCategory: (id: string) => boolean;
  /** Removes an item from the catalog. Tabs already holding it keep their lines. */
  deleteItem: (id: string) => void;
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
   * if one's running now.
   */
  addItem: (item: CatalogItem, portion?: Portion) => void;
  /** Rings up one of an open-price item at the price typed in. */
  addOpenPriceItem: (item: CatalogItem, price: number) => void;
  /** Rings up a one-off amount that isn't in the catalog. */
  addCustomAmount: (name: string, price: number) => void;
  /**
   * Rings up one set meal made of `picks`, one per course. Refused if the
   * picks aren't on hand.
   */
  addMeal: (meal: SetMeal, picks: CatalogItem[]) => boolean;
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
   * Puts a location's tab on the register — its open tab if it has one,
   * otherwise a fresh one. `null` starts a new walk-in.
   */
  openTab: (locationId: string | null) => void;
  /** Puts an existing open tab on the register. */
  switchTab: (orderId: number) => void;
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
  /** Crosses a line off a ticket, or back on. */
  toggleTicketLine: (ticketId: number, lineIndex: number) => void;
  /**
   * Refunds some or all of a paid order. `byStaffId` is who issued or
   * approved it. Refunding the last of it marks the whole order refunded.
   */
  refundOrder: (orderId: number, byStaffId: string, request: RefundRequest) => void;
  /** Who's signed in. Null before sign-in, or once their account is deactivated. */
  me: StaffMember | null;
  /** Signs in by PIN. Returns who signed in, or null for a wrong or inactive PIN. */
  signIn: (pin: string) => StaffMember | null;
  signOut: () => void;
  /** Whether the signed-in person's role grants `permission`. */
  can: (permission: Permission) => boolean;
  /**
   * Checks someone else's PIN for a one-off approval — a manager okaying a
   * refund. Returns them if they're active and hold `permission`.
   */
  approve: (pin: string, permission: Permission) => StaffMember | null;
  /** Pay periods marked as paid, newest first. */
  payrollRuns: PayrollRun[];
  /** Records a paid month. Refused if that month was already recorded. */
  recordPayrollRun: (run: Omit<PayrollRun, 'id'>) => boolean;
  /** Business-wide settings. */
  settings: Settings;
  updateSettings: (next: Settings) => void;
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
  const id = `staff-${Date.now().toString(36)}`;
  const member: StaffMember = { id, name: owner.name, role: 'owner', pinHash: hashPin(id, owner.pin), active: true };
  return {
    tabs: [freshTab(1, null)],
    activeTab: 1,
    orders: [],
    catalog: [],
    categories: [],
    locations: [],
    promotions: [],
    setMeals: [],
    staff: [member],
    payrollRuns: [],
    settings,
    kitchenTickets: [],
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

function freshTab(orderId: number, locationId: string | null): StoredTab {
  return {
    orderId,
    locationId,
    openedIso: new Date().toISOString(),
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

function tabAsOrder(tab: OpenTab, taxRate: number): Order {
  const totals = computeTotals(tab.cart, taxRate, tab.discount);
  return hydrateOrder({
    id: tab.orderId,
    name: tab.name,
    locationId: tab.locationId ?? undefined,
    status: 'occupied',
    at: tab.openedIso,
    lines: toOrderLines(tab.cart),
    ...(totals.orderDiscount > 0 && tab.discount
      ? { discount: totals.orderDiscount, discountLabel: discountLabel(tab.discount) }
      : {}),
    tax: totals.tax,
    tip: 0,
    payments: tab.payments,
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
  const [settings, setSettings] = useState<Settings>(() => ({
    ...DEFAULT_SETTINGS,
    ...restored<Partial<Settings>>(snapshot, 'settings', {}),
  }));
  // Set during render, ahead of every child, so formatters never lag a switch.
  setActiveCurrency(settings.currency);
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
  usePersist(repo, 'categories', categories);
  usePersist(repo, 'locations', locations);
  usePersist(repo, 'promotions', promotions);
  usePersist(repo, 'setMeals', setMeals);
  usePersist(repo, 'staff', staff);
  usePersist(repo, 'payrollRuns', payrollRuns);
  usePersist(repo, 'settings', settings);
  usePersist(repo, 'kitchenTickets', kitchenTickets);

  // Changes from the other screens signed in to this shop.
  useRemote(repo, 'tabs', setTabs);
  useRemote(repo, 'orders', setClosedOrders);
  useRemote(repo, 'catalog', setSyncedCatalog);
  useRemote(repo, 'categories', setCategories);
  useRemote(repo, 'locations', setLocations);
  useRemote(repo, 'promotions', setPromotions);
  useRemote(repo, 'setMeals', setSetMeals);
  useRemote(repo, 'staff', setStaff);
  useRemote(repo, 'payrollRuns', setPayrollRuns);
  useRemote(repo, 'settings', setSettings);
  useRemote(repo, 'kitchenTickets', setKitchenTickets);

  // The tab on this register was closed or paid on another screen: start a
  // fresh walk-in rather than jumping to someone else's tab.
  useEffect(() => {
    if (storedTabs.some((t) => t.orderId === activeId)) return;
    const fresh = freshTab(nextOrderId(), null);
    setTabs((prev) => [...prev, fresh]);
    setActiveId(fresh.orderId);
  }, [storedTabs, activeId, nextOrderId]);

  // Day counts ("today", "3 days ago") are worked out from saved dates, and
  // re-worked when the date rolls over.
  const today = useToday();
  const closedOrders = useMemo(
    () => closedRecords.map(hydrateOrder),
    // `today` is a dependency so day counts are redone at midnight.
    [closedRecords, today],
  );

  // Derived each render, so a role change or deactivation applies at once —
  // a deactivated account drops straight back to the sign-in screen.
  const me = useMemo(
    () => staff.find((m) => m.id === signedInId && m.active) ?? null,
    [staff, signedInId],
  );

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
        .filter((t) => t.cart.length > 0 || t.locationId)
        .map((t) => tabAsOrder(t, settings.taxRate))
        .reverse(),
      ...closedOrders,
    ],
    [tabs, closedOrders, settings.taxRate],
  );

  const updateActiveTab = useCallback(
    (update: (tab: StoredTab) => StoredTab) => {
      setTabs((prev) => prev.map((t) => (t.orderId === activeId ? update(t) : t)));
    },
    [activeId],
  );

  const updateActiveCart = useCallback(
    (update: (lines: CartLine[]) => CartLine[]) => {
      updateActiveTab((t) => ({ ...t, cart: update(t.cart) }));
    },
    [updateActiveTab],
  );

  // Items can't be rung up past what's on hand — counting any in set meals,
  // and portions by their share.
  const addItem = useCallback(
    (item: CatalogItem, portion?: Portion) => {
      const line = portionLine(item, portion ?? null, bestPromo(promotions, item, new Date()));
      updateActiveCart((lines) => {
        const inCart = itemQuantities(lines).get(item.id) ?? 0;
        return stockFits(item, inCart, line.units) ? addLine(lines, line) : lines;
      });
    },
    [updateActiveCart, promotions],
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
    (meal: SetMeal, picks: CatalogItem[]) => {
      if (picks.length !== meal.courses.length) return false;
      const counts = itemQuantities(cart);
      for (const p of picks) counts.set(p.id, (counts.get(p.id) ?? 0) + 1);
      if (picks.some((p) => !stockFits(p, counts.get(p.id) ?? 0, 0))) return false;
      updateActiveCart((lines) => addLine(lines, mealLine(meal, picks)));
      return true;
    },
    [cart, updateActiveCart],
  );

  const isKitchenItem = useCallback(
    (itemId: string) => {
      const item = catalog.find((i) => i.id === itemId);
      return !!item && settings.kitchenCategories.includes(item.category);
    },
    [catalog, settings.kitchenCategories],
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
        prev.map((t) => (t.orderId === tab.orderId ? { ...t, cart: next, sent } : t)),
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

  const switchTab = useCallback((orderId: number) => {
    setTabs((prev) => pruneIdle(prev, orderId));
    setActiveId(orderId);
  }, []);

  const openTab = useCallback(
    (locationId: string | null) => {
      const existing = locationId
        ? storedTabs.find((t) => t.locationId === locationId)
        : undefined;
      if (existing) {
        switchTab(existing.orderId);
        return;
      }
      const fresh = freshTab(nextOrderId(), locationId);
      setTabs((prev) => [...pruneIdle(prev, fresh.orderId), fresh]);
      setActiveId(fresh.orderId);
    },
    [storedTabs, switchTab],
  );

  const assignTab = useCallback(
    (locationId: string | null) => {
      const taken =
        locationId !== null &&
        storedTabs.some((t) => t.locationId === locationId && t.orderId !== activeId);
      if (taken) return false;
      setTabs((prev) => prev.map((t) => (t.orderId === activeId ? { ...t, locationId } : t)));
      return true;
    },
    [storedTabs, activeId],
  );

  const mergeTab = useCallback(
    (targetOrderId: number) => {
      if (targetOrderId === activeId) return false;
      const source = storedTabs.find((t) => t.orderId === activeId);
      const target = storedTabs.find((t) => t.orderId === targetOrderId);
      // Payments belong to the bill they were taken against.
      if (!source || !target || source.payments.length > 0) return false;
      if (target.payments.length > 0 && source.cart.length > 0) return false;
      setTabs((prev) =>
        prev
          .filter((t) => t.orderId !== activeId)
          .map((t) =>
            t.orderId === targetOrderId
              ? {
                  ...t,
                  cart: mergeLines(t.cart, source.cart),
                  // What the kitchen already has from either tab stays sent.
                  sent: addSent(t.sent, source.sent),
                }
              : t,
          ),
      );
      setActiveId(targetOrderId);
      return true;
    },
    [activeId, storedTabs],
  );

  /** Closes the register's tab as a paid order with `payments`, and starts a fresh walk-in. */
  const closeTab = useCallback(
    (payments: Payment[], tip: number) => {
      const lines = toOrderLines(cart, catalog);

      // Counter orders are paid before anything's made — paying sends whatever
      // the kitchen hasn't had yet.
      const unsentNow = unsentLines(cart, tab.sent, isKitchenItem);
      if (unsentNow.length > 0) fireTicket(tab, unsentNow, 'order');

      // Stock is drawn down at payment, not when an item lands on a tab.
      // A set meal draws down each of its picks.
      logStock(
        [...itemQuantities(cart)].map(([itemId, qty]) => ({
          itemId,
          change: -qty,
          reason: 'sale' as const,
          ref: `Order #${tab.orderId}`,
        })),
      );

      const record: OrderRecord = {
        id: tab.orderId,
        name: tab.name,
        locationId: tab.locationId ?? undefined,
        status: 'paid',
        at: new Date().toISOString(),
            staffId: me?.id,
        lines,
        ...(totals.orderDiscount > 0 && tab.discount
          ? {
              discount: totals.orderDiscount,
              discountLabel: discountLabel(tab.discount),
              discountBy: tab.discount.by,
            }
          : {}),
        tax: totals.tax,
        tip,
        payments,
      };
      setClosedOrders((prev) => [record, ...prev]);

      const fresh = freshTab(nextOrderId(), null);
      setTabs((prev) => [
        ...pruneIdle(
          prev.filter((t) => t.orderId !== tab.orderId),
          fresh.orderId,
        ),
        fresh,
      ]);
      setActiveId(fresh.orderId);
    },
    [cart, tab, totals, isKitchenItem, fireTicket, logStock, catalog, me],
  );

  const takePayment = useCallback(
    (payment: Payment, tipIfFirst: number) => {
      if (cart.length === 0 || !(payment.amount > 0)) return null;
      const tip = tab.tip ?? tipIfFirst;
      const due = round(totals.total + tip);
      const payments = [...tab.payments, payment];
      if (paidAmount(payments) >= due) {
        const orderId = tab.orderId;
        closeTab(payments, tip);
        return orderId;
      }
      updateActiveTab((t) => ({ ...t, payments, tip }));
      return null;
    },
    [cart.length, tab, totals.total, closeTab, updateActiveTab],
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

  const toggleTicketLine = useCallback((ticketId: number, lineIndex: number) => {
    setKitchenTickets((prev) =>
      prev.map((k) =>
        k.id === ticketId
          ? {
              ...k,
              lines: k.lines.map((l, i) => (i === lineIndex ? { ...l, done: !l.done } : l)),
            }
          : k,
      ),
    );
  }, []);

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

  const createCategory = useCallback(
    (label: string) => {
      // 'meals', 'all' and 'restock' are shelves and filters of their own, so no category takes them.
      const taken = new Set(['meals', 'all', 'restock', ...categories.map((c) => c.id)]);
      const category: Category = { id: slugId(label, 'category', taken), label };
      setCategories((prev) => [...prev, category]);
      return category;
    },
    [categories],
  );

  const renameCategory = useCallback((id: string, label: string) => {
    setCategories((prev) => prev.map((c) => (c.id === id ? { ...c, label } : c)));
  }, []);

  const deleteCategory = useCallback(
    (id: string) => {
      if (catalog.some((i) => i.category === id)) return false;
      setCategories((prev) => prev.filter((c) => c.id !== id));
      setPromotions((prev) =>
        prev.map((p) => (p.categories.includes(id) ? { ...p, categories: p.categories.filter((c) => c !== id) } : p)),
      );
      setSettings((prev) =>
        prev.kitchenCategories.includes(id)
          ? { ...prev, kitchenCategories: prev.kitchenCategories.filter((c) => c !== id) }
          : prev,
      );
      return true;
    },
    [catalog],
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

  const signIn = useCallback(
    (pin: string) => {
      const member = staff.find((m) => m.active && pinMatches(m, pin)) ?? null;
      if (member) setSignedInId(member.id);
      return member;
    },
    [staff],
  );

  const signOut = useCallback(() => setSignedInId(null), []);

  const can = useCallback((permission: Permission) => hasPermission(me, permission), [me]);

  const approve = useCallback(
    (pin: string, permission: Permission) => {
      const member = staff.find((m) => m.active && pinMatches(m, pin)) ?? null;
      return hasPermission(member, permission) ? member : null;
    },
    [staff],
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

  const deleteStaff = useCallback(
    (id: string) => {
      const member = staff.find((m) => m.id === id);
      const owners = staff.filter((m) => m.role === 'owner' && m.active && !m.deleted);
      if (!member || id === signedInId) return false;
      if (member.role === 'owner' && member.active && owners.length === 1) return false;
      // Kept, inactive and with no PIN, so history can still show their name.
      setStaff((prev) =>
        prev.map((m) => (m.id === id ? { ...m, active: false, deleted: true, pinHash: '' } : m)),
      );
      return true;
    },
    [staff, signedInId],
  );

  const visibleStaff = useMemo(() => staff.filter((m) => !m.deleted), [staff]);

  const updateStaff = useCallback(
    (id: string, patch: Partial<Omit<StaffMember, 'id' | 'pinHash'>>) => {
      setStaff((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
    },
    [setStaff],
  );

  const recordPayrollRun = useCallback(
    (run: Omit<PayrollRun, 'id'>) => {
      if (payrollRuns.some((r) => r.key === run.key)) return false;
      setPayrollRuns((prev) => [{ ...run, id: `run-${run.key}` }, ...prev]);
      return true;
    },
    [payrollRuns],
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
      openTab,
      switchTab,
      assignTab,
      mergeTab,
      takePayment,
      removePayment,
      isKitchenItem,
      unsent,
      sendToKitchen,
      kitchenTickets,
      bumpTicket,
      recallTicket,
      toggleTicketLine,
      refundOrder,
      updateItem,
      createItem,
      deleteItem,
      categories,
      createCategory,
      renameCategory,
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
      me,
      signIn,
      signOut,
      can,
      approve,
      payrollRuns,
      recordPayrollRun,
      settings,
      updateSettings: setSettings,
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
      openTab,
      switchTab,
      assignTab,
      mergeTab,
      takePayment,
      removePayment,
      isKitchenItem,
      unsent,
      sendToKitchen,
      kitchenTickets,
      bumpTicket,
      recallTicket,
      toggleTicketLine,
      refundOrder,
      updateItem,
      createItem,
      deleteItem,
      categories,
      createCategory,
      renameCategory,
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
      me,
      signIn,
      signOut,
      can,
      approve,
      payrollRuns,
      recordPayrollRun,
      settings,
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
