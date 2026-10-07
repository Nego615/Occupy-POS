export type RoleId = 'owner' | 'manager' | 'barista' | 'server' | 'cook';

export type Permission =
  | 'register'
  | 'kitchen'
  | 'refunds'
  | 'catalog'
  | 'locations'
  | 'reports'
  | 'staff'
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

/** Permissions that open some part of the admin — holding any one shows the Admin link. */
export const ADMIN_PERMISSIONS: Permission[] = [
  'reports',
  'catalog',
  'locations',
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
  /** Pay per month, in the business currency. */
  monthlySalary?: number;
  /**
   * The four-digit sign-in PIN, hashed with the staff id — see hashPin. The
   * PIN itself is only ever shown once, when it's set.
   */
  pinHash: string;
  /** Deactivated staff keep their history but can't sign in. */
  active: boolean;
  /** Removed from the team. Kept only so past orders can show the name. */
  deleted?: boolean;
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

/** Four digits, the shape every sign-in PIN takes. */
export function isPin(text: string): boolean {
  return /^\d{4}$/.test(text);
}

export function randomPin(): string {
  return Math.floor(Math.random() * 10_000)
    .toString()
    .padStart(4, '0');
}

export const STAFF: StaffMember[] = [
  { id: 'jamie', name: 'Jamie Ruiz', role: 'owner', monthlySalary: 2_000_000, pinHash: hashPin('jamie', '1111'), active: true },
  { id: 'priya', name: 'Priya Nair', role: 'manager', monthlySalary: 1_040_000, pinHash: hashPin('priya', '4821'), active: true },
  { id: 'marcus', name: 'Marcus Bell', role: 'barista', monthlySalary: 780_000, pinHash: hashPin('marcus', '7730'), active: true },
  { id: 'sofia', name: 'Sofia Alvarez', role: 'barista', monthlySalary: 780_000, pinHash: hashPin('sofia', '2094'), active: true },
  { id: 'dev', name: 'Dev Okafor', role: 'server', monthlySalary: 690_000, pinHash: hashPin('dev', '5566'), active: true },
  { id: 'hannah', name: 'Hannah Cho', role: 'barista', monthlySalary: 780_000, pinHash: hashPin('hannah', '3187'), active: true },
  { id: 'amani', name: 'Amani Mwita', role: 'cook', monthlySalary: 780_000, pinHash: hashPin('amani', '6203'), active: true },
  { id: 'leo', name: 'Leo Brandt', role: 'server', monthlySalary: 690_000, pinHash: hashPin('leo', '9042'), active: false },
];
