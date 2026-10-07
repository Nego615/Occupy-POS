import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import './SignIn.css';
import { BrandMark } from '../components/BrandMark';
import { Mono } from '../components/Mono';
import { PinPad } from '../components/PinPad';
import { homePath } from '../data/staff';
import { usePos } from '../lib/store';
import { useClock } from '../lib/useClock';

const LOCK_SECONDS = 30;

/** Where the guard wanted to go before it sent us here. */
type FromState = { from?: string } | null;

/**
 * The lock screen. Every route sits behind it; a PIN signs someone in.
 */
export function SignIn() {
  const navigate = useNavigate();
  const location = useLocation();
  const { me, signIn, settings } = usePos();
  const { date, time } = useClock();
  const [failures, setFailures] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  // With nowhere to return to, each role lands on its own home screen.
  const from = (location.state as FromState)?.from;

  // Count the lockout down, then reopen the pad.
  useEffect(() => {
    if (lockedUntil === null) return;
    const tick = () => {
      const left = Math.ceil((lockedUntil - Date.now()) / 1000);
      if (left <= 0) {
        setLockedUntil(null);
        setFailures(0);
      } else {
        setSecondsLeft(left);
      }
    };
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [lockedUntil]);

  // Already signed in (e.g. the back button) — nothing to do here.
  if (me) return <Navigate to={from ?? homePath(me)} replace />;

  function tryPin(pin: string): string | null {
    const member = signIn(pin);
    if (!member) {
      const tries = failures + 1;
      setFailures(tries);
      if (tries >= settings.maxPinTries) {
        setLockedUntil(Date.now() + LOCK_SECONDS * 1000);
        // Rejecting clears the field; the lock message replaces this text.
        return 'Too many wrong PINs.';
      }
      const left = settings.maxPinTries - tries;
      return `That PIN didn’t match an active staff member. ${left} ${
        left === 1 ? 'try' : 'tries'
      } left.`;
    }
    setFailures(0);
    navigate(from ?? homePath(member), { replace: true });
    return null;
  }

  return (
    <main className="signin">
      <div className="signin__card">
        <div className="signin__brand">
          <BrandMark logo={settings.logo} />
          <div>
            <div className="brand-name">{settings.businessName}</div>
            <div className="brand-sub">
              {settings.locationName} · {date} · <Mono>{time}</Mono>
            </div>
          </div>
        </div>

        <h1 className="signin__title">Sign in</h1>
        <p className="signin__sub">Enter your 4-digit staff PIN.</p>
        <PinPad
          label="Staff PIN"
          onComplete={tryPin}
          lockedMessage={
            lockedUntil !== null
              ? `Too many wrong PINs. Try again in ${secondsLeft}s, or ask a manager.`
              : null
          }
        />
      </div>
    </main>
  );
}
