import { NavLink, Outlet } from 'react-router';
import './AdminLayout.css';
import { AccountMenu } from '../components/AccountMenu';
import { BrandMark } from '../components/BrandMark';
import { NoAccess } from '../components/Guards';
import { ADMIN_PERMISSIONS, roleLabel, type Permission } from '../data/staff';
import { usePos } from '../lib/store';

type NavEntry = { to: string; icon: string; label: string; permission: Permission };

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
      { to: '/admin', icon: '◧', label: 'Overview', permission: 'reports' },
      { to: '/admin/orders', icon: '▤', label: 'Orders', permission: 'reports' },
      { to: '/admin/items', icon: '◫', label: 'Items & catalog', permission: 'catalog' },
      { to: '/admin/categories', icon: '▥', label: 'Categories', permission: 'catalog' },
      { to: '/admin/meals', icon: '◰', label: 'Set meals', permission: 'catalog' },
      { to: '/admin/promotions', icon: '%', label: 'Promotions', permission: 'catalog' },
      { to: '/admin/reports', icon: '◔', label: 'Reports', permission: 'reports' },
    ],
  },
  {
    section: 'Inventory',
    items: [
      { to: '/admin/stock', icon: '▦', label: 'Stock', permission: 'inventory' },
      { to: '/admin/count', icon: '✓', label: 'Stock count', permission: 'inventory' },
      { to: '/admin/purchases', icon: '⇲', label: 'Purchases', permission: 'inventory' },
      { to: '/admin/suppliers', icon: '⌂', label: 'Suppliers', permission: 'inventory' },
      { to: '/admin/bills', icon: '≡', label: 'Supplier bills', permission: 'inventory' },
    ],
  },
  {
    section: 'Team',
    items: [
      { to: '/admin/staff', icon: '◐', label: 'Staff', permission: 'staff' },
      { to: '/admin/salaries', icon: '¤', label: 'Salaries', permission: 'payroll' },
    ],
  },
  {
    section: 'Setup',
    items: [
      { to: '/admin/locations', icon: '▭', label: 'Locations', permission: 'locations' },
      { to: '/admin/settings', icon: '⚙', label: 'Settings', permission: 'settings' },
    ],
  },
];

export function AdminLayout() {
  const { me, can, settings } = usePos();

  // No admin permission at all — no sidebar to show, just the explanation.
  if (!ADMIN_PERMISSIONS.some(can)) return <NoAccess />;

  return (
    <div className="admin">
      <nav className="admin__sidebar" aria-label="Admin">
        <div className="admin__brand">
          <BrandMark logo={settings.logo} />
          <div>
            <div className="admin__brand-name">{settings.businessName}</div>
            <div className="admin__brand-sub">Admin</div>
          </div>
        </div>

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
                  <span className="nav-icon" aria-hidden="true">
                    {item.icon}
                  </span>
                  {item.label}
                </NavLink>
              ))}
            </div>
          );
        })}

        {/* The one link out of the admin branch, back to the counter flow. */}
        <NavLink to="/counter/register" className="nav-item admin__exit">
          <span className="nav-icon" aria-hidden="true">
            ←
          </span>
          Back to register
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
      </nav>

      <main className="admin__main">
        <Outlet />
      </main>
    </div>
  );
}
