import { useEffect, useState } from 'react';
import { Navigate, RouterProvider, createBrowserRouter } from 'react-router';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import '../pages/SignIn.css';
import './Platform.css';
import { platform } from './client';
import { PlatformDataProvider } from './PlatformData';
import { PlatformLayout } from './PlatformLayout';
import { PlatformSignIn } from './PlatformSignIn';
import { PlatformOverview } from './pages/PlatformOverview';
import { PlatformPayments } from './pages/PlatformPayments';
import { PlatformPlans } from './pages/PlatformPlans';
import { PlatformShop } from './pages/PlatformShop';
import { PlatformShops } from './pages/PlatformShops';

/**
 * The vendor's dashboard over every shop on Occupy: accounts, plans and
 * subscription payments. Signed in separately from any shop.
 */
export function PlatformApp() {
  // Every platform screen sits inside .pf, which carries its own palette and type.
  return <div className="pf">{platform ? <PlatformAuth client={platform} /> : <NotConnected />}</div>;
}

function NotConnected() {
  return (
    <main className="signin">
      <div className="signin__card">
        <h1 className="signin__title">Not connected</h1>
        <p className="signin__sub">
          The platform needs Supabase: set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.
        </p>
      </div>
    </main>
  );
}

function PlatformAuth({ client }: { client: SupabaseClient }) {
  // Undefined until the stored session has been read.
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [admin, setAdmin] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);

  useEffect(() => {
    void client.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = client.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, [client]);

  const userId = session?.user.id;
  useEffect(() => {
    setAdmin(false);
    if (!userId) return;
    setRefused(null);
    void client.rpc('is_platform_admin').then(({ data, error }) => {
      if (!error && data === true) {
        setRefused(null);
        setAdmin(true);
        return;
      }
      // A shop's account, or the platform tables aren't installed yet.
      setRefused(error ? error.message : 'That’s a shop account, not a platform admin.');
      void client.auth.signOut();
    });
  }, [client, userId]);

  if (session === undefined || (session && !admin && !refused)) {
    return (
      <main className="signin">
        <div className="signin__card">
          <h1 className="signin__title">Signing in…</h1>
        </div>
      </main>
    );
  }
  if (!session || !admin) return <PlatformSignIn client={client} refused={refused} />;

  return (
    <PlatformDataProvider client={client} email={session.user.email ?? ''}>
      <PlatformRouter />
    </PlatformDataProvider>
  );
}

/** A data router, so unsaved changes can hold back a page change (useBlocker). */
function PlatformRouter() {
  const [router] = useState(() =>
    createBrowserRouter([
      {
        path: '/platform',
        element: <PlatformLayout />,
        children: [
          { index: true, element: <PlatformOverview /> },
          { path: 'shops', element: <PlatformShops /> },
          { path: 'shops/:id', element: <PlatformShop /> },
          { path: 'plans', element: <PlatformPlans /> },
          { path: 'payments', element: <PlatformPayments /> },
          { path: '*', element: <Navigate to="/platform" replace /> },
        ],
      },
      { path: '*', element: <Navigate to="/platform" replace /> },
    ]),
  );
  return <RouterProvider router={router} />;
}
