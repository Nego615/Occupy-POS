import { ROLES, type RoleId, type StaffMember } from '../data/staff';
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

/**
 * Picks whose orders to show: everyone, a whole role ("All servers"), or one
 * person, grouped under their role. Removed staff are left out; people
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
  const roles = ROLES.map((r) => ({
    ...r,
    people: staff
      .filter((m) => m.role === r.id && !m.deleted)
      .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name)),
  })).filter((r) => r.people.length > 0);

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
