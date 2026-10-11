import { useState } from 'react';
import './Inventory.css';
import './Deals.css';
import { FilterSelect } from '../components/FilterSelect';
import { Mono } from '../components/Mono';
import { NO_CATEGORY, type CatalogItem } from '../data/catalog';
import { usePos } from '../lib/store';

/**
 * Picks catalog items — a set meal course's options, a category's add-ons —
 * grouped by category so a long catalog stays scannable. Every category starts
 * closed — tap its heading to open it, or pick it from the dropdown to see just
 * that one — and a whole category can go in in one tap, open or not.
 */
export function ItemPicker({
  catalog,
  selected,
  onChange,
  label,
  emptyNote,
}: {
  catalog: CatalogItem[];
  selected: string[];
  /** Puts `itemIds` in, or takes them out. */
  onChange: (itemIds: string[], on: boolean) => void;
  /** What's being picked for — "Main course", "Food add-ons". */
  label: string;
  /** Shown when "Picked so far" has nothing to show. */
  emptyNote: string;
}) {
  const { categories } = usePos();
  // 'all', 'picked', or a category id ('' for items whose category has gone).
  const [show, setShow] = useState('all');
  // Categories opened by their heading, while showing all of them.
  const [open, setOpen] = useState<Set<string>>(() => new Set());

  function toggle(id: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  // Items whose category has gone still show, under their own heading.
  const known = new Set(categories.map((c) => c.id));
  const groups = [...categories, { id: '', label: NO_CATEGORY }]
    .map((cat) => ({
      ...cat,
      items: catalog.filter((i) => (cat.id ? i.category === cat.id : !known.has(i.category))),
    }))
    .filter((g) => g.items.length > 0);

  const visible = groups
    .filter((g) => show === 'all' || show === 'picked' || g.id === show)
    .map((g) => (show === 'picked' ? { ...g, items: g.items.filter((i) => selected.includes(i.id)) } : g))
    .filter((g) => g.items.length > 0);

  return (
    <div className="deal-course__items" role="group" aria-label={`${label} options`}>
      {groups.length > 1 && (
        <FilterSelect value={show} onChange={setShow} label={`Show ${label} options from`}>
          <option value="all">All categories</option>
          <option value="picked">Picked so far ({selected.length})</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </FilterSelect>
      )}
      {visible.length === 0 && <p className="inv-note">{emptyNote}</p>}
      {visible.map((cat) => {
        const ids = cat.items.map((i) => i.id);
        const picked = ids.filter((id) => selected.includes(id)).length;
        const everything = picked === ids.length;
        // Narrowed by the dropdown, what was asked for shows straight away.
        const isOpen = show !== 'all' || open.has(cat.id);
        const heading = (
          <>
            {cat.label}
            {show !== 'picked' && picked > 0 && (
              <>
                {' '}
                · <Mono>{picked}</Mono> of <Mono>{ids.length}</Mono>
              </>
            )}
          </>
        );
        return (
          <div key={cat.id} className="deal-group">
            <span className="deal-group__label">
              {show === 'all' ? (
                <button
                  type="button"
                  className="deal-group__toggle"
                  aria-expanded={isOpen}
                  onClick={() => toggle(cat.id)}
                >
                  <span className="deal-group__caret" aria-hidden="true">
                    ▸
                  </span>
                  {heading}
                </button>
              ) : (
                <span className="inv-field__hint">{heading}</span>
              )}
              {show !== 'picked' && ids.length > 1 && (
                <button
                  type="button"
                  className="deal-link"
                  onClick={() => onChange(ids, !everything)}
                  aria-label={`${everything ? 'Remove all' : 'Add all'} ${cat.label} to ${label}`}
                >
                  {everything ? 'Remove all' : 'Add all'}
                </button>
              )}
            </span>
            {isOpen && (
              <div className="deal-chips">
                {cat.items.map((i) => {
                  const on = selected.includes(i.id);
                  return (
                    <button
                      key={i.id}
                      type="button"
                      className="deal-chip"
                      aria-pressed={on}
                      onClick={() => onChange([i.id], !on)}
                    >
                      {i.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
