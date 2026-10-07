import { type StaffMember } from '../data/staff';
import { money } from './analytics';
import { round } from './cart';
import { roundMoney } from './currency';
import { dateOfDaysAgo, daysAgoOf } from '../data/history';

/**
 * Gross pay for a pay period: each person's monthly salary. Gross only —
 * taxes and deductions belong to whatever actually runs payroll.
 *
 * Pay runs monthly, by calendar month — either in one go, or split: a
 * mid-month payment for the 1st–15th and the rest (16th–end) at month end.
 * Salaried staff get half their salary in each part.
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
  /** The current month. */
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
  /** Still running. */
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

export type PayLine = {
  member: StaffMember;
  /** The month's salary — or half of it, for a mid-month or month-end part. */
  gross: number;
};

export type Payroll = {
  lines: PayLine[];
  totals: { gross: number };
};

export function computePayroll(staff: StaffMember[], range: Pick<PayRange, 'part'>): Payroll {
  const lines: PayLine[] = staff
    // Only people still on staff are paid.
    .filter((member) => member.active && member.monthlySalary)
    .map((member) => ({ member, gross: salaryFor(member.monthlySalary!, range.part) }))
    .sort((a, b) => b.gross - a.gross);
  return { lines, totals: { gross: round(lines.reduce((s, l) => s + l.gross, 0)) } };
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
  /** `hours` is only on runs from before staff were all salaried. */
  lines: { staffId: string; name: string; hours?: number; gross: number }[];
};

/**
 * Staff saved when people could be paid by the hour, moved onto a monthly
 * salary at full time (40h a week, ≈173h a month). Hands back `staff` itself
 * when nobody needed it.
 */
export function salaried(staff: StaffMember[]): StaffMember[] {
  let changed = false;
  const next = staff.map((member) => {
    const { hourlyRate, ...rest } = member as StaffMember & { hourlyRate?: number };
    if (hourlyRate === undefined) return member;
    changed = true;
    return { ...rest, monthlySalary: roundMoney(hourlyRate * FULL_TIME_HOURS_PER_MONTH) || undefined };
  });
  return changed ? next : staff;
}

/** "TSh 2,000,000/mo", or "Not set". */
export function payLabel(member: StaffMember): string {
  if (member.monthlySalary) return `${money(member.monthlySalary)}/mo`;
  return 'Not set';
}
