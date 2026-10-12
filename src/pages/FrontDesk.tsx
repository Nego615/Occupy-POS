import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import '../layouts/CounterLayout.css';
import './OrderHistory.css';
import './Tender.css';
import './FrontDesk.css';
import { AccountMenu } from '../components/AccountMenu';
import { Button } from '../components/Button';
import { TabDiscountDialog } from '../components/CounterDialogs';
import { Icon, type IconName } from '../components/Icon';
import { InCurrency, Money, Mono } from '../components/Mono';
import { OrderDetail } from '../components/OrderDetail';
import { Pill, PillGroup } from '../components/Pill';
import { PrintableCashUp, PrintableFolio } from '../components/PrintableSlip';
import { PrintableReceipt } from '../components/PrintableReceipt';
import { ReceiptEdge, SummaryRow } from '../components/Receipt';
import { StatusChip } from '../components/StatusChip';
import { TopBar } from '../components/TopBar';
import { TENDER_METHODS, expectedCash, expectedLocalCash, shiftStart, shiftTotals, type CashUp } from '../data/cashup';
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
import { usePos } from '../lib/store';
import { formatTime, useNow } from '../lib/useClock';
import { OrderHistory } from './OrderHistory';

type View = 'bills' | 'rooms' | 'receipts' | 'cashup';

