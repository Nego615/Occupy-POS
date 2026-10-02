import { dateOfDaysAgo, isoDate } from './history';

/* -------------------------------------------------------------------------
   Inventory: suppliers, purchase orders, supplier bills, and the stock
   ledger. Dates are ISO calendar days ("2026-09-29"). Amounts are in the
   business currency, like everything else.
   ------------------------------------------------------------------------- */

export type Supplier = {
  id: string;
  name: string;
  contact?: string;
  phone?: string;
  email?: string;
  /** Days after a delivery that its bill falls due. */
  paymentTermsDays: number;
  active: boolean;
};

export type MovementReason =
  | 'opening'
  | 'new-item'
  | 'sale'
  | 'refund'
  | 'received'
  | 'waste'
  | 'correction'
  | 'count';

export const MOVEMENT_LABEL: Record<MovementReason, string> = {
  opening: 'Opening stock',
  'new-item': 'New item',
  sale: 'Sale',
  refund: 'Refund, back to stock',
  received: 'Delivery received',
  waste: 'Waste or damage',
  correction: 'Correction',
  count: 'Stock count',
};

/** Reasons a person can pick when adjusting stock by hand. */
export const ADJUST_REASONS: { id: 'waste' | 'correction' | 'count'; label: string; hint: string }[] = [
  { id: 'count', label: 'Stock count', hint: 'Set to what’s physically on the shelf.' },
  { id: 'waste', label: 'Waste or damage', hint: 'Spoiled, broken, expired, or given away.' },
  { id: 'correction', label: 'Correction', hint: 'Fix a mistake in the number.' },
];

/** One change to one item's stock. Stock only ever moves through these. */
export type StockMovement = {
  id: string;
  itemId: string;
  /** Snapshot, so history reads right after a rename or delete. */
  itemName: string;
  /** Units in (positive) or out (negative). */
  change: number;
  stockAfter: number;
  reason: MovementReason;
  note?: string;
  /** What caused it: "Order #1047", "PO-1004". */
  ref?: string;
  /** Cost of one unit when it moved — values waste, count losses, and deliveries. */
  unitCost?: number;
  /** Who did it; absent for system entries like the opening balance. */
  staffId?: string;
  date: string;
  time: string;
};

export type PurchaseStatus = 'draft' | 'ordered' | 'partial' | 'received' | 'cancelled';

export const PURCHASE_STATUS_LABEL: Record<PurchaseStatus, string> = {
  draft: 'Draft',
  ordered: 'Ordered',
  partial: 'Part received',
  received: 'Received',
  cancelled: 'Cancelled',
};

export type PurchaseLine = {
  itemId: string;
  name: string;
  qty: number;
  unitCost: number;
  /** Units delivered so far. */
  received: number;
};

export type PurchaseOrder = {
  id: string;
  supplierId: string;
  status: PurchaseStatus;
  lines: PurchaseLine[];
  createdAt: string;
  createdBy: string;
  orderedAt?: string;
  /** When the supplier said it'd arrive. */
  expectedAt?: string;
  notes?: string;
};

export type PaymentMethod = 'bank' | 'mobile' | 'cash';

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  bank: 'Bank transfer',
  mobile: 'Mobile money',
  cash: 'Cash',
};

export type BillPayment = {
  id: string;
  amount: number;
  method: PaymentMethod;
  date: string;
  /** Staff name, frozen. */
  by: string;
};

/** What's owed to a supplier for one delivery. */
export type SupplierBill = {
  id: string;
  supplierId: string;
  /** The purchase order the delivery was against. */
  poId?: string;
  /** The supplier's own invoice number. */
  reference: string;
  issuedAt: string;
  dueAt: string;
  amount: number;
  payments: BillPayment[];
};

/* ---------- Stock counts ---------- */

/** A count being taken: which items, and what's been counted so far. */
export type CountDraft = {
  /** "All items", "Dar Fresh Bakery", "Pastries". */
  scope: string;
  startedAt: string;
  startedBy: string;
  itemIds: string[];
  /** Counted units by item; missing means not counted yet. */
  counted: Record<string, number>;
};

export type CountLine = {
  itemId: string;
  name: string;
  /** On hand per the system when the count was posted. */
  expected: number;
  counted: number;
  /** Cost of one unit then, to value the difference. */
  unitCost?: number;
};

/** A posted count — every counted line, whether or not it differed. */
export type StockCount = {
  id: string;
  scope: string;
  date: string;
  time: string;
  by: string;
  lines: CountLine[];
  /** Items in scope left uncounted, which kept their numbers. */
  skipped: number;
};

/* ---------- Dates ---------- */

export function isoDaysAgo(daysAgo: number): string {
  return isoDate(dateOfDaysAgo(daysAgo));
}

export function todayIso(): string {
  return isoDaysAgo(0);
}

/** "2026-09-29" plus `days` calendar days. */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d + days, 12);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

