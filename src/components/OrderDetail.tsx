import { useState } from 'react';
import './OrderDetail.css';
import { ApprovalDialog } from './ApprovalDialog';
import { Button } from './Button';
import { Money, Mono, formatMoney } from './Mono';
import { SummaryRow } from './Receipt';
import { StatusChip, type StatusKind } from './StatusChip';
import { Stepper } from './Stepper';
import {
  REFUND_REASONS,
  TENDER_LABEL,
  changeGiven,
  orderDiscount,
  orderItems,
  orderSubtotal,
  orderTotal,
  orderTypeLabel,
  refundValue,
  refundedAmount,
  refundedQty,
  type Order,
  type OrderStatus,
} from '../data/orders';
import { usePos } from '../lib/store';

/** An order's `paid` maps onto the shared chip's `open` (success) styling. */
export const ORDER_CHIP: Record<OrderStatus, { status: StatusKind; label: string }> = {
  paid: { status: 'open', label: 'Paid' },
  occupied: { status: 'occupied', label: 'Occupied' },
  refunded: { status: 'refunded', label: 'Refunded' },
};

export type OrderDetailProps = {
  order: Order;
  /** Replaces the bare time in the subline, e.g. "Yesterday · 4:38 PM". */
  when?: string;
  /** Puts a still-open tab back on the register. */
  onOpenTab: () => void;
  /** `h1` where the receipt is the page's main heading (the counter). */
  headingLevel?: 'h1' | 'h2';
};

/**
 * One order as a receipt — header, lines, totals, payments, and the actions
 * that apply to its state. The column around it belongs to the page, so the
 * counter and the admin can frame it differently.
 *
 * Refunds are gated here, once, for every screen that shows a receipt: staff
 * whose role can refund go straight through; anyone else gets a manager to
 * approve with their PIN. Either way the order records who okayed it.
 *
 * Pages key this by order id, so a half-built refund never carries over to a
 * different order.
 */
