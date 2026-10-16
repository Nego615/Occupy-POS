import { useMemo, useState } from 'react';
import './OrderEditor.css';
import { Button } from './Button';
import { Money } from './Mono';
import { Stepper } from './Stepper';
import { lineContents, recipePours } from '../data/catalog';
import {
  TENDER_LABEL,
  orderTotal,
  paidAmount,
  type Order,
  type OrderLine,
  type Payment,
  type TenderMethod,
} from '../data/orders';
import { TENDER_METHODS } from '../data/cashup';
import { editProblem, editedPayment, hasLocalCash, heldItems, withLines } from '../lib/orderEdits';
import { roundMoney } from '../lib/currency';
import { usePos } from '../lib/store';

/** A line as it's being edited: its quantity, and its price as typed. */
type Row = { key: string; line: OrderLine; qty: number; price: string };
/** A payment as it's being edited. */
type PayRow = { key: string; before?: Payment; method: TenderMethod; amount: string };

let rowSeq = 0;
const nextKey = () => `r${++rowSeq}`;

const toAmount = (text: string) => (text.trim() === '' ? NaN : Number(text));

/**
 * Changes a closed order: quantities and prices, lines dropped or added, how
 * it was paid, and who served it. Tax is worked out again at the order's own
 * rate, and stock moves for the difference when it's saved.
 */
