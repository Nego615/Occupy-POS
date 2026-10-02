import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import './OrderHistory.css';
import { FilterSelect } from '../components/FilterSelect';
import { Money, Mono } from '../components/Mono';
import { ORDER_CHIP, OrderDetail } from '../components/OrderDetail';
import { Pill, PillRow } from '../components/Pill';
import { PrintableReceipt } from '../components/PrintableReceipt';
import { ReceiptEdge } from '../components/Receipt';
import { SearchField } from '../components/SearchField';
import { StatusChip } from '../components/StatusChip';
import { orderItemCount, orderNetTotal, orderTotal, type Order } from '../data/orders';
import { LOCATION_GROUPS } from '../data/locations';
import {
  PAYMENTS,
  STATUSES,
  countByStatus,
  matchesPayment,
  matchesQuery,
  type PaymentFilter,
  type StatusFilter,
} from '../lib/orderFilters';
import { usePos } from '../lib/store';

type RangeId = 'today' | 'week' | 'all';

/** The list renders plainly, so it caps rather than trying to draw thousands of rows. */
const MAX_ROWS = 100;

const RANGES: { id: RangeId; label: string; maxDaysAgo: number }[] = [
  { id: 'today', label: 'Today', maxDaysAgo: 0 },
  { id: 'week', label: 'This week', maxDaysAgo: 6 },
  { id: 'all', label: 'All time', maxDaysAgo: Infinity },
];

/** `all`, `walk-in`, a whole kind (`kind:table`), or one location's id. */
type PlaceFilter = string;

