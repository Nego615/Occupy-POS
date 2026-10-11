import { useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import './SignIn.css';
import { Button } from '../components/Button';
import { signOutDevice, unsyncedCount } from '../lib/cloud';

const SUPPORT = import.meta.env.VITE_SUPPORT_CONTACT as string | undefined;

/**
 * Shown in place of the register when the account this device is linked to
 * isn't a shop registered on /platform — made some other way, or its shop
 * deleted there. Opens as soon as it's registered; or the device can be
 * linked to a registered shop instead.
 */
export function ShopNotRegistered({
  client,
  onRetry,
}: {
  client: SupabaseClient;
  onRetry: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  async function retry() {
    setBusy(true);
    await onRetry().finally(() => setBusy(false));
  }

  async function signOut() {
    const unsynced = unsyncedCount();
    if (
      unsynced > 0 &&
      !window.confirm(
        `${unsynced} recent change${unsynced === 1 ? ' hasn’t' : 's haven’t'} uploaded yet and will be lost. Sign out anyway?`,
      )
    ) {
      return;
    }
    await signOutDevice(client);
    window.location.reload();
  }

  return (
    <main className="signin">
      <div className="signin__card">
        <h1 className="signin__title">This account isn’t a registered shop</h1>
        <p className="signin__sub">
          The register only opens for shops registered with Occupy.
          {SUPPORT && <> To register this one, contact {SUPPORT}.</>}
        </p>
        <div className="signin__fields">
          <Button size="lg" block onClick={() => void retry()} disabled={busy}>
            {busy ? 'Checking…' : 'Check again'}
          </Button>
          <Button variant="secondary" size="lg" block onClick={() => void signOut()} disabled={busy}>
            Sign in with another account
          </Button>
        </div>
      </div>
    </main>
  );
}
