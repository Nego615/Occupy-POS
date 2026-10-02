import { useEffect, useRef, useState } from 'react';
import './AssignTabDialog.css';
import { computeTotals, mergeLines } from '../lib/cart';
import { usePos, type OpenTab } from '../lib/store';
import { Button } from './Button';
import { FloorGrid } from './FloorGrid';
import { Money, Mono } from './Mono';
import { StatusChip } from './StatusChip';

/**
 * Moves the register's tab to a table or room. Picking one that already has a
 * tab offers to merge the two instead. Built on native <dialog> so focus
 * trapping and Escape-to-close come for free.
 */
export function AssignTabDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { tab, tabs, assignTab, mergeTab } = usePos();
  const [mergeTarget, setMergeTarget] = useState<OpenTab | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    if (!open) setMergeTarget(null);
  }, [open]);

  function pick(locationId: string | null) {
    if (assignTab(locationId)) {
      onClose();
      return;
    }
    setMergeTarget(tabs.find((t) => t.locationId === locationId) ?? null);
  }

  function merge(target: OpenTab) {
    // Part-paid bills can't be merged — their payments belong to them.
    if (!mergeTab(target.orderId)) return;
    onClose();
  }

  return (
    <dialog
      ref={ref}
      className="assign"
      aria-labelledby="assign-title"
      onClose={onClose}
      // A click on the backdrop lands on the dialog element itself.
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="assign__body">
        <header className="assign__head">
          <h2 id="assign-title" className="assign__title">
            {mergeTarget ? 'Merge tabs' : 'Assign tab'} <Mono>{`#${tab.orderId}`}</Mono>
          </h2>
          <button
            type="button"
            className="assign__close"
            onClick={onClose}
            aria-label="Close without assigning"
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>

        {mergeTarget ? (
          <MergeConfirm
            source={tab}
            target={mergeTarget}
            onMerge={() => merge(mergeTarget)}
            onBack={() => setMergeTarget(null)}
          />
        ) : (
          <div className="assign__floor">
            <button
              type="button"
              className={
                tab.locationId === null
                  ? 'assign__walk-in assign__walk-in--current'
                  : 'assign__walk-in'
              }
              onClick={() => pick(null)}
              aria-current={tab.locationId === null || undefined}
            >
              <span className="assign__walk-in-name">Walk-in</span>
              <span className="assign__walk-in-sub">Not seated at a table or room</span>
              {tab.locationId === null && (
                <StatusChip status="occupied" size="sm" className="assign__walk-in-chip">
                  This tab
                </StatusChip>
              )}
            </button>

            <FloorGrid onPick={pick} assigningOrderId={tab.orderId} />
          </div>
        )}
      </div>
    </dialog>
  );
}

function MergeConfirm({
  source,
  target,
  onMerge,
  onBack,
}: {
  source: OpenTab;
  target: OpenTab;
  onMerge: () => void;
  onBack: () => void;
}) {
  const { settings } = usePos();
  const sourceTotals = computeTotals(source.cart, settings.taxRate, source.discount);
  const targetTotals = computeTotals(target.cart, settings.taxRate, target.discount);
  const combined = computeTotals(mergeLines(target.cart, source.cart), settings.taxRate, target.discount);
  const empty = source.cart.length === 0;
  // A part-paid bill keeps its own items — its payments were taken against them.
  const partPaid = !empty && (source.payments.length > 0 || target.payments.length > 0);
  const count = (n: number) => (
    <>
      <Mono>{n}</Mono> {n === 1 ? 'item' : 'items'}
    </>
  );

  return (
    <div className="merge">
      <p className="merge__lead">
        {target.name} already has tab <Mono>{`#${target.orderId}`}</Mono> open — each table or room
        holds one tab at a time.
      </p>

      {empty ? (
        <p className="merge__note">
          Tab <Mono>{`#${source.orderId}`}</Mono> has no items, so this just switches the
          register to {target.name}’s tab.
        </p>
      ) : (
        <div className="merge__sum" aria-label="Merged tab">
          <div className="merge__row">
            <span>
              {source.name} · <Mono>{`#${source.orderId}`}</Mono> · {count(sourceTotals.itemCount)}
            </span>
            <Money value={sourceTotals.total} />
          </div>
          <div className="merge__row">
            <span>
              {target.name} · <Mono>{`#${target.orderId}`}</Mono> · {count(targetTotals.itemCount)}
            </span>
            <Money value={targetTotals.total} />
          </div>
          <div className="merge__row merge__row--total">
            <span>
              {target.name} after merging · {count(combined.itemCount)}
            </span>
            <Money value={combined.total} />
          </div>
        </div>
      )}

      {partPaid && (
        <p className="merge__note merge__note--blocked" role="alert">
          {source.payments.length > 0 ? `Tab #${source.orderId}` : `${target.name}’s tab`} is part
          paid, so the two can’t be merged. Finish or take back its payments first.
        </p>
      )}

      {!empty && !partPaid && (
        <p className="merge__note">
          Tab <Mono>{`#${source.orderId}`}</Mono> closes
          {source.locationId ? ` and ${source.name} frees up` : ''}.
        </p>
      )}

      <div className="merge__actions">
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
        <Button onClick={onMerge} autoFocus disabled={partPaid}>
          {empty ? `Open ${target.name}’s tab` : `Merge into ${target.name}`}
        </Button>
      </div>
    </div>
  );
}
