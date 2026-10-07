import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { NavLink, Outlet, useLocation } from 'react-router';
import './AdminLayout.css';
import { AccountMenu } from '../components/AccountMenu';
import { BrandMark } from '../components/BrandMark';
import { Icon, type IconName } from '../components/Icon';
import { NoAccess } from '../components/Guards';
import { SubscriptionBanner } from '../components/SubscriptionBanner';
import { ADMIN_PERMISSIONS, homePath, roleLabel, type Permission } from '../data/staff';
import { snap, swapIn } from '../lib/motion';
import { usePos } from '../lib/store';

type NavEntry = { to: string; icon: IconName; label: string; permission: Permission };

/**
 * The admin nav. Every admin sub-page renders inside this shell via <Outlet>,
 * so there is exactly one nav implementation for the whole branch. Each entry
 * names the permission its page is guarded by; entries the signed-in role
 * can't open are left out rather than shown and refused.
 */
export const ADMIN_NAV: { section: string; items: NavEntry[] }[] = [
  {
    section: 'Business',
    items: [
      { to: '/admin', icon: 'overview', label: 'Overview', permission: 'reports' },
      { to: '/admin/orders', icon: 'receipt', label: 'Orders', permission: 'reports' },
      { to: '/admin/items', icon: 'tag', label: 'Items & catalog', permission: 'catalog' },
      { to: '/admin/categories', icon: 'layers', label: 'Categories', permission: 'catalog' },
      { to: '/admin/meals', icon: 'plate', label: 'Set meals', permission: 'catalog' },
      { to: '/admin/promotions', icon: 'percent', label: 'Promotions', permission: 'catalog' },
      { to: '/admin/reports', icon: 'chart', label: 'Reports', permission: 'reports' },
    ],
  },
  {
    section: 'Inventory',
    items: [
      { to: '/admin/stock', icon: 'box', label: 'Stock', permission: 'inventory' },
      { to: '/admin/count', icon: 'clipboard', label: 'Stock count', permission: 'inventory' },
      { to: '/admin/purchases', icon: 'truck', label: 'Purchases', permission: 'inventory' },
      { to: '/admin/suppliers', icon: 'store', label: 'Suppliers', permission: 'inventory' },
      { to: '/admin/bills', icon: 'document', label: 'Supplier bills', permission: 'inventory' },
    ],
  },
  {
    section: 'Team',
    items: [
      { to: '/admin/staff', icon: 'people', label: 'Staff', permission: 'staff' },
      { to: '/admin/salaries', icon: 'wallet', label: 'Salaries', permission: 'payroll' },
    ],
  },
  {
    section: 'Setup',
    items: [
      { to: '/admin/locations', icon: 'pin', label: 'Locations', permission: 'locations' },
      { to: '/admin/settings', icon: 'settings', label: 'Settings', permission: 'settings' },
    ],
  },
];

export function AdminLayout() {
  const { me, can, settings } = usePos();
  // Narrow screens fold the nav behind a Menu button; picking a page folds it away again.
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setMenuOpen(false), [pathname]);

  // No admin permission at all — no sidebar to show, just the explanation.
  if (!ADMIN_PERMISSIONS.some(can)) return <NoAccess />;

  return (
    <div className="admin">
      <nav className={menuOpen ? 'admin__sidebar admin__sidebar--open' : 'admin__sidebar'} aria-label="Admin">
        <div className="admin__top">
          <div className="admin__brand">
            <BrandMark logo={settings.logo} />
            <div>
              <div className="admin__brand-name">{settings.businessName}</div>
              <div className="admin__brand-sub">Admin</div>
            </div>
          </div>
          <button
            type="button"
            className="admin__menu-btn"
            aria-expanded={menuOpen}
            aria-controls="admin-menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? 'Close' : 'Menu'}
          </button>
        </div>

        <div className="admin__menu" id="admin-menu">

        {ADMIN_NAV.map((group) => {
          const items = group.items.filter((item) => can(item.permission));
          if (items.length === 0) return null;
          return (
            <div key={group.section}>
              <div className="nav-section">{group.section}</div>
              {items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  // `end` so /admin doesn't stay active on every sub-page.
                  end={item.to === '/admin'}
                  className={({ isActive }) =>
                    isActive ? 'nav-item nav-item--active' : 'nav-item'
                  }
                >
                  {({ isActive }) => (
                    <>
                      {/* One ink fill that slides to the page just opened. */}
                      {isActive && (
                        <motion.span
                          className="nav-item__fill"
                          layoutId="admin-nav-fill"
                          transition={snap}
                          aria-hidden="true"
                        />
                      )}
                      <Icon name={item.icon} className="nav-icon" />
                      <span className="nav-item__label">{item.label}</span>
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          );
        })}

        {/* The one link out of the admin branch, back to the counter flow (or the front desk). */}
        <NavLink to={me ? homePath(me) : '/counter/register'} className="nav-item admin__exit">
          <Icon name="back" className="nav-icon" />
          {me && homePath(me) === '/desk' ? 'Back to front desk' : 'Back to register'}
        </NavLink>

        {me && (
          <div className="admin__sidebar-footer">
            <AccountMenu align="left-up" />
            <div>
              <div className="admin__footer-name">{me.name}</div>
              <div className="admin__footer-role">{roleLabel(me.role)} · {settings.locationName}</div>
            </div>
          </div>
        )}
        </div>
      </nav>

      <main className="admin__main">
        <SubscriptionBanner />
        {/* Keyed by page, so opening another page fades it in. */}
        <motion.div key={pathname} variants={swapIn} initial="hidden" animate="shown">
          <Outlet />
        </motion.div>
      </main>
    </div>
  );
}
