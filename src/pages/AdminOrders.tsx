import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import './AdminOrders.css';
import { Button } from '../components/Button';
import { FilterSelect } from '../components/FilterSelect';
import { Money, Mono } from '../components/Mono';
import { ORDER_CHIP, OrderDetail } from '../components/OrderDetail';
import { Pill, PillRow } from '../components/Pill';
import { PrintableReceipt } from '../components/PrintableReceipt';
import { SearchField } from '../components/SearchField';
import { StatusChip } from '../components/StatusChip';
import { orderItemCount, orderNetTotal, orderRefundTotal, orderTotal, type Order } from '../data/orders';
import { downloadCsv, money, ordersCsv } from '../lib/analytics';
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

type RangeId = 'today' | 'week' | 'month' | 'all';

const RANGES: { id: RangeId; label: string; maxDaysAgo: number }[] = [
  { id: 'today', label: 'Today', maxDaysAgo: 0 },
  { id: 'week', label: '7 days', maxDaysAgo: 6 },
  { id: 'month', label: '30 days', maxDaysAgo: 29 },
  { id: 'all', label: 'All time', maxDaysAgo: Infinity },
];

type SortKey = 'when' | 'total';
type Sort = { key: SortKey; dir: 'asc' | 'desc' };

/** Rows drawn per page; "Show more" adds another page. */
const PAGE_SIZE = 50;

/**
 * Every order across the business — open tabs, paid, and refunded — as a
 * sortable table with a receipt beside it. The counter's history is the
 * cashier's quick lookup; this is the back-office ledger, so it adds totals,
 * sorting, deeper ranges, and CSV export of exactly what's filtered.
 */
