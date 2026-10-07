import { useState } from 'react';
import { Link } from 'react-router';
import './Inventory.css';
import { Button } from '../components/Button';
import { Money, Mono } from '../components/Mono';
import { StatusChip } from '../components/StatusChip';
import { Switch } from '../components/Switch';
import type { Supplier } from '../data/inventory';
import { billStatus } from '../lib/inventory';
import { usePos } from '../lib/store';
import { useRevealPanel } from '../lib/useRevealPanel';

/**
 * Who the business buys from: contacts, payment terms, and where each
 * account stands. Suppliers are deactivated rather than deleted, so their
 * orders and bills keep a name to show.
 */
export function AdminSuppliers() {
  const { suppliers, addSupplier, settings } = usePos();
  const [selectedId, setSelectedId] = useState<string | null>(suppliers[0]?.id ?? null);
  const panelRef = useRevealPanel<HTMLElement>(selectedId);

  function add() {
    const s = addSupplier({ name: 'New supplier', paymentTermsDays: 14, active: true });
    setSelectedId(s.id);
  }

  const selected = suppliers.find((s) => s.id === selectedId) ?? null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Suppliers</h1>
          <div className="page-sub">
            {settings.locationName} · <Mono>{suppliers.filter((s) => s.active).length}</Mono> active
          </div>
        </div>
        <div className="head-actions">
          <Button onClick={add}>Add supplier</Button>
        </div>
      </div>

      <div className="inv-layout">
        <section className="panel inv-table-wrap" aria-label="Suppliers">
          <table className="inv-table">
            <thead>
              <tr>
                <th scope="col">Supplier</th>
                <th scope="col" className="num">
                  Items
                </th>
                <th scope="col">Terms</th>
                <th scope="col" className="num">
                  Owed
                </th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((s) => (
                <SupplierRow
                  key={s.id}
                  supplier={s}
                  selected={s.id === selectedId}
                  onSelect={() => setSelectedId(s.id)}
                />
              ))}
            </tbody>
          </table>
        </section>

        <aside ref={panelRef} className="inv-panel" aria-label="Supplier details">
          {selected ? (
            <SupplierPanel key={selected.id} supplier={selected} />
          ) : (
            <p className="inv-panel__placeholder">Pick a supplier to edit their details.</p>
          )}
        </aside>
      </div>
    </>
  );
}

function useAccount(supplierId: string) {
  const { bills, catalog, purchaseOrders } = usePos();
  const mine = bills.filter((b) => b.supplierId === supplierId).map((b) => billStatus(b));
  return {
    owed: mine.reduce((sum, s) => sum + s.balance, 0),
    overdue: mine.filter((s) => s.state === 'overdue').length,
    items: catalog.filter((i) => i.supplierId === supplierId).length,
    openOrders: purchaseOrders.filter(
      (p) => p.supplierId === supplierId && ['draft', 'ordered', 'partial'].includes(p.status),
    ).length,
  };
}

function SupplierRow({
  supplier,
  selected,
  onSelect,
}: {
  supplier: Supplier;
  selected: boolean;
  onSelect: () => void;
}) {
  const account = useAccount(supplier.id);
  return (
    <tr className={selected ? 'inv-row inv-row--selected' : 'inv-row'} onClick={onSelect}>
      <td>
        <button
          type="button"
          className="inv-row__pick"
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
          }}
          aria-pressed={selected}
        >
          <span>
            {supplier.name}
            <span className="inv-sub">
              {supplier.active ? supplier.contact ?? 'No contact set' : 'Deactivated'}
            </span>
          </span>
        </button>
      </td>
      <td className="num">
        <Mono>{account.items}</Mono>
      </td>
      <td className="inv-soft">
        <Mono>{supplier.paymentTermsDays}</Mono> days
      </td>
      <td className="num">
        {account.owed > 0 ? (
          <span className="inv-strong">
            <Money value={account.owed} />
            {account.overdue > 0 && (
              <>
                {' '}
                <StatusChip status="occupied" size="sm">
                  Overdue
                </StatusChip>
              </>
            )}
          </span>
        ) : (
          <span className="inv-soft">—</span>
        )}
      </td>
    </tr>
  );
}

