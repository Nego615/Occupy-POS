import { useState } from 'react';
import './Inventory.css';
import './Deals.css';
import { Button } from '../components/Button';
import { Mono } from '../components/Mono';
import { StatusChip } from '../components/StatusChip';
import { Switch } from '../components/Switch';
import { categoryLabel } from '../data/catalog';
import {
  WEEKDAYS,
  promoAmountLabel,
  promoRunning,
  scheduleLabel,
  scopeLabel,
  type Promotion,
} from '../data/deals';
import { activeCurrency, isAmountText } from '../lib/currency';
import { usePos } from '../lib/store';
import { useNow } from '../lib/useClock';
import { useRevealPanel } from '../lib/useRevealPanel';

/** Off, running right now, or waiting for its days and hours. */
function PromoStatus({ promo, at }: { promo: Promotion; at: Date }) {
  if (!promo.active) {
    return (
      <StatusChip status="refunded" size="sm">
        Off
      </StatusChip>
    );
  }
  return promoRunning(promo, at) ? (
    <StatusChip status="open" size="sm">
      Running now
    </StatusChip>
  ) : (
    <span className="inv-soft">Scheduled</span>
  );
}

/**
 * Automatic discounts — happy hour and the like. The register applies a
 * running promotion to matching items as they're rung up; there's nothing for
 * the cashier to key in.
 */