export function OrderEditor({ order, onDone }: { order: Order; onDone: () => void }) {
  const { catalog, allStaff, settings, editOrder } = usePos();
  const [rows, setRows] = useState<Row[]>(() =>
    order.lines.map((line) => ({ key: nextKey(), line, qty: line.qty, price: String(line.unitPrice) })),
  );
  const [pays, setPays] = useState<PayRow[]>(() =>
    order.payments.map((p) => ({ key: nextKey(), before: p, method: p.method, amount: String(p.amount) })),
  );
  // A single payment follows the new total until someone types an amount.
  const [autoTotal, setAutoTotal] = useState(order.payments.length === 1);
  const [servedBy, setServedBy] = useState(order.servedBy ?? '');
  const [adding, setAdding] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const paid = order.status === 'paid';
  const lockedPayments = hasLocalCash(order);
  const people = allStaff.filter((m) => !m.deleted || m.id === order.servedBy);

  const lines = useMemo(
    () =>
      rows
        .filter((r) => r.qty > 0)
        .map((r) => {
          const unitPrice = toAmount(r.price);
          // A price set by hand replaces whatever deal priced it.
          if (unitPrice === r.line.unitPrice) return { ...r.line, qty: r.qty };
          const { listPrice: _list, promo: _promo, ...rest } = r.line;
          return { ...rest, qty: r.qty, unitPrice };
        }),
    [rows],
  );
  const next = useMemo(() => withLines(order, lines, settings.taxRate), [order, lines, settings.taxRate]);
  const newTotal = orderTotal(next);

  const amountText = (p: PayRow, i: number) => (autoTotal && i === 0 ? String(newTotal) : p.amount);
  const payments: Payment[] = pays.map((p, i) =>
    editedPayment(p.before, p.method, roundMoney(toAmount(amountText(p, i)))),
  );
  const paymentsLeft = roundMoney(newTotal - paidAmount(payments));

  function setRow(key: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setError(null);
  }

  function addItem(itemId: string) {
    const item = catalog.find((i) => i.id === itemId);
    if (!item) return;
    // A cocktail pours its recipe, and costs what its ingredients do.
    const pours = item.recipe?.length ? recipePours(item, catalog) : undefined;
    const pourCosts = pours?.map((p) => catalog.find((i) => i.id === p.itemId)?.cost);
    const unitCost = pours
      ? pourCosts!.every((c) => c !== undefined)
        ? roundMoney(pourCosts!.reduce((sum: number, c, i) => sum + c! * pours[i].units, 0))
        : undefined
      : item.cost;
    const line: OrderLine = {
      itemId: item.id,
      name: item.name,
      qty: 1,
      unitPrice: item.price,
      ...(pours ? { pours } : {}),
      ...(unitCost !== undefined ? { unitCost } : {}),
    };
    setRows((prev) => [...prev, { key: nextKey(), line, qty: 1, price: String(item.price) }]);
    setAdding('');
    setError(null);
  }

  function setPay(key: string, patch: Partial<PayRow>) {
    setPays((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));
    setError(null);
  }

  function setPayAmount(key: string, amount: string) {
    // Typing an amount stops the first payment following the total.
    if (autoTotal) {
      setAutoTotal(false);
      setPays((prev) => prev.map((p, i) => (i === 0 ? { ...p, amount: String(newTotal) } : p)));
    }
    setPay(key, { amount });
  }

  function addPayment() {
    // The amounts so far are kept as they read; the new one takes up whatever's left.
    setAutoTotal(false);
    setPays((prev) => [
      ...prev.map((p, i) => ({ ...p, amount: amountText(p, i) })),
      { key: nextKey(), method: 'cash', amount: String(Math.max(0, paymentsLeft)) },
    ]);
  }

  function removePayment(key: string) {
    setAutoTotal(false);
    setPays((prev) => prev.map((p, i) => ({ ...p, amount: amountText(p, i) })).filter((p) => p.key !== key));
  }

  function save() {
    const change = {
      lines,
      ...(paid && !lockedPayments ? { payments } : {}),
      servedBy,
      note,
    };
    const problem = editProblem({ ...next, payments: change.payments ?? next.payments }, note);
    if (problem) return setError(problem);
    const refused = editOrder(order.id, change);
    if (refused) return setError(refused);
    onDone();
  }

  const available = catalog.filter((i) => i.available).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <div className="order-edit">
        <section className="order-edit__section" aria-labelledby="edit-lines">
          <h3 className="order-edit__heading" id="edit-lines">
            Items
          </h3>
          {rows.map((r) => {
            const parts = lineContents(r.line).join(' · ');
            return (
              <div className={r.qty === 0 ? 'edit-line edit-line--removed' : 'edit-line'} key={r.key}>
                <span className="edit-line__name">
                  {r.line.name}
                  {parts && <span className="edit-line__parts">{parts}</span>}
                  {r.qty === 0 && <span className="edit-line__parts">Removed</span>}
                </span>
                <Stepper
                  value={r.qty}
                  onChange={(qty) => setRow(r.key, { qty })}
                  label={r.line.name}
                  min={0}
                  max={999}
                />
                <label className="edit-line__price">
                  <span className="sr-only">Price each for {r.line.name}</span>
                  <input
                    className="mono"
                    type="text"
                    inputMode="decimal"
                    value={r.price}
                    onChange={(e) => setRow(r.key, { price: e.target.value.trim() })}
                    disabled={r.qty === 0}
                  />
                </label>
              </div>
            );
          })}
          <label className="order-edit__field">
            <span>Add an item</span>
            <select value={adding} onChange={(e) => addItem(e.target.value)}>
              <option value="">Choose…</option>
              {available.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </label>
        </section>

        {paid && (
          <section className="order-edit__section" aria-labelledby="edit-payments">
            <h3 className="order-edit__heading" id="edit-payments">
              Payment
            </h3>
            {lockedPayments ? (
              <p className="order-edit__note">
                Part of this was paid in cash in the cost currency, which was counted in its own drawer, so
                the payments stay as they were.
              </p>
            ) : (
              <>
                {pays.map((p, i) => (
                  <div className="edit-pay" key={p.key}>
                    <select
                      value={p.method}
                      onChange={(e) => setPay(p.key, { method: e.target.value as TenderMethod })}
                      aria-label={`Payment ${i + 1} method`}
                    >
                      {TENDER_METHODS.map((m) => (
                        <option key={m} value={m}>
                          {TENDER_LABEL[m]}
                        </option>
                      ))}
                    </select>
                    <input
                      className="mono"
                      type="text"
                      inputMode="decimal"
                      value={amountText(p, i)}
                      onChange={(e) => setPayAmount(p.key, e.target.value.trim())}
                      aria-label={`Payment ${i + 1} amount`}
                    />
                    {pays.length > 1 && (
                      <button
                        type="button"
                        className="edit-pay__remove"
                        onClick={() => removePayment(p.key)}
                        aria-label={`Remove payment ${i + 1}`}
                      >
                        <span aria-hidden="true">×</span>
                      </button>
                    )}
                  </div>
                ))}
                <div className="order-edit__row">
                  <button type="button" className="order-edit__link" onClick={addPayment}>
                    + Split the payment
                  </button>
                  {paymentsLeft !== 0 && (
                    <span className="order-edit__warn">
                      {paymentsLeft > 0 ? 'Still to cover ' : 'Over by '}
                      <Money value={Math.abs(paymentsLeft)} />
                    </span>
                  )}
                </div>
              </>
            )}
          </section>
        )}

        <section className="order-edit__section">
          <label className="order-edit__field">
            <span>Served by</span>
            <select value={servedBy} onChange={(e) => setServedBy(e.target.value)}>
              <option value="">Not recorded</option>
              {people.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label className="order-edit__field order-edit__field--stacked">
            <span>What changed and why</span>
            <input
              type="text"
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                setError(null);
              }}
              placeholder="e.g. Rang up 3 sodas, customer had 2"
            />
          </label>
        </section>

        <div className="order-edit__total">
          <span>
            New total · was <Money value={orderTotal(order)} />
          </span>
          <Money value={newTotal} className="order-edit__total-value" />
        </div>
        {error && (
          <p className="order-edit__error" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="detail__actions">
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button onClick={save}>Save changes</Button>
      </div>
    </>
  );
}

/**
 * Deletes a closed order, with a reason. What's left of its items can go back
 * in stock — off by default, as most of what's sold can't be put back.
 */
export function DeleteOrderPanel({ order, onDone }: { order: Order; onDone: () => void }) {
  const { deleteOrder, catalog } = usePos();
  const [reason, setReason] = useState('');
  const [restock, setRestock] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const restockable = heldItems(order).filter((l) =>
    catalog.some((c) => (l.itemId ? c.id === l.itemId : c.name === l.name) && !c.untracked),
  );

  function confirm() {
    const refused = deleteOrder(order.id, { reason, restock: restock && restockable.length > 0 });
    if (refused) return setError(refused);
    onDone();
  }

  return (
    <>
      <div className="order-edit">
        <p className="order-edit__lead">
          Deleting takes this order out of sales, reports, and the open shift’s cash-up. It stays under
          Deleted in Orders, where it can be restored.
        </p>
        <label className="order-edit__field order-edit__field--stacked">
          <span>Why is it being deleted?</span>
          <input
            type="text"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setError(null);
            }}
            placeholder="e.g. Test order, rung up twice"
            autoFocus
          />
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
        {error && (
          <p className="order-edit__error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="detail__actions">
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button onClick={confirm} disabled={!reason.trim()}>
          Delete order
        </Button>
      </div>
    </>
  );
}
