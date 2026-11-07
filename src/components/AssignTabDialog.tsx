import { useEffect, useRef, useState } from 'react';
import './AssignTabDialog.css';
import './OpenTabsDialog.css';
import { locationName } from '../data/locations';
import { computeTotals, mergeLines } from '../lib/cart';
import { holdsManyTabs, orderNo, usePos, type OpenTab } from '../lib/store';
import { Button } from './Button';
import { FloorGrid } from './FloorGrid';
import { Money, Mono } from './Mono';
import { StatusChip } from './StatusChip';

/**
 * Moves the register's tab to a table or room. A room that already has a tab
 * merges the two instead; a table with tabs running asks whether to merge into
 * one of them or seat this one alongside. Built on native <dialog> so focus
 * trapping and Escape-to-close come for free.
 */
export function AssignTabDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { tab, tabs, locations, assignTab, mergeTab, canSeeTab } = usePos();
  // A walk-in is picked on purpose — a fresh tab isn't one until someone says so.
  const walkIn = tab.locationId === null && (tab.walkIn || locations.length === 0);
  const [mergeTarget, setMergeTarget] = useState<OpenTab | null>(null);
  /** A table with tabs running, while asking whether to merge or sit alongside. */
  const [seating, setSeating] = useState<string | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    if (!open) {
      setMergeTarget(null);
      setSeating(null);
    }
  }, [open]);

  // A table or room that already has a tab takes this one's items straight
  // in. Only a merge that's refused (a part-paid bill) stops to say why.
  function pick(locationId: string | null) {
    const sharing =
      locationId !== null &&
      locationId !== tab.locationId &&
      holdsManyTabs(locations, locationId) &&
      tabs.some((t) => t.locationId === locationId && t.orderId !== tab.orderId && canSeeTab(t));
    if (sharing) {
      setSeating(locationId);
      return;
    }
    if (assignTab(locationId)) {
      onClose();
      return;
    }
    const target = tabs.find((t) => t.locationId === locationId) ?? null;
    if (target && mergeTab(target.orderId)) {
      onClose();
      return;
    }
    setMergeTarget(target);
  }

  function merge(target: OpenTab) {
    // Part-paid bills can't be merged — their payments belong to them.
    if (!mergeTab(target.orderId)) return;
    onClose();
  }

  /** From the table's choice: straight in, or to the summary that says why it can't. */
  function mergeFromTable(target: OpenTab) {
    if (mergeTab(target.orderId)) {
      onClose();
      return;
    }
    setMergeTarget(target);
  }

  function seatAlongside() {
    if (seating !== null && assignTab(seating)) onClose();
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
            {mergeTarget ? 'Merge tabs' : seating ? locationName(locations, seating) : 'Assign tab'} {orderNo(tab.orderId) && <Mono>{orderNo(tab.orderId)}</Mono>}
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
        ) : seating ? (
          <TableChoice
            locationId={seating}
            onMerge={mergeFromTable}
            onAlongside={seatAlongside}
            onBack={() => setSeating(null)}
          />
        ) : (
          <div className="assign__floor">
            <button
              type="button"
              className={walkIn ? 'assign__walk-in assign__walk-in--current' : 'assign__walk-in'}
              onClick={() => pick(null)}
              aria-current={walkIn || undefined}
            >
              <span className="assign__walk-in-name">Walk-in</span>
              <span className="assign__walk-in-sub">Not seated at a table or room</span>
              {walkIn && (
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

/** A table with tabs running: fold this tab into one of them, or seat it there as its own. */
function TableChoice({
  locationId,
  onMerge,
  onAlongside,
  onBack,
}: {
  locationId: string;
  onMerge: (target: OpenTab) => void;
  onAlongside: () => void;
  onBack: () => void;
}) {
  const { tab, tabs, locations, settings, canSeeTab } = usePos();
  const name = locationName(locations, locationId);
  const here = tabs
    .filter((t) => t.locationId === locationId && t.orderId !== tab.orderId && canSeeTab(t))
    .sort((a, b) => a.openedIso.localeCompare(b.openedIso));
  const empty = tab.cart.length === 0;

  return (
    <div className="merge">
      <p className="merge__lead">
        {name} already has {here.length === 1 ? 'a tab' : <><Mono>{here.length}</Mono> tabs</>} open.{' '}
        {empty
          ? 'Switch to one of them, or seat this tab there as well.'
          : 'Merge this tab into one of them, or seat it there as a tab of its own.'}
      </p>

      <div className="open-tabs">
        {here.map((t) => {
          const totals = computeTotals(t.cart, settings.taxRate, t.discount);
          return (
            <button key={t.orderId} type="button" className="open-tab" onClick={() => onMerge(t)}>
              <span className="open-tab__name">
                {empty ? 'Switch to' : 'Merge into'} {orderNo(t.orderId) ?? 'the new tab'}
              </span>
              <span className="open-tab__meta">
                <Mono>{totals.itemCount}</Mono> {totals.itemCount === 1 ? 'item' : 'items'} · since{' '}
                <Mono>{t.openedAt}</Mono>
              </span>
              <Money value={totals.total} className="open-tab__total" />
            </button>
          );
        })}
      </div>

      <div className="merge__actions">
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
        <Button onClick={onAlongside} autoFocus>
          Seat as a separate tab
        </Button>
      </div>
    </div>
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
  const { settings, locations } = usePos();
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
        {target.name} already has{' '}
        {orderNo(target.orderId) ? (
          <>
            tab <Mono>{orderNo(target.orderId)}</Mono>
          </>
        ) : (
          'a tab'
        )}{' '}
        open{target.locationId && !holdsManyTabs(locations, target.locationId) ? ' — a room holds one tab at a time' : ''}.
      </p>

      {empty ? (
        <p className="merge__note">
          This tab has no items, so this just switches the
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
              {target.name}
              {orderNo(target.orderId) && (
                <>
                  {' '}
                  · <Mono>{orderNo(target.orderId)}</Mono>
                </>
              )}{' '}
              · {count(targetTotals.itemCount)}
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
