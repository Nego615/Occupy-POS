import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { useNavigate, useSearchParams } from 'react-router';
import '../layouts/CounterLayout.css';
import './OrderHistory.css';
import './Tender.css';
import './FrontDesk.css';
import { AccountMenu } from '../components/AccountMenu';
import { Button } from '../components/Button';
import { TabDiscountDialog } from '../components/CounterDialogs';
import { Icon, type IconName } from '../components/Icon';
import { SortSelect } from '../components/ListControls';
import { CostMoney, InCurrency, Money, Mono } from '../components/Mono';
import { OrderDetail } from '../components/OrderDetail';
import { Pill, PillGroup, PillRow } from '../components/Pill';
import { PrintableCashUp, PrintableFolio } from '../components/PrintableSlip';
import { PrintableReceipt } from '../components/PrintableReceipt';
import { ReceiptEdge, SummaryRow } from '../components/Receipt';
import { SearchField } from '../components/SearchField';
import { MethodTable, ShiftReportSections, shiftLength } from '../components/ShiftReport';
import { StatusChip } from '../components/StatusChip';
import { TopBar } from '../components/TopBar';
import { expectedCash, expectedLocalCash, shiftStart, shiftTotals, type CashUp } from '../data/cashup';
import { inAnyCategory } from '../data/catalog';
import { EXPENSE_CATEGORIES, expenseCategoryLabel, type ExpenseCategoryId } from '../data/expenses';
import { PAYMENT_METHOD_LABEL, todayIso, type PaymentMethod } from '../data/inventory';
import { shiftReport, tillPaidOut } from '../data/shiftReport';
import {
  TENDER_LABEL,
  orderItemCount,
  orderTotal,
  paidAmount,
  type OrderRecord,
  type TenderMethod,
} from '../data/orders';
import { PAYMENT_METHODS, exchangeRate, stationLabel } from '../data/settings';
import { ADMIN_PERMISSIONS } from '../data/staff';
import { round } from '../lib/cart';
import {
  activeCurrency,
  costCurrency,
  costDue,
  currencyOf,
  formatAmount,
  isAmountText,
  roundMoney,
  type Currency,
} from '../lib/currency';
import { beforeSwitch } from '../lib/currencySwitch';
import { byNumber, byText, descending, matchesSearch, sortRows, type SortOption } from '../lib/listView';
import { swapIn } from '../lib/motion';
import { cashUpStock, countResult } from '../lib/shiftStock';
import { usePos } from '../lib/store';
import { BILL_QUEUE_SORTS } from '../lib/tabSorts';
import { formatTime, useNow } from '../lib/useClock';
import { ClientsView } from './ClientsView';
import { OrderHistory } from './OrderHistory';
import { ClientPicker } from '../components/ClientPicker';

type View = 'bills' | 'rooms' | 'clients' | 'receipts' | 'cashup';

type BillFilter = 'all' | 'sent' | 'part-paid' | 'open';

const BILL_FILTERS: { id: BillFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'sent', label: 'Bill requested' },
  { id: 'part-paid', label: 'Part paid' },
  { id: 'open', label: 'Still open' },
];

/** Where a bill stands: part paid beats sent over, which beats still running. */
function billState(b: { paid: number; tab: { billRequestedAt?: string } }): BillFilter {
  return b.paid > 0 ? 'part-paid' : b.tab.billRequestedAt ? 'sent' : 'open';
}

type Folio = { roomId: string; name: string; charges: OrderRecord[]; total: number };

const FOLIO_SORTS: SortOption<Folio>[] = [
  {
    id: 'newest',
    label: 'Newest charge first',
    compare: descending(byText((f) => f.charges[f.charges.length - 1]?.at)),
  },
  { id: 'oldest', label: 'Owing longest first', compare: byText((f) => f.charges[0]?.at) },
  { id: 'total-desc', label: 'Most owed first', compare: descending(byNumber((f) => f.total)) },
  { id: 'name', label: 'Room A to Z', compare: byText((f) => f.name) },
];

const VIEWS: { id: View; label: string }[] = [
  { id: 'bills', label: 'Bills' },
  { id: 'rooms', label: 'Rooms' },
  { id: 'clients', label: 'Clients' },
  { id: 'receipts', label: 'Receipts' },
  { id: 'cashup', label: 'Cash-up' },
];

const TENDER_ICON: Record<TenderMethod, IconName> = Object.fromEntries(
  PAYMENT_METHODS.map((m) => [m.id, m.icon]),
) as Record<TenderMethod, IconName>;

/** Typed money, commas allowed; null when blank or not an amount. In the business currency unless told otherwise. */
function parseAmount(text: string, currency?: Currency): number | null {
  const t = text.trim().replace(/,/g, '');
  if (!t || !isAmountText(t, currency)) return null;
  return roundMoney(Number.parseFloat(t), currency);
}

/** An ISO timestamp as a datetime-local input value, in local time: "2026-11-17T18:30". */
function isoToLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A datetime-local input value back to an ISO timestamp, or null when it isn't one. */
function localToIso(text: string): string | null {
  const t = new Date(text).getTime();
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** "4:12 PM" today, "Tue 4:12 PM" otherwise. */
function shortWhen(iso: string): string {
  const at = new Date(iso);
  const sameDay = at.toDateString() === new Date().toDateString();
  return sameDay ? formatTime(at) : `${at.toLocaleDateString('en-US', { weekday: 'short' })} ${formatTime(at)}`;
}

/**
 * The counter: where every bill is paid. Open bills from the floor and the
 * register, room charges waiting for checkout, receipts, and the shift's
 * cash-up — each a view of one screen, picked in the top bar.
 */
export function FrontDesk() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { can, settings, tabs, orders } = usePos();
  const view: View = VIEWS.some((v) => v.id === params.get('view')) ? (params.get('view') as View) : 'bills';

  const billCount = tabs.filter((t) => t.cart.length > 0).length;
  const charged = orders.filter((o) => o.status === 'charged');
  const roomCount = new Set(charged.filter((o) => !o.clientId).map((o) => o.roomId)).size;
  const clientCount = new Set(charged.filter((o) => o.clientId).map((o) => o.clientId)).size;
  const counts: Partial<Record<View, number>> = { bills: billCount, rooms: roomCount, clients: clientCount };

  const show = (next: View, extra: Record<string, string> = {}) => setParams({ view: next, ...extra });

  return (
    <div className="counter">
      <TopBar
        brand={settings.businessName}
        logo={settings.logo}
        station={`Counter · ${stationLabel(settings)}`}
        account={<AccountMenu />}
        showClock
        nav={
          <nav className="counter__nav" aria-label="Counter">
            <PillGroup>
              {VIEWS.map((v) => (
                <Pill key={v.id} active={v.id === view} onClick={() => show(v.id)}>
                  {v.label}
                  {counts[v.id] ? <Mono className="history__count">{counts[v.id]}</Mono> : null}
                </Pill>
              ))}
              {can('register') && <Pill onClick={() => navigate('/counter/register')}>Register</Pill>}
              {ADMIN_PERMISSIONS.some(can) && <Pill onClick={() => navigate('/admin')}>Admin</Pill>}
            </PillGroup>
          </nav>
        }
      />
      {/* Keyed by view, so switching views fades the new one in, like the register's pages. */}
      <motion.div key={view} className="counter__page" variants={swapIn} initial="hidden" animate="shown">
        {view === 'bills' && <BillsView selectedParam={Number(params.get('bill')) || null} />}
        {view === 'rooms' && <RoomsView onShowBill={(id) => show('bills', { bill: String(id) })} />}
        {view === 'clients' && <ClientsView />}
        {view === 'receipts' && <OrderHistory onOpenTab={(id) => show('bills', { bill: String(id) })} />}
        {view === 'cashup' && <CashUpView />}
      </motion.div>
    </div>
  );
}

