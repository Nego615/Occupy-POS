import { useMemo, useState } from 'react';
import './AdminSalaries.css';
import { Button } from '../components/Button';
import { FilterSelect } from '../components/FilterSelect';
import { Mono } from '../components/Mono';
import { Pill, PillRow } from '../components/Pill';
import { StatusChip } from '../components/StatusChip';
import { TIP_ELIGIBLE, formatDuration, roleLabel, type StaffMember } from '../data/staff';
import { downloadCsv, money } from '../lib/analytics';
import {
  FULL_TIME_HOURS_PER_MONTH,
  OVERTIME_MULTIPLIER,
  PAY_PARTS,
  computePayroll,
  payLabel,
  payPeriods,
  payRange,
  type PayPart,
  type PayPeriodId,
  type Payroll,
} from '../lib/payroll';
import { activeCurrency, roundMoney, isAmountText } from '../lib/currency';
import { toCsv } from '../lib/reports';
import { usePos } from '../lib/store';
import { formatDate, useMinutesNow } from '../lib/useClock';

/**
 * What the team is owed for a month, and the rates it's worked out from.
 * Owner-only (the `payroll` permission). Pay runs monthly: hours × rate with
 * weekly overtime, each salaried person's monthly salary, and the month's tips
 * pooled by hours among baristas and servers. Marking a month paid freezes it
 * into the history.
 *
 * A month is paid whole, or in two parts: mid-month (1st–15th) then the rest
 * (16th–end). Whichever way a month starts decides what's left — once the
 * 1st–15th is paid only the rest can follow, and a whole-month payment rules
 * out both halves.
 */
