import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import './Inventory.css';
import { Button } from '../components/Button';
import { FilterSelect } from '../components/FilterSelect';
import { Money, Mono, formatMoney } from '../components/Mono';
import { Pill, PillRow } from '../components/Pill';
import { StatusChip } from '../components/StatusChip';
import {
  PAYMENT_METHOD_LABEL,
  addDays,
  formatDay,
  todayIso,
  type PaymentMethod,
  type SupplierBill,
} from '../data/inventory';
import { isAmountText } from '../lib/currency';
import { billStatus, type BillStatus } from '../lib/inventory';
import { usePos } from '../lib/store';

type Filter = 'unpaid' | 'overdue' | 'paid' | 'all';

function StateTag({ status }: { status: BillStatus }) {
  if (status.state === 'paid') {
    return (
      <StatusChip status="open" size="sm">
        Paid
      </StatusChip>
    );
  }
  if (status.state === 'overdue') {
    return (
      <StatusChip status="occupied" size="sm">
        Overdue
      </StatusChip>
    );
  }
  return <span className="inv-tag">{status.state === 'partial' ? 'Part paid' : 'Due'}</span>;
}

/** "3 days overdue", "due today", "due in 9 days". */
function dueText(bill: SupplierBill, status: BillStatus): string {
  if (status.state === 'paid') return `due ${formatDay(bill.dueAt)}`;
  const d = status.overdueBy;
  if (d > 0) return `${d} ${d === 1 ? 'day' : 'days'} overdue`;
  if (d === 0) return 'due today';
  return `due in ${-d} ${d === -1 ? 'day' : 'days'}`;
}

/**
 * What the business owes its suppliers. Each delivery received raises a bill
 * due on the supplier's terms; payments — whole or part — are recorded
 * against it here. Anyone with inventory access can see bills; only owners
 * (the `payables` permission) record payments.
 */
