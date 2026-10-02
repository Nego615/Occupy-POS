import { useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import './SignIn.css';
import { Button } from '../components/Button';

/**
 * Links this device to a shop's Supabase account. Shown once per device,
 * before the store loads — after that, staff only ever see the PIN screen.
 */
export function DeviceSignIn({
  client,
  onSignedIn,
}: {
  client: SupabaseClient;
  onSignedIn: (storeId: string) => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error } = await client.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error || !data.user) {
      setError(
        error?.message === 'Invalid login credentials'
          ? 'That email and password don’t match a shop account.'
          : (error?.message ?? 'Couldn’t sign in. Check the connection and try again.'),
      );
      return;
    }
    onSignedIn(data.user.id);
  }

  return (
    <main className="signin">
      <form className="signin__card" onSubmit={submit}>
        <h1 className="signin__title">Set up this register</h1>
        <p className="signin__sub">Sign in with the shop’s account. You only do this once per device.</p>
        <div className="signin__fields">
          <label className="signin__field">
            <span>Email</span>
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="signin__field">
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && (
            <p className="signin__error" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" block disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </div>
      </form>
    </main>
  );
}
