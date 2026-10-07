import { dayCount, subscriptionState, type ShopSubscription, type SubscriptionStatus } from '../lib/subscription';

export const STATUS_LABEL: Record<SubscriptionStatus, string> = {
  active: 'Paid up',
  expiring: 'Ending soon',
  grace: 'In grace',
  locked: 'Locked',
  suspended: 'Suspended',
};

/** A shop's subscription as a tag: "Paid up", "Ending in 3 days", "Locks in 2 days". */
export function ShopStatus({ shop }: { shop: ShopSubscription }) {
  const { status, daysLeft } = subscriptionState(shop);
  const text =
    status === 'expiring' && daysLeft !== null
      ? `Ends in ${dayCount(daysLeft)}`
      : status === 'grace' && daysLeft !== null
        ? `Locks in ${dayCount(daysLeft)}`
        : STATUS_LABEL[status];
  return <span className={`pf-tag pf-tag--${status}`}>{text}</span>;
}
