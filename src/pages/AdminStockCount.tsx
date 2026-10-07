import { useMemo, useState } from 'react';
import './Inventory.css';
import { Button } from '../components/Button';
import { Money, Mono, formatMoney } from '../components/Mono';
import { SearchField } from '../components/SearchField';
import { formatDay, type StockCount } from '../data/inventory';
import { round } from '../lib/cart';
import { usePos } from '../lib/store';

/** Net value of a posted count's differences, at the cost when it was posted. */
export function countVariance(count: StockCount): { units: number; value: number; lines: number } {
  let units = 0;
  let value = 0;
  let lines = 0;
  for (const l of count.lines) {
    const diff = l.counted - l.expected;
    if (diff === 0) continue;
    lines++;
    units += diff;
    value += diff * (l.unitCost ?? 0);
  }
  return { units, value: round(value), lines };
}

/**
 * Stock counts — walk the shelves, enter what's there, and post the
 * differences as stock-count movements. A count can cover everything, one
 * category, or one supplier's items, and stays in progress if you leave the
 * page. Items left blank are skipped, not zeroed.
 */
export function AdminStockCount() {
  const { countDraft, stockCounts, settings } = usePos();
  const [viewing, setViewing] = useState<string | null>(null);
  const viewed = stockCounts.find((c) => c.id === viewing) ?? null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Stock count</h1>
          <div className="page-sub">
            {settings.locationName} · count the shelves and correct the system to match
          </div>
        </div>
      </div>

      {countDraft ? (
        <CountSheet onPosted={setViewing} />
      ) : (
        <div className="inv-layout">
          <div>
            <StartCount />
            <section className="panel inv-table-wrap count-history" aria-labelledby="past-counts">
              <h2 className="panel__title count-history__title" id="past-counts">
                Past counts
              </h2>
              {stockCounts.length === 0 ? (
                <p className="inv-empty">No counts posted yet.</p>
              ) : (
                <table className="inv-table">
                  <thead>
                    <tr>
                      <th scope="col">Count</th>
                      <th scope="col" className="num">
                        Counted
                      </th>
                      <th scope="col" className="num">
                        Off by
                      </th>
                      <th scope="col" className="num">
                        Value
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {stockCounts.map((c) => {
                      const v = countVariance(c);
                      return (
                        <tr
                          key={c.id}
                          className={c.id === viewing ? 'inv-row inv-row--selected' : 'inv-row'}
                          onClick={() => setViewing(c.id)}
                        >
                          <td>
                            <button
                              type="button"
                              className="inv-row__pick"
                              onClick={(e) => {
                                e.stopPropagation();
                                setViewing(c.id);
                              }}
                              aria-pressed={c.id === viewing}
                            >
                              <span>
                                {c.scope}
                                <span className="inv-sub">
                                  {formatDay(c.date)} · {c.by}
                                </span>
                              </span>
                            </button>
                          </td>
                          <td className="num">
                            <Mono>{c.lines.length}</Mono>
                          </td>
                          <td className="num">
                            <Mono>{v.lines}</Mono> {v.lines === 1 ? 'item' : 'items'}
                          </td>
                          <td className="num">
                            <Variance value={v.value} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </section>
          </div>

          <aside className="inv-panel" aria-label="Count details">
            {viewed ? (
              <CountRecord count={viewed} />
            ) : (
              <p className="inv-panel__placeholder">
                Pick a past count to see what was found, item by item.
              </p>
            )}
          </aside>
        </div>
      )}
    </>
  );
}

/* ---------- Starting a count ---------- */

function StartCount() {
  const { catalog, categories, suppliers, startCount } = usePos();
  const [scope, setScope] = useState('all');

  // "all", "cat:pastries", or "sup:dar-bakery".
  const options = useMemo(
    () => [
      { id: 'all', label: 'All items', ids: catalog.map((i) => i.id) },
      ...categories.map((c) => ({
        id: `cat:${c.id}`,
        label: c.label,
        ids: catalog.filter((i) => i.category === c.id).map((i) => i.id),
      })),
      ...suppliers.map((s) => ({
        id: `sup:${s.id}`,
        label: s.name,
        ids: catalog.filter((i) => i.supplierId === s.id).map((i) => i.id),
      })),
    ].filter((o) => o.ids.length > 0),
    [catalog, suppliers],
  );
  const chosen = options.find((o) => o.id === scope) ?? options[0];

  if (!chosen) {
    return (
      <section className="panel count-start" aria-labelledby="start-count">
        <h2 className="panel__title" id="start-count">
          Start a count
        </h2>
        <p className="inv-note">Add items to the menu first — there’s nothing to count yet.</p>
      </section>
    );
  }

  return (
    <section className="panel count-start" aria-labelledby="start-count">
      <h2 className="panel__title" id="start-count">
        Start a count
      </h2>
      <div className="count-start__row">
        <label className="inv-field count-start__field">
          What to count
          <select className="inv-select" value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="all">All items</option>
            <optgroup label="One category">
              {options
                .filter((o) => o.id.startsWith('cat:'))
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label} · {o.ids.length}
                  </option>
                ))}
            </optgroup>
            <optgroup label="One supplier’s items">
              {options
                .filter((o) => o.id.startsWith('sup:'))
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label} · {o.ids.length}
                  </option>
                ))}
            </optgroup>
          </select>
        </label>
        <Button onClick={() => startCount(chosen.label, chosen.ids)}>
          Count {chosen.ids.length} {chosen.ids.length === 1 ? 'item' : 'items'}
        </Button>
      </div>
      <p className="inv-note">
        Sales can carry on while you count — each item is compared with what’s on hand when you
        post, not when you started.
      </p>
    </section>
  );
}

