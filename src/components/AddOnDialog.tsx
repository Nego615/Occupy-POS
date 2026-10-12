import { useEffect, useRef, useState } from 'react';
import './MealDialog.css';
import { WHOLE, addOnOptions, servings, type AddOnPick, type CatalogItem } from '../data/catalog';
import { bestPromo } from '../data/deals';
import { lineFits, portionLine, withAddOns } from '../lib/cart';
import { usePos } from '../lib/store';
import { Button } from './Button';
import { Money } from './Mono';

/** "+ TSh 1,000", or "Included" for a side that comes with the item. */
export function AddOnPrice({ price }: { price: number }) {
  return price > 0 ? (
    <>
      + <Money value={price} />
    </>
  ) : (
    <>Included</>
  );
}

/**
 * Rings up an item whose category offers sides or extras: its serving, if
 * it's sold in portions, and any add-ons, then onto the tab as one line at the
 * item's price plus theirs. Choices there isn't enough stock for are shown
 * sold out, counting what's already on the tab.
 */
export function AddOnDialog({ item, onClose }: { item: CatalogItem | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { catalog, categories, cart, promotions, addItem } = usePos();
  const [serving, setServing] = useState(WHOLE);
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (item && !dialog.open) dialog.showModal();
    if (!item && dialog.open) dialog.close();
    setServing(WHOLE);
    setPicked([]);
    setError(null);
  }, [item]);

  const options = item ? addOnOptions(item, categories, catalog) : [];
  const portions = item?.portions?.length ? servings(item) : null;
  const promo = item ? bestPromo(promotions, item, new Date(), categories) : null;
  /** The line this would add, for a serving and a set of add-ons. */
  const lineFor = (servingId: string, ids: string[]) =>
    item &&
    withAddOns(
      portionLine(item, portions?.find((s) => s.id === servingId) ?? null, promo),
      options
        .filter((o) => ids.includes(o.item.id))
        .map((o): AddOnPick => ({ itemId: o.item.id, name: o.item.name, price: o.price })),
    );
  const line = lineFor(serving, picked);
  const fits = (servingId: string, ids: string[]) => {
    const candidate = lineFor(servingId, ids);
    return !!candidate && lineFits(cart, candidate, catalog);
  };

  function toggle(id: string) {
    setPicked((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
    setError(null);
  }

  function add() {
    if (!item || !line) return;
    const portion = portions?.find((s) => s.id === serving);
    if (addItem(item, portion, line.addOns ?? [])) onClose();
    else setError('Not enough on hand for that — choose something else.');
  }

  return (
    <dialog
      ref={ref}
      className="meal-dialog"
      aria-labelledby="addon-title"
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      {item && line && (
        <div className="meal-dialog__body">
          <header className="meal-dialog__head">
            <div>
              <h2 id="addon-title" className="meal-dialog__title">
                {item.name}
              </h2>
              <div className="meal-dialog__sub">{item.description ?? 'Pick any sides or extras'}</div>
            </div>
            <button type="button" className="meal-dialog__close" onClick={onClose} aria-label="Close without adding">
              <span aria-hidden="true">×</span>
            </button>
          </header>

          {portions && (
            <fieldset className="meal-course">
              <legend className="meal-course__name">Serving</legend>
              <div className="meal-course__options">
                {portions.map((s) => {
                  const selected = serving === s.id;
                  const soldOut = !selected && !fits(s.id, picked);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      className={selected ? 'meal-option meal-option--selected' : 'meal-option'}
                      onClick={() => {
                        setServing(s.id);
                        setError(null);
                      }}
                      disabled={soldOut}
                      aria-pressed={selected}
                    >
                      <span className="meal-option__name">{s.label}</span>
                      <span className="meal-option__note">
                        {soldOut ? 'Not enough left' : <Money value={portionLine(item, s, promo).unitPrice} />}
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}

          <fieldset className="meal-course">
            <legend className="meal-course__name">Sides and extras</legend>
            <div className="meal-course__options">
              {options.map((o) => {
                const selected = picked.includes(o.item.id);
                const soldOut = !selected && !fits(serving, [...picked, o.item.id]);
                return (
                  <button
                    key={o.item.id}
                    type="button"
                    className={selected ? 'meal-option meal-option--selected' : 'meal-option'}
                    onClick={() => toggle(o.item.id)}
                    disabled={soldOut}
                    aria-pressed={selected}
                  >
                    <span className="meal-option__name">{o.item.name}</span>
                    <span className="meal-option__note">{soldOut ? 'Sold out' : <AddOnPrice price={o.price} />}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          {error && (
            <p className="meal-dialog__error" role="alert">
              {error}
            </p>
          )}

          <footer className="meal-dialog__foot">
            <div className="meal-dialog__price">
              <Money value={line.unitPrice} className="meal-dialog__amount" />
              <span className="meal-dialog__worth">
                {picked.length === 0
                  ? 'Nothing added yet'
                  : `With ${picked.length} ${picked.length === 1 ? 'add-on' : 'add-ons'}`}
              </span>
            </div>
            <Button size="lg" onClick={add} disabled={!fits(serving, picked)}>
              Add to tab
            </Button>
          </footer>
        </div>
      )}
    </dialog>
  );
}
