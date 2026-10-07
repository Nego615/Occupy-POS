import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

/**
 * The platform owner's own client. Its session is kept under a separate key,
 * so signing in here on a register never replaces the shop's sign-in.
 */
export const platform =
  url && key ? createClient(url, key, { auth: { storageKey: 'occupy-platform-auth' } }) : null;
