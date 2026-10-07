import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import './AdminSettings.css';
import { BrandMark } from '../components/BrandMark';
import { Button } from '../components/Button';
import { FilterSelect } from '../components/FilterSelect';
import { Mono } from '../components/Mono';
import { Switch } from '../components/Switch';
import { type CategoryId } from '../data/catalog';
import {
  AUTO_LOCK_OPTIONS,
  DEFAULT_SETTINGS,
  PAYMENT_METHODS,
  type PaymentMethodId,
  type Settings,
} from '../data/settings';
import {
  CURRENCIES,
  currencyOf,
  formatCurrency,
  type CurrencyCode,
} from '../lib/currency';
import { signOutDevice, unsyncedCount } from '../lib/cloud';
import { LOGO_TYPES, readLogo } from '../lib/logo';
import { usePos } from '../lib/store';
import { supabase } from '../lib/supabase';

/** The form's working copy — numbers stay as typed text until Save checks them. */
type Draft = {
  businessName: string;
  logo: string | null;
  locationName: string;
  registerName: string;
  receiptFooter: string;
  autoPrintReceipt: boolean;
  currency: CurrencyCode;
  taxPct: string;
  tipsEnabled: boolean;
  tipPcts: [string, string, string];
  defaultTip: 'none' | '0' | '1' | '2';
  paymentMethods: PaymentMethodId[];
  openPriceEnabled: boolean;
  lowStockDefault: string;
  kitchenCategories: CategoryId[];
  kitchenLateMinutes: string;
  autoLock: string;
  maxPinTries: string;
};

type Errors = Partial<Record<keyof Draft | 'tipPcts0' | 'tipPcts1' | 'tipPcts2', string>>;

/** 0.0875 → "8.75", without float noise like "8.750000001". */
const pct = (fraction: number) => String(Math.round(fraction * 100_000) / 1000);

function toDraft(s: Settings): Draft {
  return {
    businessName: s.businessName,
    logo: s.logo,
    locationName: s.locationName,
    registerName: s.registerName,
    receiptFooter: s.receiptFooter,
    autoPrintReceipt: s.autoPrintReceipt,
    currency: s.currency,
    taxPct: pct(s.taxRate),
    tipsEnabled: s.tipsEnabled,
    tipPcts: s.tipPresets.map(pct) as [string, string, string],
    defaultTip: s.defaultTip === null ? 'none' : (String(s.defaultTip) as Draft['defaultTip']),
    paymentMethods: [...s.paymentMethods],
    openPriceEnabled: s.openPriceEnabled,
    lowStockDefault: String(s.lowStockDefault),
    kitchenCategories: [...s.kitchenCategories],
    kitchenLateMinutes: String(s.kitchenLateMinutes),
    autoLock: s.autoLockMinutes === null ? 'never' : String(s.autoLockMinutes),
    maxPinTries: String(s.maxPinTries),
  };
}

/** A number in [min, max] from typed text, or null. `whole` rejects decimals. */
function parseNumber(text: string, min: number, max: number, whole = false): number | null {
  const t = text.trim().replace(/%$/, '');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  if (n < min || n > max || (whole && !Number.isInteger(n))) return null;
  return n;
}

