import { useEffect, useRef, useState, type FormEvent } from 'react';
import './ResetDataDialog.css';
import { Button } from './Button';
import { useBusiness } from '../lib/business';
import { usePos, type ResetPart } from '../lib/store';
import { supabase } from '../lib/supabase';

type Choice = ResetPart | 'all';
type Option = { id: Choice; label: string; hint: string };

function optionsFor(retail: boolean): Option[] {
  return [
    {
      id: 'sales',
      label: 'Sales',
      hint: retail
        ? 'Completed and open sales, and cash-ups.'
        : 'Completed and open orders, cash-ups, and kitchen tickets.',
    },
    { id: 'stock', label: 'Stock', hint: 'Every item’s stock back to zero, with its stock history and counts.' },
    {
      id: 'catalog',
      label: retail ? 'Products' : 'Menu',
      hint: retail
        ? 'Items, products, and promotions — and their stock. Categories stay.'
        : 'Items, set meals, and promotions — and their stock. Categories stay.',
    },
    { id: 'purchases', label: 'Suppliers & purchases', hint: 'Suppliers, purchase orders, and bills.' },
    { id: 'expenses', label: 'Expenses', hint: 'Every expense recorded.' },
    { id: 'staffRecords', label: 'Timecards & payroll', hint: 'Clock-ins and salary runs. Staff accounts stay.' },
    {
      id: 'all',
      label: 'Everything',
      hint: 'Every record and setting, staff included. The shop starts over from setup.',
    },
  ];
}

/**
 * Deletes the parts of the shop's data the owner picks, or all of it, once
 * the shop account's password is confirmed. A device with no shop account
 * has no password, so it takes a PIN that can change settings instead.
 */
export function ResetDataDialog({
  open,
  shopEmail,
  onClose,
}: {
  open: boolean;
  /** The shop account this device is signed in to; null when it keeps data only here. */
  shopEmail: string | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const { resetData, resetAllData, approve } = usePos();
  const { retail } = useBusiness();
  const [picked, setPicked] = useState<Set<Choice>>(new Set());
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    // Each opening starts blank — nothing picked, no password left behind.
    if (!open) {
      setPicked(new Set());
      setSecret('');
      setError(null);
      setDone(null);
    }
  }, [open]);

  const options = optionsFor(retail);
  const all = picked.has('all');
  // Clearing items takes their stock with them.
  const isOn = (id: Choice) => all || picked.has(id) || (id === 'stock' && picked.has('catalog'));
  const forced = (id: Choice) => id !== 'all' && (all || (id === 'stock' && picked.has('catalog')));

  function toggle(id: Choice, on: boolean) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
    setError(null);
  }

  async function confirmed(): Promise<string | null> {
    if (!shopEmail || !supabase) {
      return approve(secret, 'settings') ? null : 'That PIN can’t change settings.';
    }
    const { error } = await supabase.auth.signInWithPassword({ email: shopEmail, password: secret });
    if (!error) return null;
    return error.message === 'Invalid login credentials'
      ? 'That password isn’t right.'
      : 'Couldn’t check the password. Check the connection and try again.';
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (picked.size === 0 || !secret) return;
    setBusy(true);
    setError(null);
    const problem = await confirmed();
    if (problem) {
      setBusy(false);
      setError(problem);
      return;
    }
    if (all) {
      // Reloads into the new-shop setup once it's gone.
      await resetAllData();
      setBusy(false);
      return;
    }
    const parts = options.map((o) => o.id).filter((id): id is ResetPart => id !== 'all' && isOn(id));
    resetData(parts);
    setBusy(false);
    setSecret('');
    setPicked(new Set());
    setDone(
      `Deleted: ${options
        .filter((o) => parts.includes(o.id as ResetPart))
        .map((o) => o.label.toLowerCase())
        .join(', ')}.`,
    );
  }

  return (
    <dialog
      ref={ref}
      className="reset"
      aria-labelledby="reset-title"
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <form className="reset__body" onSubmit={submit}>
        <header className="reset__head">
          <h2 id="reset-title" className="reset__title">
            Reset data
          </h2>
          <button type="button" className="reset__close" onClick={onClose} disabled={busy} aria-label="Cancel reset">
            <span aria-hidden="true">×</span>
          </button>
        </header>

        <p className="reset__note">
          Pick what to delete. It goes {shopEmail ? 'for this shop, on every device,' : 'from this register'} and
          can’t be undone. Staff, settings, {retail ? '' : 'tables, '}and categories stay unless you pick
          Everything.
        </p>

        <fieldset className="reset__options" disabled={busy}>
          <legend className="reset__legend">What to delete</legend>
          {options.map((o) => (
            <label key={o.id} className={o.id === 'all' ? 'reset__option reset__option--all' : 'reset__option'}>
              <input
                type="checkbox"
                checked={isOn(o.id)}
                disabled={forced(o.id)}
                onChange={(e) => toggle(o.id, e.target.checked)}
              />
              <span>
                {o.label}
                <span className="reset__option-sub">{o.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <label className="reset__field">
          <span>{shopEmail ? 'Shop account password' : 'Owner or manager PIN'}</span>
          {shopEmail && <span className="reset__field-sub">{shopEmail}</span>}
          <input
            type="password"
            autoComplete={shopEmail ? 'current-password' : 'off'}
            inputMode={shopEmail ? undefined : 'numeric'}
            value={secret}
            disabled={busy}
            onChange={(e) => {
              setSecret(e.target.value);
              setError(null);
            }}
            aria-invalid={!!error}
          />
        </label>

        {error && (
          <p className="reset__error" role="alert">
            {error}
          </p>
        )}
        {done && (
          <p className="reset__done" role="status">
            {done}
          </p>
        )}

        <div className="reset__actions">
          <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={busy}>
            {done ? 'Close' : 'Cancel'}
          </Button>
          <Button type="submit" size="sm" disabled={busy || picked.size === 0 || !secret}>
            {busy ? 'Checking…' : all ? 'Delete everything' : 'Delete selected'}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
