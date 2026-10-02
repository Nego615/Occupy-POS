import { useEffect, useRef, useState } from 'react';
import './MealDialog.css';
import { courseOptions, type SetMeal } from '../data/deals';
import type { CatalogItem } from '../data/catalog';
import { itemQuantities } from '../lib/cart';
import { usePos } from '../lib/store';
import { Button } from './Button';
import { Money, Mono } from './Mono';

/**
 * Builds one set meal: a pick from each course, then onto the tab as a single
 * line at the meal's price. Items already on the tab count against what's on
 * hand, so a pick that would oversell is shown sold out.
 */
export function MealDialog({ meal, onClose }: { meal: SetMeal | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { catalog, cart, addMeal } = usePos();
  const [picks, setPicks] = useState<(string | null)[]>([]);
  const [error, setError] = useState<string | null>(null);

  const onTab = itemQuantities(cart);
  /** How many of `item` are left to pick, after the tab and the other courses' picks. */
  function left(item: CatalogItem, course: number): number {
    const elsewhere = picks.filter((id, i) => i !== course && id === item.id).length;
    return item.stock - (onTab.get(item.id) ?? 0) - elsewhere;
  }
  const options = (course: number) =>
    meal ? courseOptions(meal.courses[course], catalog).filter((i) => i.available) : [];

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (meal && !dialog.open) dialog.showModal();
    if (!meal && dialog.open) dialog.close();
    // A course with only one thing on offer is picked already.
    setPicks(
      meal
        ? meal.courses.map((_, i) => {
            const opts = options(i);
            return opts.length === 1 && left(opts[0], i) > 0 ? opts[0].id : null;
          })
        : [],
    );
    setError(null);
    // Reset only when a different meal opens, not as the tab changes underneath.
  }, [meal]);

  const chosen = picks.map((id) => catalog.find((i) => i.id === id));
  const complete = !!meal && picks.length === meal.courses.length && chosen.every(Boolean);
  const worth = complete ? chosen.reduce((sum, i) => sum + i!.price, 0) : null;

  function pick(course: number, itemId: string) {
    setPicks((prev) => prev.map((id, i) => (i === course ? itemId : id)));
    setError(null);
  }

  function add() {
    if (!meal || !complete) return;
    if (addMeal(meal, chosen as CatalogItem[])) onClose();
    else setError('Not enough on hand for those picks — choose something else.');
  }

  return (
    <dialog
      ref={ref}
      className="meal-dialog"
      aria-labelledby="meal-title"
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      {meal && (
        <div className="meal-dialog__body">
          <header className="meal-dialog__head">
            <div>
              <h2 id="meal-title" className="meal-dialog__title">
                {meal.name}
              </h2>
              <div className="meal-dialog__sub">
                {meal.description ?? `One from each of ${meal.courses.length} courses`}
              </div>
            </div>
            <button
              type="button"
              className="meal-dialog__close"
              onClick={onClose}
              aria-label="Close without adding"
            >
              <span aria-hidden="true">×</span>
            </button>
          </header>

          {meal.courses.map((course, ci) => {
            const opts = options(ci);
            return (
              <fieldset className="meal-course" key={ci}>
                <legend className="meal-course__name">{course.name}</legend>
                {opts.length === 0 ? (
                  <p className="meal-course__empty">Nothing on offer for this course right now.</p>
                ) : (
                  <div className="meal-course__options">
                    {opts.map((item) => {
                      const selected = picks[ci] === item.id;
                      const soldOut = !selected && left(item, ci) <= 0;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className={
                            selected ? 'meal-option meal-option--selected' : 'meal-option'
                          }
                          onClick={() => pick(ci, item.id)}
                          disabled={soldOut}
                          aria-pressed={selected}
                        >
                          <span className="meal-option__name">{item.name}</span>
                          <span className="meal-option__note">
                            {soldOut ? 'Sold out' : <Money value={item.price} />}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </fieldset>
            );
          })}

          {error && (
            <p className="meal-dialog__error" role="alert">
              {error}
            </p>
          )}

          <footer className="meal-dialog__foot">
            <div className="meal-dialog__price">
              <Money value={meal.price} className="meal-dialog__amount" />
              <span className="meal-dialog__worth">
                {worth !== null ? (
                  worth > meal.price ? (
                    <>
                      Saves <Money value={worth - meal.price} /> on <Money value={worth} />
                    </>
                  ) : (
                    'Set price'
                  )
                ) : (
                  <>
                    <Mono>{picks.filter(Boolean).length}</Mono> of{' '}
                    <Mono>{meal.courses.length}</Mono> courses picked
                  </>
                )}
              </span>
            </div>
            <Button size="lg" onClick={add} disabled={!complete}>
              Add to tab
            </Button>
          </footer>
        </div>
      )}
    </dialog>
  );
}
