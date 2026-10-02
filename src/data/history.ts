/**
 * How far back the seeded history goes: to the 1st of last month, so a
 * monthly payroll always has one whole closed month to show, and "last 30
 * days" comparisons have a full prior period.
 */
export const HISTORY_DAYS = daysAgoOf(
  new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1),
);

/** Calendar days between `date` and today — 0 for today, 1 for yesterday. */
export function daysAgoOf(date: Date): number {
  const today = new Date();
  const a = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const b = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((a - b) / 86_400_000);
}

/** "2026-09-29" in local time. */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Days between a "2026-09-29" date and today. */
export function daysAgoOfIsoDate(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return daysAgoOf(new Date(y, m - 1, d));
}

/** The calendar date `daysAgo` days before today. */
export function dateOfDaysAgo(daysAgo: number): Date {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d;
}
