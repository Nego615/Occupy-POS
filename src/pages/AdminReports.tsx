import { useMemo, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import './AdminReports.css';
import { Button } from '../components/Button';
import { ColumnChart } from '../components/ColumnChart';
import { Mono, formatCost } from '../components/Mono';
import { Pill, PillRow } from '../components/Pill';
import { PrintableDocument } from '../components/PrintableDocument';
import { StaffFilterSelect, staffFilterLabel } from '../components/StaffFilterSelect';
import type { CatalogItem, Category } from '../data/catalog';
import { dateOfDaysAgo, isoDate } from '../data/history';
import type { Expense } from '../data/expenses';
import type { StockMovement, Supplier, SupplierBill } from '../data/inventory';
import { exchangeRate } from '../data/settings';
import { rolesLabel, type StaffMember } from '../data/staff';
import { downloadCsv, money } from '../lib/analytics';
import {
  REPORT_RANGES,
  byCategory,
  byDay,
  byHour,
  byItem,
  byMonth,
  byPayment,
  byStaff,
  byTab,
  customWindow,
  daysSpanned,
  inLastDays,
  ledger,
  toCsv,
  type GroupRow,
  type Ledger,
  type ReportRangeId,
} from '../lib/reports';
import { losses, margins, supplierSpend, valuation } from '../lib/costReports';
import type { PayrollRun } from '../lib/payroll';
import { profitAndLoss } from '../lib/profit';
import { matchesStaff } from '../lib/orderFilters';
import { usePos } from '../lib/store';

type ReportId =
  | 'summary'
  | 'profit'
  | 'items'
  | 'categories'
  | 'payments'
  | 'hours'
  | 'tabs'
  | 'staff'
  | 'margins'
  | 'inventory'
  | 'purchasing';

const REPORTS: { id: ReportId; label: string; blurb: string }[] = [
  { id: 'summary', label: 'Sales summary', blurb: 'What came in, day by day' },
  { id: 'profit', label: 'Profit & loss', blurb: 'Whether you made money, after every cost' },
  { id: 'items', label: 'Items', blurb: 'What sold, ranked by sales' },
  { id: 'categories', label: 'Categories', blurb: 'Sales rolled up by menu category' },
  { id: 'payments', label: 'Payments', blurb: 'How customers paid' },
  { id: 'hours', label: 'Time of day', blurb: 'When the counter is busiest' },
  { id: 'tabs', label: 'Tabs & tables', blurb: 'Walk-ins against each table and room' },
  { id: 'staff', label: 'Staff', blurb: 'What each person sold' },
  { id: 'margins', label: 'Margins', blurb: 'What each item earns after its cost' },
  { id: 'inventory', label: 'Stock & losses', blurb: 'What stock is worth, and what went missing' },
  { id: 'purchasing', label: 'Purchasing', blurb: 'Deliveries, payments, and what’s owed' },
];

const pct = (fraction: number) => `${(fraction * 100).toFixed(1)}%`;

/** Reports over the whole shop, which a staff filter doesn't apply to. */
const SHOP_WIDE: ReportId[] = ['profit', 'inventory', 'purchasing'];

/** "Dev Okafor · Server" for the Staff report. */
const staffName = (people: StaffMember[]) => (id: string | undefined) => {
  const m = id ? people.find((p) => p.id === id) : undefined;
  return m ? `${m.name} · ${rolesLabel(m)}` : 'Not recorded';
};

/**
 * Back-office reports over paid orders. The report and range live in the URL
 * (`?report=items&range=month`), so a report can be bookmarked or shared.
 * Every report is a table first — the charts sit on top of the same numbers —
 * and Export CSV downloads exactly the table on screen.
 */
export function AdminReports() {
  const {
    orders,
    catalog,
    categories,
    settings,
    movements,
    bills,
    suppliers,
    payrollRuns,
    expenses,
    staff,
    allStaff,
    can,
  } = usePos();
  const [params, setParams] = useSearchParams();

  const report = (REPORTS.find((r) => r.id === params.get('report'))?.id ?? 'summary') as ReportId;
  // A preset, or `?range=custom&from=2026-10-01&to=2026-10-10`.
  const from = params.get('from');
  const to = params.get('to');
  const custom = params.get('range') === 'custom' ? customWindow(from, to) : null;
  const range: ReportRangeId = custom
    ? 'custom'
    : (REPORT_RANGES.find((r) => r.id === params.get('range'))?.id ?? 'week');
  const days = custom ? custom.days : REPORT_RANGES.find((r) => r.id === range)!.days;
  // Days ago the window ends — today, unless the dates were picked.
  const end = custom?.end ?? 0;
  const today = isoDate(new Date());
  // All time has no cutoff, but the sales summary still needs a first day to chart from.
  const span = useMemo(
    () => (Number.isFinite(days) ? days : daysSpanned(orders)),
    [days, orders],
  );
  const meta = REPORTS.find((r) => r.id === report)!;

  // Whose sales: everyone, a role, or one person. Kept in the URL with the rest.
  const person = params.get('staff') ?? 'all';
  // Profit and the stock reports cover the whole shop, so they aren't split by person.
  const byPerson = !SHOP_WIDE.includes(report);

  function setParam(key: 'report' | 'range' | 'staff' | 'from' | 'to', value: string) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set(key, value);
        return next;
      },
      { replace: true },
    );
  }

  /** Switches to picked dates, starting from the range on screen so nothing jumps. */
  function pickDates() {
    const reach = Number.isFinite(days) ? days : span;
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('range', 'custom');
        next.set('from', isoDate(dateOfDaysAgo(end + reach - 1)));
        next.set('to', isoDate(dateOfDaysAgo(end)));
        return next;
      },
      { replace: true },
    );
  }

  const windowed = useMemo(() => {
    const inRange = inLastDays(orders, days, end);
    return byPerson && person !== 'all' ? inRange.filter((o) => matchesStaff(o, person, allStaff)) : inRange;
  }, [orders, days, end, byPerson, person, allStaff]);
  const items = useMemo(() => byItem(windowed, catalog, categories), [windowed, catalog, categories]);

  const view = useMemo(
    () =>
      buildReport(report, windowed, days, span, items, settings.tipsEnabled, {
        catalog,
        categories,
        movements,
        bills,
        suppliers,
        payrollRuns,
        expenses,
        staff,
        allStaff,
        canRecordExpenses: can('expenses'),
        rate: exchangeRate(settings),
        end,
      }),
    // The view holds formatted money, so a currency switch has to rebuild it.
    [
      report,
      windowed,
      days,
      end,
      span,
      items,
      settings.tipsEnabled,
      catalog,
      categories,
      movements,
      bills,
      suppliers,
      payrollRuns,
      expenses,
      staff,
      allStaff,
      can,
      settings,
    ],
  );

  function exportCsv() {
    downloadCsv(
      toCsv(view.csv),
      custom
        ? `occupy-${report}-${isoDate(dateOfDaysAgo(end + days - 1))}-to-${isoDate(dateOfDaysAgo(end))}.csv`
        : `occupy-${report}-${range}-${new Date().toISOString().slice(0, 10)}.csv`,
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Reports</h1>
          <div className="page-sub">{settings.locationName} · paid orders only · open tabs excluded</div>
        </div>
        <div className="head-actions">
          {byPerson && (
            <StaffFilterSelect value={person} onChange={(v) => setParam('staff', v)} staff={staff} />
          )}
          <PillRow label="Date range">
            {REPORT_RANGES.map((r) => (
              <Pill key={r.id} active={r.id === range} onClick={() => setParam('range', r.id)}>
                {r.label}
              </Pill>
            ))}
            <Pill active={custom !== null} onClick={pickDates}>
              Pick dates
            </Pill>
          </PillRow>
          {custom && (
            <div className="report-dates" role="group" aria-label="Report dates">
              <label className="report-dates__field">
                <span>From</span>
                <input
                  type="date"
                  className="report-dates__input mono"
                  value={from ?? ''}
                  max={to ?? today}
                  onChange={(e) => e.target.value && setParam('from', e.target.value)}
                />
              </label>
              <label className="report-dates__field">
                <span>To</span>
                <input
                  type="date"
                  className="report-dates__input mono"
                  value={to ?? ''}
                  min={from ?? undefined}
                  max={today}
                  onChange={(e) => e.target.value && setParam('to', e.target.value)}
                />
              </label>
            </div>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={exportCsv}
            disabled={view.csv.length <= 1}
          >
            Export CSV
          </Button>
          <Button variant="secondary" size="sm" onClick={() => window.print()}>
            Print
          </Button>
        </div>
      </div>

      <div className="reports">
        <nav className="reports__menu" aria-label="Reports">
          {REPORTS.map((r) => (
            <button
              key={r.id}
              type="button"
              className={r.id === report ? 'report-link report-link--on' : 'report-link'}
              aria-current={r.id === report ? 'page' : undefined}
              onClick={() => setParam('report', r.id)}
            >
              <span className="report-link__label">{r.label}</span>
              <span className="report-link__blurb">{r.blurb}</span>
            </button>
          ))}
        </nav>

        <section className="reports__body" aria-labelledby="report-title">
          <div className="report-head">
            <h2 id="report-title" className="report-head__title">
              {meta.label}
            </h2>
            <span className="report-head__range">
              {rangeLabel(range, days, span, end)}
              {report === 'inventory' && ' · stock value is as of now'}
            </span>
          </div>
          {view.body}
        </section>
      </div>

      {/* The same report on the letterhead, off-screen until Print. */}
      <PrintableDocument
        title={meta.label}
        meta={[
          [
            rangeLabel(range, days, span, end),
            report === 'inventory' && 'stock value is as of now',
            byPerson && person !== 'all' && staffFilterLabel(person, staff),
          ]
            .filter(Boolean)
            .join(' · '),
          byPerson ? 'Paid orders only · open tabs excluded' : 'Whole shop',
        ]}
      >
        {view.body}
      </PrintableDocument>
    </>
  );
}

type ReportView = {
  body: ReactNode;
  /** Header row first. Just the header means there's nothing to export. */
  csv: (string | number)[][];
};

/**
 * Drops the given columns from a row when tips are hidden. Tips show while
 * they're turned on, or when the period still holds tips from before.
 */
const tipColumns =
  (show: boolean, ...cols: number[]) =>
  <T,>(row: T[]): T[] =>
    show ? row : row.filter((_, i) => !cols.includes(i));

/** Inventory data the cost reports read, beyond the windowed orders. */
type CostContext = {
  catalog: CatalogItem[];
  categories: Category[];
  movements: StockMovement[];
  bills: SupplierBill[];
  suppliers: Supplier[];
  payrollRuns: PayrollRun[];
  expenses: Expense[];
  staff: StaffMember[];
  /** Everyone ever on the team, for names on past sales. */
  allStaff: StaffMember[];
  /** Whether to link to the Expenses page. */
  canRecordExpenses: boolean;
  /** Cost-currency units to one sales unit, when the shop buys in another currency. */
  rate?: number;
  /** Days ago the window ends; 0 is today. */
  end: number;
};

const longDay = (daysAgo: number) =>
  dateOfDaysAgo(daysAgo).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** "Today", "Last 7 days", "Oct 1, 2026 – Oct 10, 2026", or "All time · since Mar 29, 2026". */
function rangeLabel(range: ReportRangeId, days: number, span: number, end: number): string {
  if (range === 'custom') {
    return days === 1 ? longDay(end) : `${longDay(end + days - 1)} – ${longDay(end)} · ${days} days`;
  }
  if (range === 'today') return 'Today';
  if (range !== 'all') return `Last ${days} days`;
  return `All time · since ${longDay(span - 1)}`;
}

function buildReport(
  report: ReportId,
  orders: ReturnType<typeof inLastDays>,
  /** The window's length; Infinity for All time, which the cost reports read as no cutoff. */
  days: number,
  /** The same window in whole days, through the oldest order — finite even for All time. */
  span: number,
  items: ReturnType<typeof byItem>,
  tipsEnabled: boolean,
  ctx: CostContext,
): ReportView {
  switch (report) {
    case 'summary':
      return summaryReport(orders, span, ctx.end, tipsEnabled);
    case 'items':
      return itemsReport(items);
    case 'categories':
      return categoriesReport(items);
    case 'payments':
      return groupReport(byPayment(orders), 'Method', tipsEnabled);
    case 'hours':
      return hoursReport(orders);
    case 'tabs':
      return groupReport(byTab(orders), 'Tab', tipsEnabled);
    case 'staff':
      return groupReport(byStaff(orders, staffName(ctx.allStaff)), 'Staff', tipsEnabled);
    case 'profit':
      return profitReport(orders, days, span, ctx);
    case 'margins':
      return marginsReport(orders);
    case 'inventory':
      return inventoryReport(ctx, days);
    case 'purchasing':
      return purchasingReport(ctx, days);
  }
}

/* ---------- Sales summary ---------- */

/** Past this many days the summary goes month by month — a column a day stops reading. */
const DAILY_LIMIT = 62;

function summaryReport(
  orders: ReturnType<typeof inLastDays>,
  days: number,
  end: number,
  tipsEnabled: boolean,
): ReportView {
  const total = ledger(orders);
  const monthly = days > DAILY_LIMIT;
  const unit = monthly ? 'month' : 'day';
  const periods: (Ledger & { key: string | number; label: string })[] = monthly
    ? byMonth(orders, days, end)
    : byDay(orders, days, end).map((d) => ({ ...d, key: d.daysAgo }));
  const labelEvery = monthly
    ? Math.ceil(periods.length / 12)
    : days > 31 ? 10 : days > 7 ? 5 : 1;
  const cols = tipColumns(tipsEnabled || total.tips > 0, 4);

  const csv: ReportView['csv'] = [
    cols([monthly ? 'month' : 'date', 'orders', 'item_sales', 'tax', 'tips', 'collected', 'refunds']),
    ...[...periods]
      .reverse()
      .map((d) => cols([
        d.label,
        d.orders,
        d.itemSales.toFixed(2),
        d.tax.toFixed(2),
        d.tips.toFixed(2),
        d.collected.toFixed(2),
        d.refunds.toFixed(2),
      ])),
  ];

  const body = (
    <>
      <div className="report-tiles">
        <Tile label="Collected" value={money(total.collected)} />
        <Tile label="Item sales" value={money(total.itemSales)} />
        <Tile label="Tax" value={money(total.tax)} />
        {(tipsEnabled || total.tips > 0) && <Tile label="Tips" value={money(total.tips)} />}
        <Tile
          label="Orders"
          value={String(total.orders)}
          note={`${money(total.avgTicket)} avg. ticket`}
        />
        <Tile
          label="Refunds"
          value={money(total.refunds)}
          note={`${total.refundCount} ${total.refundCount === 1 ? 'order' : 'orders'}`}
        />
      </div>

      {periods.length > 1 && (
        <div className="report-card">
          <h3 className="report-card__title">Collected by {unit}</h3>
          <ColumnChart
            title={`Collected by ${unit}`}
            data={periods.map((d) => ({ label: d.label, value: d.collected }))}
            format={money}
            labelEvery={labelEvery}
          />
        </div>
      )}

      <ReportTable
        head={cols([monthly ? 'Month' : 'Day', 'Orders', 'Item sales', 'Tax', 'Tips', 'Collected', 'Refunds'])}
        numericFrom={1}
        rows={[...periods].reverse().map((d) => ({
          key: d.key,
          cells: cols([
            d.label,
            <Mono>{d.orders}</Mono>,
            <Mono>{money(d.itemSales)}</Mono>,
            <Mono>{money(d.tax)}</Mono>,
            <Mono>{money(d.tips)}</Mono>,
            <Mono className="report-table__strong">{money(d.collected)}</Mono>,
            d.refunds > 0 ? <Mono>{money(d.refunds)}</Mono> : <Muted />,
          ]),
        }))}
        foot={
          periods.length > 1
            ? cols([
                'Total',
                <Mono>{total.orders}</Mono>,
                <Mono>{money(total.itemSales)}</Mono>,
                <Mono>{money(total.tax)}</Mono>,
                <Mono>{money(total.tips)}</Mono>,
                <Mono>{money(total.collected)}</Mono>,
                <Mono>{money(total.refunds)}</Mono>,
              ])
            : undefined
        }
      />
    </>
  );

  return { body, csv };
}

/* ---------- Items & categories ---------- */

function itemsReport(items: ReturnType<typeof byItem>): ReportView {
  const csv: ReportView['csv'] = [
    ['item', 'category', 'sold', 'sales', 'share'],
    ...items.map((i) => [i.name, i.category, i.qty, i.sales.toFixed(2), pct(i.share)]),
  ];
  const peak = items[0]?.share ?? 0;

  const body =
    items.length === 0 ? (
      <Empty />
    ) : (
      <ReportTable
        head={['#', 'Item', 'Category', 'Sold', 'Sales', 'Share of sales']}
        numericFrom={3}
        rows={items.map((item, i) => ({
          key: item.name,
          cells: [
            <Mono className="report-table__rank">{i + 1}</Mono>,
            <span className="report-table__item">
              <span
                className="report-table__dot"
                style={{ background: item.color ?? 'var(--ink-soft)' }}
                aria-hidden="true"
              />
              {item.name}
            </span>,
            <span className="report-table__soft">{item.category}</span>,
            <Mono>{item.qty}</Mono>,
            <Mono className="report-table__strong">{money(item.sales)}</Mono>,
            <ShareBar share={item.share} peak={peak} />,
          ],
        }))}
      />
    );

  return { body, csv };
}

function categoriesReport(items: ReturnType<typeof byItem>): ReportView {
  const categories = byCategory(items);
  const csv: ReportView['csv'] = [
    ['category', 'items_sold', 'units', 'sales', 'share'],
    ...categories.map((c) => [c.label, c.items, c.qty, c.sales.toFixed(2), pct(c.share)]),
  ];
  const peak = categories[0]?.share ?? 0;

  const body =
    categories.length === 0 ? (
      <Empty />
    ) : (
      <ReportTable
        head={['Category', 'Items sold', 'Units', 'Sales', 'Share of sales']}
        numericFrom={1}
        rows={categories.map((c) => ({
          key: c.label,
          cells: [
            <span className="report-table__strong">{c.label}</span>,
            <Mono>{c.items}</Mono>,
            <Mono>{c.qty}</Mono>,
            <Mono className="report-table__strong">{money(c.sales)}</Mono>,
            <ShareBar share={c.share} peak={peak} />,
          ],
        }))}
      />
    );

  return { body, csv };
}

/* ---------- Payments & tabs ---------- */

function groupReport(rows: GroupRow[], first: string, tipsEnabled: boolean): ReportView {
  const cols = tipColumns(tipsEnabled || rows.some((r) => r.tips > 0), 4, 5);
  const csv: ReportView['csv'] = [
    cols([first.toLowerCase(), 'orders', 'collected', 'avg_ticket', 'tips', 'tip_rate', 'share']),
    ...rows.map((r) => cols([
      r.label,
      r.orders,
      r.collected.toFixed(2),
      r.avgTicket.toFixed(2),
      r.tips.toFixed(2),
      pct(r.tipRate),
      pct(r.share),
    ])),
  ];
  const peak = rows[0]?.share ?? 0;

  const body =
    rows.length === 0 ? (
      <Empty />
    ) : (
      <ReportTable
        head={cols([first, 'Orders', 'Collected', 'Avg. ticket', 'Tips', 'Tip rate', 'Share'])}
        numericFrom={1}
        rows={rows.map((r) => ({
          key: r.label,
          cells: cols([
            <span className="report-table__strong">{r.label}</span>,
            <Mono>{r.orders}</Mono>,
            <Mono className="report-table__strong">{money(r.collected)}</Mono>,
            <Mono>{money(r.avgTicket)}</Mono>,
            <Mono>{money(r.tips)}</Mono>,
            <Mono>{pct(r.tipRate)}</Mono>,
            <ShareBar share={r.share} peak={peak} />,
          ]),
        }))}
      />
    );

  return { body, csv };
}

/* ---------- Time of day ---------- */

function hoursReport(orders: ReturnType<typeof inLastDays>): ReportView {
  const hours = byHour(orders);
  const csv: ReportView['csv'] = [
    ['hour', 'orders', 'collected', 'avg_ticket'],
    ...hours.map((h) => [
      h.label,
      h.orders,
      h.sales.toFixed(2),
      (h.orders ? h.sales / h.orders : 0).toFixed(2),
    ]),
  ];

  if (hours.length === 0) return { body: <Empty />, csv };

  const busiest = hours.reduce((a, b) => (b.orders > a.orders ? b : a));

  const body = (
    <>
      <div className="report-card">
        <div className="report-card__head">
          <h3 className="report-card__title">Collected by hour closed</h3>
          <span className="report-card__note">
            Busiest hour: <span className="report-table__strong">{busiest.label}</span> ·{' '}
            <Mono>{busiest.orders}</Mono> orders
          </span>
        </div>
        <ColumnChart
          title="Collected by hour closed"
          data={hours.map((h) => ({ label: h.label, value: h.sales }))}
          format={money}
        />
      </div>

      <ReportTable
        head={['Hour', 'Orders', 'Collected', 'Avg. ticket']}
        numericFrom={1}
        rows={hours.map((h) => ({
          key: h.hour,
          cells: [
            h.label,
            h.orders ? <Mono>{h.orders}</Mono> : <Muted />,
            h.sales ? (
              <Mono className="report-table__strong">{money(h.sales)}</Mono>
            ) : (
              <Muted />
            ),
            h.orders ? <Mono>{money(h.sales / h.orders)}</Mono> : <Muted />,
          ],
        }))}
      />
    </>
  );

  return { body, csv };
}

/* ---------- Profit & loss ---------- */

function profitReport(
  orders: ReturnType<typeof inLastDays>,
  days: number,
  span: number,
  ctx: CostContext,
): ReportView {
  const pl = profitAndLoss({
    orders,
    days,
    span,
    end: ctx.end,
    movements: ctx.movements,
    payrollRuns: ctx.payrollRuns,
    expenses: ctx.expenses,
    staff: ctx.staff,
    rate: ctx.rate,
  });
  const loss = pl.net < 0;
  const costs = pl.cost + pl.stockLosses + pl.wages + pl.expenseTotal;

  // Costs read as subtractions; a stock count that found extra adds back.
  const minus = (n: number) => (n === 0 ? <Muted /> : <Mono>{`${n > 0 ? '−' : '+'}${money(Math.abs(n))}`}</Mono>);
  const ofSales = (n: number) => (pl.sales > 0 ? <Mono>{pct(n / pl.sales)}</Mono> : <Muted />);

  type Line = { key: string; label: ReactNode; amount: ReactNode; share: ReactNode; csv: [string, number] };
  const lines: Line[] = [
    { key: 'sales', label: 'Sales', amount: <Mono>{money(pl.sales)}</Mono>, share: ofSales(pl.sales), csv: ['sales', pl.sales] },
    { key: 'cogs', label: 'Cost of goods sold', amount: minus(pl.cost), share: ofSales(pl.cost), csv: ['cost_of_goods', -pl.cost] },
    {
      key: 'gross',
      label: <span className="report-table__strong">Gross profit</span>,
      amount: <Mono className="report-table__strong">{money(pl.grossProfit)}</Mono>,
      share: ofSales(pl.grossProfit),
      csv: ['gross_profit', pl.grossProfit],
    },
    {
      key: 'stock',
      label: 'Stock written off or missing',
      amount: minus(pl.stockLosses),
      share: ofSales(pl.stockLosses),
      csv: ['stock_losses', -pl.stockLosses],
    },
    { key: 'wages', label: 'Wages', amount: minus(pl.wages), share: ofSales(pl.wages), csv: ['wages', -pl.wages] },
    ...pl.expenses.map((e) => ({
      key: `exp-${e.category}`,
      label: (
        <>
          {e.label} <span className="report-table__soft">· {e.count} {e.count === 1 ? 'expense' : 'expenses'}</span>
        </>
      ),
      amount: minus(e.amount),
      share: ofSales(e.amount),
      csv: [`expense_${e.category}`, -e.amount] as [string, number],
    })),
  ];

  const csv: ReportView['csv'] = [
    ['line', 'amount'],
    ...lines.map((l) => [l.csv[0], l.csv[1].toFixed(2)]),
    ['net_profit', pl.net.toFixed(2)],
  ];

  if (pl.sales === 0 && costs === 0) {
    return { body: <p className="report-empty">No sales or costs in this range yet.</p>, csv };
  }

  const withUnpaid = pl.net - pl.unpaidWagesEstimate;

  const body = (
    <>
      <div className="report-tiles">
        <Tile
          label={loss ? 'Net loss' : 'Net profit'}
          value={money(Math.abs(pl.net))}
          note={pl.sales > 0 ? `${pct(Math.abs(pl.netMargin))} of sales` : 'no sales in range'}
        />
        <Tile
          label="Gross profit"
          value={money(pl.grossProfit)}
          note={pl.sales > 0 ? `${pct(pl.grossProfit / pl.sales)} margin` : undefined}
        />
        <Tile label="Total costs" value={money(costs)} note="goods, losses, wages, expenses" />
      </div>

      <p className={loss ? 'report-verdict report-verdict--loss' : 'report-verdict report-verdict--profit'}>
        {loss ? 'You made a loss of ' : 'You made a profit of '}
        <Mono>{money(Math.abs(pl.net))}</Mono>
        {loss
          ? ' — costs came to more than sales brought in.'
          : pl.net === 0
            ? ' — you broke even.'
            : '.'}
      </p>

      <ReportTable
        head={['', 'Amount', 'Of sales']}
        numericFrom={1}
        rows={lines.map((l) => ({ key: l.key, cells: [l.label, l.amount, l.share] }))}
        foot={[loss ? 'Net loss' : 'Net profit', <Mono>{money(pl.net)}</Mono>, ofSales(pl.net)]}
      />

      {pl.uncostedSales > 0 && (
        <p className="report-note">
          {money(pl.uncostedSales)} of sales had no item cost recorded, so their cost of goods is
          missing and the profit reads high. Set unit costs on the Stock page or by receiving
          deliveries.
        </p>
      )}
      {pl.unpaidWageDays > 0 && (
        <p className="report-note">
          Payroll isn’t marked paid for <Mono>{pl.unpaidWageDays}</Mono>{' '}
          {pl.unpaidWageDays === 1 ? 'day' : 'days'} in this range, so those wages aren’t counted.
          At today’s salaries that’s about {money(pl.unpaidWagesEstimate)}, which would make it a{' '}
          {withUnpaid < 0 ? 'loss' : 'profit'} of {money(Math.abs(withUnpaid))}.
        </p>
      )}
      {pl.expenses.length === 0 && (
        <p className="report-note">
          No expenses recorded in this range.{' '}
          {ctx.canRecordExpenses ? (
            <Link to="/admin/expenses?expense=new">Record rent, power, and other running costs</Link>
          ) : (
            'Ask an owner or manager to record rent, power, and other running costs'
          )}{' '}
          so the profit is complete.
        </p>
      )}
      <p className="report-note">
        Sales are after discounts and refunds. Tax (owed to the government) and tips (the
        staff’s) are left out. Stock bought from suppliers counts when it sells, as cost of goods.
      </p>
    </>
  );
  return { body, csv };
}

/* ---------- Margins ---------- */

function marginsReport(orders: ReturnType<typeof inLastDays>): ReportView {
  const m = margins(orders);
  const csv: ReportView['csv'] = [
    ['item', 'sold', 'sales', 'cost', 'gross_profit', 'margin'],
    ...m.rows.map((r) => [
      r.name,
      r.qty,
      r.sales.toFixed(2),
      r.cost?.toFixed(2) ?? '',
      r.profit?.toFixed(2) ?? '',
      r.margin === null ? '' : pct(r.margin),
    ]),
  ];
  if (m.rows.length === 0) return { body: <Empty />, csv };
  const peak = Math.max(...m.rows.map((r) => r.profit ?? 0), 0);

  const body = (
    <>
      <div className="report-tiles">
        <Tile label="Item sales" value={money(m.sales)} note="before tax and tips" />
        <Tile label="Cost of goods" value={money(m.cost)} note="at cost when sold" />
        <Tile label="Gross profit" value={money(m.profit)} note={`${pct(m.margin)} margin`} />
      </div>
      {m.uncostedSales > 0 && (
        <p className="report-note">
          {money(m.uncostedSales)} of sales had no item cost recorded, so they’re left out of
          the margin. Set unit costs on the Stock page or by receiving deliveries.
        </p>
      )}
      <ReportTable
        head={['Item', 'Sold', 'Sales', 'Cost', 'Gross profit', 'Margin', 'Share of profit']}
        numericFrom={1}
        rows={m.rows.map((r) => ({
          key: r.name,
          cells: [
            <span className="report-table__strong">{r.name}</span>,
            <Mono>{r.qty}</Mono>,
            <Mono>{money(r.sales)}</Mono>,
            r.cost === null ? <Muted /> : <Mono>{money(r.cost)}</Mono>,
            r.profit === null ? <Muted /> : <Mono className="report-table__strong">{money(r.profit)}</Mono>,
            r.margin === null ? <Muted /> : <Mono>{pct(r.margin)}</Mono>,
            r.profit === null || m.profit <= 0 ? (
              <Muted />
            ) : (
              <ShareBar share={Math.max(0, r.profit) / m.profit} peak={peak / m.profit} />
            ),
          ],
        }))}
        foot={[
          'Total',
          <Mono>{m.rows.reduce((s, r) => s + r.qty, 0)}</Mono>,
          <Mono>{money(m.sales)}</Mono>,
          <Mono>{money(m.cost)}</Mono>,
          <Mono>{money(m.profit)}</Mono>,
          <Mono>{pct(m.margin)}</Mono>,
          '',
        ]}
      />
    </>
  );
  return { body, csv };
}

/* ---------- Stock & losses ---------- */

function inventoryReport(ctx: CostContext, days: number): ReportView {
  const value = valuation(ctx.catalog, ctx.categories);
  const loss = losses(ctx.movements, days, ctx.end);
  const stockValue = value.reduce((s, r) => s + r.value, 0);

  const csv: ReportView['csv'] = [
    ['item', 'waste_units', 'waste_value', 'count_units', 'count_value', 'correction_units', 'correction_value', 'net_value'],
    ...loss.rows.map((r) => [
      r.name,
      r.wasteUnits,
      r.wasteValue.toFixed(2),
      r.countUnits,
      r.countValue.toFixed(2),
      r.correctionUnits,
      r.correctionValue.toFixed(2),
      r.net.toFixed(2),
    ]),
  ];

  const signed = (n: number, units = false) =>
    n === 0 ? <Muted /> : <Mono>{`${n > 0 ? '+' : ''}${units ? n : money(n)}`}</Mono>;

  const body = (
    <>
      <div className="report-tiles">
        <Tile label="Stock value" value={money(stockValue)} note="at cost, on hand now" />
        <Tile label="Written off" value={money(-loss.waste)} note="waste and damage" />
        <Tile
          label="Count differences"
          value={`${loss.counts > 0 ? '+' : ''}${money(loss.counts)}`}
          note={`net shrinkage ${money(-loss.net)}`}
        />
      </div>

      <h3 className="report-subhead">Stock value by category</h3>
      <ReportTable
        head={['Category', 'Items', 'Units', 'Value at cost']}
        numericFrom={1}
        rows={value.map((r) => ({
          key: r.label,
          cells: [
            <span className="report-table__strong">
              {r.label}
              {r.uncosted > 0 && <span className="report-table__soft"> · {r.uncosted} without a cost</span>}
            </span>,
            <Mono>{r.items}</Mono>,
            <Mono>{r.units}</Mono>,
            <Mono className="report-table__strong">{money(r.value)}</Mono>,
          ],
        }))}
        foot={[
          'Total',
          <Mono>{value.reduce((s, r) => s + r.items, 0)}</Mono>,
          <Mono>{value.reduce((s, r) => s + r.units, 0)}</Mono>,
          <Mono>{money(stockValue)}</Mono>,
        ]}
      />

      <h3 className="report-subhead">Losses and corrections by item</h3>
      {loss.rows.length === 0 ? (
        <p className="report-empty">
          No waste, count differences, or corrections logged in this range.
        </p>
      ) : (
        <ReportTable
          head={['Item', 'Wasted', 'Waste value', 'Count diff.', 'Count value', 'Corrections', 'Net']}
          numericFrom={1}
          rows={loss.rows.map((r) => ({
            key: r.itemId,
            cells: [
              <span className="report-table__strong">{r.name}</span>,
              signed(r.wasteUnits, true),
              signed(r.wasteValue),
              signed(r.countUnits, true),
              signed(r.countValue),
              signed(r.correctionValue),
              <span className="report-table__strong">{signed(r.net)}</span>,
            ],
          }))}
          foot={[
            'Total',
            '',
            signed(loss.waste),
            '',
            signed(loss.counts),
            signed(loss.corrections),
            signed(loss.net),
          ]}
        />
      )}
      <p className="report-note">
        From the stock ledger, valued at each item’s cost when the change was logged. Sales and
        deliveries aren’t losses, so they’re not here.
      </p>
    </>
  );
  return { body, csv };
}

/* ---------- Purchasing ---------- */

function purchasingReport(ctx: CostContext, days: number): ReportView {
  const rows = supplierSpend(ctx.bills, ctx.suppliers, days, ctx.end);
  // Bills are in what the shop buys in.
  const money = formatCost;
  const csv: ReportView['csv'] = [
    ['supplier', 'deliveries', 'received', 'paid', 'owed_now', 'overdue_now'],
    ...rows.map((r) => [
      r.name,
      r.deliveries,
      r.received.toFixed(2),
      r.paid.toFixed(2),
      r.owed.toFixed(2),
      r.overdue.toFixed(2),
    ]),
  ];
  if (rows.length === 0) return { body: <Empty />, csv };
  const total = (pick: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + pick(r), 0);
  const peak = Math.max(...rows.map((r) => r.received), 0);
  const received = total((r) => r.received);

  const body = (
    <>
      <div className="report-tiles">
        <Tile label="Received" value={money(received)} note={`${total((r) => r.deliveries)} deliveries`} />
        <Tile label="Paid out" value={money(total((r) => r.paid))} note="to suppliers, in range" />
        <Tile
          label="Owed now"
          value={money(total((r) => r.owed))}
          note={`${money(total((r) => r.overdue))} overdue`}
        />
      </div>
      <ReportTable
        head={['Supplier', 'Deliveries', 'Received', 'Paid', 'Owed now', 'Overdue', 'Share of buying']}
        numericFrom={1}
        rows={rows.map((r) => ({
          key: r.supplierId,
          cells: [
            <span className="report-table__strong">{r.name}</span>,
            <Mono>{r.deliveries}</Mono>,
            <Mono className="report-table__strong">{money(r.received)}</Mono>,
            r.paid ? <Mono>{money(r.paid)}</Mono> : <Muted />,
            r.owed ? <Mono>{money(r.owed)}</Mono> : <Muted />,
            r.overdue ? <Mono>{money(r.overdue)}</Mono> : <Muted />,
            received > 0 ? <ShareBar share={r.received / received} peak={peak / received} /> : <Muted />,
          ],
        }))}
        foot={[
          'Total',
          <Mono>{total((r) => r.deliveries)}</Mono>,
          <Mono>{money(received)}</Mono>,
          <Mono>{money(total((r) => r.paid))}</Mono>,
          <Mono>{money(total((r) => r.owed))}</Mono>,
          <Mono>{money(total((r) => r.overdue))}</Mono>,
          '',
        ]}
      />
      <p className="report-note">
        Received and paid fall in the date range; owed and overdue are as of today, whenever
        the delivery was.
      </p>
    </>
  );
  return { body, csv };
}

/* ---------- Building blocks ---------- */

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="report-tile">
      <div className="report-tile__label">{label}</div>
      <div className="report-tile__value">{value}</div>
      {note && <div className="report-tile__note">{note}</div>}
    </div>
  );
}

