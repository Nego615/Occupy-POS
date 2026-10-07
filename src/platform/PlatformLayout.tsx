import { useEffect, useRef } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { usePlatform } from './PlatformData';
import { UnsavedChangesProvider, useConfirmDiscard } from './Unsaved';

const NAV = [
  { to: '/platform', label: 'Overview' },
  { to: '/platform/shops', label: 'Shops' },
  { to: '/platform/plans', label: 'Plans' },
  { to: '/platform/payments', label: 'Payments' },
];

/**
 * The platform's shell: one bar across the top with its four sections. Kept
 * deliberately unlike a shop's admin sidebar, so the two are never confused.
 */
export function PlatformLayout() {
  return (
    <UnsavedChangesProvider>
      <Shell />
    </UnsavedChangesProvider>
  );
}

function Shell() {
  const { client, email } = usePlatform();
  const confirmDiscard = useConfirmDiscard();
  const { pathname } = useLocation();
  const main = useRef<HTMLElement>(null);
  // A new page starts at its top. Braces matter: Chrome's scrollTo returns a
  // promise, and an effect must return nothing or a cleanup function.
  useEffect(() => {
    main.current?.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="pf-shell">
      <header className="pf-bar">
        <div className="pf-bar__brand">
          <span className="pf-bar__mark" aria-hidden="true" />
          <span>
            Occupy <span className="pf-bar__product">platform</span>
          </span>
        </div>
        <nav className="pf-bar__nav" aria-label="Platform">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/platform'}
              className={({ isActive }) => (isActive ? 'pf-tab pf-tab--active' : 'pf-tab')}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="pf-bar__account">
          <span className="pf-bar__email" title={email}>
            {email}
          </span>
          {/* Local scope: clears this browser's sign-in without a server call,
              so it works even offline or with an expired session. */}
          <button
            type="button"
            className="pf-bar__signout"
            onClick={async () => {
              if (await confirmDiscard()) void client.auth.signOut({ scope: 'local' });
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="pf-main" ref={main}>
        <Outlet />
      </main>
    </div>
  );
}
