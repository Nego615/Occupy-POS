import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import './Inventory.css';
import './FrontDesk.css';
import './AdminCashUps.css';
import { Button } from '../components/Button';
import { FilterSelect } from '../components/FilterSelect';
import { ListCount, SortSelect, TimeFilterControl } from '../components/ListControls';
import { InCurrency, Money, Mono } from '../components/Mono';
import { PrintableCashUp } from '../components/PrintableSlip';
import { SearchField } from '../components/SearchField';
import {
  DrawerResult,
  MethodTable,
  ShiftReportSections,
  StockResult,
  shiftLength,
  useShiftCurrency,
} from '../components/ShiftReport';
import { StatusChip } from '../components/StatusChip';
import { drawerDiff, netTaken, type CashUp } from '../data/cashup';
import { currencyOf } from '../lib/currency';
import {
  byNumber,
  byText,
  descending,
  inTimeFilter,
  matchesSearch,
  sortRows,
  thenBy,
  timeFilter,
  timeFilterActive,
  type SortOption,
  type TimeFilter,
} from '../lib/listView';
import { usePos } from '../lib/store';
import { formatTime } from '../lib/useClock';
import { useRevealPanel } from '../lib/useRevealPanel';

type Result = 'balanced' | 'short' | 'over';

const RESULT_LABEL: Record<Result, string> = { balanced: 'Balanced', short: 'Short', over: 'Over' };

function resultOf(c: CashUp): Result {
  const { diff } = drawerDiff(c);
  return diff === 0 ? 'balanced' : diff < 0 ? 'short' : 'over';
}

/** "Sat 22 Nov, 4:12 PM". */
function when(iso: string): string {
  const at = new Date(iso);
  return `${at.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}, ${formatTime(at)}`;
}

/** "4:12 PM" when the shift closed the day it opened, else the full date. */
function until(from: string, to: string): string {
  return new Date(from).toDateString() === new Date(to).toDateString() ? formatTime(new Date(to)) : when(to);
}

/**
 * Every shift closed at the counter, for looking back on: who closed it,
 * what came in, and whether the drawer balanced. The counter's Cash-up view
 * closes shifts; this is where managers review them without the till.
 */
