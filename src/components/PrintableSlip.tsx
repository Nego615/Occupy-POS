import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './PrintableReceipt.css';
import { formatMoney } from './Mono';
import { TENDER_METHODS, type CashUp } from '../data/cashup';
import {
  TENDER_LABEL,
  orderDiscount,
  orderSubtotal,
  orderTotal,
  paidAmount,
  type Order,
  type OrderRecord,
} from '../data/orders';
import { stationLabel } from '../data/settings';
import { usePos } from '../lib/store';

/**
 * Receipt-tape printouts: the register's dockets, and what the front desk
 * hands over or files — a room's bill and a shift's cash-up. Same portal and print styles as PrintableReceipt, so
 * whichever one is on the page is the only thing that prints.
 */
/** `brand` off leaves out the logo and shop name — a kitchen docket is for the kitchen, not the guest. */
function Slip({ head, children, brand = true }: { head: ReactNode; children: ReactNode; brand?: boolean }) {
  const { settings } = usePos();
  return createPortal(
    <div className="print-receipt">
      {brand && settings.logo && <img className="print-receipt__logo" src={settings.logo} alt="" />}
      {brand && <div className="print-receipt__brand">{settings.businessName}</div>}
      {brand && <div className="print-receipt__station">{stationLabel(settings)}</div>}
      <div className="print-receipt__head">{head}</div>
      {children}
      <div className="print-receipt__foot">
        Printed <span className="mono">{new Date().toLocaleString('en-US')}</span>
      </div>
    </div>,
    document.body,
  );
}

function Row({ label, value, total = false }: { label: ReactNode; value: number; total?: boolean }) {
  return (
    <div className={total ? 'print-receipt__row print-receipt__total' : 'print-receipt__row'}>
      <span>{label}</span>
      <span className="mono">{formatMoney(value)}</span>
    </div>
  );
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export type DocketKind = 'bill' | 'kitchen';

/**
 * A tab printed from the register before it's paid. The `bill` docket has
 * prices and the total, to take to the front desk; the `kitchen` docket has
 * only what to make.
 */
export function PrintableDocket({ order, kind }: { order: Order; kind: DocketKind }) {
  const { me } = usePos();
  const discount = orderDiscount(order);
  const paid = paidAmount(order.payments);
  const kitchen = kind === 'kitchen';
  return (
    <Slip
      brand={!kitchen}
      head={
        <>
          <div className={kitchen ? 'print-receipt__brand' : undefined}>{order.name}</div>
          <div>
            {kitchen ? 'Kitchen docket' : 'Order docket'} · <span className="mono">#{order.id}</span>
          </div>
          <div>
            Opened <span className="mono">{order.time}</span>
          </div>
          {me && <div>Served by {me.name}</div>}
        </>
      }
    >
      <div className="print-receipt__lines">
        {order.lines.map((line, i) => (
          <div key={i}>
            <div className="print-receipt__row">
              <span>
                {kitchen && <span className="mono">{line.qty} × </span>}
                {line.name}
                {!kitchen && <span className="mono print-receipt__qty">× {line.qty}</span>}
              </span>
              {!kitchen && <span className="mono">{formatMoney(line.unitPrice * line.qty)}</span>}
            </div>
            {line.parts?.map((part, j) => (
              <div className="print-receipt__part" key={j}>
                {part}
              </div>
            ))}
            {!kitchen && line.promo && <div className="print-receipt__part">{line.promo}</div>}
            {line.note && <div className="print-receipt__part">“{line.note}”</div>}
          </div>
        ))}
      </div>
      {!kitchen && (
        <div className="print-receipt__totals">
          <Row label="Subtotal" value={orderSubtotal(order) + discount} />
          {discount > 0 && (
            <Row label={`Discounts${order.discountLabel ? ` · ${order.discountLabel}` : ''}`} value={-discount} />
          )}
          <Row label="Tax" value={order.tax} />
          <Row label="Total" value={orderTotal(order)} total />
          {paid > 0 && <Row label="Paid so far" value={-paid} />}
          {paid > 0 && <Row label="Left to pay" value={orderTotal(order) - paid} total />}
          <div className="print-receipt__part">Not paid — please pay at the front desk.</div>
        </div>
      )}
    </Slip>
  );
}

/** Everything charged to a room, one line per bill, and how it was paid if it has been. */
export function PrintableFolio({
  room,
  orders,
  paid,
}: {
  room: string;
  orders: OrderRecord[];
  /** How the room settled up, once it has. */
  paid?: { method: string; tendered?: number; change?: number };
}) {
  const total = orders.reduce((sum, o) => sum + orderTotal(o), 0);
  return (
    <Slip
      head={
        <>
          <div>{room} · room bill</div>
          <div>
            <span className="mono">{orders.length}</span> {orders.length === 1 ? 'charge' : 'charges'}
          </div>
          {!paid && <div>Not yet paid</div>}
        </>
      }
    >
      <div className="print-receipt__lines">
        {orders.map((o) => (
          <Row
            key={o.id}
            label={
              <>
                <span className="mono">#{o.id}</span> · {when(o.at)}
              </>
            }
            value={orderTotal(o)}
          />
        ))}
      </div>
      <div className="print-receipt__totals">
        <Row label="Total" value={total} total />
        {paid && <Row label={paid.method} value={paid.tendered ?? total} />}
        {paid?.change ? <Row label="Change" value={paid.change} /> : null}
      </div>
    </Slip>
  );
}

/** A closed shift: money in and out by method, and the drawer count. */
export function PrintableCashUp({ cashUp }: { cashUp: CashUp }) {
  const { allStaff } = usePos();
  const by = allStaff.find((m) => m.id === cashUp.by)?.name;
  const variance = cashUp.countedCash - cashUp.expectedCash;
  return (
    <Slip
      head={
        <>
          <div>Shift cash-up</div>
          <div>
            {when(cashUp.openedAt)} – {when(cashUp.closedAt)}
          </div>
          {by && <div>Closed by {by}</div>}
          <div>
            <span className="mono">{cashUp.payments}</span> payments
          </div>
        </>
      }
    >
      <div className="print-receipt__lines">
        {TENDER_METHODS.map((m) => (
          <Row key={m} label={TENDER_LABEL[m]} value={cashUp.taken[m] - cashUp.refunded[m]} />
        ))}
        <Row
          label="Taken, less refunds"
          value={TENDER_METHODS.reduce((sum, m) => sum + cashUp.taken[m] - cashUp.refunded[m], 0)}
          total
        />
      </div>
      <div className="print-receipt__totals">
        <Row label="Opening float" value={cashUp.float} />
        <Row label="Cash expected" value={cashUp.expectedCash} />
        <Row label="Cash counted" value={cashUp.countedCash} />
        <Row label={variance < 0 ? 'Short' : variance > 0 ? 'Over' : 'Balanced'} value={Math.abs(variance)} total />
        {cashUp.note && <div className="print-receipt__part">{cashUp.note}</div>}
      </div>
    </Slip>
  );
}
