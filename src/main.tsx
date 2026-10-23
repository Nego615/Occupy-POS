import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import { App } from './App';
import { BusinessContext, devBusinessType, useBusiness } from './lib/business';
import { cloudRepository } from './lib/cloud';
import {
  CloudUnreachable as CloudUnreachableError,
  openRepository,
  type PosRepository,
  type Snapshot,
} from './lib/persist';
import { PosProvider, newShopSnapshot } from './lib/store';
import { SubscriptionGate } from './lib/SubscriptionGate';
import { supabase } from './lib/supabase';
import { initTheme } from './lib/theme';
import { CloudUnreachable } from './pages/CloudUnreachable';
import { DeviceSignIn } from './pages/DeviceSignIn';
import { OwnerSetup } from './pages/OwnerSetup';

// Before anything paints, so a dark till never flashes light.
initTheme();

const root = createRoot(document.getElementById('root')!);

// Each business type is a module of its own, picked by the shop's type. Retail's
// loads as its own chunk, so hospitality registers never download it.
const RetailApp = lazy(() => import('./modules/retail/RetailApp').then((m) => ({ default: m.RetailApp })));

function ModuleApp() {
  const { retail } = useBusiness();
  return retail ? (
    <Suspense fallback={null}>
      <RetailApp />
    </Suspense>
  ) : (
    <App />
  );
}

// The gate sits outside the store, so the store knows whether the shop is retail.
function renderApp(repo: PosRepository, snapshot: Snapshot, storeId?: string) {
  const app = (
    <PosProvider repo={repo} snapshot={snapshot}>
      <ModuleApp />
    </PosProvider>
  );
  root.render(
    <StrictMode>
      {supabase && storeId ? (
        <SubscriptionGate client={supabase} storeId={storeId}>
          {app}
        </SubscriptionGate>
      ) : (
        // With no platform to assign one, a register on this browser alone is hospitality.
        <BusinessContext.Provider value={devBusinessType() ?? 'hospitality'}>{app}</BusinessContext.Provider>
      )}
    </StrictMode>,
  );
}

// Saved state is read once, before the first render, so the store starts
// from it rather than flashing seed data and swapping.
async function start(storeId?: string): Promise<void> {
  const client = supabase;
  let opened: Awaited<ReturnType<typeof openRepository>>;
  try {
    opened = await openRepository(
      client && storeId ? (local) => cloudRepository(client, storeId, local) : undefined,
    );
  } catch (err) {
    if (!(err instanceof CloudUnreachableError)) throw err;
    // An empty device that can't see the shop yet — not a new shop.
    root.render(
      <StrictMode>
        <CloudUnreachable onRetry={() => start(storeId)} />
      </StrictMode>,
    );
    return;
  }
  const { repo, snapshot } = opened;
  if ('staff' in snapshot) return renderApp(repo, snapshot, storeId);
  // Nothing saved yet: a new shop, set up by its owner instead of the demo data.
  root.render(
    <StrictMode>
      <OwnerSetup
        synced={!!(client && storeId)}
        onDone={({ businessName, ownerName, currency, pin }) =>
          renderApp(repo, newShopSnapshot({ name: ownerName, pin }, { businessName, currency }), storeId)
        }
      />
    </StrictMode>,
  );
}

// Without Supabase configured the register runs on this browser's storage
// alone. With it, the device must be linked to a shop account first.
async function boot() {
  if (!supabase) return start();
  const { data } = await supabase.auth.getSession();
  if (data.session) return start(data.session.user.id);
  root.render(
    <StrictMode>
      <DeviceSignIn client={supabase} onSignedIn={(id) => void start(id)} />
    </StrictMode>,
  );
}

// /platform is the vendor's dashboard over every shop. It never opens a
// shop's data, and loads as its own chunk so registers don't download it.
async function bootPlatform() {
  const { PlatformApp } = await import('./platform/PlatformApp');
  root.render(
    <StrictMode>
      <PlatformApp />
    </StrictMode>,
  );
}

void (window.location.pathname.startsWith('/platform') ? bootPlatform() : boot());
