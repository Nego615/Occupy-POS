import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import './AccountMenu.css';
import { Button } from './Button';
import { Mono } from './Mono';
import { formatClock, initials, roleLabel } from '../data/staff';
import { usePos } from '../lib/store';

/**
 * The signed-in person's avatar, opening to their own clock in/out and the
 * way to hand the register to someone else. Switching user signs out but
 * leaves them on the clock — stepping away from the till isn't going home.
 */
export function AccountMenu({ align = 'right' }: { align?: 'right' | 'left-up' }) {
  const { me, shifts, clockIn, clockOut, signOut } = usePos();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  // Close on a click elsewhere or Escape, handing focus back to the trigger.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!me) return null;
  const shift = shifts.find((s) => s.staffId === me.id && s.clockOut === null);

  function switchUser() {
    setOpen(false);
    signOut();
    navigate('/sign-in');
  }

  return (
    <div className={`account account--${align}`} ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className="account__trigger"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`Signed in as ${me.name}. Account menu`}
        onClick={() => setOpen((v) => !v)}
      >
        {initials(me.name)}
        {shift && <span className="account__dot" aria-hidden="true" />}
      </button>

      {open && (
        <div className="account__menu" id={menuId}>
          <div className="account__who">
            <div className="account__name">{me.name}</div>
            <div className="account__role">
              {roleLabel(me.role)} ·{' '}
              {shift ? (
                <>
                  on the clock since <Mono>{formatClock(shift.clockIn)}</Mono>
                </>
              ) : (
                'off the clock'
              )}
            </div>
          </div>
          <div className="account__actions">
            {shift ? (
              <Button variant="secondary" size="sm" block onClick={() => clockOut(me.id)}>
                Clock out
              </Button>
            ) : (
              <Button variant="secondary" size="sm" block onClick={() => clockIn(me.id)}>
                Clock in
              </Button>
            )}
            <Button size="sm" block onClick={switchUser}>
              Switch user
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
