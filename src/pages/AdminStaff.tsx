import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import './AdminStaff.css';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { FilterSelect } from '../components/FilterSelect';
import { Mono } from '../components/Mono';
import { Pill, PillRow } from '../components/Pill';
import { Switch } from '../components/Switch';
import { PERMISSIONS, ROLES, uniquePin, type RoleId, type StaffMember } from '../data/staff';
import { payLabel } from '../lib/payroll';
import { usePos } from '../lib/store';

type Filter = 'active' | 'inactive';

/**
 * The team — who can sign in, in what role, at what rate. Edits apply in
 * place, like Locations. Deactivating keeps someone on the list; deleting
 * takes them off it, though past orders still show their name.
 */
export function AdminStaff() {
  const { staff, addStaff, settings } = usePos();
  const [filter, setFilter] = useState<Filter>('active');
  // The new person's PIN is shown once, on their row — only its hash is kept.
  const [justAdded, setJustAdded] = useState<{ id: string; pin: string } | null>(null);

  const activeCount = staff.filter((m) => m.active).length;
  const members = staff.filter((m) => (filter === 'active' ? m.active : !m.active));

  function add() {
    // Pay starts unset ("Not set") — it's entered on Salaries, in the business currency.
    const { member, pin } = addStaff({ name: 'New staff member', role: 'barista', active: true });
    setFilter('active');
    setJustAdded({ id: member.id, pin });
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Staff</h1>
          <div className="page-sub">
            {settings.locationName} · <Mono>{activeCount}</Mono> active
          </div>
        </div>
        <div className="head-actions">
          <Button onClick={add}>Add staff member</Button>
        </div>
      </div>

      <PillRow label="Show" className="staff__filters">
        <Pill active={filter === 'active'} onClick={() => setFilter('active')}>
          Active <Mono>{activeCount}</Mono>
        </Pill>
        <Pill active={filter === 'inactive'} onClick={() => setFilter('inactive')}>
          Deactivated <Mono>{staff.length - activeCount}</Mono>
        </Pill>
      </PillRow>

      <section className="panel staff__list" aria-label="Staff members">
        <div className="staff-row staff-row--head" aria-hidden="true">
          <span className="staff-row__who">Name</span>
          <span className="staff-row__role">Role</span>
          <span className="staff-row__rate">Pay</span>
          <span className="staff-row__pin">Register PIN</span>
          <span className="staff-row__active">Active</span>
          <span className="staff-row__delete" />
        </div>
        {members.length === 0 ? (
          <p className="staff__empty">
            {filter === 'active'
              ? 'No active staff — add someone to get started.'
              : 'Nobody has been deactivated.'}
          </p>
        ) : (
          members.map((member) => (
            <StaffRow
              key={member.id}
              member={member}
              autoFocus={member.id === justAdded?.id}
              newPin={member.id === justAdded?.id ? justAdded.pin : undefined}
            />
          ))
        )}
      </section>

      <RoleTable />
    </>
  );
}

