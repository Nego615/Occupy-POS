import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import './Tender.css';
import { Button } from '../components/Button';
import { Money, Mono } from '../components/Mono';
import { PrintableReceipt } from '../components/PrintableReceipt';
import { ReceiptEdge } from '../components/Receipt';
import { StatusChip } from '../components/StatusChip';
import { TENDER_LABEL, changeGiven, paidAmount, type Payment, type TenderMethod } from '../data/orders';
import { PAYMENT_METHODS } from '../data/settings';
import { round } from '../lib/cart';
import { activeCurrency, isAmountText } from '../lib/currency';
import { usePos } from '../lib/store';
import { quickCash } from '../lib/tender';
import { formatTime } from '../lib/useClock';

type TipChoice = { kind: 'preset'; pct: number } | { kind: 'custom' } | { kind: 'none' };

/** What the confirmation screen shows, captured at the moment the bill is settled. */
type Charged = {
  tab: string;
  orderId: number;
  total: number;
  method: string;
  /** Cash to hand back. */
  change: number;
  at: string;
};

const TENDER_ICON: Record<TenderMethod, string> = Object.fromEntries(
  PAYMENT_METHODS.map((m) => [m.id, m.icon]),
) as Record<TenderMethod, string>;

/** Parses typed money, or null when it isn't a valid amount. Blank is null too. */
function parseAmount(text: string): number | null {
  const t = text.trim().replace(/,/g, '');
  if (!t || !isAmountText(t)) return null;
  return round(Number.parseFloat(t));
}

