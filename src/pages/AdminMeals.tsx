import { useState } from 'react';
import './Inventory.css';
import './Deals.css';
import { Button } from '../components/Button';
import { Money, Mono } from '../components/Mono';
import { StatusChip } from '../components/StatusChip';
import { Switch } from '../components/Switch';
import { NO_CATEGORY, type CatalogItem } from '../data/catalog';
import { mealWorth, type Course, type SetMeal } from '../data/deals';
import { activeCurrency, isAmountText } from '../lib/currency';
import { usePos } from '../lib/store';
import { useRevealPanel } from '../lib/useRevealPanel';

/** Tile dot colors on offer — the catalog's own palette. */
const MEAL_COLORS = ['#121212', '#ff4b2e', '#e0a300', '#1fae5c', '#0e7bd6', '#8a5cf6', '#8a5a2b'];

/** "TSh 28,500 – 33,000" bought separately, or one figure when every pick costs the same. */
function Worth({ range }: { range: [number, number] | null }) {
  if (!range) return <span className="inv-soft">—</span>;
  return range[0] === range[1] ? (
    <Money value={range[0]} />
  ) : (
    <>
      <Money value={range[0]} /> – <Money value={range[1]} />
    </>
  );
}

/**
 * Full meals sold at one price — a starter, main, dessert, and drink, say.
 * Each course offers a choice of catalog items; at the register the cashier
 * picks one from each and the meal goes on the tab as a single line.
 */