const VIEWS: { id: View; label: string }[] = [
  { id: 'bills', label: 'Bills' },
  { id: 'rooms', label: 'Rooms' },
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
  const roomCount = new Set(orders.filter((o) => o.status === 'charged').map((o) => o.roomId)).size;
  const counts: Partial<Record<View, number>> = { bills: billCount, rooms: roomCount };

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
      {view === 'bills' && <BillsView selectedParam={Number(params.get('bill')) || null} />}
      {view === 'rooms' && <RoomsView onShowBill={(id) => show('bills', { bill: String(id) })} />}
      {view === 'receipts' && <OrderHistory onOpenTab={(id) => show('bills', { bill: String(id) })} />}
      {view === 'cashup' && <CashUpView />}
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
  const { tabs, orders, locations, switchTab, chargeToRoom } = usePos();
  const [picked, setPicked] = useState<number | null>(selectedParam);
  const [roomFor, setRoomFor] = useState<string | null>(null);
  const [discounting, setDiscounting] = useState(false);

  const bills = useMemo(
    () =>
      tabs
        .filter((t) => t.cart.length > 0)
        .sort((a, b) => {
          if (!!a.billRequestedAt !== !!b.billRequestedAt) return a.billRequestedAt ? -1 : 1;
          return (a.billRequestedAt ?? a.openedIso).localeCompare(b.billRequestedAt ?? b.openedIso);
        }),
    [tabs],
  );
  const rooms = locations.filter((l) => l.kind === 'room');
  const selectedTab = bills.find((t) => t.orderId === picked) ?? bills[0] ?? null;
  const selected = selectedTab ? orders.find((o) => o.id === selectedTab.orderId) ?? null : null;

  function select(orderId: number) {
    setPicked(orderId);
    setRoomFor(null);
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
        {bills.length === 0 ? (
          <p className="history__empty">
            No open bills. Bills sent from the register, and tabs running at tables and rooms, show
            up here to be paid.
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
                    <span className="order-row__name">{t.name}</span>
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
                {roomFor !== null ? (
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
                    {selectedTab.payments.length > 0 && (
                      <p className="desk__hint">Part-paid bills can only be paid off — no new discounts or room charges.</p>
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
      if (o.status !== 'charged' || !o.roomId) continue;
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

  const folio = folios.find((f) => f.roomId === picked) ?? folios[0] ?? null;
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
        {folios.length === 0 ? (
          <p className="history__empty">
            No rooms owe anything. Bills charged to a room wait here until the guest settles up.
          </p>
        ) : (
          folios.map((f, i) => (
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
              {i < folios.length - 1 && <hr className="history__divider desk__divider" />}
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

function computeOpenTotal(orders: OrderRecord[], orderId: number): number {
  const order = orders.find((o) => o.id === orderId);
  return order ? round(orderTotal(order) - paidAmount(order.payments)) : 0;
}

/* ---------- Cash-up ---------- */

/**
 * The shift so far — money in and out by method since the last cash-up — and
 * the drawer count that closes it. Closed shifts are listed for reprinting.
 */
function CashUpView() {
  const { orders, tabs, cashUps, closeShift, allStaff, settings } = usePos();
  const currency = activeCurrency();
  // A second drawer for cash taken in what the shop buys in, when it does.
  const local = exchangeRate(settings) ? costCurrency() : null;
  const now = useNow(30_000);
  const from = shiftStart(cashUps, new Date(now));
  const totals = useMemo(
    () =>
      shiftTotals(
        orders.filter((o) => o.status !== 'occupied'),
        tabs.flatMap((t) => t.payments),
        from,
        new Date(now).toISOString(),
      ),
    [orders, tabs, from, now],
  );

  const [floatText, setFloatText] = useState(() => String(cashUps[0]?.float ?? 0));
  const [countedText, setCountedText] = useState('');
  const [localFloatText, setLocalFloatText] = useState(() => String(cashUps[0]?.local?.float ?? 0));
  const [localCountedText, setLocalCountedText] = useState('');
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [printing, setPrinting] = useState<CashUp | null>(null);

  const float = parseAmount(floatText);
  const counted = parseAmount(countedText);
  const expected = expectedCash(float ?? 0, totals);
  const variance = counted !== null ? round(counted - expected) : null;
  const net = TENDER_METHODS.reduce((sum, m) => sum + totals.taken[m] - totals.refunded[m], 0);
  const localFloat = local ? parseAmount(localFloatText, local) : null;
  const localCounted = local ? parseAmount(localCountedText, local) : null;
  const localExpected = expectedLocalCash(localFloat ?? 0, totals);
  const localVariance = local && localCounted !== null ? roundMoney(localCounted - localExpected, local) : null;
  const valid = float !== null && counted !== null && (!local || (localFloat !== null && localCounted !== null));

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
    });
    setPrinting(cashUp);
    setCountedText('');
    setLocalCountedText('');
    setNote('');
    setConfirming(false);
  }

  const nameOf = (id: string) => allStaff.find((m) => m.id === id)?.name ?? '—';
  // A shift closed before the shop switched what it sells in was counted in the old currency.
  const shiftCurrency = (c: CashUp) =>
    beforeSwitch(c.closedAt, settings.currencySwitch) ? currencyOf(settings.currencySwitch.from) : undefined;

  return (
    <div className="history__body">
      <main className="history__list">
        <h1 className="desk__heading">This shift</h1>
        <p className="history__summary">
          Since <Mono>{shortWhen(from)}</Mono> · <Mono>{totals.payments}</Mono>{' '}
          {totals.payments === 1 ? 'payment' : 'payments'}
        </p>

        <table className="desk__table">
          <thead>
            <tr>
              <th scope="col">Method</th>
              <th scope="col">Taken</th>
              <th scope="col">Refunded</th>
              <th scope="col">Net</th>
            </tr>
          </thead>
          <tbody>
            {TENDER_METHODS.map((m) => (
              <tr key={m}>
                <th scope="row">{TENDER_LABEL[m]}</th>
                <td>
                  <Money value={totals.taken[m]} />
                </td>
                <td>
                  <Money value={-totals.refunded[m]} />
                </td>
                <td>
                  <Money value={totals.taken[m] - totals.refunded[m]} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total</th>
              <td>
                <Money value={TENDER_METHODS.reduce((s, m) => s + totals.taken[m], 0)} />
              </td>
              <td>
                <Money value={-TENDER_METHODS.reduce((s, m) => s + totals.refunded[m], 0)} />
              </td>
              <td>
                <Money value={net} />
              </td>
            </tr>
          </tfoot>
        </table>
        {local && totals.local.taken > 0 && (
          <p className="history__summary">
            Cash includes <Money value={totals.local.taken} currency={local} /> taken in {local.symbol}, for{' '}
            <Money value={totals.local.value.taken} /> of bills — it’s counted in its own drawer.
          </p>
        )}

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
                        {nameOf(c.by)} · <Mono>{c.payments}</Mono> payments · counted{' '}
                        <Money value={c.countedCash} />
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
              <div className="desk__row">
                <Button variant="secondary" onClick={() => window.print()}>
                  Print cash-up
                </Button>
                <Button onClick={() => setPrinting(null)}>Done</Button>
              </div>
              <PrintableCashUp cashUp={printing} currency={shiftCurrency(printing)} />
            </div>
          </InCurrency>
        ) : (
          <>
            <div className="detail__head">
              <h2 className="detail__title">Count the drawer</h2>
              <div className="detail__sub">Closing starts a new shift from now.</div>
            </div>
            <div className="desk__actions desk__drawer">
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
