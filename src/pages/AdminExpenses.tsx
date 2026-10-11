import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import './Inventory.css';
import { Button } from '../components/Button';
import { FilterSelect } from '../components/FilterSelect';
import { CostMoney, Mono, formatCost } from '../components/Mono';
import { Pill, PillRow } from '../components/Pill';
import {
  EXPENSE_CATEGORIES,
  expenseCategoryLabel,
  type Expense,
  type ExpenseCategoryId,
} from '../data/expenses';
import { PAYMENT_METHOD_LABEL, formatDay, todayIso, type PaymentMethod } from '../data/inventory';
import { activeCurrency, costCurrency, isAmountText } from '../lib/currency';
import { expensesByCategory } from '../lib/profit';
import { usePos } from '../lib/store';
import { useRevealPanel } from '../lib/useRevealPanel';

type Period = 'this-month' | 'last-month' | 'all';

const PERIODS: { id: Period; label: string }[] = [
  { id: 'this-month', label: 'This month' },
  { id: 'last-month', label: 'Last month' },
  { id: 'all', label: 'All' },
];

/** "2026-09" for this month, or `offset` months back. */
function monthKey(offset = 0): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const inPeriod = (e: Expense, period: Period) =>
  period === 'all' || e.date.startsWith(monthKey(period === 'this-month' ? 0 : -1));

/**
 * Running costs that aren't stock or wages — rent, power, transport. They
 * come off gross profit in the Profit & loss report, which is what turns
 * sales into a profit or a loss.
 */
