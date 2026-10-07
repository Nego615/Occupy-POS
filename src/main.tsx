import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import { App } from './App';
import { cloudRepository } from './lib/cloud';
import {
  CloudUnreachable as CloudUnreachableError,
  openRepository,
  type PosRepository,
  type Snapshot,
} from './lib/persist';
import { PosProvider, newShopSnapshot } from './lib/store';
import { supabase } from './lib/supabase';
import { CloudUnreachable } from './pages/CloudUnreachable';
import { DeviceSignIn } from './pages/DeviceSignIn';
import { OwnerSetup } from './pages/OwnerSetup';

const root = createRoot(document.getElementById('root')!);

function renderApp(repo: PosRepository, snapshot: Snapshot) {
  root.render(
    <StrictMode>
      <PosProvider repo={repo} snapshot={snapshot}>
        <App />
      </PosProvider>
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
  if ('staff' in snapshot) return renderApp(repo, snapshot);
  // Nothing saved yet: a new shop, set up by its owner instead of the demo data.
  root.render(
    <StrictMode>
      <OwnerSetup
        synced={!!(client && storeId)}
        onDone={({ businessName, ownerName, currency, pin }) =>
          renderApp(repo, newShopSnapshot({ name: ownerName, pin }, { businessName, currency }))
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

void boot();
