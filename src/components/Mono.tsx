import { createContext, useContext, type ElementType, type ReactNode } from 'react';
import { costCurrency, formatCurrency, type Currency } from '../lib/currency';

type MonoProps = {
  children: ReactNode;
  /** Element to render as. Defaults to <span>. */
  as?: ElementType;
  className?: string;
};

/**
 * Every numeral in Occupy — price, quantity, total, timestamp — renders through
 * this (or an explicit `.mono` class). Tabular figures stop digits jittering
 * when a total updates, which is what makes a register feel trustworthy.
 */
export function Mono({ children, as: Tag = 'span', className }: MonoProps) {
  return <Tag className={className ? `mono ${className}` : 'mono'}>{children}</Tag>;
}

// A currency for every Money inside — see InCurrency.
const MoneyCurrency = createContext<Currency | undefined>(undefined);

/**
 * Shows every Money inside in `currency` — an order recorded before the shop
 * switched what it sells in, say. Undefined leaves the business currency.
 */
export function InCurrency({ currency, children }: { currency?: Currency; children: ReactNode }) {
  return <MoneyCurrency.Provider value={currency}>{children}</MoneyCurrency.Provider>;
}

/**
 * Formats a number in the business currency — or `currency`, for amounts in
 * what the shop buys in — and renders it in the mono face, the symbol and
 * amount never split across lines.
 */
export function Money({ value, currency, className }: { value: number; currency?: Currency; className?: string }) {
  const inherited = useContext(MoneyCurrency);
  return (
    <Mono className={className ? `money ${className}` : 'money'}>{formatMoney(value, currency ?? inherited)}</Mono>
  );
}

/** "TSh 6,500" or "$6.50" — whatever currency Settings names, unless told otherwise. */
export function formatMoney(value: number, currency?: Currency): string {
  return formatCurrency(value, currency);
}

/**
 * Money in what the shop buys in — purchase costs, supplier bills, expenses,
 * and wages. The same as Money unless Settings names a separate cost currency.
 */
export function CostMoney({ value, className }: { value: number; className?: string }) {
  return <Money value={value} currency={costCurrency()} className={className} />;
}

/** formatMoney in the cost currency. */
export function formatCost(value: number): string {
  return formatCurrency(value, costCurrency());
}
