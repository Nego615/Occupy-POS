import type { CSSProperties } from 'react';
import { Link } from 'react-router';
import { formatDay, subscriptionState, type SubscriptionStatus } from '../lib/subscription';
import { isLifetime, type Plan, type Shop } from './api';
import { ShopStatus } from './ShopStatus';

const DAY = 24 * 60 * 60 * 1000;
/** The window drawn: a month behind today, three ahead. */
const BEHIND = 30;
const AHEAD = 90;
const SPAN = BEHIND + AHEAD;

/** Position of a time in the window, 0–100, clamped. */
function pct(t: number, start: number): number {
  return Math.min(100, Math.max(0, ((t - start) / (SPAN * DAY)) * 100));
}

/** Most urgent first: locked, in grace, ending soon, then by end date; open-ended last. */
const URGENCY: Record<SubscriptionStatus, number> = { locked: 0, grace: 1, expiring: 2, active: 3, suspended: 4 };

function shortDay(t: number): string {
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/**
 * Each shop's paid-up time as a bar against today. Grace days hang off the
 * end as a hatched tail, so a lapsing shop reads at a glance — the bar has
 * ended, the hatching is running out.
 */
export function Runway({ shops, plans, single = false }: { shops: Shop[]; plans: Plan[]; single?: boolean }) {
  const now = Date.now();
  const start = now - BEHIND * DAY;
  const todayAt = pct(now, start);
  const ticks = [-30, 30, 60, 90].map((d) => now + d * DAY);

  const rows = shops
    .map((shop) => ({ shop, state: subscriptionState(shop) }))
    .sort(
      (a, b) =>
        URGENCY[a.state.status] - URGENCY[b.state.status] ||
        (a.shop.paid_until ?? '9999').localeCompare(b.shop.paid_until ?? '9999'),
    );

  return (
    <div className={single ? 'runway runway--single' : 'runway'}>
      <div className="runway__scale" aria-hidden="true">
        <span />
        <div className="runway__ticks">
          {ticks.map((t) => (
            <span key={t} className="runway__tick" style={{ left: `${pct(t, start)}%` }}>
              {shortDay(t)}
            </span>
          ))}
          <span className="runway__tick runway__tick--today" style={{ left: `${todayAt}%` }}>
            Today
          </span>
        </div>
        <span />
      </div>

      <ol className="runway__rows">
        {rows.map(({ shop, state }, i) => {
          const plan = plans.find((p) => p.id === shop.plan_id);
          const from = pct(Math.max(new Date(shop.created_at).getTime(), start), start);
          const end = shop.paid_until ? new Date(shop.paid_until).getTime() : null;
          const to = end === null ? 100 : pct(end, start);
          const graceTo = end === null ? to : pct(end + shop.grace_days * DAY, start);
          const beyond = end !== null && end > start + SPAN * DAY;
          const kind =
            state.status === 'active' ? 'paid' : state.status === 'expiring' || state.status === 'grace' ? 'short' : state.status;

          const label =
            end === null
              ? plan && isLifetime(plan)
                ? 'Lifetime'
                : 'No end date'
              : `Paid to ${formatDay(shop.paid_until!)}`;

          const body = (
            <>
              <span className="runway__name">{shop.name}</span>
              <span className="runway__track" style={{ '--i': i } as CSSProperties}>
                <span className="runway__today" style={{ left: `${todayAt}%` }} aria-hidden="true" />
                {to > from && (
                  <span
                    className={`runway__bar runway__bar--${kind}${end === null || beyond ? ' runway__bar--open' : ''}`}
                    style={{ left: `${from}%`, width: `${to - from}%` }}
                  />
                )}
                {graceTo > to && state.status !== 'suspended' && (
                  <span
                    className={`runway__grace${state.status === 'locked' ? ' runway__grace--spent' : ''}`}
                    style={{ left: `${to}%`, width: `${graceTo - to}%` }}
                  />
                )}
              </span>
              <span className="runway__end">
                <ShopStatus shop={shop} />
                <span className="runway__date">{label}</span>
              </span>
            </>
          );

          return (
            <li key={shop.store_id}>
              {single ? (
                <div className="runway__row">{body}</div>
              ) : (
                <Link className="runway__row runway__row--link" to={`/platform/shops/${shop.store_id}`}>
                  {body}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