/**
 * Horizontal share bar, scaled to the largest row so the leader fills the
 * track. The percentage beside it is the real value.
 */
function ShareBar({ share, peak }: { share: number; peak: number }) {
  return (
    <span className="share">
      <span className="share__track" aria-hidden="true">
        <span
          className="share__fill"
          style={{ width: `${peak > 0 ? (share / peak) * 100 : 0}%` }}
        />
      </span>
      <Mono className="share__pct">{pct(share)}</Mono>
    </span>
  );
}

function ReportTable({
  head,
  rows,
  foot,
  numericFrom,
}: {
  head: string[];
  rows: { key: string | number; cells: ReactNode[] }[];
  foot?: ReactNode[];
  /** Columns at or after this index are numeric and right-aligned. */
  numericFrom: number;
}) {
  const align = (i: number) => (i >= numericFrom ? 'report-table__num' : undefined);
  return (
    <div className="report-table-wrap">
      <table className="report-table">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={h} scope="col" className={align(i)}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              {row.cells.map((cell, i) => (
                <td key={i} className={align(i)}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {foot && (
          <tfoot>
            <tr>
              {foot.map((cell, i) => (
                <td key={i} className={align(i)}>
                  {cell}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

function Muted() {
  return (
    <span className="report-table__soft">
      <span aria-hidden="true">—</span>
      <span className="sr-only">None</span>
    </span>
  );
}

function Empty() {
  return <p className="report-empty">No paid orders in this range yet.</p>;
}
