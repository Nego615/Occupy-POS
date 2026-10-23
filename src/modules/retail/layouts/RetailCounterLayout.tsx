import { motion } from 'motion/react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import '../../../layouts/CounterLayout.css';
import { AccountMenu } from '../../../components/AccountMenu';
import { Pill, PillGroup } from '../../../components/Pill';
import { SubscriptionBanner } from '../../../components/SubscriptionBanner';
import { TopBar } from '../../../components/TopBar';
import { ADMIN_PERMISSIONS } from '../../../data/staff';
import { swapIn } from '../../../lib/motion';
import { usePos } from '../../../lib/store';
import { RETAIL_BRAND } from '../brand';

/** The till's screens. The till shows a clock; the sales list doesn't. */
const SCREENS = [
  { path: '/counter/register', label: 'Till', station: null, clock: true },
  { path: '/counter/history', label: 'Sales', station: 'Sales history', clock: false },
];

/**
 * Retail's counter shell: the till and its sales history under one top bar,
 * carrying the retail brand. Tender opts out with its own focused bar.
 */
export function RetailCounterLayout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { can, settings } = usePos();
  const current = SCREENS.find((s) => s.path === pathname) ?? SCREENS[0];

  return (
    <div className="counter">
      <TopBar
        brand={settings.businessName}
        logo={settings.logo ?? RETAIL_BRAND.logo}
        station={current.station ?? `${RETAIL_BRAND.productName} · ${settings.locationName}`}
        account={<AccountMenu />}
        showClock={current.clock}
        nav={
          <nav className="counter__nav" aria-label="Counter">
            <PillGroup>
              {SCREENS.map((screen) => (
                <Pill key={screen.path} active={screen.path === current.path} onClick={() => navigate(screen.path)}>
                  {screen.label}
                </Pill>
              ))}
              {can('payments') && <Pill onClick={() => navigate('/desk')}>Counter</Pill>}
              {ADMIN_PERMISSIONS.some(can) && <Pill onClick={() => navigate('/admin')}>Admin</Pill>}
            </PillGroup>
          </nav>
        }
      />
      <SubscriptionBanner />
      {/* Keyed by screen, so switching screens fades the new one in. */}
      <motion.div key={current.path} className="counter__page" variants={swapIn} initial="hidden" animate="shown">
        <Outlet />
      </motion.div>
    </div>
  );
}
