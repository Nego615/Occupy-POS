import { describe, expect, it } from 'vitest';
import type { StaffMember } from '../data/staff';
import { computePayroll, salaried } from './payroll';

const member = (extra: Partial<StaffMember> & Record<string, unknown>): StaffMember => ({
  id: 'a',
  name: 'A',
  role: 'barista',
  pinHash: '',
  active: true,
  ...extra,
});

describe('salaried', () => {
  it('moves hourly staff onto a monthly salary at full time', () => {
    const [m] = salaried([member({ hourlyRate: 4_500, monthlySalary: 1 })]);
    expect(m.monthlySalary).toBe(780_000);
    expect('hourlyRate' in m).toBe(false);
  });

  it('hands back the same list when nobody was hourly', () => {
    const staff = [member({ monthlySalary: 500_000 })];
    expect(salaried(staff)).toBe(staff);
  });
});

describe('computePayroll', () => {
  const staff = [
    member({ id: 'a', monthlySalary: 1_000_001 }),
    member({ id: 'b', monthlySalary: 600_000, active: false }),
    member({ id: 'c' }),
  ];

  it('pays active staff with a salary set', () => {
    const payroll = computePayroll(staff, { part: 'whole' });
    expect(payroll.lines.map((l) => l.member.id)).toEqual(['a']);
    expect(payroll.totals.gross).toBe(1_000_001);
  });

  it('splits a month into halves that add up', () => {
    const first = computePayroll(staff, { part: 'first' }).totals.gross;
    const second = computePayroll(staff, { part: 'second' }).totals.gross;
    expect(first + second).toBe(1_000_001);
  });
});
