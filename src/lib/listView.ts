import { isoDate } from '../data/history';

/**
 * The pieces every list shares: a time filter, a sort, and a text search.
 * Each page says which presets and sorts make sense for it; what they mean
 * is decided here once, so "7 days" or "Newest first" reads the same
 * everywhere in the app.
 */

/* ---------- Time ---------- */

export type TimePreset =
  | 'today'
  | 'yesterday'
  | '7d'
  | '30d'
  | 'this-month'
  | 'last-month'
  | 'all'
  | 'custom';

export const TIME_PRESET_LABEL: Record<TimePreset, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  '7d': '7 days',
  '30d': '30 days',
  'this-month': 'This month',
  'last-month': 'Last month',
  all: 'All time',
  custom: 'Pick dates',
};

/**
 * Hours of the day to keep, `from` inclusive to `to` exclusive (0–24).
 * When `to` is at or before `from` the window runs past midnight —
 * 20 → 2 is "8 pm to 2 am".
 */
export type HourWindow = { from: number; to: number };

export type TimeFilter = {
  preset: TimePreset;
  /** Custom only: first and last day to show, "2026-11-03", either open-ended. */
  from?: string;
  to?: string;
  /** Null is any time of day. */
  hours: HourWindow | null;
};

export const ANY_TIME: TimeFilter = { preset: 'all', hours: null };

export function timeFilter(preset: TimePreset): TimeFilter {
  return { preset, hours: null };
}

/** True when the filter narrows anything at all. */
export function timeFilterActive(f: TimeFilter): boolean {
  return f.preset !== 'all' || f.hours !== null;
}

function shiftDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d;
}

/** First and last day the filter takes in, as "2026-11-03"; null is unbounded. */
export function dayBounds(f: TimeFilter, now = new Date()): { from: string | null; to: string | null } {
  const today = isoDate(now);
  switch (f.preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const y = isoDate(shiftDays(now, -1));
      return { from: y, to: y };
    }
    case '7d':
      return { from: isoDate(shiftDays(now, -6)), to: today };
    case '30d':
      return { from: isoDate(shiftDays(now, -29)), to: today };
    case 'this-month':
      return { from: isoDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
    case 'last-month':
      return {
        from: isoDate(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        to: isoDate(new Date(now.getFullYear(), now.getMonth(), 0)),
      };
    case 'custom': {
      // Dates picked the wrong way round still mean the days between them.
      const [a, b] = [f.from ?? null, f.to ?? null];
      if (a && b && a > b) return { from: b, to: a };
      return { from: a, to: b };
    }
    case 'all':
      return { from: null, to: null };
  }
}

const wraps = (w: HourWindow) => w.to <= w.from;

export function inHourWindow(hour: number, w: HourWindow): boolean {
  return wraps(w) ? hour >= w.from || hour < w.to : hour >= w.from && hour < w.to;
}

/** A plain day ("2026-11-03") inside the filter's days. Hours don't apply to it. */
export function dayInFilter(day: string, f: TimeFilter, now = new Date()): boolean {
  const { from, to } = dayBounds(f, now);
  return (!from || day >= from) && (!to || day <= to);
}

/**
 * A moment (ISO timestamp) inside the filter. With an hour window that runs
 * past midnight, the small hours count toward the night before — so
 * "Yesterday, 20:00–02:00" is last night's whole service, not two scraps of
 * two different days.
 */
export function momentInFilter(iso: string, f: TimeFilter, now = new Date()): boolean {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return f.preset === 'all' && f.hours === null;
  let day = at;
  if (f.hours) {
    const hour = at.getHours();
    if (!inHourWindow(hour, f.hours)) return false;
    if (wraps(f.hours) && hour < f.hours.to) day = shiftDays(at, -1);
  }
  return dayInFilter(isoDate(day), f, now);
}

const pad = (n: number) => String(n % 24).padStart(2, '0');

/** "20:00–02:00". */
export function hourWindowLabel(w: HourWindow): string {
  return `${pad(w.from)}:00–${pad(w.to)}:00`;
}

/** "Nov 3", or "Nov 3, 2025" outside this year. */
function shortDay(day: string, now: Date): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: y === now.getFullYear() ? undefined : 'numeric',
  });
}

/** What a custom range reads as: "Nov 3 – Nov 9", "From Nov 3", "Nov 3". */
export function customRangeLabel(f: TimeFilter, now = new Date()): string {
  const { from, to } = dayBounds({ ...f, preset: 'custom' }, now);
  if (from && to) return from === to ? shortDay(from, now) : `${shortDay(from, now)} – ${shortDay(to, now)}`;
  if (from) return `From ${shortDay(from, now)}`;
  if (to) return `Up to ${shortDay(to, now)}`;
  return 'Any day';
}

/* ---------- Sorting ---------- */

export type SortOption<T> = {
  id: string;
  /** Says the order in plain words: "Newest first", "Name A to Z". */
  label: string;
  compare: (a: T, b: T) => number;
};

export function byText<T>(get: (row: T) => string | undefined): (a: T, b: T) => number {
  return (a, b) => (get(a) ?? '').localeCompare(get(b) ?? '', undefined, { sensitivity: 'base', numeric: true });
}

export function byNumber<T>(get: (row: T) => number | undefined): (a: T, b: T) => number {
  return (a, b) => (get(a) ?? -Infinity) - (get(b) ?? -Infinity);
}

export function descending<T>(compare: (a: T, b: T) => number): (a: T, b: T) => number {
  return (a, b) => compare(b, a);
}

/** Ties fall through to the next comparison. */
export function thenBy<T>(...compares: ((a: T, b: T) => number)[]): (a: T, b: T) => number {
  return (a, b) => {
    for (const c of compares) {
      const r = c(a, b);
      if (r !== 0) return r;
    }
    return 0;
  };
}

/** A sorted copy, by the option with `id` — or the first option when there's none. */
export function sortRows<T>(rows: readonly T[], options: SortOption<T>[], id: string): T[] {
  const option = options.find((o) => o.id === id) ?? options[0];
  return option ? [...rows].sort(option.compare) : [...rows];
}

/* ---------- Search ---------- */

/**
 * Every word typed has to turn up in one of the fields — "cola table 4"
 * finds Table 4's tab with a Coca-Cola on it.
 */
export function matchesSearch(query: string, ...fields: (string | number | undefined | null)[]): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = fields
    .filter((f) => f !== undefined && f !== null && f !== '')
    .map((f) => String(f).toLowerCase())
    .join('\n');
  return words.every((w) => hay.includes(w));
}

/** A plain day ("2026-11-03") or a full timestamp, whichever a record keeps. */
export function inTimeFilter(when: string | undefined, f: TimeFilter, now = new Date()): boolean {
  if (!when) return f.preset === 'all';
  return /^\d{4}-\d{2}-\d{2}$/.test(when) ? dayInFilter(when, f, now) : momentInFilter(when, f, now);
}
