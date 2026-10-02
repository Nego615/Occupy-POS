import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import './Inventory.css';
import { Button } from '../components/Button';
import { FilterSelect } from '../components/FilterSelect';
import { Money, Mono } from '../components/Mono';
import { Pill, PillRow } from '../components/Pill';
import { SearchField } from '../components/SearchField';
import { StatusChip } from '../components/StatusChip';
import { CATEGORIES, stockState, type CatalogItem } from '../data/catalog';
import { ADJUST_REASONS, MOVEMENT_LABEL, formatDay } from '../data/inventory';
import { round } from '../lib/cart';
import { reorderSuggestions } from '../lib/inventory';
import { usePos } from '../lib/store';

type Filter = 'all' | 'low' | 'out';

/**
 * What's on the shelf, what it's worth at cost, and every change to it.
 * Stock changes only through the ledger: sales and refunds log themselves,
 * deliveries come in on Purchases, and anything else is an adjustment here
 * with a reason.
 */
export function AdminStock() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { catalog, suppliers, purchaseOrders, savePurchaseOrder, settings } = usePos();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [supplier, setSupplier] = useState('all');
  const low = settings.lowStockDefault;

  // `?item=` deep-links from the item editor.
  const selectedId = params.get('item');
  const select = (id: string) => setParams({ item: id }, { replace: true });

  const counts = useMemo(() => {
    let lowCount = 0;
    let outCount = 0;
    for (const item of catalog) {
      const state = stockState(item, low);
      if (state === 'low') lowCount++;
      if (state === 'out') outCount++;
    }
    return { all: catalog.length, low: lowCount + outCount, out: outCount };
  }, [catalog, low]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog.filter((item) => {
      const state = stockState(item, low);
      if (filter === 'low' && state === 'in') return false;
      if (filter === 'out' && state !== 'out') return false;
      if (supplier !== 'all' && (item.supplierId ?? 'none') !== supplier) return false;
      return !q || item.name.toLowerCase().includes(q);
    });
  }, [catalog, filter, supplier, query, low]);

  const value = round(catalog.reduce((sum, i) => sum + i.stock * (i.cost ?? 0), 0));
  const uncosted = catalog.filter((i) => i.cost === undefined).length;

  const openOrders = useMemo(
    () => purchaseOrders.filter((p) => ['draft', 'ordered', 'partial'].includes(p.status)),
    [purchaseOrders],
  );
  const suggestions = useMemo(
    () => reorderSuggestions(catalog, low, openOrders),
    [catalog, low, openOrders],
  );

  /** One draft purchase order per supplier, for everything low that isn't already on order. */
  function reorder() {
    let first: string | null = null;
    for (const [supplierId, lines] of suggestions) {
      const po = savePurchaseOrder({
        supplierId,
        lines: lines.map(({ item, qty }) => ({ itemId: item.id, qty, unitCost: item.cost ?? 0 })),
        notes: 'Reorder of low stock.',
      });
      first ??= po.id;
    }
    if (first) navigate(`/admin/purchases?po=${first}`);
  }

  const selected = catalog.find((i) => i.id === selectedId) ?? null;
  const supplierName = (id?: string) => suppliers.find((s) => s.id === id)?.name ?? '—';

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Stock</h1>
          <div className="page-sub">
            {settings.locationName} · <Mono>{catalog.length}</Mono> items ·{' '}
            <Money value={value} /> at cost
          </div>
        </div>
        <div className="head-actions">
          <Button onClick={reorder} disabled={suggestions.size === 0}>
            {suggestions.size === 0
              ? 'Nothing to reorder'
              : `Reorder low stock · ${suggestions.size} ${suggestions.size === 1 ? 'supplier' : 'suppliers'}`}
          </Button>
        </div>
      </div>

      <div className="inv-toolbar">
        <PillRow label="Show">
          <Pill active={filter === 'all'} onClick={() => setFilter('all')}>
            All <Mono className="inv-count">{counts.all}</Mono>
          </Pill>
          <Pill active={filter === 'low'} onClick={() => setFilter('low')}>
            Low &amp; out <Mono className="inv-count">{counts.low}</Mono>
          </Pill>
          <Pill active={filter === 'out'} onClick={() => setFilter('out')}>
            Sold out <Mono className="inv-count">{counts.out}</Mono>
          </Pill>
        </PillRow>
        <div className="inv-toolbar__right">
          <FilterSelect value={supplier} onChange={setSupplier} label="Supplier">
            <option value="all">Any supplier</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
            <option value="none">No supplier</option>
          </FilterSelect>
          <SearchField value={query} onChange={setQuery} placeholder="Find an item" label="Find an item" />
        </div>
      </div>

      <div className="inv-layout">
        <section className="panel inv-table-wrap" aria-label="Stock levels">
          {visible.length === 0 ? (
            <p className="inv-empty">No items match.</p>
          ) : (
            <table className="inv-table">
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col" className="num">
                    On hand
                  </th>
                  <th scope="col" className="num">
                    Reorder to
                  </th>
                  <th scope="col" className="num">
                    Unit cost
                  </th>
                  <th scope="col" className="num">
                    Value
                  </th>
                  <th scope="col">Supplier</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((item) => {
                  const state = stockState(item, low);
                  return (
                    <tr
                      key={item.id}
                      className={item.id === selectedId ? 'inv-row inv-row--selected' : 'inv-row'}
                      onClick={() => select(item.id)}
                    >
                      <td>
                        <button
                          type="button"
                          className="inv-row__pick"
                          onClick={(e) => {
                            e.stopPropagation();
                            select(item.id);
                          }}
                          aria-pressed={item.id === selectedId}
                        >
                          <span className="inv-dot" style={{ background: item.color }} aria-hidden="true" />
                          <span>
                            {item.name}
                            <span className="inv-sub">
                              {CATEGORIES.find((c) => c.id === item.category)?.label}
                            </span>
                          </span>
                        </button>
                      </td>
                      <td className="num">
                        {state === 'in' ? (
                          <Mono className="inv-strong">{item.stock}</Mono>
                        ) : (
                          <StatusChip status="occupied" size="sm">
                            {state === 'out' ? 'Sold out' : <>Low · <Mono>{item.stock}</Mono></>}
                          </StatusChip>
                        )}
                      </td>
                      <td className="num inv-soft">
                        {item.parLevel !== undefined ? <Mono>{item.parLevel}</Mono> : '—'}
                      </td>
                      <td className="num">
                        {item.cost !== undefined ? <Money value={item.cost} /> : <span className="inv-soft">Not set</span>}
                      </td>
                      <td className="num">
                        {item.cost !== undefined ? <Money value={item.stock * item.cost} /> : <span className="inv-soft">—</span>}
                      </td>
                      <td className="inv-soft">{supplierName(item.supplierId)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {uncosted > 0 && (
            <p className="inv-note inv-note--pad">
              <Mono>{uncosted}</Mono> {uncosted === 1 ? 'item has' : 'items have'} no unit cost, so
              {uncosted === 1 ? ' isn’t' : ' aren’t'} in the stock value. Set costs in the item editor
              or by receiving a delivery.
            </p>
          )}
        </section>

        <aside className="inv-panel" aria-label="Item stock">
          {selected ? (
            <ItemPanel key={selected.id} item={selected} supplierName={supplierName(selected.supplierId)} />
          ) : (
            <p className="inv-panel__placeholder">
              Pick an item to adjust its stock or see every change to it.
            </p>
          )}
        </aside>
      </div>
    </>
  );
}

function ItemPanel({ item, supplierName }: { item: CatalogItem; supplierName: string }) {
  const navigate = useNavigate();
  const { movements, staff, adjustStock, settings } = usePos();
  const [reason, setReason] = useState<'count' | 'waste' | 'correction'>('count');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const history = movements.filter((m) => m.itemId === item.id).slice(0, 40);
  const who = (id?: string) => (id ? staff.find((m) => m.id === id)?.name ?? 'Unknown' : 'System');
  const hint = ADJUST_REASONS.find((r) => r.id === reason)!.hint;

  function save() {
    const text = amount.trim();
    const n = Number(text);
    if (reason === 'count') {
      if (!/^\d+$/.test(text)) return setError('Enter the number counted, like 12.');
      if (n === item.stock) return setError('That’s already the number on hand.');
      adjustStock(item.id, { mode: 'count', counted: n }, 'count', note);
      setDone(`Set to ${n}.`);
    } else if (reason === 'waste') {
      if (!/^\d+$/.test(text) || n === 0) return setError('Enter how many units were lost, like 2.');
      if (n > item.stock) return setError(`Only ${item.stock} on hand.`);
      if (!note.trim()) return setError('Say what happened — spoiled, dropped, expired.');
      adjustStock(item.id, { mode: 'change', change: -n }, 'waste', note);
      setDone(`${n} written off.`);
    } else {
      if (!/^-?\d+$/.test(text) || n === 0) return setError('Enter units to add, or a minus to remove, like -3.');
      if (item.stock + n < 0) return setError(`Only ${item.stock} on hand.`);
      if (!note.trim()) return setError('Say what the correction is for.');
      adjustStock(item.id, { mode: 'change', change: n }, 'correction', note);
      setDone(`${n > 0 ? '+' : ''}${n} applied.`);
    }
    setAmount('');
    setNote('');
    setError(null);
  }

  return (
    <>
      <div className="inv-panel__head">
        <div>
          <h2 className="inv-panel__title">{item.name}</h2>
          <div className="inv-panel__sub">{supplierName}</div>
        </div>
        <Button variant="secondary" size="sm" onClick={() => navigate(`/items/${item.id}`)}>
          Edit item
        </Button>
      </div>

      <div>
        <div className="inv-big">{item.stock}</div>
        <div className="inv-panel__sub">
          on hand · warn at {item.lowStockAt ?? settings.lowStockDefault}
          {item.parLevel !== undefined && ` · reorder to ${item.parLevel}`}
        </div>
      </div>

      <div className="inv-panel__section">
        <h3 className="inv-panel__section-title">Adjust stock</h3>
        <div className="inv-form">
          <label className="inv-field">
            Reason
            <select
              className="inv-select"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value as typeof reason);
                setError(null);
                setDone(null);
              }}
            >
              {ADJUST_REASONS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
            <span className="inv-field__hint">{hint}</span>
          </label>
          <label className="inv-field">
            {reason === 'count' ? 'Counted on the shelf' : reason === 'waste' ? 'Units lost' : 'Units to add (or -remove)'}
            <input
              className="inv-input inv-input--num"
              inputMode="numeric"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setError(null);
                setDone(null);
              }}
              aria-invalid={error !== null}
            />
          </label>
          <label className="inv-field">
            Note {reason === 'count' && <span className="inv-field__hint">(optional)</span>}
            <input
              className="inv-input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={reason === 'waste' ? 'e.g. dropped tray' : ''}
            />
          </label>
          {error && (
            <p className="inv-error" role="alert">
              {error}
            </p>
          )}
          {done && (
            <p className="inv-note" role="status">
              {done} Logged in the history below.
            </p>
          )}
          <Button size="sm" onClick={save}>
            Save adjustment
          </Button>
        </div>
      </div>

      <div className="inv-panel__section">
        <h3 className="inv-panel__section-title">History</h3>
        {history.length === 0 ? (
          <p className="inv-note">No changes logged yet.</p>
        ) : (
          <ul className="inv-history">
            {history.map((m) => (
              <li key={m.id}>
                <span className="inv-history__what">
                  {MOVEMENT_LABEL[m.reason]}
                  {m.ref && <span className="inv-soft"> · {m.ref}</span>}
                </span>
                <span className="inv-history__change">
                  <Mono className={m.change > 0 ? 'inv-plus' : 'inv-minus'}>
                    {m.reason === 'opening' ? m.change : `${m.change > 0 ? '+' : ''}${m.change}`}
                  </Mono>
                  <span className="inv-history__after">
                    → <Mono>{m.stockAfter}</Mono>
                  </span>
                </span>
                <span className="inv-history__meta">
                  {formatDay(m.date)} · <Mono>{m.time}</Mono> · {who(m.staffId)}
                  {m.note && ` · “${m.note}”`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
