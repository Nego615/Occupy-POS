import { formatCost } from './Mono';
import { PrintableDocument } from './PrintableDocument';
import { PURCHASE_STATUS_LABEL, formatDay, type PurchaseOrder } from '../data/inventory';
import { purchaseTotal, receivedTotal } from '../lib/inventory';
import { usePos } from '../lib/store';

/**
 * A purchase order on the letterhead, to send to the supplier or file. Once
 * anything has come in it also shows what arrived and what's still short —
 * and, for one closed short, that the rest was written off.
 */
export function PrintablePurchaseOrder({ order }: { order: PurchaseOrder }) {
  const { suppliers, settings } = usePos();
  const supplier = suppliers.find((s) => s.id === order.supplierId);
  const delivered = order.lines.some((l) => l.received > 0);
  const short = order.lines.reduce((sum, l) => sum + Math.max(0, l.qty - l.received), 0);

  const meta = [
    order.orderedAt ? `Ordered ${formatDay(order.orderedAt)}` : `Draft, created ${formatDay(order.createdAt)}`,
    order.expectedAt && `Delivery expected ${formatDay(order.expectedAt)}`,
    order.status !== 'ordered' && order.status !== 'draft' && `Status: ${PURCHASE_STATUS_LABEL[order.status]}`,
  ].filter(Boolean) as string[];

  return (
    <PrintableDocument title="Purchase order" reference={order.id} meta={meta}>
      <div className="print-doc__parties">
        <div>
          <div className="print-doc__label">Supplier</div>
          <div className="print-doc__party-name">{supplier?.name ?? 'Unknown supplier'}</div>
          {supplier?.contact && <div>Attn: {supplier.contact}</div>}
          {supplier?.phone && <div className="mono">{supplier.phone}</div>}
          {supplier?.email && <div>{supplier.email}</div>}
          {supplier && supplier.paymentTermsDays > 0 && <div>Terms: {supplier.paymentTermsDays} days</div>}
        </div>
        <div>
          <div className="print-doc__label">Deliver to</div>
          <div className="print-doc__party-name">{settings.businessName}</div>
          <div>{settings.locationName}</div>
          <div>Raised by {order.createdBy}</div>
        </div>
      </div>

      <table className="print-doc__table">
        <thead>
          <tr>
            <th>#</th>
            <th>Item</th>
            <th className="num">Qty</th>
            {delivered && <th className="num">Received</th>}
            {delivered && <th className="num">Short</th>}
            <th className="num">Unit cost</th>
            <th className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {order.lines.map((l, i) => (
            <tr key={l.itemId}>
              <td className="mono">{i + 1}</td>
              <td>{l.name}</td>
              <td className="num mono">{l.qty}</td>
              {delivered && <td className="num mono">{l.received}</td>}
              {delivered && <td className="num mono">{Math.max(0, l.qty - l.received) || '—'}</td>}
              <td className="num mono">{formatCost(l.unitCost)}</td>
              <td className="num mono">{formatCost(l.qty * l.unitCost)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={delivered ? 6 : 4}>Order total</td>
            <td className="num mono">{formatCost(purchaseTotal(order))}</td>
          </tr>
          {delivered && (
            <tr>
              <td colSpan={6}>Received so far</td>
              <td className="num mono">{formatCost(receivedTotal(order))}</td>
            </tr>
          )}
        </tfoot>
      </table>

      {order.notes && (
        <div className="print-doc__note">
          <div className="print-doc__label">Notes</div>
          {order.notes}
        </div>
      )}

      {order.status === 'closed' && (
        <div className="print-doc__note">
          <div className="print-doc__label">Closed short</div>
          Closed {order.closedAt && formatDay(order.closedAt)}
          {order.closedBy && <> by {order.closedBy}</>} with <span className="mono">{short}</span>{' '}
          {short === 1 ? 'unit' : 'units'} not delivered. Only what was received is billed.
          {order.closeReason && <> Reason: {order.closeReason}.</>}
          {order.reorderedAs && <> The rest was reordered on {order.reorderedAs}.</>}
        </div>
      )}

      <div className="print-doc__signatures">
        <div className="print-doc__signature">Authorised by — name, signature, date</div>
        <div className="print-doc__signature">Supplier acknowledgement — name, signature, date</div>
      </div>
    </PrintableDocument>
  );
}
