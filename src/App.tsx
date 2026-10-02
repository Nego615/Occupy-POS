import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { RequirePermission, RequireSignIn } from './components/Guards';
import type { Permission } from './data/staff';
import { AdminLayout } from './layouts/AdminLayout';
import { CounterLayout } from './layouts/CounterLayout';
import { AdminBills } from './pages/AdminBills';
import { AdminItems } from './pages/AdminItems';
import { AdminMeals } from './pages/AdminMeals';
import { AdminPromotions } from './pages/AdminPromotions';
import { AdminOrders } from './pages/AdminOrders';
import { AdminPurchases } from './pages/AdminPurchases';
import { AdminReports } from './pages/AdminReports';
import { AdminSalaries } from './pages/AdminSalaries';
import { AdminSettings } from './pages/AdminSettings';
import { AdminStaff } from './pages/AdminStaff';
import { AdminStock } from './pages/AdminStock';
import { AdminStockCount } from './pages/AdminStockCount';
import { AdminSuppliers } from './pages/AdminSuppliers';
import { AdminTimecards } from './pages/AdminTimecards';
import { AdminLocations } from './pages/AdminLocations';
import { AdminOverview } from './pages/AdminOverview';
import { ItemEditor } from './pages/ItemEditor';
import { Kitchen } from './pages/Kitchen';
import { OrderHistory } from './pages/OrderHistory';
import { Register } from './pages/Register';
import { SignIn } from './pages/SignIn';
import { Tables } from './pages/Tables';
import { Tender } from './pages/Tender';

/** Shorthand: `element` only for roles holding `permission`. */
function guard(permission: Permission, element: ReactNode) {
  return <RequirePermission permission={permission}>{element}</RequirePermission>;
}

/**
 * `/sign-in` is the only open route. Everything else sits behind
 * RequireSignIn, and each page behind the permission it needs — the same
 * permission AdminLayout's nav uses to decide whether to show its link.
 *
 * `/counter` is the flow a cashier works in: register and order history share
 * CounterLayout's top bar, and tender sits alongside them without it — it's a
 * focused payment screen with its own bar.
 *
 * `/admin` is the back office. Every page under it renders inside
 * AdminLayout's sidebar, so admin sub-pages never build their own nav shell.
 *
 * The item editor is deliberately outside both: it's a full-screen editor with
 * its own bar, reachable from either branch.
 */
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/sign-in" element={<SignIn />} />

        <Route element={<RequireSignIn />}>
          <Route path="/counter">
            <Route element={guard('register', <CounterLayout />)}>
              <Route index element={<Navigate to="/counter/register" replace />} />
              <Route path="register" element={<Register />} />
              <Route path="tables" element={<Tables />} />
              <Route path="history" element={<OrderHistory />} />
            </Route>
            <Route path="tender" element={guard('register', <Tender />)} />
          </Route>

          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={guard('reports', <AdminOverview />)} />
            <Route path="orders" element={guard('reports', <AdminOrders />)} />
            <Route path="reports" element={guard('reports', <AdminReports />)} />
            <Route path="staff" element={guard('staff', <AdminStaff />)} />
            <Route path="timecards" element={guard('timecards', <AdminTimecards />)} />
            <Route path="salaries" element={guard('payroll', <AdminSalaries />)} />
            <Route path="items" element={guard('catalog', <AdminItems />)} />
            <Route path="meals" element={guard('catalog', <AdminMeals />)} />
            <Route path="promotions" element={guard('catalog', <AdminPromotions />)} />
            <Route path="stock" element={guard('inventory', <AdminStock />)} />
            <Route path="count" element={guard('inventory', <AdminStockCount />)} />
            <Route path="purchases" element={guard('inventory', <AdminPurchases />)} />
            <Route path="suppliers" element={guard('inventory', <AdminSuppliers />)} />
            <Route path="bills" element={guard('inventory', <AdminBills />)} />
            <Route path="locations" element={guard('locations', <AdminLocations />)} />
            <Route path="settings" element={guard('settings', <AdminSettings />)} />
          </Route>

          {/* The kitchen display: its own bar, since cooks never see the counter. */}
          <Route path="/kitchen" element={guard('kitchen', <Kitchen />)} />

          {/* `/items/new` opens the same editor in create mode. */}
          <Route path="/items/:itemId" element={guard('catalog', <ItemEditor />)} />
        </Route>

        <Route path="*" element={<Navigate to="/counter/register" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
