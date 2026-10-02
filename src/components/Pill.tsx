import type { ButtonHTMLAttributes, ReactNode } from 'react';
import './Pill.css';

export type PillProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  children: ReactNode;
};

/** Tab / filter control. Used for category tabs, history filters, tip presets. */
export function Pill({ active = false, className, type = 'button', ...rest }: PillProps) {
  const classes = ['pill', active ? 'pill--active' : '', className ?? '']
    .filter(Boolean)
    .join(' ');

  return <button type={type} className={classes} aria-pressed={active} {...rest} />;
}

/** Layout wrapper for a set of pills. */
export function PillRow({
  children,
  className,
  label,
}: {
  children: ReactNode;
  className?: string;
  /** Accessible name for the group, e.g. "Item categories". */
  label?: string;
}) {
  return (
    <div
      className={className ? `pill-row ${className}` : 'pill-row'}
      role="group"
      aria-label={label}
    >
      {children}
    </div>
  );
}
