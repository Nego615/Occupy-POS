import { useState, type CSSProperties, type FormEvent } from 'react';
import { Link } from 'react-router';
import './Inventory.css';
import './AdminCategories.css';
import { Button } from '../components/Button';
import { Money, Mono } from '../components/Mono';
import { categoryLineage, categoryPath, categoryTree, type AddOn, type Category } from '../data/catalog';
import { activeCurrency, isAmountText } from '../lib/currency';
import { usePos } from '../lib/store';
import { ItemPicker } from './ItemPicker';

/** Trimmed, with runs of spaces collapsed — how a category name is stored. */
function tidy(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

/**
 * Why `name` can't be used for a category inside `parentId` (top level for
 * none), other than `exceptId`, or null if it can. Names only need to differ
 * from the categories alongside — Food › Other and Drinks › Other can both be.
 */
function nameProblem(
  name: string,
  categories: Category[],
  parentId: string | undefined,
  exceptId?: string,
): string | null {
  if (!name) return 'Give the category a name.';
  const clash = categories.some(
    (c) =>
      c.id !== exceptId &&
      (c.parentId ?? '') === (parentId ?? '') &&
      c.label.toLowerCase() === name.toLowerCase(),
  );
  if (!clash) return null;
  return parentId
    ? `${categoryPath(categories, parentId)} already has ${name} — pick a different name.`
    : `${name} already exists — pick a different name.`;
}

/**
 * The categories items are sorted into — the shelves along the top of the
 * register, and the headings in reports. Renames apply everywhere at once; a
 * category can only be deleted once no item or category is in it. Any can sit
 * inside another — Sodas and Wines inside Drinks. Each can offer add-ons:
 * sides and extras rung up with any of its items.
 */
export function AdminCategories() {
  const { categories, catalog, createCategory, settings } = usePos();
  const [name, setName] = useState('');
  const [parent, setParent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const tree = categoryTree(categories);

  function add(e: FormEvent) {
    e.preventDefault();
    const label = tidy(name);
    const parentId = categories.some((c) => c.id === parent) ? parent : undefined;
    const problem = nameProblem(label, categories, parentId);
    if (problem) return setError(problem);
    createCategory(label, parentId);
    setName('');
    setError(null);
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Categories</h1>
          <div className="page-sub">
            {settings.locationName} · the shelves on the register, in this order
          </div>
        </div>
      </div>

      <section className="panel categories" aria-labelledby="categories-title">
        <h2 className="panel__title" id="categories-title">
          <Mono>{categories.length}</Mono> {categories.length === 1 ? 'category' : 'categories'}
        </h2>

        <form className="category-add" onSubmit={add} noValidate>
          <label className="sr-only" htmlFor="category-new">
            New category name
          </label>
          <input
            id="category-new"
            className="category-input"
            type="text"
            placeholder="New category, e.g. Smoothies"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            aria-invalid={error !== null}
            aria-describedby={error ? 'category-new-error' : undefined}
          />
          {categories.length > 0 && (
            <ParentSelect
              id="category-new-parent"
              label="Inside"
              value={parent}
              options={tree}
              onChange={setParent}
            />
          )}
          <Button type="submit">{parent ? 'Add sub-category' : 'Add category'}</Button>
          {error && (
            <p className="category-error" id="category-new-error" role="alert">
              {error}
            </p>
          )}
        </form>

        {categories.length === 0 ? (
          <p className="categories__empty">
            No categories yet. Add one above, then put items in it from the item editor.
          </p>
        ) : (
          tree.map(({ category, depth }) => (
            <CategoryRow
              key={category.id}
              category={category}
              depth={depth}
              itemCount={catalog.filter((i) => i.category === category.id).length}
            />
          ))
        )}
      </section>
    </>
  );
}

/**
 * Picks the category another sits inside — "Top level" or any category,
 * indented under its own parent. `exceptId` and those inside it are left out,
 * since a category can't go inside itself.
 */
function ParentSelect({
  id,
  label,
  value,
  options,
  onChange,
  exceptId,
}: {
  id: string;
  label: string;
  value: string;
  options: { category: Category; depth: number }[];
  onChange: (parentId: string) => void;
  exceptId?: string;
}) {
  const { categories } = usePos();
  const allowed = options.filter(
    ({ category }) => !exceptId || !categoryLineage(categories, category.id).includes(exceptId),
  );
  return (
    <label className="category-parent" htmlFor={id}>
      <span className="category-parent__label">{label}</span>
      <select id={id} className="category-select" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Top level</option>
        {allowed.map(({ category, depth }) => (
          <option key={category.id} value={category.id}>
            {'  '.repeat(depth)}
            {category.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function CategoryRow({ category, depth, itemCount }: { category: Category; depth: number; itemCount: number }) {
  const { categories, renameCategory, moveCategory, deleteCategory } = usePos();
  const [draft, setDraft] = useState(category.label);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [editingAddOns, setEditingAddOns] = useState(false);
  const addOnCount = category.addOns?.length ?? 0;
  const errorId = `category-error-${category.id}`;
  const subCount = categories.filter((c) => c.parentId === category.id).length;
  const inUse = itemCount > 0 || subCount > 0;
  // A parent deleted on another screen leaves it at the top level.
  const parentId = categories.some((c) => c.id === category.parentId) ? category.parentId : undefined;

  function commit() {
    const label = tidy(draft);
    const problem = nameProblem(label, categories, parentId, category.id);
    if (problem) {
      setError(problem);
      setDraft(category.label);
      return;
    }
    setError(null);
    setDraft(label);
    if (label !== category.label) renameCategory(category.id, label);
  }

  function remove() {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    deleteCategory(category.id);
  }

  function move(to: string) {
    const problem = nameProblem(category.label, categories, to || undefined, category.id);
    if (problem) return setError(problem);
    setError(null);
    moveCategory(category.id, to || null);
  }

  return (
    <div className="category-item" style={{ '--depth': depth } as CSSProperties}>
      <div className="category-row">
        <div className="category-row__main">
          <label className="sr-only" htmlFor={`category-name-${category.id}`}>
            Name
          </label>
          <input
            id={`category-name-${category.id}`}
            className="category-input"
            type="text"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
            }}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') {
                setDraft(category.label);
                setError(null);
              }
            }}
            aria-invalid={error !== null}
            aria-describedby={error ? errorId : undefined}
          />
          {error && (
            <p className="category-error" id={errorId}>
              {error}
            </p>
          )}
        </div>

        <ParentSelect
          id={`category-parent-${category.id}`}
          label="Inside"
          value={parentId ?? ''}
          options={categoryTree(categories)}
          onChange={move}
          exceptId={category.id}
        />

        <Link className="category-row__count" to="/admin/items">
          <Mono>{itemCount}</Mono> {itemCount === 1 ? 'item' : 'items'}
        </Link>

        <Button
          variant="secondary"
          size="sm"
          className="category-row__addons"
          onClick={() => setEditingAddOns((open) => !open)}
          aria-expanded={editingAddOns}
          aria-controls={`category-addons-${category.id}`}
        >
          {addOnCount > 0 ? (
            <span>
              <Mono>{addOnCount}</Mono> {addOnCount === 1 ? 'add-on' : 'add-ons'}
            </span>
          ) : (
            'Add-ons'
          )}
        </Button>

        <Button
          variant="secondary"
          size="sm"
          className="category-row__delete"
          onClick={remove}
          onBlur={() => setConfirmingDelete(false)}
          disabled={inUse}
          title={
            subCount > 0
              ? 'Move or delete the categories inside it first.'
              : inUse
                ? 'Move its items to another category, or delete them, first.'
                : undefined
          }
          aria-label={
            inUse
              ? `Can’t delete ${category.label} while it has ${subCount > 0 ? 'categories inside it' : 'items'}`
              : confirmingDelete
                ? `Confirm deleting ${category.label}`
                : `Delete ${category.label}`
          }
        >
          {confirmingDelete ? 'Confirm delete' : 'Delete'}
        </Button>
      </div>

      {editingAddOns && <AddOnEditor category={category} />}
    </div>
  );
}

/** An add-on as it's being edited: its price as typed. */
type DraftAddOn = { itemId: string; price: string };

function toDraft(addOns: AddOn[] = []): DraftAddOn[] {
  return addOns.map((a) => ({ itemId: a.itemId, price: String(a.price) }));
}

/**
 * A category's add-ons: catalog items offered with every item in it, on the
 * register and in set meals, each at its own add-on price — 0 when it comes
 * with the item. Picked items start at their usual price.
 */
function AddOnEditor({ category }: { category: Category }) {
  const { catalog, setCategoryAddOns } = usePos();
  const currency = activeCurrency();
  const initial = toDraft(category.addOns);
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  // Add-ons whose items have since been deleted drop out.
  const shown = draft.filter((a) => catalog.some((i) => i.id === a.itemId));

  function change(next: DraftAddOn[]) {
    setDraft(next);
    setError(null);
    setSaved(false);
  }

  /** Adds or takes off several items at once — one, or a whole category. */
  function pick(itemIds: string[], on: boolean) {
    change(
      on
        ? [
            ...draft,
            ...itemIds
              .filter((id) => !draft.some((a) => a.itemId === id))
              .map((id) => ({ itemId: id, price: String(catalog.find((i) => i.id === id)?.price ?? 0) })),
          ]
        : draft.filter((a) => !itemIds.includes(a.itemId)),
    );
  }

  function save() {
    const prices = shown.map((a) => a.price.trim());
    if (prices.some((p) => !p || !isAmountText(p))) {
      return setError(`Give every add-on a price in ${currency.symbol} — 0 if it comes with the item.`);
    }
    const addOns = shown.map((a, i) => ({ itemId: a.itemId, price: Number(prices[i]) }));
    setCategoryAddOns(category.id, addOns);
    setDraft(toDraft(addOns));
    setSaved(true);
  }

  return (
    <div className="category-addons" id={`category-addons-${category.id}`}>
      <p className="inv-note">
        Offered with every item in {category.label} and the categories inside it, on the register and in
        set meals. Each is an item from your catalog, so it comes off stock when it’s sold.
      </p>
      <ItemPicker
        catalog={catalog}
        selected={shown.map((a) => a.itemId)}
        onChange={pick}
        label={`${category.label} add-ons`}
        emptyNote="No add-ons picked yet."
      />
      {shown.length > 0 && (
        <ul className="category-addons__list" aria-label={`${category.label} add-on prices`}>
          {shown.map((a) => {
            const item = catalog.find((i) => i.id === a.itemId)!;
            const valid = a.price.trim() !== '' && isAmountText(a.price.trim());
            return (
              <li key={a.itemId} className="category-addon">
                <span className="category-addon__name">
                  {item.name}
                  <span className="inv-field__hint">
                    {valid && Number(a.price) === 0 ? (
                      'Included with the item'
                    ) : (
                      <>
                        On its own <Money value={item.price} />
                      </>
                    )}
                  </span>
                </span>
                <label className="category-addon__price">
                  <span className="sr-only">{item.name} add-on price</span>
                  <span className="mono" aria-hidden="true">
                    + {currency.symbol}
                  </span>
                  <input
                    className="inv-input inv-input--num inv-input--sm"
                    inputMode={currency.decimals === 0 ? 'numeric' : 'decimal'}
                    value={a.price}
                    onChange={(e) =>
                      change(draft.map((d) => (d.itemId === a.itemId ? { ...d, price: e.target.value } : d)))
                    }
                    aria-invalid={!valid}
                  />
                </label>
                <button
                  type="button"
                  className="inv-remove"
                  onClick={() => pick([a.itemId], false)}
                  aria-label={`Remove ${item.name}`}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </li>
            );
          })}
        </ul>
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
      <div>
        <Button size="sm" onClick={save} disabled={!dirty}>
          Save add-ons
        </Button>
      </div>
    </div>
  );
}
