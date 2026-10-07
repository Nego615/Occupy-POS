import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import './AccountMenu.css';
import { Button } from './Button';
import { initials, roleLabel } from '../data/staff';
import { usePos } from '../lib/store';

/** The signed-in person's avatar, opening to the way to hand the register to someone else. */
export function AccountMenu({ align = 'right' }: { align?: 'right' | 'left-up' }) {
  const { me, signOut } = usePos();
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
      </button>

      {open && (
        <div className="account__menu" id={menuId}>
          <div className="account__who">
            <div className="account__name">{me.name}</div>
            <div className="account__role">{roleLabel(me.role)}</div>
          </div>
          <div className="account__actions">
            <Button size="sm" block onClick={switchUser}>
              Switch user
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
