export type LocationKind = 'table' | 'room';

/** A place a tab can be assigned to — a table on the floor or a bookable room. */
export type Location = {
  id: string;
  /** Display name, used as the tab name — "Table 4", "Back Room". */
  name: string;
  kind: LocationKind;
  seats: number;
};

export const LOCATION_GROUPS: { kind: LocationKind; label: string; singular: string }[] = [
  { kind: 'table', label: 'Tables', singular: 'Table' },
  { kind: 'room', label: 'Rooms', singular: 'Room' },
];

/** The floor as it's set up on first load. Edited from Admin → Locations. */
export const LOCATIONS: Location[] = [
  { id: 't1', name: 'Table 1', kind: 'table', seats: 2 },
  { id: 't2', name: 'Table 2', kind: 'table', seats: 2 },
  { id: 't3', name: 'Table 3', kind: 'table', seats: 4 },
  { id: 't4', name: 'Table 4', kind: 'table', seats: 4 },
  { id: 't5', name: 'Table 5', kind: 'table', seats: 4 },
  { id: 't6', name: 'Table 6', kind: 'table', seats: 6 },
  { id: 't7', name: 'Table 7', kind: 'table', seats: 2 },
  { id: 't8', name: 'Table 8', kind: 'table', seats: 8 },
  { id: 'patio', name: 'Patio', kind: 'room', seats: 12 },
  { id: 'back-room', name: 'Back Room', kind: 'room', seats: 16 },
  { id: 'study', name: 'Study Room', kind: 'room', seats: 6 },
];

/** Name used for a tab that isn't assigned anywhere. */
export const WALK_IN = 'Walk-in';

export function locationName(locations: Location[], locationId: string | null): string {
  if (!locationId) return WALK_IN;
  return locations.find((l) => l.id === locationId)?.name ?? WALK_IN;
}

/**
 * A new location of `kind`, named after the next free number — "Table 9",
 * "Room 1" — so it's usable straight away and renamed later if wanted.
 */
export function makeLocation(locations: Location[], kind: LocationKind): Location {
  const { singular } = LOCATION_GROUPS.find((g) => g.kind === kind)!;
  const taken = new Set(locations.map((l) => l.name.toLowerCase()));
  let n = 1;
  while (taken.has(`${singular} ${n}`.toLowerCase())) n++;
  return {
    id: `${kind}-${Date.now().toString(36)}-${n}`,
    name: `${singular} ${n}`,
    kind,
    seats: kind === 'table' ? 4 : 10,
  };
}
