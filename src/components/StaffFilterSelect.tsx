import { ROLES, hasRole, type RoleId, type StaffMember } from '../data/staff';
import type { StaffFilter } from '../lib/orderFilters';
import { FilterSelect } from './FilterSelect';

/** "All servers" — each role as a group. */
const EVERYONE_IN: Record<RoleId, string> = {
  owner: 'All owners',
  manager: 'All managers',
  frontdesk: 'All counter staff',
  barista: 'All baristas',
  server: 'All servers',
  cook: 'All cooks',
};

/** What a staff filter reads as in words — "All servers", "Dev Okafor". */
export function staffFilterLabel(value: StaffFilter, staff: StaffMember[]): string {
  if (value === 'all') return 'All staff';
  if (value.startsWith('role:')) return EVERYONE_IN[value.slice(5) as RoleId] ?? 'All staff';
  return staff.find((m) => m.id === value)?.name ?? 'Unknown staff member';
}

/**
 * Picks whose orders to show: everyone, a whole role ("All servers"), or one
 * person, listed under their main role. A role's "All" takes in everyone
 * who works it, main role or not. Removed staff are left out; people
 * who've been deactivated stay, since their past sales still count.
 */
export function StaffFilterSelect({
  value,
  onChange,
  staff,
}: {
  value: StaffFilter;
  onChange: (value: StaffFilter) => void;
  staff: StaffMember[];
}) {
  const current = staff.filter((m) => !m.deleted);
  const roles = ROLES.map((r) => ({
    ...r,
    anyone: current.some((m) => hasRole(m, r.id)),
    people: current
      .filter((m) => m.role === r.id)
      .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name)),
  })).filter((r) => r.anyone);

  return (
    <FilterSelect value={value} onChange={onChange} label="Staff">
      <option value="all">All staff</option>
      {roles.map((r) => (
        <optgroup key={r.id} label={r.label}>
          <option value={`role:${r.id}`}>{EVERYONE_IN[r.id]}</option>
          {r.people.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
              {m.active ? '' : ' (inactive)'}
            </option>
          ))}
        </optgroup>
      ))}
    </FilterSelect>
  );
}
