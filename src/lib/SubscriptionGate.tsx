import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SubscriptionLocked } from '../pages/SubscriptionLocked';
import {
  isLocked,
  subscriptionState,
  type ShopSubscription,
  type SubscriptionState,
} from './subscription';

const CACHE_KEY = 'occupy-pos:subscription';
const HOUR = 60 * 60 * 1000;

type Cached = { storeId: string; shop: ShopSubscription | null };

function readCache(storeId: string): ShopSubscription | null {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as Cached | null;
    return cached?.storeId === storeId ? cached.shop : null;
  } catch {
    return null;
  }
}

function writeCache(storeId: string, shop: ShopSubscription | null) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ storeId, shop } satisfies Cached));
  } catch {
    // Storage full or blocked — the next check fetches it again.
  }
}

const SubscriptionContext = createContext<SubscriptionState | null>(null);

/** The shop's subscription state, or null when it has none on record. */
export function useSubscription(): SubscriptionState | null {
  return useContext(SubscriptionContext);
}

/**
 * Keeps the register closed while the shop's subscription is locked or
 * suspended. Starts from the last answer this device saw, so it opens
 * offline, and asks again now and every hour. A shop with no subscription
 * row (or no reachable server, and nothing cached) is let in.
 */
export function SubscriptionGate({
  client,
  storeId,
  children,
}: {
  client: SupabaseClient;
  storeId: string;
  children: ReactNode;
}) {
  const [shop, setShop] = useState<ShopSubscription | null>(() => readCache(storeId));
  const [now, setNow] = useState(() => new Date());

  const check = useCallback(async () => {
    const read = (columns: string) =>
      client.from('shops').select(columns).eq('store_id', storeId).maybeSingle<ShopSubscription>();
    let { data, error } = await read('name, paid_until, grace_days, suspended, trial');
    // A database not yet upgraded for free trials has no `trial` column.
    if (error?.code === '42703') ({ data, error } = await read('name, paid_until, grace_days, suspended'));
    setNow(new Date());
    // Offline, or the platform tables aren't set up: keep what was known.
    if (error) return;
    writeCache(storeId, data);
    setShop(data);
  }, [client, storeId]);

  useEffect(() => {
    void check();
    const id = window.setInterval(() => void check(), HOUR);
    return () => window.clearInterval(id);
  }, [check]);

  const state = shop ? subscriptionState(shop, now) : null;
  if (shop && state && isLocked(state)) {
    return <SubscriptionLocked shop={shop} state={state} onRetry={check} />;
  }
  return <SubscriptionContext.Provider value={state}>{children}</SubscriptionContext.Provider>;
}
