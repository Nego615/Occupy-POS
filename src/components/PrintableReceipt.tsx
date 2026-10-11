import { createPortal } from 'react-dom';
import './PrintableReceipt.css';
import { formatMoney } from './Mono';
import { lineContents } from '../data/catalog';
import {
  changeGiven,
  localChange,
  orderDiscount,
  orderSubtotal,
  orderTotal,
  tenderLabel,
  type Order,
} from '../data/orders';
import { stationLabel } from '../data/settings';
import { currencyOf, formatAmount, formatCurrency } from '../lib/currency';
import { receiptCurrency } from '../lib/currencySwitch';
import { usePos } from '../lib/store';

/**
 * The paper receipt. Rendered into <body> via a portal so print CSS can hide
 * the whole app and leave just this — no separate print window, no duplicated
 * order data.
 */
export function PrintableReceipt({ order: given }: { order: Order }) {
  const { settings, allStaff: staff, locations } = usePos();
  // An order from before the shop switched currencies prints as it was taken.
  const order = given.recordedIn?.original ?? given;
  const currency = receiptCurrency(given);
  const money = (value: number) => formatMoney(value, currency);
  const room = order.roomId ? locations.find((l) => l.id === order.roomId)?.name ?? 'room' : null;
  const discount = orderDiscount(order);
  const change = changeGiven(order.payments);
  // Cash taken in the cost currency, and its change — all in that currency.
  const localCash = order.payments.find((p) => p.local)?.local;
  const changeLocal = localChange(order.payments);
  const cashier = staff.find((m) => m.id === order.staffId)?.name;
  return createPortal(
    <div className="print-receipt">
      {settings.logo && <img className="print-receipt__logo" src={settings.logo} alt="" />}
      <div className="print-receipt__brand">{settings.businessName}</div>
      <div className="print-receipt__station">{stationLabel(settings)}</div>

      <div className="print-receipt__head">
        <div>
          {order.name} · <span className="mono">#{order.id}</span>
        </div>
        <div>
          {order.status === 'occupied' ? 'Opened' : 'Closed'}{' '}
          <span className="mono">{order.time}</span>
        </div>
        {cashier && <div>Served by {cashier}</div>}
        {order.status === 'charged' && <div>Charged to {room}</div>}
        {order.status === 'paid' && room && <div>Settled with {room}</div>}
        {order.payments.length === 0 && order.status !== 'charged' && <div>Not yet tendered</div>}
        {order.status === 'refunded' && <div>REFUNDED</div>}
      </div>

      <div className="print-receipt__lines">
        {order.lines.map((line, i) => (
          <div key={i}>
            <div className="print-receipt__row">
              <span>
                {line.name}
                <span className="mono print-receipt__qty">× {line.qty}</span>
              </span>
              <span className="mono">{money(line.unitPrice * line.qty)}</span>
            </div>
            {lineContents(line).map((part, j) => (
              <div className="print-receipt__part" key={j}>
                {part}
              </div>
            ))}
            {line.promo && <div className="print-receipt__part">{line.promo}</div>}
            {line.note && <div className="print-receipt__part">“{line.note}”</div>}
          </div>
        ))}
      </div>

      <div className="print-receipt__totals">
        <div className="print-receipt__row">
          <span>Subtotal</span>
          <span className="mono">{money(orderSubtotal(order) + discount)}</span>
        </div>
        {discount > 0 && (
          <div className="print-receipt__row">
            <span>Discounts{order.discountLabel ? ` · ${order.discountLabel}` : ''}</span>
            <span className="mono">{money(-discount)}</span>
          </div>
        )}
        <div className="print-receipt__row">
          <span>Tax</span>
          <span className="mono">{money(order.tax)}</span>
        </div>
        {(settings.tipsEnabled || order.tip > 0) && (
          <div className="print-receipt__row">
            <span>Tip</span>
            <span className="mono">{money(order.tip)}</span>
          </div>
        )}
        <div className="print-receipt__row print-receipt__total">
          <span>Total</span>
          <span className="mono">{money(orderTotal(order))}</span>
        </div>
        {order.payments.map((p, i) => (
          <div className="print-receipt__row" key={`pay-${i}`}>
            <span>
              {tenderLabel(p)}
              {p.local ? ` @ ${formatAmount(p.local.rate, currencyOf(p.local.currency))}` : ''}
              {p.ref ? ` ·${p.ref}` : ''}
            </span>
            <span className="mono">
              {p.local ? formatCurrency(p.local.tendered, currencyOf(p.local.currency)) : money(p.tendered ?? p.amount)}
            </span>
          </div>
        ))}
        {change > 0 && (
          <div className="print-receipt__row">
            <span>Change</span>
            <span className="mono">{money(change)}</span>
          </div>
        )}
        {localCash && changeLocal > 0 && (
          <div className="print-receipt__row">
            <span>Change</span>
            <span className="mono">{formatCurrency(changeLocal, currencyOf(localCash.currency))}</span>
          </div>
        )}
        {(order.refunds ?? []).map((r) => (
          <div className="print-receipt__row" key={r.id}>
            <span>Refund · {r.reason}</span>
            <span className="mono">{money(-r.amount)}</span>
          </div>
        ))}
      </div>

      <div className="print-receipt__foot">
        {settings.receiptFooter && (
          <>
            {settings.receiptFooter}
            <br />
          </>
        )}
        Reprinted <span className="mono">{new Date().toLocaleString('en-US')}</span>
      </div>
    </div>,
    document.body,
  );
}
