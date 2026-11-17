import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import './ListControls.css';
import { Button } from './Button';
import { FilterSelect } from './FilterSelect';
import { Icon } from './Icon';
import { Pill, PillRow } from './Pill';
import { isoDate } from '../data/history';
import { quick } from '../lib/motion';
import {
  TIME_PRESET_LABEL,
  customRangeLabel,
  hourWindowLabel,
  inHourWindow,
  type HourWindow,
  type SortOption,
  type TimeFilter,
  type TimePreset,
} from '../lib/listView';

/* ---------- Sort ---------- */

/** How a list is ordered, in plain words: "Newest first", "Docket # high to low". */
export function SortSelect<T>({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (id: string) => void;
  options: SortOption<T>[];
}) {
  return (
    <span className="sort-select">
      <span className="sort-select__glyph" aria-hidden="true">
        ⇅
      </span>
      <FilterSelect value={value} onChange={onChange} label="Sort by">
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </FilterSelect>
    </span>
  );
}

/* ---------- Time ---------- */

/**
 * A business day starts at six in the morning and runs through the night,
 * so the strip reads in four quarters of a trading day, with the small hours
 * last — where a bar's late service actually falls.
 */
const QUARTERS: { label: string; start: number }[] = [
  { label: 'Morning', start: 6 },
  { label: 'Afternoon', start: 12 },
  { label: 'Evening', start: 18 },
  { label: 'Night', start: 0 },
];

const hourAt = (index: number) => (index + 6) % 24;
const pad = (h: number) => String(h).padStart(2, '0');

/** The window from one slot to another, inclusive, whichever was tapped first. */
function windowBetween(a: number, b: number): HourWindow | null {
  const [i, j] = a <= b ? [a, b] : [b, a];
  if (j - i === 23) return null; // the whole day is any time
  return { from: hourAt(i), to: (hourAt(j) + 1) % 24 || 24 };
}

export type TimeFilterControlProps = {
  value: TimeFilter;
  onChange: (value: TimeFilter) => void;
  /** Quick picks shown as pills, in order. "Pick dates" is always offered after them. */
  presets: Exclude<TimePreset, 'custom'>[];
  /** Offer the hour-of-day window too. For lists of moments (orders), not of days. */
  withHours?: boolean;
};

/**
 * Quick ranges as pills, then one more control for anything else: any span
 * of days, and — where the list holds moments rather than days — which hours
 * of them. An hour window stays put as the days change, so "Evening" can be
 * looked at over today, then the week.
 */
export function TimeFilterControl({ value, onChange, presets, withHours = false }: TimeFilterControlProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const custom = value.preset === 'custom';
  const parts = [
    custom ? customRangeLabel(value) : null,
    value.hours ? hourWindowLabel(value.hours) : null,
  ].filter(Boolean);
  const triggerLabel = parts.length > 0 ? parts.join(', ') : withHours ? 'Dates & hours' : 'Pick dates';

  return (
    <div className="timefilter" ref={wrapRef}>
      <PillRow label="Time">
        {presets.map((p) => (
          <Pill key={p} active={value.preset === p} onClick={() => onChange({ ...value, preset: p })}>
            {TIME_PRESET_LABEL[p]}
          </Pill>
        ))}
      </PillRow>
      <button
        ref={triggerRef}
        type="button"
        className={parts.length > 0 ? 'timefilter__trigger timefilter__trigger--set' : 'timefilter__trigger'}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="clock" size={15} />
        <span className="mono">{triggerLabel}</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="timefilter__panel"
            id={panelId}
            role="dialog"
            aria-label={withHours ? 'Pick dates and hours' : 'Pick dates'}
            style={{ transformOrigin: 'top left' }}
            initial={{ opacity: 0, scale: 0.97, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0, transition: quick }}
            exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.1 } }}
          >
            <DaysPicker value={value} onChange={onChange} />
            {withHours && (
              <HourStrip hours={value.hours} onChange={(hours) => onChange({ ...value, hours })} />
            )}
            <div className="timefilter__foot">
              <Button size="sm" onClick={() => setOpen(false)}>
                Done
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function DaysPicker({ value, onChange }: { value: TimeFilter; onChange: (v: TimeFilter) => void }) {
  const today = isoDate(new Date());
  const custom = value.preset === 'custom';

  function set(key: 'from' | 'to', day: string) {
    // Starting a custom range from a preset keeps the other end open.
    const base = custom ? value : { ...value, from: undefined, to: undefined };
    onChange({ ...base, preset: 'custom', [key]: day || undefined });
  }

  return (
    <fieldset className="timefilter__group">
      <legend className="timefilter__legend">Days</legend>
      <div className="timefilter__days">
        <label className="timefilter__field">
          From
          <input
            className="timefilter__date mono"
            type="date"
            max={today}
            value={custom ? (value.from ?? '') : ''}
            onChange={(e) => set('from', e.target.value)}
          />
        </label>
        <label className="timefilter__field">
          To
          <input
            className="timefilter__date mono"
            type="date"
            max={today}
            value={custom ? (value.to ?? '') : ''}
            onChange={(e) => set('to', e.target.value)}
          />
        </label>
      </div>
    </fieldset>
  );
}

