import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import './AdminOverview.css';
import './OverviewPocket.css';
import { Button } from '../components/Button';
import { BigMoney, Money, Mono } from '../components/Mono';
import { dateOfDaysAgo } from '../data/history';
import { exchangeRate } from '../data/settings';
import {
  RANGES,
  downloadCsv,
  money,
  netSalesFor,
  ordersToCsv,
  recentActivity,
  salesByDay,
  statCards,
  topItems,
  type RangeId,
} from '../lib/analytics';
import { computeTotals } from '../lib/cart';
import { profitAndLoss } from '../lib/profit';
import { daysSpanned, inLastDays } from '../lib/reports';
import { usePos } from '../lib/store';
import { formatDate } from '../lib/useClock';

/**
 * The owner's overview, laid out like a wallet app: one balance at the top,
 * round buttons for the nightly jobs under it, the open tabs as a card, and
 * everything that explains the number below.
 */
export function AdminOverview() {
  const { orders, catalog, settings, movements, payrollRuns, expenses, staff, tabs, me, can } = usePos();
  const [range, setRange] = useState<RangeId>('today');

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
  const { days, phrase: rangePhrase } = RANGES.find((r) => r.id === range)!;
  const rangeOrders = useMemo(() => inLastDays(orders, days), [orders, days]);
  const profit = useMemo(
    () =>
      profitAndLoss({
        orders: rangeOrders,
        days,
        span: Number.isFinite(days) ? days : daysSpanned(orders),
        movements,
        payrollRuns,
        expenses,
        staff,
        rate: exchangeRate(settings),
      }),
    [rangeOrders, days, orders, movements, payrollRuns, expenses, staff, settings],
  );

  // The tabs still running, oldest first.
  const open = tabs
    .filter((t) => t.cart.length > 0)
    .sort((a, b) => a.orderId - b.orderId)
    .map((t) => ({ tab: t, total: computeTotals(t.cart, settings.taxRate).total }));
  const onTabs = open.reduce((sum, t) => sum + t.total, 0);

  const [netSales, ...rest] = stats;
  const peak = Math.max(...bars.map((b) => b.value), 1);
  const weekTotal = bars.reduce((sum, b) => sum + b.value, 0);
  // All time has nothing before it to compare with, so the card says where it starts instead.
  const since =
    range === 'all' && orders.length > 0
      ? dateOfDaysAgo(daysSpanned(orders) - 1).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })
      : null;
  const firstName = me?.name.split(' ')[0];

  function exportReport() {
    downloadCsv(
      ordersToCsv(orders, range),
      `occupy-${range}-${new Date().toISOString().slice(0, 10)}.csv`,
    );
  }

  return (
    <div className="ov">
      <div className="page-head">
        <div>
          <h1 className="ov__hello">
            {greeting(new Date())}
            {firstName ? `, ${firstName}` : ''}
          </h1>
          <div className="page-sub">
            {settings.locationName} · {formatDate(new Date())}
          </div>
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

      <div className="ov__top">
        {/* The balance: what's been taken in the range, and the jobs that follow from it. */}
        <section className="ov-balance" aria-label={`Net sales ${rangePhrase}`}>
          <div className="ov-balance__head">
            <span>Net sales {rangePhrase}</span>
            {netSales.delta ? (
              <span className={netSales.delta.good ? 'ov-chip ov-chip--gold' : 'ov-chip ov-chip--alert'}>
                <span aria-hidden="true">{netSales.delta.direction === 'up' ? '↑' : '↓'}</span>
                <span className="sr-only">{netSales.delta.direction === 'up' ? 'Up' : 'Down'} </span>
                {netSales.delta.text}
              </span>
            ) : (
              <span className="ov-chip ov-chip--quiet">
                {since ? `Since ${since}` : 'No earlier period to compare'}
              </span>
            )}
          </div>
          <BigMoney value={netSalesFor(orders, range)} className="ov-balance__amount" />
          <nav className="ov-actions" aria-label="Nightly jobs">
            <RoundAction to="/counter/register" label="Register" lit>
              <path d="M6 3.5h12V20l-3-1.8-3 1.8-3-1.8L6 20zM9 8h6M9 11.5h6M9 15h3" />
            </RoundAction>
            {can('payments') && (
              <RoundAction to="/desk" label="Cash up">
                <path d="M3.5 8h17v10.5A1.5 1.5 0 0 1 19 20H5a1.5 1.5 0 0 1-1.5-1.5zM3.5 13h17M10 16.5h4M6 8l1.5-3.5h9L18 8" />
              </RoundAction>
            )}
            {can('expenses') && (
              <RoundAction to="/admin/expenses" label="Add expense">
                <path d="M7 17 17 7M9 7h8v8" />
              </RoundAction>
            )}
            {can('reports') && (
              <RoundAction to="/admin/reports" label="Reports">
                <path d="M5 20v-8M12 20V5M19 20v-11" />
              </RoundAction>
            )}
          </nav>
        </section>

        {/* The open tabs, as one marigold card. */}
        <Link to="/counter/tables" className="ov-tabs">
          <span className="ov-tabs__head">
            <span>On open tabs</span>
            <span className="ov-chip ov-chip--dark">
              <Mono>{open.length}</Mono> {open.length === 1 ? 'tab' : 'tabs'}
            </span>
          </span>
          <BigMoney value={onTabs} className="ov-tabs__amount" />
          <span className="ov-tabs__meta">
            {open.length > 0 ? (
              <>
                Oldest is {open[0].tab.name}, opened <Mono>{open[0].tab.openedAt}</Mono>
              </>
            ) : (
              'No tabs running. Karibu, start one from the register.'
            )}
          </span>
          {open.length > 0 && (
            <span className="ov-tabs__dots" aria-hidden="true">
              {open.slice(0, 4).map(({ tab }) => (
                <i key={tab.orderId}>{shortName(tab.name)}</i>
              ))}
              {open.length > 4 && <i>+{open.length - 4}</i>}
            </span>
          )}
          <span className="ov-tabs__saying" aria-hidden="true">
            Tuko pamoja
          </span>
        </Link>

        <Link
          to={`/admin/reports?report=profit&range=${range}`}
          className={profit.net < 0 ? 'ov-profit ov-profit--loss' : 'ov-profit'}
        >
          <span className="ov-profit__label">
            {profit.net < 0 ? 'Net loss' : 'Net profit'} {rangePhrase}
          </span>
          <BigMoney value={Math.abs(profit.net)} className="ov-profit__amount" />
          <span className="ov-profit__note">
            After cost of goods, stock losses, wages and expenses
            {profit.unpaidWageDays > 0 && '. Wages not yet marked paid aren’t counted'}.
          </span>
          <span className="ov-profit__more">Profit &amp; loss</span>
        </Link>
      </div>

      <div className="ov__mid">
        <section className="ov-panel">
          <div className="ov-panel__head">
            <h2 className="ov-panel__title">Sales by day</h2>
            <span className="ov-panel__aside">
              <Money value={weekTotal} /> over the last <Mono>7</Mono> days
            </span>
          </div>
          {/* Plain divs — the bar height is the only geometry needed. Today is marigold. */}
          <div className="ov-bars" role="img" aria-label={chartSummary(bars, peak)}>
            {bars.map((bar, i) => {
              const today = i === bars.length - 1;
              return (
                <div className="ov-bars__col" key={`${bar.day}-${i}`}>
                  {bar.value === peak && bar.value > 0 && (
                    <span className="ov-bars__tip">{money(bar.value)}</span>
                  )}
                  <div
                    className={today ? 'ov-bars__bar ov-bars__bar--today' : 'ov-bars__bar'}
                    style={{ height: `${Math.max(2, (bar.value / peak) * 100).toFixed(0)}%` }}
                  />
                  <div className="ov-bars__label">{today ? 'Today' : bar.day}</div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="ov-panel">
          <h2 className="ov-panel__title">At a glance</h2>
          <div className="ov-figures">
            {rest.map((stat) => (
              <div className="ov-figure" key={stat.label}>
                <span className="ov-figure__label">{stat.label}</span>
                <Mono className="ov-figure__value">{stat.value}</Mono>
                {stat.delta && (
                  <span
                    className={`ov-figure__delta ov-figure__delta--${stat.delta.good ? 'good' : 'bad'}`}
                  >
                    <span aria-hidden="true">{stat.delta.direction === 'up' ? '↑' : '↓'}</span>
                    <span className="sr-only">{stat.delta.direction === 'up' ? 'Up' : 'Down'} </span>
                    {stat.delta.text}
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="ov__low">
        <section className="ov-panel">
          <h2 className="ov-panel__title">Top items {rangePhrase}</h2>
          {ranked.length === 0 ? (
            <p className="ov-panel__empty">No sales in this period yet.</p>
          ) : (
            ranked.map((item) => (
              <div className="ov-row" key={item.name}>
                <span
                  className="ov-row__badge ov-row__badge--dot"
                  style={{ background: itemColors[item.name] ?? 'var(--tint)' }}
                  aria-hidden="true"
                />
                <span className="ov-row__main">
                  <span className="ov-row__name">{item.name}</span>
                  <span className="ov-row__sub">
                    <Mono>{item.sold}</Mono> sold
                  </span>
                </span>
                <span className="ov-row__bar" aria-hidden="true">
                  <i style={{ width: `${(item.amount / ranked[0].amount) * 100}%` }} />
                </span>
                <Mono className="ov-row__amount">{money(item.amount)}</Mono>
              </div>
            ))
          )}
        </section>

        <section className="ov-panel">
          <h2 className="ov-panel__title">Recent activity</h2>
          {activity.length === 0 ? (
            <p className="ov-panel__empty">Nothing yet today.</p>
          ) : (
            activity.map((entry) => (
              <div className="ov-row" key={entry.subject}>
                <span className={`ov-row__badge ov-row__badge--${entry.kind}`} aria-hidden="true" />
                <span className="ov-row__main">
                  {/* The badge is decorative, so the state is named for screen readers. */}
                  <span className="sr-only">{ACTIVITY_LABEL[entry.kind]}. </span>
                  <span className="ov-row__name">{entry.subject}</span>
                  <span className="ov-row__sub">{entry.detail}</span>
                </span>
                <Mono className="ov-row__time">{entry.time}</Mono>
              </div>
            ))
          )}
        </section>
      </div>
    </div>
  );
}

/** A round button under the balance, with its label beneath — "if it's round, press it". */
function RoundAction({ to, label, lit = false, children }: { to: string; label: string; lit?: boolean; children: ReactNode }) {
  return (
    <Link to={to} className="ov-action">
      <span className={lit ? 'ov-action__circle ov-action__circle--lit' : 'ov-action__circle'} aria-hidden="true">
        <svg viewBox="0 0 24 24">{children}</svg>
      </span>
      {label}
    </Link>
  );
}

/** Swahili greeting by the time of day: morning, afternoon, evening. */
function greeting(now: Date): string {
  const h = now.getHours();
  if (h < 12) return 'Habari za asubuhi';
  if (h < 16) return 'Habari za mchana';
  return 'Habari za jioni';
}

/** "Table 4" → "T4", "Room 12" → "R12", "Walk-in" → "W". */
function shortName(name: string): string {
  const [word, num] = name.split(' ');
  return `${word[0].toUpperCase()}${num && /^\d+$/.test(num) ? num : ''}`;
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