export function AdminSalaries() {
  const { staff, shifts, orders, me, payrollRuns, recordPayrollRun, settings } = usePos();
  const { overtimeHours, tipPooling, tipsEnabled } = settings;
  const now = useMinutesNow();
  // The closed month is the one normally being paid.
  const [periodId, setPeriodId] = useState<PayPeriodId>('last-month');
  const [confirming, setConfirming] = useState(false);

  const periods = useMemo(() => payPeriods(), []);
  const period = periods.find((p) => p.id === periodId)!;

  // What's already been paid for this month, by part.
  const runFor = (part: PayPart) =>
    payrollRuns.find((r) => r.key === (payRange(period, part)?.key ?? '—'));
  const wholePaid = runFor('whole');
  const midPaid = runFor('first');
  const endPaid = runFor('second');

  // Land on the part that's due: the rest of the month once mid-month is paid.
  const suggestedPart: PayPart = midPaid && !endPaid ? 'second' : 'whole';
  const [chosenPart, setChosenPart] = useState<PayPart | null>(null);
  const part = chosenPart ?? suggestedPart;
  const range = payRange(period, part);
  const key = range?.key ?? `${period.key}-end`;
  const dates = range?.dates ?? 'from the 16th';

  const payroll = useMemo(
    () =>
      range
        ? computePayroll(staff, shifts, orders, range, now, { overtimeHours, tipPooling })
        : EMPTY_PAYROLL,
    // range is rebuilt each render; its key and bounds are what matter.
    [staff, shifts, orders, range?.key, range?.newest, range?.oldest, now, overtimeHours, tipPooling],
  );

  const paid = runFor(part);
  const undistributed = tipPooling ? Math.max(0, payroll.tipPool - payroll.totals.tips) : 0;
  // With tips turned off, tips only show for a period that still has some from before.
  const showTips = tipsEnabled || payroll.tipPool > 0;
  const cols = <T,>(row: T[]): T[] => (showTips ? row : row.filter((_, i) => i !== 7));

  // Why "Mark as paid" is off, in the order someone would fix things.
  const blocked = paid
    ? null
    : part !== 'whole' && wholePaid
      ? `${period.month} was already paid in full.`
      : part === 'whole' && midPaid
        ? 'The 1st–15th was paid mid-month — pay the rest of the month instead.'
        : part === 'second' && !midPaid
          ? 'Pay mid-month (1st–15th) first, or pay the whole month in one go.'
          : !range
            ? 'The rest of the month starts on the 16th.'
            : payroll.openShifts.length > 0
              ? `${payroll.openShifts.map((m) => m.name).join(', ')} ${
                  payroll.openShifts.length === 1 ? 'is' : 'are'
                } still on the clock — clock out before paying.`
              : payroll.lines.length === 0
                ? 'Nothing to pay for these dates.'
                : null;

  function selectPeriod(id: PayPeriodId) {
    setPeriodId(id);
    setChosenPart(null);
    setConfirming(false);
  }

  function selectPart(next: PayPart) {
    setChosenPart(next);
    setConfirming(false);
  }

  /** Paid, or not payable given the month's other runs — shown on the part pills. */
  function partStatus(p: PayPart): string | null {
    if (runFor(p)) return 'paid';
    if (p !== 'whole' && wholePaid) return 'paid in full';
    if (p === 'whole' && midPaid) return 'split';
    return null;
  }

  function markPaid() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    if (!me) return;
    recordPayrollRun({
      key,
      dates: part === 'whole' ? period.month : `${period.month} · ${dates}`,
      paidAt: formatDate(new Date()),
      paidBy: me.name,
      gross: payroll.totals.gross,
      lines: payroll.lines.map((l) => ({
        staffId: l.member.id,
        name: l.member.name,
        hours: l.minutes / 60,
        gross: l.gross,
      })),
    });
    setConfirming(false);
  }

  function exportCsv() {
    downloadCsv(
      toCsv([
        cols(['staff', 'role', 'pay', 'hours', 'overtime_hours', 'wages', 'salary', 'tips', 'gross']),
        ...payroll.lines.map((l) => cols([
          l.member.name,
          roleLabel(l.member.role),
          payLabel(l.member),
          (l.minutes / 60).toFixed(2),
          (l.overtimeMinutes / 60).toFixed(2),
          l.wages.toFixed(2),
          l.salary.toFixed(2),
          l.tips.toFixed(2),
          l.gross.toFixed(2),
        ])),
      ]),
      `occupy-payroll-${key}.csv`,
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Salaries</h1>
          <div className="page-sub">
            {settings.locationName} · {dates} · gross pay, before taxes and deductions
          </div>
        </div>
        <div className="head-actions">
          <PillRow label="Pay period">
            {periods.map((p) => (
              <Pill key={p.id} active={p.id === periodId} onClick={() => selectPeriod(p.id)}>
                {p.label}
              </Pill>
            ))}
          </PillRow>
          <Button
            variant="secondary"
            size="sm"
            onClick={exportCsv}
            disabled={payroll.lines.length === 0}
          >
            Export CSV
          </Button>
        </div>
      </div>

      <div className="pay-parts">
        <span className="pay-parts__label">Pay {period.month}:</span>
        <PillRow label={`Which part of ${period.month} to pay`}>
          {PAY_PARTS.map((p) => {
            const status = partStatus(p.id);
            return (
              <Pill key={p.id} active={p.id === part} onClick={() => selectPart(p.id)}>
                {p.label}
                {status && <span className="pay-parts__status"> · {status}</span>}
              </Pill>
            );
          })}
        </PillRow>
      </div>

      <div className={showTips ? 'pay-tiles' : 'pay-tiles pay-tiles--no-tips'}>
        <Tile label="Gross pay" value={money(payroll.totals.gross)} note={`${payroll.lines.length} people`} />
        <Tile
          label="Hourly wages"
          value={money(payroll.totals.wages)}
          note={
            payroll.totals.overtimeMinutes > 0
              ? `incl. ${formatDuration(payroll.totals.overtimeMinutes)} overtime`
              : 'no overtime'
          }
        />
        <Tile label="Salaries" value={money(payroll.totals.salary)} />
        {showTips && (
          <Tile
            label={tipPooling ? 'Tips pooled' : 'Tips'}
            value={money(payroll.tipPool)}
            note={
              !tipPooling
                ? 'pooling off — paid out directly, not in payroll'
                : undistributed > 0.005
                ? `${money(undistributed)} unassigned — nobody eligible worked`
                : 'split by hours worked'
            }
          />
        )}
      </div>

      {/* ---------- Pay for the period ---------- */}
      <section className="panel pay-section" aria-labelledby="pay-title">
        <div className="pay-section__head">
          <h2 className="panel__title" id="pay-title">
            {part === 'whole' ? `Pay for ${period.month}` : `${PART_TITLE[part]} · ${dates}`}
            {range?.inProgress && <span className="pay-section__so-far"> · so far</span>}
          </h2>
          <div className="pay-close">
            {paid ? (
              <StatusChip status="open" size="sm">
                Paid {paid.paidAt} · {paid.paidBy}
              </StatusChip>
            ) : (
              <>
                {blocked ? (
                  <span className="pay-close__why">{blocked}</span>
                ) : (
                  range?.inProgress && (
                    <span className="pay-close__why">
                      Still in progress — hours are counted up to today.
                    </span>
                  )
                )}
                <Button
                  size="sm"
                  onClick={markPaid}
                  onBlur={() => setConfirming(false)}
                  disabled={blocked !== null}
                >
                  {confirming ? `Confirm ${money(payroll.totals.gross)} paid` : 'Mark as paid'}
                </Button>
              </>
            )}
          </div>
        </div>

        {payroll.lines.length === 0 ? (
          <p className="pay-empty">
            {range
              ? `No hours, salaries${showTips ? ', or tips' : ''} for these dates.`
              : 'The rest of the month starts on the 16th.'}
          </p>
        ) : (
          <div className="pay-table-wrap">
            <table className="pay-table">
              <thead>
                <tr>
                  <th scope="col">Staff</th>
                  <th scope="col">Pay</th>
                  <th scope="col" className="pay-table__num">
                    Hours
                  </th>
                  <th scope="col" className="pay-table__num">
                    Overtime
                  </th>
                  <th scope="col" className="pay-table__num">
                    Wages
                  </th>
                  <th scope="col" className="pay-table__num">
                    Salary
                  </th>
                  {showTips && (
                    <th scope="col" className="pay-table__num">
                      Tips
                    </th>
                  )}
                  <th scope="col" className="pay-table__num">
                    Gross
                  </th>
                </tr>
              </thead>
              <tbody>
                {payroll.lines.map((l) => (
                  <tr key={l.member.id}>
                    <td>
                      <span className="pay-table__name">{l.member.name}</span>
                      <span className="pay-table__sub">
                        {roleLabel(l.member.role)}
                        {!l.member.active && ' · deactivated'}
                      </span>
                    </td>
                    <td className="pay-table__soft">{payLabel(l.member)}</td>
                    <td className="pay-table__num">
                      <Mono>{(l.minutes / 60).toFixed(2)}</Mono>
                    </td>
                    <td className="pay-table__num">
                      {l.overtimeMinutes > 0 ? (
                        <Mono>{(l.overtimeMinutes / 60).toFixed(2)}</Mono>
                      ) : (
                        <Dash />
                      )}
                    </td>
                    <td className="pay-table__num">{l.wages ? <Mono>{money(l.wages)}</Mono> : <Dash />}</td>
                    <td className="pay-table__num">{l.salary ? <Mono>{money(l.salary)}</Mono> : <Dash />}</td>
                    {showTips && (
                      <td className="pay-table__num">{l.tips ? <Mono>{money(l.tips)}</Mono> : <Dash />}</td>
                    )}
                    <td className="pay-table__num">
                      <Mono className="pay-table__strong">{money(l.gross)}</Mono>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}>Total</td>
                  <td className="pay-table__num">
                    <Mono>
                      {(payroll.lines.reduce((s, l) => s + l.minutes, 0) / 60).toFixed(2)}
                    </Mono>
                  </td>
                  <td className="pay-table__num">
                    <Mono>{(payroll.totals.overtimeMinutes / 60).toFixed(2)}</Mono>
                  </td>
                  <td className="pay-table__num">
                    <Mono>{money(payroll.totals.wages)}</Mono>
                  </td>
                  <td className="pay-table__num">
                    <Mono>{money(payroll.totals.salary)}</Mono>
                  </td>
                  {showTips && (
                    <td className="pay-table__num">
                      <Mono>{money(payroll.totals.tips)}</Mono>
                    </td>
                  )}
                  <td className="pay-table__num">
                    <Mono>{money(payroll.totals.gross)}</Mono>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <p className="pay-note">
          Overtime is hours past {overtimeHours} in a Monday–Sunday week, at{' '}
          {OVERTIME_MULTIPLIER}× rate.{' '}
          {!showTips ? null : tipPooling ? (
            <>
              Tips from paid orders in the period are shared by hours among{' '}
              {TIP_ELIGIBLE.map((r) => roleLabel(r).toLowerCase() + 's').join(' and ')}.
            </>
          ) : (
            'Tip pooling is off, so tips aren’t included.'
          )}{' '}
          Salaried staff get their monthly salary — half at mid-month and half at month end
          when a month is split. Change these rules in Settings.
        </p>
      </section>

      <div className="pay-cols">
        <PayRates />
        <PayrollHistory />
      </div>
    </>
  );
}

/** Heading for a half-month run, beside its dates. */
const PART_TITLE: Record<Exclude<PayPart, 'whole'>, string> = {
  first: 'Mid-month',
  second: 'Rest of month',
};

const EMPTY_PAYROLL: Payroll = {
  lines: [],
  tipPool: 0,
  openShifts: [],
  totals: { wages: 0, salary: 0, tips: 0, gross: 0, overtimeMinutes: 0 },
};

/* ---------- Rates ---------- */

function PayRates() {
  const { staff } = usePos();
  const active = staff.filter((m) => m.active);
  return (
    <section className="panel" aria-labelledby="rates-title">
      <h2 className="panel__title" id="rates-title">
        Pay rates
      </h2>
      {active.map((m) => (
        <RateRow key={m.id} member={m} />
      ))}
    </section>
  );
}

function RateRow({ member }: { member: StaffMember }) {
  const { updateStaff } = usePos();
  const type = member.hourlyRate !== undefined ? 'hourly' : 'salary';
  const stored = type === 'hourly' ? member.hourlyRate : member.monthlySalary;
  const [draft, setDraft] = useState(stored !== undefined ? String(stored) : '');
  const [error, setError] = useState<string | null>(null);
  const errorId = `rate-error-${member.id}`;
  const currency = activeCurrency();

  function switchType(next: string) {
    setError(null);
    if (next === type) return;
    // Carry the pay across at full time (40h a week, ≈173h a month) as a starting point.
    if (next === 'hourly') {
      // No salary to convert from: start at 0 so the empty field asks for a rate.
      const rate = member.monthlySalary
        ? roundMoney(member.monthlySalary / FULL_TIME_HOURS_PER_MONTH)
        : 0;
      updateStaff(member.id, { hourlyRate: rate });
      setDraft(rate ? String(rate) : '');
    } else {
      const monthly = roundMoney((member.hourlyRate ?? 0) * FULL_TIME_HOURS_PER_MONTH);
      updateStaff(member.id, { hourlyRate: undefined, monthlySalary: monthly || undefined });
      setDraft(monthly ? String(monthly) : '');
    }
  }

  function commit() {
    const text = draft.trim().replace(/,/g, '');
    const value = Number(text);
    if (text === '' || !isAmountText(text) || value <= 0) {
      setError(
        type === 'hourly'
          ? `Enter the pay per hour in ${currency.code}${currency.decimals === 0 ? ', whole amounts' : ''}.`
          : `Enter the pay per month in ${currency.code}, e.g. ${currency.example * 200}.`,
      );
      setDraft(stored !== undefined ? String(stored) : '');
      return;
    }
    setError(null);
    const rounded = roundMoney(value);
    setDraft(String(rounded));
    updateStaff(member.id, type === 'hourly' ? { hourlyRate: rounded } : { monthlySalary: rounded });
  }

  return (
    <div className="rate-row">
      <span className="rate-row__who">
        <span className="rate-row__name">{member.name}</span>
        <span className="rate-row__role">{roleLabel(member.role)}</span>
      </span>
      <FilterSelect value={type} onChange={switchType} label={`Pay type for ${member.name}`}>
        <option value="hourly">Hourly</option>
        <option value="salary">Monthly salary</option>
      </FilterSelect>
      <span className="rate-row__amount">
        <span className="rate-row__unit" aria-hidden="true">
          {currency.symbol}
        </span>
        <input
          className="rate-input mono"
          type="text"
          inputMode="decimal"
          value={draft}
          placeholder={(0).toFixed(currency.decimals)}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          aria-label={`${type === 'hourly' ? 'Hourly rate' : 'Monthly salary'} for ${member.name}`}
          aria-invalid={error !== null}
          aria-describedby={error ? errorId : undefined}
        />
        <span className="rate-row__unit" aria-hidden="true">
          {type === 'hourly' ? '/hr' : '/mo'}
        </span>
      </span>
      {error && (
        <p className="rate-row__error" id={errorId}>
          {error}
        </p>
      )}
    </div>
  );
}

/* ---------- History ---------- */

function PayrollHistory() {
  const { payrollRuns } = usePos();
  return (
    <section className="panel" aria-labelledby="history-title">
      <h2 className="panel__title" id="history-title">
        Payroll history
      </h2>
      {payrollRuns.length === 0 ? (
        <p className="pay-empty pay-empty--left">
          No periods marked paid yet. Pick a period above and mark it paid once it’s been sent.
        </p>
      ) : (
        <table className="pay-table">
          <thead>
            <tr>
              <th scope="col">Period</th>
              <th scope="col">Paid</th>
              <th scope="col" className="pay-table__num">
                People
              </th>
              <th scope="col" className="pay-table__num">
                Gross
              </th>
            </tr>
          </thead>
          <tbody>
            {payrollRuns.map((run) => (
              <tr key={run.id}>
                <td className="pay-table__name">{run.dates}</td>
                <td>
                  {run.paidAt}
                  <span className="pay-table__sub">by {run.paidBy}</span>
                </td>
                <td className="pay-table__num">
                  <Mono>{run.lines.length}</Mono>
                </td>
                <td className="pay-table__num">
                  <Mono className="pay-table__strong">{money(run.gross)}</Mono>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="pay-tile">
      <div className="pay-tile__label">{label}</div>
      <Mono className="pay-tile__value">{value}</Mono>
      {note && <div className="pay-tile__note">{note}</div>}
    </div>
  );
}

function Dash() {
  return (
    <span className="pay-table__soft">
      <span aria-hidden="true">—</span>
      <span className="sr-only">None</span>
    </span>
  );
}
