import type { ReactNode } from 'react';
import './StatusChip.css';

export type StatusKind = 'occupied' | 'open' | 'refunded';

export type StatusChipProps = {
  status: StatusKind;
  /**
   * Required: color is never the only signal, so a chip always carries a label.
   * e.g. "Tab occupied", "Paid", "Refunded".
   */
  children: ReactNode;
  size?: 'sm' | 'md';
  className?: string;
};

export function StatusChip({ status, children, size = 'md', className }: StatusChipProps) {
  const classes = ['chip', `chip--${size}`, `chip--${status}`, className ?? '']
    .filter(Boolean)
    .join(' ');

  return (
    <span className={classes}>
      <span className="chip__dot" aria-hidden="true" />
      {children}
    </span>
  );
}
