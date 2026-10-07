import { useState } from 'react';
import './SignIn.css';
import { Button } from '../components/Button';
import { formatDay, type ShopSubscription, type SubscriptionState } from '../lib/subscription';

const SUPPORT = import.meta.env.VITE_SUPPORT_CONTACT as string | undefined;

/**
 * Shown in place of the register while the shop's subscription has lapsed
 * past its grace days, or the shop is suspended. Nothing on the device is
 * lost — it opens again as soon as the subscription is renewed.
 */
export function SubscriptionLocked({
  shop,
  state,
  onRetry,
}: {
  shop: ShopSubscription;
  state: SubscriptionState;
  onRetry: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  async function retry() {
    setBusy(true);
    await onRetry().finally(() => setBusy(false));
  }

  return (
    <main className="signin">
      <div className="signin__card">
        <h1 className="signin__title">
          {state.status === 'suspended' ? 'This register is paused' : 'Subscription ended'}
        </h1>
        <p className="signin__sub">
          {state.status === 'suspended'
            ? `${shop.name}’s account has been paused.`
            : `${shop.name}’s subscription ended${shop.paid_until ? ` on ${formatDay(shop.paid_until)}` : ''}.`}{' '}
          Your data is safe and the register opens again as soon as it’s renewed.
          {SUPPORT && <> To renew, contact {SUPPORT}.</>}
        </p>
        <Button size="lg" block onClick={() => void retry()} disabled={busy}>
          {busy ? 'Checking…' : 'Check again'}
        </Button>
      </div>
    </main>
  );
}
