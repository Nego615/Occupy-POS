import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './PrintableDocument.css';
import { usePos } from '../lib/store';

/**
 * A full-page printout on the shop's letterhead — logo, name, location — for
 * paperwork that goes in a file or to a supplier: purchase orders, reports.
 * Portalled to <body> like PrintableReceipt, so print CSS can hide the app
 * and leave just this. Mount it only while it's the thing to print.
 */
export function PrintableDocument({
  title,
  reference,
  meta,
  children,
}: {
  /** "Purchase order", or the report's name. */
  title: string;
  /** Printed large beside the title — the order number. */
  reference?: string;
  /** Lines under the title: dates, range, who. */
  meta?: ReactNode[];
  children: ReactNode;
}) {
  const { settings, me } = usePos();
  return createPortal(
    <div className="print-doc">
      <header className="print-doc__letterhead">
        {settings.logo && <img className="print-doc__logo" src={settings.logo} alt="" />}
        <div>
          <div className="print-doc__brand">{settings.businessName}</div>
          <div className="print-doc__location">{settings.locationName}</div>
        </div>
      </header>

      <div className="print-doc__title-row">
        <h1 className="print-doc__title">{title}</h1>
        {reference && <div className="print-doc__reference mono">{reference}</div>}
      </div>
      {meta && meta.length > 0 && (
        <div className="print-doc__meta">
          {meta.map((m, i) => (
            <div key={i}>{m}</div>
          ))}
        </div>
      )}

      <div className="print-doc__body">{children}</div>

      <footer className="print-doc__foot">
        Printed <span className="mono">{new Date().toLocaleString('en-US')}</span>
        {me && <> by {me.name}</>}
      </footer>
    </div>,
    document.body,
  );
}