/* ---------- Bills ---------- */

/**
 * Every open bill, the ones sent over to be paid first, then the longest
 * running. Discounts are given here, before any payment; payment happens on
 * the tender screen; a bill can also go onto a room to be paid at checkout.
 */
function BillsView({ selectedParam }: { selectedParam: number | null }) {
  const navigate = useNavigate();
  const { tabs, orders, locations, switchTab, chargeToRoom, chargeToClient } = usePos();
  const [picked, setPicked] = useState<number | null>(selectedParam);
  const [roomFor, setRoomFor] = useState<string | null>(null);
  // Putting the bill on a client's account: picking who, then confirming.
  const [accountFor, setAccountFor] = useState<string | null | undefined>(undefined);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [discounting, setDiscounting] = useState(false);
  const [query, setQuery] = useState('');
  const [billFilter, setBillFilter] = useState<BillFilter>('all');
  // The counter's queue: bills sent over first. Newest first is one pick away.
  const [sort, setSort] = useState('queue');

  const allBills = useMemo(
    () =>
      tabs
        .filter((t) => t.cart.length > 0)
        .map((t) => {
          const order = orders.find((o) => o.id === t.orderId);
          const paid = paidAmount(t.payments);
          return {
            tab: t,
            paid,
            row: {
              orderId: t.orderId,
              name: t.name,
              openedIso: t.openedIso,
              billRequestedAt: t.billRequestedAt,
              total: order ? round(orderTotal(order) - paid) : 0,
              items: t.cart.map((l) => l.name),
            },
          };
        }),
    [tabs, orders],
  );

  const billCounts = Object.fromEntries(
    BILL_FILTERS.map((f) => [f.id, f.id === 'all' ? allBills.length : allBills.filter((b) => billState(b) === f.id).length]),
  ) as Record<BillFilter, number>;

  const bills = useMemo(() => {
    const matching = allBills.filter(
      (b) =>
        (billFilter === 'all' || billState(b) === billFilter) &&
        matchesSearch(query, `#${b.tab.orderId}`, b.row.name, b.tab.customerName, b.row.total, ...b.row.items),
    );
    const byId = new Map(matching.map((b) => [b.tab.orderId, b.tab]));
    return sortRows(
      matching.map((b) => b.row),
      BILL_QUEUE_SORTS,
      sort,
    ).map((r) => byId.get(r.orderId)!);
  }, [allBills, billFilter, query, sort]);
  const filteringBills = query.trim() !== '' || billFilter !== 'all';
  const rooms = locations.filter((l) => l.kind === 'room');
  const selectedTab = bills.find((t) => t.orderId === picked) ?? bills[0] ?? null;
  const selected = selectedTab ? orders.find((o) => o.id === selectedTab.orderId) ?? null : null;

  function select(orderId: number) {
    setPicked(orderId);
    setRoomFor(null);
    setAccountFor(undefined);
    setAccountError(null);
  }

  function confirmAccount() {
    if (!selectedTab || !accountFor) return;
    const error = chargeToClient(selectedTab.orderId, accountFor);
    if (error) setAccountError(error);
    else setAccountFor(undefined);
  }

  function takePayment(orderId: number) {
    switchTab(orderId);
    navigate('/counter/tender', { state: { from: '/desk' } });
  }

  function discount(orderId: number) {
    // The discount dialog works on the open tab, so this bill becomes it.
    switchTab(orderId);
    setDiscounting(true);
  }

  function startRoomCharge() {
    if (!selectedTab) return;
    // A tab already in a room goes on that room's bill unless told otherwise.
    const here = rooms.find((r) => r.id === selectedTab.locationId);
    setRoomFor(here?.id ?? rooms[0]?.id ?? null);
  }

  function confirmRoomCharge() {
    if (!selectedTab || !roomFor) return;
    if (chargeToRoom(selectedTab.orderId, roomFor)) setRoomFor(null);
  }

  return (
    <div className="history__body">
      <main className="history__list">
        <h1 className="desk__heading">Bills to collect</h1>
        {allBills.length > 0 && (
          <div className="desk__tools">
            <SearchField
              value={query}
              onChange={setQuery}
              placeholder="Search docket #, table, item, or amount"
              label="Search bills by docket number, table, item, or amount"
            />
            <div className="history__filters">
              <PillRow label="Show">
                {BILL_FILTERS.map((f) => (
                  <Pill key={f.id} active={billFilter === f.id} onClick={() => setBillFilter(f.id)}>
                    {f.label} <Mono className="history__count">{billCounts[f.id]}</Mono>
                  </Pill>
                ))}
              </PillRow>
              <SortSelect value={sort} onChange={setSort} options={BILL_QUEUE_SORTS} />
            </div>
          </div>
        )}
        {bills.length === 0 ? (
          <p className="history__empty">
            {filteringBills ? (
              <>
                No bills match.{' '}
                <button
                  type="button"
                  className="history__clear"
                  onClick={() => {
                    setQuery('');
                    setBillFilter('all');
                  }}
                >
                  Show all bills
                </button>
              </>
            ) : (
              'No open bills. Bills sent from the register, and tabs running at tables and rooms, show up here to be paid.'
            )}
          </p>
        ) : (
          bills.map((t, i) => {
            const order = orders.find((o) => o.id === t.orderId);
            if (!order) return null;
            const paid = paidAmount(t.payments);
            return (
              <div key={t.orderId}>
                <button
                  type="button"
                  className={t.orderId === selectedTab?.orderId ? 'order-row order-row--selected' : 'order-row'}
                  onClick={() => select(t.orderId)}
                  aria-current={t.orderId === selectedTab?.orderId}
                >
                  <Mono className="order-row__id">{`#${t.orderId}`}</Mono>
                  <span className="order-row__main">
                    <span className="order-row__name">
                      {t.name}
                      {t.customerName && <span className="order-row__customer"> · {t.customerName}</span>}
                    </span>
                    <span className="order-row__meta">
                      <Mono>{orderItemCount(order)}</Mono>
                      {orderItemCount(order) === 1 ? ' item' : ' items'} · opened <Mono>{t.openedAt}</Mono>
                      {t.billRequestedAt && (
                        <>
                          {' '}
                          · sent <Mono>{shortWhen(t.billRequestedAt)}</Mono>
                        </>
                      )}
                    </span>
                  </span>
                  {paid > 0 ? (
                    <StatusChip status="occupied" size="sm">
                      Part paid
                    </StatusChip>
                  ) : t.billRequestedAt ? (
                    <StatusChip status="occupied" size="sm">
                      Bill requested
                    </StatusChip>
                  ) : (
                    <StatusChip status="occupied" size="sm">
                      Open
                    </StatusChip>
                  )}
                  <Money value={round(orderTotal(order) - paid)} className="order-row__amount desk__amount" />
                </button>
                {i < bills.length - 1 && <hr className="history__divider" />}
              </div>
            );
          })
        )}
      </main>

      <aside className="detail" aria-label="Bill">
        <ReceiptEdge />
        {selected && selectedTab ? (
          <OrderDetail
            key={selected.id}
            order={selected}
            onOpenTab={() => takePayment(selected.id)}
            openActions={
              <div className="desk__actions">
                {selectedTab.payments.length > 0 && (
                  <div className="desk__paid">
                    <SummaryRow label="Paid so far" value={-paidAmount(selectedTab.payments)} />
                    <SummaryRow
                      label="Left to pay"
                      value={round(orderTotal(selected) - paidAmount(selectedTab.payments))}
                      total
                    />
                  </div>
                )}
                {accountFor !== undefined ? (
                  <div className="desk__room-charge">
                    <ClientPicker
                      value={accountFor}
                      onChange={(id) => {
                        setAccountFor(id);
                        setAccountError(null);
                      }}
                      amount={round(orderTotal(selected) - paidAmount(selectedTab.payments))}
                    />
                    {accountError && (
                      <p className="desk__hint desk__hint--warn" role="alert">
                        {accountError}
                      </p>
                    )}
                    <div className="desk__row">
                      <Button variant="secondary" onClick={() => setAccountFor(undefined)}>
                        Cancel
                      </Button>
                      <Button onClick={confirmAccount} disabled={!accountFor}>
                        Put <Money value={round(orderTotal(selected) - paidAmount(selectedTab.payments))} /> on account
                      </Button>
                    </div>
                  </div>
                ) : roomFor !== null ? (
                  <div className="desk__room-charge">
                    <label className="detail__refund-field">
                      <span>Charge to</span>
                      <select value={roomFor} onChange={(e) => setRoomFor(e.target.value)}>
                        {rooms.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="desk__row">
                      <Button variant="secondary" onClick={() => setRoomFor(null)}>
                        Cancel
                      </Button>
                      <Button onClick={confirmRoomCharge}>
                        Put <Money value={orderTotal(selected)} /> on the room
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <Button size="lg" block onClick={() => takePayment(selected.id)}>
                      Take payment
                    </Button>
                    <Button
                      variant="secondary"
                      block
                      onClick={() => discount(selected.id)}
                      disabled={selectedTab.payments.length > 0}
                    >
                      {selectedTab.discount ? 'Change discount' : 'Discount the bill'}
                    </Button>
                    <div className="desk__row">
                      <Button variant="secondary" onClick={() => window.print()}>
                        Print bill
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={startRoomCharge}
                        disabled={rooms.length === 0 || selectedTab.payments.length > 0}
                      >
                        Charge to room
                      </Button>
                    </div>
                    <Button variant="secondary" block onClick={() => setAccountFor(selectedTab.customerId ?? null)}>
                      Put on a client’s account
                    </Button>
                    {selectedTab.payments.length > 0 && (
                      <p className="desk__hint">
                        Part-paid bills can be paid off or have the rest put on a client’s account — no new discounts
                        or room charges.
                      </p>
                    )}
                    {rooms.length === 0 && (
                      <p className="desk__hint">Add rooms under Admin → Tables &amp; rooms to charge bills to them.</p>
                    )}
                  </>
                )}
              </div>
            }
          />
        ) : (
          <p className="detail__placeholder">Nothing waiting to be paid.</p>
        )}
      </aside>

      <TabDiscountDialog open={discounting} onClose={() => setDiscounting(false)} />

      {/* Off-screen until Print bill fires window.print(). */}
      {selected && <PrintableReceipt order={selected} />}
    </div>
  );
}

/* ---------- Rooms ---------- */

type Settled = {
  room: string;
  orders: OrderRecord[];
  method: string;
  amount: number;
  tendered?: number;
  change: number;
  /** What the cash and change were in, when not the business currency. */
  currency?: Currency;
};

/** Rooms with charges waiting, and settling a room's whole bill in one payment. */
function RoomsView({ onShowBill }: { onShowBill: (orderId: number) => void }) {
  const { orders, locations, tabs, settings, settleRoom } = usePos();
  const currency = activeCurrency();
  const methods = (['cash', 'card', 'mobile'] as TenderMethod[]).filter((m) => settings.paymentMethods.includes(m));
  // Cash in what the shop buys in, when it buys in another currency.
  const rate = exchangeRate(settings);
  const local = rate ? costCurrency() : null;

  const folios = useMemo(() => {
    const byRoom = new Map<string, OrderRecord[]>();
    for (const o of orders) {
      if (o.status !== 'charged' || !o.roomId || o.clientId) continue;
      byRoom.set(o.roomId, [...(byRoom.get(o.roomId) ?? []), o]);
    }
    return [...byRoom].map(([roomId, charges]) => ({
      roomId,
      name: locations.find((l) => l.id === roomId)?.name ?? 'Removed room',
      charges: [...charges].sort((a, b) => a.at.localeCompare(b.at)),
      total: round(charges.reduce((sum, o) => sum + orderTotal(o), 0)),
      // Each bill's share in cash in the cost currency, rounded up the way it's taken.
      localTotal: rate ? charges.reduce((sum, o) => sum + costDue(orderTotal(o), rate), 0) : 0,
    }));
  }, [orders, locations, rate]);

  const [picked, setPicked] = useState<string | null>(null);
  const [method, setMethod] = useState<TenderMethod>(methods[0] ?? 'cash');
  const [tenderedText, setTenderedText] = useState('');
  const [ref, setRef] = useState('');
  const [settled, setSettled] = useState<Settled | null>(null);
  const [cashIn, setCashIn] = useState<'sales' | 'local'>('sales');
  const [roomQuery, setRoomQuery] = useState('');
  const [roomSort, setRoomSort] = useState('newest');

  const shownFolios = sortRows(
    folios.filter((f) =>
      matchesSearch(roomQuery, f.name, f.total, ...f.charges.flatMap((o) => [`#${o.id}`, ...o.lines.map((l) => l.name)])),
    ),
    FOLIO_SORTS,
    roomSort,
  );

  const folio = folios.find((f) => f.roomId === picked) ?? shownFolios[0] ?? null;
  const openHere = folio ? tabs.find((t) => t.locationId === folio.roomId && t.cart.length > 0) : undefined;
  const paysLocal = method === 'cash' && local !== null && cashIn === 'local';
  const cashCurrency = paysLocal ? local! : undefined;
  const due = folio ? (paysLocal ? folio.localTotal : folio.total) : 0;
  const tendered = method === 'cash' ? (parseAmount(tenderedText, cashCurrency) ?? due) : due;
  const change = folio ? roundMoney(tendered - due, cashCurrency) : 0;
  const valid =
    !!folio &&
    (method !== 'cash' || tenderedText === '' || parseAmount(tenderedText, cashCurrency) !== null) &&
    change >= 0;

  function select(roomId: string) {
    setPicked(roomId);
    setSettled(null);
    setTenderedText('');
    setRef('');
  }

  function settle() {
    if (!folio || !valid) return;
    const amount = settleRoom(folio.roomId, {
      method,
      ...(ref.trim() ? { ref: ref.trim() } : {}),
      ...(paysLocal ? { local: { currency: local!.code, rate: rate! } } : {}),
    });
    if (amount > 0) {
      setSettled({
        room: folio.name,
        orders: folio.charges,
        method: paysLocal ? `${TENDER_LABEL[method]} · ${local!.symbol}` : TENDER_LABEL[method],
        amount,
        ...(method === 'cash' ? { tendered } : {}),
        change: method === 'cash' ? change : 0,
        ...(paysLocal ? { currency: local! } : {}),
      });
    }
    setTenderedText('');
    setRef('');
  }

  return (
    <div className="history__body">
      <main className="history__list">
        <h1 className="desk__heading">Room bills</h1>
        {folios.length > 1 && (
          <div className="desk__tools desk__tools--row">
            <SearchField
              value={roomQuery}
              onChange={setRoomQuery}
              placeholder="Search room, docket #, or item"
              label="Search room bills by room, docket number, or item"
            />
            <SortSelect value={roomSort} onChange={setRoomSort} options={FOLIO_SORTS} />
          </div>
        )}
        {folios.length === 0 ? (
          <p className="history__empty">
            No rooms owe anything. Bills charged to a room wait here until the guest settles up.
          </p>
        ) : shownFolios.length === 0 ? (
          <p className="history__empty">
            No room bills match.{' '}
            <button type="button" className="history__clear" onClick={() => setRoomQuery('')}>
              Show all rooms
            </button>
          </p>
        ) : (
          shownFolios.map((f, i) => (
            <div key={f.roomId}>
              <button
                type="button"
                className={f.roomId === folio?.roomId && !settled ? 'order-row order-row--selected' : 'order-row'}
                onClick={() => select(f.roomId)}
                aria-current={f.roomId === folio?.roomId}
              >
                <span className="order-row__main">
                  <span className="order-row__name">{f.name}</span>
                  <span className="order-row__meta">
                    <Mono>{f.charges.length}</Mono> {f.charges.length === 1 ? 'charge' : 'charges'} · since{' '}
                    <Mono>{shortWhen(f.charges[0].at)}</Mono>
                  </span>
                </span>
                <Money value={f.total} className="order-row__amount desk__amount" />
              </button>
              {i < shownFolios.length - 1 && <hr className="history__divider desk__divider" />}
            </div>
          ))
        )}
      </main>

      <aside className="detail" aria-label="Room bill">
        <ReceiptEdge />
        {settled ? (
          <div className="desk__done">
            <span className="desk__done-label">{settled.change > 0 ? 'Change due' : 'Settled'}</span>
            <Money
              value={settled.change > 0 ? settled.change : settled.amount}
              currency={settled.change > 0 ? settled.currency : undefined}
              className="desk__done-amount"
            />
            <p className="desk__hint">
              {settled.room} paid <Money value={settled.amount} /> · {settled.method} ·{' '}
              <Mono>{settled.orders.length}</Mono> {settled.orders.length === 1 ? 'charge' : 'charges'}
            </p>
            <div className="desk__row">
              <Button variant="secondary" onClick={() => window.print()}>
                Print room bill
              </Button>
              <Button onClick={() => setSettled(null)}>Done</Button>
            </div>
            <PrintableFolio
              room={settled.room}
              orders={settled.orders}
              paid={{
                method: settled.method,
                tendered: settled.tendered,
                change: settled.change,
                currency: settled.currency,
              }}
            />
          </div>
        ) : folio ? (
          <>
            <div className="detail__head">
              <h2 className="detail__title">{folio.name}</h2>
              <div className="detail__sub">Room bill · unpaid</div>
            </div>
            <div className="detail__items">
              {folio.charges.map((o) => (
                <button type="button" key={o.id} className="detail-line desk__charge" onClick={() => onShowBill(o.id)}>
                  <span>
                    <span className="detail-line__name">
                      {o.name} · <Mono>{`#${o.id}`}</Mono>
                    </span>
                    <span className="detail-line__note">
                      <Mono>{shortWhen(o.at)}</Mono> · {o.lines.map((l) => `${l.qty} × ${l.name}`).join(', ')}
                    </span>
                  </span>
                  <Money value={orderTotal(o)} />
                </button>
              ))}
              {openHere && (
                <p className="desk__hint desk__hint--warn">
                  {folio.name} also has an open tab of{' '}
                  <Money value={computeOpenTotal(orders, openHere.orderId)} />.{' '}
                  <button type="button" className="history__clear" onClick={() => onShowBill(openHere.orderId)}>
                    Charge it to the room first
                  </button>{' '}
                  to settle everything together.
                </p>
              )}
            </div>
            <div className="detail__summary">
              <SummaryRow label="Room total" value={folio.total} total />
              {local && (
                <InCurrency currency={local}>
                  <SummaryRow label={`In cash in ${local.symbol}`} value={folio.localTotal} />
                </InCurrency>
              )}
            </div>
            <div className="desk__actions">
              <div className="desk__methods" role="group" aria-label="Payment method">
                {methods.map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={m === method ? 'method method--active' : 'method'}
                    aria-pressed={m === method}
                    onClick={() => {
                      setMethod(m);
                      setTenderedText('');
                      setRef('');
                    }}
                  >
                    <Icon name={TENDER_ICON[m]} size={22} className="method__icon" />
                    {TENDER_LABEL[m]}
                  </button>
                ))}
              </div>
              {method === 'cash' && local && (
                <div className="tender__split-row" role="group" aria-label="Cash in">
                  {(['sales', 'local'] as const).map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={cashIn === c ? 'tender__chip tender__chip--active' : 'tender__chip'}
                      aria-pressed={cashIn === c}
                      onClick={() => {
                        setCashIn(c);
                        setTenderedText('');
                      }}
                    >
                      Cash in {(c === 'local' ? local : currency).symbol}
                    </button>
                  ))}
                </div>
              )}
              {method === 'cash' ? (
                <label className="desk__field">
                  <span>Cash received</span>
                  <span className="desk__money">
                    <span className="mono" aria-hidden="true">
                      {(cashCurrency ?? currency).symbol}
                    </span>
                    <input
                      className="mono"
                      type="text"
                      inputMode={(cashCurrency ?? currency).decimals === 0 ? 'numeric' : 'decimal'}
                      value={tenderedText}
                      placeholder={formatAmount(due, cashCurrency)}
                      onChange={(e) => setTenderedText(e.target.value)}
                    />
                  </span>
                  {change !== 0 && (
                    <span className={change < 0 ? 'desk__change desk__change--short' : 'desk__change'}>
                      {change < 0 ? 'Short by' : 'Change'} <Money value={Math.abs(change)} currency={cashCurrency} />
                    </span>
                  )}
                </label>
              ) : (
                <label className="desk__field">
                  <span>{method === 'card' ? 'Card last 4 / approval' : 'Transaction ID'}</span>
                  <input
                    className="mono desk__input"
                    type="text"
                    value={ref}
                    maxLength={24}
                    placeholder="optional"
                    onChange={(e) => setRef(e.target.value.toUpperCase())}
                  />
                </label>
              )}
              <Button size="lg" block onClick={settle} disabled={!valid}>
                Settle <Money value={folio.total} />
              </Button>
              <Button variant="secondary" block onClick={() => window.print()}>
                Print room bill
              </Button>
            </div>
            <PrintableFolio room={folio.name} orders={folio.charges} />
          </>
        ) : (
          <p className="detail__placeholder">Pick a room to see what it owes.</p>
        )}
      </aside>
    </div>
  );
}