export function AdminExpenses() {
  const { expenses, settings } = usePos();
  const [params, setParams] = useSearchParams();
  const [period, setPeriod] = useState<Period>('this-month');
  const category = params.get('category') ?? 'all';
  // "new" opens a blank form; an id opens that expense.
  const selectedId = params.get('expense');
  const panelRef = useRevealPanel<HTMLElement>(selectedId);

  function setParam(key: 'category' | 'expense', value: string | null) {
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

  const summary = useMemo(() => {
    const total = (list: Expense[]) => list.reduce((s, e) => s + e.amount, 0);
    const thisMonth = expenses.filter((e) => inPeriod(e, 'this-month'));
    return {
      thisMonth: total(thisMonth),
      thisMonthCount: thisMonth.length,
      lastMonth: total(expenses.filter((e) => inPeriod(e, 'last-month'))),
      allTime: total(expenses),
      biggest: expensesByCategory(thisMonth)[0] ?? null,
    };
  }, [expenses]);

  const visible = expenses.filter(
    (e) => inPeriod(e, period) && (category === 'all' || e.category === category),
  );
  const visibleTotal = visible.reduce((s, e) => s + e.amount, 0);
  const selected = expenses.find((e) => e.id === selectedId) ?? null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Expenses</h1>
          <div className="page-sub">
            {settings.locationName} · running costs, set against sales in{' '}
            <Link to="/admin/reports?report=profit&range=month">Profit &amp; loss</Link>
          </div>
        </div>
        <div className="head-actions">
          <Button onClick={() => setParam('expense', 'new')}>Record expense</Button>
        </div>
      </div>

      <div className="inv-tiles">
        <Tile
          label="This month"
          value={formatCost(summary.thisMonth)}
          note={`${summary.thisMonthCount} ${summary.thisMonthCount === 1 ? 'expense' : 'expenses'}`}
        />
        <Tile label="Last month" value={formatCost(summary.lastMonth)} />
        <Tile label="All time" value={formatCost(summary.allTime)} />
        <Tile
          label="Biggest this month"
          value={summary.biggest ? formatCost(summary.biggest.amount) : '—'}
          note={summary.biggest?.label ?? 'Nothing recorded yet'}
        />
      </div>

      <div className="inv-toolbar">
        <PillRow label="Show">
          {PERIODS.map((p) => (
            <Pill key={p.id} active={p.id === period} onClick={() => setPeriod(p.id)}>
              {p.label}
            </Pill>
          ))}
        </PillRow>
        <FilterSelect value={category} onChange={(v) => setParam('category', v)} label="Category">
          <option value="all">Every category</option>
          {EXPENSE_CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </FilterSelect>
      </div>

      <div className="inv-layout">
        <section className="panel inv-table-wrap" aria-label="Expenses">
          {visible.length === 0 ? (
            <p className="inv-empty">
              {expenses.length === 0
                ? 'No expenses yet. Record rent, power, transport, and other running costs so reports can show your real profit.'
                : 'No expenses match.'}
            </p>
          ) : (
            <table className="inv-table">
              <thead>
                <tr>
                  <th scope="col">Expense</th>
                  <th scope="col">Category</th>
                  <th scope="col">Paid</th>
                  <th scope="col" className="num">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((e) => (
                  <tr
                    key={e.id}
                    className={e.id === selectedId ? 'inv-row inv-row--selected' : 'inv-row'}
                    onClick={() => setParam('expense', e.id)}
                  >
                    <td>
                      <button
                        type="button"
                        className="inv-row__pick"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          setParam('expense', e.id);
                        }}
                        aria-pressed={e.id === selectedId}
                      >
                        <span>
                          {e.description}
                          <span className="inv-sub">
                            {formatDay(e.date)} · {e.by}
                          </span>
                        </span>
                      </button>
                    </td>
                    <td className="inv-soft">{expenseCategoryLabel(e.category)}</td>
                    <td className="inv-soft">{PAYMENT_METHOD_LABEL[e.method]}</td>
                    <td className="num">
                      <CostMoney value={e.amount} className="inv-strong" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {visible.length > 0 && (
            <p className="inv-note inv-note--pad">
              <Mono>{visible.length}</Mono> {visible.length === 1 ? 'expense' : 'expenses'} ·{' '}
              <CostMoney value={visibleTotal} className="inv-strong" />
            </p>
          )}
        </section>

        <aside ref={panelRef} className="inv-panel" aria-label="Expense">
          {selectedId === 'new' ? (
            <ExpensePanel key="new" expense={null} onDone={(id) => setParam('expense', id)} />
          ) : selected ? (
            <ExpensePanel key={selected.id} expense={selected} onDone={(id) => setParam('expense', id)} />
          ) : (
            <p className="inv-panel__placeholder">
              Pick an expense to change it, or record a new one.
            </p>
          )}
        </aside>
      </div>
    </>
  );
}

function ExpensePanel({
  expense,
  onDone,
}: {
  /** Null for a new one. */
  expense: Expense | null;
  /** Called with the saved expense's id, or null once it's deleted. */
  onDone: (id: string | null) => void;
}) {
  const { addExpense, updateExpense, deleteExpense, me } = usePos();
  const [draft, setDraft] = useState({
    date: expense?.date ?? todayIso(),
    category: expense?.category ?? ('rent' as ExpenseCategoryId),
    description: expense?.description ?? '',
    amount: expense ? String(expense.amount) : '',
    method: expense?.method ?? ('cash' as PaymentMethod),
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const dirty =
    !expense ||
    draft.date !== expense.date ||
    draft.category !== expense.category ||
    draft.description !== expense.description ||
    draft.amount !== String(expense.amount) ||
    draft.method !== expense.method;

  function set<K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setError(null);
    setSaved(false);
  }

  function save() {
    const description = draft.description.trim().replace(/\s+/g, ' ');
    const text = draft.amount.trim().replace(/,/g, '');
    const amount = Number(text);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) return setError('Pick the day it was paid.');
    if (draft.date > todayIso()) return setError('That day hasn’t happened yet.');
    if (!description) return setError('Say what it was for, like “October rent”.');
    if (description.length > 80) return setError('Keep the description to 80 characters.');
    if (!isAmountText(text, costCurrency()) || amount <= 0) return setError('Enter the amount paid.');

    const fields = { date: draft.date, category: draft.category, description, amount, method: draft.method };
    if (expense) {
      updateExpense(expense.id, fields);
      setSaved(true);
    } else {
      const created = addExpense({ ...fields, by: me?.name ?? 'Unknown' });
      onDone(created.id);
    }
  }

  const hint = EXPENSE_CATEGORIES.find((c) => c.id === draft.category)?.hint;

  return (
    <>
      <div className="inv-panel__head">
        <div>
          <h2 className="inv-panel__title">{expense ? expense.description : 'Record an expense'}</h2>
          <div className="inv-panel__sub">
            {expense ? (
              <>
                {formatDay(expense.date)} · recorded by {expense.by}
              </>
            ) : (
              'Money spent running the business.'
            )}
          </div>
        </div>
      </div>

      <div className="inv-panel__section inv-form">
        <label className="inv-field">
          What it was for
          <input
            className="inv-input"
            value={draft.description}
            placeholder="October rent"
            onChange={(e) => set('description', e.target.value)}
          />
        </label>
        <label className="inv-field">
          Category
          {hint && <span className="inv-field__hint">{hint}.</span>}
          <select
            className="inv-select"
            value={draft.category}
            onChange={(e) => set('category', e.target.value as ExpenseCategoryId)}
          >
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="inv-field">
          Amount{costCurrency() !== activeCurrency() && ` (${costCurrency().symbol})`}
          <input
            className="inv-input inv-input--num"
            inputMode="decimal"
            value={draft.amount}
            onChange={(e) => set('amount', e.target.value)}
          />
        </label>
        <label className="inv-field">
          Day paid
          <input
            className="inv-input"
            type="date"
            value={draft.date}
            max={todayIso()}
            onChange={(e) => set('date', e.target.value)}
          />
        </label>
        <label className="inv-field">
          Paid by
          <select
            className="inv-select"
            value={draft.method}
            onChange={(e) => set('method', e.target.value as PaymentMethod)}
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
        {saved && !dirty && (
          <p className="inv-note" role="status">
            Saved.
          </p>
        )}
        <Button size="sm" onClick={save} disabled={!dirty}>
          {expense ? 'Save changes' : 'Record expense'}
        </Button>
        <p className="inv-note">
          Stock bought from suppliers isn’t an expense here — it’s counted when it sells. Wages
          come from Salaries.
        </p>
      </div>

      {expense && (
        <div className="inv-panel__section">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              if (!confirmingDelete) return setConfirmingDelete(true);
              deleteExpense(expense.id);
              onDone(null);
            }}
            onBlur={() => setConfirmingDelete(false)}
          >
            {confirmingDelete ? 'Confirm — delete expense' : 'Delete expense'}
          </Button>
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