export function AdminCashUps() {
  const { cashUps, allStaff, settings } = usePos();
  const shiftCurrency = useShiftCurrency();
  const [params, setParams] = useSearchParams();
  const [time, setTime] = useState<TimeFilter>(() => timeFilter('30d'));
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('newest');
  const staffId = params.get('by') ?? 'all';
  const result = (params.get('result') ?? 'all') as Result | 'all';
  const selectedId = params.get('cashup');
  const panelRef = useRevealPanel<HTMLElement>(selectedId);

  function setParam(key: 'by' | 'result' | 'cashup', value: string | null) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === null || value === 'all') next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );
  }

  const nameOf = (id: string) => allStaff.find((m) => m.id === id)?.name ?? '—';

  const sorts: SortOption<CashUp>[] = useMemo(() => {
    const name = (c: CashUp) => allStaff.find((m) => m.id === c.by)?.name ?? '';
    const newest = descending(byText<CashUp>((c) => c.closedAt));
    return [
      { id: 'newest', label: 'Newest first', compare: newest },
      { id: 'oldest', label: 'Oldest first', compare: byText((c) => c.closedAt) },
      { id: 'short', label: 'Most short first', compare: thenBy(byNumber((c) => drawerDiff(c).diff), newest) },
      { id: 'over', label: 'Most over first', compare: thenBy(descending(byNumber((c) => drawerDiff(c).diff)), newest) },
      { id: 'taken', label: 'Takings high to low', compare: thenBy(descending(byNumber(netTaken)), newest) },
      { id: 'staff', label: 'Closed by A to Z', compare: thenBy(byText(name), newest) },
    ];
  }, [allStaff]);

  // Whoever has closed a shift, for the filter.
  const closers = useMemo(
    () =>
      [...new Set(cashUps.map((c) => c.by))]
        .map((id) => ({ id, name: allStaff.find((m) => m.id === id)?.name ?? '—' }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [cashUps, allStaff],
  );

  const summary = useMemo(() => {
    const month = cashUps.filter((c) => inTimeFilter(c.closedAt, timeFilter('this-month')));
    const offBy = month.reduce((s, c) => {
      const { diff, localOff } = drawerDiff(c);
      return localOff ? s : s + diff;
    }, 0);
    const latest = cashUps.reduce<CashUp | null>((a, c) => (!a || c.closedAt > a.closedAt ? c : a), null);
    return {
      count: month.length,
      short: month.filter((c) => resultOf(c) === 'short').length,
      offBy,
      latest,
    };
  }, [cashUps]);

  const visible = sortRows(
    cashUps.filter(
      (c) =>
        inTimeFilter(c.closedAt, time) &&
        (staffId === 'all' || c.by === staffId) &&
        (result === 'all' || resultOf(c) === result) &&
        matchesSearch(query, nameOf(c.by), c.note, RESULT_LABEL[resultOf(c)], when(c.openedAt), when(c.closedAt)),
    ),
    sorts,
    sort,
  );
  const filtersActive = query.trim() !== '' || staffId !== 'all' || result !== 'all' || timeFilterActive(time);
  function clearFilters() {
    setQuery('');
    setTime(timeFilter('all'));
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('by');
        next.delete('result');
        return next;
      },
      { replace: true },
    );
  }
  const selected = cashUps.find((c) => c.id === selectedId) ?? null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Cash-ups</h1>
          <div className="page-sub">
            {settings.locationName} · shifts closed at the counter. Close the current one from{' '}
            <Link to="/desk?view=cashup">the counter’s Cash-up</Link>.
          </div>
        </div>
      </div>

      <div className="inv-tiles">
        <Tile label="Shifts this month" value={String(summary.count)} />
        <Tile
          label="Short this month"
          value={String(summary.short)}
          note={summary.short === 1 ? 'shift' : 'shifts'}
        />
        <div className="inv-tile">
          <div className="inv-tile__label">Drawer this month</div>
          <Money value={summary.offBy} className="inv-tile__value" />
          <div className="inv-tile__note">
            {summary.offBy === 0 ? 'balanced overall' : summary.offBy < 0 ? 'short overall' : 'over overall'}
          </div>
        </div>
        <Tile
          label="Last cash-up"
          value={summary.latest ? when(summary.latest.closedAt) : '—'}
          note={summary.latest ? `by ${nameOf(summary.latest.by)}` : 'None closed yet'}
        />
      </div>

      <div className="list-tools">
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Search who closed it, a note, or a day"
          label="Search cash-ups"
        />
      </div>
      <div className="inv-toolbar">
        <TimeFilterControl
          value={time}
          onChange={setTime}
          presets={['today', '7d', '30d', 'this-month', 'last-month', 'all']}
        />
        <div className="inv-toolbar__right">
          <SortSelect value={sort} onChange={setSort} options={sorts} />
          <FilterSelect value={staffId} onChange={(v) => setParam('by', v)} label="Closed by">
            <option value="all">Anyone</option>
            {closers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect value={result} onChange={(v) => setParam('result', v)} label="Drawer">
            <option value="all">Any result</option>
            {(Object.keys(RESULT_LABEL) as Result[]).map((r) => (
              <option key={r} value={r}>
                {RESULT_LABEL[r]}
              </option>
            ))}
          </FilterSelect>
        </div>
      </div>

      <ListCount count={visible.length} noun="cash-up" onClear={filtersActive ? clearFilters : undefined} />

      <div className="inv-layout">
        <section className="panel inv-table-wrap" aria-label="Cash-ups">
          {visible.length === 0 ? (
            <p className="inv-empty">
              {cashUps.length === 0
                ? 'No shifts closed yet. They show up here once a cashier does a cash-up at the counter.'
                : 'No cash-ups match. Try another search or a wider range.'}
            </p>
          ) : (
            <table className="inv-table">
              <thead>
                <tr>
                  <th scope="col">Shift</th>
                  <th scope="col">Closed by</th>
                  <th scope="col" className="num">
                    Taken
                  </th>
                  <th scope="col" className="num">
                    Drawer
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((c) => {
                  const { diff, localOff } = drawerDiff(c);
                  return (
                    <InCurrency key={c.id} currency={shiftCurrency(c)}>
                      <tr
                        className={c.id === selectedId ? 'inv-row inv-row--selected' : 'inv-row'}
                        onClick={() => setParam('cashup', c.id)}
                      >
                        <td>
                          <button
                            type="button"
                            className="inv-row__pick"
                            onClick={(ev) => {
                              ev.stopPropagation();
                              setParam('cashup', c.id);
                            }}
                            aria-pressed={c.id === selectedId}
                          >
                            <span>
                              {when(c.openedAt)} – {until(c.openedAt, c.closedAt)}
                              <span className="inv-sub">
                                {shiftLength(c.openedAt, c.closedAt)} · <Mono>{c.payments}</Mono>{' '}
                                {c.payments === 1 ? 'payment' : 'payments'}
                              </span>
                            </span>
                          </button>
                        </td>
                        <td className="inv-soft">{nameOf(c.by)}</td>
                        <td className="num">
                          <Money value={netTaken(c)} className="inv-strong" />
                        </td>
                        <td className="num">
                          <span className="cashups__result">
                            <StatusChip status={diff === 0 ? 'open' : 'occupied'} size="sm">
                              {RESULT_LABEL[resultOf(c)]}
                            </StatusChip>
                            {diff !== 0 && (
                              <Money
                                value={Math.abs(diff)}
                                currency={localOff ? currencyOf(c.local!.currency) : undefined}
                              />
                            )}
                          </span>
                        </td>
                      </tr>
                    </InCurrency>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        <aside ref={panelRef} className="inv-panel cashups__panel" aria-label="Cash-up">
          {selected ? (
            <CashUpPanel key={selected.id} cashUp={selected} closedBy={nameOf(selected.by)} />
          ) : (
            <p className="inv-panel__placeholder">Pick a cash-up to see its full shift report.</p>
          )}
        </aside>
      </div>
    </>
  );
}

function CashUpPanel({ cashUp: c, closedBy }: { cashUp: CashUp; closedBy: string }) {
  const currency = useShiftCurrency()(c);
  return (
    <InCurrency currency={currency}>
      <div className="inv-panel__head">
        <div>
          <h2 className="inv-panel__title">Shift report</h2>
          <div className="inv-panel__sub">
            {when(c.openedAt)} – {until(c.openedAt, c.closedAt)} · {shiftLength(c.openedAt, c.closedAt)} · closed by{' '}
            {closedBy}
          </div>
        </div>
        <Button size="sm" variant="secondary" onClick={() => window.print()}>
          Print
        </Button>
      </div>

      <div className="inv-panel__section">
        <div className="inv-panel__section-title">Drawer</div>
        <dl className="inv-facts">
          <dt>Opening float</dt>
          <dd>
            <Money value={c.float} />
          </dd>
          {c.paidOut ? (
            <>
              <dt>Paid out for expenses</dt>
              <dd>
                <Money value={-c.paidOut} />
              </dd>
            </>
          ) : null}
          <dt>Cash expected</dt>
          <dd>
            <Money value={c.expectedCash} />
          </dd>
          <dt>Cash counted</dt>
          <dd>
            <Money value={c.countedCash} className="inv-strong" />
          </dd>
        </dl>
        <DrawerResult counted={c.countedCash} expected={c.expectedCash} />
        {c.local && (
          <InCurrency currency={currencyOf(c.local.currency)}>
            <p className="desk__hint">
              <Money value={c.local.counted} /> in the {currencyOf(c.local.currency).symbol} drawer, from a float of{' '}
              <Money value={c.local.float} />
            </p>
            <DrawerResult counted={c.local.counted} expected={c.local.expected} />
          </InCurrency>
        )}
        <StockResult cashUp={c} />
        {c.note && <p className="cashups__note">“{c.note}”</p>}
      </div>

      <div className="inv-panel__section cashups__report">
        <div className="inv-panel__section-title">
          Takings · <Mono>{c.payments}</Mono> {c.payments === 1 ? 'payment' : 'payments'}
        </div>
        <MethodTable taken={c.taken} refunded={c.refunded} />
        {c.report ? (
          <ShiftReportSections report={c.report} />
        ) : (
          <p className="desk__hint">This shift was closed before shift reports were kept.</p>
        )}
      </div>

      <PrintableCashUp cashUp={c} currency={currency} />
    </InCurrency>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="inv-tile">
      <div className="inv-tile__label">{label}</div>
      <Mono className="inv-tile__value">{value}</Mono>
      {note && <div className="inv-tile__note">{note}</div>}
    </div>
  );
}