export function AdminMeals() {
  const { setMeals, createSetMeal, catalog, settings } = usePos();
  const [selectedId, setSelectedId] = useState<string | null>(setMeals[0]?.id ?? null);
  const panelRef = useRevealPanel<HTMLElement>(selectedId);

  function add() {
    const meal = createSetMeal({
      name: 'New set meal',
      price: 0,
      color: MEAL_COLORS[0],
      available: false,
      courses: [
        { name: 'Starter', itemIds: [] },
        { name: 'Main course', itemIds: [] },
        { name: 'Dessert', itemIds: [] },
        { name: 'Drink', itemIds: [] },
      ],
    });
    setSelectedId(meal.id);
  }

  const selected = setMeals.find((m) => m.id === selectedId) ?? null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Set meals</h1>
          <div className="page-sub">
            {settings.locationName} · <Mono>{setMeals.filter((m) => m.available).length}</Mono> on
            the register
          </div>
        </div>
        <div className="head-actions">
          <Button onClick={add}>New set meal</Button>
        </div>
      </div>

      <div className="inv-layout">
        <section className="panel inv-table-wrap" aria-label="Set meals">
          {setMeals.length === 0 ? (
            <p className="inv-panel__placeholder">
              No set meals yet — add one to sell several courses at one price.
            </p>
          ) : (
            <table className="inv-table">
              <thead>
                <tr>
                  <th scope="col">Set meal</th>
                  <th scope="col" className="num">
                    Price
                  </th>
                  <th scope="col" className="num">
                    Separately
                  </th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {setMeals.map((m) => {
                  const isSelected = m.id === selectedId;
                  return (
                    <tr
                      key={m.id}
                      className={isSelected ? 'inv-row inv-row--selected' : 'inv-row'}
                      onClick={() => setSelectedId(m.id)}
                    >
                      <td>
                        <button
                          type="button"
                          className="inv-row__pick"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedId(m.id);
                          }}
                          aria-pressed={isSelected}
                        >
                          <span className="inv-dot" style={{ background: m.color }} aria-hidden="true" />
                          <span>
                            {m.name}
                            <span className="inv-sub">{m.courses.map((c) => c.name).join(' · ')}</span>
                          </span>
                        </button>
                      </td>
                      <td className="num inv-strong">
                        <Money value={m.price} />
                      </td>
                      <td className="num inv-soft">
                        <Worth range={mealWorth(m, catalog)} />
                      </td>
                      <td>
                        {m.available ? (
                          <StatusChip status="open" size="sm">
                            On the register
                          </StatusChip>
                        ) : (
                          <StatusChip status="occupied" size="sm">
                            Hidden
                          </StatusChip>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        <aside ref={panelRef} className="inv-panel" aria-label="Set meal details">
          {selected ? (
            <MealPanel key={selected.id} meal={selected} onDeleted={() => setSelectedId(null)} />
          ) : (
            <p className="inv-panel__placeholder">Pick a set meal to edit it.</p>
          )}
        </aside>
      </div>
    </>
  );
}

function MealPanel({ meal, onDeleted }: { meal: SetMeal; onDeleted: () => void }) {
  const { catalog, saveSetMeal, deleteSetMeal } = usePos();
  const currency = activeCurrency();
  const initial = {
    name: meal.name,
    price: meal.price > 0 ? String(meal.price) : '',
    description: meal.description ?? '',
    color: meal.color,
    courses: meal.courses,
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

  function setCourse(index: number, patch: Partial<Course>) {
    set(
      'courses',
      draft.courses.map((c, i) => (i === index ? { ...c, ...patch } : c)),
    );
  }

  function toggleItem(index: number, itemId: string) {
    const ids = draft.courses[index].itemIds;
    setCourse(index, {
      itemIds: ids.includes(itemId) ? ids.filter((id) => id !== itemId) : [...ids, itemId],
    });
  }

  // What the draft would be worth bought separately, for the preview.
  const priceValue = isAmountText(draft.price.trim()) ? Number(draft.price) : null;
  const worth = mealWorth({ ...meal, courses: draft.courses }, catalog);

  function save() {
    const name = draft.name.trim();
    if (!name) return setError('Name can’t be empty.');
    if (priceValue === null || !(priceValue > 0)) {
      return setError(`Price is a ${currency.symbol} amount above zero.`);
    }
    if (draft.courses.length === 0) return setError('Add at least one course.');
    const courses = draft.courses.map((c) => ({ ...c, name: c.name.trim() }));
    if (courses.some((c) => !c.name)) return setError('Every course needs a name.');
    if (courses.some((c) => c.itemIds.length === 0)) {
      return setError('Every course needs at least one item to pick from.');
    }
    const description = draft.description.trim();
    saveSetMeal({
      ...meal,
      name,
      price: priceValue,
      color: draft.color,
      description: description || undefined,
      courses,
    });
    setDraft((d) => ({ ...d, name, description, price: String(priceValue), courses }));
    setSaved(true);
  }

  function remove() {
    if (!confirmDelete) return setConfirmDelete(true);
    deleteSetMeal(meal.id);
    onDeleted();
  }

  // Every course must offer something before the meal can go on the register.
  const ready = meal.price > 0 && meal.courses.length > 0 && meal.courses.every((c) => c.itemIds.length > 0);

  return (
    <>
      <div className="inv-panel__head">
        <div>
          <h2 className="inv-panel__title">{meal.name}</h2>
          <div className="inv-panel__sub">
            <Mono>{meal.courses.length}</Mono> {meal.courses.length === 1 ? 'course' : 'courses'} ·{' '}
            <Money value={meal.price} />
          </div>
        </div>
      </div>

      <div className="inv-panel__section">
        <div className="inv-panel__head">
          <div>
            <div className="inv-panel__section-title">On the register</div>
            <p className="inv-note">
              {ready
                ? 'Shown under Set meals on the register.'
                : 'Save a price and an item for every course first.'}
            </p>
          </div>
          <Switch
            checked={meal.available}
            onChange={(available) => saveSetMeal({ ...meal, available })}
            label={`${meal.name} on the register`}
            disabled={!ready && !meal.available}
          />
        </div>
      </div>

      <div className="inv-panel__section inv-form">
        <label className="inv-field">
          Name
          <input className="inv-input" value={draft.name} onChange={(e) => set('name', e.target.value)} />
        </label>
        <label className="inv-field">
          Description
          <span className="inv-field__hint">Optional — shown when it’s picked on the register.</span>
          <input
            className="inv-input"
            value={draft.description}
            onChange={(e) => set('description', e.target.value)}
          />
        </label>
        <label className="inv-field">
          Price
          <span className="inv-field__hint">One price for the whole meal, whatever’s picked.</span>
          <input
            className="inv-input inv-input--num"
            inputMode={currency.decimals === 0 ? 'numeric' : 'decimal'}
            placeholder={String(currency.example)}
            value={draft.price}
            onChange={(e) => set('price', e.target.value)}
          />
        </label>

        <div className="deal-group" role="group" aria-label="Tile color">
          Tile color
          <div className="deal-chips">
            {MEAL_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className="deal-chip"
                aria-pressed={draft.color === c}
                aria-label={`Color ${c}`}
                onClick={() => set('color', c)}
              >
                <span className="inv-dot" style={{ background: c }} aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>

        <div className="deal-group">
          Courses
          {draft.courses.map((course, ci) => (
            <div className="deal-course" key={ci}>
              <div className="deal-course__head">
                <input
                  className="inv-input inv-input--sm"
                  value={course.name}
                  onChange={(e) => setCourse(ci, { name: e.target.value })}
                  aria-label={`Course ${ci + 1} name`}
                />
                <button
                  type="button"
                  className="inv-remove"
                  onClick={() =>
                    set(
                      'courses',
                      draft.courses.filter((_, i) => i !== ci),
                    )
                  }
                  aria-label={`Remove ${course.name || `course ${ci + 1}`}`}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </div>
              <CourseItems
                catalog={catalog}
                selected={course.itemIds}
                onToggle={(id) => toggleItem(ci, id)}
                label={course.name || `Course ${ci + 1}`}
              />
            </div>
          ))}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => set('courses', [...draft.courses, { name: '', itemIds: [] }])}
          >
            Add course
          </Button>
        </div>

        {worth && priceValue !== null && priceValue > 0 && (
          <p className="deal-preview">
            Bought separately the picks come to <strong><Worth range={worth} /></strong>.{' '}
            {priceValue < worth[0] ? (
              <>
                The meal saves at least <strong><Money value={worth[0] - priceValue} /></strong>.
              </>
            ) : priceValue <= worth[1] ? (
              'Some combinations cost less separately than the meal price.'
            ) : (
              'The meal costs more than any combination bought separately.'
            )}
          </p>
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
          {confirmDelete ? 'Confirm delete' : 'Delete set meal'}
        </Button>
      </div>
    </>
  );
}

/** A course's item picker, grouped by category so a long catalog stays scannable. */
function CourseItems({
  catalog,
  selected,
  onToggle,
  label,
}: {
  catalog: CatalogItem[];
  selected: string[];
  onToggle: (itemId: string) => void;
  label: string;
}) {
  const { categories } = usePos();
  // Items whose category has gone still show, under their own heading.
  const known = new Set(categories.map((c) => c.id));
  const groups = [...categories, { id: '', label: NO_CATEGORY }];
  return (
    <div className="deal-course__items" role="group" aria-label={`${label} options`}>
      {groups.map((cat) => {
        const items = catalog.filter((i) => (cat.id ? i.category === cat.id : !known.has(i.category)));
        if (items.length === 0) return null;
        return (
          <div key={cat.id} className="deal-group">
            <span className="inv-field__hint">{cat.label}</span>
            <div className="deal-chips">
              {items.map((i) => (
                <button
                  key={i.id}
                  type="button"
                  className="deal-chip"
                  aria-pressed={selected.includes(i.id)}
                  onClick={() => onToggle(i.id)}
                >
                  {i.name}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
