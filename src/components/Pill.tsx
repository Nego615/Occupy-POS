import { createContext, useContext, useId, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { motion } from 'motion/react';
import './Pill.css';
import { snap } from '../lib/motion';

export type PillProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  children: ReactNode;
};

/** Set by a PillRow or PillGroup: the id its pills share for their sliding fill. */
const PillGroupContext = createContext<string | null>(null);

/**
 * Tab / filter control. Used for category tabs, history filters, tip presets.
 * Inside a PillRow or PillGroup, the active pill's ink fill slides across to
 * the newly picked pill instead of jumping, so the eye follows the choice.
 */
export function Pill({ active = false, className, type = 'button', children, ...rest }: PillProps) {
  const group = useContext(PillGroupContext);
  const classes = ['pill', active ? 'pill--active' : '', group ? 'pill--grouped' : '', className ?? '']
    .filter(Boolean)
    .join(' ');

  return (
    <button type={type} className={classes} aria-pressed={active} {...rest}>
      {group && active && (
        <motion.span className="pill__fill" layoutId={group} transition={snap} aria-hidden="true" />
      )}
      <span className="pill__label">{children}</span>
    </button>
  );
}

/** Gives a set of pills one shared sliding fill, for rows laid out by the caller (e.g. a nav). */
export function PillGroup({ children }: { children: ReactNode }) {
  const id = useId();
  return <PillGroupContext.Provider value={`pill-fill-${id}`}>{children}</PillGroupContext.Provider>;
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
      <PillGroup>{children}</PillGroup>
    </div>
  );
}
