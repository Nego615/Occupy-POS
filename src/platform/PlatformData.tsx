import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import '../pages/SignIn.css';
import { Button } from '../components/Button';
import { loadAll, type PlatformData } from './api';

type PlatformContext = PlatformData & {
  client: SupabaseClient;
  /** The signed-in platform admin's email. */
  email: string;
  /** Reloads everything — called after each change, so every page agrees. */
  reload: () => Promise<void>;
};

const Context = createContext<PlatformContext | null>(null);

export function usePlatform(): PlatformContext {
  const ctx = useContext(Context);
  if (!ctx) throw new Error('usePlatform outside PlatformDataProvider');
  return ctx;
}

/** Loads every shop, plan and payment once, and again on `reload`. */
export function PlatformDataProvider({
  client,
  email,
  children,
}: {
  client: SupabaseClient;
  email: string;
  children: ReactNode;
}) {
  const [data, setData] = useState<PlatformData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setData(await loadAll(client));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [client]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (!data) {
    return (
      <main className="signin">
        <div className="signin__card">
          <h1 className="signin__title">{error ? 'Couldn’t load shops' : 'Loading shops…'}</h1>
          {error && (
            <>
              <p className="signin__sub">{error}</p>
              <Button size="lg" block onClick={() => void reload()}>
                Try again
              </Button>
            </>
          )}
        </div>
      </main>
    );
  }
  return <Context.Provider value={{ ...data, client, email, reload }}>{children}</Context.Provider>;
}
