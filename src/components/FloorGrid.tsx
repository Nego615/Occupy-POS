import './FloorGrid.css';
import { LOCATION_GROUPS } from '../data/locations';
import { computeTotals } from '../lib/cart';
import { holdsManyTabs, orderNo, usePos } from '../lib/store';
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

/**
 * Every table and room, grouped, each showing the tabs running there. A table
 * can hold several; a room holds one.
 */
export function FloorGrid({ onPick, assigningOrderId }: FloorGridProps) {
  const { tabs, locations, settings, canSeeTab, allStaff } = usePos();
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
              const here = tabs.filter((t) => t.locationId === location.id);
              const isCurrent = picking && here.some((t) => t.orderId === assigningOrderId);
              // Tabs other than the one being assigned.
              const others = here.filter((t) => t.orderId !== assigningOrderId);
              const visible = others.filter(canSeeTab);
              const hidden = others.length - visible.length;
              const occupied = others.length > 0;
              // Another server's room: shown as taken, its tab stays theirs. A
              // table with only someone else's tab still seats a tab of your own.
              const theirs = !holdsManyTabs(locations, location.id) && occupied && visible.length === 0;
              const ownerId = others.find((t) => !canSeeTab(t))?.openedBy;
              const owner = ownerId ? allStaff.find((m) => m.id === ownerId) : undefined;
              const sums = visible.map((t) => computeTotals(t.cart, settings.taxRate, t.discount));
              const itemCount = sums.reduce((n, t) => n + t.itemCount, 0);
              const total = sums.reduce((n, t) => n + t.total, 0);
              const only = visible.length === 1 ? visible[0] : undefined;
              const classes = [
                'location',
                occupied ? 'location--occupied' : '',
                isCurrent ? 'location--current' : '',
                theirs ? 'location--theirs' : '',
              ]
                .filter(Boolean)
                .join(' ');

              return (
                <button
                  key={location.id}
                  type="button"
                  className={classes}
                  onClick={() => onPick(location.id)}
                  disabled={theirs}
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
                        {others.length > 1 ? `${others.length} tabs` : 'Occupied'}
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
                  {hidden > 0 && visible.length === 0 && (
                    <span className="location__tab">
                      <span className="location__tab-info">
                        {hidden > 1
                          ? `${hidden} other servers’ tabs`
                          : owner
                            ? `${owner.name.split(' ')[0]}’s tab`
                            : 'Another server’s tab'}
                      </span>
                    </span>
                  )}
                  {visible.length > 0 && (
                    <span className="location__tab">
                      <span className="location__tab-info">
                        {only ? (
                          <>
                            {orderNo(only.orderId) && <><Mono>{orderNo(only.orderId)}</Mono> · </>}
                          </>
                        ) : (
                          <>
                            <Mono>{visible.length}</Mono> tabs ·{' '}
                          </>
                        )}
                        <Mono>{itemCount}</Mono> {itemCount === 1 ? 'item' : 'items'}
                        {only && (
                          <>
                            {' '}
                            · since <Mono>{only.openedAt}</Mono>
                          </>
                        )}
                        {hidden > 0 && <> · +<Mono>{hidden}</Mono> not yours</>}
                      </span>
                      <Money value={total} className="location__total" />
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
