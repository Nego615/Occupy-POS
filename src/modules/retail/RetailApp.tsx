import { useEffect, type ReactNode } from 'react';
import { MotionConfig } from 'motion/react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import './theme.css';
import { NoAccess, RequirePermission, RequireSignIn } from '../../components/Guards';
import type { Permission } from '../../data/staff';
import { usePos } from '../../lib/store';
import { AdminBills } from '../../pages/AdminBills';
import { AdminCategories } from '../../pages/AdminCategories';
import { AdminExpenses } from '../../pages/AdminExpenses';
import { AdminOrders } from '../../pages/AdminOrders';
import { AdminOverview } from '../../pages/AdminOverview';
import { AdminPromotions } from '../../pages/AdminPromotions';
import { AdminPurchases } from '../../pages/AdminPurchases';
import { AdminReports } from '../../pages/AdminReports';
import { AdminSalaries } from '../../pages/AdminSalaries';
import { AdminSettings } from '../../pages/AdminSettings';
import { AdminStaff } from '../../pages/AdminStaff';
import { AdminStock } from '../../pages/AdminStock';
import { AdminStockCount } from '../../pages/AdminStockCount';
import { AdminSuppliers } from '../../pages/AdminSuppliers';
import { AdminTimecards } from '../../pages/AdminTimecards';
import { FrontDesk } from '../../pages/FrontDesk';
import { OrderHistory } from '../../pages/OrderHistory';
import { SignIn } from '../../pages/SignIn';
import { Tender } from '../../pages/Tender';
import { RETAIL_BRAND } from './brand';
import { useRetailHome } from './home';
import { RETAIL_NAV, RetailAdminLayout } from './layouts/RetailAdminLayout';
import { RetailCounterLayout } from './layouts/RetailCounterLayout';
import { ProductEditor } from './pages/ProductEditor';
import { RetailItemEditor } from './pages/RetailItemEditor';
import { RetailItems } from './pages/RetailItems';
import { RetailRegister } from './pages/RetailRegister';

/** Anywhere unknown lands on the signed-in person's own screen. */
function Home() {
  return <Navigate to={useRetailHome()} replace />;
}

/** The back office's front page: the overview, or else the first page the role can open. */
function AdminHome() {
  const { can } = usePos();
  if (can('reports')) return <AdminOverview />;
  const first = RETAIL_NAV.flatMap((g) => g.items).find((item) => can(item.permission));
  return first ? <Navigate to={first.to} replace /> : <NoAccess permission="reports" />;
}

function guard(permission: Permission, element: ReactNode) {
  return <RequirePermission permission={permission}>{element}</RequirePermission>;
}

/** Wears retail's colours and name while mounted, and gives them back after. */
function useRetailBrand() {
  useEffect(() => {
    const root = document.documentElement;
    const title = document.title;
    root.dataset.module = 'retail';
    document.title = RETAIL_BRAND.productName;
    return () => {
      delete root.dataset.module;
      document.title = title;
    };
  }, []);
}

/**
 * Occupy Retail: the whole app a retail shop runs. Its own till, catalog,
 * product editor, layouts, brand and colours live in this module. The back
 * office's general pages — sales, reports, stock, staff, settings — and
 * payment are shared with hospitality, as are sign-in and the data underneath.
 *
 * Paths match hospitality's where the shared pages link to them: the till is
 * `/counter/register`, payment `/counter/tender`.
 */
export function RetailApp() {
  useRetailBrand();
  return (
    // Every animation is skipped when the device asks for reduced motion.
    <MotionConfig reducedMotion="user">
      <BrowserRouter>
        <Routes>
          <Route path="/sign-in" element={<SignIn />} />

          <Route element={<RequireSignIn />}>
            <Route path="/counter">
              <Route element={guard('register', <RetailCounterLayout />)}>
                <Route index element={<Navigate to="/counter/register" replace />} />
                <Route path="register" element={<RetailRegister />} />
                <Route path="history" element={<OrderHistory />} />
              </Route>
              <Route path="tender" element={guard('payments', <Tender />)} />
            </Route>

            <Route path="/admin" element={<RetailAdminLayout />}>
              <Route index element={<AdminHome />} />
              <Route path="orders" element={guard('reports', <AdminOrders />)} />
              <Route path="reports" element={guard('reports', <AdminReports />)} />
              <Route path="items" element={guard('menu', <RetailItems />)} />
              <Route path="categories" element={guard('catalog', <AdminCategories />)} />
              <Route path="promotions" element={guard('promotions', <AdminPromotions />)} />
              <Route path="expenses" element={guard('expenses', <AdminExpenses />)} />
              <Route path="stock" element={guard('inventory', <AdminStock />)} />
              <Route path="count" element={guard('inventory', <AdminStockCount />)} />
              <Route path="purchases" element={guard('inventory', <AdminPurchases />)} />
              <Route path="suppliers" element={guard('inventory', <AdminSuppliers />)} />
              <Route path="bills" element={guard('inventory', <AdminBills />)} />
              <Route path="staff" element={guard('staff', <AdminStaff />)} />
              <Route path="timecards" element={guard('timecards', <AdminTimecards />)} />
              <Route path="salaries" element={guard('payroll', <AdminSalaries />)} />
              <Route path="settings" element={guard('settings', <AdminSettings />)} />
            </Route>

            {/* Sales sent over by cashiers who don't take payment, and the cash-up. */}
            <Route path="/desk" element={guard('payments', <FrontDesk />)} />

            {/* `/items/new` and `/products/new` open the editors in create mode. */}
            <Route path="/items/:itemId" element={guard('menu', <RetailItemEditor />)} />
            <Route path="/products/:productId" element={guard('menu', <ProductEditor />)} />
          </Route>

          <Route path="*" element={<Home />} />
        </Routes>
      </BrowserRouter>
    </MotionConfig>
  );
}
