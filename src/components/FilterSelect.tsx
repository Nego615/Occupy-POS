import type { ReactNode } from 'react';
import './FilterSelect.css';

export type FilterSelectProps = {
  value: string;
  onChange: (value: string) => void;
  /** Accessible name; the selected option is the visible label. */
  label: string;
  /** <option> / <optgroup> elements. */
  children: ReactNode;
  disabled?: boolean;
};

/** Native select, dressed as a pill so it sits with the rest of a toolbar. */
export function FilterSelect({ value, onChange, label, children, disabled }: FilterSelectProps) {
  return (
    <label className="filter-select">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        {children}
      </select>
    </label>
  );
}