/* ---------- The count sheet ---------- */

function CountSheet({ onPosted }: { onPosted: (countId: string) => void }) {
  const { catalog, countDraft, setCounted, postCount, discardCount } = usePos();
  const [query, setQuery] = useState('');
  const [onlyOff, setOnlyOff] = useState(false);
  const [confirming, setConfirming] = useState<'post' | 'discard' | null>(null);
  // Typed text per item, so a half-typed number isn't lost to parsing.
  const [text, setText] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(countDraft?.counted ?? {}).map(([id, n]) => [id, String(n)]),
    ),
  );

  const items = useMemo(
    () =>
      (countDraft?.itemIds ?? [])
        .map((id) => catalog.find((i) => i.id === id))
        .filter((i): i is NonNullable<typeof i> => i !== undefined),
    [countDraft, catalog],
  );
  if (!countDraft) return null;

  const counted = countDraft.counted;
  const diffOf = (id: string, stock: number) =>
    counted[id] === undefined ? null : counted[id] - stock;

  let doneCount = 0;
  let offCount = 0;
  let netValue = 0;
  for (const item of items) {
    const d = diffOf(item.id, item.stock);
    if (d === null) continue;
    doneCount++;
    if (d !== 0) offCount++;
    netValue += d * (item.cost ?? 0);
  }

  const q = query.trim().toLowerCase();
  const visible = items.filter((item) => {
    if (q && !item.name.toLowerCase().includes(q)) return false;
    if (onlyOff) {
      const d = diffOf(item.id, item.stock);
      return d !== null && d !== 0;
    }
    return true;
  });

  function enter(itemId: string, value: string) {
    setText((t) => ({ ...t, [itemId]: value }));
    setConfirming(null);
    const v = value.trim();
    setCounted(itemId, /^\d{1,5}$/.test(v) ? Number(v) : null);
  }

  function post() {
    if (confirming !== 'post') return setConfirming('post');
    const record = postCount();
    // The sheet closes; the page opens the posted record.
    if (record) onPosted(record.id);
  }

  return (
    <>
      <div className="inv-toolbar">
        <div>
          <strong>Counting: {countDraft.scope}</strong>
          <span className="inv-sub">
            Started {formatDay(countDraft.startedAt)} by {countDraft.startedBy} · blank means not
            counted
          </span>
        </div>
        <div className="inv-toolbar__right">
          <label className="count-only-off">
            <input type="checkbox" checked={onlyOff} onChange={(e) => setOnlyOff(e.target.checked)} />
            Only show differences
          </label>
          <SearchField value={query} onChange={setQuery} placeholder="Find an item" label="Find an item" />
        </div>
      </div>

      <section className="panel inv-table-wrap" aria-label="Count sheet">
        <table className="inv-table count-sheet">
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col" className="num">
                System says
              </th>
              <th scope="col" className="num">
                Counted
              </th>
              <th scope="col" className="num">
                Difference
              </th>
              <th scope="col" className="num">
                Value
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((item) => {
              const d = diffOf(item.id, item.stock);
              const typed = text[item.id] ?? '';
              const invalid = typed.trim() !== '' && !/^\d{1,5}$/.test(typed.trim());
              return (
                <tr key={item.id} className={d !== null && d !== 0 ? 'count-sheet__off' : undefined}>
                  <td>
                    <span className="inv-row__pick">
                      <span className="inv-dot" style={{ background: item.color }} aria-hidden="true" />
                      {item.name}
                    </span>
                  </td>
                  <td className="num">
                    <Mono>{item.stock}</Mono>
                  </td>
                  <td className="num">
                    <input
                      className="inv-input inv-input--num inv-input--sm count-sheet__input"
                      inputMode="numeric"
                      value={typed}
                      placeholder="—"
                      onChange={(e) => enter(item.id, e.target.value)}
                      aria-label={`Counted ${item.name}`}
                      aria-invalid={invalid}
                    />
                  </td>
                  <td className="num">
                    {d === null ? (
                      <span className="inv-soft">—</span>
                    ) : d === 0 ? (
                      <span className="inv-soft">Matches</span>
                    ) : (
                      <Mono className={d > 0 ? 'inv-plus' : 'inv-minus'}>{`${d > 0 ? '+' : ''}${d}`}</Mono>
                    )}
                  </td>
                  <td className="num">
                    {d !== null && d !== 0 && item.cost !== undefined ? (
                      <Variance value={d * item.cost} />
                    ) : (
                      <span className="inv-soft">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {visible.length === 0 && <p className="inv-empty">Nothing to show.</p>}
      </section>

      <div className="count-bar" aria-live="polite">
        <span className="count-bar__progress">
          <Mono>{doneCount}</Mono> of <Mono>{items.length}</Mono> counted · <Mono>{offCount}</Mono>{' '}
          {offCount === 1 ? 'difference' : 'differences'} · net <Variance value={netValue} />
        </span>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => (confirming === 'discard' ? discardCount() : setConfirming('discard'))}
        >
          {confirming === 'discard' ? 'Confirm discard' : 'Discard count'}
        </Button>
        <Button size="sm" onClick={post} disabled={doneCount === 0}>
          {confirming === 'post'
            ? `Confirm — adjust ${offCount} ${offCount === 1 ? 'item' : 'items'}`
            : 'Post count'}
        </Button>
      </div>
    </>
  );
}

/* ---------- A posted count ---------- */

function CountRecord({ count }: { count: StockCount }) {
  const v = countVariance(count);
  const off = count.lines.filter((l) => l.counted !== l.expected);
  return (
    <>
      <div className="inv-panel__head">
        <div>
          <h2 className="inv-panel__title">{count.scope}</h2>
          <div className="inv-panel__sub">
            <Mono>{count.id}</Mono> · {formatDay(count.date)} <Mono>{count.time}</Mono> · {count.by}
          </div>
        </div>
      </div>
      <dl className="inv-facts">
        <dt>Items counted</dt>
        <dd>
          <Mono>{count.lines.length}</Mono>
        </dd>
        <dt>Skipped</dt>
        <dd>
          <Mono>{count.skipped}</Mono>
        </dd>
        <dt>Didn’t match</dt>
        <dd>
          <Mono>{v.lines}</Mono>
        </dd>
        <dt>Net units</dt>
        <dd>
          <Mono>{`${v.units > 0 ? '+' : ''}${v.units}`}</Mono>
        </dd>
        <dt>Net value</dt>
        <dd>
          <Variance value={v.value} />
        </dd>
      </dl>
      <div className="inv-panel__section">
        <h3 className="inv-panel__section-title">Differences</h3>
        {off.length === 0 ? (
          <p className="inv-note">Everything counted matched the system.</p>
        ) : (
          <ul className="inv-history">
            {off.map((l) => {
              const d = l.counted - l.expected;
              return (
                <li key={l.itemId}>
                  <span className="inv-history__what">{l.name}</span>
                  <span className="inv-history__change">
                    <Mono className={d > 0 ? 'inv-plus' : 'inv-minus'}>{`${d > 0 ? '+' : ''}${d}`}</Mono>
                    {l.unitCost !== undefined && (
                      <span className="inv-history__after">{formatMoney(d * l.unitCost)}</span>
                    )}
                  </span>
                  <span className="inv-history__meta">
                    System <Mono>{l.expected}</Mono> · counted <Mono>{l.counted}</Mono>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}

/** A signed money difference: losses read as losses, gains in green. */
function Variance({ value }: { value: number }) {
  if (Math.abs(value) < 0.005) return <Money value={0} className="inv-soft" />;
  return (
    <span className={value > 0 ? 'inv-plus' : 'inv-minus'}>
      {value > 0 ? '+' : ''}
      <Money value={value} />
    </span>
  );
}
