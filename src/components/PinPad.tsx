import { useEffect, useId, useRef, useState } from 'react';
import './PinPad.css';

export const PIN_LENGTH = 4;

export type PinPadProps = {
  /**
   * Called once four digits are in. Return an error message to reject the
   * PIN (the field clears for another go), or null to accept it.
   */
  onComplete: (pin: string) => string | null;
  /** Accessible name for the field, e.g. "Your PIN". */
  label: string;
  /** Locks the pad, e.g. after too many wrong tries. The message explains why. */
  lockedMessage?: string | null;
  autoFocus?: boolean;
};

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

/**
 * Four-digit PIN entry. A real password input underneath, so a keyboard,
 * a screen reader, and a touch keypad all drive the same field. Submits by
 * itself on the fourth digit — no Enter needed at the counter.
 */
export function PinPad({ onComplete, label, lockedMessage = null, autoFocus = true }: PinPadProps) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const locked = lockedMessage !== null;
  const messageId = useId();

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  function update(next: string) {
    const digits = next.replace(/\D/g, '').slice(0, PIN_LENGTH);
    setPin(digits);
    if (digits.length > 0) setError(null);
    if (digits.length === PIN_LENGTH) {
      const problem = onComplete(digits);
      if (problem) {
        setError(problem);
        setPin('');
      }
    }
  }

  function press(key: string) {
    if (locked) return;
    update(pin + key);
    inputRef.current?.focus();
  }

  const message = lockedMessage ?? error;

  return (
    <div className="pinpad">
      <input
        ref={inputRef}
        className="pinpad__field mono"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={PIN_LENGTH}
        value={pin}
        onChange={(e) => update(e.target.value)}
        disabled={locked}
        aria-label={label}
        aria-invalid={error !== null}
        aria-describedby={messageId}
        placeholder="····"
      />
      <p className="pinpad__message" id={messageId} role="alert">
        {message ?? ''}
      </p>

      <div className="pinpad__keys" role="group" aria-label="Keypad">
        {KEYS.map((k) => (
          <button
            key={k}
            type="button"
            className="pinpad__key mono"
            onClick={() => press(k)}
            disabled={locked}
          >
            {k}
          </button>
        ))}
        <button
          type="button"
          className="pinpad__key pinpad__key--soft"
          onClick={() => {
            setPin('');
            inputRef.current?.focus();
          }}
          disabled={locked || pin.length === 0}
        >
          Clear
        </button>
        <button
          type="button"
          className="pinpad__key mono"
          onClick={() => press('0')}
          disabled={locked}
        >
          0
        </button>
        <button
          type="button"
          className="pinpad__key pinpad__key--soft"
          onClick={() => {
            setPin(pin.slice(0, -1));
            inputRef.current?.focus();
          }}
          disabled={locked || pin.length === 0}
          aria-label="Delete last digit"
        >
          <span aria-hidden="true">⌫</span>
        </button>
      </div>
    </div>
  );
}