/** "Counted · expected TSh 50,000 · short TSh 2,000", in whatever currency the drawer's in. */
function DrawerResult({ counted, expected }: { counted: number; expected: number }) {
  return (
    <p className="desk__hint">
      Counted · expected <Money value={expected} /> ·{' '}
      {counted === expected ? (
        'balanced'
      ) : (
        <>
          {counted < expected ? 'short' : 'over'} <Money value={Math.abs(counted - expected)} />
        </>
      )}
    </p>
  );
}

/** What the shelf count at close found, once the shift's closed. */
function StockResult({ cashUp }: { cashUp: CashUp }) {
  const { cashUps, catalog, movements, stockCounts } = usePos();
  if (!cashUp.countId) return null;
  const result = countResult(cashUpStock(cashUp, cashUps, catalog, movements, stockCounts));
  return (
    <p className="desk__hint">
      Shelf · <Mono>{result.counted}</Mono> counted ·{' '}
      {result.off === 0 ? (
        'all as expected'
      ) : (
        <>
          <Mono>{result.off}</Mono> off, <Money value={result.value} /> at cost
        </>
      )}
    </p>
  );
}

function computeOpenTotal(orders: OrderRecord[], orderId: number): number {
  const order = orders.find((o) => o.id === orderId);
  return order ? round(orderTotal(order) - paidAmount(order.payments)) : 0;
}