function fromDraft(d: Draft, current: Settings): { settings: Settings } | { errors: Errors } {
  const errors: Errors = {};
  const name = (text: string, key: keyof Draft, label: string, max = 40) => {
    const t = text.trim().replace(/\s+/g, ' ');
    if (!t) errors[key] = `${label} can’t be empty.`;
    else if (t.length > max) errors[key] = `Keep it to ${max} characters.`;
    return t;
  };

  const businessName = name(d.businessName, 'businessName', 'Business name');
  const locationName = name(d.locationName, 'locationName', 'Location name');
  const registerName = name(d.registerName, 'registerName', 'Register name');
  const receiptFooter = d.receiptFooter.trim();
  if (receiptFooter.length > 120) errors.receiptFooter = 'Keep it to 120 characters.';

  const tax = parseNumber(d.taxPct, 0, 25);
  if (tax === null) errors.taxPct = 'Enter a percentage from 0 to 25, like 18.';

  // With tips off the options are hidden, so keep the saved ones rather than
  // block saving on fields nobody can see.
  const tips = d.tipsEnabled
    ? d.tipPcts.map((t) => parseNumber(t, 1, 100))
    : current.tipPresets.map((t) => t * 100);
  tips.forEach((t, i) => {
    if (t === null) errors[`tipPcts${i}` as 'tipPcts0'] = '1–100';
  });
  if (tips.every((t) => t !== null) && new Set(tips).size < 3) {
    errors.tipPcts = 'The three tip options need to be different.';
  }

  if (d.paymentMethods.every((m) => m === 'split')) errors.paymentMethods = 'Accept at least one payment method.';

  const lowStock = parseNumber(d.lowStockDefault, 0, 999, true);
  if (lowStock === null) errors.lowStockDefault = 'A whole number from 0 to 999.';

  const late = parseNumber(d.kitchenLateMinutes, 1, 60, true);
  if (late === null) errors.kitchenLateMinutes = 'Whole minutes from 1 to 60.';

  const tries = parseNumber(d.maxPinTries, 3, 10, true);
  if (tries === null) errors.maxPinTries = 'A whole number from 3 to 10.';

  if (Object.keys(errors).length > 0) return { errors };

  return {
    settings: {
      businessName,
      logo: d.logo,
      locationName,
      registerName,
      receiptFooter,
      autoPrintReceipt: d.autoPrintReceipt,
      currency: d.currency,
      taxRate: tax! / 100,
      tipsEnabled: d.tipsEnabled,
      tipPresets: tips.map((t) => t! / 100) as [number, number, number],
      defaultTip: !d.tipsEnabled
        ? current.defaultTip
        : d.defaultTip === 'none'
          ? null
          : (Number(d.defaultTip) as 0 | 1 | 2),
      // Keep the checkout's usual order, whatever order they were ticked in.
      paymentMethods: PAYMENT_METHODS.map((m) => m.id).filter((id) =>
        d.paymentMethods.includes(id),
      ),
      openPriceEnabled: d.openPriceEnabled,
      lowStockDefault: lowStock!,
      kitchenCategories: [...d.kitchenCategories],
      kitchenLateMinutes: late!,
      autoLockMinutes: d.autoLock === 'never' ? null : Number(d.autoLock),
      maxPinTries: tries!,
    },
  };
}

/**
 * Business-wide settings. Unlike the list pages, edits here collect in a
 * draft and apply together on Save — a half-typed tax rate shouldn't reach
 * open tabs. Everything takes effect across the app as soon as it's saved.
 */
