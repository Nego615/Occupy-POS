import { useEffect, type ReactNode } from 'react';
import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import './Guards.css';
import { Button } from './Button';
import { homePath, permissionLabel, roleLabel, type Permission } from '../data/staff';
import { usePos } from '../lib/store';

/**
 * Layout route in front of everything but the sign-in screen. Nobody signed
 * in → off to /sign-in, remembering where they were headed.
 */
export function RequireSignIn() {
  const { me, signOut, settings } = usePos();
  const location = useLocation();
  const navigate = useNavigate();
  const lockAfter = settings.autoLockMinutes;
  const here = `${location.pathname}${location.search}`;

  // Auto-lock: no tap, click, key, or scroll for `lockAfter` minutes signs
  // out, and sign-in returns to this screen. Open tabs are untouched.
  useEffect(() => {
    if (!me || lockAfter === null) return;
    let timer = 0;
    const lock = () => {
      signOut();
      navigate('/sign-in', { replace: true, state: { from: here } });
    };
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(lock, lockAfter * 60_000);
    };
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      window.clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [me, lockAfter, signOut, navigate, here]);

  if (!me) {
    return (
      <Navigate
        to="/sign-in"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }
  return <Outlet />;
}

/**
 * Renders `children` only if the signed-in role grants `permission`;
 * otherwise explains what's missing and offers a switch of user.
 */
export function RequirePermission({
  permission,
  children,
}: {
  permission: Permission;
  children: ReactNode;
}) {
  const { can } = usePos();
  return can(permission) ? <>{children}</> : <NoAccess permission={permission} />;
}

/** `permission` absent means the whole admin — the role holds no admin permission at all. */
export function NoAccess({ permission }: { permission?: Permission }) {
  const { me, signOut } = usePos();
  const navigate = useNavigate();
  const location = useLocation();

  function switchUser() {
    signOut();
    // Come back here once someone with access has signed in.
    navigate('/sign-in', { state: { from: `${location.pathname}${location.search}` } });
  }

  return (
    <div className="no-access">
      <div className="no-access__card" role="alert">
        <h1 className="no-access__title">You don’t have access to this</h1>
        <p className="no-access__body">
          It needs{' '}
          <strong>{permission ? permissionLabel(permission).toLowerCase() : 'admin access'}</strong>,
          which{' '}
          {me ? (
            <>
              {me.name}’s role ({roleLabel(me.role)}) doesn’t include
            </>
          ) : (
            'your role doesn’t include'
          )}
          . Ask a manager or owner to sign in, or to change your role.
        </p>
        <div className="no-access__actions">
          <Button onClick={switchUser}>Switch user</Button>
          <Link to={me ? homePath(me) : '/sign-in'} className="no-access__back">
            Back to your screen
          </Link>
        </div>
      </div>
    </div>
  );
}