export function AdminOrders() {
  const navigate = useNavigate();
  const { orders, switchTab, settings } = usePos();
  const [range, setRange] = useState<RangeId>('week');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [payment, setPayment] = useState<PaymentFilter>('all');
  const [sort, setSort] = useState<Sort>({ key: 'when', dir: 'desc' });
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const filtersActive = status !== 'all' || payment !== 'all' || query.trim() !== '';

  // Everything except status, so each status pill counts what picking it would show.
  const beforeStatus = useMemo(() => {
    const maxDaysAgo = RANGES.find((r) => r.id === range)!.maxDaysAgo;
    const q = query.trim().toLowerCase();
    return orders.filter(
      (o) => o.daysAgo <= maxDaysAgo && matchesPayment(o, payment) && matchesQuery(o, q),
    );
  }, [orders, range, query, payment]);

  const statusCounts = useMemo(() => countByStatus(beforeStatus), [beforeStatus]);

  const visible = useMemo(() => {
    const filtered =
      status === 'all' ? beforeStatus : beforeStatus.filter((o) => o.status === status);
    // The store already lists newest first, so "when" is just that order.
    if (sort.key === 'when') return sort.dir === 'desc' ? filtered : [...filtered].reverse();
    const sign = sort.dir === 'desc' ? -1 : 1;
    return [...filtered].sort((a, b) => sign * (orderTotal(a) - orderTotal(b)));
  }, [beforeStatus, status, sort]);

  const summary = useMemo(() => {
    const paid = visible.filter((o) => o.status === 'paid');
    const refunded = visible.filter((o) => orderRefundTotal(o) > 0);
    const sales = paid.reduce((sum, o) => sum + orderNetTotal(o), 0);
    return {
      count: visible.length,
      sales,
      avgTicket: paid.length ? sales / paid.length : 0,
      tips: paid.reduce((sum, o) => sum + o.tip, 0),
      refunded: refunded.reduce((sum, o) => sum + orderRefundTotal(o), 0),
      refundCount: refunded.length,
    };
  }, [visible]);

  // A new filter or sort starts back at the first page.
  const pagingKey = `${range}|${query}|${status}|${payment}|${sort.key}|${sort.dir}`;
  const [paging, setPaging] = useState({ key: pagingKey, limit: PAGE_SIZE });
  const limit = paging.key === pagingKey ? paging.limit : PAGE_SIZE;
  const shown = visible.slice(0, limit);

  const selected = visible.find((o) => o.id === selectedId) ?? null;

  function select(id: number) {
    setSelectedId(id);
  }

  function toggleSort(key: SortKey) {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'desc' ? 'asc' : 'desc' }
        : { key, dir: 'desc' },
    );
  }

  function clearFilters() {
    setQuery('');
    setStatus('all');
    setPayment('all');
  }

  function exportCsv() {
    downloadCsv(
      ordersCsv(visible),
      `occupy-orders-${range}-${new Date().toISOString().slice(0, 10)}.csv`,
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Orders</h1>
          <div className="page-sub">{settings.locationName} · every tab, open and closed</div>
        </div>
        <div className="head-actions">
          <Button
            variant="secondary"
            size="sm"
            onClick={exportCsv}
            disabled={visible.length === 0}
          >
            Export CSV
          </Button>
        </div>
      </div>

      <div className="orders-toolbar">
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Search by order #, tab, item, amount, or card"
          label="Search orders"
        />
        <PillRow label="Date range">
          {RANGES.map((r) => (
            <Pill key={r.id} active={r.id === range} onClick={() => setRange(r.id)}>
              {r.label}
            </Pill>
          ))}
        </PillRow>
      </div>

      <div className="orders-filters">
        <PillRow label="Status">
          {STATUSES.map((s) => (
            <Pill key={s.id} active={s.id === status} onClick={() => setStatus(s.id)}>
              {s.label} <Mono className="orders-filters__count">{statusCounts[s.id]}</Mono>
            </Pill>
          ))}
        </PillRow>
        <div className="orders-filters__right">
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
            <button type="button" className="orders-clear" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>
      </div>

      <div className={settings.tipsEnabled || summary.tips > 0 ? 'orders-stats' : 'orders-stats orders-stats--no-tips'} aria-live="polite">
        <SummaryTile label="Orders" value={String(summary.count)} />
        <SummaryTile label="Paid sales" value={money(summary.sales)} />
        <SummaryTile label="Avg. ticket" value={money(summary.avgTicket)} />
        {(settings.tipsEnabled || summary.tips > 0) && (
          <SummaryTile label="Tips" value={money(summary.tips)} />
        )}
        <SummaryTile
          label="Refunded"
          value={money(summary.refunded)}
          note={
            summary.refundCount > 0
              ? `${summary.refundCount} ${summary.refundCount === 1 ? 'order' : 'orders'}`
              : undefined
          }
        />
      </div>

      <div className="orders-layout">
        <section className="panel orders-table-wrap" aria-label="Orders">
          {visible.length === 0 ? (
            <p className="orders-empty">
              No orders match.{' '}
              {filtersActive ? (
                <>
                  <button type="button" className="orders-clear" onClick={clearFilters}>
                    Clear filters
                  </button>{' '}
                  or widen the date range.
                </>
              ) : (
                'Try a wider date range.'
              )}
            </p>
          ) : (
            <table className="orders-table">
              <thead>
                <tr>
                  <th scope="col">Order</th>
                  <th scope="col">Tab</th>
                  <SortHeader label="When" sortKey="when" sort={sort} onSort={toggleSort} />
                  <th scope="col">Payment</th>
                  <th scope="col">Status</th>
                  <SortHeader
                    label="Total"
                    sortKey="total"
                    sort={sort}
                    onSort={toggleSort}
                    numeric
                  />
                </tr>
              </thead>
              <tbody>
                {shown.map((order) => {
                  const isSelected = order.id === selectedId;
                  const chip = ORDER_CHIP[order.status];
                  return (
                    <tr
                      key={order.id}
                      className={isSelected ? 'orders-row orders-row--selected' : 'orders-row'}
                      // Mouse convenience; the id button is the keyboard target.
                      onClick={() => select(order.id)}
                    >
                      <td>
                        <button
                          type="button"
                          className="orders-row__id"
                          onClick={(e) => {
                            e.stopPropagation();
                            select(order.id);
                          }}
                          aria-pressed={isSelected}
                          aria-label={`Order ${order.id}, ${order.name}`}
                        >
                          <Mono>{`#${order.id}`}</Mono>
                        </button>
                      </td>
                      <td className="orders-row__tab">
                        <span className="orders-row__name">{order.name}</span>
                        <span className="orders-row__items">{itemSummary(order)}</span>
                      </td>
                      <td className="orders-row__when">
                        <Mono>{whenLabel(order)}</Mono>
                      </td>
                      <td className="orders-row__method">
                        {order.method ?? <span className="orders-row__muted">—</span>}
                      </td>
                      <td>
                        <StatusChip status={chip.status} size="sm">
                          {chip.label}
                        </StatusChip>
                      </td>
                      <td className="orders-row__total">
                        <Money value={orderTotal(order)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {visible.length > shown.length && (
            <div className="orders-more">
              <span>
                Showing <Mono>{shown.length}</Mono> of <Mono>{visible.length}</Mono>
              </span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPaging({ key: pagingKey, limit: limit + PAGE_SIZE })}
              >
                Show {Math.min(PAGE_SIZE, visible.length - shown.length)} more
              </Button>
            </div>
          )}
        </section>

        <aside className="orders-detail" aria-label="Order detail">
          {selected ? (
            <OrderDetail
              key={selected.id}
              order={selected}
              when={whenLabel(selected)}
              onOpenTab={() => {
                switchTab(selected.id);
                navigate('/counter/register');
              }}
            />
          ) : (
            <p className="detail__placeholder">
              Pick an order to see its receipt, reprint it, or refund it.
            </p>
          )}
        </aside>
      </div>

      {/* Off-screen until Reprint receipt fires window.print(). */}
      {selected && <PrintableReceipt order={selected} />}
    </>
  );
}

function SummaryTile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="orders-stat">
      <div className="orders-stat__label">{label}</div>
      <Mono className="orders-stat__value">{value}</Mono>
      {note && <div className="orders-stat__note">{note}</div>}
    </div>
  );
}

function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  numeric = false,
}: {
  label: string;
  sortKey: SortKey;
  sort: Sort;
  onSort: (key: SortKey) => void;
  numeric?: boolean;
}) {
  const active = sort.key === sortKey;
  const ariaSort = active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
  return (
    <th scope="col" aria-sort={ariaSort} className={numeric ? 'orders-th--num' : undefined}>
      <button type="button" className="orders-sort" onClick={() => onSort(sortKey)}>
        {label}
        <span className="orders-sort__arrow" aria-hidden="true">
          {active ? (sort.dir === 'asc' ? '↑' : '↓') : '↕'}
        </span>
      </button>
    </th>
  );
}

/** "Oat Latte × 2, Cortado +2 more" — enough to recognise a ticket at a glance. */
function itemSummary(order: Order): string {
  if (order.lines.length === 0) return 'No items yet';
  const [first, second, ...rest] = order.lines;
  const fmt = (l: Order['lines'][number]) => (l.qty > 1 ? `${l.name} × ${l.qty}` : l.name);
  const head = second ? `${fmt(first)}, ${fmt(second)}` : fmt(first);
  if (rest.length === 0) return head;
  const more = rest.reduce((n, l) => n + l.qty, 0);
  return `${head} +${more} more · ${orderItemCount(order)} items`;
}

/**
 * Orders carry a display time plus how many days back they are. Older curated
 * orders already bake the day into the time ("Thu 2:14 PM"); the rest get one.
 */
function whenLabel(order: Order): string {
  if (!/^\d/.test(order.time)) return order.time;
  if (order.daysAgo === 0) return `Today · ${order.time}`;
  if (order.daysAgo === 1) return `Yesterday · ${order.time}`;
  const day = new Date(Date.now() - order.daysAgo * 86_400_000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
  return `${day} · ${order.time}`;
}
