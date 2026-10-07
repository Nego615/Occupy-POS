import { useEffect, useRef, useState, type ReactNode } from 'react';
import './CounterDialogs.css';
import { ApprovalDialog } from './ApprovalDialog';
import { Button } from './Button';
import { Money, formatMoney } from './Mono';
import { servings, shareLabel, stockFits, type CatalogItem } from '../data/catalog';
import { bestPromo } from '../data/deals';
import type { DocketKind } from './PrintableSlip';
import { discountLabel, discountOff, itemQuantities, portionLine, type ManualDiscount } from '../lib/cart';
import { activeCurrency, isAmountText } from '../lib/currency';
import { usePos } from '../lib/store';

/** A native <dialog> shell, open while `open` is true. Escape and the backdrop close it. */
export function Modal({
  open,
  title,
  sub,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  sub?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="counter-dialog"
      aria-labelledby="counter-dialog-title"
      // Escape asks the owner to close rather than closing outright, so a
      // dialog can decline (e.g. to confirm discarding what's typed).
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      {open && (
        <div className="counter-dialog__body">
          <header className="counter-dialog__head">
            <div>
              <h2 id="counter-dialog-title" className="counter-dialog__title">
                {title}
              </h2>
              {sub && <div className="counter-dialog__sub">{sub}</div>}
            </div>
            <button type="button" className="counter-dialog__close" onClick={onClose} aria-label="Close">
              <span aria-hidden="true">×</span>
            </button>
          </header>
          {children}
        </div>
      )}
    </dialog>
  );
}

function parseAmount(text: string): number | null {
  const t = text.trim().replace(/,/g, '');
  if (!t || !isAmountText(t)) return null;
  const n = Number.parseFloat(t);
  return n > 0 ? n : null;
}

/**
 * Asks for a price — a custom amount (with an optional name), or the price of
 * an open-price item rung up now.
 */
export function PriceDialog({
  open,
  itemName,
  onSubmit,
  onClose,
}: {
  open: boolean;
  /** The open-price item being rung up; absent for a custom amount. */
  itemName?: string;
  onSubmit: (name: string, price: number) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const currency = activeCurrency();
  const amount = parseAmount(price);

  useEffect(() => {
    if (open) {
      setName('');
      setPrice('');
    }
  }, [open]);

  function submit() {
    if (amount === null) return;
    onSubmit(name, amount);
    onClose();
  }

  return (
    <Modal
      open={open}
      title={itemName ?? 'Custom amount'}
      sub={itemName ? 'Priced at the counter — enter what to charge.' : 'For something not on the menu.'}
      onClose={onClose}
    >
      <form
        className="counter-dialog__form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {!itemName && (
          <label className="counter-field">
            <span>Name on the receipt</span>
            <input
              type="text"
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
              placeholder="Custom amount"
            />
          </label>
        )}
        <label className="counter-field">
          <span>Price</span>
          <span className="counter-field__money">
            <span className="mono" aria-hidden="true">
              {currency.symbol}
            </span>
            <input
              className="mono"
              type="text"
              inputMode={currency.decimals === 0 ? 'numeric' : 'decimal'}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              autoFocus
            />
          </span>
        </label>
        <Button type="submit" size="lg" block disabled={amount === null}>
          Add {amount !== null && <Money value={amount} />}
        </Button>
      </form>
    </Modal>
  );
}

/**
 * Asks which serving of an item sold in portions to ring up — the whole one
 * or a portion. Servings there isn't enough stock left for are greyed out.
 */
export function PortionDialog({ item, onClose }: { item: CatalogItem | null; onClose: () => void }) {
  const { cart, promotions, addItem } = usePos();
  const inCart = item ? (itemQuantities(cart).get(item.id) ?? 0) : 0;
  const promo = item ? bestPromo(promotions, item, new Date()) : null;

  return (
    <Modal open={item !== null} title={item?.name ?? ''} sub="Which serving?" onClose={onClose}>
      <div className="portion-options">
        {item &&
          servings(item).map((s) => {
            const line = portionLine(item, s, promo);
            const fits = stockFits(item, inCart, s.units);
            return (
              <button
                key={s.id}
                type="button"
                className="portion-option"
                disabled={!fits}
                onClick={() => {
                  addItem(item, s);
                  onClose();
                }}
              >
                <span className="portion-option__label">
                  {s.label}
                  {s.units !== 1 && <span className="portion-option__share mono"> · {shareLabel(s.units, item.unitSize)}</span>}
                </span>
                <span className="portion-option__price">
                  {fits ? (
                    <>
                      {line.listPrice !== undefined && (
                        <s>
                          <Money value={line.listPrice} />
                        </s>
                      )}{' '}
                      <Money value={line.unitPrice} />
                    </>
                  ) : (
                    'Not enough left'
                  )}
                </span>
              </button>
            );
          })}
      </div>
    </Modal>
  );
}

