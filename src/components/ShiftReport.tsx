import { useState, type ReactNode } from 'react';
import { CostMoney, Money, Mono } from './Mono';
import { TENDER_METHODS, type ByMethod, type CashUp } from '../data/cashup';
import { expenseCategoryLabel } from '../data/expenses';
import { TENDER_LABEL } from '../data/orders';
import type { ShiftReport } from '../data/shiftReport';
import { activeCurrency, costCurrency, currencyOf, type Currency } from '../lib/currency';
import { beforeSwitch } from '../lib/currencySwitch';
import { cashUpStock, countResult } from '../lib/shiftStock';
import { usePos } from '../lib/store';

/** "8 h 30 min", "45 min". */
export function shiftLength(from: string, to: string): string {
  const minutes = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 60_000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** Money taken and given back by method. */
export function MethodTable({ taken, refunded }: { taken: ByMethod; refunded: ByMethod }) {
  const sum = (b: ByMethod) => TENDER_METHODS.reduce((s, m) => s + b[m], 0);
  return (
    <table className="desk__table">
      <thead>
        <tr>
          <th scope="col">Method</th>
          <th scope="col">Taken</th>
          <th scope="col">Refunded</th>
          <th scope="col">Net</th>
        </tr>
      </thead>
      <tbody>
        {TENDER_METHODS.map((m) => (
          <tr key={m}>
            <th scope="row">{TENDER_LABEL[m]}</th>
            <td>
              <Money value={taken[m]} />
            </td>
            <td>
              <Money value={-refunded[m]} />
            </td>
            <td>
              <Money value={taken[m] - refunded[m]} />
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row">Total</th>
          <td>
            <Money value={sum(taken)} />
          </td>
          <td>
            <Money value={-sum(refunded)} />
          </td>
          <td>
            <Money value={sum(taken) - sum(refunded)} />
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <h2 className="desk__subheading">{title}</h2>
      <table className="desk__table shift-report__table">
        <tbody>{children}</tbody>
      </table>
    </>
  );
}

function Line({ label, children, total }: { label: ReactNode; children: ReactNode; total?: boolean }) {
  return (
    <tr className={total ? 'shift-report__total' : undefined}>
      <th scope="row">{label}</th>
      <td>{children}</td>
    </tr>
  );
}

const count = (n: number, one: string, many = `${one}s`) => (
  <>
    <Mono>{n}</Mono> {n === 1 ? one : many}
  </>
);

/** Open tabs listed before "View more". */
const TABS_SHOWN = 5;

/** A shift's sales, debts, expenses, open tabs and best sellers, as tables. */
export function ShiftReportSections({ report }: { report: ShiftReport }) {
  const { sales } = report;
  const twoCurrencies = costCurrency().code !== activeCurrency().code && report.expenses.length > 0;
  const [allTabs, setAllTabs] = useState(false);
  return (
    <div className="shift-report">
      <Section title="Sales">
        <Line label="Bills closed">
          <Mono>{sales.bills}</Mono>
        </Line>
        <Line label="Items sold">
          <Mono>{sales.items}</Mono>
        </Line>
        <Line label="Discounts given">
          <Money value={-sales.discounts} />
        </Line>
        <Line label="Tax">
          <Money value={sales.tax} />
        </Line>
        <Line label="Tips">
          <Money value={sales.tips} />
        </Line>
        <Line label="Gross sales">
          <Money value={sales.gross} />
        </Line>
        <Line label="Refunds">
          <Money value={-sales.refunds} />
        </Line>
        <Line label="Net sales" total>
          <Money value={sales.net} />
        </Line>
      </Section>

      <Section title="Debts and room bills">
        <Line label={<>Put on account · {count(report.onAccount.bills, 'bill')}</>}>
          <Money value={report.onAccount.amount} />
        </Line>
        <Line label="Debts paid off">
          <Money value={report.debtsCollected} />
        </Line>
        <Line label={<>Owed by clients · {count(report.owing.clients, 'client')}</>} total>
          <Money value={report.owing.amount} />
        </Line>
        <Line label={<>Charged to rooms · {count(report.toRooms.bills, 'bill')}</>}>
          <Money value={report.toRooms.amount} />
        </Line>
        <Line label="Room bills paid">
          <Money value={report.roomsSettled} />
        </Line>
        <Line label={<>Waiting for checkout · {count(report.roomsOwing.bills, 'bill')}</>} total>
          <Money value={report.roomsOwing.amount} />
        </Line>
      </Section>

      <Section title="Expenses">
        {report.expenses.length === 0 && (
          <Line label="None logged">
            <CostMoney value={0} />
          </Line>
        )}
        {report.expenses.map((e) => (
          <Line
            key={e.id}
            label={
              <>
                {e.description}
                <span className="shift-report__meta">
                  {' '}
                  · {expenseCategoryLabel(e.category)}
                  {e.fromTill ? ' · from the till' : ''}
                </span>
              </>
            }
          >
            <CostMoney value={-e.amount} />
          </Line>
        ))}
        <Line label="Total expenses" total>
          <CostMoney value={-report.expensesTotal} />
        </Line>
        {twoCurrencies && (
          <Line label="In sales currency">
            <Money value={-report.expensesValue} />
          </Line>
        )}
        <Line label="Net sales less expenses" total>
          <Money value={report.netAfterExpenses} />
        </Line>
      </Section>

      <Section title={report.openTabs.count === 0 ? 'Open tabs' : `Open tabs · ${report.openTabs.count}`}>
        {report.openTabs.count === 0 && (
          <Line label="All tabs closed">
            <Money value={0} />
          </Line>
        )}
        {(allTabs ? report.openTabs.tabs : report.openTabs.tabs.slice(0, TABS_SHOWN)).map((t, i) => (
          <Line key={`${t.name}-${i}`} label={t.name}>
            <Money value={t.total} />
          </Line>
        ))}
        {report.openTabs.tabs.length > TABS_SHOWN && (
          <tr>
            <td colSpan={2} className="shift-report__more-cell">
              <button type="button" className="shift-report__more" onClick={() => setAllTabs((v) => !v)}>
                {allTabs ? 'Show fewer' : `View ${report.openTabs.tabs.length - TABS_SHOWN} more`}
              </button>
            </td>
          </tr>
        )}
        {report.openTabs.paid > 0 && (
          <Line label="Already paid toward them">
            <Money value={-report.openTabs.paid} />
          </Line>
        )}
        {report.openTabs.count > 0 && (
          <Line label="Still to pay" total>
            <Money value={report.openTabs.total - report.openTabs.paid} />
          </Line>
        )}
      </Section>

      {sales.top.length > 0 && (
        <Section title="Best sellers">
          {sales.top.map((r) => (
            <Line
              key={r.name}
              label={
                <>
                  <Mono>{r.qty}</Mono> × {r.name}
                </>
              }
            >
              <Money value={r.total} />
            </Line>
          ))}
        </Section>
      )}
    </div>
  );
}

/** The currency a closed shift was counted in: the old one when it closed before the shop switched. */
export function useShiftCurrency(): (c: CashUp) => Currency | undefined {
  const { settings } = usePos();
  return (c) =>
    beforeSwitch(c.closedAt, settings.currencySwitch) ? currencyOf(settings.currencySwitch.from) : undefined;
}

/** "Counted · expected TSh 50,000 · short TSh 2,000", in whatever currency the drawer's in. */
export function DrawerResult({ counted, expected }: { counted: number; expected: number }) {
  return (
    <p className="desk__hint">
      Counted · expected <Money value={expected} /> ·{' '}
      {counted === expected ? (
        'balanced'
      ) : (
        <>
          {counted < expected ? 'short' : 'over'} <Money value={Math.abs(counted - expected)} />
        </>
      )}
    </p>
  );
}

/** What the shelf count at close found, once the shift's closed. */
export function StockResult({ cashUp }: { cashUp: CashUp }) {
  const { cashUps, catalog, movements, stockCounts } = usePos();
  if (!cashUp.countId) return null;
  const result = countResult(cashUpStock(cashUp, cashUps, catalog, movements, stockCounts));
  return (
    <p className="desk__hint">
      Shelf · <Mono>{result.counted}</Mono> counted ·{' '}
      {result.off === 0 ? (
        'all as expected'
      ) : (
        <>
          <Mono>{result.off}</Mono> off, <Money value={result.value} /> at cost
        </>
      )}
    </p>
  );
}
