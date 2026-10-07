import { useState } from 'react';
import { Button } from '../../components/Button';
import { Mono } from '../../components/Mono';
import { Switch } from '../../components/Switch';
import { CURRENCIES } from '../../lib/currency';
import { addPlan, deletePlan, money, periodLabel, updatePlan, type Plan } from '../api';
import { usePlatform } from '../PlatformData';

/** 0 is lifetime: paid once, never ends. */
const PERIODS = [1, 3, 6, 12, 0];

/**
 * What shops can pay for. Edits apply in place, like Staff. A plan any shop
 * is on can be retired (no longer offered) but not deleted.
 */
export function PlatformPlans() {
  const { client, plans, shops, reload } = usePlatform();
  const [error, setError] = useState<string | null>(null);

  async function add() {
    try {
      await addPlan(client);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Plans</h1>
          <div className="page-sub">What shops pay, and how often. Every plan has every feature.</div>
        </div>
        <div className="head-actions">
          <Button onClick={() => void add()}>Add plan</Button>
        </div>
      </div>
      {error && (
        <p className="pf-error" role="alert">
          {error}
        </p>
      )}

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
        {plans.length === 0 ? (
          <p className="pf-empty">No plans yet — add one, then give it to shops.</p>
        ) : (
          plans.map((plan) => (
            <PlanRow key={plan.id} plan={plan} shopCount={shops.filter((s) => s.plan_id === plan.id).length} />
          ))
        )}
      </section>
    </>
  );
}

function PlanRow({ plan, shopCount }: { plan: Plan; shopCount: number }) {
  const { client, reload } = usePlatform();
  const [name, setName] = useState(plan.name);
  const [price, setPrice] = useState(String(plan.price));
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(patch: Partial<Plan>) {
    try {
      setError(null);
      await updatePlan(client, plan.id, patch);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function remove() {
    try {
      await deletePlan(client, plan.id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className={plan.active ? 'pf-row pf-row--plan' : 'pf-row pf-row--plan pf-row--muted'}>
      <span>
        <label className="sr-only" htmlFor={`plan-name-${plan.id}`}>
          Plan name
        </label>
        <input
          id={`plan-name-${plan.id}`}
          className="pf-input pf-input--wide"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            const next = name.trim();
            if (!next) return setName(plan.name);
            if (next !== plan.name) void save({ name: next });
          }}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        {error && <p className="pf-error">{error}</p>}
      </span>
      <span>
        <label className="sr-only" htmlFor={`plan-price-${plan.id}`}>
          Price for {plan.name}
        </label>
        <input
          id={`plan-price-${plan.id}`}
          className="pf-input mono"
          type="number"
          min={0}
          step="any"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          onBlur={() => {
            const next = Number(price);
            if (!Number.isFinite(next) || next < 0) return setPrice(String(plan.price));
            if (next !== plan.price) void save({ price: next });
          }}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        <span className="pf-line__sub pf-row__hint">{money(plan.price, plan.currency)}</span>
      </span>
      <span>
        <select
          className="pf-input"
          aria-label={`Currency for ${plan.name}`}
          value={plan.currency}
          onChange={(e) => void save({ currency: e.target.value })}
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
          aria-label={`Billing period for ${plan.name}`}
          value={plan.period_months}
          onChange={(e) => void save({ period_months: Number(e.target.value) })}
        >
          {PERIODS.map((m) => (
            <option key={m} value={m}>
              {periodLabel(m)}
            </option>
          ))}
        </select>
      </span>
      <Mono>{shopCount}</Mono>
      <span>
        <Switch checked={plan.active} onChange={(active) => void save({ active })} label={`Offer ${plan.name}`} />
      </span>
      <span className="pf-row__end">
        <Button
          variant="secondary"
          size="sm"
          className={confirming ? 'pf-delete' : undefined}
          disabled={shopCount > 0}
          title={shopCount > 0 ? 'Shops are on this plan — switch it off instead.' : undefined}
          onClick={() => (confirming ? void remove() : setConfirming(true))}
          onBlur={() => setConfirming(false)}
          aria-label={confirming ? `Confirm deleting ${plan.name}` : `Delete ${plan.name}`}
        >
          {confirming ? 'Confirm' : 'Delete'}
        </Button>
      </span>
    </div>
  );
}
