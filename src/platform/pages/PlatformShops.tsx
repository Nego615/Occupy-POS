import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button } from '../../components/Button';
import { Modal } from '../../components/CounterDialogs';
import { Mono } from '../../components/Mono';
import { Pill, PillRow } from '../../components/Pill';
import { SearchField } from '../../components/SearchField';
import { formatDay, subscriptionState, type SubscriptionStatus } from '../../lib/subscription';
import { ago, createShop, isLifetime, planLabel } from '../api';
import { usePlatform } from '../PlatformData';
import { useUnsaved } from '../Unsaved';
import { STATUS_LABEL, ShopStatus } from '../ShopStatus';

type Filter = 'all' | 'trial' | SubscriptionStatus;
const FILTERS: Filter[] = ['all', 'active', 'trial', 'expiring', 'grace', 'locked', 'suspended'];

/** "Paid up" leaves out shops on a free trial; "On free trial" is those still running. */
function matches(filter: Filter, { status, trial }: { status: SubscriptionStatus; trial: boolean }): boolean {
  if (filter === 'all') return true;
  if (filter === 'trial') return trial && (status === 'active' || status === 'expiring');
  if (filter === 'active') return status === 'active' && !trial;
  return status === filter;
}

/** Every shop account, with what it pays and whether it's up to date. */
export function PlatformShops() {
  const { shops, plans, stats } = usePlatform();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);

  const withStatus = shops.map((shop) => ({ shop, ...subscriptionState(shop) }));
  const q = query.trim().toLowerCase();
  const shown = withStatus.filter(
    (row) =>
      matches(filter, row) &&
      (!q || row.shop.name.toLowerCase().includes(q) || row.shop.owner_email.toLowerCase().includes(q)),
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Shops</h1>
          <div className="page-sub">
            {shops.length} shop {shops.length === 1 ? 'account' : 'accounts'}
          </div>
        </div>
        <div className="head-actions">
          <Button onClick={() => setAdding(true)}>New shop</Button>
        </div>
      </div>

      <div className="pf-toolbar">
        <PillRow label="Show">
          {FILTERS.map((f) => (
            <Pill key={f} active={filter === f} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : f === 'trial' ? 'On free trial' : STATUS_LABEL[f]}{' '}
              <Mono>{withStatus.filter((row) => matches(f, row)).length}</Mono>
            </Pill>
          ))}
        </PillRow>
        <SearchField value={query} onChange={setQuery} placeholder="Name or email" label="Search shops" />
      </div>

      <section className="panel" aria-label="Shops">
        <div className="pf-row pf-row--shop pf-row--head" aria-hidden="true">
          <span>Shop</span>
          <span>Plan</span>
          <span>Paid until</span>
          <span>Last used</span>
          <span>Status</span>
        </div>
        {shown.length === 0 ? (
          <p className="pf-empty">{shops.length === 0 ? 'No shops yet. Add the first one with New shop.' : 'No shops match that search.'}</p>
        ) : (
          shown.map(({ shop }) => {
            const plan = plans.find((p) => p.id === shop.plan_id);
            return (
              <Link key={shop.store_id} to={`/platform/shops/${shop.store_id}`} className="pf-row pf-row--shop pf-row--link">
                <span className="pf-row__who">
                  <span className="pf-line__name">{shop.name}</span>
                  <span className="pf-line__sub">{shop.owner_email}</span>
                </span>
                <span>{plan ? planLabel(plan) : 'No plan'}</span>
                <Mono>{shop.paid_until ? formatDay(shop.paid_until) : plan && isLifetime(plan) ? 'Lifetime' : '—'}</Mono>
                <span>{ago(stats.get(shop.store_id)?.last_activity ?? null)}</span>
                <span>
                  <ShopStatus shop={shop} />
                </span>
              </Link>
            );
          })
        )}
      </section>

      <NewShopDialog open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

/** A random 12-character password to hand over, avoiding look-alike characters. */
function tempPassword(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

function NewShopDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { client, plans, reload } = usePlatform();
  const navigate = useNavigate();
  const activePlans = plans.filter((p) => p.active);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [planId, setPlanId] = useState('');
  const [trialDays, setTrialDays] = useState('14');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName('');
    setEmail('');
    setPassword(tempPassword());
    setPhone('');
    setPlanId(activePlans[0]?.id ?? '');
    setTrialDays('14');
    setError(null);
    // Only reset when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Typed details count as unsaved; the generated password and defaults don't.
  const dirty = open && !busy && (name.trim() !== '' || email.trim() !== '' || phone.trim() !== '');
  const { confirmDiscard } = useUnsaved('The new shop', dirty, () => {
    setName('');
    setEmail('');
    setPhone('');
  });

  /** Escape, the backdrop and × all come here: ask before throwing away what's typed. */
  async function requestClose() {
    if (dirty && !(await confirmDiscard())) return;
    onClose();
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await createShop(client, {
        name,
        email,
        password,
        phone,
        planId: planId || null,
        trialDays: Number(trialDays) || 0,
      });
      await reload();
      onClose();
      navigate('/platform/shops');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title="New shop" sub="Creates the account a shop signs its registers in with." onClose={() => void requestClose()}>
      <form
        className="counter-dialog__form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="counter-field">
          <span>Shop name</span>
          <input type="text" required value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="counter-field">
          <span>Email (their sign-in)</span>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="counter-field">
          <span>Temporary password — give this to the shop</span>
          <input
            className="mono"
            type="text"
            required
            minLength={8}
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label className="counter-field">
          <span>Phone</span>
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <div className="pf-field-pair">
          <label className="counter-field">
            <span>Plan</span>
            <select className="counter-field__input" value={planId} onChange={(e) => setPlanId(e.target.value)}>
              <option value="">No plan yet</option>
              {activePlans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="counter-field">
            <span>Free trial in days (0 for none)</span>
            <input
              className="mono"
              type="number"
              min={0}
              max={365}
              value={trialDays}
              onChange={(e) => setTrialDays(e.target.value)}
            />
          </label>
        </div>
        {error && (
          <p className="pf-error" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" block disabled={busy}>
          {busy ? 'Creating…' : 'Create shop'}
        </Button>
      </form>
    </Modal>
  );
}
