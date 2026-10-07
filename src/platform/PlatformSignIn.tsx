import { useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import '../pages/SignIn.css';
import { Button } from '../components/Button';

/** Email and password for a platform admin. Shop accounts are turned away after. */
export function PlatformSignIn({ client, refused }: { client: SupabaseClient; refused: string | null }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) {
      setError(
        error.message === 'Invalid login credentials'
          ? 'That email and password don’t match an account.'
          : error.message,
      );
    }
  }

  const shown = error ?? refused;
  return (
    <main className="signin">
      <form className="signin__card" onSubmit={submit}>
        <h1 className="signin__title">Occupy platform</h1>
        <p className="signin__sub">Manage the shops using Occupy POS.</p>
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
          {shown && (
            <p className="signin__error" role="alert">
              {shown}
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
