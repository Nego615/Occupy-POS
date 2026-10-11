export type CurrencyCode = 'TZS' | 'KES' | 'UGX' | 'USD' | 'EUR' | 'GBP';

export type Currency = {
  code: CurrencyCode;
  name: string;
  symbol: string;
  /** Digits after the point in prices and totals. Shillings trade in whole units. */
  decimals: number;
  /** "TSh 6,500" has a space; "$6.50" doesn't. */
  spaced: boolean;
  /** A typical order amount, for settings previews and input hints. */
  example: number;
};

export const CURRENCIES: Currency[] = [
  { code: 'TZS', name: 'Tanzanian shilling', symbol: 'TSh', decimals: 0, spaced: true, example: 10_000 },
  { code: 'KES', name: 'Kenyan shilling', symbol: 'KSh', decimals: 0, spaced: true, example: 1_000 },
  { code: 'UGX', name: 'Ugandan shilling', symbol: 'USh', decimals: 0, spaced: true, example: 20_000 },
  { code: 'USD', name: 'US dollar', symbol: '$', decimals: 2, spaced: false, example: 10 },
  { code: 'EUR', name: 'Euro', symbol: '€', decimals: 2, spaced: false, example: 10 },
  { code: 'GBP', name: 'British pound', symbol: '£', decimals: 2, spaced: false, example: 10 },
];

export const DEFAULT_CURRENCY: CurrencyCode = 'TZS';

export function currencyOf(code: CurrencyCode): Currency {
  return CURRENCIES.find((c) => c.code === code) ?? CURRENCIES[0];
}

/*
 * The currency every formatter and money rounder uses. Money is formatted in
 * dozens of plain functions (receipts, reports, CSV-free labels), so rather
 * than thread the setting through each one, PosProvider sets it here from
 * Settings on every render — before any child renders — and they read it.
 */
let active: Currency = currencyOf(DEFAULT_CURRENCY);
// What stock, suppliers, expenses, and wages are paid in — null while that's the active currency.
let cost: Currency | null = null;

export function setActiveCurrency(code: CurrencyCode): void {
  active = currencyOf(code);
}

export function activeCurrency(): Currency {
  return active;
}

/** Set alongside the active currency; null, or the active currency's own code, buys in what it sells in. */
export function setCostCurrency(code: CurrencyCode | null): void {
  cost = code && code !== active.code ? currencyOf(code) : null;
}

/** The currency purchases, supplier bills, expenses, and wages are in. */
export function costCurrency(): Currency {
  return cost ?? active;
}

/**
 * A cost-currency amount in the sales currency, at `rate` cost units to one
 * sales unit. No rate means the shop buys in what it sells in.
 */
export function toSales(amount: number, rate?: number): number {
  return rate ? roundMoney(amount / rate) : amount;
}

/** A sales-currency amount in the cost currency — the other way from toSales. */
export function toCost(amount: number, rate?: number): number {
  return rate ? roundMoney(amount * rate, costCurrency()) : amount;
}

/**
 * What a sales-currency bill comes to in cost-currency cash: rounded up, so
 * paying it always covers the bill.
 */
export function costDue(amount: number, rate: number): number {
  const f = 10 ** costCurrency().decimals;
  // Rounding off float noise first, so 40 × 2650 is 106,000 and not 106,001.
  return Math.ceil(Number((amount * rate * f).toFixed(6))) / f;
}

/**
 * "TSh 6,500", "$6.50", "-TSh 1,200". Always grouped by thousands. Pass
 * `currency` to format in one other than the active one (settings previews).
 */
export function formatCurrency(value: number, currency: Currency = active): string {
  const sign = value < 0 ? '-' : '';
  const number = formatAmount(Math.abs(value), currency);
  // A non-breaking space, so "TSh" never wraps away from its amount.
  return `${sign}${currency.symbol}${currency.spaced ? ' ' : ''}${number}`;
}

/**
 * "30,633" — grouped, without the symbol: for amount fields that already show
 * the symbol beside them. Amount fields accept the commas back.
 */
export function formatAmount(value: number, currency: Currency = active): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: currency.decimals,
    maximumFractionDigits: currency.decimals,
  });
}

/** Rounds to the currency's smallest unit — cents, or whole shillings. */
export function roundMoney(n: number, currency: Currency = active): number {
  const f = 10 ** currency.decimals;
  return Math.round(n * f) / f;
}

/** Whether typed text is a plain amount with no more decimals than the currency allows. */
export function isAmountText(text: string, currency: Currency = active): boolean {
  const d = currency.decimals;
  return (d === 0 ? /^\d+$/ : new RegExp(`^\\d*\\.?\\d{0,${d}}$`)).test(text);
}
