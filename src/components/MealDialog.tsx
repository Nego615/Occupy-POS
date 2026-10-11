import { useEffect, useRef, useState } from 'react';
import './MealDialog.css';
import { courseOptions, type SetMeal } from '../data/deals';
import { STOCK_SLACK, addOnOptions, type CatalogItem } from '../data/catalog';
import { itemQuantities, type CourseAddOn } from '../lib/cart';
import { usePos } from '../lib/store';
import { AddOnPrice } from './AddOnDialog';
import { Button } from './Button';
import { Money, Mono } from './Mono';

/**
 * Builds one set meal: a pick from each course the guest wants — any can be
 * skipped — then onto the tab as a single line at the meal's price, whichever
 * items are picked. A pick whose category
 * offers sides or extras can have them too, at their add-on prices. Items
 * already on the tab count against what's on hand, so a pick or add-on that
 * would oversell is shown sold out.
 */
export function MealDialog({ meal, onClose }: { meal: SetMeal | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { catalog, categories, cart, addMeal } = usePos();
  const [picks, setPicks] = useState<(string | null)[]>([]);
  // The add-ons picked with each course's pick, by item id.
  const [extras, setExtras] = useState<string[][]>([]);
  const [error, setError] = useState<string | null>(null);

  const onTab = itemQuantities(cart);
  /**
   * How many of `item` are left, after the tab and this meal's picks and
   * add-ons — leaving out course `course`'s own pick and add-ons, which are
   * what's being chosen.
   */
  function left(item: CatalogItem, course: number): number {
    const picked = picks.filter((id, i) => i !== course && id === item.id).length;
    const added = extras.filter((_, i) => i !== course).flat().filter((id) => id === item.id).length;
    // Meals take whole units — a half left over doesn't make one.
    return Math.floor(item.stock - (onTab.get(item.id) ?? 0) - picked - added + STOCK_SLACK);
  }
  const options = (course: number) =>
    meal ? courseOptions(meal.courses[course], catalog).filter((i) => i.available) : [];

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (meal && !dialog.open) dialog.showModal();
    if (!meal && dialog.open) dialog.close();
    // Nothing's picked to start with: every course is the guest's choice, skipping included.
    setPicks(meal ? meal.courses.map(() => null) : []);
    setExtras(meal ? meal.courses.map(() => []) : []);
    setError(null);
    // Reset only when a different meal opens, not as the tab changes underneath.
  }, [meal]);

  const chosen = picks.map((id) => catalog.find((i) => i.id === id) ?? null);
  const pickedCount = chosen.filter(Boolean).length;
  const everyCourse = !!meal && pickedCount === meal.courses.length;
  /** What course `course`'s pick can come with. */
  const addOnsFor = (course: number) => {
    const item = chosen[course];
    return item ? addOnOptions(item, categories, catalog) : [];
  };
  const addOns: CourseAddOn[][] = chosen.map((_, ci) =>
    addOnsFor(ci)
      .filter((o) => extras[ci]?.includes(o.item.id))
      .map((o) => ({ itemId: o.item.id, name: o.item.name, price: o.price })),
  );
  const extra = addOns.flat().reduce((sum, a) => sum + a.price, 0);

  /**
   * Whether one more of `item` fits as an add-on in course `course` — counting
   * that course's pick and other add-ons too.
   */
  function addOnFits(item: CatalogItem, course: number): boolean {
    const own = (picks[course] === item.id ? 1 : 0) + (extras[course] ?? []).filter((id) => id === item.id).length;
    return left(item, course) - own > 0;
  }

  /** Picks `itemId` for the course — or, tapped again, skips the course. */
  function pick(course: number, itemId: string) {
    const next = picks[course] === itemId ? null : itemId;
    // A different pick, or none, starts with no add-ons.
    setExtras((prev) => prev.map((e, i) => (i === course ? [] : e)));
    setPicks((prev) => prev.map((id, i) => (i === course ? next : id)));
    setError(null);
  }

  function toggleExtra(course: number, itemId: string) {
    setExtras((prev) =>
      prev.map((e, i) => (i !== course ? e : e.includes(itemId) ? e.filter((id) => id !== itemId) : [...e, itemId])),
    );
    setError(null);
  }

  function add() {
    if (!meal || pickedCount === 0) return;
    if (addMeal(meal, chosen, addOns)) onClose();
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
                {meal.description ?? `Up to one from each of ${meal.courses.length} courses — skip any the guest doesn’t want`}
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
                          {/* No item prices — whatever's picked, the meal costs its own price. */}
                          {soldOut && <span className="meal-option__note">Sold out</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
                {addOnsFor(ci).length > 0 && (
                  <div className="meal-course__addons" role="group" aria-label={`With ${chosen[ci]!.name}`}>
                    <span className="meal-course__addons-label">With {chosen[ci]!.name}</span>
                    <div className="meal-course__options">
                      {addOnsFor(ci).map((o) => {
                        const selected = !!extras[ci]?.includes(o.item.id);
                        const soldOut = !selected && !addOnFits(o.item, ci);
                        return (
                          <button
                            key={o.item.id}
                            type="button"
                            className={selected ? 'meal-option meal-option--selected' : 'meal-option'}
                            onClick={() => toggleExtra(ci, o.item.id)}
                            disabled={soldOut}
                            aria-pressed={selected}
                          >
                            <span className="meal-option__name">{o.item.name}</span>
                            <span className="meal-option__note">
                              {soldOut ? 'Sold out' : <AddOnPrice price={o.price} />}
                            </span>
                          </button>
                        );
                      })}
                    </div>
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
              <Money value={meal.price + extra} className="meal-dialog__amount" />
              <span className="meal-dialog__worth">
                {everyCourse ? (
                  extra > 0 ? (
                    'Set price, plus add-ons'
                  ) : (
                    'Set price, whatever’s picked'
                  )
                ) : (
                  <>
                    <Mono>{picks.filter(Boolean).length}</Mono> of{' '}
                    <Mono>{meal.courses.length}</Mono> courses picked
                  </>
                )}
              </span>
            </div>
            <Button size="lg" onClick={add} disabled={pickedCount === 0}>
              Add to tab
            </Button>
          </footer>
        </div>
      )}
    </dialog>
  );
}
