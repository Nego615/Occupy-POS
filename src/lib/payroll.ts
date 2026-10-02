import { type Order } from '../data/orders';
import {
  TIP_ELIGIBLE,
  shiftMinutes,
  type Shift,
  type StaffMember,
} from '../data/staff';
import { money } from './analytics';
import { round } from './cart';
import { dateOfDaysAgo, daysAgoOf } from '../data/history';

/**
 * Gross pay for a pay period: hourly wages with weekly overtime, monthly
 * salaries, and the period's tips pooled by hours. Gross only — taxes and
 * deductions belong to whatever actually runs payroll.
 *
 * Pay runs monthly, by calendar month — either in one go, or split: a
 * mid-month payment for the 1st–15th and the rest (16th–end) at month end.
 * Salaried staff get half their salary in each part.
 *
 * Overtime is still a weekly rule, so hours are grouped into Monday–Sunday
 * weeks inside whatever is being paid; a week that straddles the boundary
 * counts only its days on this side of it.
 */

export type PayPeriodId = 'this-month' | 'last-month';

export type PayPeriod = {
  id: PayPeriodId;
  /** "This month", "Last month". */
  label: string;
  /** "September 2026". */
  month: string;
  /** "YYYY-MM" — one payroll run per month. */
  key: string;
  /** Most recent day in the period, as daysAgo. */
  newest: number;
  /** Oldest day in the period (the 1st), as daysAgo. */
  oldest: number;
  /** The current month — its hours run only to today. */
  inProgress: boolean;
};

/** This month so far, and last month in full. */
export function payPeriods(today = new Date()): PayPeriod[] {
  const monthOf = (offset: number) => new Date(today.getFullYear(), today.getMonth() + offset, 1);
  const describe = (first: Date) => ({
    month: first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    key: `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}`,
  });
  const thisMonth = monthOf(0);
  const lastMonth = monthOf(-1);
  return [
    {
      id: 'this-month',
      label: 'This month',
      ...describe(thisMonth),
      newest: 0,
      oldest: daysAgoOf(thisMonth),
      inProgress: true,
    },
    {
      id: 'last-month',
      label: 'Last month',
      ...describe(lastMonth),
      // The day before the 1st of this month.
      newest: daysAgoOf(thisMonth) + 1,
      oldest: daysAgoOf(lastMonth),
      inProgress: false,
    },
  ];
}

export const OVERTIME_MULTIPLIER = 1.5;
/** Hours in an average month of 40-hour weeks: 40 × 52 ÷ 12. */
export const FULL_TIME_HOURS_PER_MONTH = (40 * 52) / 12;

