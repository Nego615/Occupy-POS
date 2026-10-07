import { useMemo, useState } from 'react';
import './AdminSalaries.css';
import { Button } from '../components/Button';
import { Mono } from '../components/Mono';
import { Pill, PillRow } from '../components/Pill';
import { StatusChip } from '../components/StatusChip';
import { roleLabel, type StaffMember } from '../data/staff';
import { downloadCsv, money } from '../lib/analytics';
import {
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
import { formatDate } from '../lib/useClock';

/**
 * What the team is owed for a month, and the salaries it's worked out from.
 * Owner-only (the `payroll` permission). Everyone is paid a monthly salary.
 * Marking a month paid freezes it into the history.
 *
 * A month is paid whole, or in two parts: mid-month (1st–15th) then the rest
 * (16th–end). Whichever way a month starts decides what's left — once the
 * 1st–15th is paid only the rest can follow, and a whole-month payment rules
 * out both halves.
 */
export function AdminSalaries() {
  const { staff, me, payrollRuns, recordPayrollRun, settings } = usePos();
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
    () => (range ? computePayroll(staff, range) : EMPTY_PAYROLL),
    // range is rebuilt each render; whether there is one, and its part, are what matter.
    [staff, range?.part, range === null],
  );
  const unset = staff.filter((m) => m.active && !m.monthlySalary);

  const paid = runFor(part);

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
        gross: l.gross,
      })),
    });
    setConfirming(false);
  }

  function exportCsv() {
    downloadCsv(
      toCsv([
        ['staff', 'role', 'salary', 'gross'],
        ...payroll.lines.map((l) => [
          l.member.name,
          roleLabel(l.member.role),
          payLabel(l.member),
          l.gross.toFixed(2),
        ]),
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

      <div className="pay-tiles">
        <Tile label="Gross pay" value={money(payroll.totals.gross)} />
        <Tile
          label="People paid"
          value={String(payroll.lines.length)}
          note={
            unset.length > 0
              ? `${unset.length} active ${unset.length === 1 ? 'person has' : 'people have'} no salary set`
              : undefined
          }
        />
      </div>

      {/* ---------- Pay for the period ---------- */}
      <section className="panel pay-section" aria-labelledby="pay-title">
        <div className="pay-section__head">
          <h2 className="panel__title" id="pay-title">
            {part === 'whole' ? `Pay for ${period.month}` : `${PART_TITLE[part]} · ${dates}`}
          </h2>
          <div className="pay-close">
            {paid ? (
              <StatusChip status="open" size="sm">
                Paid {paid.paidAt} · {paid.paidBy}
              </StatusChip>
            ) : (
              <>
                {blocked && <span className="pay-close__why">{blocked}</span>}
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
              ? 'Nobody has a salary set yet — enter them under Salaries below.'
              : 'The rest of the month starts on the 16th.'}
          </p>
        ) : (
          <div className="pay-table-wrap">
            <table className="pay-table">
              <thead>
                <tr>
                  <th scope="col">Staff</th>
                  <th scope="col">Salary</th>
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
                      <span className="pay-table__sub">{roleLabel(l.member.role)}</span>
                    </td>
                    <td className="pay-table__soft">{payLabel(l.member)}</td>
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
                    <Mono>{money(payroll.totals.gross)}</Mono>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <p className="pay-note">
          Everyone on staff gets their monthly salary — half at mid-month and half at month end
          when a month is split. Tips aren’t included; they’re paid out directly.
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

const EMPTY_PAYROLL: Payroll = { lines: [], totals: { gross: 0 } };

/* ---------- Rates ---------- */

function PayRates() {
  const { staff } = usePos();
  const active = staff.filter((m) => m.active);
  return (
    <section className="panel" aria-labelledby="rates-title">
      <h2 className="panel__title" id="rates-title">
        Salaries
      </h2>
      {active.map((m) => (
        <RateRow key={m.id} member={m} />
      ))}
    </section>
  );
}

function RateRow({ member }: { member: StaffMember }) {
  const { updateStaff } = usePos();
  const stored = member.monthlySalary;
  const [draft, setDraft] = useState(stored !== undefined ? String(stored) : '');
  const [error, setError] = useState<string | null>(null);
  const errorId = `rate-error-${member.id}`;
  const currency = activeCurrency();

  function commit() {
    const text = draft.trim().replace(/,/g, '');
    const value = Number(text);
    if (text === '' || !isAmountText(text) || value <= 0) {
      setError(`Enter the pay per month in ${currency.code}, e.g. ${currency.example * 200}.`);
      setDraft(stored !== undefined ? String(stored) : '');
      return;
    }
    setError(null);
    const rounded = roundMoney(value);
    setDraft(String(rounded));
    updateStaff(member.id, { monthlySalary: rounded });
  }

  return (
    <div className="rate-row">
      <span className="rate-row__who">
        <span className="rate-row__name">{member.name}</span>
        <span className="rate-row__role">{roleLabel(member.role)}</span>
      </span>
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
          aria-label={`Monthly salary for ${member.name}`}
          aria-invalid={error !== null}
          aria-describedby={error ? errorId : undefined}
        />
        <span className="rate-row__unit" aria-hidden="true">
          /mo
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
