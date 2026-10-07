import { useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { Button } from '../../components/Button';
import { Mono } from '../../components/Mono';
import { dayCount, formatDay, subscriptionState } from '../../lib/subscription';
import {
  ago,
  deleteShop,
  isLifetime,
  money,
  periodLabel,
  planLabel,
  recordPayment,
  resetPassword,
  startTrial,
  updateShop,
  type Plan,
  type Shop,
} from '../api';
import { usePlatform } from '../PlatformData';
import { Runway } from '../Runway';
import { useUnsaved } from '../Unsaved';

const METHODS = ['M-Pesa', 'Bank transfer', 'Cash', 'Card', 'Other'];

/** Wraps an action so its failure shows beside it instead of being lost. */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(action: () => Promise<void>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

/** One shop: its subscription, payments, details and account. */
export function PlatformShop() {
  const { id } = useParams();
  const { shops, plans, payments, stats } = usePlatform();
  const shop = shops.find((s) => s.store_id === id);
  if (!shop) return <Navigate to="/platform/shops" replace />;

  const plan = plans.find((p) => p.id === shop.plan_id);
  const state = subscriptionState(shop);
  const usage = stats.get(shop.store_id);
  const history = payments.filter((p) => p.store_id === shop.store_id);

  return (
    <>
      <Link to="/platform/shops" className="pf-back">
        ← Shops
      </Link>
      <div className="page-head">
        <div>
          <h1 className="page-title">{shop.name}</h1>
          <div className="page-sub">
            {shop.owner_email}
            {shop.phone && <> · {shop.phone}</>}
          </div>
        </div>
      </div>

      <section className="panel pf-section pf-panel--runway" aria-label="Paid time">
        <Runway shops={[shop]} plans={plans} single />
      </section>

      <div className="pf-cols">
        <section className="panel" aria-labelledby="sub-title">
          <h2 className="panel__title" id="sub-title">
            Subscription
          </h2>
          <dl className="pf-facts">
            <Fact label="Plan">{plan
                ? `${plan.name}: ${money(plan.price, plan.currency)} ${isLifetime(plan) ? 'once' : periodLabel(plan.period_months).toLowerCase()}`
                : 'None'}</Fact>
            <Fact label={shop.trial ? 'Free trial until' : 'Paid until'}>
              <Mono>{shop.paid_until ? formatDay(shop.paid_until) : plan && isLifetime(plan) ? 'Lifetime' : 'No end date'}</Mono>
              {state.status === 'grace' && state.daysLeft !== null && (
                <span className="pf-facts__note"> · locks in {dayCount(state.daysLeft)}</span>
              )}
            </Fact>
            <Fact label="Grace after expiry">{dayCount(shop.grace_days)}</Fact>
          </dl>
          {/* Trials are for shops that haven't paid yet, or are already on one. */}
          {(shop.trial || history.length === 0) && <FreeTrial shop={shop} />}
          <RecordPayment shop={shop} />
        </section>

        <section className="panel" aria-labelledby="usage-title">
          <h2 className="panel__title" id="usage-title">
            Usage
          </h2>
          <dl className="pf-facts">
            <Fact label="Last used">{ago(usage?.last_activity ?? null)}</Fact>
            <Fact label="Orders">
              <Mono>{usage?.orders ?? 0}</Mono>
            </Fact>
            <Fact label="Staff">
              <Mono>{usage?.staff ?? 0}</Mono>
            </Fact>
            <Fact label="Customer since">
              <Mono>{formatDay(shop.created_at)}</Mono>
            </Fact>
          </dl>
        </section>
      </div>

      <section className="panel pf-section" aria-labelledby="history-title">
        <h2 className="panel__title" id="history-title">
          Payments
        </h2>
        {history.length === 0 ? (
          <p className="pf-empty">No payments recorded for this shop.</p>
        ) : (
          history.map((p) => (
            <div key={p.id} className="pf-row pf-row--payment">
              <Mono>{formatDay(p.paid_at)}</Mono>
              <span>
                {p.method}
                {p.reference && <span className="pf-line__sub"> · {p.reference}</span>}
              </span>
              <span>{p.periods === 1 ? '1 period' : `${p.periods} periods`}</span>
              <Mono className="pf-row__amount">{money(p.amount, p.currency)}</Mono>
            </div>
          ))
        )}
      </section>

      <ShopDetails shop={shop} plans={plans} />
      <AccountActions shop={shop} />
    </>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="pf-facts__row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** Starts a free trial, or adds days to the one running. */
function FreeTrial({ shop }: { shop: Shop }) {
  const { client, reload } = usePlatform();
  const [days, setDays] = useState('14');
  const [done, setDone] = useState(false);
  const { busy, error, run } = useAction();
  const running = shop.trial && !!shop.paid_until && new Date(shop.paid_until).getTime() > Date.now();
  const n = Math.max(1, Math.min(365, Math.floor(Number(days) || 0)));
  const { id: formId, confirmDiscard } = useUnsaved('The free trial form', days !== '14', () => setDays('14'));

  async function submit() {
    // Starting a trial reloads the shop, which would reset half-edited details.
    if (!(await confirmDiscard(formId))) return;
    const ok = await run(async () => {
      await startTrial(client, shop, n);
      await reload();
    });
    if (ok) {
      setDays('14');
      setDone(true);
    }
  }

  return (
    <form
      className="pf-pay pf-trial"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h3 className="pf-pay__title">{running ? 'Extend the free trial' : 'Give a free trial'}</h3>
      <p className="pf-line__sub">
        {running
          ? 'Adds days to the end of the trial. Recording a payment ends it.'
          : 'The register works for these days without payment. Recording a payment ends the trial.'}
      </p>
      <div className="pf-actions">
        <label className="counter-field pf-trial__days">
          <span>Days</span>
          <input
            className="mono"
            type="number"
            min={1}
            max={365}
            value={days}
            onChange={(e) => {
              setDays(e.target.value);
              setDone(false);
            }}
          />
        </label>
        <Button type="submit" variant="secondary" disabled={busy}>
          {busy ? 'Saving…' : running ? `Add ${dayCount(n)}` : `Start ${dayCount(n)} trial`}
        </Button>
        {done && !busy && <span className="pf-saved" role="status">{running ? 'Trial extended' : 'Trial started'}</span>}
      </div>
      {error && (
        <p className="pf-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

/** Takes a payment and extends the shop by whole plan periods. */
function RecordPayment({ shop }: { shop: Shop }) {
  const { client, plans, reload } = usePlatform();
  const choosable = plans.filter((p) => p.active || p.id === shop.plan_id);
  const [planId, setPlanId] = useState(shop.plan_id ?? choosable[0]?.id ?? '');
  const [periods, setPeriods] = useState('1');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState(METHODS[0]);
  const [reference, setReference] = useState('');
  const [done, setDone] = useState(false);
  const { busy, error, run } = useAction();
  const plan = plans.find((p) => p.id === planId);
  const lifetime = !!plan && isLifetime(plan);
  // A lifetime plan is bought once, whatever the periods field says.
  const n = lifetime ? 1 : Math.max(1, Math.floor(Number(periods) || 1));
  const months = plan ? n * plan.period_months : 0;
  const suggested = plan ? String(plan.price * n) : '';

  // The amount follows the plan and periods until it's typed over. Keyed on the
  // price, not the plan object, so a reload doesn't overwrite a typed amount.
  useEffect(() => {
    setAmount(suggested);
  }, [suggested]);

  const startPlan = shop.plan_id ?? choosable[0]?.id ?? '';
  const dirty =
    planId !== startPlan || periods !== '1' || method !== METHODS[0] || reference !== '' || amount !== suggested;
  function clear() {
    setPlanId(startPlan);
    setPeriods('1');
    setMethod(METHODS[0]);
    setReference('');
    setAmount(suggested);
  }
  const { id: formId, confirmDiscard } = useUnsaved('The payment form', dirty, clear);

  if (choosable.length === 0) {
    return (
      <p className="pf-empty">
        Add a plan on <Link to="/platform/plans">Plans</Link> to record payments.
      </p>
    );
  }

  async function submit() {
    // Recording reloads the shop, which would reset its half-edited details.
    if (!plan || !(await confirmDiscard(formId))) return;
    const ok = await run(async () => {
      await recordPayment(client, {
        store: shop.store_id,
        plan: plan.id,
        amount: Number(amount) || 0,
        method,
        reference: reference.trim(),
        periods: n,
      });
      await reload();
    });
    if (ok) {
      clear();
      setDone(true);
    }
  }

  return (
    <form
      className="pf-pay"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h3 className="pf-pay__title">{shop.trial ? 'Record the first payment' : 'Record a payment'}</h3>
      {shop.trial && <p className="pf-line__sub">Ends the free trial. Paid time starts today.</p>}
      <div className="pf-field-pair">
        <label className="counter-field">
          <span>Plan</span>
          <select className="counter-field__input" value={planId} onChange={(e) => setPlanId(e.target.value)}>
            {choosable.map((p) => (
              <option key={p.id} value={p.id}>
                {planLabel(p)}
              </option>
            ))}
          </select>
        </label>
        <label className="counter-field">
          <span>Periods paid</span>
          <input
            className="mono"
            type="number"
            min={1}
            max={36}
            value={lifetime ? 1 : periods}
            disabled={lifetime}
            onChange={(e) => setPeriods(e.target.value)}
          />
        </label>
      </div>
      <div className="pf-field-pair">
        <label className="counter-field">
          <span>Amount{plan ? ` (${plan.currency})` : ''}</span>
          <input
            className="mono"
            type="number"
            min={0}
            step="any"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="counter-field">
          <span>Method</span>
          <select className="counter-field__input" value={method} onChange={(e) => setMethod(e.target.value)}>
            {METHODS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="counter-field">
        <span>Reference (M-Pesa code, slip no.)</span>
        <input type="text" value={reference} onChange={(e) => setReference(e.target.value)} />
      </label>
      {error && (
        <p className="pf-error" role="alert">
          {error}
        </p>
      )}
      <div className="pf-actions">
        <Button type="submit" disabled={busy || !plan}>
          {busy
            ? 'Saving…'
            : lifetime
              ? 'Record payment · lifetime, never ends'
              : `Record payment · adds ${months} month${months === 1 ? '' : 's'}`}
        </Button>
        {dirty && !busy && (
          <Button variant="secondary" onClick={clear}>
            Clear
          </Button>
        )}
        {done && !busy && !dirty && <span className="pf-saved" role="status">Recorded</span>}
      </div>
    </form>
  );
}

/** The shop's name, contact, notes, plan and grace days — saved together. */
function ShopDetails({ shop, plans }: { shop: Shop; plans: Plan[] }) {
  const { client, reload } = usePlatform();
  const initial = {
    name: shop.name,
    phone: shop.phone ?? '',
    notes: shop.notes ?? '',
    plan_id: shop.plan_id ?? '',
    grace_days: String(shop.grace_days),
    paid_until: shop.paid_until ? shop.paid_until.slice(0, 10) : '',
  };
  const [draft, setDraft] = useState(initial);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  const initialJson = JSON.stringify(initial);
  const dirty = JSON.stringify(draft) !== initialJson;
  // A payment or another save changes the shop underneath — start again from what's stored.
  useEffect(() => setDraft(JSON.parse(initialJson) as typeof initial), [initialJson]);
  const set = (patch: Partial<typeof draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setSaved(false);
  };
  const discard = () => setDraft(JSON.parse(initialJson) as typeof initial);
  useUnsaved('Shop details', dirty, discard);

  async function save() {
    const name = draft.name.trim();
    const ok = await run(async () => {
      if (!name) throw new Error('The shop needs a name.');
      // A hand-set end date runs to the end of that day.
      const paidUntil = draft.paid_until ? new Date(`${draft.paid_until}T23:59:59`).toISOString() : null;
      await updateShop(client, shop.store_id, {
        name,
        phone: draft.phone.trim() || null,
        notes: draft.notes.trim() || null,
        plan_id: draft.plan_id || null,
        grace_days: Math.max(0, Math.floor(Number(draft.grace_days) || 0)),
        ...(draft.paid_until !== initial.paid_until ? { paid_until: paidUntil } : {}),
      });
      await reload();
    });
    if (ok) setSaved(true);
  }

  return (
    <section className="panel pf-section" aria-labelledby="details-title">
      <h2 className="panel__title" id="details-title">
        Details
      </h2>
      <form
        className="pf-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="pf-field-pair">
          <label className="counter-field">
            <span>Shop name</span>
            <input type="text" value={draft.name} onChange={(e) => set({ name: e.target.value })} />
          </label>
          <label className="counter-field">
            <span>Phone</span>
            <input type="tel" value={draft.phone} onChange={(e) => set({ phone: e.target.value })} />
          </label>
        </div>
        <div className="pf-field-trio">
          <label className="counter-field">
            <span>Plan</span>
            <select className="counter-field__input" value={draft.plan_id} onChange={(e) => set({ plan_id: e.target.value })}>
              <option value="">No plan</option>
              {plans
                .filter((p) => p.active || p.id === shop.plan_id)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {planLabel(p)}
                  </option>
                ))}
            </select>
          </label>
          <label className="counter-field">
            <span>Paid until (correct by hand)</span>
            <input className="mono" type="date" value={draft.paid_until} onChange={(e) => set({ paid_until: e.target.value })} />
          </label>
          <label className="counter-field">
            <span>Grace days after expiry</span>
            <input
              className="mono"
              type="number"
              min={0}
              max={90}
              value={draft.grace_days}
              onChange={(e) => set({ grace_days: e.target.value })}
            />
          </label>
        </div>
        <label className="counter-field">
          <span>Notes (only you see these)</span>
          <textarea
            className="counter-field__input pf-notes"
            rows={3}
            value={draft.notes}
            onChange={(e) => set({ notes: e.target.value })}
          />
        </label>
        {error && (
          <p className="pf-error" role="alert">
            {error}
          </p>
        )}
        <div className="pf-actions">
          <Button type="submit" disabled={!dirty || busy}>
            {busy ? 'Saving…' : 'Save details'}
          </Button>
          {dirty && !busy && (
            <Button variant="secondary" onClick={discard}>
              Discard changes
            </Button>
          )}
          {saved && !dirty && <span className="pf-saved" role="status">Saved</span>}
        </div>
      </form>
    </section>
  );
}

/** Password reset, suspension and deletion. */
function AccountActions({ shop }: { shop: Shop }) {
  const { client, reload } = usePlatform();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [passwordSet, setPasswordSet] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const pw = useAction();
  const suspend = useAction();
  const remove = useAction();
  const { id: passwordForm, confirmDiscard } = useUnsaved('The new password', password !== '' && !passwordSet, () => setPassword(''));

  async function changePassword() {
    const ok = await pw.run(async () => {
      await resetPassword(client, shop.store_id, password);
    });
    if (ok) {
      setPasswordSet(true);
    }
  }

  async function toggleSuspended() {
    // Reloads the shop, which would reset half-edited details (not the password).
    if (!(await confirmDiscard(passwordForm))) return;
    await suspend.run(async () => {
      await updateShop(client, shop.store_id, { suspended: !shop.suspended });
      await reload();
    });
  }

  async function destroy() {
    if (!(await confirmDiscard())) return;
    const ok = await remove.run(async () => {
      await deleteShop(client, shop.store_id);
      await reload();
    });
    if (ok) navigate('/platform/shops', { replace: true });
  }

  return (
    <section className="panel pf-section" aria-labelledby="account-title">
      <h2 className="panel__title" id="account-title">
        Account
      </h2>

      <div className="pf-danger">
        <div className="pf-danger__text">
          <div className="pf-danger__title">Set a new password</div>
          <div className="pf-line__sub">Registers already signed in stay signed in.</div>
        </div>
        <form
          className="pf-danger__controls"
          onSubmit={(e) => {
            e.preventDefault();
            void changePassword();
          }}
        >
          <label className="sr-only" htmlFor="pf-new-password">
            New password
          </label>
          <input
            id="pf-new-password"
            className="pf-input mono"
            type="text"
            autoComplete="off"
            minLength={8}
            required
            placeholder="At least 8 characters"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setPasswordSet(false);
            }}
          />
          <Button type="submit" variant="secondary" disabled={pw.busy}>
            Set password
          </Button>
          {passwordSet && <span className="pf-saved" role="status">Password set</span>}
          {pw.error && <p className="pf-error" role="alert">{pw.error}</p>}
        </form>
      </div>

      <div className="pf-danger">
        <div className="pf-danger__text">
          <div className="pf-danger__title">{shop.suspended ? 'Reactivate this shop' : 'Suspend this shop'}</div>
          <div className="pf-line__sub">
            {shop.suspended
              ? 'Its registers open again, following its paid-until date.'
              : 'Locks its registers now, whatever it has paid. Nothing is deleted.'}
          </div>
        </div>
        <div className="pf-danger__controls">
          <Button variant="secondary" onClick={() => void toggleSuspended()} disabled={suspend.busy}>
            {shop.suspended ? 'Reactivate' : 'Suspend'}
          </Button>
          {suspend.error && <p className="pf-error" role="alert">{suspend.error}</p>}
        </div>
      </div>

      <div className="pf-danger">
        <div className="pf-danger__text">
          <div className="pf-danger__title">Delete this shop</div>
          <div className="pf-line__sub">
            Deletes the account and every order, item and staff record it holds. Its payments stay in the
            ledger. This can’t be undone.
          </div>
        </div>
        <form
          className="pf-danger__controls"
          onSubmit={(e) => {
            e.preventDefault();
            if (confirmName.trim() === shop.name) void destroy();
          }}
        >
          <label className="sr-only" htmlFor="pf-confirm-name">
            Type {shop.name} to confirm
          </label>
          <input
            id="pf-confirm-name"
            className="pf-input"
            type="text"
            autoComplete="off"
            placeholder={`Type “${shop.name}”`}
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
          />
          <Button
            type="submit"
            variant="secondary"
            className="pf-delete"
            disabled={confirmName.trim() !== shop.name || remove.busy}
          >
            {remove.busy ? 'Deleting…' : 'Delete shop'}
          </Button>
          {remove.error && <p className="pf-error" role="alert">{remove.error}</p>}
        </form>
      </div>
    </section>
  );
}
