import './SubscriptionBanner.css';
import { StatusChip } from './StatusChip';
import { useSubscription } from '../lib/SubscriptionGate';
import { dayCount } from '../lib/subscription';

const SUPPORT = import.meta.env.VITE_SUPPORT_CONTACT as string | undefined;

/** A strip across the top while the subscription is about to end, or has. */
export function SubscriptionBanner() {
  const state = useSubscription();
  if (!state || state.daysLeft === null) return null;
  if (state.status !== 'expiring' && state.status !== 'grace') return null;

  const renew = SUPPORT ? ` Contact ${SUPPORT} to renew.` : ' Renew to keep using the register.';
  return (
    <div className="sub-banner" role="status">
      <StatusChip status="occupied" size="sm">
        {state.status === 'grace' ? 'Expired' : 'Renew soon'}
      </StatusChip>
      <span className="sub-banner__text">
        {state.status === 'grace'
          ? `The subscription has ended — the register locks in ${dayCount(state.daysLeft)}.`
          : `The subscription ends in ${dayCount(state.daysLeft)}.`}
        {renew}
      </span>
    </div>
  );
}
