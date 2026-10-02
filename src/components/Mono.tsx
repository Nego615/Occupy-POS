import type { ElementType, ReactNode } from 'react';
import { formatCurrency } from '../lib/currency';

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

/** Formats a number in the business currency and renders it in the mono face. */
export function Money({ value, className }: { value: number; className?: string }) {
  return <Mono className={className}>{formatMoney(value)}</Mono>;
}

/** "TSh 6,500" or "$6.50" — whatever currency Settings names. */
export function formatMoney(value: number): string {
  return formatCurrency(value);
}
