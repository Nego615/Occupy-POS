import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import { App } from './App';
import { cloudRepository } from './lib/cloud';
import { openRepository } from './lib/persist';
import { PosProvider } from './lib/store';
import { supabase } from './lib/supabase';
import { DeviceSignIn } from './pages/DeviceSignIn';

const root = createRoot(document.getElementById('root')!);

// Saved state is read once, before the first render, so the store starts
// from it rather than flashing seed data and swapping.
async function start(storeId?: string) {
  const client = supabase;
  const { repo, snapshot } = await openRepository(
    client && storeId ? (local) => cloudRepository(client, storeId, local) : undefined,
  );
  root.render(
    <StrictMode>
      <PosProvider repo={repo} snapshot={snapshot}>
        <App />
      </PosProvider>
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
