import { HISTORY_DAYS, dateOfDaysAgo, daysAgoOfIsoDate, isoDate } from './history';

export type RoleId = 'owner' | 'manager' | 'barista' | 'server' | 'cook';

export type Permission =
  | 'register'
  | 'kitchen'
  | 'refunds'
  | 'catalog'
  | 'locations'
  | 'reports'
  | 'staff'
  | 'timecards'
  | 'payroll'
  | 'settings'
  | 'inventory'
  | 'payables'
  | 'discounts';

export const PERMISSIONS: { id: Permission; label: string }[] = [
  { id: 'register', label: 'Ring up & take payment' },
  { id: 'kitchen', label: 'Work the kitchen screen' },
  { id: 'refunds', label: 'Refund orders' },
  { id: 'catalog', label: 'Edit items & prices' },
  { id: 'locations', label: 'Edit tables & rooms' },
  { id: 'reports', label: 'View reports' },
  { id: 'timecards', label: 'Edit timecards' },
  { id: 'staff', label: 'Manage staff' },
  { id: 'payroll', label: 'See & run payroll' },
  { id: 'settings', label: 'Change business settings' },
  { id: 'inventory', label: 'Stock, deliveries & purchasing' },
  { id: 'payables', label: 'Pay suppliers' },
  { id: 'discounts', label: 'Give discounts' },
];

export const ROLES: { id: RoleId; label: string; can: Permission[] }[] = [
  {
    id: 'owner',
    label: 'Owner',
    can: [
      'register',
      'kitchen',
      'refunds',
      'catalog',
      'locations',
      'reports',
      'timecards',
      'staff',
      'payroll',
      'settings',
      'inventory',
      'payables',
      'discounts',
    ],
  },
  {
    id: 'manager',
    label: 'Manager',
    // Managers receive deliveries and run purchasing; paying suppliers stays with owners.
    can: [
      'register',
      'kitchen',
      'refunds',
      'catalog',
      'locations',
      'reports',
      'timecards',
      'inventory',
      'discounts',
    ],
  },
  { id: 'barista', label: 'Barista', can: ['register', 'kitchen'] },
  { id: 'server', label: 'Server', can: ['register', 'kitchen'] },
  { id: 'cook', label: 'Cook', can: ['kitchen'] },
];

export function roleLabel(role: RoleId): string {
  return ROLES.find((r) => r.id === role)!.label;
}

/** What a role grants. Deactivated staff get nothing, whatever their role. */
export function hasPermission(
  member: Pick<StaffMember, 'role' | 'active'> | null,
  permission: Permission,
): boolean {
  if (!member?.active) return false;
  return ROLES.find((r) => r.id === member.role)!.can.includes(permission);
}

/**
 * Roles that share the tip pool. Owners and managers are left out — in most
 * places they can't legally take from a pool their staff pays into.
 */
export const TIP_ELIGIBLE: RoleId[] = ['barista', 'server'];

/** Permissions that open some part of the admin — holding any one shows the Admin link. */
export const ADMIN_PERMISSIONS: Permission[] = [
  'reports',
  'catalog',
  'locations',
  'timecards',
  'staff',
  'payroll',
  'settings',
  'inventory',
];

/** Where someone lands after signing in with nowhere else to go — a cook goes straight to the kitchen. */
export function homePath(member: Pick<StaffMember, 'role' | 'active'>): string {
  if (hasPermission(member, 'register')) return '/counter/register';
  if (hasPermission(member, 'kitchen')) return '/kitchen';
  return '/admin';
}

export function permissionLabel(permission: Permission): string {
  return PERMISSIONS.find((p) => p.id === permission)!.label;
}

export type StaffMember = {
  id: string;
  name: string;
  role: RoleId;
  /**
   * Pay per hour, in the business currency. Set means paid hourly; absent
   * means salaried, paid `monthlySalary` each month.
   */
  hourlyRate?: number;
  /** Pay per month, for salaried staff. Ignored while `hourlyRate` is set. */
  monthlySalary?: number;
  /**
   * The four-digit sign-in PIN, hashed with the staff id — see hashPin. The
   * PIN itself is only ever shown once, when it's set.
   */
  pinHash: string;
  /** Deactivated staff keep their timecard history but can't sign in or clock in. */
  active: boolean;
};

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

/**
 * A PIN's stored form. Salting with the id keeps two people's hashes apart.
 * A four-digit PIN is guessable by anyone holding the hash, so this only keeps
 * PINs out of plain sight in saved data — real protection needs the check on
 * a server.
 */
