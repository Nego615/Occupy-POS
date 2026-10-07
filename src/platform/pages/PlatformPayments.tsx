import { useState } from 'react';
import { Link } from 'react-router';
import { Mono } from '../../components/Mono';
import { formatDay } from '../../lib/subscription';
import { money } from '../api';
import { usePlatform } from '../PlatformData';

/** "2026-10-01" for a date input. */
function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Every subscription payment taken, over a date range, with totals. */
export function PlatformPayments() {
  const { payments, plans } = usePlatform();
  const today = new Date();
  const [from, setFrom] = useState(isoDay(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [to, setTo] = useState(isoDay(today));

  const shown = payments.filter((p) => {
    const day = isoDay(new Date(p.paid_at));
    return (!from || day >= from) && (!to || day <= to);
  });
  const totals = new Map<string, number>();
  for (const p of shown) totals.set(p.currency, (totals.get(p.currency) ?? 0) + p.amount);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Payments</h1>
          <div className="page-sub">
            <Mono>{shown.length}</Mono> in range ·{' '}
            {totals.size === 0
              ? 'nothing taken'
              : [...totals].map(([currency, total]) => money(total, currency)).join(' + ')}
          </div>
        </div>
        <div className="head-actions">
          <label className="pf-date">
            <span>From</span>
            <input className="pf-input mono" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="pf-date">
            <span>To</span>
            <input className="pf-input mono" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
      </div>

      <section className="panel" aria-label="Payments">
        <div className="pf-row pf-row--ledger pf-row--head" aria-hidden="true">
          <span>Date</span>
          <span>Shop</span>
          <span>Plan</span>
          <span>Method</span>
          <span className="pf-row__amount">Amount</span>
        </div>
        {shown.length === 0 ? (
          <p className="pf-empty">No payments in this range.</p>
        ) : (
          shown.map((p) => (
            <div key={p.id} className="pf-row pf-row--ledger">
              <Mono>{formatDay(p.paid_at)}</Mono>
              <span>
                {p.store_id ? <Link to={`/platform/shops/${p.store_id}`}>{p.shop_name}</Link> : `${p.shop_name} (deleted)`}
              </span>
              <span>
                {plans.find((pl) => pl.id === p.plan_id)?.name ?? '—'}
                {p.periods > 1 && <span className="pf-line__sub"> × {p.periods}</span>}
              </span>
              <span>
                {p.method}
                {p.reference && <span className="pf-line__sub"> · {p.reference}</span>}
              </span>
              <Mono className="pf-row__amount">{money(p.amount, p.currency)}</Mono>
            </div>
          ))
        )}
      </section>
    </>
  );
}
