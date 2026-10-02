import { useMemo, useState } from 'react';
import './AdminTimecards.css';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { FilterSelect } from '../components/FilterSelect';
import { Mono } from '../components/Mono';
import { Pill, PillRow } from '../components/Pill';
import { StatusChip } from '../components/StatusChip';
import {
  formatClock,
  formatDuration,
  fromTimeInput,
  roleLabel,
  shiftMinutes,
  toTimeInput,
  type Shift,
  type StaffMember,
} from '../data/staff';
import { downloadCsv, money } from '../lib/analytics';
import { dayLabel, toCsv } from '../lib/reports';
import { usePos } from '../lib/store';
import { useMinutesNow } from '../lib/useClock';

type RangeId = 'today' | 'week' | 'fortnight';

const RANGES: { id: RangeId; label: string; days: number }[] = [
  { id: 'today', label: 'Today', days: 1 },
  { id: 'week', label: '7 days', days: 7 },
  { id: 'fortnight', label: '14 days', days: 14 },
];


/**
 * Who's working now, hours per person with estimated pay, and the shift log
 * a manager corrects when someone forgets to clock out.
 */
export function AdminTimecards() {
  const { staff, allStaff, shifts, clockIn, clockOut, can, settings } = usePos();
  // Wages are payroll data — managers run timecards but don't see what people earn.
  const showPay = can('payroll');
  const now = useMinutesNow();
  const [range, setRange] = useState<RangeId>('week');
  const [person, setPerson] = useState<string>('all');
  const [toClockIn, setToClockIn] = useState('');

  const days = RANGES.find((r) => r.id === range)!.days;
  const byId = useMemo(() => new Map(allStaff.map((m) => [m.id, m])), [allStaff]);

  const open = shifts.filter((s) => s.clockOut === null);
  const offClock = staff.filter((m) => m.active && !open.some((s) => s.staffId === m.id));

  const inRange = useMemo(() => shifts.filter((s) => s.daysAgo < days), [shifts, days]);
  const logged = useMemo(
    () => (person === 'all' ? inRange : inRange.filter((s) => s.staffId === person)),
    [inRange, person],
  );

  const totals = useMemo(() => {
    const rows = staff
      .map((member) => {
        const mine = inRange.filter((s) => s.staffId === member.id);
        const minutes = mine.reduce((sum, s) => sum + shiftMinutes(s, now), 0);
        const pay = member.hourlyRate !== undefined ? (minutes / 60) * member.hourlyRate : null;
        return { member, shifts: mine.length, minutes, pay };
      })
      .filter((r) => r.shifts > 0)
      .sort((a, b) => b.minutes - a.minutes);
    return {
      rows,
      minutes: rows.reduce((sum, r) => sum + r.minutes, 0),
      pay: rows.reduce((sum, r) => sum + (r.pay ?? 0), 0),
      shifts: rows.reduce((sum, r) => sum + r.shifts, 0),
    };
  }, [staff, inRange, now]);

  function startShift() {
    if (toClockIn && clockIn(toClockIn)) setToClockIn('');
  }

  function exportCsv() {
    const rows = logged.map((s) => {
      const member = byId.get(s.staffId);
      const minutes = shiftMinutes(s, now);
      return [
        dayLabel(s.daysAgo),
        member?.name ?? 'Unknown',
        member ? roleLabel(member.role) : '',
        formatClock(s.clockIn),
        s.clockOut === null ? 'on the clock' : formatClock(s.clockOut),
        s.breakMinutes,
        (minutes / 60).toFixed(2),
        ...(showPay
          ? [
              member?.hourlyRate?.toFixed(2) ?? 'salaried',
              member?.hourlyRate !== undefined
                ? ((minutes / 60) * member.hourlyRate).toFixed(2)
                : '',
            ]
          : []),
      ];
    });
    downloadCsv(
      toCsv([
        [
          'date',
          'staff',
          'role',
          'clock_in',
          'clock_out',
          'break_min',
          'hours',
          ...(showPay ? ['rate', 'est_pay'] : []),
        ],
        ...rows,
      ]),
      `occupy-timecards-${range}-${new Date().toISOString().slice(0, 10)}.csv`,
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Timecards</h1>
          <div className="page-sub">
            {settings.locationName} · <Mono>{open.length}</Mono> on the clock now
          </div>
        </div>
        <div className="head-actions">
          <PillRow label="Date range">
            {RANGES.map((r) => (
              <Pill key={r.id} active={r.id === range} onClick={() => setRange(r.id)}>
                {r.label}
              </Pill>
            ))}
          </PillRow>
          <Button
            variant="secondary"
            size="sm"
            onClick={exportCsv}
            disabled={logged.length === 0}
          >
            Export CSV
          </Button>
        </div>
      </div>

      <div className="timecards__top">
        {/* ---------- On the clock ---------- */}
        <section className="panel" aria-labelledby="on-clock-title">
          <h2 className="panel__title" id="on-clock-title">
            On the clock
          </h2>
          {open.length === 0 ? (
            <p className="timecards__empty">Nobody is clocked in.</p>
          ) : (
            open.map((shift) => {
              const member = byId.get(shift.staffId);
              if (!member) return null;
              return (
                <div className="clock-row" key={shift.id}>
                  <Avatar name={member.name} onClock />
                  <span className="clock-row__who">
                    <span className="clock-row__name">{member.name}</span>
                    <span className="clock-row__meta">
                      {roleLabel(member.role)} · in <Mono>{formatClock(shift.clockIn)}</Mono>
                    </span>
                  </span>
                  <Mono className="clock-row__elapsed">
                    {formatDuration(shiftMinutes(shift, now))}
                  </Mono>
                  <Button variant="secondary" size="sm" onClick={() => clockOut(member.id)}>
                    Clock out
                  </Button>
                </div>
              );
            })
          )}

          <div className="clock-in">
            <FilterSelect value={toClockIn} onChange={setToClockIn} label="Staff member to clock in">
              <option value="">
                {offClock.length ? 'Choose someone…' : 'Everyone is clocked in'}
              </option>
              {offClock.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </FilterSelect>
            <Button size="sm" onClick={startShift} disabled={!toClockIn}>
              Clock in now
            </Button>
          </div>
        </section>

        {/* ---------- Hours by person ---------- */}
        <section className="panel" aria-labelledby="hours-title">
          <h2 className="panel__title" id="hours-title">
            Hours {range === 'today' ? 'today' : `· last ${days} days`}
          </h2>
          {totals.rows.length === 0 ? (
            <p className="timecards__empty">No shifts in this range.</p>
          ) : (
            <table className="tc-table">
              <thead>
                <tr>
                  <th scope="col">Staff</th>
                  <th scope="col" className="tc-table__num">
                    Shifts
                  </th>
                  <th scope="col" className="tc-table__num">
                    Hours
                  </th>
                  {showPay && (
                    <>
                      <th scope="col" className="tc-table__num">
                        Rate
                      </th>
                      <th scope="col" className="tc-table__num">
                        Est. pay
                      </th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {totals.rows.map((r) => (
                  <tr key={r.member.id}>
                    <td>
                      <span className="tc-table__who">
                        {r.member.name}
                        {range === 'week' && r.minutes > settings.overtimeHours * 60 && (
                          <StatusChip status="occupied" size="sm">
                            Over {settings.overtimeHours}h
                          </StatusChip>
                        )}
                      </span>
                      <span className="tc-table__sub">{roleLabel(r.member.role)}</span>
                    </td>
                    <td className="tc-table__num">
                      <Mono>{r.shifts}</Mono>
                    </td>
                    <td className="tc-table__num">
                      <Mono>{(r.minutes / 60).toFixed(2)}</Mono>
                    </td>
                    {showPay && (
                      <>
                        <td className="tc-table__num">
                          {r.member.hourlyRate !== undefined ? (
                            <Mono>{money(r.member.hourlyRate)}</Mono>
                          ) : (
                            <span className="tc-table__soft">Salaried</span>
                          )}
                        </td>
                        <td className="tc-table__num">
                          {r.pay !== null ? (
                            <Mono className="tc-table__strong">{money(r.pay)}</Mono>
                          ) : (
                            <span className="tc-table__soft">—</span>
                          )}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td className="tc-table__num">
                    <Mono>{totals.shifts}</Mono>
                  </td>
                  <td className="tc-table__num">
                    <Mono>{(totals.minutes / 60).toFixed(2)}</Mono>
                  </td>
                  {showPay && (
                    <>
                      <td />
                      <td className="tc-table__num">
                        <Mono>{money(totals.pay)}</Mono>
                      </td>
                    </>
                  )}
                </tr>
              </tfoot>
            </table>
          )}
          {showPay && (
            <p className="timecards__note">
              Estimated pay is hours × rate, before tips, taxes, and overtime premiums — see
              Salaries for the full picture.
            </p>
          )}
        </section>
      </div>

      {/* ---------- Shift log ---------- */}
      <section className="panel" aria-labelledby="log-title">
        <div className="timecards__log-head">
          <h2 className="panel__title" id="log-title">
            Shifts
          </h2>
          <FilterSelect value={person} onChange={setPerson} label="Filter shifts by staff">
            <option value="all">Everyone</option>
            {staff.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </FilterSelect>
        </div>

        {logged.length === 0 ? (
          <p className="timecards__empty">No shifts match.</p>
        ) : (
          <table className="tc-table tc-table--log">
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">Staff</th>
                <th scope="col">In</th>
                <th scope="col">Out</th>
                <th scope="col">Break</th>
                <th scope="col" className="tc-table__num">
                  Hours
                </th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {logged.map((shift) => (
                <ShiftRow
                  key={shift.id}
                  shift={shift}
                  member={byId.get(shift.staffId)}
                  now={now}
                />
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

function ShiftRow({
  shift,
  member,
  now,
}: {
  shift: Shift;
  member?: StaffMember;
  now: number;
}) {
  const { updateShift, removeShift } = usePos();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ in: '', out: '', break: '' });
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const name = member?.name ?? 'Unknown';

  function startEdit() {
    setDraft({
      in: toTimeInput(shift.clockIn),
      out: shift.clockOut === null ? '' : toTimeInput(shift.clockOut),
      break: String(shift.breakMinutes),
    });
    setError(null);
    setConfirmingDelete(false);
    setEditing(true);
  }

  function save() {
    const clockIn = fromTimeInput(draft.in);
    // Blank out keeps (or makes) the shift open — the fix for a premature clock-out.
    const clockOut = draft.out === '' ? null : fromTimeInput(draft.out);
    const breakMinutes = Number(draft.break || 0);
    if (clockIn === null) return setError('Enter a clock-in time.');
    if (draft.out !== '' && clockOut === null) return setError('Enter a valid clock-out time.');
    if (clockOut !== null && clockOut <= clockIn)
      return setError('Clock-out has to be after clock-in.');
    if (clockOut === null && shift.daysAgo > 0)
      return setError('A past shift needs a clock-out time.');
    if (clockOut === null && clockIn > now) return setError('Clock-in can’t be in the future.');
    if (!Number.isInteger(breakMinutes) || breakMinutes < 0)
      return setError('Break is whole minutes, like 30.');
    const span = (clockOut ?? now) - clockIn;
    if (breakMinutes >= span) return setError('Break can’t be as long as the shift.');
    updateShift(shift.id, { clockIn, clockOut, breakMinutes });
    setEditing(false);
  }

  if (editing) {
    return (
      <tr className="shift-row shift-row--editing">
        <td>{dayLabel(shift.daysAgo)}</td>
        <td className="shift-row__name">{name}</td>
        <td>
          <input
            type="time"
            className="tc-input"
            value={draft.in}
            onChange={(e) => setDraft({ ...draft, in: e.target.value })}
            aria-label={`Clock in for ${name}`}
          />
        </td>
        <td>
          <input
            type="time"
            className="tc-input"
            value={draft.out}
            onChange={(e) => setDraft({ ...draft, out: e.target.value })}
            aria-label={`Clock out for ${name}, blank if still on the clock`}
          />
        </td>
        <td>
          <input
            type="number"
            min={0}
            step={5}
            className="tc-input tc-input--break mono"
            value={draft.break}
            onChange={(e) => setDraft({ ...draft, break: e.target.value })}
            aria-label={`Break minutes for ${name}`}
          />
        </td>
        <td colSpan={2}>
          <div className="shift-row__actions">
            <Button size="sm" onClick={save}>
              Save
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                confirmingDelete ? removeShift(shift.id) : setConfirmingDelete(true)
              }
            >
              {confirmingDelete ? 'Confirm delete' : 'Delete'}
            </Button>
          </div>
          {error && (
            <p className="shift-row__error" role="alert">
              {error}
            </p>
          )}
        </td>
      </tr>
    );
  }

  return (
    <tr className="shift-row">
      <td>{dayLabel(shift.daysAgo)}</td>
      <td className="shift-row__name">{name}</td>
      <td>
        <Mono>{formatClock(shift.clockIn)}</Mono>
      </td>
      <td>
        {shift.clockOut === null ? (
          <StatusChip status="open" size="sm">
            On the clock
          </StatusChip>
        ) : (
          <Mono>{formatClock(shift.clockOut)}</Mono>
        )}
      </td>
      <td>
        {shift.breakMinutes ? (
          <Mono>{`${shift.breakMinutes}m`}</Mono>
        ) : (
          <span className="tc-table__soft">—</span>
        )}
      </td>
      <td className="tc-table__num">
        <Mono className="tc-table__strong">{formatDuration(shiftMinutes(shift, now))}</Mono>
      </td>
      <td className="tc-table__num">
        <Button variant="secondary" size="sm" onClick={startEdit} aria-label={`Edit ${name}'s shift, ${dayLabel(shift.daysAgo)}`}>
          Edit
        </Button>
      </td>
    </tr>
  );
}
