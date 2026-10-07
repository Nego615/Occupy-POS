import { useState } from 'react';
import { Button } from '../../components/Button';
import { Switch } from '../../components/Switch';
import { CURRENCIES } from '../../lib/currency';
import { addPlan, deletePlan, money, periodLabel, updatePlan, type Plan, type PlanFields } from '../api';
import { usePlatform } from '../PlatformData';
import { useUnsaved } from '../Unsaved';

/** 0 is lifetime: paid once, never ends. */
const PERIODS = [1, 3, 6, 12, 0];

const NEW_PLAN: PlanFields = { name: '', price: 0, currency: 'TZS', period_months: 1, active: true };

/**
 * What shops can pay for. Edits stay on the row until saved, so nothing
 * changes for shops by accident. A plan any shop is on can be retired (no
 * longer offered) but not deleted.
 */
export function PlatformPlans() {
  const { plans, shops } = usePlatform();
  // A plan being added: shown at the top, not stored until it's saved.
  const [adding, setAdding] = useState(false);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Plans</h1>
          <div className="page-sub">What shops pay, and how often. Every plan has every feature.</div>
        </div>
        <div className="head-actions">
          <Button onClick={() => setAdding(true)} disabled={adding}>
            Add plan
          </Button>
        </div>
      </div>

      <section className="panel" aria-label="Plans">
        <div className="pf-row pf-row--plan pf-row--head" aria-hidden="true">
          <span>Name</span>
          <span>Price</span>
          <span>Currency</span>
          <span>Billed</span>
          <span>Shops</span>
          <span>Offered</span>
          <span />
        </div>
        {adding && <PlanRow onDone={() => setAdding(false)} />}
        {plans.length === 0 && !adding ? (
          <p className="pf-empty">No plans yet. Add one, then give it to shops.</p>
        ) : (
          plans.map((plan) => (
            <PlanRow key={plan.id} plan={plan} shopCount={shops.filter((s) => s.plan_id === plan.id).length} />
          ))
        )}
      </section>
    </>
  );
}

const fieldsOf = (plan: Plan): PlanFields => ({
  name: plan.name,
  price: plan.price,
  currency: plan.currency,
  period_months: plan.period_months,
  active: plan.active,
});

/** One plan, or a new one when `plan` is absent. Saved with its Save button only. */
function PlanRow({ plan, shopCount = 0, onDone }: { plan?: Plan; shopCount?: number; onDone?: () => void }) {
  const { client, reload } = usePlatform();
  const saved = plan ? fieldsOf(plan) : NEW_PLAN;
  const [draft, setDraft] = useState(saved);
  // Typed text for the price, so a half-typed number isn't rewritten as you type.
  const [price, setPrice] = useState(plan ? String(plan.price) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  const isNew = !plan;
  const dirty = isNew || JSON.stringify(draft) !== JSON.stringify(saved) || price !== String(saved.price);
  const label = isNew ? 'The new plan' : `The ${plan.name} plan`;

  function discard() {
    setDraft(saved);
    setPrice(plan ? String(plan.price) : '');
    setError(null);
    if (isNew) onDone?.();
  }

  const { id: formId, confirmDiscard } = useUnsaved(label, dirty, discard);

  const set = (patch: Partial<PlanFields>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setJustSaved(false);
  };

  async function save() {
    const name = draft.name.trim();
    const value = Number(price.replace(/,/g, ''));
    if (!name) return setError('Give the plan a name.');
    if (!price.trim() || !Number.isFinite(value) || value < 0) return setError('Enter a price of 0 or more.');
    setBusy(true);
    setError(null);
    try {
      const fields = { ...draft, name, price: value };
      if (plan) await updatePlan(client, plan.id, fields);
      else await addPlan(client, fields);
      await reload();
      // Fresh from the server, so the row reads clean.
      setDraft(fields);
      setPrice(String(value));
      setJustSaved(true);
      onDone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!plan || !(await confirmDiscard(formId))) return;
    try {
      await deletePlan(client, plan.id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const rowId = plan?.id ?? 'new';
  const classes = ['pf-row', 'pf-row--plan', draft.active ? '' : 'pf-row--muted', dirty ? 'pf-row--dirty' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <form
      className={classes}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && dirty) {
          e.preventDefault();
          discard();
        }
      }}
    >
      <span>
        <label className="sr-only" htmlFor={`plan-name-${rowId}`}>
          Plan name
        </label>
        <input
          id={`plan-name-${rowId}`}
          className="pf-input pf-input--wide"
          type="text"
          placeholder="Plan name"
          autoFocus={isNew}
          value={draft.name}
          onChange={(e) => set({ name: e.target.value })}
        />
        {error && <p className="pf-error">{error}</p>}
      </span>
      <span>
        <label className="sr-only" htmlFor={`plan-price-${rowId}`}>
          Price
        </label>
        <input
          id={`plan-price-${rowId}`}
          className="pf-input mono"
          type="text"
          inputMode="decimal"
          placeholder="0"
          value={price}
          onChange={(e) => {
            setPrice(e.target.value);
            setJustSaved(false);
          }}
        />
        {plan && <span className="pf-line__sub pf-row__hint">Now {money(plan.price, plan.currency)}</span>}
      </span>
      <span>
        <select
          className="pf-input"
          aria-label="Currency"
          value={draft.currency}
          onChange={(e) => set({ currency: e.target.value })}
        >
          {CURRENCIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code}
            </option>
          ))}
        </select>
      </span>
      <span>
        <select
          className="pf-input"
          aria-label="Billing period"
          value={draft.period_months}
          onChange={(e) => set({ period_months: Number(e.target.value) })}
        >
          {PERIODS.map((m) => (
            <option key={m} value={m}>
              {periodLabel(m)}
            </option>
          ))}
        </select>
      </span>
      <span className="pf-num">{isNew ? '—' : shopCount}</span>
      <span>
        <Switch
          checked={draft.active}
          onChange={(active) => set({ active })}
          label={`Offer ${draft.name || 'this plan'} to shops`}
        />
      </span>
      <span className="pf-row__end">
        {dirty ? (
          <span className="pf-row__save">
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? 'Saving…' : isNew ? 'Add' : 'Save'}
            </Button>
            <Button variant="secondary" size="sm" onClick={discard} disabled={busy}>
              {isNew ? 'Cancel' : 'Discard'}
            </Button>
          </span>
        ) : justSaved ? (
          <span className="pf-saved" role="status">
            Saved
          </span>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            className={confirmingDelete ? 'pf-delete' : undefined}
            disabled={shopCount > 0}
            title={shopCount > 0 ? 'Shops are on this plan. Switch off “Offered” instead.' : undefined}
            onClick={() => (confirmingDelete ? void remove() : setConfirmingDelete(true))}
            onBlur={() => setConfirmingDelete(false)}
            aria-label={confirmingDelete ? `Confirm deleting ${draft.name}` : `Delete ${draft.name}`}
          >
            {confirmingDelete ? 'Confirm' : 'Delete'}
          </Button>
        )}
      </span>
    </form>
  );
}
