import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ShopNotRegistered } from '../pages/ShopNotRegistered';
import { SubscriptionLocked } from '../pages/SubscriptionLocked';
import { asBusinessType, BusinessContext, devBusinessType } from './business';
import {
  isLocked,
  readShop,
  subscriptionState,
  type ShopSubscription,
  type SubscriptionState,
} from './subscription';

const CACHE_KEY = 'occupy-pos:subscription';
const HOUR = 60 * 60 * 1000;

type Cached = { storeId: string; shop: ShopSubscription | null };

/** The last answer this device got: the shop's row, null for none, or undefined if it never got one. */
function readCache(storeId: string): ShopSubscription | null | undefined {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as Cached | null;
    return cached?.storeId === storeId ? cached.shop : undefined;
  } catch {
    return undefined;
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

/** The shop's subscription state, or null when there's no answer yet. */
export function useSubscription(): SubscriptionState | null {
  return useContext(SubscriptionContext);
}

/**
 * Keeps the register closed while the shop's subscription is locked or
 * suspended, and to any account that isn't a shop registered on /platform.
 * Starts from the last answer this device saw, so it opens offline, and asks
 * again now and every hour. With no answer yet (no reachable server, and
 * nothing cached) it lets the register open.
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
  const [shop, setShop] = useState<ShopSubscription | null | undefined>(() => readCache(storeId));
  const [now, setNow] = useState(() => new Date());

  const check = useCallback(async () => {
    const found = await readShop(client, storeId);
    setNow(new Date());
    // Offline, or the platform tables aren't set up: keep what was known.
    if (found === undefined) return;
    writeCache(storeId, found);
    setShop(found);
  }, [client, storeId]);

  useEffect(() => {
    void check();
    const id = window.setInterval(() => void check(), HOUR);
    return () => window.clearInterval(id);
  }, [check]);

  if (shop === null) return <ShopNotRegistered client={client} onRetry={check} />;
  const state = shop ? subscriptionState(shop, now) : null;
  if (shop && state && isLocked(state)) {
    return <SubscriptionLocked shop={shop} state={state} onRetry={check} />;
  }
  return (
    <BusinessContext.Provider value={devBusinessType() ?? asBusinessType(shop?.business_type)}>
      <SubscriptionContext.Provider value={state}>{children}</SubscriptionContext.Provider>
    </BusinessContext.Provider>
  );
}
