import type { PaymentMethod } from './inventory';

/**
 * Running costs that aren't stock: rent, power, transport, repairs. Stock
 * bought from suppliers isn't an expense here — it's counted as cost of goods
 * when it sells — and wages come from payroll.
 */

export type ExpenseCategoryId =
  | 'rent'
  | 'utilities'
  | 'transport'
  | 'repairs'
  | 'supplies'
  | 'marketing'
  | 'fees'
  | 'other';

export const EXPENSE_CATEGORIES: { id: ExpenseCategoryId; label: string; hint: string }[] = [
  { id: 'rent', label: 'Rent', hint: 'Rent and service charges' },
  { id: 'utilities', label: 'Utilities', hint: 'Power, water, gas, internet, airtime' },
  { id: 'transport', label: 'Transport', hint: 'Fuel, deliveries, fares' },
  { id: 'repairs', label: 'Repairs', hint: 'Repairs and maintenance' },
  { id: 'supplies', label: 'Supplies', hint: 'Cleaning, packaging, and other things not sold' },
  { id: 'marketing', label: 'Marketing', hint: 'Adverts, posters, promotions' },
  { id: 'fees', label: 'Licences & fees', hint: 'Licences, permits, bank and mobile money charges' },
  { id: 'other', label: 'Other', hint: 'Anything else' },
];

export function expenseCategoryLabel(id: ExpenseCategoryId): string {
  return EXPENSE_CATEGORIES.find((c) => c.id === id)?.label ?? 'Other';
}

export type Expense = {
  id: string;
  /** The day it was paid, "2026-09-29". */
  date: string;
  category: ExpenseCategoryId;
  /** "October rent", "TANESCO tokens". */
  description: string;
  /** In the cost currency — what the shop pays out in. */
  amount: number;
  /** Cost-currency units to one sales unit on the day, when the shop buys in another currency. */
  rate?: number;
  method: PaymentMethod;
  /** Staff name, frozen. */
  by: string;
};
