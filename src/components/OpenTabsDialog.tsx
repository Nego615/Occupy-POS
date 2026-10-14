import { useEffect, useRef } from 'react';
import './AssignTabDialog.css';
import './OpenTabsDialog.css';
import { computeTotals } from '../lib/cart';
import { orderNo, usePos } from '../lib/store';
import { Money, Mono } from './Mono';
import { StatusChip } from './StatusChip';

/**
 * Every open tab the signed-in person can see — walk-ins and seated tables
 * alike. Picking one puts it on the register to add to.
 */
export function OpenTabsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { tab: current, tabs, switchTab, canSeeTab, settings } = usePos();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // Newest first.
  const running = tabs
    .filter((t) => (t.cart.length > 0 || t.locationId !== null) && canSeeTab(t))
    .sort((a, b) => b.openedIso.localeCompare(a.openedIso));

  function pick(orderId: number) {
    switchTab(orderId);
    onClose();
  }

  return (
    <dialog
      ref={ref}
      className="assign"
      aria-labelledby="open-tabs-title"
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="assign__body">
        <header className="assign__head">
          <h2 id="open-tabs-title" className="assign__title">
            Open tabs
          </h2>
          <button type="button" className="assign__close" onClick={onClose} aria-label="Close">
            <span aria-hidden="true">×</span>
          </button>
        </header>

        {running.length === 0 ? (
          <p className="open-tabs__empty">No tabs are open yet.</p>
        ) : (
          <div className="open-tabs">
            {running.map((t) => {
              const totals = computeTotals(t.cart, settings.taxRate, t.discount);
              const isCurrent = t.orderId === current.orderId;
              return (
                <button
                  key={t.orderId}
                  type="button"
                  className={isCurrent ? 'open-tab open-tab--current' : 'open-tab'}
                  onClick={() => pick(t.orderId)}
                  aria-current={isCurrent || undefined}
                >
                  <span className="open-tab__name">{t.locationId === null ? 'Walk-in' : t.name}</span>
                  {orderNo(t.orderId) && <Mono className="open-tab__id">{orderNo(t.orderId)}</Mono>}
                  <span className="open-tab__meta">
                    <Mono>{totals.itemCount}</Mono> {totals.itemCount === 1 ? 'item' : 'items'} · since{' '}
                    <Mono>{t.openedAt}</Mono>
                  </span>
                  {isCurrent ? (
                    <StatusChip status="occupied" size="sm">
                      On register
                    </StatusChip>
                  ) : (
                    t.billRequestedAt && (
                      <StatusChip status="occupied" size="sm">
                        Bill at counter
                      </StatusChip>
                    )
                  )}
                  <Money value={totals.total} className="open-tab__total" />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </dialog>
  );
}
