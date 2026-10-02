import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import './Inventory.css';
import { Button } from '../components/Button';
import { Money, Mono, formatMoney } from '../components/Mono';
import { Pill, PillRow } from '../components/Pill';
import { StatusChip } from '../components/StatusChip';
import {
  PURCHASE_STATUS_LABEL,
  formatDay,
  type PurchaseOrder,
  type PurchaseStatus,
} from '../data/inventory';
import { isAmountText } from '../lib/currency';
import { purchaseTotal } from '../lib/inventory';
import { usePos } from '../lib/store';

type Filter = 'open' | 'received' | 'cancelled' | 'all';

const FILTERS: { id: Filter; label: string; statuses: PurchaseStatus[] }[] = [
  { id: 'open', label: 'Open', statuses: ['draft', 'ordered', 'partial'] },
  { id: 'received', label: 'Received', statuses: ['received'] },
  { id: 'cancelled', label: 'Cancelled', statuses: ['cancelled'] },
  { id: 'all', label: 'All', statuses: ['draft', 'ordered', 'partial', 'received', 'cancelled'] },
];

/** Signal color only where there's a state to act on; drafts get a plain tag. */
export function PurchaseStatusTag({ status }: { status: PurchaseStatus }) {
  if (status === 'draft') return <span className="inv-tag">Draft</span>;
  const kind = status === 'received' ? 'open' : status === 'cancelled' ? 'refunded' : 'occupied';
  return (
    <StatusChip status={kind} size="sm">
      {PURCHASE_STATUS_LABEL[status]}
    </StatusChip>
  );
}

/**
 * Purchase orders, from draft to delivery. Drafts are edited here, placed
 * with the supplier, then received — in full or in parts. Receiving puts the
 * stock on the shelf, re-averages item costs, and raises a supplier bill.
 */
