import { useEffect, useMemo, useRef, useState } from 'react';
import './AssignTabDialog.css';
import './OpenTabsDialog.css';
import { computeTotals } from '../lib/cart';
import { matchesSearch, sortRows } from '../lib/listView';
import { orderNo, usePos } from '../lib/store';
import { TAB_SORTS } from '../lib/tabSorts';
import { SortSelect } from './ListControls';
import { Money, Mono } from './Mono';
import { Pill, PillRow } from './Pill';
import { SearchField } from './SearchField';
import { StatusChip } from './StatusChip';

type Kind = 'all' | 'walk-in' | 'seated' | 'bill';

const KINDS: { id: Kind; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'seated', label: 'Tables & rooms' },
  { id: 'walk-in', label: 'Walk-in' },
  { id: 'bill', label: 'Bill sent' },
];

/**
 * Every open tab the signed-in person can see — walk-ins and seated tables
 * alike. Picking one puts it on the register to add to. Newest first, with
 * a search for the docket number, table, or something on the tab.
 */
export function OpenTabsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { tab: current, tabs, switchTab, canSeeTab, settings } = usePos();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<Kind>('all');
  const [sort, setSort] = useState('newest');

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const all = useMemo(
    () =>
      tabs
        .filter((t) => (t.cart.length > 0 || t.locationId !== null) && canSeeTab(t))
        .map((t) => {
          const totals = computeTotals(t.cart, settings.taxRate, t.discount);
          return {
            tab: t,
            totals,
            row: {
              orderId: t.orderId,
              name: t.locationId === null ? 'Walk-in' : t.name,
              openedIso: t.openedIso,
              billRequestedAt: t.billRequestedAt,
              total: totals.total,
              items: t.cart.map((l) => l.name),
            },
          };
        }),
    [tabs, canSeeTab, settings.taxRate],
  );

  const counts: Record<Kind, number> = {
    all: all.length,
    seated: all.filter((r) => r.tab.locationId !== null).length,
    'walk-in': all.filter((r) => r.tab.locationId === null).length,
    bill: all.filter((r) => r.tab.billRequestedAt).length,
  };

  const shown = useMemo(() => {
    const matching = all.filter(
      (r) =>
        (kind === 'all' ||
          (kind === 'seated' && r.tab.locationId !== null) ||
          (kind === 'walk-in' && r.tab.locationId === null) ||
          (kind === 'bill' && !!r.tab.billRequestedAt)) &&
        matchesSearch(query, orderNo(r.tab.orderId), r.row.name, r.tab.customerName, r.row.total, ...r.row.items),
    );
    const byId = new Map(matching.map((r) => [r.tab.orderId, r]));
    return sortRows(
      matching.map((r) => r.row),
      TAB_SORTS,
      sort,
    ).map((row) => byId.get(row.orderId)!);
  }, [all, kind, query, sort]);

  function pick(orderId: number) {
    switchTab(orderId);
    onClose();
  }

  const filtering = query.trim() !== '' || kind !== 'all';

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

        {all.length === 0 ? (
          <p className="open-tabs__empty">No tabs are open yet.</p>
        ) : (
          <>
            <div className="open-tabs__tools">
              <SearchField
                value={query}
                onChange={setQuery}
                placeholder="Docket #, table, customer, or item"
                label="Search open tabs by docket number, table, customer, or item"
              />
              <div className="open-tabs__filters">
                <PillRow label="Show">
                  {KINDS.map((k) => (
                    <Pill key={k.id} active={kind === k.id} onClick={() => setKind(k.id)}>
                      {k.label} <Mono className="open-tabs__count">{counts[k.id]}</Mono>
                    </Pill>
                  ))}
                </PillRow>
                <SortSelect value={sort} onChange={setSort} options={TAB_SORTS} />
              </div>
            </div>

            {shown.length === 0 ? (
              <p className="open-tabs__empty">
                {filtering ? (
                  <>
                    No open tabs match.{' '}
                    <button
                      type="button"
                      className="open-tabs__clear"
                      onClick={() => {
                        setQuery('');
                        setKind('all');
                      }}
                    >
                      Show all tabs
                    </button>
                  </>
                ) : (
                  'No tabs are open yet.'
                )}
              </p>
            ) : (
              <div className="open-tabs">
                {shown.map(({ tab: t, totals, row }) => {
                  const isCurrent = t.orderId === current.orderId;
                  return (
                    <button
                      key={t.orderId}
                      type="button"
                      className={isCurrent ? 'open-tab open-tab--current' : 'open-tab'}
                      onClick={() => pick(t.orderId)}
                      aria-current={isCurrent || undefined}
                    >
                      <span className="open-tab__name">
                        {row.name}
                        {t.customerName && <span className="open-tab__customer"> · {t.customerName}</span>}
                      </span>
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
          </>
        )}
      </div>
    </dialog>
  );
}
