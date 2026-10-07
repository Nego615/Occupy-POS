import { useEffect, useState } from 'react';
import './SignIn.css';
import { Button } from '../components/Button';

/**
 * Shown instead of new-shop setup when a device with nothing saved can't
 * reach the shop account — the shop may well exist, this device just can't
 * see it yet. Tries again by itself when the connection comes back.
 */
export function CloudUnreachable({ onRetry }: { onRetry: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);

  async function retry() {
    setBusy(true);
    // On success this screen is replaced; on failure it's shown afresh.
    await onRetry().finally(() => setBusy(false));
  }

  useEffect(() => {
    const onOnline = () => void retry();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
    // retry only reads props and setters, which don't change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="signin">
      <div className="signin__card">
        <h1 className="signin__title">Can’t reach your shop</h1>
        <p className="signin__sub">
          This device needs to download your shop’s data once before it can be used. Check the
          internet connection and try again.
        </p>
        <Button size="lg" block onClick={() => void retry()} disabled={busy}>
          {busy ? 'Connecting…' : 'Try again'}
        </Button>
      </div>
    </main>
  );
}