function StaffRow({
  member,
  autoFocus,
  newPin,
}: {
  member: StaffMember;
  /** A PIN just set for them, shown until the row loses focus. */
  newPin?: string;
  autoFocus: boolean;
}) {
  const { staff, me, updateStaff, setPin, deleteStaff, can } = usePos();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [name, setName] = useState(member.name);
  const [error, setError] = useState<string | null>(null);
  // PINs are stored hashed, so one can only be shown at the moment it's set.
  const [revealPin, setRevealPin] = useState<string | null>(newPin ?? null);
  // Null while not editing the PIN; otherwise what's typed so far.
  const [pinDraft, setPinDraft] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinSaved, setPinSaved] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const pinRef = useRef<HTMLInputElement>(null);
  const errorId = `staff-error-${member.id}`;
  const pinErrorId = `staff-pin-error-${member.id}`;

  // A newly added person lands with the placeholder name selected, ready to type over.
  useEffect(() => {
    if (autoFocus) nameRef.current?.select();
  }, [autoFocus]);

  // The last active owner can't be demoted or deactivated — someone has to hold the keys.
  const lastOwner =
    member.role === 'owner' &&
    member.active &&
    staff.filter((m) => m.role === 'owner' && m.active).length === 1;

  function commitName() {
    const next = name.trim().replace(/\s+/g, ' ');
    if (!next) {
      setError('Name can’t be empty.');
      setName(member.name);
      return;
    }
    setError(null);
    setName(next);
    if (next !== member.name) updateStaff(member.id, { name: next });
  }

  function startPinEdit() {
    setRevealPin(null);
    setPinError(null);
    setPinDraft('');
  }

  function cancelPinEdit() {
    setPinDraft(null);
    setPinError(null);
  }

  /** Fills the field with an unused PIN, for the admin to read out before saving. */
  function generatePin() {
    setPinDraft(uniquePin(staff.filter((m) => m.id !== member.id)));
    setPinError(null);
    pinRef.current?.focus();
  }

  function savePin() {
    if (pinDraft === null) return;
    const problem = setPin(member.id, pinDraft);
    if (problem) {
      setPinError(problem);
      pinRef.current?.focus();
      return;
    }
    // Shown once, beside the button, until focus moves on.
    setRevealPin(pinDraft);
    setPinSaved(true);
    setPinDraft(null);
    setPinError(null);
  }

  // The field opens focused.
  useEffect(() => {
    if (pinDraft === '') pinRef.current?.focus();
  }, [pinDraft]);

  return (
    <div className={member.active ? 'staff-row' : 'staff-row staff-row--inactive'}>
      <div className="staff-row__who">
        <Avatar name={member.name} muted={!member.active} />
        <div className="staff-row__name-wrap">
          <label className="sr-only" htmlFor={`staff-name-${member.id}`}>
            Name
          </label>
          <input
            ref={nameRef}
            id={`staff-name-${member.id}`}
            className="staff-input staff-input--name"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') setName(member.name);
            }}
            aria-invalid={error !== null}
            aria-describedby={error ? errorId : undefined}
          />
          {!member.active && <span className="staff-row__status">Deactivated · can’t sign in</span>}
          {error && (
            <p className="staff-row__error" id={errorId}>
              {error}
            </p>
          )}
        </div>
      </div>

      <span className="staff-row__role">
        <FilterSelect
          value={member.role}
          onChange={(role) => updateStaff(member.id, { role: role as RoleId })}
          label={`Role for ${member.name}`}
        >
          {ROLES.map((r) => (
            <option key={r.id} value={r.id} disabled={lastOwner && r.id !== 'owner'}>
              {r.label}
            </option>
          ))}
        </FilterSelect>
      </span>

      {/* Pay is set on Salaries, behind the payroll permission — shown here read-only. */}
      <span className="staff-row__rate">
        {can('payroll') ? (
          <Link
            to="/admin/salaries"
            className="staff-pay"
            aria-label={`${member.name}'s pay, ${payLabel(member)} — edit in Salaries`}
          >
            <Mono>{payLabel(member)}</Mono>
          </Link>
        ) : (
          <span className="staff-pay staff-pay--hidden">Hidden</span>
        )}
      </span>

      {pinDraft === null ? (
        <span className="staff-row__pin">
          <span className="staff-pin mono" aria-live="polite">
            {revealPin ? (
              revealPin
            ) : (
              <>
                <span aria-hidden="true">••••</span>
                <span className="sr-only">Hidden</span>
              </>
            )}
          </span>
          <Button
            // Back from saving: focus here, so the revealed PIN hides as soon as the admin moves on.
            autoFocus={pinSaved}
            variant="secondary"
            size="sm"
            onClick={startPinEdit}
            onBlur={() => {
              setRevealPin(null);
              setPinSaved(false);
            }}
            disabled={!member.active}
            aria-label={revealPin ? `PIN set for ${member.name}. Change PIN` : `Change PIN for ${member.name}`}
          >
            {revealPin ? 'PIN set' : 'Change PIN'}
          </Button>
        </span>
      ) : (
        <span className="staff-row__pin staff-row__pin--editing">
          <label className="sr-only" htmlFor={`staff-pin-${member.id}`}>
            New PIN for {member.name}
          </label>
          <input
            ref={pinRef}
            id={`staff-pin-${member.id}`}
            className="staff-input staff-input--pin mono"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            placeholder="0000"
            value={pinDraft}
            onChange={(e) => {
              setPinDraft(e.target.value.replace(/\D/g, '').slice(0, 4));
              setPinError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') savePin();
              if (e.key === 'Escape') cancelPinEdit();
            }}
            aria-invalid={pinError !== null}
            aria-describedby={pinError ? pinErrorId : undefined}
          />
          <Button size="sm" onClick={savePin}>
            Save
          </Button>
          <Button variant="secondary" size="sm" onClick={cancelPinEdit}>
            Cancel
          </Button>
          <button type="button" className="staff-pin-generate" onClick={generatePin}>
            Generate one
          </button>
          {pinError && (
            <p className="staff-row__error staff-row__pin-error" id={pinErrorId} role="alert">
              {pinError}
            </p>
          )}
        </span>
      )}

      <span className="staff-row__active">
        <Switch
          checked={member.active}
          onChange={(active) => updateStaff(member.id, { active })}
          label={`${member.name} active`}
          disabled={lastOwner}
        />
      </span>

      <span className="staff-row__delete">
        <Button
          variant="secondary"
          size="sm"
          className={confirmingDelete ? 'staff-delete staff-delete--confirm' : 'staff-delete'}
          onClick={() => (confirmingDelete ? deleteStaff(member.id) : setConfirmingDelete(true))}
          onBlur={() => setConfirmingDelete(false)}
          disabled={lastOwner || member.id === me?.id}
          title={
            lastOwner
              ? 'The only owner can’t be deleted.'
              : member.id === me?.id
                ? 'You can’t delete yourself while signed in.'
                : undefined
          }
          aria-label={confirmingDelete ? `Confirm deleting ${member.name}` : `Delete ${member.name}`}
        >
          {confirmingDelete ? 'Confirm' : 'Delete'}
        </Button>
      </span>
    </div>
  );
}

/** What each role can do, read off the role definitions. */
function RoleTable() {
  const { staff } = usePos();
  return (
    <section className="panel staff__roles" aria-labelledby="roles-title">
      <div className="staff__roles-head">
        <h2 className="panel__title" id="roles-title">
          What each role can do
        </h2>
        <span className="staff__roles-note">Roles are fixed for now</span>
      </div>
      {/* Scrolls sideways on a phone rather than widening the page. */}
      <div className="role-table__wrap">
        <table className="role-table">
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">Permission</span>
              </th>
              {ROLES.map((r) => (
                <th scope="col" key={r.id}>
                  {r.label}
                  <span className="role-table__count">
                    <Mono>{staff.filter((m) => m.active && m.role === r.id).length}</Mono> active
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERMISSIONS.map((p) => (
              <tr key={p.id}>
                <th scope="row">{p.label}</th>
                {ROLES.map((r) => (
                  <td key={r.id}>
                    {r.can.includes(p.id) ? (
                      <>
                        <span aria-hidden="true" className="role-table__yes">
                          ✓
                        </span>
                        <span className="sr-only">Yes</span>
                      </>
                    ) : (
                      <>
                        <span aria-hidden="true" className="role-table__no">
                          —
                        </span>
                        <span className="sr-only">No</span>
                      </>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
