import { describe, expect, it } from 'vitest';
import {
  byNumber,
  byText,
  customRangeLabel,
  dayBounds,
  dayInFilter,
  descending,
  hourWindowLabel,
  matchesSearch,
  momentInFilter,
  sortRows,
  timeFilter,
} from './listView';

// Wednesday 17 Nov 2026, mid-afternoon, local time.
const NOW = new Date(2026, 10, 17, 15, 0);
const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).toISOString();

describe('dayBounds', () => {
  it('counts 7 days including today', () => {
    expect(dayBounds(timeFilter('7d'), NOW)).toEqual({ from: '2026-11-11', to: '2026-11-17' });
  });

  it('takes last month whole', () => {
    expect(dayBounds(timeFilter('last-month'), NOW)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
  });

  it('swaps a custom range picked backwards', () => {
    expect(dayBounds({ preset: 'custom', from: '2026-11-09', to: '2026-11-03', hours: null }, NOW)).toEqual({
      from: '2026-11-03',
      to: '2026-11-09',
    });
  });
});

describe('momentInFilter', () => {
  it('keeps today and drops yesterday on Today', () => {
    expect(momentInFilter(at(17, 9), timeFilter('today'), NOW)).toBe(true);
    expect(momentInFilter(at(16, 23), timeFilter('today'), NOW)).toBe(false);
  });

  it('filters by hour of day', () => {
    const lunch = { preset: 'all' as const, hours: { from: 11, to: 15 } };
    expect(momentInFilter(at(10, 12, 30), lunch, NOW)).toBe(true);
    expect(momentInFilter(at(10, 15), lunch, NOW)).toBe(false);
  });

  it('counts the small hours toward the night before when the window runs past midnight', () => {
    const lastNight = { preset: 'yesterday' as const, hours: { from: 20, to: 2 } };
    expect(momentInFilter(at(16, 21), lastNight, NOW)).toBe(true);
    expect(momentInFilter(at(17, 1, 30), lastNight, NOW)).toBe(true);
    // The night before yesterday's small hours belong to the 15th.
    expect(momentInFilter(at(16, 1, 30), lastNight, NOW)).toBe(false);
    expect(momentInFilter(at(17, 3), lastNight, NOW)).toBe(false);
  });
});

describe('dayInFilter', () => {
  it('takes plain dates', () => {
    expect(dayInFilter('2026-11-01', timeFilter('this-month'), NOW)).toBe(true);
    expect(dayInFilter('2026-10-31', timeFilter('this-month'), NOW)).toBe(false);
  });
});

describe('labels', () => {
  it('reads hour windows on a 24-hour clock', () => {
    expect(hourWindowLabel({ from: 20, to: 2 })).toBe('20:00–02:00');
    expect(hourWindowLabel({ from: 6, to: 24 })).toBe('06:00–00:00');
  });

  it('reads custom ranges', () => {
    expect(customRangeLabel({ preset: 'custom', from: '2026-11-03', to: '2026-11-09', hours: null }, NOW)).toBe(
      'Nov 3 – Nov 9',
    );
    expect(customRangeLabel({ preset: 'custom', from: '2026-11-03', hours: null }, NOW)).toBe('From Nov 3');
  });
});

describe('sortRows', () => {
  const rows = [
    { id: 1042, name: 'Table 10' },
    { id: 1100, name: 'Table 2' },
    { id: 990, name: 'bar' },
  ];

  it('sorts names naturally and ignoring case', () => {
    const options = [{ id: 'name', label: 'Name A to Z', compare: byText<(typeof rows)[number]>((r) => r.name) }];
    expect(sortRows(rows, options, 'name').map((r) => r.name)).toEqual(['bar', 'Table 2', 'Table 10']);
  });

  it('sorts numbers high to low', () => {
    const options = [{ id: 'docket', label: '', compare: descending(byNumber<(typeof rows)[number]>((r) => r.id)) }];
    expect(sortRows(rows, options, 'docket').map((r) => r.id)).toEqual([1100, 1042, 990]);
  });

  it('leaves the input alone', () => {
    const options = [{ id: 'x', label: '', compare: byNumber<(typeof rows)[number]>((r) => r.id) }];
    sortRows(rows, options, 'x');
    expect(rows[0].id).toBe(1042);
  });
});

describe('matchesSearch', () => {
  it('needs every word somewhere', () => {
    expect(matchesSearch('cola table 4', 'Table 4', 'Coca-Cola')).toBe(true);
    expect(matchesSearch('cola table 5', 'Table 4', 'Coca-Cola')).toBe(false);
  });

  it('matches everything when empty', () => {
    expect(matchesSearch('   ', 'x')).toBe(true);
  });
});
