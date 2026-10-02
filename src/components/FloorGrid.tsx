import './FloorGrid.css';
import { LOCATION_GROUPS } from '../data/locations';
import { computeTotals } from '../lib/cart';
import { usePos } from '../lib/store';
import { Money, Mono } from './Mono';
import { StatusChip } from './StatusChip';

export type FloorGridProps = {
  onPick: (locationId: string) => void;
  /**
   * Picker mode: the tab being assigned. Its own location reads "This tab";
   * picking another occupied location is the caller's cue to offer a merge.
   */
  assigningOrderId?: number;
};

/** Every table and room, grouped, each showing whether a tab is running there. */
export function FloorGrid({ onPick, assigningOrderId }: FloorGridProps) {
  const { tabs, locations, settings } = usePos();
  const picking = assigningOrderId !== undefined;
  const groups = LOCATION_GROUPS.map((group) => ({
    ...group,
    members: locations.filter((l) => l.kind === group.kind),
  })).filter((group) => group.members.length > 0);

  return (
    <div className={picking ? 'floor floor--picking' : 'floor'}>
      {groups.map((group) => (
        <section key={group.kind} className="floor__group" aria-label={group.label}>
          <h2 className="floor__heading">{group.label}</h2>
          <div className="floor__grid">
            {group.members.map((location) => {
              const tab = tabs.find((t) => t.locationId === location.id);
              const isCurrent = picking && tab?.orderId === assigningOrderId;
              const occupied = tab !== undefined && !isCurrent;
              const totals = tab ? computeTotals(tab.cart, settings.taxRate) : null;
              const classes = [
                'location',
                occupied ? 'location--occupied' : '',
                isCurrent ? 'location--current' : '',
              ]
                .filter(Boolean)
                .join(' ');

              return (
                <button
                  key={location.id}
                  type="button"
                  className={classes}
                  onClick={() => onPick(location.id)}
                  aria-current={isCurrent || undefined}
                >
                  <span className="location__top">
                    <span className="location__name">{location.name}</span>
                    {isCurrent ? (
                      <StatusChip status="occupied" size="sm">
                        This tab
                      </StatusChip>
                    ) : occupied ? (
                      <StatusChip status="occupied" size="sm">
                        Occupied
                      </StatusChip>
                    ) : (
                      <StatusChip status="open" size="sm">
                        Free
                      </StatusChip>
                    )}
                  </span>
                  <span className="location__meta">
                    <Mono>{location.seats}</Mono> seats
                  </span>
                  {tab && totals && !isCurrent && (
                    <span className="location__tab">
                      <span className="location__tab-info">
                        <Mono>{`#${tab.orderId}`}</Mono> · <Mono>{totals.itemCount}</Mono>{' '}
                        {totals.itemCount === 1 ? 'item' : 'items'} · since{' '}
                        <Mono>{tab.openedAt}</Mono>
                      </span>
                      <Money value={totals.total} className="location__total" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
