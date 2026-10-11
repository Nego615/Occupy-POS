import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import './AdminOverview.css';
import { Button } from '../components/Button';
import { Mono } from '../components/Mono';
import { dateOfDaysAgo } from '../data/history';
import { exchangeRate } from '../data/settings';
import {
  RANGES,
  downloadCsv,
  money,
  ordersToCsv,
  recentActivity,
  salesByDay,
  statCards,
  topItems,
  type RangeId,
} from '../lib/analytics';
import { profitAndLoss } from '../lib/profit';
import { daysSpanned, inLastDays } from '../lib/reports';
import { usePos } from '../lib/store';
import { formatDate } from '../lib/useClock';

export function AdminOverview() {
  const { orders, catalog, settings, movements, payrollRuns, expenses, staff } = usePos();
  const [range, setRange] = useState<RangeId>('week');

  // Tile colors, so the top-items list matches the register grid.
  const itemColors = useMemo(
    () => Object.fromEntries(catalog.map((i) => [i.name, i.color])),
    [catalog],
  );

  // Stat values are pre-formatted strings, so a currency switch has to redo them.
  const stats = useMemo(
    () => statCards(orders, range),
    [orders, range, settings.currency],
  );
  const bars = useMemo(() => salesByDay(orders), [orders]);
  const ranked = useMemo(() => topItems(orders, range), [orders, range]);
  const activity = useMemo(() => recentActivity(orders), [orders]);
  const profit = useMemo(() => {
    const { days } = RANGES.find((r) => r.id === range)!;
    return profitAndLoss({
      orders: inLastDays(orders, days),
      days,
      span: Number.isFinite(days) ? days : daysSpanned(orders),
      movements,
      payrollRuns,
      expenses,
      staff,
      rate: exchangeRate(settings),
    });
  }, [orders, range, movements, payrollRuns, expenses, staff, settings]);

  const peak = Math.max(...bars.map((b) => b.value), 1);
  const weekTotal = bars.reduce((sum, b) => sum + b.value, 0);
  const rangePhrase = RANGES.find((r) => r.id === range)!.phrase;
  // All time has nothing before it to compare with, so the cards say where it starts instead.
  const since =
    range === 'all' && orders.length > 0
      ? dateOfDaysAgo(daysSpanned(orders) - 1).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })
      : null;

  function exportReport() {
    downloadCsv(
      ordersToCsv(orders, range),
      `occupy-${range}-${new Date().toISOString().slice(0, 10)}.csv`,
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Overview</h1>
          <div className="page-sub">{settings.locationName} · {formatDate(new Date())}</div>
        </div>
        <div className="head-actions">
          <div className="range-pill" role="group" aria-label="Date range">
            {RANGES.map((r) => (
              <button
                key={r.id}
                type="button"
                className={r.id === range ? 'range-pill__on' : undefined}
                onClick={() => setRange(r.id)}
                aria-pressed={r.id === range}
              >
                {r.label}
              </button>
            ))}
          </div>
          <Button variant="secondary" size="sm" onClick={exportReport}>
            Export report
          </Button>
        </div>
      </div>

      <div className="stats">
        {stats.map((stat) => (
          <div className="stat-card" key={stat.label}>
            <div className="stat-card__label">{stat.label}</div>
            <Mono className="stat-card__value">{stat.value}</Mono>
            {stat.delta ? (
              <div className={`stat-card__delta stat-card__delta--${stat.delta.good ? 'good' : 'bad'}`}>
                <span aria-hidden="true">{stat.delta.direction === 'up' ? '↑' : '↓'}</span>
                <span className="sr-only">
                  {stat.delta.direction === 'up' ? 'Up' : 'Down'}
                </span>
                <Mono>{stat.delta.text.split(' ')[0]}</Mono>
                {` ${stat.delta.text.split(' ').slice(1).join(' ')}`}
              </div>
            ) : (
              <div className="stat-card__delta stat-card__delta--flat">
                {since ? `Since ${since}` : 'No prior period to compare'}
              </div>
            )}
          </div>
        ))}
      </div>

      <Link
        to={`/admin/reports?report=profit&range=${range}`}
        className={profit.net < 0 ? 'profit-strip profit-strip--loss' : 'profit-strip profit-strip--profit'}
      >
        <span className="profit-strip__label">
          {profit.net < 0 ? 'Net loss' : 'Net profit'} {rangePhrase}
        </span>
        <Mono className="profit-strip__value">{money(Math.abs(profit.net))}</Mono>
        <span className="profit-strip__note">
          after cost of goods, stock losses, wages, and expenses
          {profit.unpaidWageDays > 0 && ' · wages not yet marked paid aren’t counted'}
        </span>
        <span className="profit-strip__more">Profit &amp; loss →</span>
      </Link>

      <div className="chart-card">
        <div className="chart-card__head">
          <h2 className="chart-card__title">Sales by day</h2>
          <div className="chart-card__total">
            <Mono>{money(weekTotal)}</Mono> over the last <Mono>7</Mono> days
          </div>
        </div>
        {/* Plain divs — the bar height is the only geometry needed. */}
        <div className="chart-bars" role="img" aria-label={chartSummary(bars, peak)}>
          {bars.map((bar, i) => (
            <div className="bar-col" key={`${bar.day}-${i}`}>
              <div
                className={bar.value === peak ? 'bar bar--peak' : 'bar'}
                style={{ height: `${((bar.value / peak) * 100).toFixed(0)}%` }}
              />
              <div className="bar-col__label">{bar.day}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="cols">
        <section className="panel">
          <h2 className="panel__title">Top items {rangePhrase}</h2>
          {ranked.length === 0 ? (
            <p className="panel__empty">No sales in this period yet.</p>
          ) : (
            ranked.map((item, i) => (
              <div className="rank-row" key={item.name}>
                <Mono className="rank-row__num">{i + 1}</Mono>
                <span
                  className="rank-row__dot"
                  style={{ background: itemColors[item.name] ?? 'var(--ink-soft)' }}
                  aria-hidden="true"
                />
                <span className="rank-row__name">{item.name}</span>
                <span className="rank-row__count">
                  <Mono>{item.sold}</Mono> sold
                </span>
                <Mono className="rank-row__amt">{money(item.amount)}</Mono>
              </div>
            ))
          )}
        </section>

        <section className="panel">
          <h2 className="panel__title">Recent activity</h2>
          {activity.map((entry) => (
            <div className="activity-row" key={entry.subject}>
              <span
                className={`activity-row__dot activity-row__dot--${entry.kind}`}
                aria-hidden="true"
              />
              <span className="activity-row__text">
                {/* The dot is decorative, so the state is named for screen readers. */}
                <span className="sr-only">{ACTIVITY_LABEL[entry.kind]}. </span>
                <span className="activity-row__subject">{entry.subject}</span>{' '}
                {entry.detail}
              </span>
              <Mono className="activity-row__time">{entry.time}</Mono>
            </div>
          ))}
        </section>
      </div>
    </>
  );
}

const ACTIVITY_LABEL = {
  paid: 'Paid',
  occupied: 'Tab open',
  refunded: 'Refunded',
  charged: 'On room bill',
} as const;

function chartSummary(bars: { day: string; value: number }[], peak: number): string {
  const parts = bars.map(
    (b) => `${b.day} ${money(b.value)}${b.value === peak ? ' (peak)' : ''}`,
  );
  return `Sales by day: ${parts.join(', ')}`;
}
