import { Outlet, useLocation, useNavigate } from 'react-router';
import './CounterLayout.css';
import { AccountMenu } from '../components/AccountMenu';
import { Pill } from '../components/Pill';
import { TopBar } from '../components/TopBar';
import { stationLabel } from '../data/settings';
import { ADMIN_PERMISSIONS } from '../data/staff';
import { usePos } from '../lib/store';

/**
 * Per-screen top-bar copy. The floor-facing screens (register, tables) show a
 * clock. The register's station line comes from Settings.
 */
const SCREENS = [
  { path: '/counter/register', label: 'Register', station: null, clock: true },
  { path: '/counter/tables', label: 'Tables', station: 'Tables & rooms', clock: true },
  { path: '/counter/history', label: 'Orders', station: 'Order history', clock: false },
];

/**
 * Shell for the counter flow — register and order history share one top bar,
 * so there is a single place that knows how the counter is titled and
 * navigated. Tender opts out: it's a focused payment screen with its own bar.
 */
export function CounterLayout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { can, settings } = usePos();
  const current = SCREENS.find((s) => s.path === pathname) ?? SCREENS[0];

  return (
    <div className="counter">
      <TopBar
        brand={settings.businessName}
        logo={settings.logo}
        station={current.station ?? stationLabel(settings)}
        account={<AccountMenu />}
        showClock={current.clock}
        nav={
          <nav className="counter__nav" aria-label="Counter">
            {SCREENS.map((screen) => (
              <Pill
                key={screen.path}
                active={screen.path === current.path}
                onClick={() => navigate(screen.path)}
              >
                {screen.label}
              </Pill>
            ))}
            {can('kitchen') && <Pill onClick={() => navigate('/kitchen')}>Kitchen</Pill>}
            {/* Only offered to roles that can open some part of the admin. */}
            {ADMIN_PERMISSIONS.some(can) && (
              <Pill onClick={() => navigate('/admin')}>Admin</Pill>
            )}
          </nav>
        }
      />
      <Outlet />
    </div>
  );
}