export function AdminPurchases() {
  const [params, setParams] = useSearchParams();
  const { purchaseOrders, suppliers, settings } = usePos();
  const [filter, setFilter] = useState<Filter>('open');

  // `?po=PO-1004`, or `?po=new` for a fresh draft.
  const selectedId = params.get('po');
  const select = (id: string) => setParams({ po: id }, { replace: true });

  const visible = useMemo(() => {
    const statuses = FILTERS.find((f) => f.id === filter)!.statuses;
    return purchaseOrders.filter((p) => statuses.includes(p.status));
  }, [purchaseOrders, filter]);

  const count = (f: Filter) =>
    purchaseOrders.filter((p) => FILTERS.find((x) => x.id === f)!.statuses.includes(p.status)).length;

  const supplierName = (id: string) => suppliers.find((s) => s.id === id)?.name ?? 'Unknown supplier';
  const selected = purchaseOrders.find((p) => p.id === selectedId) ?? null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Purchases</h1>
          <div className="page-sub">{settings.locationName} · purchase orders and deliveries</div>
        </div>
        <div className="head-actions">
          <Button onClick={() => select('new')}>New purchase order</Button>
        </div>
      </div>

      <div className="inv-toolbar">
        <PillRow label="Show">
          {FILTERS.map((f) => (
            <Pill key={f.id} active={f.id === filter} onClick={() => setFilter(f.id)}>
              {f.label} <Mono className="inv-count">{count(f.id)}</Mono>
            </Pill>
          ))}
        </PillRow>
      </div>

      <div className="inv-layout">
        <section className="panel inv-table-wrap" aria-label="Purchase orders">
          {visible.length === 0 ? (
            <p className="inv-empty">
              {filter === 'open' ? 'No open purchase orders.' : 'Nothing here.'}
            </p>
          ) : (
            <table className="inv-table">
              <thead>
                <tr>
                  <th scope="col">Order</th>
                  <th scope="col">Status</th>
                  <th scope="col">Ordered</th>
                  <th scope="col">Expected</th>
                  <th scope="col" className="num">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((po) => (
                  <tr
                    key={po.id}
                    className={po.id === selectedId ? 'inv-row inv-row--selected' : 'inv-row'}
                    onClick={() => select(po.id)}
                  >
                    <td>
                      <button
                        type="button"
                        className="inv-row__pick"
                        onClick={(e) => {
                          e.stopPropagation();
                          select(po.id);
                        }}
                        aria-pressed={po.id === selectedId}
                      >
                        <span>
                          <Mono>{po.id}</Mono>
                          <span className="inv-sub">
                            {supplierName(po.supplierId)} · <Mono>{po.lines.length}</Mono>{' '}
                            {po.lines.length === 1 ? 'line' : 'lines'}
                          </span>
                        </span>
                      </button>
                    </td>
                    <td>
                      <PurchaseStatusTag status={po.status} />
                    </td>
                    <td className="inv-soft">{po.orderedAt ? formatDay(po.orderedAt) : '—'}</td>
                    <td className="inv-soft">{po.expectedAt ? formatDay(po.expectedAt) : '—'}</td>
                    <td className="num">
                      <Money value={purchaseTotal(po)} className="inv-strong" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <aside className="inv-panel" aria-label="Purchase order">
          {selectedId === 'new' ? (
            <PurchaseEditor key="new" onSaved={select} />
          ) : selected?.status === 'draft' ? (
            <PurchaseEditor key={selected.id} order={selected} onSaved={select} />
          ) : selected ? (
            <OrderPanel key={selected.id} order={selected} />
          ) : (
            <p className="inv-panel__placeholder">
              Pick a purchase order to receive a delivery, or start a new one.
            </p>
          )}
        </aside>
      </div>
    </>
  );
}

/* ---------- Draft editor ---------- */

type DraftLine = { itemId: string; qty: string; unitCost: string };

function PurchaseEditor({
  order,
  onSaved,
}: {
  order?: PurchaseOrder;
  onSaved: (id: string) => void;
}) {
  const { catalog, suppliers, savePurchaseOrder, placePurchaseOrder, cancelPurchaseOrder } = usePos();
  const activeSuppliers = suppliers.filter((s) => s.active);
  const [supplierId, setSupplierId] = useState(order?.supplierId ?? activeSuppliers[0]?.id ?? '');
  const [lines, setLines] = useState<DraftLine[]>(
    order?.lines.map((l) => ({ itemId: l.itemId, qty: String(l.qty), unitCost: String(l.unitCost) })) ?? [],
  );
  const [expectedAt, setExpectedAt] = useState(order?.expectedAt ?? '');
  const [notes, setNotes] = useState(order?.notes ?? '');
  const [error, setError] = useState<string | null>(null);

  const theirs = catalog.filter((i) => i.supplierId === supplierId);
  const others = catalog.filter((i) => i.supplierId !== supplierId);
  const unused = (id: string) => !lines.some((l) => l.itemId === id);

  const total = lines.reduce((sum, l) => sum + (Number(l.qty) || 0) * (Number(l.unitCost) || 0), 0);

  function addLine(itemId: string) {
    const item = catalog.find((i) => i.id === itemId);
    if (!item) return;
    const suggested = item.parLevel !== undefined ? Math.max(item.parLevel - item.stock, 1) : 1;
    setLines((prev) => [...prev, { itemId, qty: String(suggested), unitCost: String(item.cost ?? '') }]);
    setError(null);
  }

  function updateLine(i: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
    setError(null);
  }

  function validate(): boolean {
    if (!supplierId) return fail('Pick a supplier.');
    if (lines.length === 0) return fail('Add at least one item.');
    for (const l of lines) {
      const name = catalog.find((i) => i.id === l.itemId)?.name ?? 'an item';
      if (!/^\d+$/.test(l.qty) || Number(l.qty) === 0) return fail(`Enter a quantity for ${name}.`);
      if (!isAmountText(l.unitCost) || l.unitCost === '') return fail(`Enter a unit cost for ${name}.`);
    }
    return true;
  }

  function fail(message: string) {
    setError(message);
    return false;
  }

  function save(place: boolean) {
    if (!validate()) return;
    const saved = savePurchaseOrder({
      id: order?.id,
      supplierId,
      lines: lines.map((l) => ({ itemId: l.itemId, qty: Number(l.qty), unitCost: Number(l.unitCost) })),
      expectedAt: expectedAt || undefined,
      notes: notes.trim() || undefined,
    });
    if (place) placePurchaseOrder(saved.id);
    onSaved(saved.id);
  }

  return (
    <>
      <div className="inv-panel__head">
        <div>
          <h2 className="inv-panel__title">{order ? <Mono>{order.id}</Mono> : 'New purchase order'}</h2>
          <div className="inv-panel__sub">Draft — not sent to the supplier yet</div>
        </div>
        {order && <PurchaseStatusTag status="draft" />}
      </div>

      <div className="inv-form">
        <label className="inv-field">
          Supplier
          <select className="inv-select" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            {activeSuppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        {lines.length > 0 && (
          <table className="inv-lines">
            <thead>
              <tr>
                <th>Item</th>
                <th className="num">Qty</th>
                <th className="num">Unit cost</th>
                <th>
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const name = catalog.find((x) => x.id === l.itemId)?.name ?? l.itemId;
                return (
                  <tr key={l.itemId}>
                    <td>{name}</td>
                    <td className="num">
                      <input
                        className="inv-input inv-input--num inv-input--sm inv-lines__qty"
                        inputMode="numeric"
                        value={l.qty}
                        onChange={(e) => updateLine(i, { qty: e.target.value.trim() })}
                        aria-label={`Quantity of ${name}`}
                      />
                    </td>
                    <td className="num">
                      <input
                        className="inv-input inv-input--num inv-input--sm inv-lines__cost"
                        inputMode="decimal"
                        value={l.unitCost}
                        onChange={(e) => updateLine(i, { unitCost: e.target.value.trim() })}
                        aria-label={`Unit cost of ${name}`}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="inv-remove"
                        onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}
                        aria-label={`Remove ${name}`}
                      >
                        <span aria-hidden="true">×</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>Total</td>
                <td className="num">
                  <Mono>{formatMoney(total)}</Mono>
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}

        <label className="inv-field">
          Add an item
          <select className="inv-select" value="" onChange={(e) => addLine(e.target.value)}>
            <option value="">Choose…</option>
            {theirs.some((i) => unused(i.id)) && (
              <optgroup label="From this supplier">
                {theirs.filter((i) => unused(i.id)).map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} · {i.stock} on hand
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="Other items">
              {others.filter((i) => unused(i.id)).map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </optgroup>
          </select>
        </label>

        <label className="inv-field">
          Expected delivery <span className="inv-field__hint">(optional)</span>
          <input
            className="inv-input"
            type="date"
            value={expectedAt}
            onChange={(e) => setExpectedAt(e.target.value)}
          />
        </label>
        <label className="inv-field">
          Notes for the supplier <span className="inv-field__hint">(optional)</span>
          <input className="inv-input" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>

        {error && (
          <p className="inv-error" role="alert">
            {error}
          </p>
        )}

        <div className="inv-actions">
          <Button variant="secondary" size="sm" onClick={() => save(false)}>
            Save draft
          </Button>
          <Button size="sm" onClick={() => save(true)}>
            Place order
          </Button>
        </div>
        {order && (
          <Button variant="secondary" size="sm" onClick={() => cancelPurchaseOrder(order.id)}>
            Cancel this draft
          </Button>
        )}
      </div>
    </>
  );
}

/* ---------- Placed orders: receive, or read ---------- */

function OrderPanel({ order }: { order: PurchaseOrder }) {
  const { suppliers, bills, receiveDelivery, cancelPurchaseOrder } = usePos();
  const supplier = suppliers.find((s) => s.id === order.supplierId);
  const open = order.status === 'ordered' || order.status === 'partial';
  const [qty, setQty] = useState<Record<string, string>>(() =>
    Object.fromEntries(order.lines.map((l) => [l.itemId, String(Math.max(0, l.qty - l.received))])),
  );
  const [cost, setCost] = useState<Record<string, string>>(() =>
    Object.fromEntries(order.lines.map((l) => [l.itemId, String(l.unitCost)])),
  );
  const [invoice, setInvoice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const orderBills = bills.filter((b) => b.poId === order.id);
  const receiving = order.lines.reduce(
    (sum, l) => sum + (Number(qty[l.itemId]) || 0) * (Number(cost[l.itemId]) || 0),
    0,
  );

  function receive() {
    const receipts = [];
    for (const l of order.lines) {
      const q = qty[l.itemId]?.trim() ?? '0';
      const c = cost[l.itemId]?.trim() ?? '';
      if (!/^\d+$/.test(q)) return setError(`Enter how many ${l.name} arrived (0 if none).`);
      if (Number(q) > 0 && (!isAmountText(c) || c === '')) return setError(`Enter a unit cost for ${l.name}.`);
      receipts.push({ itemId: l.itemId, qty: Number(q), unitCost: Number(c) });
    }
    if (receipts.every((r) => r.qty === 0)) return setError('Nothing entered as arrived.');
    if (!invoice.trim()) return setError('Enter the supplier’s invoice or delivery note number.');
    receiveDelivery(order.id, receipts, invoice);
    setInvoice('');
    setError(null);
  }

  return (
    <>
      <div className="inv-panel__head">
        <div>
          <h2 className="inv-panel__title">
            <Mono>{order.id}</Mono>
          </h2>
          <div className="inv-panel__sub">
            {supplier?.name ?? 'Unknown supplier'}
            {order.orderedAt && <> · ordered {formatDay(order.orderedAt)}</>}
            {order.expectedAt && open && <> · expected {formatDay(order.expectedAt)}</>}
          </div>
        </div>
        <PurchaseStatusTag status={order.status} />
      </div>
      {order.notes && <p className="inv-note">“{order.notes}”</p>}

      <table className="inv-lines">
        <thead>
          <tr>
            <th>Item</th>
            <th className="num">Ordered</th>
            <th className="num">In</th>
            {open && <th className="num">Arrived now</th>}
            {open && <th className="num">Unit cost</th>}
          </tr>
        </thead>
        <tbody>
          {order.lines.map((l) => (
            <tr key={l.itemId}>
              <td>{l.name}</td>
              <td className="num">
                <Mono>{l.qty}</Mono>
              </td>
              <td className="num">
                <Mono className={l.received >= l.qty ? '' : 'inv-soft'}>{l.received}</Mono>
              </td>
              {open && (
                <td className="num">
                  <input
                    className="inv-input inv-input--num inv-input--sm inv-lines__qty"
                    inputMode="numeric"
                    value={qty[l.itemId] ?? ''}
                    onChange={(e) => {
                      setQty({ ...qty, [l.itemId]: e.target.value });
                      setError(null);
                    }}
                    aria-label={`${l.name} arrived now`}
                  />
                </td>
              )}
              {open && (
                <td className="num">
                  <input
                    className="inv-input inv-input--num inv-input--sm inv-lines__cost"
                    inputMode="decimal"
                    value={cost[l.itemId] ?? ''}
                    onChange={(e) => {
                      setCost({ ...cost, [l.itemId]: e.target.value });
                      setError(null);
                    }}
                    aria-label={`${l.name} unit cost`}
                  />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {open ? (
        <div className="inv-panel__section">
          <h3 className="inv-panel__section-title">Receive a delivery</h3>
          <div className="inv-form">
            <label className="inv-field">
              Supplier invoice or delivery note #
              <input
                className="inv-input"
                value={invoice}
                onChange={(e) => {
                  setInvoice(e.target.value);
                  setError(null);
                }}
                placeholder="e.g. KCT-0461"
              />
            </label>
            <p className="inv-note">
              Adds what arrived to stock, updates each item’s average cost, and raises a bill for{' '}
              <Mono>{formatMoney(receiving)}</Mono>
              {supplier && <> due in {supplier.paymentTermsDays} days</>}. Anything short stays
              open for the next delivery.
            </p>
            {error && (
              <p className="inv-error" role="alert">
                {error}
              </p>
            )}
            <Button size="sm" onClick={receive}>
              Receive delivery
            </Button>
            {order.lines.every((l) => l.received === 0) && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => (confirmingCancel ? cancelPurchaseOrder(order.id) : setConfirmingCancel(true))}
                onBlur={() => setConfirmingCancel(false)}
              >
                {confirmingCancel ? 'Confirm cancel order' : 'Cancel order'}
              </Button>
            )}
          </div>
        </div>
      ) : (
        <p className="inv-note">
          Total <Mono>{formatMoney(purchaseTotal(order))}</Mono>
          {order.status === 'cancelled' && ' — cancelled, nothing was received.'}
        </p>
      )}

      {orderBills.length > 0 && (
        <div className="inv-panel__section">
          <h3 className="inv-panel__section-title">Bills</h3>
          <ul className="inv-history">
            {orderBills.map((b) => (
              <li key={b.id}>
                <span className="inv-history__what">
                  <Link to={`/admin/bills?bill=${b.id}`}>{b.reference}</Link>
                </span>
                <span className="inv-history__change">
                  <Money value={b.amount} />
                </span>
                <span className="inv-history__meta">
                  Received {formatDay(b.issuedAt)} · due {formatDay(b.dueAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
