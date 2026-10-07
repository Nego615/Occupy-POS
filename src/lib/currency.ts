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

export function setActiveCurrency(code: CurrencyCode): void {
  active = currencyOf(code);
}

export function activeCurrency(): Currency {
  return active;
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
export function roundMoney(n: number): number {
  const f = 10 ** active.decimals;
  return Math.round(n * f) / f;
}

/** Whether typed text is a plain amount with no more decimals than the currency allows. */
export function isAmountText(text: string): boolean {
  const d = active.decimals;
  return (d === 0 ? /^\d+$/ : new RegExp(`^\\d*\\.?\\d{0,${d}}$`)).test(text);
}
