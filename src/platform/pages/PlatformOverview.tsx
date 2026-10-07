import { Link } from 'react-router';
import { formatDay, subscriptionState } from '../../lib/subscription';
import { money } from '../api';
import { usePlatform } from '../PlatformData';
import { Runway } from '../Runway';

/** The whole platform at a glance: how long each shop is paid for, and what came in. */
export function PlatformOverview() {
  const { shops, plans, payments } = usePlatform();
  const states = shops.map((shop) => ({ shop, ...subscriptionState(shop) }));
  const count = (...statuses: string[]) => states.filter((s) => statuses.includes(s.status)).length;
  const onTrial = states.filter((s) => s.trial && (s.status === 'active' || s.status === 'expiring')).length;

  // What paying shops bring in per month, per currency — plans can differ in both.
  const monthly = new Map<string, number>();
  for (const { shop, status, trial } of states) {
    const plan = plans.find((p) => p.id === shop.plan_id);
    // Lifetime plans were paid once, and trials haven't paid yet: neither brings in money month to month.
    if (!plan || plan.period_months === 0 || trial || status === 'locked' || status === 'suspended') continue;
    monthly.set(plan.currency, (monthly.get(plan.currency) ?? 0) + plan.price / plan.period_months);
  }

  const tally = [
    { value: shops.length, label: shops.length === 1 ? 'shop' : 'shops' },
    { value: count('active', 'expiring') - onTrial, label: 'paid up' },
    { value: onTrial, label: 'on free trial' },
    { value: count('expiring', 'grace'), label: 'to chase', warn: true },
    { value: count('locked', 'suspended'), label: 'locked', bad: true },
  ];

  return (
    <>
      <div className="pf-head">
        <h1 className="pf-title">Overview</h1>
        <p className="pf-tally">
          {tally.map((t) => (
            <span
              key={t.label}
              className={t.value > 0 && t.bad ? 'pf-tally__item pf-tally__item--bad' : t.value > 0 && t.warn ? 'pf-tally__item pf-tally__item--warn' : 'pf-tally__item'}
            >
              <strong>{t.value}</strong> {t.label}
            </span>
          ))}
          <span className="pf-tally__item pf-tally__item--money">
            {monthly.size === 0 ? (
              'No monthly income yet'
            ) : (
              <>
                <strong>{[...monthly].map(([c, a]) => money(a, c)).join(' + ')}</strong> a month
              </>
            )}
          </span>
        </p>
      </div>

      <section className="pf-panel pf-panel--runway" aria-labelledby="runway-title">
        <div className="pf-panel__head">
          <h2 className="pf-panel__title" id="runway-title">
            How long each shop is paid for
          </h2>
          <p className="pf-panel__note">
            Solid is paid time, striped is a free trial, hatched is the grace period before the register locks.
          </p>
        </div>
        {shops.length === 0 ? (
          <p className="pf-empty">
            No shops yet. <Link to="/platform/shops">Add the first shop</Link> to see it here.
          </p>
        ) : (
          <Runway shops={shops} plans={plans} />
        )}
      </section>

      <section className="pf-panel" aria-labelledby="recent-title">
        <div className="pf-panel__head">
          <h2 className="pf-panel__title" id="recent-title">
            Latest payments
          </h2>
          {payments.length > 0 && <Link to="/platform/payments">All payments</Link>}
        </div>
        {payments.length === 0 ? (
          <p className="pf-empty">No payments yet. Record one from a shop’s page when it pays.</p>
        ) : (
          <ul className="pf-list">
            {payments.slice(0, 8).map((p) => (
              <li key={p.id} className="pf-list__row">
                <span className="pf-list__main">
                  <span className="pf-list__name">{p.shop_name}</span>
                  <span className="pf-list__sub">
                    {formatDay(p.paid_at)}, {p.method}
                  </span>
                </span>
                <span className="pf-num">{money(p.amount, p.currency)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
