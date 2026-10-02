import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import './SignIn.css';
import { Avatar } from '../components/Avatar';
import { BrandMark } from '../components/BrandMark';
import { Button } from '../components/Button';
import { Mono } from '../components/Mono';
import { PinPad } from '../components/PinPad';
import { homePath, roleLabel } from '../data/staff';
import { usePos } from '../lib/store';
import { useClock } from '../lib/useClock';

const LOCK_SECONDS = 30;

/** Where the guard wanted to go before it sent us here. */
type FromState = { from?: string } | null;

/**
 * The lock screen. Every route sits behind it; a PIN signs someone in, and if
 * they aren't on the clock yet they're offered a one-tap clock-in on the way.
 */
export function SignIn() {
  const navigate = useNavigate();
  const location = useLocation();
  const { me, signIn, signOut, shifts, clockIn, settings } = usePos();
  const { date, time } = useClock();
  const [step, setStep] = useState<'pin' | 'clock'>('pin');
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
  if (me && step === 'pin') return <Navigate to={from ?? homePath(me)} replace />;

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
    const onClock = shifts.some((s) => s.staffId === member.id && s.clockOut === null);
    if (onClock) {
      navigate(from ?? homePath(member), { replace: true });
    } else {
      setStep('clock');
    }
    return null;
  }

  function continueIn(withClockIn: boolean) {
    if (withClockIn && me) clockIn(me.id);
    navigate(from ?? (me ? homePath(me) : '/counter/register'), { replace: true });
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

        {step === 'pin' || !me ? (
          <>
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
          </>
        ) : (
          <div className="signin__clock">
            <Avatar name={me.name} />
            <h1 className="signin__title">Hi, {me.name.split(' ')[0]}</h1>
            <p className="signin__sub">
              {roleLabel(me.role)} · you’re not on the clock yet.
            </p>
            <div className="signin__actions">
              <Button size="lg" block onClick={() => continueIn(true)}>
                Clock in and continue
              </Button>
              <Button variant="secondary" block onClick={() => continueIn(false)}>
                Continue without clocking in
              </Button>
              <button
                type="button"
                className="signin__not-me"
                onClick={() => {
                  signOut();
                  setStep('pin');
                }}
              >
                Not {me.name.split(' ')[0]}? Sign out
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