export function AdminSettings() {
  const { settings, updateSettings, resetAllData, categories } = usePos();
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [confirmingUnlink, setConfirmingUnlink] = useState(false);
  const [shopEmail, setShopEmail] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(() => toDraft(settings));
  const [errors, setErrors] = useState<Errors>({});
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const saved = useMemo(() => toDraft(settings), [settings]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  useEffect(() => {
    supabase?.auth.getSession().then(({ data }) => setShopEmail(data.session?.user.email ?? null));
  }, []);

  async function unlinkDevice() {
    if (!supabase) return;
    const unsynced = unsyncedCount();
    if (
      unsynced > 0 &&
      !window.confirm(
        `${unsynced} recent change${unsynced === 1 ? ' hasn’t' : 's haven’t'} uploaded yet and will be lost. Sign out anyway?`,
      )
    ) {
      return;
    }
    await signOutDevice(supabase);
    window.location.reload();
  }

  // The "Saved" note fades on its own.
  useEffect(() => {
    if (savedAt === null) return;
    const id = window.setTimeout(() => setSavedAt(null), 2500);
    return () => window.clearTimeout(id);
  }, [savedAt]);

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
    setSavedAt(null);
  }

  function save() {
    const result = fromDraft(draft, settings);
    if ('errors' in result) {
      setErrors(result.errors);
      // Bring the first problem into view.
      const first = Object.keys(result.errors)[0];
      document.getElementById(`setting-${first.replace(/\d$/, '')}`)?.scrollIntoView({
        block: 'center',
      });
      return;
    }
    updateSettings(result.settings);
    setDraft(toDraft(result.settings));
    setErrors({});
    setSavedAt(Date.now());
  }

  function discard() {
    setDraft(saved);
    setErrors({});
  }

  // Live examples, so a number reads as what it'll do.
  const cur = currencyOf(draft.currency);
  const savedCur = currencyOf(settings.currency);
  const fmt = (n: number) => formatCurrency(n, cur);
  // Whole-unit or cent rounding, matching the currency being previewed.
  const inCur = (n: number) => Math.round(n * 10 ** cur.decimals) / 10 ** cur.decimals;
  const taxPreview = parseNumber(draft.taxPct, 0, 25);
  const tipValues = draft.tipPcts.map((t) => parseNumber(t, 1, 100));

  return (
    <div className="settings">
      <div className="page-head">
        <div>
          <h1 className="page-title">Settings</h1>
          <div className="page-sub">
            {settings.locationName} · applies to every register and screen
          </div>
        </div>
        <div className="head-actions">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setDraft(toDraft(DEFAULT_SETTINGS));
              setErrors({});
            }}
          >
            Reset to defaults
          </Button>
        </div>
      </div>

      <Section title="Business" note="Shown in the top bar, on sign-in, and on receipts.">
        <Row id="businessName" forInput label="Business name" error={errors.businessName}>
          <TextInput
            id="setting-businessName"
            value={draft.businessName}
            onChange={(v) => set('businessName', v)}
            invalid={!!errors.businessName}
          />
        </Row>
        <Row
          id="logo"
          label="Logo"
          hint="PNG, JPG, WebP, or SVG, up to 2 MB. A square image fits best."
          error={errors.logo}
        >
          <LogoPicker
            logo={draft.logo}
            onChange={(v) => set('logo', v)}
            onError={(message) => setErrors((er) => ({ ...er, logo: message }))}
          />
        </Row>
        <Row id="locationName" forInput label="Location" hint="This shop or site." error={errors.locationName}>
          <TextInput
            id="setting-locationName"
            value={draft.locationName}
            onChange={(v) => set('locationName', v)}
            invalid={!!errors.locationName}
          />
        </Row>
        <Row
          id="registerName"
          forInput
          label="Register"
          hint="This device, as printed on its receipts."
          error={errors.registerName}
        >
          <TextInput
            id="setting-registerName"
            value={draft.registerName}
            onChange={(v) => set('registerName', v)}
            invalid={!!errors.registerName}
          />
        </Row>
      </Section>

      <Section title="Currency">
        <Row
          id="currency"
          label="Currency"
          hint="Used for every price, total, tip, wage, receipt, and report."
        >
          <FilterSelect
            value={draft.currency}
            onChange={(v) => set('currency', v as CurrencyCode)}
            label="Currency"
          >
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name} ({c.symbol})
              </option>
            ))}
          </FilterSelect>
        </Row>
        {draft.currency !== settings.currency && (
          <p className="settings-warning" role="status">
            Amounts aren’t converted — <Mono>{formatCurrency(6500, savedCur)}</Mono> becomes{' '}
            <Mono>{fmt(6500)}</Mono>. Update item prices and pay rates after switching.
            {cur.decimals === 0 && savedCur.decimals > 0 && ' Cents are rounded to whole units.'}
          </p>
        )}
      </Section>

      <Section title="Receipts">
        <Row
          id="receiptFooter"
          forInput
          label="Footer message"
          hint="Printed under the totals. Leave blank for none."
          error={errors.receiptFooter}
        >
          <TextInput
            id="setting-receiptFooter"
            value={draft.receiptFooter}
            onChange={(v) => set('receiptFooter', v)}
            invalid={!!errors.receiptFooter}
            wide
          />
        </Row>
        <Row
          id="autoPrintReceipt"
          label="Print after payment"
          hint="Opens the print dialog as soon as a tab is paid. Off still offers a Print receipt button."
        >
          <Switch
            checked={draft.autoPrintReceipt}
            onChange={(v) => set('autoPrintReceipt', v)}
            label="Print after payment"
          />
        </Row>
        <div className="receipt-preview" aria-label="Receipt header and footer preview">
          {draft.logo && <img className="receipt-preview__logo" src={draft.logo} alt="" />}
          <div className="receipt-preview__brand">{draft.businessName || '—'}</div>
          <div className="receipt-preview__line">
            {draft.locationName || '—'} · {draft.registerName || '—'}
          </div>
          <div className="receipt-preview__rule" aria-hidden="true" />
          <div className="receipt-preview__line">{draft.receiptFooter || 'No footer'}</div>
        </div>
      </Section>

      <Section title="Tax & tips">
        <Row
          id="taxPct"
          forInput
          label="VAT / sales tax"
          hint={
            taxPreview !== null ? (
              <>
                <Mono>{fmt(inCur((cur.example * taxPreview) / 100))}</Mono> on a{' '}
                <Mono>{fmt(cur.example)}</Mono> order. Applies to open tabs too; paid orders keep the tax
                they were charged.
              </>
            ) : (
              'Percent of the item subtotal.'
            )
          }
          error={errors.taxPct}
        >
          <Affix after="%">
            <input
              id="setting-taxPct"
              className="settings-input settings-input--num mono"
              inputMode="decimal"
              value={draft.taxPct}
              onChange={(e) => set('taxPct', e.target.value)}
              aria-invalid={!!errors.taxPct}
              aria-label="VAT or sales tax percent"
            />
          </Affix>
        </Row>

        <Row
          id="tipsEnabled"
          label="Tips"
          hint="Off removes tipping from checkout, receipts, reports, and payroll. Past tips stay on their orders."
        >
          <Switch
            checked={draft.tipsEnabled}
            onChange={(v) => set('tipsEnabled', v)}
            label="Tips"
          />
        </Row>

        {draft.tipsEnabled && (
          <>
            <Row
              id="tipPcts"
              label="Tip options"
              hint={
                tipValues.every((t) => t !== null)
                  ? `On a ${fmt(cur.example * 2)} order: ${tipValues
                      .map((t) => fmt(inCur((cur.example * 2 * t!) / 100)))
                      .join(', ')}`
                  : 'Three percentages offered as buttons.'
              }
              error={errors.tipPcts ?? (errors.tipPcts0 || errors.tipPcts1 || errors.tipPcts2
                ? 'Each tip option is a percentage from 1 to 100.'
                : undefined)}
            >
              <div className="tip-inputs" id="setting-tipPcts">
                {draft.tipPcts.map((value, i) => (
                  <Affix key={i} after="%">
                    <input
                      className="settings-input settings-input--tip mono"
                      inputMode="decimal"
                      value={value}
                      onChange={(e) => {
                        const next = [...draft.tipPcts] as Draft['tipPcts'];
                        next[i] = e.target.value;
                        set('tipPcts', next);
                        setErrors((er) => ({ ...er, [`tipPcts${i}`]: undefined }));
                      }}
                      aria-invalid={!!(errors[`tipPcts${i}` as 'tipPcts0'] || errors.tipPcts)}
                      aria-label={`Tip option ${i + 1}, percent`}
                    />
                  </Affix>
                ))}
              </div>
            </Row>
            <Row id="defaultTip" label="Pre-selected tip" hint="What checkout starts on.">
              <FilterSelect
                value={draft.defaultTip}
                onChange={(v) => set('defaultTip', v as Draft['defaultTip'])}
                label="Pre-selected tip"
              >
                {draft.tipPcts.map((value, i) => (
                  <option key={i} value={String(i)}>
                    {value || '?'}%
                  </option>
                ))}
                <option value="none">No tip</option>
              </FilterSelect>
            </Row>
          </>
        )}
      </Section>

      <Section title="Payments" note="Methods offered on the checkout screen.">
        <div id="setting-paymentMethods">
          {PAYMENT_METHODS.map((m) => (
            <Row key={m.id} id={`method-${m.id}`} label={m.label}>
              <Switch
                checked={draft.paymentMethods.includes(m.id)}
                onChange={(on) =>
                  set(
                    'paymentMethods',
                    on
                      ? [...draft.paymentMethods, m.id]
                      : draft.paymentMethods.filter((id) => id !== m.id),
                  )
                }
                label={`Accept ${m.label.toLowerCase()}`}
              />
            </Row>
          ))}
        </div>
        {errors.paymentMethods && (
          <p className="settings-error" role="alert">
            {errors.paymentMethods}
          </p>
        )}
      </Section>

      <Section title="Pricing">
        <Row
          id="openPriceEnabled"
          label="Price at the counter"
          hint="Lets items marked “price set at the counter” ask for their price each time they’re rung up. Off, every item rings up at its set price."
        >
          <Switch
            checked={draft.openPriceEnabled}
            onChange={(v) => set('openPriceEnabled', v)}
            label="Price at the counter"
          />
        </Row>
      </Section>

      <Section title="Inventory">
        <Row
          id="lowStockDefault"
          forInput
          label="Low-stock warning"
          hint="Warn at this many left, for items that don’t set their own."
          error={errors.lowStockDefault}
        >
          <Affix after="left">
            <input
              id="setting-lowStockDefault"
              className="settings-input settings-input--num mono"
              inputMode="numeric"
              value={draft.lowStockDefault}
              onChange={(e) => set('lowStockDefault', e.target.value)}
              aria-invalid={!!errors.lowStockDefault}
              aria-label="Low-stock warning, units left"
            />
          </Affix>
        </Row>
      </Section>

      <Section title="Kitchen" note="Which items show up on the kitchen screen.">
        {categories.length === 0 && (
          <p className="settings-empty">No categories yet — create them under Categories.</p>
        )}
        {categories.map((c) => (
          <Row key={c.id} id={`kitchen-${c.id}`} label={c.label}>
            <Switch
              checked={draft.kitchenCategories.includes(c.id)}
              onChange={(on) =>
                set(
                  'kitchenCategories',
                  on
                    ? [...draft.kitchenCategories, c.id]
                    : draft.kitchenCategories.filter((id) => id !== c.id),
                )
              }
              label={`Send ${c.label.toLowerCase()} to the kitchen`}
            />
          </Row>
        ))}
        <Row
          id="kitchenLateMinutes"
          forInput
          label="Flag tickets late after"
          hint="A ticket waiting this long is marked late on the kitchen screen."
          error={errors.kitchenLateMinutes}
        >
          <Affix after="min">
            <input
              id="setting-kitchenLateMinutes"
              className="settings-input settings-input--num mono"
              inputMode="numeric"
              value={draft.kitchenLateMinutes}
              onChange={(e) => set('kitchenLateMinutes', e.target.value)}
              aria-invalid={!!errors.kitchenLateMinutes}
              aria-label="Flag kitchen tickets late after, minutes"
            />
          </Affix>
        </Row>
      </Section>

      <Section title="Security">
        <Row
          id="autoLock"
          label="Auto-lock"
          hint="Sign out after this long with no taps. Open tabs carry on."
        >
          <FilterSelect value={draft.autoLock} onChange={(v) => set('autoLock', v)} label="Auto-lock">
            {AUTO_LOCK_OPTIONS.map((o) => (
              <option key={o.label} value={o.value === null ? 'never' : String(o.value)}>
                {o.label}
              </option>
            ))}
          </FilterSelect>
        </Row>
        <Row
          id="maxPinTries"
          forInput
          label="Wrong PINs before lockout"
          hint="Sign-in locks for 30 seconds after this many misses in a row."
          error={errors.maxPinTries}
        >
          <input
            id="setting-maxPinTries"
            className="settings-input settings-input--num mono"
            inputMode="numeric"
            value={draft.maxPinTries}
            onChange={(e) => set('maxPinTries', e.target.value)}
            aria-invalid={!!errors.maxPinTries}
            aria-label="Wrong PINs before lockout"
          />
        </Row>
      </Section>

      <Section
        title="Data on this register"
        note={
          shopEmail
            ? `Synced to the shop account ${shopEmail}.`
            : 'Saved in this browser — clearing site data loses it.'
        }
      >
        {shopEmail && (
          <Row
            id="unlinkDevice"
            label="Sign out this device"
            hint="Removes the shop’s data from this browser. It stays in the cloud, and signing back in restores it."
          >
            <Button
              variant="secondary"
              size="sm"
              onClick={() => (confirmingUnlink ? void unlinkDevice() : setConfirmingUnlink(true))}
              onBlur={() => setConfirmingUnlink(false)}
            >
              {confirmingUnlink ? 'Confirm — sign out' : 'Sign out device'}
            </Button>
          </Row>
        )}
        <Row
          id="resetData"
          label="Start over"
          hint={`Deletes every order, stock movement, and setting saved ${
            shopEmail ? 'for this shop, on every device,' : 'here'
          } and starts the shop setup again. This can’t be undone.`}
        >
          <Button
            variant="secondary"
            size="sm"
            onClick={() => (confirmingReset ? resetAllData() : setConfirmingReset(true))}
            onBlur={() => setConfirmingReset(false)}
          >
            {confirmingReset ? 'Confirm — delete everything' : 'Reset all data'}
          </Button>
        </Row>
      </Section>

      {/* Stays in view at the bottom of the page while there's something to save. */}
      <div className={dirty || savedAt ? 'save-bar save-bar--on' : 'save-bar'} aria-live="polite">
        {dirty ? (
          <>
            <span className="save-bar__note">
              {Object.values(errors).some(Boolean)
                ? 'Fix the highlighted settings to save.'
                : 'Unsaved changes'}
            </span>
            <Button variant="secondary" size="sm" onClick={discard}>
              Discard
            </Button>
            <Button size="sm" onClick={save}>
              Save changes
            </Button>
          </>
        ) : savedAt ? (
          <span className="save-bar__note save-bar__note--ok">Settings saved</span>
        ) : null}
      </div>
    </div>
  );
}

