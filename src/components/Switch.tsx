import './Switch.css';

export type SwitchProps = {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Accessible name — the visible label text this switch belongs to. */
  label: string;
  /** id of the element describing the switch, for the secondary line. */
  describedBy?: string;
  disabled?: boolean;
};

export function Switch({ checked, onChange, label, describedBy, disabled }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      className={checked ? 'switch switch--on' : 'switch'}
      onClick={() => onChange(!checked)}
    >
      <span className="switch__knob" aria-hidden="true" />
    </button>
  );
}
