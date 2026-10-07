/** A shop's subscription, as the `shops` table holds it. */
export type ShopSubscription = {
  name: string;
  /** ISO timestamp the shop is paid up to; null means no end date. */
  paid_until: string | null;
  grace_days: number;
  suspended: boolean;
  /** On a free trial: paid_until is when it ends. Absent on rows cached before trials. */
  trial?: boolean;
};

/**
 * - `active`: paid up, more than WARN_DAYS to go.
 * - `expiring`: paid up, but ends within WARN_DAYS.
 * - `grace`: lapsed, still working until the grace days run out.
 * - `locked`: lapsed past the grace days — the register won't open.
 * - `suspended`: switched off by the platform owner, whatever the dates.
 */
export type SubscriptionStatus = 'active' | 'expiring' | 'grace' | 'locked' | 'suspended';

export type SubscriptionState = {
  status: SubscriptionStatus;
  /** Days until it ends (active, expiring) or locks (grace); null when that doesn't apply. */
  daysLeft: number | null;
  /** The time running out is a free trial, not paid time. */
  trial: boolean;
};

/** How long before the end date a shop starts being warned. */
export const WARN_DAYS = 7;

const DAY = 24 * 60 * 60 * 1000;

export function subscriptionState(shop: ShopSubscription, now: Date = new Date()): SubscriptionState {
  const trial = !!shop.trial;
  if (shop.suspended) return { status: 'suspended', daysLeft: null, trial };
  if (!shop.paid_until) return { status: 'active', daysLeft: null, trial };
  const end = new Date(shop.paid_until).getTime();
  const t = now.getTime();
  if (end > t) {
    const daysLeft = Math.ceil((end - t) / DAY);
    return { status: end - t > WARN_DAYS * DAY ? 'active' : 'expiring', daysLeft, trial };
  }
  const lock = end + shop.grace_days * DAY;
  if (lock > t) return { status: 'grace', daysLeft: Math.ceil((lock - t) / DAY), trial };
  return { status: 'locked', daysLeft: null, trial };
}

/** Whether the register refuses to open. */
export function isLocked(state: Pick<SubscriptionState, 'status'>): boolean {
  return state.status === 'locked' || state.status === 'suspended';
}

/** "8 Oct 2026". */
export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "1 day", "5 days". */
export function dayCount(n: number): string {
  return `${n} day${n === 1 ? '' : 's'}`;
}