export function OrderHistory() {
  const navigate = useNavigate();
  const { orders, locations, switchTab } = usePos();
  const [range, setRange] = useState<RangeId>('today');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [place, setPlace] = useState<PlaceFilter>('all');
  const [payment, setPayment] = useState<PaymentFilter>('all');
  const [selectedId, setSelectedId] = useState<number | null>(1042);

  const filtersActive = status !== 'all' || place !== 'all' || payment !== 'all';

  /**
   * Older orders predate location ids and only carry the tab name, so fall
   * back to matching the name against the current floor.
   */
  const locationOf = useMemo(() => {
    const byName = new Map(locations.map((l) => [l.name.toLowerCase(), l]));
    const byId = new Map(locations.map((l) => [l.id, l]));
    return (order: Order) =>
      (order.locationId ? byId.get(order.locationId) : undefined) ??
      byName.get(order.name.toLowerCase());
  }, [locations]);

  // Everything except the status filter — the status pills count against this,
  // so each pill says how many orders picking it would show.
  const beforeStatus = useMemo(() => {
    const maxDaysAgo = RANGES.find((r) => r.id === range)!.maxDaysAgo;
    const q = query.trim().toLowerCase();
    return orders.filter((order) => {
      if (order.daysAgo > maxDaysAgo) return false;
      if (!matchesPayment(order, payment)) return false;
      if (place !== 'all') {
        const location = locationOf(order);
        if (place === 'walk-in') {
          if (location) return false;
        } else if (place.startsWith('kind:')) {
          if (location?.kind !== place.slice(5)) return false;
        } else if (location?.id !== place) {
          return false;
        }
      }
      return matchesQuery(order, q);
    });
  }, [orders, range, query, place, payment, locationOf]);

  const statusCounts = useMemo(() => countByStatus(beforeStatus), [beforeStatus]);

  const visible = useMemo(
    () => (status === 'all' ? beforeStatus : beforeStatus.filter((o) => o.status === status)),
    [beforeStatus, status],
  );

  const paidTotal = useMemo(
    () =>
      visible
        .filter((o) => o.status === 'paid')
        .reduce((sum, o) => sum + orderNetTotal(o), 0),
    [visible],
  );

  function clearFilters() {
    setStatus('all');
    setPlace('all');
    setPayment('all');
  }

  const shown = visible.slice(0, MAX_ROWS);
  const selected = visible.find((o) => o.id === selectedId) ?? null;

  function select(id: number) {
    setSelectedId(id);
  }

  return (
    <div className="history__body">
      <main className="history__list">
        <div className="history__toolbar">
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Search by tab, item, or amount"
            label="Search orders by tab, item, or amount"
          />
          <PillRow label="Date range">
            {RANGES.map((r) => (
              <Pill key={r.id} active={r.id === range} onClick={() => setRange(r.id)}>
                {r.label}
              </Pill>
            ))}
          </PillRow>
        </div>

        <div className="history__filters">
          <PillRow label="Status">
            {STATUSES.map((s) => (
              <Pill key={s.id} active={s.id === status} onClick={() => setStatus(s.id)}>
                {s.label} <Mono className="history__count">{statusCounts[s.id]}</Mono>
              </Pill>
            ))}
          </PillRow>

          <div className="history__selects">
            <FilterSelect value={place} onChange={setPlace} label="Table or room">
              <option value="all">Any place</option>
              <option value="walk-in">Walk-in</option>
              {LOCATION_GROUPS.map((group) => {
                const members = locations.filter((l) => l.kind === group.kind);
                if (members.length === 0) return null;
                return (
                  <optgroup key={group.kind} label={group.label}>
                    <option value={`kind:${group.kind}`}>All {group.label.toLowerCase()}</option>
                    {members.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </FilterSelect>

            <FilterSelect
              value={payment}
              onChange={(v) => setPayment(v as PaymentFilter)}
              label="Payment method"
            >
              {PAYMENTS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </FilterSelect>

            {filtersActive && (
              <button type="button" className="history__clear" onClick={clearFilters}>
                Clear filters
              </button>
            )}
          </div>
        </div>

        {visible.length > 0 && (
          <p className="history__summary" aria-live="polite">
            <Mono>{visible.length}</Mono> {visible.length === 1 ? 'order' : 'orders'}
            {paidTotal > 0 && (
              <>
                {' · '}
                <Money value={paidTotal} /> paid
              </>
            )}
          </p>
        )}

        {visible.length === 0 ? (
          <p className="history__empty">
            {filtersActive ? (
              <>
                No orders match these filters —{' '}
                <button type="button" className="history__clear" onClick={clearFilters}>
                  clear filters
                </button>{' '}
                or widen the date range.
              </>
            ) : (
              'No orders match — try a different tab, item, or amount.'
            )}
          </p>
        ) : (
          shown.map((order, i) => (
            <div key={order.id}>
              <button
                type="button"
                className={
                  order.id === selectedId ? 'order-row order-row--selected' : 'order-row'
                }
                onClick={() => select(order.id)}
                aria-current={order.id === selectedId}
              >
                <Mono className="order-row__id">{`#${order.id}`}</Mono>
                <span className="order-row__main">
                  <span className="order-row__name">{order.name}</span>
                  <span className="order-row__meta">
                    <Mono>{orderItemCount(order)}</Mono>
                    {orderItemCount(order) === 1 ? ' item · ' : ' items · '}
                    <Mono>{order.time}</Mono>
                    {order.method ? ` · ${order.method}` : ''}
                  </span>
                </span>
                <StatusChip status={ORDER_CHIP[order.status].status} size="sm">
                  {ORDER_CHIP[order.status].label}
                </StatusChip>
                <Money value={orderTotal(order)} className="order-row__amount" />
              </button>
              {i < shown.length - 1 && <hr className="history__divider" />}
            </div>
          ))
        )}

        {visible.length > shown.length && (
          <p className="history__more">
            Showing the most recent <Mono>{shown.length}</Mono> of{' '}
            <Mono>{visible.length}</Mono> orders — search or narrow the range to find an
            older one.
          </p>
        )}
      </main>

      <aside className="detail" aria-label="Order detail">
        <ReceiptEdge />
        {selected ? (
          <OrderDetail
            key={selected.id}
            order={selected}
            headingLevel="h1"
            onOpenTab={() => {
              switchTab(selected.id);
              navigate('/counter/register');
            }}
          />
        ) : (
          <p className="detail__placeholder">
            Pick an order from the list to see its receipt.
          </p>
        )}
      </aside>

      {/* Off-screen until Reprint receipt fires window.print(). */}
      {selected && <PrintableReceipt order={selected} />}
    </div>
  );
}