/**
 * Tap the first hour, then the last. A quarter's name picks all six of its
 * hours. Picking runs on from evening into night, so 20:00 to 02:00 is one
 * unbroken stretch.
 */
function HourStrip({ hours, onChange }: { hours: HourWindow | null; onChange: (w: HourWindow | null) => void }) {
  // The first tap of two; the window is set on the second.
  const [anchor, setAnchor] = useState<number | null>(null);

  function tap(index: number) {
    if (anchor === null) {
      setAnchor(index);
      onChange(windowBetween(index, index));
    } else {
      onChange(windowBetween(anchor, index));
      setAnchor(null);
    }
  }

  const status =
    anchor !== null
      ? `From ${pad(hourAt(anchor))}:00. Now tap the last hour.`
      : hours
        ? `Showing ${hourWindowLabel(hours)}.`
        : 'Any time of day.';

  return (
    <fieldset className="timefilter__group">
      <legend className="timefilter__legend">Hours</legend>
      <div className="hourstrip">
        {QUARTERS.map((q, row) => (
          <div className="hourstrip__row" key={q.label}>
            <button
              type="button"
              className="hourstrip__quarter"
              onClick={() => {
                setAnchor(null);
                onChange(windowBetween(row * 6, row * 6 + 5));
              }}
            >
              {q.label}
            </button>
            {Array.from({ length: 6 }, (_, k) => {
              const index = row * 6 + k;
              const hour = hourAt(index);
              const on = hours !== null && inHourWindow(hour, hours);
              const classes = [
                'hourstrip__cell',
                on ? 'hourstrip__cell--on' : '',
                anchor === index ? 'hourstrip__cell--anchor' : '',
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <button
                  key={hour}
                  type="button"
                  className={classes}
                  aria-pressed={on}
                  aria-label={`${pad(hour)}:00 to ${pad((hour + 1) % 24)}:00`}
                  onClick={() => tap(index)}
                >
                  <span className="mono">{pad(hour)}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div className="hourstrip__foot">
        <p className="hourstrip__status" aria-live="polite">
          {status}
        </p>
        {(hours || anchor !== null) && (
          <button
            type="button"
            className="timefilter__reset"
            onClick={() => {
              setAnchor(null);
              onChange(null);
            }}
          >
            Any time
          </button>
        )}
      </div>
    </fieldset>
  );
}

/* ---------- Count line ---------- */

/** "24 orders", with a way back out of the filters when any are on. */
export function ListCount({
  count,
  noun,
  plural = `${noun}s`,
  onClear,
  children,
}: {
  count: number;
  noun: string;
  plural?: string;
  /** Shown as "Clear filters" when given. */
  onClear?: () => void;
  /** Extra summary after the count, e.g. a total. */
  children?: ReactNode;
}) {
  return (
    <p className="list-count" aria-live="polite">
      <span>
        <span className="mono">{count}</span> {count === 1 ? noun : plural}
        {children}
      </span>
      {onClear && (
        <button type="button" className="list-count__clear" onClick={onClear}>
          Clear filters
        </button>
      )}
    </p>
  );
}
