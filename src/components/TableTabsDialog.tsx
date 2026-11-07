import { useEffect, useRef } from 'react';
import './AssignTabDialog.css';
import './OpenTabsDialog.css';
import { computeTotals } from '../lib/cart';
import { orderNo, usePos } from '../lib/store';
import { Button } from './Button';
import { Money, Mono } from './Mono';

/**
 * A table that already has tabs running: put one of them on the register, or
 * start another — a second party at the table, or a guest paying apart.
 * Open while `locationId` is set.
 */
export function TableTabsDialog({
  locationId,
  onClose,
  onDone,
}: {
  locationId: string | null;
  onClose: () => void;
  /** After a tab is on the register. */
  onDone: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const { tabs, locations, switchTab, openTab, canSeeTab, settings } = usePos();
  const open = locationId !== null;
  const name = locations.find((l) => l.id === locationId)?.name ?? 'this table';
  const here = tabs
    .filter((t) => t.locationId === locationId && canSeeTab(t))
    .sort((a, b) => a.openedIso.localeCompare(b.openedIso));
  const hidden = tabs.filter((t) => t.locationId === locationId && !canSeeTab(t)).length;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function pick(orderId: number) {
    switchTab(orderId);
    onDone();
  }

  function startNew() {
    if (locationId === null) return;
    openTab(locationId, true);
    onDone();
  }

  return (
    <dialog
      ref={ref}
      className="assign"
      aria-labelledby="table-tabs-title"
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="assign__body">
        <header className="assign__head">
          <h2 id="table-tabs-title" className="assign__title">
            {name}
          </h2>
          <button type="button" className="assign__close" onClick={onClose} aria-label="Close">
            <span aria-hidden="true">×</span>
          </button>
        </header>

        <div className="open-tabs">
          {here.map((t) => {
            const totals = computeTotals(t.cart, settings.taxRate, t.discount);
            return (
              <button key={t.orderId} type="button" className="open-tab" onClick={() => pick(t.orderId)}>
                <span className="open-tab__name">{orderNo(t.orderId) ?? 'New tab'}</span>
                <span className="open-tab__meta">
                  <Mono>{totals.itemCount}</Mono> {totals.itemCount === 1 ? 'item' : 'items'} · since{' '}
                  <Mono>{t.openedAt}</Mono>
                </span>
                <Money value={totals.total} className="open-tab__total" />
              </button>
            );
          })}
        </div>

        {hidden > 0 && (
          <p className="open-tabs__empty">
            {hidden === 1 ? 'One more tab here is' : `${hidden} more tabs here are`} another server’s.
          </p>
        )}

        <Button block onClick={startNew} autoFocus>
          New tab at {name}
        </Button>
      </div>
    </dialog>
  );
}