export function hashPin(staffId: string, pin: string): string {
  // cyrb53: fast, well-mixed 53-bit hash. Not cryptographic.
  const text = `${staffId}:${pin}`;
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function pinMatches(member: Pick<StaffMember, 'id' | 'pinHash'>, pin: string): boolean {
  return member.pinHash === hashPin(member.id, pin);
}

/** A fresh PIN nobody on `staff` already signs in with. */
export function uniquePin(staff: Pick<StaffMember, 'id' | 'pinHash'>[]): string {
  let pin = randomPin();
  while (staff.some((m) => pinMatches(m, pin))) pin = randomPin();
  return pin;
}

export function randomPin(): string {
  return Math.floor(Math.random() * 10_000)
    .toString()
    .padStart(4, '0');
}

export const STAFF: StaffMember[] = [
  { id: 'jamie', name: 'Jamie Ruiz', role: 'owner', monthlySalary: 2_000_000, pinHash: hashPin('jamie', '1111'), active: true },
  { id: 'priya', name: 'Priya Nair', role: 'manager', hourlyRate: 6_000, pinHash: hashPin('priya', '4821'), active: true },
  { id: 'marcus', name: 'Marcus Bell', role: 'barista', hourlyRate: 4_500, pinHash: hashPin('marcus', '7730'), active: true },
  { id: 'sofia', name: 'Sofia Alvarez', role: 'barista', hourlyRate: 4_500, pinHash: hashPin('sofia', '2094'), active: true },
  { id: 'dev', name: 'Dev Okafor', role: 'server', hourlyRate: 4_000, pinHash: hashPin('dev', '5566'), active: true },
  { id: 'hannah', name: 'Hannah Cho', role: 'barista', hourlyRate: 4_500, pinHash: hashPin('hannah', '3187'), active: true },
  { id: 'amani', name: 'Amani Mwita', role: 'cook', hourlyRate: 4_500, pinHash: hashPin('amani', '6203'), active: true },
  { id: 'leo', name: 'Leo Brandt', role: 'server', hourlyRate: 4_000, pinHash: hashPin('leo', '9042'), active: false },
];

/* ---------- Timecards ---------- */

/** A shift as it's saved. */
export type ShiftRecord = {
  id: string;
  staffId: string;
  /** The day it started, "2026-09-29". */
  date: string;
  /** Minutes after midnight. */
  clockIn: number;
  /** Minutes after midnight; null while the person is still on the clock. */
  clockOut: number | null;
  /** Unpaid break, in minutes. */
  breakMinutes: number;
};

export type Shift = ShiftRecord & {
  /** 0 = today, matching how orders count days. Worked out from `date` when read. */
  daysAgo: number;
};

export function hydrateShift(record: ShiftRecord): Shift {
  return { ...record, daysAgo: daysAgoOfIsoDate(record.date) };
}

/** Paid minutes in a shift. An open shift counts up to `nowMinutes`. */
export function shiftMinutes(shift: Shift, nowMinutes: number): number {
  const end = shift.clockOut ?? nowMinutes;
  return Math.max(0, end - shift.clockIn - shift.breakMinutes);
}

export function minutesNow(d = new Date()): number {
  return d.getHours() * 60 + d.getMinutes();
}

/** 390 → "6:30 AM". */
export function formatClock(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

/** 390 → "06:30", for <input type="time">. */
export function toTimeInput(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  return `${h.toString().padStart(2, '0')}:${(minutes % 60).toString().padStart(2, '0')}`;
}

export function fromTimeInput(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** 452 → "7h 32m". */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h}h ${m.toString().padStart(2, '0')}m` : `${m}m`;
}

/* -------------------------------------------------------------------------
   Seed history — plausible shifts back to the start of last month, deterministic like the order
   backfill, so hours don't shift around between reloads.
   ------------------------------------------------------------------------- */

function makeRandom(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Open, mid, and close — start and end in minutes after midnight. */
const SHIFT_TEMPLATES = [
  { start: 6 * 60 + 30, end: 14 * 60 + 30 },
  { start: 9 * 60, end: 15 * 60 },
  { start: 11 * 60, end: 18 * 60 + 30 },
];

/** Who usually works which slot, and on how many days a week. */
const ROTA: { staffId: string; template: number; daysPerWeek: number }[] = [
  { staffId: 'priya', template: 0, daysPerWeek: 5 },
  { staffId: 'marcus', template: 2, daysPerWeek: 5 },
  { staffId: 'sofia', template: 0, daysPerWeek: 4 },
  { staffId: 'dev', template: 2, daysPerWeek: 4 },
  { staffId: 'hannah', template: 1, daysPerWeek: 3 },
  { staffId: 'jamie', template: 1, daysPerWeek: 2 },
];

function generateShifts(): ShiftRecord[] {
  const random = makeRandom(20260914);
  const shifts: ShiftRecord[] = [];
  let n = 0;

  // Past days: finished shifts with a few minutes' jitter either side.
  for (let daysAgo = HISTORY_DAYS; daysAgo >= 1; daysAgo--) {
    for (const slot of ROTA) {
      if (random() > slot.daysPerWeek / 7) continue;
      const t = SHIFT_TEMPLATES[slot.template];
      const jitter = () => Math.round((random() - 0.5) * 16);
      const length = t.end - t.start;
      shifts.push({
        id: `s${++n}`,
        staffId: slot.staffId,
        date: isoDate(dateOfDaysAgo(daysAgo)),
        clockIn: t.start + jitter(),
        clockOut: t.end + jitter(),
        breakMinutes: length > 6 * 60 ? 30 : 0,
      });
    }
  }

  // Today: an opener still on, a closer who came in later, and an opener who
  // already left — placed relative to the real clock so elapsed time is sane.
  const now = minutesNow();
  const today: [string, number, number | null][] = [
    ['priya', now - 6 * 60 - 12, null],
    ['marcus', now - 2 * 60 - 41, null],
    ['sofia', now - 8 * 60 - 55, now - 25],
  ];
  for (const [staffId, clockIn, clockOut] of today) {
    if (clockIn < 0) continue;
    shifts.push({
      id: `s${++n}`,
      staffId,
      date: isoDate(new Date()),
      clockIn,
      clockOut,
      breakMinutes: clockOut !== null && clockOut - clockIn > 6 * 60 ? 30 : 0,
    });
  }

  // Newest first, like orders.
  return shifts.reverse();
}

export const SHIFTS: ShiftRecord[] = generateShifts();
