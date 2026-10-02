import './ItemTile.css';
import { Money } from './Mono';

export type ItemTileProps = {
  name: string;
  price: number;
  /** The usual price, struck through beside `price` while a deal is on. */
  wasPrice?: number;
  /** The deal pricing it — "Happy Hour", "4 courses". */
  deal?: string;
  /** Category color for the dot — decorative iconography, not a state signal. */
  color: string;
  onClick?: () => void;
  selected?: boolean;
  /** Short stock line under the price — "3 left", "Sold out". */
  note?: string;
  /** Can't be rung up (sold out). Still shown, so staff can see why. */
  disabled?: boolean;
  /**
   * `false` renders a plain, non-focusable tile — used by the item editor's
   * live preview so the same markup drives both surfaces.
   */
  interactive?: boolean;
  /** Surface the tile sits on. `paper` is the editor's preview rail. */
  tone?: 'surface' | 'paper';
  className?: string;
};

export function ItemTile({
  name,
  price,
  wasPrice,
  deal,
  color,
  onClick,
  selected = false,
  note,
  disabled = false,
  interactive = true,
  tone = 'surface',
  className,
}: ItemTileProps) {
  const classes = [
    'item-tile',
    tone === 'paper' ? 'item-tile--paper' : '',
    interactive ? 'item-tile--interactive' : '',
    selected ? 'item-tile--selected' : '',
    disabled ? 'item-tile--disabled' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  const content = (
    <>
      <span className="item-tile__dot" style={{ background: color }} aria-hidden="true" />
      <span className="item-tile__name">{name}</span>
      <span className="item-tile__price">
        <Money value={price} />
        {wasPrice !== undefined && wasPrice > price && (
          <>
            {' '}
            <s className="item-tile__was">
              <Money value={wasPrice} />
            </s>
          </>
        )}
      </span>
      {deal && <span className="item-tile__deal">{deal}</span>}
      {note && <span className="item-tile__note">{note}</span>}
    </>
  );

  if (!interactive) {
    return (
      <div className={classes} aria-hidden="true">
        {content}
      </div>
    );
  }

  return (
    <button type="button" className={classes} onClick={onClick} disabled={disabled}>
      {content}
    </button>
  );
}
