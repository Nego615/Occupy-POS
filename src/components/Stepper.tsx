import './Stepper.css';
import { Mono } from './Mono';

export type StepperProps = {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** What is being counted, for screen readers. e.g. "Oat Latte". */
  label: string;
  className?: string;
};

/** Quantity +/- control. The value is always mono so digits don't jitter. */
export function Stepper({
  value,
  onChange,
  min = 0,
  max = 99,
  step = 1,
  label,
  className,
}: StepperProps) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n));

  return (
    <div
      className={className ? `stepper ${className}` : 'stepper'}
      role="group"
      aria-label={`Quantity, ${label}`}
    >
      <button
        type="button"
        className="stepper__btn"
        onClick={() => onChange(clamp(value - step))}
        disabled={value <= min}
        aria-label={`Remove one ${label}`}
      >
        <span aria-hidden="true">–</span>
      </button>
      <Mono className="stepper__qty">
        <span aria-live="polite">{value}</span>
      </Mono>
      <button
        type="button"
        className="stepper__btn"
        onClick={() => onChange(clamp(value + step))}
        disabled={value >= max}
        aria-label={`Add one ${label}`}
      >
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}
