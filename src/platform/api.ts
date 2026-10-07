import type { SupabaseClient } from '@supabase/supabase-js';
import { currencyOf, formatCurrency, type CurrencyCode } from '../lib/currency';
import type { ShopSubscription } from '../lib/subscription';

export type Plan = {
  id: string;
  name: string;
  price: number;
  currency: string;
  period_months: number;
  active: boolean;
  created_at: string;
};

export type Shop = ShopSubscription & {
  store_id: string;
  owner_email: string;
  phone: string | null;
  notes: string | null;
  plan_id: string | null;
  created_at: string;
};

export type Payment = {
  id: string;
  /** Null once the shop has been deleted; `shop_name` still says who paid. */
  store_id: string | null;
  shop_name: string;
  plan_id: string | null;
  amount: number;
  currency: string;
  method: string;
  reference: string | null;
  periods: number;
  paid_at: string;
};

export type ShopStats = {
  store_id: string;
  last_activity: string | null;
  orders: number;
  staff: number;
};

export type PlatformData = {
  shops: Shop[];
  plans: Plan[];
  payments: Payment[];
  stats: Map<string, ShopStats>;
};

/** Throws the Supabase error, so callers can show its message. */
function must<T>({ data, error }: { data: T | null; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data as T;
}

export async function loadAll(client: SupabaseClient): Promise<PlatformData> {
  const [shops, plans, payments, stats] = await Promise.all([
    client.from('shops').select('*').order('name'),
    client.from('plans').select('*').order('price'),
    client.from('subscription_payments').select('*').order('paid_at', { ascending: false }),
    client.rpc('platform_shop_stats'),
  ]);
  return {
    shops: must<Shop[]>(shops),
    plans: must<Plan[]>(plans),
    payments: must<Payment[]>(payments),
    stats: new Map(must<ShopStats[]>(stats).map((s) => [s.store_id, s])),
  };
}

/** Calls one of the api/ functions that need the server's service key. */
async function server(client: SupabaseClient, method: string, body: unknown): Promise<void> {
  const { data } = await client.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Signed out — sign in again.');
  const res = await fetch('/api/platform/shops', {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const problem = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(problem?.error ?? `The server said ${res.status}.`);
  }
}

export type NewShop = {
  name: string;
  email: string;
  password: string;
  phone: string;
  planId: string | null;
  trialDays: number;
};

export const createShop = (client: SupabaseClient, shop: NewShop) => server(client, 'POST', shop);

export const deleteShop = (client: SupabaseClient, id: string) => server(client, 'DELETE', { id });

export const resetPassword = (client: SupabaseClient, id: string, password: string) =>
  server(client, 'PATCH', { id, password });

export async function updateShop(
  client: SupabaseClient,
  id: string,
  patch: Partial<Pick<Shop, 'name' | 'phone' | 'notes' | 'plan_id' | 'grace_days' | 'suspended' | 'paid_until'>>,
): Promise<void> {
  must(await client.from('shops').update(patch).eq('store_id', id));
}

export async function recordPayment(
  client: SupabaseClient,
  p: { store: string; plan: string; amount: number; method: string; reference: string; periods: number },
): Promise<void> {
  must(await client.rpc('record_payment', p));
}

export async function addPlan(client: SupabaseClient): Promise<Plan> {
  return must<Plan>(
    await client
      .from('plans')
      .insert({ name: 'New plan', price: 0, currency: 'TZS', period_months: 1 })
      .select()
      .single(),
  );
}

export async function updatePlan(client: SupabaseClient, id: string, patch: Partial<Plan>): Promise<void> {
  must(await client.from('plans').update(patch).eq('id', id));
}

export async function deletePlan(client: SupabaseClient, id: string): Promise<void> {
  must(await client.from('plans').delete().eq('id', id));
}

/** An amount in the plan's or payment's own currency. */
export function money(amount: number, currency: string): string {
  return formatCurrency(amount, currencyOf(currency as CurrencyCode));
}

/** A plan with no period: paid once, the shop never expires. */
export const isLifetime = (plan: Pick<Plan, 'period_months'>) => plan.period_months === 0;

/** "Monthly", "Every 3 months", "Yearly", "Lifetime". */
export function periodLabel(months: number): string {
  if (months === 0) return 'Lifetime';
  if (months === 1) return 'Monthly';
  if (months === 12) return 'Yearly';
  return `Every ${months} months`;
}

/** "Standard, monthly" — or just "Lifetime" when the name already says it. */
export function planLabel(plan: Pick<Plan, 'name' | 'period_months'>): string {
  const period = periodLabel(plan.period_months).toLowerCase();
  return plan.name.toLowerCase().includes(period) ? plan.name : `${plan.name}, ${period}`;
}

/** Days since a timestamp, as "Today", "Yesterday", "5 days ago", or "Never". */
export function ago(iso: string | null, now = new Date()): string {
  if (!iso) return 'Never';
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days} days ago`;
}