export function AdminPromotions() {
  const { promotions, createPromotion, settings, categories } = usePos();
  const at = new Date(useNow(30_000));
  const [selectedId, setSelectedId] = useState<string | null>(promotions[0]?.id ?? null);
  const panelRef = useRevealPanel<HTMLElement>(selectedId);

  function add() {
    const promo = createPromotion({
      name: 'New promotion',
      active: false,
      kind: 'percent',
      value: 0.1,
      categories: [],
      itemIds: [],
      days: [],
      start: null,
      end: null,
    });
    setSelectedId(promo.id);
  }

  const selected = promotions.find((p) => p.id === selectedId) ?? null;
  const runningCount = promotions.filter((p) => promoRunning(p, at)).length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Promotions</h1>
          <div className="page-sub">
            {settings.locationName} · <Mono>{runningCount}</Mono> running now
          </div>
        </div>
        <div className="head-actions">
          <Button onClick={add}>New promotion</Button>
        </div>
      </div>

      <div className="inv-layout">
        <section className="panel inv-table-wrap" aria-label="Promotions">
          {promotions.length === 0 ? (
            <p className="inv-panel__placeholder">
              No promotions yet — add one for happy hour or a daily deal.
            </p>
          ) : (
            <table className="inv-table">
              <thead>
                <tr>
                  <th scope="col">Promotion</th>
                  <th scope="col">Discount</th>
                  <th scope="col">Applies to</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {promotions.map((p) => {
                  const isSelected = p.id === selectedId;
                  return (
                    <tr
                      key={p.id}
                      className={isSelected ? 'inv-row inv-row--selected' : 'inv-row'}
                      onClick={() => setSelectedId(p.id)}
                    >
                      <td>
                        <button
                          type="button"
                          className="inv-row__pick"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedId(p.id);
                          }}
                          aria-pressed={isSelected}
                        >
                          <span>
                            {p.name}
                            <span className="inv-sub">{scheduleLabel(p)}</span>
                          </span>
                        </button>
                      </td>
                      <td className="inv-strong">{promoAmountLabel(p)}</td>
                      <td className="inv-soft">{scopeLabel(p, (id) => categoryLabel(categories, id))}</td>
                      <td>
                        <PromoStatus promo={p} at={at} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        <aside ref={panelRef} className="inv-panel" aria-label="Promotion details">
          {selected ? (
            <PromotionPanel
              key={selected.id}
              promo={selected}
              at={at}
              onDeleted={() => setSelectedId(null)}
            />
          ) : (
            <p className="inv-panel__placeholder">Pick a promotion to edit it.</p>
          )}
        </aside>
      </div>
    </>
  );
}

/** "16:00" for an <input type="time">, from minutes after midnight. */
function toTimeInput(minutes: number | null, fallback: string): string {
  if (minutes === null) return fallback;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function fromTimeInput(text: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!m) return null;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  return minutes < 24 * 60 ? minutes : null;
}

function PromotionPanel({
  promo,
  at,
  onDeleted,
}: {
  promo: Promotion;
  at: Date;
  onDeleted: () => void;
}) {
  const { catalog, categories, savePromotion, deletePromotion } = usePos();
  const currency = activeCurrency();
  const initial = {
    name: promo.name,
    kind: promo.kind,
    value: promo.kind === 'percent' ? String(Math.round(promo.value * 100)) : String(promo.value),
    everything: promo.categories.length === 0 && promo.itemIds.length === 0,
    categories: promo.categories,
    itemIds: promo.itemIds,
    days: promo.days,
    allDay: promo.start === null || promo.end === null,
    start: toTimeInput(promo.start, '16:00'),
    end: toTimeInput(promo.end, '18:00'),
  };
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  function set<K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setError(null);
    setSaved(false);
  }

  function toggle<T>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  function save() {
    const name = draft.name.trim();
    if (!name) return setError('Name can’t be empty.');
    const valueText = draft.value.trim();
    let value: number;
    if (draft.kind === 'percent') {
      if (!/^\d{1,3}$/.test(valueText) || Number(valueText) < 1 || Number(valueText) > 100) {
        return setError('Percent off is a whole number from 1 to 100.');
      }
      value = Number(valueText) / 100;
    } else {
      if (!isAmountText(valueText) || !(Number(valueText) > 0)) {
        return setError(`Amount off is a ${currency.symbol} amount above zero.`);
      }
      value = Number(valueText);
    }
    if (!draft.everything && draft.categories.length === 0 && draft.itemIds.length === 0) {
      return setError('Pick at least one category or item, or apply it to everything.');
    }
    let start: number | null = null;
    let end: number | null = null;
    if (!draft.allDay) {
      start = fromTimeInput(draft.start);
      end = fromTimeInput(draft.end);
      if (start === null || end === null) return setError('Set a start and end time.');
      if (start === end) return setError('Start and end can’t be the same time.');
    }
    const categories = draft.everything ? [] : draft.categories;
    // An item whose whole category is covered doesn't need listing too.
    const itemIds = draft.everything
      ? []
      : draft.itemIds.filter((id) => {
          const item = catalog.find((i) => i.id === id);
          return item && !categories.includes(item.category);
        });
    const days = draft.days.length === 7 ? [] : [...draft.days].sort((a, b) => a - b);
    savePromotion({ ...promo, name, kind: draft.kind, value, categories, itemIds, days, start, end });
    // Match the draft to what was stored, so it reads as saved.
    setDraft((d) => ({
      ...d,
      name,
      value: valueText,
      categories,
      itemIds,
      days,
      start: toTimeInput(start, '16:00'),
      end: toTimeInput(end, '18:00'),
    }));
    setSaved(true);
  }

  function remove() {
    if (!confirmDelete) return setConfirmDelete(true);
    deletePromotion(promo.id);
    onDeleted();
  }

  return (
    <>
      <div className="inv-panel__head">
        <div>
          <h2 className="inv-panel__title">{promo.name}</h2>
          <div className="inv-panel__sub">
            {promoAmountLabel(promo)} · {scheduleLabel(promo)}
          </div>
        </div>
        <PromoStatus promo={promo} at={at} />
      </div>

      <div className="inv-panel__section">
        <div className="inv-panel__head">
          <div>
            <div className="inv-panel__section-title">On</div>
            <p className="inv-note">
              While on, the register applies it by itself during its days and hours. Prices are
              locked in when an item is rung up.
            </p>
          </div>
          <Switch
            checked={promo.active}
            onChange={(active) => savePromotion({ ...promo, active })}
            label={`${promo.name} on`}
          />
        </div>
      </div>

      <div className="inv-panel__section inv-form">
        <label className="inv-field">
          Name
          <span className="inv-field__hint">Shown on the register and on receipts.</span>
          <input
            className="inv-input"
            value={draft.name}
            onChange={(e) => set('name', e.target.value)}
          />
        </label>

        <div className="deal-row">
          <label className="inv-field">
            Discount
            <select
              className="inv-select"
              value={draft.kind}
              onChange={(e) => set('kind', e.target.value as Promotion['kind'])}
            >
              <option value="percent">Percent off</option>
              <option value="amount">Amount off each</option>
            </select>
          </label>
          <label className="inv-field">
            {draft.kind === 'percent' ? '% off' : `${currency.symbol} off`}
            <input
              className="inv-input inv-input--num"
              inputMode={draft.kind === 'percent' || currency.decimals === 0 ? 'numeric' : 'decimal'}
              value={draft.value}
              onChange={(e) => set('value', e.target.value)}
            />
          </label>
        </div>

        <div className="deal-group" role="group" aria-label="Applies to">
          Applies to
          <div className="deal-chips">
            <button
              type="button"
              className="deal-chip"
              aria-pressed={draft.everything}
              onClick={() => set('everything', true)}
            >
              Everything
            </button>
            <button
              type="button"
              className="deal-chip"
              aria-pressed={!draft.everything}
              onClick={() => set('everything', false)}
            >
              Chosen categories &amp; items
            </button>
          </div>
        </div>

        {!draft.everything && (
          <>
            <div className="deal-group" role="group" aria-label="Categories">
              Categories
              <div className="deal-chips">
                {categories.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="deal-chip"
                    aria-pressed={draft.categories.includes(c.id)}
                    onClick={() => set('categories', toggle(draft.categories, c.id))}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="deal-group" role="group" aria-label="Items">
              <span className="deal-group__label">
                Items
                <span className="inv-field__hint">On top of the categories above</span>
              </span>
              <div className="deal-chips">
                {catalog
                  .filter((i) => !draft.categories.includes(i.category))
                  .map((i) => (
                    <button
                      key={i.id}
                      type="button"
                      className="deal-chip"
                      aria-pressed={draft.itemIds.includes(i.id)}
                      onClick={() => set('itemIds', toggle(draft.itemIds, i.id))}
                    >
                      {i.name}
                    </button>
                  ))}
              </div>
            </div>
          </>
        )}

        <div className="deal-group" role="group" aria-label="Days">
          <span className="deal-group__label">
            Days
            <span className="inv-field__hint">None picked runs every day</span>
          </span>
          <div className="deal-chips">
            {/* Monday first, the way a week reads on a rota. */}
            {[1, 2, 3, 4, 5, 6, 0].map((d) => (
              <button
                key={d}
                type="button"
                className="deal-chip"
                aria-pressed={draft.days.includes(d)}
                onClick={() => set('days', toggle(draft.days, d))}
              >
                {WEEKDAYS[d]}
              </button>
            ))}
          </div>
        </div>

        <div className="deal-group" role="group" aria-label="Hours">
          Hours
          <div className="deal-chips">
            <button
              type="button"
              className="deal-chip"
              aria-pressed={draft.allDay}
              onClick={() => set('allDay', true)}
            >
              All day
            </button>
            <button
              type="button"
              className="deal-chip"
              aria-pressed={!draft.allDay}
              onClick={() => set('allDay', false)}
            >
              Set hours
            </button>
          </div>
        </div>

        {!draft.allDay && (
          <div className="deal-row">
            <label className="inv-field">
              Starts
              <input
                className="inv-input"
                type="time"
                value={draft.start}
                onChange={(e) => set('start', e.target.value)}
              />
            </label>
            <label className="inv-field">
              Ends
              <input
                className="inv-input"
                type="time"
                value={draft.end}
                onChange={(e) => set('end', e.target.value)}
              />
            </label>
          </div>
        )}

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
          Save changes
        </Button>
      </div>

      <div className="inv-panel__section">
        <Button
          variant="secondary"
          size="sm"
          block
          className={confirmDelete ? 'deal-delete--confirm' : undefined}
          onClick={remove}
          onBlur={() => setConfirmDelete(false)}
        >
          {confirmDelete ? 'Confirm delete' : 'Delete promotion'}
        </Button>
      </div>
    </>
  );
}
