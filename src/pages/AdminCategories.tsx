import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import './AdminCategories.css';
import { Button } from '../components/Button';
import { Mono } from '../components/Mono';
import type { Category } from '../data/catalog';
import { usePos } from '../lib/store';

/** Trimmed, with runs of spaces collapsed — how a category name is stored. */
function tidy(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

/** Why `name` can't be used for a category other than `exceptId`, or null if it can. */
function nameProblem(name: string, categories: Category[], exceptId?: string): string | null {
  if (!name) return 'Give the category a name.';
  const clash = categories.some((c) => c.id !== exceptId && c.label.toLowerCase() === name.toLowerCase());
  return clash ? `${name} already exists — pick a different name.` : null;
}

/**
 * The categories items are sorted into — the shelves along the top of the
 * register, and the headings in reports. Renames apply everywhere at once; a
 * category can only be deleted once no item is in it.
 */
export function AdminCategories() {
  const { categories, catalog, createCategory, settings } = usePos();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  function add(e: FormEvent) {
    e.preventDefault();
    const label = tidy(name);
    const problem = nameProblem(label, categories);
    if (problem) return setError(problem);
    createCategory(label);
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
          <Button type="submit">Add category</Button>
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
          categories.map((category) => (
            <CategoryRow
              key={category.id}
              category={category}
              itemCount={catalog.filter((i) => i.category === category.id).length}
            />
          ))
        )}
      </section>
    </>
  );
}

function CategoryRow({ category, itemCount }: { category: Category; itemCount: number }) {
  const { categories, renameCategory, deleteCategory } = usePos();
  const [draft, setDraft] = useState(category.label);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const errorId = `category-error-${category.id}`;
  const inUse = itemCount > 0;

  function commit() {
    const label = tidy(draft);
    const problem = nameProblem(label, categories, category.id);
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

  return (
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

      <Link className="category-row__count" to="/admin/items">
        <Mono>{itemCount}</Mono> {itemCount === 1 ? 'item' : 'items'}
      </Link>

      <Button
        variant="secondary"
        size="sm"
        className="category-row__delete"
        onClick={remove}
        onBlur={() => setConfirmingDelete(false)}
        disabled={inUse}
        title={inUse ? 'Move its items to another category, or delete them, first.' : undefined}
        aria-label={
          inUse
            ? `Can’t delete ${category.label} while it has items`
            : confirmingDelete
              ? `Confirm deleting ${category.label}`
              : `Delete ${category.label}`
        }
      >
        {confirmingDelete ? 'Confirm delete' : 'Delete'}
      </Button>
    </div>
  );
}