/** "Sep 1 – Sep 28" for a month in progress, "August 2026" for a closed one. */
export function periodDates(period: PayPeriod): string {
  if (!period.inProgress) return period.month;
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${fmt(dateOfDaysAgo(period.oldest))} – ${fmt(dateOfDaysAgo(period.newest))}`;
}

export type PayPart = 'whole' | 'first' | 'second';

export const PAY_PARTS: { id: PayPart; label: string; short: string }[] = [
  { id: 'whole', label: 'Whole month', short: 'whole month' },
  { id: 'first', label: 'Mid-month · 1st–15th', short: '1st–15th' },
  { id: 'second', label: 'Rest of month · 16th–end', short: '16th–end' },
];

/** The stretch of days one payroll run covers — a whole month or half of one. */
export type PayRange = {
  part: PayPart;
  /** "2026-09" for a whole month, "2026-09-mid" and "2026-09-end" for its halves. */
  key: string;
  /** "August 2026", or "Aug 1 – Aug 15" for a part or a month in progress. */
  dates: string;
  newest: number;
  oldest: number;
  /** Still running — its hours count up to today. */
  inProgress: boolean;
};

const MID_MONTH_DAY = 15;

/**
 * The days `part` of `period` covers. Null for the 16th–end before the 16th
 * has arrived — there's nothing in it to pay yet.
 */
export function payRange(period: PayPeriod, part: PayPart): PayRange | null {
  const fmt = (daysAgo: number) =>
    dateOfDaysAgo(daysAgo).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const span = (oldest: number, newest: number) => `${fmt(oldest)} – ${fmt(newest)}`;
  // daysAgo of the 15th of the month.
  const mid = period.oldest - (MID_MONTH_DAY - 1);

  if (part === 'whole') {
    return {
      part,
      key: period.key,
      dates: periodDates(period),
      newest: period.newest,
      oldest: period.oldest,
      inProgress: period.inProgress,
    };
  }
  if (part === 'first') {
    // Before the 15th is over, the first half is only as far as today.
    const newest = Math.max(mid, period.newest);
    return {
      part,
      key: `${period.key}-mid`,
      dates: span(period.oldest, newest),
      newest,
      oldest: period.oldest,
      inProgress: period.inProgress && mid <= period.newest,
    };
  }
  const oldest = mid - 1;
  if (oldest < period.newest) return null;
  return {
    part,
    key: `${period.key}-end`,
    dates: span(oldest, period.newest),
    newest: period.newest,
    oldest,
    inProgress: period.inProgress,
  };
}

/** Monday of the week a day falls in, as "YYYY-MM-DD" — the overtime bucket. */
function weekOf(daysAgo: number): string {
  const d = dateOfDaysAgo(daysAgo);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export type PayLine = {
  member: StaffMember;
  /** Paid minutes worked in the period. */
  minutes: number;
  overtimeMinutes: number;
  /** Straight-time plus overtime, for hourly staff. */
  wages: number;
  /** The month's salary — or half of it, for a mid-month or month-end part. */
  salary: number;
  tips: number;
  gross: number;
};

export type Payroll = {
  lines: PayLine[];
  /** Tips on paid orders in the period, before splitting. */
  tipPool: number;
  /** Staff still on the clock inside the period — it can't be closed out yet. */
  openShifts: StaffMember[];
  totals: { wages: number; salary: number; tips: number; gross: number; overtimeMinutes: number };
};

export function computePayroll(
  staff: StaffMember[],
  shifts: Shift[],
  orders: Order[],
  range: Pick<PayRange, 'newest' | 'oldest' | 'part'>,
  nowMinutes: number,
  /** From Settings: weekly overtime threshold, and whether tips go through payroll. */
  options: { overtimeHours: number; tipPooling: boolean },
): Payroll {
  const overtimeAfter = options.overtimeHours * 60;
  const inPeriod = (daysAgo: number) => daysAgo >= range.newest && daysAgo <= range.oldest;
  const periodShifts = shifts.filter((s) => inPeriod(s.daysAgo));

  const tipPool = round(
    orders
      .filter((o) => o.status === 'paid' && inPeriod(o.daysAgo))
      .reduce((sum, o) => sum + o.tip, 0),
  );

  // Hours first — the tip split needs everyone's before anyone's tips are known.
  const worked = staff.map((member) => {
    const mine = periodShifts.filter((s) => s.staffId === member.id);
    // Overtime is weekly, so tally each Monday–Sunday week on its own.
    const weeks = new Map<string, number>();
    for (const shift of mine) {
      const key = weekOf(shift.daysAgo);
      weeks.set(key, (weeks.get(key) ?? 0) + shiftMinutes(shift, nowMinutes));
    }
    let minutes = 0;
    let overtimeMinutes = 0;
    for (const week of weeks.values()) {
      minutes += week;
      overtimeMinutes += Math.max(0, week - overtimeAfter);
    }
    return { member, minutes, overtimeMinutes };
  });

  const hourly = (m: StaffMember) => m.hourlyRate !== undefined;
  // With pooling off, tips are handed out directly and never enter payroll.
  const eligible = worked.filter(
    (w) =>
      options.tipPooling && hourly(w.member) && TIP_ELIGIBLE.includes(w.member.role) && w.minutes > 0,
  );
  const eligibleMinutes = eligible.reduce((sum, w) => sum + w.minutes, 0);

  const lines: PayLine[] = worked
    .map(({ member, minutes, overtimeMinutes }) => {
      const rate = member.hourlyRate;
      const wages =
        rate === undefined
          ? 0
          : round(
              ((minutes - overtimeMinutes) / 60) * rate +
                (overtimeMinutes / 60) * rate * OVERTIME_MULTIPLIER,
            );
      // Salaried people are paid for the period whether or not they clocked in —
      // but only if they're still on staff.
      const salary =
        rate === undefined && member.monthlySalary && member.active
          ? salaryFor(member.monthlySalary, range.part)
          : 0;
      const tips =
        eligibleMinutes > 0 && eligible.some((e) => e.member.id === member.id)
          ? round((tipPool * minutes) / eligibleMinutes)
          : 0;
      return {
        member,
        minutes,
        overtimeMinutes,
        wages,
        salary,
        tips,
        gross: round(wages + salary + tips),
      };
    })
    .filter((l) => l.gross > 0 || l.minutes > 0)
    .sort((a, b) => b.gross - a.gross);

  const sum = (pick: (l: PayLine) => number) => round(lines.reduce((s, l) => s + pick(l), 0));

  return {
    lines,
    tipPool,
    openShifts: staff.filter((m) =>
      periodShifts.some((s) => s.staffId === m.id && s.clockOut === null),
    ),
    totals: {
      wages: sum((l) => l.wages),
      salary: sum((l) => l.salary),
      tips: sum((l) => l.tips),
      gross: sum((l) => l.gross),
      overtimeMinutes: lines.reduce((s, l) => s + l.overtimeMinutes, 0),
    },
  };
}

/**
 * A month's salary, or its share for one part. The month-end half takes
 * whatever the mid-month half's rounding left, so the two always add up.
 */
function salaryFor(monthly: number, part: PayPart): number {
  const firstHalf = round(monthly / 2);
  if (part === 'first') return firstHalf;
  if (part === 'second') return round(monthly - firstHalf);
  return round(monthly);
}

/** A pay period marked as paid, frozen at what it came to then. */
export type PayrollRun = {
  id: string;
  /** From PayRange: "2026-08" for a whole month, "2026-08-mid" / "2026-08-end" for halves. */
  key: string;
  dates: string;
  /** When it was marked paid, for display. */
  paidAt: string;
  paidBy: string;
  gross: number;
  lines: { staffId: string; name: string; hours: number; gross: number }[];
};

/** "TSh 4,500/hr", "TSh 2,000,000/mo", or "Not set". */
export function payLabel(member: StaffMember): string {
  if (member.hourlyRate !== undefined) return `${money(member.hourlyRate)}/hr`;
  if (member.monthlySalary) return `${money(member.monthlySalary)}/mo`;
  return 'Not set';
}
