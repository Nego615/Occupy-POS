import { useState } from 'react';
import { useNavigate } from 'react-router';
import './Tables.css';
import { Button } from '../components/Button';
import { FloorGrid } from '../components/FloorGrid';
import { Money, Mono } from '../components/Mono';
import { StatusChip } from '../components/StatusChip';
import { TableTabsDialog } from '../components/TableTabsDialog';
import { computeTotals } from '../lib/cart';
import { holdsManyTabs, usePos } from '../lib/store';

/**
 * The floor at a glance: which tables and rooms have a tab running, and the
 * walk-in tabs that aren't assigned anywhere. Tapping any of them puts that
 * tab on the register. A table with tabs of yours running asks which one, or
 * starts another there.
 */
export function Tables() {
  const navigate = useNavigate();
  const { tabs, locations, openTab, switchTab, canSeeTab, settings } = usePos();

  const occupiedCount = locations.filter((l) => tabs.some((t) => t.locationId === l.id)).length;
  const walkIns = tabs.filter((t) => t.locationId === null && t.cart.length > 0 && canSeeTab(t));

  const [choosing, setChoosing] = useState<string | null>(null);

  function toRegister() {
    setChoosing(null);
    navigate('/counter/register');
  }

  function open(locationId: string | null) {
    const shared = locationId !== null && holdsManyTabs(locations, locationId);
    if (shared && tabs.some((t) => t.locationId === locationId && canSeeTab(t))) {
      setChoosing(locationId);
      return;
    }
    openTab(locationId, shared);
    toRegister();
  }

  return (
    <main className="tables">
      <div className="tables__toolbar">
        <p className="tables__summary">
          <Mono>{occupiedCount}</Mono> of <Mono>{locations.length}</Mono> occupied
        </p>
        <Button variant="secondary" onClick={() => open(null)}>
          New walk-in tab
        </Button>
      </div>

      <FloorGrid onPick={open} />
      <TableTabsDialog locationId={choosing} onClose={() => setChoosing(null)} onDone={toRegister} />

      {walkIns.length > 0 && (
        <section className="tables__walk-ins" aria-label="Walk-in tabs">
          <h2 className="tables__heading">Walk-in tabs</h2>
          <div className="tables__walk-in-list">
            {walkIns.map((tab) => {
              const totals = computeTotals(tab.cart, settings.taxRate);
              return (
                <button
                  key={tab.orderId}
                  type="button"
                  className="walk-in"
                  onClick={() => {
                    switchTab(tab.orderId);
                    navigate('/counter/register');
                  }}
                >
                  <Mono className="walk-in__id">{`#${tab.orderId}`}</Mono>
                  <span className="walk-in__meta">
                    <Mono>{totals.itemCount}</Mono>{' '}
                    {totals.itemCount === 1 ? 'item' : 'items'} · since{' '}
                    <Mono>{tab.openedAt}</Mono>
                  </span>
                  <StatusChip status="occupied" size="sm">
                    Unassigned
                  </StatusChip>
                  <Money value={totals.total} className="walk-in__total" />
                </button>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}