export function OrderDetail({
  order,
  when,
  onOpenTab,
  headingLevel: Heading = 'h2',
}: OrderDetailProps) {
  const { me, can, allStaff: staff, catalog, settings, refundOrder } = usePos();
  // Units to refund per line index, while the refund panel is open.
  const [refunding, setRefunding] = useState<Map<number, number> | null>(null);
  const [reason, setReason] = useState<string>(REFUND_REASONS[0]);
  // Off by default: a refunded latte can't go back on the shelf, a tumbler can.
  const [restock, setRestock] = useState(false);
  const [approving, setApproving] = useState(false);

  const discount = orderDiscount(order);
  const chip = ORDER_CHIP[order.status];
  const closedLabel = order.status === 'occupied' ? 'Opened' : 'Closed';
  const canRefund = can('refunds');
  const nameOf = (id?: string) => (id ? staff.find((m) => m.id === id)?.name : undefined);
  const refundedBy = nameOf(order.refundedBy);
  const cashier = nameOf(order.staffId);
  const alreadyRefunded = refundedAmount(order);
  const change = changeGiven(order.payments);

  const remaining = (index: number) => order.lines[index].qty - refundedQty(order, index);
  const picked = refunding
    ? [...refunding].filter(([, qty]) => qty > 0).map(([index, qty]) => ({ index, qty }))
    : [];
  const preview = refundValue(order, picked);
  const isFull =
    refunding !== null && order.lines.every((_, i) => (refunding.get(i) ?? 0) === remaining(i));
  // The tip goes back only when the last of the order does.
  const refundTotal = isFull ? preview.amount + order.tip : preview.amount;
  const restockable = orderItems(order, (i) => refunding?.get(i) ?? 0).filter((l) =>
    catalog.some((c) => (l.itemId ? c.id === l.itemId : c.name === l.name)),
  );

  function startRefund() {
    // Everything left is selected to start — the usual case is a full refund.
    setRefunding(new Map(order.lines.map((_, i) => [i, remaining(i)])));
  }

  function issue(byStaffId: string) {
    refundOrder(order.id, byStaffId, { lines: picked, reason, restock: restock && restockable.length > 0 });
    setRefunding(null);
    setRestock(false);
  }

  function onConfirm() {
    if (picked.length === 0) return;
    if (!canRefund) setApproving(true);
    else if (me) issue(me.id);
  }

  return (
    <>
      <div className="detail__head">
        <Heading className="detail__title">
          {order.name} · <Mono>{`#${order.id}`}</Mono>
        </Heading>
        <div className="detail__sub">
          {closedLabel} <Mono>{when ?? order.time}</Mono>
          {order.method ? ` · ${order.method}` : ' · Not yet tendered'}
          {order.orderType && ` · ${orderTypeLabel(order.orderType)}`}
          {cashier && ` · ${cashier}`}
        </div>
        <div className="detail__status">
          <StatusChip status={chip.status}>{chip.label}</StatusChip>
          {refundedBy && <span className="detail__by">by {refundedBy}</span>}
          {order.status === 'paid' && alreadyRefunded > 0 && (
            <span className="detail__by">
              <Money value={alreadyRefunded} /> refunded
            </span>
          )}
        </div>
      </div>

      <div className="detail__items">
        {order.lines.map((line, i) => {
          const back = refundedQty(order, i);
          const left = remaining(i);
          const notes = [line.parts?.join(' · '), line.promo, line.note && `“${line.note}”`].filter(Boolean);
          return (
            <div className="detail-line" key={i}>
              <span>
                <span className="detail-line__name">
                  {line.name}
                  <Mono className="detail-line__qty">{`× ${line.qty}`}</Mono>
                </span>
                {notes.length > 0 && <span className="detail-line__note">{notes.join(' · ')}</span>}
                {back > 0 && order.status === 'paid' && (
                  <span className="detail-line__note detail-line__note--refund">
                    <Mono>{back}</Mono> refunded
                  </span>
                )}
              </span>
              {refunding && left > 0 ? (
                <Stepper
                  value={refunding.get(i) ?? 0}
                  onChange={(qty) => setRefunding(new Map(refunding).set(i, qty))}
                  label={`Refund ${line.name}`}
                  min={0}
                  max={left}
                />
              ) : (
                <Money value={line.unitPrice * line.qty} />
              )}
            </div>
          );
        })}
      </div>

      <div className="detail__summary">
        <SummaryRow label="Subtotal" value={orderSubtotal(order) + discount} />
        {discount > 0 && (
          <SummaryRow
            label={order.discountLabel ? `Discounts · ${order.discountLabel} order` : 'Discounts'}
            value={-discount}
          />
        )}
        <SummaryRow label="Tax" value={order.tax} />
        {(settings.tipsEnabled || order.tip > 0) && <SummaryRow label="Tip" value={order.tip} />}
        <SummaryRow label="Total" value={orderTotal(order)} total />
        {order.payments.length > 1 &&
          order.payments.map((p, i) => (
            <SummaryRow
              key={i}
              label={`${TENDER_LABEL[p.method]}${p.ref ? ` ·${p.ref}` : ''}`}
              value={p.amount}
            />
          ))}
        {change > 0 && <SummaryRow label="Change given" value={change} />}
        {(order.refunds ?? []).map((r) => (
          <SummaryRow key={r.id} label={`Refund · ${r.reason}`} value={-r.amount} />
        ))}
      </div>

      {refunding && (
        <div className="detail__refund">
          <label className="detail__refund-field">
            <span>Reason</span>
            <select value={reason} onChange={(e) => setReason(e.target.value)}>
              {REFUND_REASONS.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
          {restockable.length > 0 && (
            <label className="detail__restock">
              <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} />
              <span>
                Put the items back in stock
                <span className="detail__restock-sub">
                  {restockable.map((l) => `${l.qty} × ${l.name}`).join(', ')}
                </span>
              </span>
            </label>
          )}
        </div>
      )}

      <div className="detail__actions">
        {order.status === 'occupied' ? (
          <>
            <Button onClick={onOpenTab}>Open on register</Button>
            {order.lines.length > 0 && (
              <Button variant="secondary" onClick={() => window.print()}>
                Print bill
              </Button>
            )}
          </>
        ) : refunding ? (
          <>
            <Button variant="secondary" onClick={() => setRefunding(null)}>
              Cancel
            </Button>
            <Button onClick={onConfirm} disabled={picked.length === 0}>
              {canRefund ? 'Refund' : 'Approve'} <Money value={refundTotal} />
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={() => window.print()}>
              Reprint receipt
            </Button>
            <Button variant="secondary" onClick={startRefund} disabled={order.status !== 'paid'}>
              {canRefund ? 'Refund…' : 'Refund · needs approval'}
            </Button>
          </>
        )}
      </div>

      <ApprovalDialog
        open={approving}
        permission="refunds"
        action={`Refund #${order.id} · ${formatMoney(refundTotal)} · ${reason}`}
        onApproved={(approver) => {
          issue(approver.id);
          setApproving(false);
        }}
        onClose={() => setApproving(false)}
      />
    </>
  );
}