/** Picks which docket to print for the register's tab: the priced one, or the kitchen's. */
export function DocketDialog({
  open,
  onPick,
  onClose,
}: {
  open: boolean;
  onPick: (kind: DocketKind) => void;
  onClose: () => void;
}) {
  const options: { kind: DocketKind; label: string; sub: string }[] = [
    { kind: 'bill', label: 'Order docket', sub: 'With prices and the total' },
    { kind: 'kitchen', label: 'Kitchen docket', sub: 'Items and notes only' },
  ];
  return (
    <Modal open={open} title="Print docket" sub="Which one?" onClose={onClose}>
      <div className="portion-options">
        {options.map((o) => (
          <button
            key={o.kind}
            type="button"
            className="portion-option"
            onClick={() => {
              onClose();
              onPick(o.kind);
            }}
          >
            <span className="portion-option__label">{o.label}</span>
            <span className="portion-option__share">{o.sub}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

const PERCENT_PRESETS = [5, 10, 15, 20, 50, 100];

/**
 * Picks a manual discount: a preset percentage, a typed percentage, or a
 * typed amount. `base` is what it comes off, for the preview.
 */
function DiscountPicker({
  base,
  value,
  onChange,
}: {
  base: number;
  value: ManualDiscount | null;
  onChange: (next: ManualDiscount | null) => void;
}) {
  const currency = activeCurrency();
  const [kind, setKind] = useState<ManualDiscount['kind']>(value?.kind ?? 'percent');
  const [text, setText] = useState(value && !PERCENT_PRESETS.includes(value.value) ? String(value.value) : '');

  // A saved discount can arrive after the picker mounts — show it, unless it's what's being typed.
  useEffect(() => {
    if (!value) return;
    setKind(value.kind);
    const isPreset = value.kind === 'percent' && PERCENT_PRESETS.includes(value.value);
    setText((current) =>
      isPreset ? '' : Number.parseFloat(current) === value.value ? current : String(value.value),
    );
  }, [value]);

  function typed(next: string, k = kind) {
    setText(next);
    const n = Number.parseFloat(next);
    if (!next.trim() || !Number.isFinite(n) || n <= 0) onChange(null);
    else onChange({ kind: k, value: k === 'percent' ? Math.min(100, n) : n });
  }

  return (
    <div className="discount-picker">
      <div className="discount-picker__row" role="group" aria-label="Percentage off">
        {PERCENT_PRESETS.map((pct) => {
          const active = value?.kind === 'percent' && value.value === pct;
          return (
            <button
              key={pct}
              type="button"
              className={active ? 'counter-chip counter-chip--active' : 'counter-chip'}
              aria-pressed={active}
              onClick={() => {
                setKind('percent');
                setText('');
                onChange(active ? null : { kind: 'percent', value: pct });
              }}
            >
              {pct === 100 ? 'Free' : `${pct}%`}
            </button>
          );
        })}
      </div>
      <div className="discount-picker__custom">
        <div className="discount-picker__kind" role="group" aria-label="Discount type">
          {(['percent', 'amount'] as const).map((k) => (
            <button
              key={k}
              type="button"
              className={kind === k ? 'counter-chip counter-chip--active' : 'counter-chip'}
              aria-pressed={kind === k}
              onClick={() => {
                setKind(k);
                typed(text, k);
              }}
            >
              {k === 'percent' ? '%' : currency.symbol}
            </button>
          ))}
        </div>
        <input
          className="mono counter-field__input"
          type="text"
          inputMode="decimal"
          value={text}
          onChange={(e) => typed(e.target.value)}
          placeholder={kind === 'percent' ? 'Other %' : 'Amount off'}
          aria-label={kind === 'percent' ? 'Other percentage off' : 'Amount off'}
        />
      </div>
      <div className="discount-picker__preview">
        {value ? (
          <>
            {discountLabel(value)} · takes off <Money value={discountOff(base, value)} />
          </>
        ) : (
          'No discount'
        )}
      </div>
    </div>
  );
}

/**
 * Applies a discount, or sends it for manager approval when the signed-in
 * person can't give discounts. Whoever okayed it is recorded on it.
 */
function useApprovedDiscount(action: string, apply: (d: ManualDiscount | null) => void) {
  const { me, can } = usePos();
  const [pending, setPending] = useState<ManualDiscount | null>(null);
  const allowed = can('discounts');

  function submit(d: ManualDiscount | null) {
    // Taking a discount off never needs approval.
    if (!d) return apply(null);
    if (allowed) return apply({ ...d, by: me?.id });
    setPending(d);
  }

  const dialog = (
    <ApprovalDialog
      open={pending !== null}
      permission="discounts"
      action={pending ? `${action} · ${discountLabel(pending)}` : action}
      onApproved={(approver) => {
        if (pending) apply({ ...pending, by: approver.id });
        setPending(null);
      }}
      onClose={() => setPending(null)}
    />
  );
  return { submit, dialog, allowed };
}

/** A cart line's note and manual discount. */
export function LineDialog({ lineKey, onClose }: { lineKey: string | null; onClose: () => void }) {
  const { cart, editLine } = usePos();
  const line = cart.find((l) => l.key === lineKey) ?? null;
  const [note, setNote] = useState('');
  const [discount, setDiscount] = useState<ManualDiscount | null>(null);

  // Filled from the line each time the dialog opens on one.
  useEffect(() => {
    if (!lineKey) return;
    const current = cart.find((l) => l.key === lineKey);
    setNote(current?.note ?? '');
    setDiscount(current?.manual ? { kind: current.manual.kind, value: current.manual.value } : null);
    // Only on opening — not as the cart changes underneath.
  }, [lineKey]);

  const base = line ? (line.manual?.base.unitPrice ?? line.unitPrice) * line.qty : 0;
  const sameDiscount =
    (line?.manual?.kind ?? null) === (discount?.kind ?? null) &&
    (line?.manual?.value ?? null) === (discount?.value ?? null);
  const unchanged = !!line && (line.note ?? '') === note.trim() && sameDiscount;

  const { submit, dialog, allowed } = useApprovedDiscount(
    `Discount on ${line?.qty ?? 1} × ${line?.name ?? ''}`,
    (d) => {
      if (line) editLine(line.key, note, d);
      onClose();
    },
  );

  function save() {
    if (!line) return;
    // An unchanged discount (say, one a manager already okayed) isn't re-approved.
    if (sameDiscount) {
      editLine(line.key, note, line.manual ? { ...discount!, by: line.manual.by } : null);
      onClose();
    } else {
      submit(discount);
    }
  }

  return (
    <>
      <Modal
        open={line !== null}
        title={line ? `${line.qty} × ${line.name}` : ''}
        sub={line && <Money value={line.unitPrice * line.qty} />}
        onClose={onClose}
      >
        {line && (
          <form
            className="counter-dialog__form"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <label className="counter-field">
              <span>Note for the kitchen and receipt</span>
              <input
                type="text"
                value={note}
                maxLength={60}
                onChange={(e) => setNote(e.target.value)}
                placeholder="No onions, extra hot…"
                autoFocus
              />
            </label>
            <fieldset className="counter-fieldset">
              <legend>Discount{!allowed && ' · needs a manager'}</legend>
              <DiscountPicker base={base} value={discount} onChange={setDiscount} />
            </fieldset>
            <Button type="submit" size="lg" block disabled={unchanged}>
              Save
            </Button>
          </form>
        )}
      </Modal>
      {dialog}
    </>
  );
}

/** A discount off the whole tab, before tax. */
export function TabDiscountDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { tab, totals, setTabDiscount } = usePos();
  const [discount, setDiscount] = useState<ManualDiscount | null>(null);

  useEffect(() => {
    if (open) setDiscount(tab.discount ? { kind: tab.discount.kind, value: tab.discount.value } : null);
  }, [open, tab.discount]);

  const base = totals.subtotal + totals.orderDiscount;
  const { submit, dialog, allowed } = useApprovedDiscount(
    `Discount on #${tab.orderId} · ${formatMoney(base)}`,
    (d) => {
      setTabDiscount(d);
      onClose();
    },
  );

  return (
    <>
      <Modal
        open={open}
        title="Discount the whole tab"
        sub={
          <>
            Comes off <Money value={base} /> before tax
            {!allowed && ' · needs a manager'}
          </>
        }
        onClose={onClose}
      >
        <form
          className="counter-dialog__form"
          onSubmit={(e) => {
            e.preventDefault();
            submit(discount);
          }}
        >
          <DiscountPicker base={base} value={discount} onChange={setDiscount} />
          <Button type="submit" size="lg" block>
            {discount ? 'Apply discount' : tab.discount ? 'Remove discount' : 'Done'}
          </Button>
        </form>
      </Modal>
      {dialog}
    </>
  );
}