export function Tender() {
  const navigate = useNavigate();
  const { tab, cart, totals, takePayment, removePayment, settings } = usePos();
  const { tipsEnabled, tipPresets, defaultTip } = settings;
  const currency = activeCurrency();
  // Only the methods Settings accepts, in their usual order.
  const methods = (['card', 'cash', 'mobile'] as TenderMethod[]).filter((m) =>
    settings.paymentMethods.includes(m),
  );
  const canSplit = settings.paymentMethods.includes('split');

  const [tip, setTip] = useState<TipChoice>(() =>
    tipsEnabled && defaultTip !== null
      ? { kind: 'preset', pct: tipPresets[defaultTip] }
      : { kind: 'none' },
  );
  const [customTip, setCustomTip] = useState('');
  const [method, setMethod] = useState<TenderMethod>(methods[0] ?? 'cash');
  const [amountText, setAmountText] = useState('');
  const [tenderedText, setTenderedText] = useState('');
  const [ref, setRef] = useState('');
  const [byItem, setByItem] = useState<Set<string> | null>(null);
  const [charged, setCharged] = useState<Charged | null>(null);

  const amountDue = totals.total;
  const customValid = customTip === '' || isAmountText(customTip);
  const chosenTip =
    !tipsEnabled || tip.kind === 'none'
      ? 0
      : tip.kind === 'preset'
        ? round(amountDue * tip.pct)
        : customValid
          ? round(Number.parseFloat(customTip) || 0)
          : 0;
  // Once part of the bill is paid, its tip is settled.
  const tipLocked = tab.tip !== undefined;
  const tipAmount = tab.tip ?? chosenTip;
  const total = round(amountDue + tipAmount);
  const paid = paidAmount(tab.payments);
  const remaining = Math.max(0, round(total - paid));

  // The share of the bill the ticked lines come to, tax and tip included.
  const byItemAmount = useMemo(() => {
    if (!byItem || totals.subtotal + totals.orderDiscount === 0) return null;
    const lines = cart.filter((l) => byItem.has(l.key));
    const share = lines.reduce((sum, l) => sum + l.unitPrice * l.qty, 0) / (totals.subtotal + totals.orderDiscount);
    return round(Math.min(remaining, total * share));
  }, [byItem, cart, totals, total, remaining]);

  // What this payment puts toward the bill: all that's left, unless splitting.
  const typedAmount = parseAmount(amountText);
  const amount = !canSplit
    ? remaining
    : byItemAmount !== null
      ? byItemAmount
      : typedAmount !== null
        ? Math.min(typedAmount, remaining)
        : remaining;
  const tendered = method === 'cash' ? (parseAmount(tenderedText) ?? amount) : amount;
  const change = round(tendered - amount);
  const amountValid =
    amount > 0 &&
    (amountText === '' || typedAmount !== null) &&
    (method !== 'cash' || (tenderedText === '' ? true : parseAmount(tenderedText) !== null)) &&
    change >= 0;
  const finishes = amount >= remaining;

  // A fresh payment starts from what's left.
  function resetEntry() {
    setAmountText('');
    setTenderedText('');
    setRef('');
    setByItem(null);
  }

  function take() {
    if (!amountValid) return;
    const payment: Payment = {
      method,
      amount,
      ...(method === 'cash' ? { tendered } : {}),
      ...(ref.trim() ? { ref: ref.trim() } : {}),
    };
    const all = [...tab.payments, payment];
    const snapshot: Charged = {
      tab: tab.name,
      orderId: tab.orderId,
      total,
      method:
        all.length === 1
          ? TENDER_LABEL[method]
          : `Split · ${[...new Set(all.map((p) => TENDER_LABEL[p.method]))].join(' + ')}`,
      change: changeGiven(all),
      at: formatTime(new Date()),
    };
    const closed = takePayment(payment, chosenTip);
    if (closed !== null) setCharged(snapshot);
    resetEntry();
  }

  if (charged) {
    return (
      <ChargedConfirmation
        charged={charged}
        onNextTab={() => navigate('/counter/register')}
        onViewHistory={() => navigate('/counter/history')}
      />
    );
  }

  if (cart.length === 0) {
    return (
      <div className="tender">
        <header className="tender__bar">
          <div className="tender__bar-left">
            <button
              type="button"
              className="tender__close"
              onClick={() => navigate('/counter/register')}
              aria-label="Close and return to register"
            >
              <span aria-hidden="true">×</span>
            </button>
            <div className="tender__title">Nothing to charge</div>
          </div>
          <StatusChip status="open">Tab open</StatusChip>
        </header>
        <div className="tender__center">
          <ReceiptEdge inverted className="tender__edge" />
          <div className="tender__card tender__done">
            <p className="tender__done-sub">
              This tab is empty — add items on the register to charge it.
            </p>
            <Button size="lg" block onClick={() => navigate('/counter/register')}>
              Back to register
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const evenSplits = [2, 3, 4].filter((n) => total / n <= remaining + 0.001);

  return (
    <div className="tender">
      <header className="tender__bar">
        <div className="tender__bar-left">
          <button
            type="button"
            className="tender__close"
            onClick={() => navigate('/counter/register')}
            aria-label="Close and return to register"
          >
            <span aria-hidden="true">×</span>
          </button>
          <div className="tender__title">
            {tab.name} · <Mono>{`#${tab.orderId}`}</Mono>
          </div>
        </div>
        <StatusChip status="occupied">{paid > 0 ? 'Part paid' : 'Awaiting payment'}</StatusChip>
      </header>

      <div className="tender__center">
        <ReceiptEdge inverted className="tender__edge" />
        <div className="tender__card">
          <span className="tender__total-label">{paid > 0 ? 'Left to pay' : 'Amount due'}</span>
          <Money value={paid > 0 ? remaining : amountDue} className="tender__total-amount" />

          {tipsEnabled && !tipLocked && (
            <div className="tip-row" role="group" aria-label="Tip">
              {tipPresets.map((pct) => {
                const active = tip.kind === 'preset' && tip.pct === pct;
                return (
                  <button
                    key={pct}
                    type="button"
                    className={active ? 'tip-pill tip-pill--active' : 'tip-pill'}
                    onClick={() => setTip({ kind: 'preset', pct })}
                    aria-pressed={active}
                  >
                    <Mono className="tip-pill__pct">{`${Math.round(pct * 100)}%`}</Mono>
                    <Money value={round(amountDue * pct)} className="tip-pill__amt" />
                  </button>
                );
              })}
              <button
                type="button"
                className={tip.kind === 'custom' ? 'tip-pill tip-pill--active' : 'tip-pill'}
                onClick={() => setTip({ kind: 'custom' })}
                aria-pressed={tip.kind === 'custom'}
              >
                <span className="tip-pill__pct">Custom</span>
                <span className="tip-pill__amt">enter amount</span>
              </button>
              <button
                type="button"
                className={
                  tip.kind === 'none'
                    ? 'tip-pill tip-pill--wide tip-pill--active'
                    : 'tip-pill tip-pill--wide'
                }
                onClick={() => setTip({ kind: 'none' })}
                aria-pressed={tip.kind === 'none'}
              >
                <span className="tip-pill__pct">No tip</span>
              </button>
            </div>
          )}

          {tipsEnabled && !tipLocked && tip.kind === 'custom' && (
            <div className="tender__custom">
              <label htmlFor="custom-tip">Custom tip</label>
              <span className="tender__custom-symbol mono" aria-hidden="true">
                {currency.symbol}
              </span>
              <input
                id="custom-tip"
                className="mono"
                type="text"
                inputMode={currency.decimals === 0 ? 'numeric' : 'decimal'}
                value={customTip}
                onChange={(e) => setCustomTip(e.target.value)}
                placeholder={(0).toFixed(currency.decimals)}
                autoFocus
              />
            </div>
          )}

          <div className="tender__new-total">
            <span className="label">
              {!tipsEnabled || tipAmount === 0 ? 'Total' : 'Total with tip'}
            </span>
            <Money value={total} className="value" />
          </div>

          {tab.payments.length > 0 && (
            <ul className="tender__paid" aria-label="Payments taken">
              {tab.payments.map((p, i) => (
                <li key={i} className="tender__paid-row">
                  <span>
                    {TENDER_LABEL[p.method]}
                    {p.ref && <Mono className="tender__paid-ref"> ·{p.ref}</Mono>}
                  </span>
                  <Money value={p.amount} />
                  <button
                    type="button"
                    className="tender__paid-remove"
                    onClick={() => removePayment(i)}
                    aria-label={`Take back ${TENDER_LABEL[p.method]} payment`}
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="method-row" role="group" aria-label="Payment method">
            {methods.map((m) => (
              <button
                key={m}
                type="button"
                className={m === method ? 'method method--active' : 'method'}
                onClick={() => {
                  setMethod(m);
                  setTenderedText('');
                  setRef('');
                }}
                aria-pressed={m === method}
              >
                <span className="method__icon" aria-hidden="true">
                  {TENDER_ICON[m]}
                </span>
                {TENDER_LABEL[m]}
              </button>
            ))}
          </div>

          {canSplit && (
            <div className="tender__split">
              <div className="tender__split-row" role="group" aria-label="Split the bill">
                {evenSplits.map((n) => (
                  <button
                    key={n}
                    type="button"
                    className="tender__chip"
                    onClick={() => {
                      setByItem(null);
                      setAmountText(String(round(Math.min(remaining, total / n))));
                    }}
                  >
                    ÷ {n}
                  </button>
                ))}
                <button
                  type="button"
                  className={byItem ? 'tender__chip tender__chip--active' : 'tender__chip'}
                  aria-pressed={byItem !== null}
                  onClick={() => {
                    setAmountText('');
                    setByItem(byItem ? null : new Set());
                  }}
                >
                  By item
                </button>
              </div>

              {byItem && (
                <ul className="tender__items" aria-label="Items this payment covers">
                  {cart.map((line) => (
                    <li key={line.key}>
                      <label className="tender__item">
                        <input
                          type="checkbox"
                          checked={byItem.has(line.key)}
                          onChange={(e) => {
                            const next = new Set(byItem);
                            if (e.target.checked) next.add(line.key);
                            else next.delete(line.key);
                            setByItem(next);
                          }}
                        />
                        <span>
                          {line.qty} × {line.name}
                        </span>
                        <Money value={line.unitPrice * line.qty} />
                      </label>
                    </li>
                  ))}
                </ul>
              )}

              {!byItem && (
                <AmountInput
                  id="pay-amount"
                  label="This payment"
                  value={amountText}
                  onChange={setAmountText}
                  placeholder={String(remaining)}
                />
              )}
            </div>
          )}

          {method === 'cash' && (
            <div className="tender__cash">
              <AmountInput
                id="cash-tendered"
                label="Cash received"
                value={tenderedText}
                onChange={setTenderedText}
                placeholder={String(amount)}
              />
              <div className="tender__split-row" role="group" aria-label="Quick cash">
                <button type="button" className="tender__chip" onClick={() => setTenderedText(String(amount))}>
                  Exact
                </button>
                {quickCash(amount, currency.decimals).map((v) => (
                  <button key={v} type="button" className="tender__chip" onClick={() => setTenderedText(String(v))}>
                    <Money value={v} />
                  </button>
                ))}
              </div>
              <div className={change < 0 ? 'tender__change tender__change--short' : 'tender__change'}>
                <span>{change < 0 ? 'Short by' : 'Change due'}</span>
                <Money value={Math.abs(change)} />
              </div>
            </div>
          )}

          {method !== 'cash' && (
            <div className="tender__custom tender__ref">
              <label htmlFor="pay-ref">
                {method === 'card' ? 'Card last 4 / approval' : 'Transaction ID'}
              </label>
              <input
                id="pay-ref"
                className="mono"
                type="text"
                value={ref}
                maxLength={24}
                onChange={(e) => setRef(e.target.value.toUpperCase())}
                placeholder="optional"
              />
            </div>
          )}
        </div>
      </div>

      <div className="tender__footer">
        <Button size="lg" className="tender__charge" onClick={take} disabled={!amountValid}>
          {finishes ? 'Charge' : 'Take'} <Money value={amount} />
          {!finishes && ' · part payment'}
        </Button>
        <button
          type="button"
          className="tender__cancel"
          onClick={() => navigate('/counter/register')}
        >
          {paid > 0 ? 'Back to register — payments so far stay on the tab' : 'Cancel and return to register'}
        </button>
      </div>
    </div>
  );
}

function AmountInput({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const currency = activeCurrency();
  return (
    <div className="tender__custom">
      <label htmlFor={id}>{label}</label>
      <span className="tender__custom-symbol mono" aria-hidden="true">
        {currency.symbol}
      </span>
      <input
        id={id}
        className="mono tender__amount"
        type="text"
        inputMode={currency.decimals === 0 ? 'numeric' : 'decimal'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

function ChargedConfirmation({
  charged,
  onNextTab,
  onViewHistory,
}: {
  charged: Charged;
  onNextTab: () => void;
  onViewHistory: () => void;
}) {
  const { orders, settings } = usePos();
  const order = orders.find((o) => o.id === charged.orderId && o.status !== 'occupied');

  // Once per payment — the ref keeps StrictMode's double effect from printing twice.
  const autoPrinted = useRef(false);
  useEffect(() => {
    if (!order || !settings.autoPrintReceipt || autoPrinted.current) return;
    autoPrinted.current = true;
    window.print();
  }, [order, settings.autoPrintReceipt]);

  return (
    <div className="tender">
      <header className="tender__bar">
        <div className="tender__bar-left">
          <div className="tender__title">
            {charged.tab} · <Mono>{`#${charged.orderId}`}</Mono>
          </div>
        </div>
        <StatusChip status="open">Paid</StatusChip>
      </header>

      <div className="tender__center">
        <ReceiptEdge inverted className="tender__edge" />
        <div className="tender__card tender__done">
          {charged.change > 0 ? (
            <>
              <span className="tender__total-label">Change due</span>
              <Money value={charged.change} className="tender__done-amount" />
              <p className="tender__done-sub">
                Charged <Money value={charged.total} /> · {charged.method} · closed at{' '}
                <Mono>{charged.at}</Mono>
              </p>
            </>
          ) : (
            <>
              <span className="tender__total-label">Charged</span>
              <Money value={charged.total} className="tender__done-amount" />
              <p className="tender__done-sub">
                {charged.method} · {charged.tab} closed at <Mono>{charged.at}</Mono>
              </p>
            </>
          )}
          <div className="tender__done-actions">
            <Button size="lg" block onClick={onNextTab}>
              Start next tab
            </Button>
            {order && (
              <Button variant="secondary" block onClick={() => window.print()}>
                Print receipt
              </Button>
            )}
            <Button variant="secondary" block onClick={onViewHistory}>
              View in order history
            </Button>
          </div>
        </div>
      </div>

      {/* Off-screen until Print receipt fires window.print(). */}
      {order && <PrintableReceipt order={order} />}
    </div>
  );
}
