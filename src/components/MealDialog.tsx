import { useEffect, useRef, useState } from 'react';
import './MealDialog.css';
import { courseOptions, coursePicks, type SetMeal } from '../data/deals';
import { STOCK_SLACK, addOnOptions, type CatalogItem } from '../data/catalog';
import { itemQuantities, type CourseAddOn } from '../lib/cart';
import { usePos } from '../lib/store';
import { AddOnPrice } from './AddOnDialog';
import { Button } from './Button';
import { Money, Mono } from './Mono';

/**
 * Builds one set meal: a pick from each course the guest wants — or several,
 * where the course allows — any can be skipped — then onto the tab as a single
 * line at the meal's price, whichever items are picked. A pick whose category
 * offers sides or extras can have them too, at their add-on prices. Items
 * already on the tab count against what's on hand, so a pick or add-on that
 * would oversell is shown sold out.
 */
export function MealDialog({ meal, onClose }: { meal: SetMeal | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { catalog, categories, cart, addMeal } = usePos();
  // Each course's picks, by item id, in the order they were tapped.
  const [picks, setPicks] = useState<string[][]>([]);
  // The add-ons picked with each pick, by course and then the pick's item id.
  const [extras, setExtras] = useState<Record<string, string[]>[]>([]);
  const [error, setError] = useState<string | null>(null);

  /** Every add-on picked in course `course`. */
  const courseExtras = (course: number) => Object.values(extras[course] ?? {}).flat();

  const onTab = itemQuantities(cart);
  /**
   * How many of `item` are left, after the tab and this meal's picks and
   * add-ons — leaving out course `course`'s own picks and add-ons, which are
   * what's being chosen.
   */
  function left(item: CatalogItem, course: number): number {
    if (item.untracked) return Infinity;
    let used = 0;
    picks.forEach((ids, i) => {
      if (i === course) return;
      used += ids.filter((id) => id === item.id).length;
      used += courseExtras(i).filter((id) => id === item.id).length;
    });
    // Meals take whole units — a half left over doesn't make one.
    return Math.floor(item.stock - (onTab.get(item.id) ?? 0) - used + STOCK_SLACK);
  }
  const options = (course: number) =>
    meal ? courseOptions(meal.courses[course], catalog).filter((i) => i.available) : [];

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (meal && !dialog.open) dialog.showModal();
    if (!meal && dialog.open) dialog.close();
    // Nothing's picked to start with: every course is the guest's choice, skipping included.
    setPicks(meal ? meal.courses.map(() => []) : []);
    setExtras(meal ? meal.courses.map(() => ({})) : []);
    setError(null);
    // Reset only when a different meal opens, not as the tab changes underneath.
  }, [meal]);

  const chosen = picks.map((ids) =>
    ids.map((id) => catalog.find((i) => i.id === id)).filter((i): i is CatalogItem => !!i),
  );
  const coursesPicked = chosen.filter((items) => items.length > 0).length;
  const everyCourse = !!meal && coursesPicked === meal.courses.length;
  /** What `item`, picked in a course, can come with. */
  const addOnsFor = (item: CatalogItem) => addOnOptions(item, categories, catalog);
  const addOns: CourseAddOn[][][] = chosen.map((items, ci) =>
    items.map((item) =>
      addOnsFor(item)
        .filter((o) => extras[ci]?.[item.id]?.includes(o.item.id))
        .map((o) => ({ itemId: o.item.id, name: o.item.name, price: o.price })),
    ),
  );
  const extra = addOns.flat(2).reduce((sum, a) => sum + a.price, 0);

  /**
   * Whether one more of `item` fits in course `course` — counting that
   * course's picks and add-ons too.
   */
  function fits(item: CatalogItem, course: number): boolean {
    const own =
      (picks[course] ?? []).filter((id) => id === item.id).length +
      courseExtras(course).filter((id) => id === item.id).length;
    return left(item, course) - own > 0;
  }

  /**
   * Picks `itemId` for the course or, tapped again, takes it off. A course that
   * allows one pick swaps it; one that allows more adds it, up to its limit.
   */
  function pick(course: number, itemId: string) {
    if (!meal) return;
    const current = picks[course] ?? [];
    const max = coursePicks(meal.courses[course]);
    let next: string[];
    if (current.includes(itemId)) next = current.filter((id) => id !== itemId);
    else if (max === 1) next = [itemId];
    else if (current.length < max) next = [...current, itemId];
    else return;
    // A pick that's gone takes its add-ons with it.
    setExtras((prev) =>
      prev.map((e, i) =>
        i === course ? Object.fromEntries(Object.entries(e).filter(([id]) => next.includes(id))) : e,
      ),
    );
    setPicks((prev) => prev.map((ids, i) => (i === course ? next : ids)));
    setError(null);
  }

  function toggleExtra(course: number, pickId: string, itemId: string) {
    setExtras((prev) =>
      prev.map((e, i) => {
        if (i !== course) return e;
        const own = e[pickId] ?? [];
        return { ...e, [pickId]: own.includes(itemId) ? own.filter((id) => id !== itemId) : [...own, itemId] };
      }),
    );
    setError(null);
  }

  function add() {
    if (!meal || coursesPicked === 0) return;
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
                {meal.description ??
                  `${meal.courses.some((c) => coursePicks(c) > 1) ? 'Picks' : 'Up to one'} from each of ${meal.courses.length} courses — skip any the guest doesn’t want`}
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
            const max = coursePicks(course);
            const mine = picks[ci] ?? [];
            const full = max > 1 && mine.length >= max;
            return (
              <fieldset className="meal-course" key={ci}>
                <legend className="meal-course__name">
                  {course.name}
                  {max > 1 && (
                    <span className="meal-course__limit">
                      {' '}
                      · <Mono>{mine.length}</Mono> of up to <Mono>{max}</Mono>
                    </span>
                  )}
                </legend>
                {opts.length === 0 ? (
                  <p className="meal-course__empty">Nothing on offer for this course right now.</p>
                ) : (
                  <div className="meal-course__options">
                    {opts.map((item) => {
                      const selected = mine.includes(item.id);
                      const soldOut = !selected && !fits(item, ci);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className={
                            selected ? 'meal-option meal-option--selected' : 'meal-option'
                          }
                          onClick={() => pick(ci, item.id)}
                          disabled={soldOut || (!selected && full)}
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
                {chosen[ci]?.map((picked) => {
                  const offers = addOnsFor(picked);
                  if (offers.length === 0) return null;
                  const own = extras[ci]?.[picked.id] ?? [];
                  return (
                    <div
                      key={picked.id}
                      className="meal-course__addons"
                      role="group"
                      aria-label={`With ${picked.name}`}
                    >
                      <span className="meal-course__addons-label">With {picked.name}</span>
                      <div className="meal-course__options">
                        {offers.map((o) => {
                          const selected = own.includes(o.item.id);
                          const soldOut = !selected && !fits(o.item, ci);
                          return (
                            <button
                              key={o.item.id}
                              type="button"
                              className={selected ? 'meal-option meal-option--selected' : 'meal-option'}
                              onClick={() => toggleExtra(ci, picked.id, o.item.id)}
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
                  );
                })}
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
                    <Mono>{coursesPicked}</Mono> of{' '}
                    <Mono>{meal.courses.length}</Mono> courses picked
                  </>
                )}
              </span>
            </div>
            <Button size="lg" onClick={add} disabled={coursesPicked === 0}>
              Add to tab
            </Button>
          </footer>
        </div>
      )}
    </dialog>
  );
}
