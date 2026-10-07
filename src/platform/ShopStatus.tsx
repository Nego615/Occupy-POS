import { dayCount, subscriptionState, type ShopSubscription, type SubscriptionStatus } from '../lib/subscription';

export const STATUS_LABEL: Record<SubscriptionStatus, string> = {
  active: 'Paid up',
  expiring: 'Ending soon',
  grace: 'In grace',
  locked: 'Locked',
  suspended: 'Suspended',
};

/** A shop's subscription as a tag: "Paid up", "Free trial, 12 days left", "Locks in 2 days". */
export function ShopStatus({ shop }: { shop: ShopSubscription }) {
  const { status, daysLeft, trial } = subscriptionState(shop);
  const days = daysLeft === null ? '' : dayCount(daysLeft);
  const text =
    status === 'active' && trial
      ? days ? `Free trial, ${days} left` : 'Free trial'
      : status === 'expiring'
        ? `${trial ? 'Trial ends' : 'Ends'} in ${days}`
        : status === 'grace'
          ? `${trial ? 'Trial over, locks' : 'Locks'} in ${days}`
          : STATUS_LABEL[status];
  const kind = status === 'active' && trial ? 'trial' : status;
  return <span className={`pf-tag pf-tag--${kind}`}>{text}</span>;
}
