import { useEffect, useRef, useState } from 'react';
import './AdminLocations.css';
import { Button } from '../components/Button';
import { Mono } from '../components/Mono';
import { StatusChip } from '../components/StatusChip';
import { Stepper } from '../components/Stepper';
import { LOCATION_GROUPS, type Location, type LocationKind } from '../data/locations';
import { usePos } from '../lib/store';

/**
 * The tables and rooms tabs can be assigned to. Edits apply straight to the
 * floor — the Tables screen and the register's picker read the same list.
 */
export function AdminLocations() {
  const { locations, tabs, addLocation, settings } = usePos();
  const [justAdded, setJustAdded] = useState<string | null>(null);

  function add(kind: LocationKind) {
    setJustAdded(addLocation(kind).id);
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Locations</h1>
          <div className="page-sub">{settings.locationName} · tables and rooms a tab can be assigned to</div>
        </div>
        <div className="head-actions">
          <Button variant="secondary" onClick={() => add('table')}>
            Add table
          </Button>
          <Button variant="secondary" onClick={() => add('room')}>
            Add room
          </Button>
        </div>
      </div>

      <div className="admin-locations">
        {LOCATION_GROUPS.map((group) => {
          const members = locations.filter((l) => l.kind === group.kind);
          const seats = members.reduce((sum, l) => sum + l.seats, 0);
          return (
            <section className="panel" key={group.kind} aria-labelledby={`group-${group.kind}`}>
              <div className="admin-locations__head">
                <h2 className="panel__title" id={`group-${group.kind}`}>
                  {group.label}
                </h2>
                <span className="admin-locations__count">
                  <Mono>{members.length}</Mono> · <Mono>{seats}</Mono> seats
                </span>
              </div>

              {members.length === 0 ? (
                <p className="admin-locations__empty">
                  No {group.label.toLowerCase()} yet — add one to assign tabs to it.
                </p>
              ) : (
                members.map((location) => (
                  <LocationRow
                    key={location.id}
                    location={location}
                    openOrderId={tabs.find((t) => t.locationId === location.id)?.orderId}
                    autoFocus={location.id === justAdded}
                  />
                ))
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}

function LocationRow({
  location,
  openOrderId,
  autoFocus,
}: {
  location: Location;
  /** Order number of the tab running here, if any. */
  openOrderId?: number;
  autoFocus: boolean;
}) {
  const { locations, updateLocation, removeLocation } = usePos();
  const [draft, setDraft] = useState(location.name);
  const [error, setError] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const occupied = openOrderId !== undefined;
  const errorId = `location-error-${location.id}`;

  // A freshly added location lands with its default name selected, ready to type over.
  useEffect(() => {
    if (autoFocus) inputRef.current?.select();
  }, [autoFocus]);

  function commitName() {
    const name = draft.trim().replace(/\s+/g, ' ');
    if (!name) {
      setError('Name can’t be empty — it’s what the tab is called.');
      setDraft(location.name);
      return;
    }
    const clash = locations.some(
      (l) => l.id !== location.id && l.name.toLowerCase() === name.toLowerCase(),
    );
    if (clash) {
      setError(`${name} already exists — pick a different name.`);
      setDraft(location.name);
      return;
    }
    setError(null);
    setDraft(name);
    if (name !== location.name) updateLocation(location.id, { name });
  }

  function remove() {
    if (!confirmingRemove) {
      setConfirmingRemove(true);
      return;
    }
    removeLocation(location.id);
  }

  return (
    <div className="location-row">
      <div className="location-row__main">
        <label className="sr-only" htmlFor={`location-name-${location.id}`}>
          Name
        </label>
        <input
          ref={inputRef}
          id={`location-name-${location.id}`}
          className="location-row__name"
          type="text"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') {
              setDraft(location.name);
              setError(null);
            }
          }}
          aria-invalid={error !== null}
          aria-describedby={error ? errorId : undefined}
        />
        {error && (
          <p className="location-row__error" id={errorId}>
            {error}
          </p>
        )}
      </div>

      <div className="location-row__seats">
        <span className="location-row__seats-label" aria-hidden="true">
          Seats
        </span>
        <Stepper
          value={location.seats}
          onChange={(seats) => updateLocation(location.id, { seats })}
          label={`seat at ${location.name}`}
          min={1}
          max={99}
        />
      </div>

      <span className="location-row__status">
        {occupied ? (
          <StatusChip status="occupied" size="sm">
            Tab <Mono>{`#${openOrderId}`}</Mono> open
          </StatusChip>
        ) : (
          <StatusChip status="open" size="sm">
            Free
          </StatusChip>
        )}
      </span>

      <Button
        variant="secondary"
        size="sm"
        className="location-row__remove"
        onClick={remove}
        onBlur={() => setConfirmingRemove(false)}
        disabled={occupied}
        title={occupied ? `Close tab #${openOrderId} before removing` : undefined}
      >
        {confirmingRemove ? 'Confirm remove' : 'Remove'}
      </Button>
    </div>
  );
}