/** Whole days from `a` to `b` (positive when b is later). */
export function daysBetween(a: string, b: string): number {
  const toUtc = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

/** "Sep 12". */
export function formatDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/* ---------- Seed data ---------- */

export const SUPPLIERS: Supplier[] = [
  {
    id: 'kilimanjaro',
    name: 'Kilimanjaro Coffee Traders',
    contact: 'Neema Mushi',
    phone: '+255 754 210 887',
    email: 'orders@kilicoffee.co.tz',
    paymentTermsDays: 14,
    active: true,
  },
  {
    id: 'dar-bakery',
    name: 'Dar Fresh Bakery',
    contact: 'Juma Salim',
    phone: '+255 713 448 120',
    paymentTermsDays: 7,
    active: true,
  },
  {
    id: 'coastal-kitchen',
    name: 'Coastal Fresh Kitchen',
    contact: 'Grace Mwakyusa',
    phone: '+255 766 902 314',
    email: 'accounts@coastalfresh.co.tz',
    paymentTermsDays: 7,
    active: true,
  },
  {
    id: 'mzuri',
    name: 'Mzuri Merchandise',
    contact: 'Ali Kombo',
    email: 'sales@mzuri.co.tz',
    paymentTermsDays: 30,
    active: true,
  },
];

const po = (
  id: string,
  supplierId: string,
  status: PurchaseStatus,
  daysAgo: number,
  lines: [itemId: string, name: string, qty: number, unitCost: number, received?: number][],
  extra: Partial<PurchaseOrder> = {},
): PurchaseOrder => ({
  id,
  supplierId,
  status,
  createdAt: isoDaysAgo(daysAgo + 1),
  createdBy: 'Priya Nair',
  orderedAt: status === 'draft' ? undefined : isoDaysAgo(daysAgo),
  lines: lines.map(([itemId, name, qty, unitCost, received]) => ({
    itemId,
    name,
    qty,
    unitCost,
    received: received ?? (status === 'received' ? qty : 0),
  })),
  ...extra,
});

export const PURCHASE_ORDERS: PurchaseOrder[] = [
  po(
    'PO-1004',
    'mzuri',
    'ordered',
    2,
    [
      ['tumbler', 'Occupy Tumbler', 6, 18_000],
      ['tote', 'Canvas Tote', 6, 14_000],
      ['filters', 'Paper Filters', 20, 5_000],
    ],
    { expectedAt: isoDaysAgo(-3), notes: 'Tumblers in black only.' },
  ),
  po('PO-1003', 'kilimanjaro', 'received', 5, [
    ['oat-latte', 'Oat Latte', 48, 2_300],
    ['cortado', 'Cortado', 40, 1_800],
    ['cold-brew', 'Cold Brew', 30, 1_900],
    ['beans-12', 'Whole Bean 12oz', 12, 14_000],
  ]),
  po('PO-1002', 'coastal-kitchen', 'received', 10, [
    ['avo-toast', 'Avocado Toast', 16, 5_000],
    ['breakfast-burrito', 'Breakfast Burrito', 14, 5_500],
    ['turkey-club', 'Turkey Club', 10, 6_500],
    ['grain-bowl', 'Grain Bowl', 12, 6_500],
  ]),
  po('PO-1001', 'dar-bakery', 'received', 12, [
    ['croissant', 'Butter Croissant', 24, 2_200],
    ['pain-choc', 'Pain au Chocolat', 20, 2_700],
    ['morning-bun', 'Morning Bun', 20, 2_400],
    ['banana-bread', 'Banana Bread', 12, 1_800],
    ['scone', 'Blueberry Scone', 16, 2_100],
  ]),
];

const billFor = (
  id: string,
  order: PurchaseOrder,
  reference: string,
  receivedDaysAgo: number,
  payments: BillPayment[] = [],
): SupplierBill => {
  const terms = SUPPLIERS.find((s) => s.id === order.supplierId)!.paymentTermsDays;
  return {
    id,
    supplierId: order.supplierId,
    poId: order.id,
    reference,
    issuedAt: isoDaysAgo(receivedDaysAgo),
    dueAt: isoDaysAgo(receivedDaysAgo - terms),
    amount: order.lines.reduce((sum, l) => sum + l.received * l.unitCost, 0),
    payments,
  };
};

const byId = (id: string) => PURCHASE_ORDERS.find((p) => p.id === id)!;

/** One paid, one part-paid and overdue, one open and not yet due. */
export const SUPPLIER_BILLS: SupplierBill[] = [
  billFor('BILL-3', byId('PO-1003'), 'KCT-0457', 5),
  billFor('BILL-2', byId('PO-1002'), 'CFK-118', 10, [
    { id: 'PAY-2', amount: 150_000, method: 'mobile', date: isoDaysAgo(6), by: 'Jamie Ruiz' },
  ]),
  billFor('BILL-1', byId('PO-1001'), 'DFB-2291', 12, [
    { id: 'PAY-1', amount: 210_000, method: 'bank', date: isoDaysAgo(6), by: 'Jamie Ruiz' },
  ]),
];
