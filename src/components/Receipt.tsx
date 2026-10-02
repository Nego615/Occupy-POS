import type { ReactNode } from 'react';
import './Receipt.css';
import { Money } from './Mono';

/** Perforated tape edge. Decorative — hidden from assistive tech. */
export function ReceiptEdge({
  inverted = false,
  className,
}: {
  /** Set when the tape sits on --paper rather than on a --surface rail. */
  inverted?: boolean;
  className?: string;
} = {}) {
  const classes = [
    'receipt-edge',
    inverted ? 'receipt-edge--inverted' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return <div className={classes} aria-hidden="true" />;
}

export type SummaryRowProps = {
  label: ReactNode;
  /** A number renders as mono currency; pass a node for anything else. */
  value: ReactNode | number;
  /** The bold, ruled-off final line. */
  total?: boolean;
};

export function SummaryRow({ label, value, total = false }: SummaryRowProps) {
  return (
    <div className={total ? 'summary-row summary-row--total' : 'summary-row'}>
      <span>{label}</span>
      {typeof value === 'number' ? <Money value={value} /> : value}
    </div>
  );
}
