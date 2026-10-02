import { useState, type FormEvent } from 'react';
import './SignIn.css';
import { Button } from '../components/Button';
import { DEFAULT_SETTINGS } from '../data/settings';
import { CURRENCIES, type CurrencyCode } from '../lib/currency';

export type OwnerDetails = {
  businessName: string;
  ownerName: string;
  currency: CurrencyCode;
  pin: string;
};

/**
 * First run for a new shop: the owner names the business and themselves and
 * picks their PIN. The shop then starts empty — no demo staff, menu, or history.
 */
export function OwnerSetup({ onDone }: { onDone: (details: OwnerDetails) => void }) {
  const [businessName, setBusinessName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>(DEFAULT_SETTINGS.currency);
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const business = businessName.trim().replace(/\s+/g, ' ');
    const owner = ownerName.trim().replace(/\s+/g, ' ');
    if (!business || !owner) return setError('Enter the business name and your name.');
    if (!/^\d{4}$/.test(pin)) return setError('Your PIN must be exactly 4 digits.');
    if (pin !== confirmPin) return setError('The two PINs don’t match.');
    onDone({ businessName: business, ownerName: owner, currency, pin });
  }

  const digits = (v: string) => v.replace(/\D/g, '').slice(0, 4);

  return (
    <main className="signin">
      <form className="signin__card" onSubmit={submit} noValidate>
        <h1 className="signin__title">Set up your shop</h1>
        <p className="signin__sub">
          You’ll be the owner. Add your menu, tables, and staff once you’re in.
        </p>
        <div className="signin__fields">
          <label className="signin__field">
            <span>Business name</span>
            <input
              autoComplete="organization"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              autoFocus
            />
          </label>
          <label className="signin__field">
            <span>Your name</span>
            <input autoComplete="name" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} />
          </label>
          <label className="signin__field">
            <span>Currency</span>
            <select value={currency} onChange={(e) => setCurrency(e.target.value as CurrencyCode)}>
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name} ({c.symbol})
                </option>
              ))}
            </select>
          </label>
          <label className="signin__field">
            <span>Your 4-digit PIN</span>
            <input
              className="mono"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              value={pin}
              onChange={(e) => setPin(digits(e.target.value))}
            />
          </label>
          <label className="signin__field">
            <span>Confirm PIN</span>
            <input
              className="mono"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              value={confirmPin}
              onChange={(e) => setConfirmPin(digits(e.target.value))}
            />
          </label>
          {error && (
            <p className="signin__error" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" block>
            Create shop
          </Button>
        </div>
      </form>
    </main>
  );
}
