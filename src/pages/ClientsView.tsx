import { useMemo, useState } from 'react';
import { Button } from '../components/Button';
import { Icon, type IconName } from '../components/Icon';
import { InCurrency, Money, Mono } from '../components/Mono';
import { OrderDetail } from '../components/OrderDetail';
import { PrintableReceipt } from '../components/PrintableReceipt';
import { ReceiptEdge } from '../components/Receipt';
import { SummaryRow } from '../components/Receipt';
import { SearchField } from '../components/SearchField';
import { StatusChip } from '../components/StatusChip';
import { clientBalance, debtsOf, orderOwed, type Client } from '../data/clients';
import { TENDER_LABEL, orderTotal, type OrderRecord, type Payment, type TenderMethod } from '../data/orders';
import { PAYMENT_METHODS, exchangeRate } from '../data/settings';
import {
  activeCurrency,
  costCurrency,
  costDue,
  formatAmount,
  isAmountText,
  roundMoney,
  type Currency,
} from '../lib/currency';
import { usePos } from '../lib/store';
import { formatTime } from '../lib/useClock';

const TENDER_ICON: Record<TenderMethod, IconName> = Object.fromEntries(
  PAYMENT_METHODS.map((m) => [m.id, m.icon]),
) as Record<TenderMethod, IconName>;

/** Typed money, commas allowed; null when blank or not an amount. */
function parseAmount(text: string, currency?: Currency): number | null {
  const t = text.trim().replace(/,/g, '');
  if (!t || !isAmountText(t, currency)) return null;
  return roundMoney(Number.parseFloat(t), currency);
}