export function AdminBills() {
  const [params, setParams] = useSearchParams();
  const { bills, suppliers, settings } = usePos();
  const [filter, setFilter] = useState<Filter>('unpaid');
  const supplier = params.get('supplier') ?? 'all';
  const selectedId = params.get('bill');

  function setParam(key: 'supplier' | 'bill', value: string | null) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === null || value === 'all') next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );
  }

  const rows = useMemo(() => bills.map((b) => ({ bill: b, status: billStatus(b) })), [bills]);

  const today = todayIso();
  const summary = useMemo(() => {
    const open = rows.filter((r) => r.status.balance > 0);
    const monthStart = today.slice(0, 8) + '01';
    return {
      owed: open.reduce((s, r) => s + r.status.balance, 0),
      overdue: open.filter((r) => r.status.state === 'overdue'),
      dueSoon: open.filter((r) => r.status.state !== 'overdue' && r.bill.dueAt <= addDays(today, 7)),
      paidThisMonth: bills
        .flatMap((b) => b.payments)
        .filter((p) => p.date >= monthStart)
        .reduce((s, p) => s + p.amount, 0),
    };
  }, [rows, bills, today]);

  const visible = rows
    .filter((r) => supplier === 'all' || r.bill.supplierId === supplier)
    .filter((r) =>
      filter === 'all'
        ? true
        : filter === 'paid'
          ? r.status.state === 'paid'
          : filter === 'overdue'
            ? r.status.state === 'overdue'
            : r.status.balance > 0,
    )
    // Most urgent first: earliest due date on top.
    .sort((a, b) => (a.bill.dueAt < b.bill.dueAt ? -1 : 1));

  const supplierName = (id: string) => suppliers.find((s) => s.id === id)?.name ?? 'Unknown supplier';
  const selected = rows.find((r) => r.bill.id === selectedId) ?? null;
  const sum = (list: typeof rows) => list.reduce((s, r) => s + r.status.balance, 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Supplier bills</h1>
          <div className="page-sub">{settings.locationName} · what you owe for deliveries</div>
        </div>
      </div>

      <div className="inv-tiles">
        <Tile label="Owed" value={formatMoney(summary.owed)} />
        <Tile
          label="Overdue"
          value={formatMoney(sum(summary.overdue))}
          note={`${summary.overdue.length} ${summary.overdue.length === 1 ? 'bill' : 'bills'}`}
        />
        <Tile
          label="Due in 7 days"
          value={formatMoney(sum(summary.dueSoon))}
          note={`${summary.dueSoon.length} ${summary.dueSoon.length === 1 ? 'bill' : 'bills'}`}
        />
        <Tile label="Paid this month" value={formatMoney(summary.paidThisMonth)} />
      </div>

      <div className="inv-toolbar">
        <PillRow label="Show">
          {(['unpaid', 'overdue', 'paid', 'all'] as Filter[]).map((f) => (
            <Pill key={f} active={f === filter} onClick={() => setFilter(f)}>
              {f === 'unpaid' ? 'Unpaid' : f === 'overdue' ? 'Overdue' : f === 'paid' ? 'Paid' : 'All'}
            </Pill>
          ))}
        </PillRow>
        <FilterSelect value={supplier} onChange={(v) => setParam('supplier', v)} label="Supplier">
          <option value="all">Every supplier</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </FilterSelect>
      </div>

      <div className="inv-layout">
        <section className="panel inv-table-wrap" aria-label="Bills">
          {visible.length === 0 ? (
            <p className="inv-empty">
              {filter === 'unpaid' || filter === 'overdue' ? 'Nothing owed here.' : 'No bills match.'}
            </p>
          ) : (
            <table className="inv-table">
              <thead>
                <tr>
                  <th scope="col">Bill</th>
                  <th scope="col">Due</th>
                  <th scope="col" className="num">
                    Amount
                  </th>
                  <th scope="col" className="num">
                    Balance
                  </th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(({ bill, status }) => (
                  <tr
                    key={bill.id}
                    className={bill.id === selectedId ? 'inv-row inv-row--selected' : 'inv-row'}
                    onClick={() => setParam('bill', bill.id)}
                  >
                    <td>
                      <button
                        type="button"
                        className="inv-row__pick"
                        onClick={(e) => {
                          e.stopPropagation();
                          setParam('bill', bill.id);
                        }}
                        aria-pressed={bill.id === selectedId}
                      >
                        <span>
                          {supplierName(bill.supplierId)}
                          <span className="inv-sub">
                            <Mono>{bill.reference}</Mono>
                            {bill.poId && <> · {bill.poId}</>}
                          </span>
                        </span>
                      </button>
                    </td>
                    <td>
                      {formatDay(bill.dueAt)}
                      <span className="inv-sub">{dueText(bill, status)}</span>
                    </td>
                    <td className="num">
                      <Money value={bill.amount} />
                    </td>
                    <td className="num">
                      {status.balance > 0 ? (
                        <Money value={status.balance} className="inv-strong" />
                      ) : (
                        <span className="inv-soft">—</span>
                      )}
                    </td>
                    <td>
                      <StateTag status={status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <aside className="inv-panel" aria-label="Bill">
          {selected ? (
            <BillPanel
              key={selected.bill.id}
              bill={selected.bill}
              status={selected.status}
              supplierName={supplierName(selected.bill.supplierId)}
            />
          ) : (
            <p className="inv-panel__placeholder">Pick a bill to see its payments or pay it.</p>
          )}
        </aside>
      </div>
    </>
  );
}

function BillPanel({
  bill,
  status,
  supplierName,
}: {
  bill: SupplierBill;
  status: BillStatus;
  supplierName: string;
}) {
  const { can, recordBillPayment } = usePos();
  const [amount, setAmount] = useState(String(status.balance));
  const [method, setMethod] = useState<PaymentMethod>('bank');
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const canPay = can('payables');

  function pay() {
    const text = amount.trim().replace(/,/g, '');
    const n = Number(text);
    if (!isAmountText(text) || n <= 0) return setError('Enter the amount paid.');
    if (n > status.balance) return setError(`That’s more than the ${formatMoney(status.balance)} owed.`);
    if (!confirming) return setConfirming(true);
    recordBillPayment(bill.id, n, method);
    setConfirming(false);
    setError(null);
    setAmount(String(Math.max(0, status.balance - n)));
  }

  return (
    <>
      <div className="inv-panel__head">
        <div>
          <h2 className="inv-panel__title">{supplierName}</h2>
          <div className="inv-panel__sub">
            Invoice <Mono>{bill.reference}</Mono>
            {bill.poId && (
              <>
                {' '}
                · <Link to={`/admin/purchases?po=${bill.poId}`}>{bill.poId}</Link>
              </>
            )}
          </div>
        </div>
        <StateTag status={status} />
      </div>

      <dl className="inv-facts">
        <dt>Received</dt>
        <dd>{formatDay(bill.issuedAt)}</dd>
        <dt>Due</dt>
        <dd>
          {formatDay(bill.dueAt)} · {dueText(bill, status)}
        </dd>
        <dt>Amount</dt>
        <dd>
          <Money value={bill.amount} />
        </dd>
        <dt>Paid</dt>
        <dd>
          <Money value={status.paid} />
        </dd>
        <dt>Balance</dt>
        <dd>
          <Money value={status.balance} className="inv-strong" />
        </dd>
      </dl>

      {bill.payments.length > 0 && (
        <div className="inv-panel__section">
          <h3 className="inv-panel__section-title">Payments</h3>
          <ul className="inv-history">
            {bill.payments.map((p) => (
              <li key={p.id}>
                <span className="inv-history__what">{PAYMENT_METHOD_LABEL[p.method]}</span>
                <span className="inv-history__change">
                  <Money value={p.amount} />
                </span>
                <span className="inv-history__meta">
                  {formatDay(p.date)} · {p.by}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {status.balance > 0 && (
        <div className="inv-panel__section">
          <h3 className="inv-panel__section-title">Record a payment</h3>
          {canPay ? (
            <div className="inv-form">
              <label className="inv-field">
                Amount
                <span className="inv-field__hint">The full balance, or part of it.</span>
                <input
                  className="inv-input inv-input--num"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    setError(null);
                    setConfirming(false);
                  }}
                  aria-invalid={error !== null}
                />
              </label>
              <label className="inv-field">
                Paid by
                <select
                  className="inv-select"
                  value={method}
                  onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                >
                  {(Object.keys(PAYMENT_METHOD_LABEL) as PaymentMethod[]).map((m) => (
                    <option key={m} value={m}>
                      {PAYMENT_METHOD_LABEL[m]}
                    </option>
                  ))}
                </select>
              </label>
              {error && (
                <p className="inv-error" role="alert">
                  {error}
                </p>
              )}
              <Button size="sm" onClick={pay} onBlur={() => setConfirming(false)}>
                {confirming
                  ? `Confirm ${formatMoney(Number(amount.replace(/,/g, '')) || 0)} paid`
                  : 'Record payment'}
              </Button>
            </div>
          ) : (
            <p className="inv-note">Only an owner can record supplier payments.</p>
          )}
        </div>
      )}
    </>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="inv-tile">
      <div className="inv-tile__label">{label}</div>
      <Mono className="inv-tile__value">{value}</Mono>
      {note && <div className="inv-tile__note">{note}</div>}
    </div>
  );
}