/* ---------- Cash-up ---------- */

/** A shelf count: whole units, or part of one to two places — 2.5 bottles. */
const STOCK_COUNT = /^\d{1,5}(\.\d{1,2})?$/;

/**
 * The shift so far — money in and out by method since the last cash-up — and
 * the drawer count that closes it. Closed shifts are listed for reprinting.
 */
function CashUpView() {
  const {
    orders,
    tabs,
    cashUps,
    closeShift,
    allStaff,
    settings,
    catalog,
    categories,
    expenses,
    addExpense,
    deleteExpense,
    me,
  } = usePos();
  const currency = activeCurrency();
  const cost = costCurrency();
  // A second drawer for cash taken in what the shop buys in, when it does.
  const local = exchangeRate(settings) ? costCurrency() : null;
  const now = useNow(30_000);
  const nowIso = new Date(now).toISOString();
  // The earliest the shift can start: where the last one closed.
  const earliest = shiftStart(cashUps, new Date(now));

  // The shift's times: null means from the last cash-up, and up to now.
  const [startText, setStartText] = useState<string | null>(null);
  const [endText, setEndText] = useState<string | null>(null);
  const to = endText ? localToIso(endText) : nowIso;
  const chosenStart = startText ? localToIso(startText) : earliest;
  // A start picked in the same minute the last shift closed is that close.
  const from =
    chosenStart && chosenStart < earliest && Date.parse(earliest) - Date.parse(chosenStart) < 60_000
      ? earliest
      : chosenStart;
  const timeError = !from || !to
    ? 'Pick when it started and ended.'
    : from < earliest
      ? `It can’t start before the last cash-up closed, at ${shortWhen(earliest)}.`
      : to > nowIso
        ? 'It can’t end in the future.'
        : to <= from
          ? 'It has to end after it starts.'
          : null;
  const span = timeError ? { from: earliest, to: nowIso } : { from: from!, to: to! };

  const closedOrders = useMemo(() => orders.filter((o) => o.status !== 'occupied'), [orders]);
  const openPayments = useMemo(() => tabs.flatMap((t) => t.payments), [tabs]);
  const totals = useMemo(
    () => shiftTotals(closedOrders, openPayments, span.from, span.to),
    [closedOrders, openPayments, span.from, span.to],
  );
  // Payments between the last cash-up and a later start would be in no shift at all.
  const gap = useMemo(
    () => (span.from > earliest ? shiftTotals(closedOrders, openPayments, earliest, span.from) : null),
    [closedOrders, openPayments, earliest, span.from],
  );
  const report = useMemo(
    () => shiftReport(orders, expenses, span.from, span.to),
    [orders, expenses, span.from, span.to],
  );
  const shiftExpenses = useMemo(
    () => expenses.filter((e) => e.at && e.at > span.from && e.at <= span.to),
    [expenses, span.from, span.to],
  );
  // Paid from the till: out of the cost-currency drawer when there is one.
  const paidOut = tillPaidOut(expenses, span.from, span.to);
  const mainPaidOut = local ? 0 : paidOut;
  const localPaidOut = local ? paidOut : 0;

  const [floatText, setFloatText] = useState(() => String(cashUps[0]?.float ?? 0));
  const [countedText, setCountedText] = useState('');
  const [localFloatText, setLocalFloatText] = useState(() => String(cashUps[0]?.local?.float ?? 0));
  const [localCountedText, setLocalCountedText] = useState('');
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [printing, setPrinting] = useState<CashUp | null>(null);

  // An expense logged from here.
  const [expDesc, setExpDesc] = useState('');
  const [expCategory, setExpCategory] = useState<ExpenseCategoryId>('supplies');
  const [expAmount, setExpAmount] = useState('');
  const [expPaid, setExpPaid] = useState<'till' | PaymentMethod>('till');
  const expValue = parseAmount(expAmount, cost);
  const expValid = expDesc.trim() !== '' && expValue !== null && expValue > 0;

  function logExpense() {
    if (!expValid) return;
    addExpense({
      date: todayIso(),
      // Inside the shift being closed, even when it ends before now.
      at: endText && !timeError ? span.to : new Date().toISOString(),
      category: expCategory,
      description: expDesc.trim(),
      amount: expValue!,
      method: expPaid === 'till' ? 'cash' : expPaid,
      ...(expPaid === 'till' ? { fromTill: true as const } : {}),
      by: me?.name ?? '',
    });
    setExpDesc('');
    setExpAmount('');
    setConfirming(false);
  }

  const float = parseAmount(floatText);
  const counted = parseAmount(countedText);
  const expected = expectedCash(float ?? 0, totals, mainPaidOut);
  const variance = counted !== null ? round(counted - expected) : null;
  const localFloat = local ? parseAmount(localFloatText, local) : null;
  const localCounted = local ? parseAmount(localCountedText, local) : null;
  const localExpected = expectedLocalCash(localFloat ?? 0, totals, localPaidOut);
  const localVariance = local && localCounted !== null ? roundMoney(localCounted - localExpected, local) : null;
  // The shelf count, for the categories Settings says to count at every cash-up.
  const toCount = useMemo(
    () =>
      catalog.filter(
        (i) => !i.untracked && inAnyCategory(categories, i.category, settings.shiftCountCategories ?? []),
      ),
    [catalog, categories, settings.shiftCountCategories],
  );
  const [stockText, setStockText] = useState<Record<string, string>>({});
  const stockCounted: Record<string, number> = {};
  let stockInvalid = false;
  for (const item of toCount) {
    const v = (stockText[item.id] ?? '').trim();
    if (!v) continue;
    if (STOCK_COUNT.test(v)) stockCounted[item.id] = Number(v);
    else stockInvalid = true;
  }
  const stockDone = Object.keys(stockCounted).length;

  const valid =
    !timeError &&
    float !== null &&
    counted !== null &&
    (!local || (localFloat !== null && localCounted !== null)) &&
    !stockInvalid;

  function close() {
    if (!valid) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    const cashUp = closeShift({
      float: float!,
      countedCash: counted!,
      note,
      ...(local ? { local: { float: localFloat!, counted: localCounted! } } : {}),
      ...(stockDone > 0 ? { stock: stockCounted } : {}),
      ...(startText ? { openedAt: span.from } : {}),
      ...(endText ? { closedAt: span.to } : {}),
    });
    setPrinting(cashUp);
    setStockText({});
    setCountedText('');
    setLocalCountedText('');
    setNote('');
    setStartText(null);
    setEndText(null);
    setConfirming(false);
  }

  /** Starts the shift `hours` before it ends. */
  function lastHours(hours: number) {
    setStartText(isoToLocal(new Date(Date.parse(span.to) - hours * 3_600_000).toISOString()));
    setConfirming(false);
  }

  const nameOf = (id: string) => allStaff.find((m) => m.id === id)?.name ?? '—';
  // A shift closed before the shop switched what it sells in was counted in the old currency.
  const shiftCurrency = (c: CashUp) =>
    beforeSwitch(c.closedAt, settings.currencySwitch) ? currencyOf(settings.currencySwitch.from) : undefined;

  const shown = printing
    ? {
        from: printing.openedAt,
        to: printing.closedAt,
        taken: printing.taken,
        refunded: printing.refunded,
        payments: printing.payments,
        report: printing.report,
      }
    : { from: span.from, to: span.to, taken: totals.taken, refunded: totals.refunded, payments: totals.payments, report };

  return (
    <div className="history__body">
      <main className="history__list">
        <InCurrency currency={printing ? shiftCurrency(printing) : undefined}>
          <h1 className="desk__heading">{printing ? 'Shift report' : 'This shift'}</h1>
          <p className="history__summary">
            <Mono>{shortWhen(shown.from)}</Mono> – <Mono>{printing || endText ? shortWhen(shown.to) : 'now'}</Mono> ·{' '}
            {shiftLength(shown.from, shown.to)} · <Mono>{shown.payments}</Mono>{' '}
            {shown.payments === 1 ? 'payment' : 'payments'}
            {printing && <> · closed by {nameOf(printing.by)}</>}
          </p>

          <MethodTable taken={shown.taken} refunded={shown.refunded} />
          {!printing && local && totals.local.taken > 0 && (
            <p className="history__summary">
              Cash includes <Money value={totals.local.taken} currency={local} /> taken in {local.symbol}, for{' '}
              <Money value={totals.local.value.taken} /> of bills — it’s counted in its own drawer.
            </p>
          )}
          {shown.report ? (
            <ShiftReportSections report={shown.report} />
          ) : (
            <p className="history__summary">This shift was closed before shift reports were kept.</p>
          )}
        </InCurrency>

        {cashUps.length > 0 && (
          <>
            <h2 className="desk__subheading">Past cash-ups</h2>
            {cashUps.slice(0, 10).map((c, i) => {
              // The dollar drawer's result, else the cost-currency drawer's when that's the one that's off.
              const localOff = !!c.local && c.local.counted !== c.local.expected && c.countedCash === c.expectedCash;
              const diff = localOff ? c.local!.counted - c.local!.expected : round(c.countedCash - c.expectedCash);
              return (
                <InCurrency key={c.id} currency={shiftCurrency(c)}>
                  <button
                    type="button"
                    className={printing?.id === c.id ? 'order-row order-row--selected' : 'order-row'}
                    onClick={() => setPrinting(c)}
                  >
                    <span className="order-row__main">
                      <span className="order-row__name">
                        <Mono>{shortWhen(c.openedAt)}</Mono> – <Mono>{shortWhen(c.closedAt)}</Mono>
                      </span>
                      <span className="order-row__meta">
                        {nameOf(c.by)} · {shiftLength(c.openedAt, c.closedAt)} · <Mono>{c.payments}</Mono> payments ·
                        counted <Money value={c.countedCash} />
                        {c.local && (
                          <>
                            {' '}
                            + <Money value={c.local.counted} currency={currencyOf(c.local.currency)} />
                          </>
                        )}
                      </span>
                    </span>
                    <StatusChip status={diff === 0 ? 'open' : 'occupied'} size="sm">
                      {diff === 0 ? 'Balanced' : diff < 0 ? 'Short' : 'Over'}
                    </StatusChip>
                    <Money
                      value={Math.abs(diff)}
                      currency={localOff ? currencyOf(c.local!.currency) : undefined}
                      className="order-row__amount desk__amount"
                    />
                  </button>
                  {i < Math.min(cashUps.length, 10) - 1 && <hr className="history__divider desk__divider" />}
                </InCurrency>
              );
            })}
          </>
        )}
      </main>

      <aside className="detail" aria-label="Cash drawer">
        <ReceiptEdge />
        {printing ? (
          <InCurrency currency={shiftCurrency(printing)}>
            <div className="desk__done">
              <span className="desk__done-label">Shift closed</span>
              <Money value={printing.countedCash} className="desk__done-amount" />
              <DrawerResult counted={printing.countedCash} expected={printing.expectedCash} />
              {printing.local && (
                <InCurrency currency={currencyOf(printing.local.currency)}>
                  <p className="desk__hint">
                    <Money value={printing.local.counted} /> in the {currencyOf(printing.local.currency).symbol} drawer
                  </p>
                  <DrawerResult counted={printing.local.counted} expected={printing.local.expected} />
                </InCurrency>
              )}
              <StockResult cashUp={printing} />
              {printing.report && (
                <p className="desk__hint">
                  Net sales <Money value={printing.report.sales.net} /> · expenses{' '}
                  <CostMoney value={printing.report.expensesTotal} /> · <Mono>{printing.report.openTabs.count}</Mono>{' '}
                  open {printing.report.openTabs.count === 1 ? 'tab' : 'tabs'}
                </p>
              )}
              <div className="desk__row">
                <Button variant="secondary" onClick={() => window.print()}>
                  Print report
                </Button>
                <Button onClick={() => setPrinting(null)}>Done</Button>
              </div>
              <PrintableCashUp cashUp={printing} currency={shiftCurrency(printing)} />
            </div>
          </InCurrency>
        ) : (
          <>
            <div className="detail__head">
              <h2 className="detail__title">Close the shift</h2>
              <div className="detail__sub">The report is made as it closes. The next shift starts where this one ends.</div>
            </div>
            <div className="desk__actions desk__drawer">
              <h3 className="desk__drawer-title">Shift times</h3>
              <div className="desk__times">
                <label className="desk__field">
                  <span>Started</span>
                  <input
                    className="desk__input mono"
                    type="datetime-local"
                    value={startText ?? isoToLocal(earliest)}
                    min={isoToLocal(earliest)}
                    max={isoToLocal(span.to)}
                    onChange={(e) => {
                      setStartText(e.target.value || null);
                      setConfirming(false);
                    }}
                  />
                </label>
                <label className="desk__field">
                  <span>Ended</span>
                  <input
                    className="desk__input mono"
                    type="datetime-local"
                    value={endText ?? isoToLocal(nowIso)}
                    max={isoToLocal(nowIso)}
                    onChange={(e) => {
                      setEndText(e.target.value || null);
                      setConfirming(false);
                    }}
                  />
                </label>
              </div>
              <div className="desk__presets" role="group" aria-label="Shift length">
                {[6, 8, 10, 12].map((h) => (
                  <Pill
                    key={h}
                    active={!!startText && Math.abs(Date.parse(span.to) - Date.parse(span.from) - h * 3_600_000) < 60_000}
                    disabled={Date.parse(span.to) - h * 3_600_000 < Date.parse(earliest) - 60_000}
                    onClick={() => lastHours(h)}
                  >
                    Last {h} h
                  </Pill>
                ))}
                {(startText || endText) && (
                  <Pill
                    onClick={() => {
                      setStartText(null);
                      setEndText(null);
                      setConfirming(false);
                    }}
                  >
                    Since last cash-up
                  </Pill>
                )}
              </div>
              {timeError ? (
                <p className="desk__error" role="alert">
                  {timeError}
                </p>
              ) : (
                <p className="desk__hint">
                  {shiftLength(span.from, span.to)} long.
                  {gap && gap.payments > 0 && (
                    <>
                      {' '}
                      <Mono>{gap.payments}</Mono> {gap.payments === 1 ? 'payment' : 'payments'} taken between{' '}
                      <Mono>{shortWhen(earliest)}</Mono> and the start won’t be in any cash-up.
                    </>
                  )}
                  {endText && ' Anything taken after it ends goes in the next shift.'}
                </p>
              )}

              <h3 className="desk__drawer-title">Expenses this shift</h3>
              {shiftExpenses.length === 0 && <p className="desk__hint">None yet. Add anything paid out below.</p>}
              {shiftExpenses.map((e) => (
                <div key={e.id} className="desk__expense">
                  <span className="desk__expense-name">
                    {e.description}
                    <small>
                      {expenseCategoryLabel(e.category)} · {e.fromTill ? 'from the till' : PAYMENT_METHOD_LABEL[e.method]}
                    </small>
                  </span>
                  <CostMoney value={e.amount} />
                  <button
                    type="button"
                    className="desk__expense-remove"
                    aria-label={`Remove ${e.description}`}
                    onClick={() => {
                      deleteExpense(e.id);
                      setConfirming(false);
                    }}
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                </div>
              ))}
              <div className="desk__expense-form">
                <label className="desk__field desk__field--wide">
                  <span>What for</span>
                  <input
                    className="desk__input"
                    type="text"
                    value={expDesc}
                    maxLength={80}
                    placeholder="Ice, charcoal, transport…"
                    onChange={(e) => setExpDesc(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && logExpense()}
                  />
                </label>
                <label className="desk__field">
                  <span>Amount</span>
                  <span className="desk__money">
                    <span className="mono" aria-hidden="true">
                      {cost.symbol}
                    </span>
                    <input
                      className="mono"
                      type="text"
                      inputMode={cost.decimals === 0 ? 'numeric' : 'decimal'}
                      value={expAmount}
                      aria-invalid={expAmount.trim() !== '' && expValue === null}
                      onChange={(e) => setExpAmount(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && logExpense()}
                    />
                  </span>
                </label>
                <label className="desk__field">
                  <span>Category</span>
                  <select
                    className="desk__input"
                    value={expCategory}
                    onChange={(e) => setExpCategory(e.target.value as ExpenseCategoryId)}
                  >
                    {EXPENSE_CATEGORIES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="desk__field desk__field--wide">
                  <span>Paid with</span>
                  <select
                    className="desk__input"
                    value={expPaid}
                    onChange={(e) => setExpPaid(e.target.value as 'till' | PaymentMethod)}
                  >
                    <option value="till">Cash from the till{local ? ` (${local.symbol} drawer)` : ''}</option>
                    <option value="cash">Cash from elsewhere</option>
                    <option value="mobile">{PAYMENT_METHOD_LABEL.mobile}</option>
                    <option value="bank">{PAYMENT_METHOD_LABEL.bank}</option>
                  </select>
                </label>
                <div className="desk__field--wide">
                  <Button variant="secondary" block onClick={logExpense} disabled={!expValid}>
                    Add expense
                  </Button>
                </div>
              </div>

              <h3 className="desk__drawer-title">Count the drawer</h3>
              <label className="desk__field">
                <span>Opening float</span>
                <span className="desk__money">
                  <span className="mono" aria-hidden="true">
                    {currency.symbol}
                  </span>
                  <input
                    className="mono"
                    type="text"
                    inputMode="decimal"
                    value={floatText}
                    onChange={(e) => {
                      setFloatText(e.target.value);
                      setConfirming(false);
                    }}
                  />
                </span>
              </label>
              {/* Cash taken in the cost currency is in the other drawer. */}
              <SummaryRow label="Cash taken" value={round(totals.taken.cash - totals.local.value.taken)} />
              <SummaryRow label="Cash refunded" value={-round(totals.refunded.cash - totals.local.value.refunded)} />
              {mainPaidOut > 0 && <SummaryRow label="Paid out for expenses" value={-mainPaidOut} />}
              <SummaryRow label="Cash expected" value={expected} total />
              <label className="desk__field">
                <span>Cash counted</span>
                <span className="desk__money">
                  <span className="mono" aria-hidden="true">
                    {currency.symbol}
                  </span>
                  <input
                    className="mono"
                    type="text"
                    inputMode="decimal"
                    value={countedText}
                    placeholder="Count the drawer"
                    onChange={(e) => {
                      setCountedText(e.target.value);
                      setConfirming(false);
                    }}
                  />
                </span>
                {variance !== null && (
                  <span className={variance < 0 ? 'desk__change desk__change--short' : 'desk__change'}>
                    {variance === 0 ? (
                      'Balanced'
                    ) : (
                      <>
                        {variance < 0 ? 'Short by' : 'Over by'} <Money value={Math.abs(variance)} />
                      </>
                    )}
                  </span>
                )}
              </label>
              {local && (
                <InCurrency currency={local}>
                  <h3 className="desk__drawer-title">{local.symbol} drawer</h3>
                  <label className="desk__field">
                    <span>Opening float</span>
                    <span className="desk__money">
                      <span className="mono" aria-hidden="true">
                        {local.symbol}
                      </span>
                      <input
                        className="mono"
                        type="text"
                        inputMode={local.decimals === 0 ? 'numeric' : 'decimal'}
                        value={localFloatText}
                        onChange={(e) => {
                          setLocalFloatText(e.target.value);
                          setConfirming(false);
                        }}
                      />
                    </span>
                  </label>
                  <SummaryRow label="Cash taken" value={totals.local.taken} />
                  <SummaryRow label="Cash refunded" value={-totals.local.refunded} />
                  {localPaidOut > 0 && <SummaryRow label="Paid out for expenses" value={-localPaidOut} />}
                  <SummaryRow label="Cash expected" value={localExpected} total />
                  <label className="desk__field">
                    <span>Cash counted</span>
                    <span className="desk__money">
                      <span className="mono" aria-hidden="true">
                        {local.symbol}
                      </span>
                      <input
                        className="mono"
                        type="text"
                        inputMode={local.decimals === 0 ? 'numeric' : 'decimal'}
                        value={localCountedText}
                        placeholder="Count the drawer"
                        onChange={(e) => {
                          setLocalCountedText(e.target.value);
                          setConfirming(false);
                        }}
                      />
                    </span>
                    {localVariance !== null && (
                      <span className={localVariance < 0 ? 'desk__change desk__change--short' : 'desk__change'}>
                        {localVariance === 0 ? (
                          'Balanced'
                        ) : (
                          <>
                            {localVariance < 0 ? 'Short by' : 'Over by'} <Money value={Math.abs(localVariance)} />
                          </>
                        )}
                      </span>
                    )}
                  </label>
                </InCurrency>
              )}
              {toCount.length > 0 && (
                <>
                  <h3 className="desk__drawer-title">Count the shelf</h3>
                  <p className="desk__hint desk__stock-hint">
                    What’s actually there — half a bottle is 0.5. Blank means not counted.{' '}
                    <Mono>{stockDone}</Mono> of <Mono>{toCount.length}</Mono> counted.
                  </p>
                  <div className="desk__stock">
                    {toCount.map((item) => {
                      const typed = stockText[item.id] ?? '';
                      return (
                        <label key={item.id} className="desk__stock-row">
                          <span className="desk__stock-name">{item.name}</span>
                          <input
                            className="desk__input desk__stock-input mono"
                            type="text"
                            inputMode="decimal"
                            value={typed}
                            placeholder="—"
                            aria-invalid={typed.trim() !== '' && !STOCK_COUNT.test(typed.trim())}
                            onChange={(e) => {
                              setStockText((t) => ({ ...t, [item.id]: e.target.value }));
                              setConfirming(false);
                            }}
                          />
                        </label>
                      );
                    })}
                  </div>
                </>
              )}
              <label className="desk__field">
                <span>Note</span>
                <input
                  className="desk__input"
                  type="text"
                  value={note}
                  maxLength={120}
                  placeholder="optional — why it’s over or short"
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              <Button size="lg" block onClick={close} onBlur={() => setConfirming(false)} disabled={!valid}>
                {confirming ? 'Confirm — close the shift' : 'Close shift'}
              </Button>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
