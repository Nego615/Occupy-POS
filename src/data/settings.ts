import type { IconName } from '../components/Icon';
import { DEFAULT_CURRENCY, type CurrencyCode } from '../lib/currency';
import { LOW_STOCK_DEFAULT, TAX_RATE, type CategoryId } from './catalog';

/** Ways to pay, plus `split` — whether one bill can be paid in several parts. */
export type PaymentMethodId = 'card' | 'cash' | 'mobile' | 'split';

export const PAYMENT_METHODS: { id: PaymentMethodId; label: string; icon: IconName }[] = [
  { id: 'card', label: 'Card', icon: 'card' },
  { id: 'cash', label: 'Cash', icon: 'cash' },
  { id: 'mobile', label: 'Mobile money', icon: 'mobile' },
  { id: 'split', label: 'Split bills', icon: 'split' },
];

/**
 * A shop that sold in `from` and now sells in Settings' currency. Orders,
 * stock movements, and cash-ups from before `at` were recorded in `from`,
 * and are read back converted at `rate`.
 */
export type CurrencySwitch = { from: CurrencyCode; rate: number; at: string };

/**
 * Cost-currency units to one sales unit, when the shop buys in a different
 * currency than it sells in. Undefined otherwise — and every conversion is
 * then a no-op.
 */
export function exchangeRate(s: Pick<Settings, 'currency' | 'costCurrency' | 'exchangeRate'>): number | undefined {
  return s.costCurrency && s.costCurrency !== s.currency && s.exchangeRate ? s.exchangeRate : undefined;
}

/**
 * A shop that switched what it sells in keeps buying in what it used to sell
 * in. Settings saved without that — a reset to defaults after the switch —
 * lost the buy-in currency, which hid the exchange rate with no way back.
 * This puts it back, at the last rate or the switch's.
 */
export function withSwitchCurrencies(s: Settings): Settings {
  const sw = s.currencySwitch;
  if (!sw || sw.from === s.currency || (s.costCurrency && s.costCurrency !== s.currency)) return s;
  return { ...s, costCurrency: sw.from, exchangeRate: s.exchangeRate ?? sw.rate };
}

/** Business-wide settings, edited from Admin → Settings. */
export type Settings = {
  /** The brand shown in the top bar, on sign-in, and on receipts. */
  businessName: string;
  /** Uploaded logo as a data URL, shown beside the name and atop receipts; null uses the built-in mark. */
  logo: string | null;
  /** This location — "Front Counter". */
  locationName: string;
  /** This register — "Register 1". */
  registerName: string;
  /** Printed at the foot of every receipt. */
  receiptFooter: string;
  /** Open the print dialog for the receipt as soon as a tab is paid. */
  autoPrintReceipt: boolean;
  /**
   * What every price, total, and wage is shown in. Display only — switching
   * doesn't convert amounts already entered. With a `costCurrency`, it's what
   * the shop sells in: prices, orders, item costs, and every report.
   */
  currency: CurrencyCode;
  /**
   * What the shop buys in, when that's not what it sells in: purchase orders,
   * supplier bills, expenses, and wages. Absent buys in `currency`.
   */
  costCurrency?: CurrencyCode;
  /** Cost-currency units to one unit of `currency` — 2650 for "$1 = TSh 2,650". */
  exchangeRate?: number;
  /** ISO day the rate was last changed. */
  rateUpdatedAt?: string;
  /** Set when the shop switched what it sells in, converting its prices — see currencySwitch.ts. */
  currencySwitch?: CurrencySwitch;

  /** VAT / sales tax as a fraction — 0.18 is 18%, Tanzania's standard VAT rate. */
  taxRate: number;
  /** Show the tip step at checkout at all. */
  tipsEnabled: boolean;
  /** Three tip percentages offered at checkout, as fractions. */
  tipPresets: [number, number, number];
  /** Index into tipPresets that's pre-selected; null pre-selects "No tip". */
  defaultTip: 0 | 1 | 2 | null;

  /** Methods offered at checkout, and whether bills can be split. Always at least one method. */
  paymentMethods: PaymentMethodId[];

  /**
   * Let items marked "price set at the counter" ask for their price when rung
   * up. Off, every item rings up at its set price.
   */
  openPriceEnabled: boolean;

  /** Low-stock warning for items that don't set their own. */
  lowStockDefault: number;
  /** Categories whose stock is counted at every cash-up — spirits, beers, whatever walks. */
  shiftCountCategories: CategoryId[];

  /** Categories whose items go to the kitchen screen. Everything else is made at the counter. */
  kitchenCategories: CategoryId[];
  /** Minutes a kitchen ticket can wait before it's flagged late. */
  kitchenLateMinutes: number;
  /**
   * Let the kitchen — cooks — add, edit, and delete items in
   * `kitchenMenuCategories`, and build set meals.
   */
  kitchenMenu: boolean;
  /** The categories whose items the kitchen manages while `kitchenMenu` is on. */
  kitchenMenuCategories: CategoryId[];

  /** Minutes without a tap or keypress before the register locks; null never locks. */
  autoLockMinutes: number | null;
  /** Wrong PINs in a row before sign-in locks for 30 seconds. */
  maxPinTries: number;
};

export const DEFAULT_SETTINGS: Settings = {
  businessName: 'Occupy',
  logo: null,
  locationName: 'Front Counter',
  registerName: 'Register 1',
  receiptFooter: 'Thanks for stopping in.',
  autoPrintReceipt: false,
  currency: DEFAULT_CURRENCY,
  taxRate: TAX_RATE,
  tipsEnabled: true,
  tipPresets: [0.15, 0.18, 0.2],
  defaultTip: 1,
  paymentMethods: ['card', 'cash', 'mobile', 'split'],
  openPriceEnabled: false,
  lowStockDefault: LOW_STOCK_DEFAULT,
  shiftCountCategories: [],
  kitchenCategories: ['food'],
  kitchenLateMinutes: 10,
  kitchenMenu: false,
  kitchenMenuCategories: [],
  autoLockMinutes: 15,
  maxPinTries: 5,
};

export const AUTO_LOCK_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: 'Never' },
  { value: 2, label: 'After 2 minutes' },
  { value: 5, label: 'After 5 minutes' },
  { value: 15, label: 'After 15 minutes' },
  { value: 30, label: 'After 30 minutes' },
];

/** "Front Counter · Register 1". */
export function stationLabel(settings: Settings): string {
  return `${settings.locationName} · ${settings.registerName}`;
}