/** "4:12 PM" today, "Tue 4:12 PM" this week, "Oct 3" before that. */
function when(iso: string): string {
  const at = new Date(iso);
  const days = (Date.now() - at.getTime()) / 86_400_000;
  if (at.toDateString() === new Date().toDateString()) return formatTime(at);
  if (days < 6) return `${at.toLocaleDateString('en-US', { weekday: 'short' })} ${formatTime(at)}`;
  return at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Payments made toward a client's debts, newest first — one row per payment,
 * though each was shared across the bills it paid off. Payments taken while
 * a bill was still open were part of the bill, not of the debt, so they're
 * left out.
 */
function debtPayments(orders: OrderRecord[], clientId: string): { at: string; method: string; amount: number }[] {
  const byTime = new Map<string, { at: string; method: string; amount: number }>();
  for (const o of orders) {
    if (o.clientId !== clientId || o.deleted) continue;
    for (const p of o.payments) {
      if (!p.at || p.at <= o.at) continue;
      const row = byTime.get(p.at) ?? { at: p.at, method: TENDER_LABEL[p.method], amount: 0 };
      row.amount = roundMoney(row.amount + p.amount);
      byTime.set(p.at, row);
    }
  }
  return [...byTime.values()].sort((a, b) => b.at.localeCompare(a.at));
}

type Done = { name: string; amount: number; method: string; change: number; currency?: Currency; left: number };

/**
 * Regulars and what they owe. Bills go on a client's account from the payment
 * screen or the counter's bills; here they're paid off — all at once or a bit
 * at a time, oldest bill first — and clients are added and kept up to date.
 */
export function ClientsView() {
  const { clients, orders, removeClient } = usePos();
  // A bill opened from the account, shown in its place until closed.
  const [viewing, setViewing] = useState<number | null>(null);
  const shownOrder = viewing !== null ? orders.find((o) => o.id === viewing) ?? null : null;
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [editing, setEditing] = useState<Client | 'new' | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [error, setError] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const rows = useMemo(
    () =>
      clients
        .filter((c) => !c.archived)
        .filter((c) => !q || c.name.toLowerCase().includes(q) || (c.phone?.includes(q) ?? false))
        .map((c) => ({ client: c, owing: clientBalance(orders, c.id), bills: debtsOf(orders, c.id) }))
        // Whoever owes the most comes first; then everyone else by name.
        .sort((a, b) => b.owing - a.owing || a.client.name.localeCompare(b.client.name)),
    [clients, orders, q],
  );
  const totalOwed = roundMoney(rows.reduce((sum, r) => sum + r.owing, 0));
  const owingCount = rows.filter((r) => r.owing > 0).length;

  const selected = rows.find((r) => r.client.id === picked) ?? (editing ? null : rows[0]) ?? null;

  function select(id: string) {
    setPicked(id);
    setEditing(null);
    setDone(null);
    setError(null);
    setViewing(null);
  }

  function remove(client: Client) {
    const problem = removeClient(client.id);
    if (problem) setError(problem);
    else {
      setPicked(null);
      setEditing(null);
    }
  }

  return (
    <div className="history__body">
      <main className="history__list">
        <div className="clients__head">
          <h1 className="desk__heading">Clients</h1>
          <Button
            variant="secondary"
            onClick={() => {
              setEditing('new');
              setDone(null);
              setError(null);
            }}
          >
            New client
          </Button>
        </div>
        <p className="history__summary">
          {owingCount > 0 ? (
            <>
              <Mono>{owingCount}</Mono> {owingCount === 1 ? 'client owes' : 'clients owe'} <Money value={totalOwed} />{' '}
              in all
            </>
          ) : (
            'Nobody owes anything.'
          )}
        </p>
        <SearchField value={query} onChange={setQuery} placeholder="Name or phone" label="Find a client" />
        {rows.length === 0 ? (
          <p className="history__empty">
            {clients.some((c) => !c.archived)
              ? 'No client matches that.'
              : 'No clients yet. Add your regulars here, or straight from the payment screen when a bill goes on account.'}
          </p>
        ) : (
          rows.map(({ client, owing, bills }, i) => (
            <div key={client.id}>
              <button
                type="button"
                className={client.id === selected?.client.id && !editing ? 'order-row order-row--selected' : 'order-row'}
                onClick={() => select(client.id)}
                aria-current={client.id === selected?.client.id}
              >
                <span className="order-row__main">
                  <span className="order-row__name">{client.name}</span>
                  <span className="order-row__meta">
                    {client.phone && (
                      <>
                        <Mono>{client.phone}</Mono>
                        {owing > 0 && ' · '}
                      </>
                    )}
                    {owing > 0 && (
                      <>
                        <Mono>{bills.length}</Mono> unpaid {bills.length === 1 ? 'bill' : 'bills'} · since{' '}
                        <Mono>{when(bills[0].at)}</Mono>
                      </>
                    )}
                  </span>
                </span>
                {owing > 0 ? (
                  <StatusChip status="occupied" size="sm">
                    Owes
                  </StatusChip>
                ) : (
                  <StatusChip status="open" size="sm">
                    Clear
                  </StatusChip>
                )}
                <Money value={owing} className="order-row__amount desk__amount" />
              </button>
              {i < rows.length - 1 && <hr className="history__divider desk__divider" />}
            </div>
          ))
        )}
      </main>

      <aside className="detail" aria-label="Client">
        <ReceiptEdge />
        {shownOrder ? (
          <>
            <button type="button" className="history__clear clients__back" onClick={() => setViewing(null)}>
              ← Back to {selected?.client.name ?? 'the account'}
            </button>
            <OrderDetail key={shownOrder.id} order={shownOrder} onOpenTab={() => setViewing(null)} />
            <PrintableReceipt order={shownOrder} />
          </>
        ) : editing ? (
          <ClientForm
            key={editing === 'new' ? 'new' : editing.id}
            client={editing === 'new' ? null : editing}
            onDone={(id) => {
              setEditing(null);
              if (id) setPicked(id);
            }}
          />
        ) : done ? (
          <div className="desk__done">
            <span className="desk__done-label">{done.change > 0 ? 'Change due' : 'Paid'}</span>
            <Money
              value={done.change > 0 ? done.change : done.amount}
              currency={done.change > 0 ? done.currency : undefined}
              className="desk__done-amount"
            />
            <p className="desk__hint">
              {done.name} paid <Money value={done.amount} /> · {done.method}
              {done.left > 0 ? (
                <>
                  {' '}
                  · still owes <Money value={done.left} />
                </>
              ) : (
                ' · all paid off'
              )}
            </p>
            <Button onClick={() => setDone(null)}>Done</Button>
          </div>
        ) : selected ? (
          <ClientAccount
            key={selected.client.id}
            client={selected.client}
            owing={selected.owing}
            bills={selected.bills}
            error={error}
            onEdit={() => {
              setEditing(selected.client);
              setError(null);
            }}
            onRemove={() => remove(selected.client)}
            onShowOrder={setViewing}
            onPaid={setDone}
          />
        ) : (
          <p className="detail__placeholder">Add a client to start keeping their account.</p>
        )}
      </aside>
    </div>
  );
}

/** One client: what they owe, bill by bill, paying it off, and what they've paid. */
function ClientAccount({
  client,
  owing,
  bills,
  error,
  onEdit,
  onRemove,
  onShowOrder,
  onPaid,
}: {
  client: Client;
  owing: number;
  bills: OrderRecord[];
  error: string | null;
  onEdit: () => void;
  onRemove: () => void;
  onShowOrder: (orderId: number) => void;
  onPaid: (done: Done) => void;
}) {
  const { orders, settings, payDebt } = usePos();
  const currency = activeCurrency();
  const methods = (['cash', 'card', 'mobile'] as TenderMethod[]).filter((m) => settings.paymentMethods.includes(m));
  const rate = exchangeRate(settings);
  const local = rate ? costCurrency() : null;

  const [method, setMethod] = useState<TenderMethod>(methods[0] ?? 'cash');
  const [amountText, setAmountText] = useState('');
  const [tenderedText, setTenderedText] = useState('');
  const [ref, setRef] = useState('');
  const [cashIn, setCashIn] = useState<'sales' | 'local'>('sales');
  const [confirmRemove, setConfirmRemove] = useState(false);

  const history = useMemo(() => debtPayments(orders, client.id), [orders, client.id]);
  const paidOff = useMemo(
    () =>
      orders
        .filter((o) => o.clientId === client.id && o.status === 'paid')
        .sort((a, b) => (b.settledAt ?? b.at).localeCompare(a.settledAt ?? a.at))
        .slice(0, 5),
    [orders, client.id],
  );

  // What goes toward the debt: all of it, unless a smaller amount is typed.
  const typed = parseAmount(amountText);
  const amount = typed !== null ? Math.min(typed, owing) : owing;
  const paysLocal = method === 'cash' && local !== null && cashIn === 'local';
  const cashCurrency = paysLocal ? local! : undefined;
  const cashDue = paysLocal ? costDue(amount, rate!) : amount;
  const tendered = method === 'cash' ? (parseAmount(tenderedText, cashCurrency) ?? cashDue) : cashDue;
  const change = roundMoney(tendered - cashDue, cashCurrency);
  const valid =
    owing > 0 &&
    amount > 0 &&
    (amountText === '' || typed !== null) &&
    (method !== 'cash' || tenderedText === '' || parseAmount(tenderedText, cashCurrency) !== null) &&
    change >= 0;

  function pay() {
    if (!valid) return;
    const payment: Payment = {
      method,
      amount,
      ...(paysLocal
        ? { local: { currency: local!.code, rate: rate!, amount: cashDue, tendered } }
        : method === 'cash'
          ? { tendered }
          : {}),
      ...(ref.trim() ? { ref: ref.trim() } : {}),
    };
    const applied = payDebt(client.id, payment);
    if (applied <= 0) return;
    onPaid({
      name: client.name,
      amount: applied,
      method: paysLocal ? `${TENDER_LABEL[method]} · ${local!.symbol}` : TENDER_LABEL[method],
      change: method === 'cash' ? change : 0,
      ...(paysLocal ? { currency: local! } : {}),
      left: roundMoney(owing - applied),
    });
  }

  return (
    <>
      <div className="detail__head">
        <h2 className="detail__title">{client.name}</h2>
        <div className="detail__sub">
          {[client.phone, client.creditLimit !== undefined ? null : 'no credit limit'].filter(Boolean).join(' · ')}
          {client.creditLimit !== undefined && (
            <>
              {client.phone ? ' · ' : ''}limit <Money value={client.creditLimit} />
            </>
          )}
        </div>
        {client.note && <div className="detail__sub">{client.note}</div>}
      </div>

      <div className="detail__items">
        {bills.length === 0 && <p className="desk__hint">No unpaid bills.</p>}
        {bills.map((o) => {
          const owed = orderOwed(o);
          return (
            <button type="button" key={o.id} className="detail-line desk__charge" onClick={() => onShowOrder(o.id)}>
              <span>
                <span className="detail-line__name">
                  {o.name} · <Mono>{`#${o.id}`}</Mono>
                </span>
                <span className="detail-line__note">
                  <Mono>{when(o.at)}</Mono> · {o.lines.map((l) => `${l.qty} × ${l.name}`).join(', ')}
                  {owed < orderTotal(o) && (
                    <>
                      {' '}
                      · <Money value={orderTotal(o) - owed} /> of <Money value={orderTotal(o)} /> paid
                    </>
                  )}
                </span>
              </span>
              <Money value={owed} />
            </button>
          );
        })}
      </div>

      <div className="detail__summary">
        <SummaryRow label="Owes" value={owing} total />
        {local && owing > 0 && (
          <InCurrency currency={local}>
            <SummaryRow label={`In cash in ${local.symbol}`} value={costDue(owing, rate!)} />
          </InCurrency>
        )}
      </div>

      {owing > 0 && (
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
          <label className="desk__field">
            <span>Paying now</span>
            <span className="desk__money">
              <span className="mono" aria-hidden="true">
                {currency.symbol}
              </span>
              <input
                className="mono"
                type="text"
                inputMode={currency.decimals === 0 ? 'numeric' : 'decimal'}
                value={amountText}
                placeholder={formatAmount(owing)}
                onChange={(e) => setAmountText(e.target.value)}
              />
            </span>
            {typed !== null && typed > owing && (
              <span className="desk__change">
                Only <Money value={owing} /> is owed — that’s what will be taken.
              </span>
            )}
          </label>
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
                  placeholder={formatAmount(cashDue, cashCurrency)}
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
          <Button size="lg" block onClick={pay} disabled={!valid}>
            {amount >= owing ? 'Pay off' : 'Take'} <Money value={amount} />
            {amount < owing && ' · part payment'}
          </Button>
        </div>
      )}

      {(history.length > 0 || paidOff.length > 0) && (
        <div className="detail__items clients__history">
          <h3 className="desk__drawer-title">Payments</h3>
          {history.length === 0 && <p className="desk__hint">Nothing paid toward debts yet.</p>}
          {history.slice(0, 8).map((p) => (
            <div key={p.at} className="detail-line">
              <span>
                <span className="detail-line__name">{p.method}</span>
                <span className="detail-line__note">
                  <Mono>{when(p.at)}</Mono>
                </span>
              </span>
              <Money value={p.amount} />
            </div>
          ))}
          {paidOff.length > 0 && (
            <p className="desk__hint">
              Paid off lately:{' '}
              {paidOff.map((o, i) => (
                <span key={o.id}>
                  {i > 0 && ', '}
                  <button type="button" className="history__clear" onClick={() => onShowOrder(o.id)}>
                    <Mono>{`#${o.id}`}</Mono>
                  </button>
                </span>
              ))}
            </p>
          )}
        </div>
      )}

      <div className="desk__actions">
        {error && (
          <p className="desk__hint desk__hint--warn" role="alert">
            {error}
          </p>
        )}
        <div className="desk__row">
          <Button variant="secondary" onClick={onEdit}>
            Edit details
          </Button>
          <Button
            variant="secondary"
            onClick={() => (confirmRemove ? onRemove() : setConfirmRemove(true))}
            onBlur={() => setConfirmRemove(false)}
            disabled={owing > 0}
            title={owing > 0 ? 'They still owe — settle their account first.' : undefined}
          >
            {confirmRemove ? 'Confirm — remove' : 'Remove client'}
          </Button>
        </div>
      </div>
    </>
  );
}

/** Adding a client, or changing one's details. */
function ClientForm({ client, onDone }: { client: Client | null; onDone: (id?: string) => void }) {
  const { saveClient } = usePos();
  const currency = activeCurrency();
  const [name, setName] = useState(client?.name ?? '');
  const [phone, setPhone] = useState(client?.phone ?? '');
  const [note, setNote] = useState(client?.note ?? '');
  const [limitText, setLimitText] = useState(client?.creditLimit !== undefined ? String(client.creditLimit) : '');

  const limit = limitText.trim() === '' ? undefined : parseAmount(limitText);
  const valid = name.trim() !== '' && limit !== null;

  function save() {
    if (!valid) return;
    const saved = saveClient({
      ...(client ? { id: client.id } : {}),
      name,
      phone,
      note,
      creditLimit: limit ?? undefined,
    });
    onDone(saved.id);
  }

  return (
    <>
      <div className="detail__head">
        <h2 className="detail__title">{client ? `Edit ${client.name}` : 'New client'}</h2>
        <div className="detail__sub">A regular who can put bills on their account.</div>
      </div>
      <form
        className="desk__actions"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label className="desk__field">
          <span>Name</span>
          <input
            className="desk__input"
            type="text"
            value={name}
            maxLength={60}
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="desk__field">
          <span>Phone</span>
          <input
            className="desk__input mono"
            type="tel"
            value={phone}
            maxLength={20}
            placeholder="optional"
            onChange={(e) => setPhone(e.target.value)}
          />
        </label>
        <label className="desk__field">
          <span>Credit limit</span>
          <span className="desk__money">
            <span className="mono" aria-hidden="true">
              {currency.symbol}
            </span>
            <input
              className="mono"
              type="text"
              inputMode={currency.decimals === 0 ? 'numeric' : 'decimal'}
              value={limitText}
              placeholder="no limit"
              aria-invalid={limit === null}
              onChange={(e) => setLimitText(e.target.value)}
            />
          </span>
          <span className="desk__change">The most they can owe at once. Leave blank for no limit.</span>
        </label>
        <label className="desk__field">
          <span>Note</span>
          <input
            className="desk__input"
            type="text"
            value={note}
            maxLength={120}
            placeholder="optional — where they work, who vouches for them"
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <div className="desk__row">
          <Button variant="secondary" onClick={() => onDone()}>
            Cancel
          </Button>
          <Button type="submit" disabled={!valid}>
            {client ? 'Save' : 'Add client'}
          </Button>
        </div>
      </form>
    </>
  );
}
