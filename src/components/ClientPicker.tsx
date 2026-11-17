import { useMemo, useState } from 'react';
import './ClientPicker.css';
import { Button } from './Button';
import { Money } from './Mono';
import { clientBalance, withinLimit } from '../data/clients';
import { usePos } from '../lib/store';

/**
 * Picks the client a bill goes on, by name or phone — or adds a new one on
 * the spot, so a regular's first debt doesn't need a trip to another screen.
 * Clients the bill would take over their limit can't be picked.
 */
export function ClientPicker({
  value,
  onChange,
  amount,
}: {
  value: string | null;
  onChange: (clientId: string | null) => void;
  /**
   * What's about to go on their account. Left out when nothing is — naming
   * who an order is for — so nobody is held back by their limit.
   */
  amount?: number;
}) {
  const { clients, orders, saveClient } = usePos();
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  const q = query.trim().toLowerCase();
  const rows = useMemo(
    () =>
      clients
        .filter((c) => !c.archived)
        .filter((c) => !q || c.name.toLowerCase().includes(q) || (c.phone?.replace(/\s/g, '').includes(q.replace(/\s/g, '')) ?? false))
        .map((c) => ({ client: c, owing: clientBalance(orders, c.id) }))
        .sort((a, b) => a.client.name.localeCompare(b.client.name)),
    [clients, orders, q],
  );

  function add() {
    if (!name.trim()) return;
    const client = saveClient({ name, phone });
    onChange(client.id);
    setAdding(false);
    setName('');
    setPhone('');
    setQuery('');
  }

  if (adding) {
    return (
      <div className="client-picker">
        <label className="client-picker__field">
          <span>Name</span>
          <input
            className="client-picker__input"
            type="text"
            value={name}
            maxLength={60}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
        </label>
        <label className="client-picker__field">
          <span>Phone</span>
          <input
            className="client-picker__input mono"
            type="tel"
            value={phone}
            maxLength={20}
            placeholder="optional"
            onChange={(e) => setPhone(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
        </label>
        <div className="client-picker__row">
          <Button variant="secondary" onClick={() => setAdding(false)}>
            Cancel
          </Button>
          <Button onClick={add} disabled={!name.trim()}>
            Add client
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="client-picker">
      <div className="client-picker__row">
        <input
          className="client-picker__input client-picker__search"
          type="search"
          value={query}
          placeholder="Find a client by name or phone"
          aria-label="Find a client"
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button
          variant="secondary"
          onClick={() => {
            setName(query.trim() && !/^[\d+\s]+$/.test(query.trim()) ? query.trim() : '');
            setPhone(/^[\d+\s]+$/.test(query.trim()) ? query.trim() : '');
            setAdding(true);
          }}
        >
          New client
        </Button>
      </div>
      <ul className="client-picker__list" role="listbox" aria-label="Clients">
        {rows.length === 0 && (
          <li className="client-picker__empty">
            {clients.some((c) => !c.archived) ? 'No client matches that.' : 'No clients yet — add the first one.'}
          </li>
        )}
        {rows.map(({ client, owing }) => {
          const fits = amount === undefined || withinLimit(client, owing, amount);
          const selected = client.id === value;
          return (
            <li key={client.id}>
              <button
                type="button"
                role="option"
                aria-selected={selected}
                disabled={!fits}
                className={selected ? 'client-picker__option client-picker__option--active' : 'client-picker__option'}
                onClick={() => onChange(selected ? null : client.id)}
              >
                <span className="client-picker__name">
                  {client.name}
                  {client.phone && <span className="client-picker__meta mono"> · {client.phone}</span>}
                </span>
                <span className="client-picker__meta">
                  {owing > 0 ? (
                    <>
                      owes <Money value={owing} />
                    </>
                  ) : (
                    'owes nothing'
                  )}
                  {client.creditLimit !== undefined && (
                    <>
                      {' '}
                      · limit <Money value={client.creditLimit} />
                    </>
                  )}
                  {!fits && ' · over limit'}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