/* ---------- Building blocks ---------- */

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  const id = `section-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  return (
    <section className="panel settings-section" aria-labelledby={id}>
      <div className="settings-section__head">
        <h2 className="panel__title" id={id}>
          {title}
        </h2>
        {note && <span className="settings-section__note">{note}</span>}
      </div>
      {children}
    </section>
  );
}

function Row({
  id,
  label,
  hint,
  error,
  forInput = false,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  /** The control is a text field with id `setting-{id}`; switches and selects name themselves. */
  forInput?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row__text">
        {forInput ? (
          <label className="settings-row__label" htmlFor={`setting-${id}`}>
            {label}
          </label>
        ) : (
          <span className="settings-row__label">{label}</span>
        )}
        {hint && <div className="settings-row__hint">{hint}</div>}
        {error && (
          <p className="settings-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="settings-row__control">{children}</div>
    </div>
  );
}

function LogoPicker({
  logo,
  onChange,
  onError,
}: {
  logo: string | null;
  onChange: (logo: string | null) => void;
  onError: (message: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);

  async function pick(file: File | undefined) {
    if (!file) return;
    setReading(true);
    try {
      onChange(await readLogo(file));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'That image couldn’t be used.');
    } finally {
      setReading(false);
      // Clear it so picking the same file again still fires a change.
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className="logo-picker" id="setting-logo">
      <span className="logo-picker__preview">
        <BrandMark logo={logo} />
      </span>
      <input
        ref={input}
        type="file"
        accept={LOGO_TYPES.join(',')}
        hidden
        onChange={(e) => pick(e.target.files?.[0])}
      />
      <Button variant="secondary" size="sm" onClick={() => input.current?.click()} disabled={reading}>
        {reading ? 'Reading…' : logo ? 'Replace' : 'Upload logo'}
      </Button>
      {logo && (
        <Button variant="secondary" size="sm" onClick={() => onChange(null)}>
          Remove
        </Button>
      )}
    </div>
  );
}

function TextInput({
  id,
  value,
  onChange,
  invalid,
  wide = false,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  invalid: boolean;
  wide?: boolean;
}) {
  return (
    <input
      id={id}
      className={wide ? 'settings-input settings-input--wide' : 'settings-input'}
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-invalid={invalid}
    />
  );
}

function Affix({ after, children }: { after: string; children: ReactNode }) {
  return (
    <span className="affix">
      {children}
      <span className="affix__after" aria-hidden="true">
        {after}
      </span>
    </span>
  );
}