function SupplierPanel({ supplier }: { supplier: Supplier }) {
  const { updateSupplier } = usePos();
  const account = useAccount(supplier.id);
  const [draft, setDraft] = useState({
    name: supplier.name,
    contact: supplier.contact ?? '',
    phone: supplier.phone ?? '',
    email: supplier.email ?? '',
    terms: String(supplier.paymentTermsDays),
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty =
    draft.name !== supplier.name ||
    draft.contact !== (supplier.contact ?? '') ||
    draft.phone !== (supplier.phone ?? '') ||
    draft.email !== (supplier.email ?? '') ||
    draft.terms !== String(supplier.paymentTermsDays);

  function set(key: keyof typeof draft, value: string) {
    setDraft((d) => ({ ...d, [key]: value }));
    setError(null);
    setSaved(false);
  }

  function save() {
    const name = draft.name.trim();
    if (!name) return setError('Name can’t be empty.');
    if (!/^\d{1,3}$/.test(draft.terms.trim())) return setError('Terms are whole days, like 14 (0 for cash on delivery).');
    const email = draft.email.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError('That email doesn’t look right.');
    updateSupplier(supplier.id, {
      name,
      contact: draft.contact.trim() || undefined,
      phone: draft.phone.trim() || undefined,
      email: email || undefined,
      paymentTermsDays: Number(draft.terms),
    });
    setSaved(true);
  }

  return (
    <>
      <div className="inv-panel__head">
        <div>
          <h2 className="inv-panel__title">{supplier.name}</h2>
          <div className="inv-panel__sub">
            <Mono>{account.items}</Mono> items · <Mono>{account.openOrders}</Mono> open{' '}
            {account.openOrders === 1 ? 'order' : 'orders'}
          </div>
        </div>
      </div>

      <dl className="inv-facts">
        <dt>Owed</dt>
        <dd>
          <Money value={account.owed} className="inv-strong" />
        </dd>
        <dt>Overdue bills</dt>
        <dd>
          <Mono>{account.overdue}</Mono>
        </dd>
      </dl>
      <p className="inv-note">
        <Link to={`/admin/bills?supplier=${supplier.id}`}>See this supplier’s bills</Link>
      </p>

      <div className="inv-panel__section inv-form">
        <label className="inv-field">
          Name
          <input className="inv-input" value={draft.name} onChange={(e) => set('name', e.target.value)} />
        </label>
        <label className="inv-field">
          Contact person
          <input className="inv-input" value={draft.contact} onChange={(e) => set('contact', e.target.value)} />
        </label>
        <label className="inv-field">
          Phone
          <input className="inv-input" type="tel" value={draft.phone} onChange={(e) => set('phone', e.target.value)} />
        </label>
        <label className="inv-field">
          Email
          <input className="inv-input" type="email" value={draft.email} onChange={(e) => set('email', e.target.value)} />
        </label>
        <label className="inv-field">
          Payment terms
          <span className="inv-field__hint">Days after a delivery its bill is due.</span>
          <input
            className="inv-input inv-input--num"
            inputMode="numeric"
            value={draft.terms}
            onChange={(e) => set('terms', e.target.value)}
          />
        </label>
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
        <div className="inv-panel__head">
          <div>
            <div className="inv-panel__section-title">Active</div>
            <p className="inv-note">Deactivated suppliers can’t get new purchase orders.</p>
          </div>
          <Switch
            checked={supplier.active}
            onChange={(active) => updateSupplier(supplier.id, { active })}
            label={`${supplier.name} active`}
          />
        </div>
      </div>
    </>
  );
}
