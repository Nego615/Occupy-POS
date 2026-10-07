import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/*
 * Shop accounts, for the platform dashboard. Only the actions that need the
 * service key live here; everything else the dashboard does goes straight to
 * Supabase under row-level security.
 *
 *   POST   { name, email, password, phone, planId, trialDays }  create a shop
 *   PATCH  { id, password }                                     set its password
 *   DELETE { id }                                               delete it and all its data
 *
 * Every call must carry a platform admin's access token.
 */

declare const process: { env: Record<string, string | undefined> };

const DAY = 24 * 60 * 60 * 1000;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

class Refused extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** The service-role client, once the caller is shown to be a platform admin. */
async function asAdmin(req: Request): Promise<SupabaseClient> {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Refused(500, 'The server isn’t set up: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed.');
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) throw new Refused(401, 'Sign in first.');
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new Refused(401, 'Your sign-in has expired — sign in again.');
  const { data: row } = await admin
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', data.user.id)
    .maybeSingle();
  if (!row) throw new Refused(403, 'Only platform admins can do that.');
  return admin;
}

async function body<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new Refused(400, 'The request wasn’t valid JSON.');
  }
}

function handle(run: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    try {
      return await run(req);
    } catch (err) {
      if (err instanceof Refused) return json(err.status, { error: err.message });
      return json(500, { error: err instanceof Error ? err.message : 'Something went wrong.' });
    }
  };
}

export const POST = handle(async (req) => {
  const admin = await asAdmin(req);
  const b = await body<{
    name?: string;
    email?: string;
    password?: string;
    phone?: string;
    planId?: string | null;
    trialDays?: number;
  }>(req);
  const name = b.name?.trim();
  const email = b.email?.trim().toLowerCase();
  if (!name) throw new Refused(400, 'The shop needs a name.');
  if (!email || !email.includes('@')) throw new Refused(400, 'Enter the shop’s email address.');
  if (!b.password || b.password.length < 8) throw new Refused(400, 'The password needs at least 8 characters.');
  const trialDays = Math.max(0, Math.floor(b.trialDays ?? 0));

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: b.password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Refused(400, error?.message ?? 'Couldn’t create the account.');

  const row = {
    store_id: data.user.id,
    name,
    owner_email: email,
    phone: b.phone?.trim() || null,
    plan_id: b.planId || null,
    // With no trial it starts unpaid (in its grace days) until the first payment.
    paid_until: new Date(Date.now() + trialDays * DAY).toISOString(),
  };
  let { error: shopError } = await admin.from('shops').insert({ ...row, trial: trialDays > 0 });
  // A database not yet upgraded for free trials has no `trial` column.
  if (shopError?.code === 'PGRST204') ({ error: shopError } = await admin.from('shops').insert(row));
  if (shopError) {
    // No half-made shops: an account without its row would open unrestricted.
    await admin.auth.admin.deleteUser(data.user.id);
    throw new Refused(500, shopError.message);
  }
  return json(201, { id: data.user.id });
});

export const PATCH = handle(async (req) => {
  const admin = await asAdmin(req);
  const b = await body<{ id?: string; password?: string }>(req);
  if (!b.id) throw new Refused(400, 'Which shop?');
  if (!b.password || b.password.length < 8) throw new Refused(400, 'The password needs at least 8 characters.');
  const { error } = await admin.auth.admin.updateUserById(b.id, { password: b.password });
  if (error) throw new Refused(400, error.message);
  return json(200, { ok: true });
});

export const DELETE = handle(async (req) => {
  const admin = await asAdmin(req);
  const b = await body<{ id?: string }>(req);
  if (!b.id) throw new Refused(400, 'Which shop?');
  const { data: isAdmin } = await admin
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', b.id)
    .maybeSingle();
  if (isAdmin) throw new Refused(400, 'That’s a platform admin account, not a shop.');
  // Cascades to the shop's records, counters and subscription row.
  const { error } = await admin.auth.admin.deleteUser(b.id);
  if (error) throw new Refused(400, error.message);
  return json(200, { ok: true });
});
